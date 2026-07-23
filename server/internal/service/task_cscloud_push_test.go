package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/cloudruntime"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// fakePushClient records every outbound device request and returns the
// configured status/error on the next call.
type fakePushClient struct {
	mu       sync.Mutex
	requests []cloudruntime.Request
	status   int
	err      error
}

func (f *fakePushClient) Enabled() bool { return true }
func (f *fakePushClient) Do(_ context.Context, req cloudruntime.Request) (*cloudruntime.Response, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.requests = append(f.requests, req)
	if f.err != nil {
		return nil, f.err
	}
	return &cloudruntime.Response{StatusCode: f.status, Body: []byte(`{"status":"accepted"}`)}, nil
}

func (f *fakePushClient) snapshot() []cloudruntime.Request {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]cloudruntime.Request, len(f.requests))
	copy(out, f.requests)
	return out
}

// pushTaskDB is a minimal in-memory queries stub for the paths exercised by
// the cs-cloud push tests. It only implements the exact subset needed.
type pushTaskDB struct {
	runtime          db.MulticaAgentRuntime
	task             db.MulticaAgentTaskQueue
	dispatchedCalled bool
	dispatchedResult db.MulticaAgentTaskQueue
}

func (m *pushTaskDB) QueryRow(_ context.Context, sql string, args ...interface{}) pgx.Row {
	switch {
	case strings.Contains(sql, "MarkAgentTaskDispatched"):
		if m.dispatchedCalled {
			return &pushMockRow{err: pgx.ErrNoRows}
		}
		m.dispatchedCalled = true
		out := m.dispatchedResult
		out.Status = "dispatched"
		return &pushMockRow{task: &out}
	case strings.Contains(sql, "GetAgentRuntime"):
		return &pushMockRow{taskRuntime: &m.runtime}
	case strings.Contains(sql, "GetAgent "):
		return &pushMockRow{agent: &db.MulticaAgent{ID: m.task.AgentID, WorkspaceID: m.runtime.WorkspaceID}}
	case strings.Contains(sql, "GetIssue"):
		return &pushMockRow{issue: &db.MulticaIssue{ID: m.task.IssueID, WorkspaceID: m.runtime.WorkspaceID, Title: "Issue"}}
	case strings.Contains(sql, "GetComment"):
		return &pushMockRow{err: pgx.ErrNoRows}
	case strings.Contains(sql, "ListChatMessages"):
		return &mockRowsChat{}
	case strings.Contains(sql, "GetAutopilotRun"):
		return &pushMockRow{err: pgx.ErrNoRows}
	case strings.Contains(sql, "CancelAgentTask"):
		return &pushMockRow{task: &m.task}
	default:
		return &pushMockRow{err: pgx.ErrNoRows}
	}
}

func (m *pushTaskDB) Exec(_ context.Context, _ string, _ ...interface{}) (pgconn.CommandTag, error) {
	return pgconn.NewCommandTag(""), nil
}
func (m *pushTaskDB) Query(_ context.Context, _ string, _ ...interface{}) (pgx.Rows, error) {
	return nil, pgx.ErrNoRows
}

// pushMockRow is a test-only pgx.Row that can return different generated
// structs depending on which query is running.
type pushMockRow struct {
	task        *db.MulticaAgentTaskQueue
	taskRuntime *db.MulticaAgentRuntime
	agent       *db.MulticaAgent
	issue       *db.MulticaIssue
	err         error
}

func (r *pushMockRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if r.task != nil {
		return scanTaskQueue(r.task, dest)
	}
	if r.taskRuntime != nil {
		return scanRuntime(r.taskRuntime, dest)
	}
	if r.agent != nil {
		return scanAgent(r.agent, dest)
	}
	if r.issue != nil {
		return scanIssue(r.issue, dest)
	}
	return nil
}

func scanTaskQueue(t *db.MulticaAgentTaskQueue, dest []any) error {
	vals := []any{
		&t.ID, &t.AgentID, &t.IssueID, &t.Status, &t.Priority,
		&t.DispatchedAt, &t.StartedAt, &t.CompletedAt, &t.Result,
		&t.Error, &t.CreatedAt, &t.Context, &t.RuntimeID,
		&t.SessionID, &t.WorkDir, &t.TriggerCommentID,
		&t.ChatSessionID, &t.AutopilotRunID, &t.Attempt, &t.MaxAttempts,
		&t.ParentTaskID, &t.FailureReason, &t.TriggerSummary,
		&t.ForceFreshSession, &t.IsLeaderTask, &t.WorkflowNodeRunID,
	}
	return copyRow(vals, dest)
}

func scanRuntime(rt *db.MulticaAgentRuntime, dest []any) error {
	vals := []any{
		&rt.ID, &rt.WorkspaceID, &rt.DaemonID, &rt.Name, &rt.RuntimeMode,
		&rt.Provider, &rt.Status, &rt.DeviceInfo, &rt.Metadata,
		&rt.LastSeenAt, &rt.CreatedAt, &rt.UpdatedAt, &rt.OwnerID,
		&rt.LegacyDaemonID, &rt.Visibility,
	}
	return copyRow(vals, dest)
}

func scanAgent(a *db.MulticaAgent, dest []any) error {
	vals := []any{
		&a.ID, &a.WorkspaceID, &a.Name, &a.AvatarUrl, &a.RuntimeMode,
		&a.RuntimeConfig, &a.Visibility, &a.Status, &a.MaxConcurrentTasks,
		&a.OwnerID, &a.CreatedAt, &a.UpdatedAt, &a.Description,
		&a.RuntimeID, &a.Instructions, &a.ArchivedAt, &a.ArchivedBy,
		&a.CustomEnv, &a.CustomArgs, &a.McpConfig, &a.Model,
		&a.ThinkingLevel, &a.PluginID, &a.IsBuiltin,
	}
	return copyRow(vals, dest)
}

func scanIssue(i *db.MulticaIssue, dest []any) error {
	vals := []any{
		&i.ID, &i.WorkspaceID, &i.Title, &i.Description, &i.Status,
		&i.Priority, &i.AssigneeType, &i.AssigneeID, &i.CreatorType,
		&i.CreatorID, &i.ParentIssueID, &i.AcceptanceCriteria,
		&i.ContextRefs, &i.Position, &i.DueDate, &i.CreatedAt,
		&i.UpdatedAt,
	}
	return copyRow(vals, dest)
}

func copyRow(src []any, dest []any) error {
	for i, p := range src {
		if i >= len(dest) {
			break
		}
		switch d := dest[i].(type) {
		case *pgtype.UUID:
			*d = *(p.(*pgtype.UUID))
		case *string:
			*d = *(p.(*string))
		case *int32:
			*d = *(p.(*int32))
		case *pgtype.Timestamptz:
			*d = *(p.(*pgtype.Timestamptz))
		case *[]byte:
			*d = *(p.(*[]byte))
		case *pgtype.Text:
			*d = *(p.(*pgtype.Text))
		case *bool:
			*d = *(p.(*bool))
		case *float64:
			*d = *(p.(*float64))
		}
	}
	return nil
}

type mockRowsChat struct{}

func (mockRowsChat) Next() bool                                   { return false }
func (mockRowsChat) Close()                                       {}
func (mockRowsChat) Err() error                                   { return nil }
func (mockRowsChat) Scan(...any) error                            { return nil }
func (mockRowsChat) CommandTag() pgconn.CommandTag                { return pgconn.NewCommandTag("") }
func (mockRowsChat) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (mockRowsChat) RawValues() [][]byte                          { return nil }

func newPushTestDB(runtimeProvider, daemonID string) *pushTaskDB {
	return &pushTaskDB{
		runtime: db.MulticaAgentRuntime{
			ID:          testUUID(1),
			WorkspaceID: testUUID(2),
			DaemonID:    pgtype.Text{String: daemonID, Valid: true},
			Provider:    runtimeProvider,
		},
		dispatchedResult: db.MulticaAgentTaskQueue{
			ID:                testUUID(3),
			AgentID:           testUUID(4),
			RuntimeID:         testUUID(1),
			IssueID:           testUUID(5),
			WorkflowNodeRunID: testUUID(6),
			Status:            "queued",
		},
	}
}

func TestDispatchToCSCloud_PushesAndMarksDispatched(t *testing.T) {
	pusher := &fakePushClient{status: http.StatusOK}
	dbtx := newPushTestDB(csCloudProvider, "device-123")
	svc := &TaskService{
		Queries:     db.New(dbtx),
		Bus:         events.New(),
		CSCloudPush: pusher,
	}

	task := dbtx.dispatchedResult
	task.RuntimeID = dbtx.runtime.ID
	err := svc.dispatchTaskToCSCloud(context.Background(), task)
	if err != nil {
		t.Fatalf("dispatch: %v", err)
	}

	if len(pusher.snapshot()) != 1 {
		t.Fatalf("expected 1 push request, got %d", len(pusher.snapshot()))
	}
	req := pusher.snapshot()[0]
	wantPath := "/device/device-123/proxy/api/v1/workflow/tasks/"
	if !strings.Contains(req.Path, wantPath) {
		t.Fatalf("path = %q, want substring %q", req.Path, wantPath)
	}

	var payload csCloudTaskRunPayload
	if err := json.Unmarshal(req.Body, &payload); err != nil {
		t.Fatalf("payload: %v", err)
	}
	if payload.Agent != "csc" {
		t.Fatalf("agent = %q, want csc", payload.Agent)
	}
	if payload.AgentID != util.UUIDToString(dbtx.dispatchedResult.AgentID) {
		t.Fatalf("agent_id = %q, want %q", payload.AgentID, util.UUIDToString(dbtx.dispatchedResult.AgentID))
	}
	if payload.NodeRunID != util.UUIDToString(dbtx.dispatchedResult.WorkflowNodeRunID) {
		t.Fatalf("node_run_id = %q, want %q", payload.NodeRunID, util.UUIDToString(dbtx.dispatchedResult.WorkflowNodeRunID))
	}
	if !strings.Contains(payload.Prompt, "Issue") {
		t.Fatalf("prompt should contain issue title, got %q", payload.Prompt)
	}
}

func TestDispatchToCSCloud_SkipsNonCSCloudRuntime(t *testing.T) {
	pusher := &fakePushClient{status: http.StatusOK}
	dbtx := newPushTestDB("csc", "device-123")
	svc := &TaskService{Queries: db.New(dbtx), CSCloudPush: pusher}

	task := dbtx.dispatchedResult
	task.RuntimeID = dbtx.runtime.ID
	if err := svc.dispatchTaskToCSCloud(context.Background(), task); err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	if len(pusher.snapshot()) != 0 {
		t.Fatalf("expected 0 pushes for csc runtime, got %d", len(pusher.snapshot()))
	}
}

func TestDispatchToCSCloud_NoRowAbortsPush(t *testing.T) {
	pusher := &fakePushClient{status: http.StatusOK}
	dbtx := newPushTestDB(csCloudProvider, "device-123")
	dbtx.dispatchedCalled = true // simulate task already left queued
	svc := &TaskService{Queries: db.New(dbtx), CSCloudPush: pusher}

	task := dbtx.dispatchedResult
	task.RuntimeID = dbtx.runtime.ID
	if err := svc.dispatchTaskToCSCloud(context.Background(), task); err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	if len(pusher.snapshot()) != 0 {
		t.Fatalf("expected 0 pushes when task no longer queued, got %d", len(pusher.snapshot()))
	}
}

func TestDispatchToCSCloud_DeviceErrorFailsTask(t *testing.T) {
	pusher := &fakePushClient{status: http.StatusServiceUnavailable}
	dbtx := newPushTestDB(csCloudProvider, "device-123")
	dbtx.task = dbtx.dispatchedResult
	svc := &TaskService{
		Queries:     db.New(dbtx),
		Bus:         events.New(),
		CSCloudPush: pusher,
	}

	task := dbtx.dispatchedResult
	task.RuntimeID = dbtx.runtime.ID
	task.Status = "queued"
	if err := svc.dispatchTaskToCSCloud(context.Background(), task); err == nil {
		t.Fatal("expected error for 503 push response")
	}
	if len(pusher.snapshot()) != 1 {
		t.Fatalf("expected 1 push, got %d", len(pusher.snapshot()))
	}
}

func TestMaybePushToCSCloud_Disabled(t *testing.T) {
	pusher := &fakePushClient{status: http.StatusOK}
	svc := &TaskService{CSCloudPush: pusher}
	// Even with a non-nil pusher, if Enabled returns false we don't push.
	// fakePushClient returns true, so we need a nil pusher here.
	svc.CSCloudPush = nil
	svc.maybePushToCSCloud(db.MulticaAgentTaskQueue{
		ID:        testUUID(9),
		RuntimeID: pgtype.UUID{Bytes: [16]byte{9}, Valid: true},
	})
	time.Sleep(50 * time.Millisecond)
	if len(pusher.snapshot()) != 0 {
		t.Fatalf("expected 0 pushes, got %d", len(pusher.snapshot()))
	}
}

func TestMaybeAbortOnDevice_FiresForDispatchedCSCloud(t *testing.T) {
	pusher := &fakePushClient{status: http.StatusOK}
	dbtx := newPushTestDB(csCloudProvider, "device-abc")
	svc := &TaskService{Queries: db.New(dbtx), CSCloudPush: pusher}

	task := dbtx.dispatchedResult
	task.RuntimeID = dbtx.runtime.ID
	task.Status = "dispatched"
	svc.maybeAbortOnDevice(task)
	time.Sleep(50 * time.Millisecond)

	if len(pusher.snapshot()) != 1 {
		t.Fatalf("expected 1 abort request, got %d", len(pusher.snapshot()))
	}
	if !strings.Contains(pusher.snapshot()[0].Path, "/abort") {
		t.Fatalf("expected abort path, got %q", pusher.snapshot()[0].Path)
	}
}

func TestMaybeAbortOnDevice_SkipsQueued(t *testing.T) {
	pusher := &fakePushClient{status: http.StatusOK}
	dbtx := newPushTestDB(csCloudProvider, "device-abc")
	svc := &TaskService{Queries: db.New(dbtx), CSCloudPush: pusher}

	task := dbtx.dispatchedResult
	task.RuntimeID = dbtx.runtime.ID
	task.Status = "queued"
	svc.maybeAbortOnDevice(task)
	time.Sleep(50 * time.Millisecond)

	if len(pusher.snapshot()) != 0 {
		t.Fatalf("expected 0 abort requests for queued task, got %d", len(pusher.snapshot()))
	}
}

func TestComputeCSCloudTaskKind(t *testing.T) {
	tests := []struct {
		name string
		task db.MulticaAgentTaskQueue
		want string
	}{
		{"chat", db.MulticaAgentTaskQueue{ChatSessionID: pgtype.UUID{Valid: true}}, "chat"},
		{"autopilot", db.MulticaAgentTaskQueue{AutopilotRunID: pgtype.UUID{Valid: true}}, "autopilot"},
		{"quick_create", db.MulticaAgentTaskQueue{}, "quick_create"},
		{"comment", db.MulticaAgentTaskQueue{IssueID: pgtype.UUID{Valid: true}, TriggerCommentID: pgtype.UUID{Valid: true}}, "comment"},
		{"direct", db.MulticaAgentTaskQueue{IssueID: pgtype.UUID{Valid: true}}, "direct"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := computeCSCloudTaskKind(tt.task); got != tt.want {
				t.Fatalf("kind = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestAppendWorkerPromptWarnsNotToActAsCritic(t *testing.T) {
	got := appendWorkerTaskPrompt("Issue: mixed worker and critic instructions")
	for _, want := range []string{
		"Workflow Worker Task",
		"You are the worker",
		"Do NOT perform critic review",
		"Do NOT approve or reject",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("worker prompt missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "Workflow Critic Review") {
		t.Fatalf("worker prompt must not include critic review section:\n%s", got)
	}
}

func TestTruncatePrompt(t *testing.T) {
	long := strings.Repeat("a", promptMaxRunes+100)
	got := truncatePrompt(long)
	if len([]rune(got)) > promptMaxRunes+30 {
		t.Fatalf("truncated prompt too long: %d runes", len([]rune(got)))
	}
	if !strings.Contains(got, "(truncated)") {
		t.Fatal("missing truncation marker")
	}
}

func TestCSCloudDeviceID_MetadataPreferred(t *testing.T) {
	rt := db.MulticaAgentRuntime{
		DaemonID: pgtype.Text{String: "fallback", Valid: true},
		Metadata: []byte(`{"device_id":"preferred"}`),
	}
	got, err := csCloudDeviceID(rt)
	if err != nil || got != "preferred" {
		t.Fatalf("got %q err %v, want preferred", got, err)
	}
}

func TestCSCloudDeviceID_Fallback(t *testing.T) {
	rt := db.MulticaAgentRuntime{
		DaemonID: pgtype.Text{String: "fallback", Valid: true},
	}
	got, err := csCloudDeviceID(rt)
	if err != nil || got != "fallback" {
		t.Fatalf("got %q err %v, want fallback", got, err)
	}
}

func TestCSCloudDeviceID_None(t *testing.T) {
	rt := db.MulticaAgentRuntime{ID: pgtype.UUID{Valid: true}}
	if _, err := csCloudDeviceID(rt); err == nil {
		t.Fatal("expected error when no device id")
	}
}

// Ensure fakePushClient implements DevicePushClient.
var _ DevicePushClient = (*fakePushClient)(nil)

// Ensure util.UUIDToString is used.
var _ = util.UUIDToString

// Ensure errors.Is is used.
var _ = errors.Is

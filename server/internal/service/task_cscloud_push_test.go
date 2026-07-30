package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/cloudruntime"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/teamnamespace"
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
	lastSessionRow   *db.GetLastTaskSessionRow  // nil => 仿 ErrNoRows（首次/全中毒失败）
	nodeRunRow       *db.MulticaWorkflowNodeRun // nil => ErrNoRows (Task 4 node-run handback)
	agentPluginID    pgtype.Text
	agentPluginName  pgtype.Text
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
		return &pushMockRow{agent: &db.MulticaAgent{ID: m.task.AgentID, WorkspaceID: m.runtime.WorkspaceID, PluginID: m.agentPluginID, PluginName: m.agentPluginName}}
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
	case strings.Contains(sql, "GetLastTaskSession"):
		if m.lastSessionRow == nil {
			return &pushMockRow{err: pgx.ErrNoRows}
		}
		return &pushMockRow{lastSession: m.lastSessionRow}
	case strings.Contains(sql, "GetWorkflowNodeRun"):
		if m.nodeRunRow == nil {
			return &pushMockRow{err: pgx.ErrNoRows}
		}
		return &pushMockRow{nodeRun: m.nodeRunRow}
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
	lastSession *db.GetLastTaskSessionRow  // GetLastTaskSession 命中时填
	nodeRun     *db.MulticaWorkflowNodeRun // GetWorkflowNodeRun hit (Task 4 handback)
	err         error
}

func (r *pushMockRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if r.lastSession != nil {
		// sqlc-generated GetLastTaskSession calls row.Scan(&i.SessionID, &i.WorkDir, &i.RuntimeID)
		if len(dest) >= 3 {
			if p, ok := dest[0].(*pgtype.Text); ok {
				*p = r.lastSession.SessionID
			}
			if p, ok := dest[1].(*pgtype.Text); ok {
				*p = r.lastSession.WorkDir
			}
			if p, ok := dest[2].(*pgtype.UUID); ok {
				*p = r.lastSession.RuntimeID
			}
		}
		return nil
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
	if r.nodeRun != nil {
		return scanNodeRun(r.nodeRun, dest)
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
		&a.ThinkingLevel, &a.PluginID, &a.IsBuiltin, &a.PluginName,
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
	dbtx := newPushTestDB("legacy_local", "device-123")
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

func TestInjectGiteaToken(t *testing.T) {
	tests := []struct {
		name     string
		cloneURL string
		botUser  string
		token    string
		want     string
	}{
		{"bot user embedded", "https://gitea.test/owner/repo.git", "multica-bot", "tok123", "https://multica-bot:tok123@gitea.test/owner/repo.git"},
		{"oauth2 fallback when no bot user", "https://gitea.test/owner/repo.git", "", "tok123", "https://oauth2:tok123@gitea.test/owner/repo.git"},
		{"empty token returns URL unchanged", "https://gitea.test/owner/repo.git", "multica-bot", "", "https://gitea.test/owner/repo.git"},
		{"whitespace token treated as empty", "https://gitea.test/owner/repo.git", "multica-bot", "  ", "https://gitea.test/owner/repo.git"},
		{"unparseable URL returns input unchanged", "://bad", "bot", "tok", "://bad"},
		{"bot user trimmed", "https://gitea.test/o/r.git", "  bot  ", "t", "https://bot:t@gitea.test/o/r.git"},
		{"port preserved", "https://gitea.test:3000/owner/repo.git", "bot", "t", "https://bot:t@gitea.test:3000/owner/repo.git"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := injectGiteaToken(tt.cloneURL, tt.botUser, tt.token)
			if got != tt.want {
				t.Fatalf("injectGiteaToken(%q,%q,%q) = %q, want %q", tt.cloneURL, tt.botUser, tt.token, got, tt.want)
			}
		})
	}
}

func TestAppendDeliverablePrompt_CheckoutAndSubmit(t *testing.T) {
	refs := []giteaDeliverableRefJSON{{ID: "d1", Title: "Doc1", Path: "nodes/01-x/d1.md"}}
	got := appendDeliverablePrompt("base prompt", refs)
	for _, want := range []string{
		"git clone $CS_CLOUD_REPO_CLONE_URL_AUTHED",             // native git clone (agent does it itself)
		"CS_CLOUD_REPO_NODE_BRANCH",                             // per-node branch the agent checks out
		"CS_CLOUD_REPO_INST_BRANCH",                             // inst branch context (read path)
		"cs-cloud workflow deliverable submit --deliverable d1", // per-deliverable submit path
		"cs-workflow issue deliverables",                        // self-service read command
		"Document Deliverables",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("prompt missing %q:\n%s", want, got)
		}
	}
	// The dedicated `cs-cloud repo checkout` command is gone — the agent clones
	// with native git now.
	if strings.Contains(got, "cs-cloud repo checkout") {
		t.Errorf("prompt must NOT reference removed `cs-cloud repo checkout` command:\n%s", got)
	}
	if strings.Contains(got, "deliverable fetch") {
		t.Errorf("prompt must NOT reference fetch (command removed):\n%s", got)
	}
	if strings.Contains(got, "ask the user") {
		t.Errorf("prompt must NOT ask the user (use read commands instead):\n%s", got)
	}
}

// --- resolveCodeRepoAndProject tests ---

// resolveTestDB is a focused mock for resolveCodeRepoAndProject.
// It handles exactly three queries: GetWorkspace, GetIssue, ListProjectResources.
type resolveTestDB struct {
	workspace      *db.MulticaWorkspace
	issue          *db.MulticaIssue
	projResRows    []db.MulticaProjectResource
	cloudSkillRows []db.MulticaAgentCloudSkill
}

func (m *resolveTestDB) QueryRow(_ context.Context, sql string, _ ...interface{}) pgx.Row {
	switch {
	case strings.Contains(sql, "GetWorkspace"):
		if m.workspace != nil {
			return &resolveMockRow{workspace: m.workspace}
		}
		return &resolveMockRow{err: pgx.ErrNoRows}
	case strings.Contains(sql, "GetIssue"):
		if m.issue != nil {
			return &resolveMockRow{issue: m.issue}
		}
		return &resolveMockRow{err: pgx.ErrNoRows}
	default:
		return &resolveMockRow{err: pgx.ErrNoRows}
	}
}

func (m *resolveTestDB) Query(_ context.Context, sql string, _ ...interface{}) (pgx.Rows, error) {
	if strings.Contains(sql, "ListProjectResources") && m.projResRows != nil {
		return &mockRowsProjectResources{rows: m.projResRows, idx: -1}, nil
	}
	if strings.Contains(sql, "ListAgentCloudSkills") && m.cloudSkillRows != nil {
		return &mockRowsCloudSkills{rows: m.cloudSkillRows, idx: -1}, nil
	}
	return nil, pgx.ErrNoRows
}

func (m *resolveTestDB) Exec(_ context.Context, _ string, _ ...interface{}) (pgconn.CommandTag, error) {
	return pgconn.NewCommandTag(""), nil
}

type resolveMockRow struct {
	workspace *db.MulticaWorkspace
	issue     *db.MulticaIssue
	err       error
}

func (r *resolveMockRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if r.workspace != nil {
		return scanWorkspaceFull(r.workspace, dest)
	}
	if r.issue != nil {
		return scanIssueFull(r.issue, dest)
	}
	return nil
}

// scanWorkspaceFull scans all MulticaWorkspace fields (SELECT *).
func scanWorkspaceFull(w *db.MulticaWorkspace, dest []any) error {
	vals := []any{
		&w.ID, &w.Name, &w.Slug, &w.Description, &w.Settings,
		&w.CreatedAt, &w.UpdatedAt, &w.Context, &w.Repos,
		&w.IssuePrefix, &w.IssueCounter,
	}
	return copyRow(vals, dest)
}

// scanIssueFull scans all MulticaIssue fields (SELECT *).
// The existing scanIssue only goes up to UpdatedAt; this one includes
// Number, ProjectID, OriginType, OriginID, FirstExecutedAt, StartDate,
// Metadata, WorkflowID, WorkflowRunID, StageID.
func scanIssueFull(i *db.MulticaIssue, dest []any) error {
	vals := []any{
		&i.ID, &i.WorkspaceID, &i.Title, &i.Description, &i.Status,
		&i.Priority, &i.AssigneeType, &i.AssigneeID, &i.CreatorType,
		&i.CreatorID, &i.ParentIssueID, &i.AcceptanceCriteria,
		&i.ContextRefs, &i.Position, &i.DueDate, &i.CreatedAt,
		&i.UpdatedAt, &i.Number, &i.ProjectID, &i.OriginType,
		&i.OriginID, &i.FirstExecutedAt, &i.StartDate, &i.Metadata,
		&i.WorkflowID, &i.WorkflowRunID, &i.StageID,
	}
	return copyRow(vals, dest)
}

// mockRowsProjectResources is a pgx.Rows that yields pre-set
// MulticaProjectResource rows for ListProjectResources.
type mockRowsProjectResources struct {
	rows []db.MulticaProjectResource
	idx  int // starts at -1; Next() bumps to 0
}

func (m *mockRowsProjectResources) Next() bool                                   { m.idx++; return m.idx < len(m.rows) }
func (m *mockRowsProjectResources) Close()                                       {}
func (m *mockRowsProjectResources) Err() error                                   { return nil }
func (m *mockRowsProjectResources) CommandTag() pgconn.CommandTag                { return pgconn.NewCommandTag("") }
func (m *mockRowsProjectResources) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (m *mockRowsProjectResources) RawValues() [][]byte                          { return nil }
func (m *mockRowsProjectResources) Values() ([]any, error)                       { return nil, nil }
func (m *mockRowsProjectResources) Conn() *pgx.Conn                              { return nil }

func (m *mockRowsProjectResources) Scan(dest ...any) error {
	r := &m.rows[m.idx]
	vals := []any{
		&r.ID, &r.ProjectID, &r.WorkspaceID, &r.ResourceType,
		&r.ResourceRef, &r.Label, &r.Position, &r.CreatedAt, &r.CreatedBy,
	}
	return copyRow(vals, dest)
}

// mockRowsCloudSkills is a pgx.Rows that yields pre-set MulticaAgentCloudSkill
// rows for ListAgentCloudSkills (scan order matches the generated query).
type mockRowsCloudSkills struct {
	rows []db.MulticaAgentCloudSkill
	idx  int
}

func (m *mockRowsCloudSkills) Next() bool                                   { m.idx++; return m.idx < len(m.rows) }
func (m *mockRowsCloudSkills) Close()                                       {}
func (m *mockRowsCloudSkills) Err() error                                   { return nil }
func (m *mockRowsCloudSkills) CommandTag() pgconn.CommandTag                { return pgconn.NewCommandTag("") }
func (m *mockRowsCloudSkills) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (m *mockRowsCloudSkills) RawValues() [][]byte                          { return nil }
func (m *mockRowsCloudSkills) Values() ([]any, error)                       { return nil, nil }
func (m *mockRowsCloudSkills) Conn() *pgx.Conn                              { return nil }

func (m *mockRowsCloudSkills) Scan(dest ...any) error {
	r := &m.rows[m.idx]
	vals := []any{
		&r.AgentID, &r.CloudSkillID, &r.Slug, &r.Name, &r.Description,
		&r.Install, &r.Position, &r.CreatedAt, &r.UpdatedAt,
	}
	return copyRow(vals, dest)
}

func TestResolveCodeRepo_FallbackAllWorkspaceRepos(t *testing.T) {
	wsRepos, _ := json.Marshal([]struct{ URL string }{
		{URL: "https://gitlab.example.com/a/backend.git"},
		{URL: "https://gitlab.example.com/a/frontend.git"},
	})
	wsSettings, _ := json.Marshal(struct {
		GitlabAccessToken string `json:"gitlab_access_token"`
	}{GitlabAccessToken: "tok-abc"})
	mdb := &resolveTestDB{
		workspace: &db.MulticaWorkspace{
			ID:       testUUID(1),
			Repos:    wsRepos,
			Settings: wsSettings,
		},
		// issue without project -> fallback path
		issue: &db.MulticaIssue{ID: testUUID(5), WorkspaceID: testUUID(1)},
	}
	svc := &TaskService{Queries: db.New(mdb)}
	task := db.MulticaAgentTaskQueue{IssueID: testUUID(5)}

	repos, token, projectID := svc.resolveCodeRepoAndProject(context.Background(), task, testUUID(1))

	if token != "tok-abc" {
		t.Fatalf("gitlab token = %q, want tok-abc", token)
	}
	if projectID != "" {
		t.Fatalf("projectID = %q, want empty", projectID)
	}
	if len(repos) != 2 {
		t.Fatalf("repos count = %d, want 2", len(repos))
	}
	if repos[0].URL != "https://gitlab.example.com/a/backend.git" {
		t.Fatalf("repos[0].URL = %q", repos[0].URL)
	}
	if repos[1].URL != "https://gitlab.example.com/a/frontend.git" {
		t.Fatalf("repos[1].URL = %q", repos[1].URL)
	}
	for _, r := range repos {
		if r.Provider != "gitlab" {
			t.Fatalf("repo provider = %q, want gitlab", r.Provider)
		}
		if r.Role != "code" {
			t.Fatalf("repo role = %q, want code", r.Role)
		}
	}
}

func TestResolveCodeRepo_ProjectResourcesOverrideWorkspace(t *testing.T) {
	wsRepos, _ := json.Marshal([]struct{ URL string }{
		{URL: "https://gitlab.example.com/ws/old.git"},
	})
	wsSettings, _ := json.Marshal(struct {
		GitlabAccessToken string `json:"gitlab_access_token"`
	}{GitlabAccessToken: "tok-xyz"})
	projID := testUUID(10)
	mdb := &resolveTestDB{
		workspace: &db.MulticaWorkspace{
			ID:       testUUID(1),
			Repos:    wsRepos,
			Settings: wsSettings,
		},
		issue: &db.MulticaIssue{
			ID:          testUUID(5),
			WorkspaceID: testUUID(1),
			ProjectID:   projID,
		},
		projResRows: []db.MulticaProjectResource{
			{
				ResourceType: "github_repo",
				ResourceRef:  []byte(`{"url":"https://gitlab.example.com/p/repo-a.git"}`),
			},
			{
				ResourceType: "github_repo",
				ResourceRef:  []byte(`{"url":"https://gitlab.example.com/p/repo-b.git"}`),
			},
		},
	}
	svc := &TaskService{Queries: db.New(mdb)}
	task := db.MulticaAgentTaskQueue{IssueID: testUUID(5)}

	repos, token, projectID := svc.resolveCodeRepoAndProject(context.Background(), task, testUUID(1))

	if token != "tok-xyz" {
		t.Fatalf("gitlab token = %q, want tok-xyz", token)
	}
	if projectID != util.UUIDToString(projID) {
		t.Fatalf("projectID = %q, want %s", projectID, util.UUIDToString(projID))
	}
	if len(repos) != 2 {
		t.Fatalf("repos count = %d, want 2", len(repos))
	}
	if repos[0].URL != "https://gitlab.example.com/p/repo-a.git" {
		t.Fatalf("repos[0].URL = %q", repos[0].URL)
	}
	if repos[1].URL != "https://gitlab.example.com/p/repo-b.git" {
		t.Fatalf("repos[1].URL = %q", repos[1].URL)
	}
}

func TestResolveCodeRepo_ProjectNoGithubRepoFallsBackToWorkspace(t *testing.T) {
	wsRepos, _ := json.Marshal([]struct{ URL string }{
		{URL: "https://gitlab.example.com/ws/fallback.git"},
	})
	wsSettings, _ := json.Marshal(struct {
		GitlabAccessToken string `json:"gitlab_access_token"`
	}{GitlabAccessToken: "tok-fb"})
	projID := testUUID(10)
	mdb := &resolveTestDB{
		workspace: &db.MulticaWorkspace{
			ID:       testUUID(1),
			Repos:    wsRepos,
			Settings: wsSettings,
		},
		issue: &db.MulticaIssue{
			ID:          testUUID(5),
			WorkspaceID: testUUID(1),
			ProjectID:   projID,
		},
		// project has a resource but NOT github_repo -> should fallback
		projResRows: []db.MulticaProjectResource{
			{
				ResourceType: "link",
				ResourceRef:  []byte(`{"url":"https://wiki.example.com"}`),
			},
		},
	}
	svc := &TaskService{Queries: db.New(mdb)}
	task := db.MulticaAgentTaskQueue{IssueID: testUUID(5)}

	repos, token, projectID := svc.resolveCodeRepoAndProject(context.Background(), task, testUUID(1))

	if token != "tok-fb" {
		t.Fatalf("gitlab token = %q, want tok-fb", token)
	}
	if projectID != util.UUIDToString(projID) {
		t.Fatalf("projectID = %q, want %s", projectID, util.UUIDToString(projID))
	}
	// projectID is set from issue, but repos fall back to workspace
	if len(repos) != 1 {
		t.Fatalf("repos count = %d, want 1 (workspace fallback)", len(repos))
	}
	if repos[0].URL != "https://gitlab.example.com/ws/fallback.git" {
		t.Fatalf("repos[0].URL = %q", repos[0].URL)
	}
}

func TestResolveCodeRepo_NoIssueReturnsEmpty(t *testing.T) {
	wsRepos, _ := json.Marshal([]struct{ URL string }{
		{URL: "https://gitlab.example.com/a/repo.git"},
	})
	mdb := &resolveTestDB{
		workspace: &db.MulticaWorkspace{
			ID:    testUUID(1),
			Repos: wsRepos,
		},
		// no issue
	}
	svc := &TaskService{Queries: db.New(mdb)}
	task := db.MulticaAgentTaskQueue{} // IssueID not valid

	repos, token, projectID := svc.resolveCodeRepoAndProject(context.Background(), task, testUUID(1))

	if len(repos) != 1 {
		t.Fatalf("repos count = %d, want 1", len(repos))
	}
	if token != "" {
		t.Fatalf("token = %q, want empty", token)
	}
	if projectID != "" {
		t.Fatalf("projectID = %q, want empty", projectID)
	}
}

func TestAppendCodeRepoPrompt_MultiRepo(t *testing.T) {
	repos := []csCloudRepoSpec{
		{URL: "https://gitlab.example.com/a/backend.git", Alias: "后端"},
		{URL: "https://gitlab.example.com/a/frontend.git", Alias: "前端"},
	}
	got := appendCodeRepoPrompt("base", repos)
	// Both repos must be listed.
	if !strings.Contains(got, "后端") || !strings.Contains(got, "frontend.git") {
		t.Fatalf("prompt missing repo listing:\n%s", got)
	}
	// Must instruct CLI-based MR, not platform auto-MR.
	if !strings.Contains(got, "cs-cloud workflow deliverable submit --repo") {
		t.Fatalf("prompt missing CLI submit instruction:\n%s", got)
	}
	if !strings.Contains(got, "--mr") {
		t.Fatalf("prompt missing --mr flag:\n%s", got)
	}
	if strings.Contains(got, "平台会自动") || strings.Contains(got, "平台自动提交") {
		t.Fatalf("prompt must NOT say platform auto-MR (old wording):\n%s", got)
	}
}

func TestAppendCodeRepoPrompt_NoAliasFallsBackToURL(t *testing.T) {
	repos := []csCloudRepoSpec{
		{URL: "https://gitlab.example.com/a/r.git"},
	}
	got := appendCodeRepoPrompt("", repos)
	if !strings.Contains(got, "https://gitlab.example.com/a/r.git") {
		t.Fatalf("prompt missing URL when no alias:\n%s", got)
	}
}

type workflowSourceIssuePromptDB struct {
	nodeRun db.MulticaWorkflowNodeRun
	run     db.MulticaWorkflowRun
	issue   db.MulticaIssue
}

func (m *workflowSourceIssuePromptDB) QueryRow(_ context.Context, sql string, _ ...interface{}) pgx.Row {
	switch {
	case strings.Contains(sql, "GetWorkflowNodeRun"):
		return &workflowSourceIssuePromptRow{nodeRun: &m.nodeRun}
	case strings.Contains(sql, "GetWorkflowRun"):
		return &workflowSourceIssuePromptRow{run: &m.run}
	case strings.Contains(sql, "GetIssue"):
		return &workflowSourceIssuePromptRow{issue: &m.issue}
	default:
		return &workflowSourceIssuePromptRow{err: pgx.ErrNoRows}
	}
}

func (m *workflowSourceIssuePromptDB) Query(_ context.Context, _ string, _ ...interface{}) (pgx.Rows, error) {
	return nil, pgx.ErrNoRows
}

func (m *workflowSourceIssuePromptDB) Exec(_ context.Context, _ string, _ ...interface{}) (pgconn.CommandTag, error) {
	return pgconn.NewCommandTag(""), nil
}

type workflowSourceIssuePromptRow struct {
	nodeRun *db.MulticaWorkflowNodeRun
	run     *db.MulticaWorkflowRun
	issue   *db.MulticaIssue
	err     error
}

func (r *workflowSourceIssuePromptRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	switch {
	case r.nodeRun != nil:
		return scanNodeRun(r.nodeRun, dest)
	case r.run != nil:
		return scanWorkflowRun(r.run, dest)
	case r.issue != nil:
		return scanIssueFull(r.issue, dest)
	default:
		return nil
	}
}

func TestBuildCSCloudPrompt_WorkflowTaskUsesSourceIssueWhenTaskIssueMissing(t *testing.T) {
	nodeRunID := testUUID(30)
	runID := testUUID(31)
	sourceIssueID := testUUID(32)
	description := "Say hello and nothing else.\n\nReturn exactly: Hello"
	mdb := &workflowSourceIssuePromptDB{
		nodeRun: db.MulticaWorkflowNodeRun{
			ID:            nodeRunID,
			WorkflowRunID: runID,
			NodeTitle:     "Worker Node",
		},
		run: db.MulticaWorkflowRun{
			ID:            runID,
			SourceIssueID: sourceIssueID,
		},
		issue: db.MulticaIssue{
			ID:          sourceIssueID,
			Title:       "Say Hello Only",
			Description: pgtype.Text{String: description, Valid: true},
		},
	}
	svc := &TaskService{Queries: db.New(mdb)}
	task := db.MulticaAgentTaskQueue{WorkflowNodeRunID: nodeRunID}

	got, err := svc.buildCSCloudPrompt(context.Background(), task, "direct")
	if err != nil {
		t.Fatalf("buildCSCloudPrompt: %v", err)
	}
	if !strings.Contains(got, "Issue: Say Hello Only") {
		t.Fatalf("prompt missing source issue title:\n%s", got)
	}
	if !strings.Contains(got, description) {
		t.Fatalf("prompt missing full source issue description:\n%s", got)
	}
}

// --- deliverableSpecsForTask tests ---

// deliverableTestDB is a focused mock for deliverableSpecsForTask.
// It handles GetWorkflowNodeRun and ListWorkflowNodeDeliverables.
type deliverableTestDB struct {
	nodeRun      *db.MulticaWorkflowNodeRun
	deliverables []db.MulticaWorkflowNodeDeliverable
}

func (m *deliverableTestDB) QueryRow(_ context.Context, sql string, _ ...interface{}) pgx.Row {
	if strings.Contains(sql, "GetWorkflowNodeRun") {
		if m.nodeRun != nil {
			return &deliverableMockRow{nodeRun: m.nodeRun}
		}
		return &deliverableMockRow{err: pgx.ErrNoRows}
	}
	return &deliverableMockRow{err: pgx.ErrNoRows}
}

func (m *deliverableTestDB) Query(_ context.Context, sql string, _ ...interface{}) (pgx.Rows, error) {
	if strings.Contains(sql, "ListWorkflowNodeDeliverables") {
		if m.deliverables != nil {
			return &mockRowsDeliverables{rows: m.deliverables, idx: -1}, nil
		}
	}
	return nil, pgx.ErrNoRows
}

func (m *deliverableTestDB) Exec(_ context.Context, _ string, _ ...interface{}) (pgconn.CommandTag, error) {
	return pgconn.NewCommandTag(""), nil
}

type deliverableMockRow struct {
	nodeRun *db.MulticaWorkflowNodeRun
	err     error
}

func (r *deliverableMockRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if r.nodeRun != nil {
		return scanNodeRun(r.nodeRun, dest)
	}
	return nil
}

// scanNodeRun scans all MulticaWorkflowNodeRun fields (SELECT *).
func scanNodeRun(nr *db.MulticaWorkflowNodeRun, dest []any) error {
	vals := []any{
		&nr.ID, &nr.WorkflowRunID, &nr.WorkflowNodeID, &nr.NodeTitle,
		&nr.Status, &nr.RetryCount, &nr.WorkerType, &nr.WorkerID,
		&nr.WorkerOutput, &nr.CriticType, &nr.CriticID, &nr.CriticOutput,
		&nr.CriticComment, &nr.AgentTaskID, &nr.StartedAt, &nr.CompletedAt,
		&nr.CreatedAt, &nr.UpdatedAt, &nr.WorkerAgentTaskID,
		&nr.CriticAgentTaskID, &nr.RuntimeID, &nr.DeviceID, &nr.SessionID,
		&nr.SplitReviewChatSessionID, &nr.RuntimeSelectionReason,
		&nr.FailureReason, &nr.SplitConfigVersion,
	}
	return copyRow(vals, dest)
}

// mockRowsDeliverables is a pgx.Rows that yields pre-set
// MulticaWorkflowNodeDeliverable rows.
type mockRowsDeliverables struct {
	rows []db.MulticaWorkflowNodeDeliverable
	idx  int
}

func (m *mockRowsDeliverables) Next() bool                                   { m.idx++; return m.idx < len(m.rows) }
func (m *mockRowsDeliverables) Close()                                       {}
func (m *mockRowsDeliverables) Err() error                                   { return nil }
func (m *mockRowsDeliverables) CommandTag() pgconn.CommandTag                { return pgconn.NewCommandTag("") }
func (m *mockRowsDeliverables) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (m *mockRowsDeliverables) RawValues() [][]byte                          { return nil }
func (m *mockRowsDeliverables) Values() ([]any, error)                       { return nil, nil }
func (m *mockRowsDeliverables) Conn() *pgx.Conn                              { return nil }

func (m *mockRowsDeliverables) Scan(dest ...any) error {
	r := &m.rows[m.idx]
	vals := []any{
		&r.ID, &r.WorkflowNodeID, &r.Kind, &r.Title,
		&r.Description, &r.Required, &r.SortOrder,
		&r.CreatedAt, &r.UpdatedAt,
	}
	return copyRow(vals, dest)
}

// mockRowsNodeRunDeliverables is a pgx.Rows that yields pre-set
// MulticaWorkflowNodeRunDeliverable rows.
type mockRowsNodeRunDeliverables struct {
	rows []db.MulticaWorkflowNodeRunDeliverable
	idx  int
}

func (m *mockRowsNodeRunDeliverables) Next() bool { m.idx++; return m.idx < len(m.rows) }
func (m *mockRowsNodeRunDeliverables) Close()     {}
func (m *mockRowsNodeRunDeliverables) Err() error { return nil }
func (m *mockRowsNodeRunDeliverables) CommandTag() pgconn.CommandTag {
	return pgconn.NewCommandTag("")
}
func (m *mockRowsNodeRunDeliverables) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (m *mockRowsNodeRunDeliverables) RawValues() [][]byte                          { return nil }
func (m *mockRowsNodeRunDeliverables) Values() ([]any, error)                       { return nil, nil }
func (m *mockRowsNodeRunDeliverables) Conn() *pgx.Conn                              { return nil }

func (m *mockRowsNodeRunDeliverables) Scan(dest ...any) error {
	r := &m.rows[m.idx]
	vals := []any{
		&r.ID, &r.WorkflowNodeRunID, &r.SourceDeliverableID,
		&r.Kind, &r.Title, &r.Description, &r.Required,
		&r.SortOrder, &r.CreatedAt,
	}
	return copyRow(vals, dest)
}

func TestDeliverableSpecsForTask_PullRequestAndDocument(t *testing.T) {
	nrID := testUUID(100)
	prDeliverable := db.MulticaWorkflowNodeDeliverable{
		ID:             testUUID(50),
		WorkflowNodeID: testUUID(60),
		Kind:           "pull_request",
		Title:          "Code PR",
		Required:       true,
	}
	docDeliverable := db.MulticaWorkflowNodeDeliverable{
		ID:             testUUID(51),
		WorkflowNodeID: testUUID(60),
		Kind:           "document",
		Title:          "Design Doc",
		Required:       true,
	}
	mdb := &deliverableTestDB{
		nodeRun: &db.MulticaWorkflowNodeRun{
			ID:             nrID,
			WorkflowNodeID: testUUID(60),
		},
		deliverables: []db.MulticaWorkflowNodeDeliverable{prDeliverable, docDeliverable},
	}
	svc := &TaskService{Queries: db.New(mdb)}
	task := db.MulticaAgentTaskQueue{WorkflowNodeRunID: pgtype.UUID{Bytes: nrID.Bytes, Valid: true}}

	got := svc.deliverableSpecsForTask(context.Background(), task)

	if len(got) != 2 {
		t.Fatalf("deliverables count = %d, want 2", len(got))
	}
	// pull_request -> /submit endpoint
	if got[0].Kind != "pull_request" {
		t.Fatalf("got[0].Kind = %q, want pull_request", got[0].Kind)
	}
	if !strings.Contains(got[0].Report.Endpoint, "/submit") {
		t.Fatalf("pull_request endpoint = %q, want /submit", got[0].Report.Endpoint)
	}
	if got[0].Report.Method != "POST" {
		t.Fatalf("pull_request method = %q, want POST", got[0].Report.Method)
	}
	if got[0].Report.BodyField != "pull_request_url" {
		t.Fatalf("pull_request body_field = %q, want pull_request_url", got[0].Report.BodyField)
	}
	// document -> /report-pr endpoint
	if got[1].Kind != "document" {
		t.Fatalf("got[1].Kind = %q, want document", got[1].Kind)
	}
	if !strings.Contains(got[1].Report.Endpoint, "/report-pr") {
		t.Fatalf("document endpoint = %q, want /report-pr", got[1].Report.Endpoint)
	}
	// Both should contain the node-run ID.
	nrIDStr := util.UUIDToString(nrID)
	if !strings.Contains(got[0].Report.Endpoint, nrIDStr) {
		t.Fatalf("pull_request endpoint missing node-run ID: %q", got[0].Report.Endpoint)
	}
	if !strings.Contains(got[1].Report.Endpoint, nrIDStr) {
		t.Fatalf("document endpoint missing node-run ID: %q", got[1].Report.Endpoint)
	}
}

func TestDeliverableSpecsForTask_NoNodeRunID(t *testing.T) {
	mdb := &deliverableTestDB{}
	svc := &TaskService{Queries: db.New(mdb)}
	task := db.MulticaAgentTaskQueue{} // WorkflowNodeRunID not valid

	got := svc.deliverableSpecsForTask(context.Background(), task)
	if got != nil {
		t.Fatalf("expected nil when no node run ID, got %+v", got)
	}
}

func TestDeliverableSpecsForTask_NodeRunNotFound(t *testing.T) {
	mdb := &deliverableTestDB{} // nodeRun is nil -> ErrNoRows
	svc := &TaskService{Queries: db.New(mdb)}
	task := db.MulticaAgentTaskQueue{WorkflowNodeRunID: testUUID(100)}

	got := svc.deliverableSpecsForTask(context.Background(), task)
	if got != nil {
		t.Fatalf("expected nil when node run not found, got %+v", got)
	}
}

func TestCsCloudPayloadSerializesReposAndDeliverables(t *testing.T) {
	payload := csCloudTaskRunPayload{
		TaskID: "t-1", WorkspaceID: "ws", Agent: "csc", Prompt: "p",
		Repos: []csCloudRepoSpec{
			{URL: "https://gitlab.example.com/o/r.git", Provider: "gitlab", Role: "code", BaseBranch: "main", Alias: "后端"},
		},
		Deliverables: []csCloudDeliverableSpec{
			{ID: "d1", Kind: "pull_request", RepoAlias: "后端", Report: csCloudReportSpec{Endpoint: "https://example.com/report", Method: "POST", BodyField: "content"}},
		},
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got csCloudTaskRunPayload
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(got.Repos) != 1 || got.Repos[0].URL != "https://gitlab.example.com/o/r.git" {
		t.Errorf("repos round-trip mismatch: %+v", got.Repos)
	}
	if len(got.Deliverables) != 1 || got.Deliverables[0].Kind != "pull_request" {
		t.Errorf("deliverables round-trip mismatch: %+v", got.Deliverables)
	}
}

func TestCsCloudPayloadSerializesPriorSession(t *testing.T) {
	payload := csCloudTaskRunPayload{
		TaskID: "t-1", WorkspaceID: "ws", Agent: "csc", Prompt: "p",
		PriorSessionID: "sess-abc",
		PriorWorkDir:   "/data/work/ws/tasks/t-1",
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got csCloudTaskRunPayload
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.PriorSessionID != "sess-abc" {
		t.Errorf("prior_session_id round-trip: %q", got.PriorSessionID)
	}
	if got.PriorWorkDir != "/data/work/ws/tasks/t-1" {
		t.Errorf("prior_work_dir round-trip: %q", got.PriorWorkDir)
	}
}

func TestShouldSkipPriorTaskState(t *testing.T) {
	// ForceFreshSession (manual rerun) => skip prior, fresh session.
	if !shouldSkipPriorTaskState(db.MulticaAgentTaskQueue{ForceFreshSession: true}) {
		t.Error("ForceFreshSession=true should skip prior")
	}
	// Normal task => keep prior.
	if shouldSkipPriorTaskState(db.MulticaAgentTaskQueue{ForceFreshSession: false}) {
		t.Error("ForceFreshSession=false should keep prior")
	}
}

func TestBuildCSCloudPayload_InjectsPriorSession(t *testing.T) {
	agentID := testUUID(0xA1)
	issueID := testUUID(0xB2)
	runtimeID := testUUID(0xC3)
	dbtx := newPushTestDB(csCloudProvider, "device-123")
	dbtx.lastSessionRow = &db.GetLastTaskSessionRow{
		SessionID: pgtype.Text{String: "sess-prior", Valid: true},
		WorkDir:   pgtype.Text{String: "/prior/work", Valid: true},
		RuntimeID: runtimeID, // same runtime
	}
	svc := &TaskService{Queries: db.New(dbtx), Bus: events.New()}
	task := dbtx.dispatchedResult
	task.AgentID = agentID
	task.IssueID = issueID
	task.RuntimeID = runtimeID

	payload, err := svc.buildCSCloudPayload(context.Background(), task, dbtx.runtime)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if payload.PriorSessionID != "sess-prior" {
		t.Errorf("prior_session_id = %q, want sess-prior", payload.PriorSessionID)
	}
	if payload.PriorWorkDir != "/prior/work" {
		t.Errorf("prior_work_dir = %q, want /prior/work", payload.PriorWorkDir)
	}
}

func TestBuildCSCloudPayload_PriorSessionRuntimeMismatch(t *testing.T) {
	// prior on a different runtime (device) => PriorSessionID NOT injected (session is device-scoped),
	// but PriorWorkDir IS still injected (a missing dir on another device just falls back to fresh Prepare).
	dbtx := newPushTestDB(csCloudProvider, "device-123")
	dbtx.lastSessionRow = &db.GetLastTaskSessionRow{
		SessionID: pgtype.Text{String: "sess-prior", Valid: true},
		WorkDir:   pgtype.Text{String: "/prior/work", Valid: true},
		RuntimeID: testUUID(0xDD), // different runtime
	}
	svc := &TaskService{Queries: db.New(dbtx), Bus: events.New()}
	task := dbtx.dispatchedResult
	task.AgentID = testUUID(0xA1)
	task.IssueID = testUUID(0xB2)
	task.RuntimeID = testUUID(0xC3)

	payload, err := svc.buildCSCloudPayload(context.Background(), task, dbtx.runtime)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if payload.PriorSessionID != "" {
		t.Errorf("prior_session_id = %q, want empty (runtime mismatch)", payload.PriorSessionID)
	}
	if payload.PriorWorkDir != "/prior/work" {
		t.Errorf("prior_work_dir = %q, want /prior/work (forwarded regardless)", payload.PriorWorkDir)
	}
}

func TestBuildCSCloudPayload_ForceFreshSessionSkipsPrior(t *testing.T) {
	dbtx := newPushTestDB(csCloudProvider, "device-123")
	dbtx.lastSessionRow = &db.GetLastTaskSessionRow{
		SessionID: pgtype.Text{String: "sess-prior", Valid: true},
		WorkDir:   pgtype.Text{String: "/prior/work", Valid: true},
		RuntimeID: testUUID(0xC3),
	}
	svc := &TaskService{Queries: db.New(dbtx), Bus: events.New()}
	task := dbtx.dispatchedResult
	task.AgentID = testUUID(0xA1)
	task.IssueID = testUUID(0xB2)
	task.RuntimeID = testUUID(0xC3)
	task.ForceFreshSession = true // manual rerun

	payload, err := svc.buildCSCloudPayload(context.Background(), task, dbtx.runtime)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if payload.PriorSessionID != "" || payload.PriorWorkDir != "" {
		t.Errorf("force fresh should skip prior; got session=%q workdir=%q", payload.PriorSessionID, payload.PriorWorkDir)
	}
}

func TestBuildCSCloudPayload_NoPriorWhenGetLastReturnsNoRows(t *testing.T) {
	// GetLastTaskSession no hit (first round / all poisoned failures) => both prior empty.
	dbtx := newPushTestDB(csCloudProvider, "device-123")
	dbtx.lastSessionRow = nil // => ErrNoRows
	svc := &TaskService{Queries: db.New(dbtx), Bus: events.New()}
	task := dbtx.dispatchedResult
	task.AgentID = testUUID(0xA1)
	task.IssueID = testUUID(0xB2)
	task.RuntimeID = testUUID(0xC3)

	payload, err := svc.buildCSCloudPayload(context.Background(), task, dbtx.runtime)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if payload.PriorSessionID != "" || payload.PriorWorkDir != "" {
		t.Errorf("no prior expected; got session=%q workdir=%q", payload.PriorSessionID, payload.PriorWorkDir)
	}
}

func TestBuildCSCloudPayload_QuickCreateResolvesAgentPlugin(t *testing.T) {
	dbtx := newPushTestDB(csCloudProvider, "device-123")
	dbtx.agentPluginName = pgtype.Text{String: "cospowers-requirements", Valid: true}

	svc := &TaskService{
		Queries:                  db.New(dbtx),
		Bus:                      events.New(),
		CSCPluginMarketplaceName: "costrict-plugins",
		CSCPluginMarketplaceRepo: "https://zgsmtest.xyz:30443/costrict-plugin-marketplace/marketplace.git",
	}
	task := dbtx.dispatchedResult
	task.IssueID = pgtype.UUID{}
	task.WorkflowNodeRunID = pgtype.UUID{}
	task.Context = []byte(`{"type":"quick_create","prompt":"create a tiny local e2e issue","workspace_id":"` + util.UUIDToString(dbtx.runtime.WorkspaceID) + `","requester_id":"` + util.UUIDToString(testUUID(9)) + `"}`)

	payload, err := svc.buildCSCloudPayload(context.Background(), task, dbtx.runtime)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if payload.Plugin == nil || payload.Plugin.Install == nil {
		t.Fatalf("quick-create payload should include agent plugin; got %+v", payload.Plugin)
	}
	if payload.Plugin.Install.PluginName != "cospowers-requirements" {
		t.Errorf("plugin_name = %q, want cospowers-requirements", payload.Plugin.Install.PluginName)
	}
	if payload.Plugin.Install.MarketplaceRepo != "https://zgsmtest.xyz:30443/costrict-plugin-marketplace/marketplace.git" {
		t.Errorf("marketplace_repo = %q", payload.Plugin.Install.MarketplaceRepo)
	}
}

func TestBuildCSCloudPayload_CriticResolvesAgentPlugin(t *testing.T) {
	dbtx := newPushTestDB(csCloudProvider, "device-123")
	dbtx.agentPluginName = pgtype.Text{String: "cospowers-integration-verification", Valid: true}

	svc := &TaskService{
		Queries:                  db.New(dbtx),
		Bus:                      events.New(),
		CSCPluginMarketplaceName: "costrict-plugins",
		CSCPluginMarketplaceRepo: "https://zgsmtest.xyz:30443/costrict-plugin-marketplace/marketplace.git",
	}
	task := dbtx.dispatchedResult
	task.Context = []byte(`{"phase":"critic"}`)

	payload, err := svc.buildCSCloudPayload(context.Background(), task, dbtx.runtime)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if payload.Plugin == nil || payload.Plugin.Install == nil {
		t.Fatalf("critic payload should include agent plugin; got %+v", payload.Plugin)
	}
	if payload.Plugin.Install.PluginName != "cospowers-integration-verification" {
		t.Errorf("plugin_name = %q, want cospowers-integration-verification", payload.Plugin.Install.PluginName)
	}
}

// --- node-run handback fallback (M2.5 Task 4) tests ---
//
// Workflow tasks with IssueID NULL can't use GetLastTaskSession (it keys on
// (agent, issue)). When a human takes over a node and hands it back, the bound
// CSC session on the node_run is the canonical resume pointer. The fallback
// reads GetWorkflowNodeRun and injects its SessionID when the runtime matches
// (a session is device-scoped). Ported from handler/daemon.go (pull path).

func TestBuildCSCloudPayload_NodeRunHandbackFallback(t *testing.T) {
	// Workflow task with IssueID NULL: GetLastTaskSession block is gated on
	// task.IssueID.Valid, so it skips and priorSessionID stays "". The fallback
	// reads the node-run's bound session and injects it (runtime matches).
	runtimeID := testUUID(0xC3)
	dbtx := newPushTestDB(csCloudProvider, "device-123")
	dbtx.nodeRunRow = &db.MulticaWorkflowNodeRun{
		ID:        testUUID(6),
		SessionID: pgtype.Text{String: "sess-noderun", Valid: true},
		RuntimeID: runtimeID, // matches task.RuntimeID
	}
	svc := &TaskService{Queries: db.New(dbtx), Bus: events.New()}
	task := dbtx.dispatchedResult
	task.AgentID = testUUID(0xA1)
	task.IssueID = pgtype.UUID{} // NULL — workflow task, GetLastTaskSession can't apply
	task.RuntimeID = runtimeID
	task.WorkflowNodeRunID = testUUID(6)

	payload, err := svc.buildCSCloudPayload(context.Background(), task, dbtx.runtime)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if payload.PriorSessionID != "sess-noderun" {
		t.Errorf("prior_session_id = %q, want sess-noderun (node-run handback)", payload.PriorSessionID)
	}
}

func TestBuildCSCloudPayload_NodeRunHandback_RuntimeMismatch(t *testing.T) {
	// Device-scoping: a csc session on device A cannot be resumed on device B.
	// node-run's RuntimeID differs from task.RuntimeID → no inject.
	dbtx := newPushTestDB(csCloudProvider, "device-123")
	dbtx.nodeRunRow = &db.MulticaWorkflowNodeRun{
		ID:        testUUID(6),
		SessionID: pgtype.Text{String: "sess-other-device", Valid: true},
		RuntimeID: testUUID(0xDD), // different runtime/device
	}
	svc := &TaskService{Queries: db.New(dbtx), Bus: events.New()}
	task := dbtx.dispatchedResult
	task.AgentID = testUUID(0xA1)
	task.IssueID = pgtype.UUID{} // NULL
	task.RuntimeID = testUUID(0xC3)
	task.WorkflowNodeRunID = testUUID(6)

	payload, err := svc.buildCSCloudPayload(context.Background(), task, dbtx.runtime)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if payload.PriorSessionID != "" {
		t.Errorf("prior_session_id = %q, want empty (runtime mismatch — session is device-scoped)", payload.PriorSessionID)
	}
}

func TestBuildCSCloudPayload_NodeRunHandback_ForceFreshSessionSkips(t *testing.T) {
	// ForceFreshSession (manual rerun) must start a fresh session — the
	// fallback's !shouldSkipPriorTaskState guard blocks the inject. Mirrors
	// daemon.go, where the whole prior-session block (handback included) sits
	// under !shouldSkipPriorTaskState.
	runtimeID := testUUID(0xC3)
	dbtx := newPushTestDB(csCloudProvider, "device-123")
	dbtx.nodeRunRow = &db.MulticaWorkflowNodeRun{
		ID:        testUUID(6),
		SessionID: pgtype.Text{String: "sess-noderun", Valid: true},
		RuntimeID: runtimeID, // matches
	}
	svc := &TaskService{Queries: db.New(dbtx), Bus: events.New()}
	task := dbtx.dispatchedResult
	task.AgentID = testUUID(0xA1)
	task.IssueID = pgtype.UUID{} // NULL
	task.RuntimeID = runtimeID
	task.WorkflowNodeRunID = testUUID(6)
	task.ForceFreshSession = true // manual rerun — must NOT resume

	payload, err := svc.buildCSCloudPayload(context.Background(), task, dbtx.runtime)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if payload.PriorSessionID != "" {
		t.Errorf("prior_session_id = %q, want empty (ForceFreshSession must skip handback)", payload.PriorSessionID)
	}
}

func TestBuildCSCloudPayload_NodeRunHandback_DoesNotOverrideGetLastTaskSession(t *testing.T) {
	// Precedence: when BOTH GetLastTaskSession and the node-run carry a matching-
	// runtime session, GetLastTaskSession wins. The fallback's `priorSessionID
	// == ""` guard is the ONLY thing enforcing this — without it, the node-run
	// session would overwrite a valid (agent, issue) session. This test pins
	// that precedence so a future refactor dropping the guard fails loudly.
	runtimeID := testUUID(0xC3)
	dbtx := newPushTestDB(csCloudProvider, "device-123")
	dbtx.lastSessionRow = &db.GetLastTaskSessionRow{
		SessionID: pgtype.Text{String: "sess-lasttask", Valid: true},
		RuntimeID: runtimeID, // matches task.RuntimeID
	}
	dbtx.nodeRunRow = &db.MulticaWorkflowNodeRun{
		ID:        testUUID(6),
		SessionID: pgtype.Text{String: "sess-noderun", Valid: true},
		RuntimeID: runtimeID, // also matches — would inject if guard were gone
	}
	svc := &TaskService{Queries: db.New(dbtx), Bus: events.New()}
	task := dbtx.dispatchedResult
	task.AgentID = testUUID(0xA1)
	task.IssueID = testUUID(0xB2) // valid → GetLastTaskSession block fires
	task.RuntimeID = runtimeID
	task.WorkflowNodeRunID = testUUID(6)

	payload, err := svc.buildCSCloudPayload(context.Background(), task, dbtx.runtime)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if payload.PriorSessionID != "sess-lasttask" {
		t.Errorf("prior_session_id = %q, want sess-lasttask (GetLastTaskSession must take precedence over node-run handback)", payload.PriorSessionID)
	}
}

// --- buildCSCloudPayload safety-net (M2.5 Task 2) tests ---
//
// The safety net ensures a Gitea wf repo + inst branch exist for document
// deliverables at dispatch time, as a fallback for when run-start
// ScaffoldRunDeliverables failed or was skipped. It fires when ALL hold:
// phase=worker, the node has a document deliverable, the team-namespace client
// is configured, AND workspace.settings lack Gitea provisioning data. The test
// mocks the DB query chain buildCSCloudPayload walks + an httptest server
// standing in for the costrict team-namespace service (recording the
// interface-8 InitWorkflow POST).

// ensureRepoTestDB mocks the full query chain the safety net exercises:
// GetAgent, GetIssue, GetWorkspace, GetWorkflowNodeRun, GetWorkflowRun,
// GetWorkflow, GetWorkflowNode, GetLastTaskSession, ListProjectResources,
// ListWorkflowNodeDeliverables, ListWorkflowNodes, ListWorkflowEdges,
// ListMembersWithUser, UpdateWorkspace.
type ensureRepoTestDB struct {
	runtime             db.MulticaAgentRuntime
	agent               db.MulticaAgent
	issue               db.MulticaIssue
	workspace           db.MulticaWorkspace
	nodeRun             db.MulticaWorkflowNodeRun
	run                 db.MulticaWorkflowRun
	workflow            db.MulticaWorkflow
	node                db.MulticaWorkflowNode
	deliverables        []db.MulticaWorkflowNodeDeliverable
	nodeRunDeliverables []db.MulticaWorkflowNodeRunDeliverable
	members             []db.ListMembersWithUserRow
	definitionSnapshot  []byte

	mu           sync.Mutex
	updateCount  int
	lastSettings []byte
}

func (m *ensureRepoTestDB) QueryRow(_ context.Context, sql string, args ...interface{}) pgx.Row {
	switch {
	// Must precede GetWorkflowRun — "GetWorkflowRun" is a substring of
	// "GetWorkflowRunDefinitionSnapshot", so the broader case would shadow it.
	case strings.Contains(sql, "GetWorkflowRunDefinitionSnapshot"):
		return &ensureRepoRow{snapshot: &db.GetWorkflowRunDefinitionSnapshotRow{
			DefinitionSchemaVersion: WorkflowDefinitionSchemaVersion,
			DefinitionSnapshot:      m.definitionSnapshot,
		}}
	case strings.Contains(sql, "GetAgentRuntime"):
		return &ensureRepoRow{runtime: &m.runtime}
	case strings.Contains(sql, "GetAgent "):
		return &ensureRepoRow{agent: &m.agent}
	case strings.Contains(sql, "GetIssue"):
		return &ensureRepoRow{issue: &m.issue}
	case strings.Contains(sql, "GetWorkflowNodeRun"):
		return &ensureRepoRow{nodeRun: &m.nodeRun}
	case strings.Contains(sql, "GetWorkflowNode"): // must be after GetWorkflowNodeRun
		return &ensureRepoRow{node: &m.node}
	case strings.Contains(sql, "GetWorkflowRun"):
		return &ensureRepoRow{run: &m.run}
	case strings.Contains(sql, "GetWorkflow "): // "GetWorkflow :one" (not GetWorkflowRun/Node)
		return &ensureRepoRow{workflow: &m.workflow}
	case strings.Contains(sql, "GetWorkspace"):
		return &ensureRepoRow{workspace: &m.workspace}
	case strings.Contains(sql, "UpdateWorkspace"):
		// UpdateWorkspaceParams positional order:
		// ID, Name, Description, Context, Settings, Repos, IssuePrefix.
		if len(args) >= 5 {
			if settings, ok := args[4].([]byte); ok {
				m.mu.Lock()
				m.updateCount++
				m.lastSettings = append([]byte(nil), settings...)
				m.mu.Unlock()
			}
		}
		return &ensureRepoRow{workspace: &m.workspace}
	case strings.Contains(sql, "GetLastTaskSession"):
		return &ensureRepoRow{err: pgx.ErrNoRows}
	case strings.Contains(sql, "GetComment"):
		return &ensureRepoRow{err: pgx.ErrNoRows}
	case strings.Contains(sql, "GetAutopilotRun"):
		return &ensureRepoRow{err: pgx.ErrNoRows}
	default:
		return &ensureRepoRow{err: pgx.ErrNoRows}
	}
}

func (m *ensureRepoTestDB) Query(_ context.Context, sql string, _ ...interface{}) (pgx.Rows, error) {
	switch {
	// RunNodeTopoOrder feeds: node runs (single-node graph) + run edges (none).
	// Both must precede ListWorkflowNodes/ListWorkflowEdges so the Run-scoped
	// names aren't shadowed by their generic counterparts.
	case strings.Contains(sql, "ListWorkflowNodeRunsByRun"):
		return &mockRowsNodeRuns{rows: []db.MulticaWorkflowNodeRun{m.nodeRun}, idx: -1}, nil
	case strings.Contains(sql, "ListWorkflowRunEdges"):
		return &mockRowsWorkflowEdges{idx: -1}, nil
	case strings.Contains(sql, "ListProjectResources"):
		return &mockRowsProjectResources{rows: nil, idx: -1}, nil
	case strings.Contains(sql, "ListWorkflowNodeDeliverables"):
		return &mockRowsDeliverables{rows: m.deliverables, idx: -1}, nil
	case strings.Contains(sql, "ListNodeRunDeliverableRequirements"):
		return &mockRowsNodeRunDeliverables{rows: m.nodeRunDeliverables, idx: -1}, nil
	case strings.Contains(sql, "ListWorkflowNodes"):
		return &mockRowsWorkflowNodes{rows: []db.MulticaWorkflowNode{m.node}, idx: -1}, nil
	case strings.Contains(sql, "ListWorkflowEdges"):
		return &mockRowsWorkflowEdges{idx: -1}, nil // no edges: single-node workflow
	case strings.Contains(sql, "ListMembersWithUser"):
		return &mockRowsMembers{rows: m.members, idx: -1}, nil
	default:
		return nil, pgx.ErrNoRows
	}
}

func (m *ensureRepoTestDB) Exec(_ context.Context, _ string, _ ...interface{}) (pgconn.CommandTag, error) {
	return pgconn.NewCommandTag(""), nil
}

type ensureRepoRow struct {
	runtime   *db.MulticaAgentRuntime
	agent     *db.MulticaAgent
	issue     *db.MulticaIssue
	workspace *db.MulticaWorkspace
	nodeRun   *db.MulticaWorkflowNodeRun
	run       *db.MulticaWorkflowRun
	workflow  *db.MulticaWorkflow
	node      *db.MulticaWorkflowNode
	snapshot  *db.GetWorkflowRunDefinitionSnapshotRow
	err       error
}

func (r *ensureRepoRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	switch {
	case r.snapshot != nil:
		// GetWorkflowRunDefinitionSnapshot scans (schema_version, snapshot_json).
		if len(dest) >= 2 {
			if p, ok := dest[0].(*int32); ok {
				*p = r.snapshot.DefinitionSchemaVersion
			}
			if p, ok := dest[1].(*[]byte); ok {
				*p = r.snapshot.DefinitionSnapshot
			}
		}
		return nil
	case r.runtime != nil:
		return scanRuntime(r.runtime, dest)
	case r.agent != nil:
		return scanAgent(r.agent, dest)
	case r.issue != nil:
		return scanIssueFull(r.issue, dest)
	case r.workspace != nil:
		return scanWorkspaceFull(r.workspace, dest)
	case r.nodeRun != nil:
		return scanNodeRun(r.nodeRun, dest)
	case r.run != nil:
		return scanWorkflowRun(r.run, dest)
	case r.workflow != nil:
		return scanWorkflow(r.workflow, dest)
	case r.node != nil:
		return scanWorkflowNode(r.node, dest)
	}
	return nil
}

func scanWorkflowRun(w *db.MulticaWorkflowRun, dest []any) error {
	vals := []any{
		&w.ID, &w.WorkflowID, &w.WorkspaceID, &w.WorkflowTitle, &w.Status,
		&w.TriggeredByType, &w.TriggeredByID, &w.Input, &w.Output,
		&w.StartedAt, &w.CompletedAt, &w.CreatedAt, &w.RuntimeID,
		&w.SourceIssueID, &w.ResponsibleUserID, &w.RuntimeAuthorizerID,
		&w.DispatchKey, &w.RuntimeSelectionPolicy,
	}
	return copyRow(vals, dest)
}

func scanWorkflow(w *db.MulticaWorkflow, dest []any) error {
	vals := []any{
		&w.ID, &w.WorkspaceID, &w.Title, &w.Description, &w.Status,
		&w.MaxRetries, &w.CreatedByType, &w.CreatedByID, &w.CreatedAt,
		&w.UpdatedAt, &w.IsTemplate, &w.SourceTemplateID, &w.IsDefault,
		&w.DefaultRuntimeSelectionPolicy, &w.DefaultRuntimeID,
	}
	return copyRow(vals, dest)
}

// scanWorkflowNode scans all MulticaWorkflowNode fields (SELECT *).
func scanWorkflowNode(n *db.MulticaWorkflowNode, dest []any) error {
	vals := []any{
		&n.ID, &n.WorkflowID, &n.Title, &n.Description,
		&n.PositionX, &n.PositionY, &n.FormatSchema, &n.WorkerType,
		&n.WorkerID, &n.CriticType, &n.CriticID, &n.CriticApiUrl,
		&n.SortOrder, &n.CreatedAt, &n.UpdatedAt, &n.StageID,
		&n.WorkerRoleID, &n.CriticRoleID,
	}
	return copyRow(vals, dest)
}

// mockRowsWorkflowNodes is a pgx.Rows yielding MulticaWorkflowNode values.
type mockRowsWorkflowNodes struct {
	rows []db.MulticaWorkflowNode
	idx  int
}

func (m *mockRowsWorkflowNodes) Next() bool                                   { m.idx++; return m.idx < len(m.rows) }
func (m *mockRowsWorkflowNodes) Close()                                       {}
func (m *mockRowsWorkflowNodes) Err() error                                   { return nil }
func (m *mockRowsWorkflowNodes) CommandTag() pgconn.CommandTag                { return pgconn.NewCommandTag("") }
func (m *mockRowsWorkflowNodes) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (m *mockRowsWorkflowNodes) RawValues() [][]byte                          { return nil }
func (m *mockRowsWorkflowNodes) Values() ([]any, error)                       { return nil, nil }
func (m *mockRowsWorkflowNodes) Conn() *pgx.Conn                              { return nil }

func (m *mockRowsWorkflowNodes) Scan(dest ...any) error {
	r := &m.rows[m.idx]
	return scanWorkflowNode(r, dest)
}

// mockRowsWorkflowEdges is a pgx.Rows yielding MulticaWorkflowEdge values.
type mockRowsWorkflowEdges struct {
	rows []db.MulticaWorkflowEdge
	idx  int
}

func (m *mockRowsWorkflowEdges) Next() bool                                   { m.idx++; return m.idx < len(m.rows) }
func (m *mockRowsWorkflowEdges) Close()                                       {}
func (m *mockRowsWorkflowEdges) Err() error                                   { return nil }
func (m *mockRowsWorkflowEdges) CommandTag() pgconn.CommandTag                { return pgconn.NewCommandTag("") }
func (m *mockRowsWorkflowEdges) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (m *mockRowsWorkflowEdges) RawValues() [][]byte                          { return nil }
func (m *mockRowsWorkflowEdges) Values() ([]any, error)                       { return nil, nil }
func (m *mockRowsWorkflowEdges) Conn() *pgx.Conn                              { return nil }

func (m *mockRowsWorkflowEdges) Scan(dest ...any) error {
	r := &m.rows[m.idx]
	vals := []any{
		&r.ID, &r.WorkflowID, &r.SourceNodeID, &r.TargetNodeID,
		&r.Condition, &r.CreatedAt,
	}
	return copyRow(vals, dest)
}

// mockRowsMembers is a pgx.Rows yielding ListMembersWithUserRow values.
type mockRowsMembers struct {
	rows []db.ListMembersWithUserRow
	idx  int
}

func (m *mockRowsMembers) Next() bool                                   { m.idx++; return m.idx < len(m.rows) }
func (m *mockRowsMembers) Close()                                       {}
func (m *mockRowsMembers) Err() error                                   { return nil }
func (m *mockRowsMembers) CommandTag() pgconn.CommandTag                { return pgconn.NewCommandTag("") }
func (m *mockRowsMembers) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (m *mockRowsMembers) RawValues() [][]byte                          { return nil }
func (m *mockRowsMembers) Values() ([]any, error)                       { return nil, nil }
func (m *mockRowsMembers) Conn() *pgx.Conn                              { return nil }

func (m *mockRowsMembers) Scan(dest ...any) error {
	r := &m.rows[m.idx]
	vals := []any{
		&r.ID, &r.WorkspaceID, &r.UserID, &r.Role, &r.CreatedAt,
		&r.Source, &r.Status,
		&r.EmployeeID, &r.OrgDisplayName, &r.DeptID, &r.DeptName,
		&r.DeptPath, &r.Position, &r.IsMainDepartment, &r.DeptUserStatus,
		&r.LastSyncedAt, &r.SubjectID, &r.UserName, &r.UserEmail, &r.UserAvatarUrl,
		&r.UserSubjectID,
	}
	return copyRow(vals, dest)
}

// newEnsureRepoTestDB builds a fully-wired mock for the document-deliverable
// safety-net path. Settings default to empty (no Gitea data → safety net fires).
func newEnsureRepoTestDB() *ensureRepoTestDB {
	wsID := testUUID(2)
	runtimeID := testUUID(1)
	agentID := testUUID(4)
	issueID := testUUID(5)
	nodeRunID := testUUID(6)
	runID := testUUID(7)
	workflowID := testUUID(8)
	nodeID := testUUID(9)
	deliverableID := testUUID(10)
	prDeliverableID := testUUID(12)
	snapshotJSON, _ := json.Marshal(WorkflowDefinitionSnapshot{
		SchemaVersion: WorkflowDefinitionSchemaVersion,
		Workflow:      WorkflowSnapshotWorkflow{IsDefault: false},
	})
	return &ensureRepoTestDB{
		runtime: db.MulticaAgentRuntime{
			ID:          runtimeID,
			WorkspaceID: wsID,
			Provider:    csCloudProvider,
		},
		agent: db.MulticaAgent{
			ID:          agentID,
			WorkspaceID: wsID,
		},
		issue: db.MulticaIssue{
			ID:          issueID,
			WorkspaceID: wsID,
		},
		workspace: db.MulticaWorkspace{
			ID:       wsID,
			Name:     "test-ws",
			Settings: []byte(`{}`), // no Gitea data → safety net fires
		},
		nodeRun: db.MulticaWorkflowNodeRun{
			ID:             nodeRunID,
			WorkflowRunID:  runID,
			WorkflowNodeID: nodeID,
		},
		run: db.MulticaWorkflowRun{
			ID:          runID,
			WorkflowID:  workflowID,
			WorkspaceID: wsID,
		},
		workflow: db.MulticaWorkflow{
			ID:          workflowID,
			WorkspaceID: wsID,
			Title:       "Doc workflow",
		},
		node: db.MulticaWorkflowNode{
			ID:         nodeID,
			WorkflowID: workflowID,
			Title:      "Doc node",
			SortOrder:  1,
		},
		deliverables: []db.MulticaWorkflowNodeDeliverable{
			{
				ID:             deliverableID,
				WorkflowNodeID: nodeID,
				Kind:           "document",
				Title:          "Design doc",
			},
			{
				ID:             prDeliverableID,
				WorkflowNodeID: nodeID,
				Kind:           "pull_request",
				Title:          "Backend code MR",
			},
		},
		nodeRunDeliverables: []db.MulticaWorkflowNodeRunDeliverable{
			{
				ID:                deliverableID,
				WorkflowNodeRunID: nodeRunID,
				Kind:              "document",
				Title:             "Design doc",
				Required:          true,
			},
			{
				ID:                prDeliverableID,
				WorkflowNodeRunID: nodeRunID,
				Kind:              "pull_request",
				Title:             "Backend code MR",
				Required:          true,
			},
		},
		definitionSnapshot: snapshotJSON,
		members: []db.ListMembersWithUserRow{
			{
				UserID:    testUUID(20),
				Role:      "owner",
				SubjectID: pgtype.Text{String: "usr_owner", Valid: true},
			},
		},
	}
}

// newTeamNamespaceTestServer returns an httptest server that handles the
// team-namespace interface-8 endpoints (CreateTeam + InitWorkflow) and records
// calls. Returns (server, pointer-to-flags struct).
type teamNamespaceRecorder struct {
	mu               sync.Mutex
	initCalled       bool
	createTeamCalled bool
	syncCalled       bool
	lastInitReq      teamnamespace.WorkflowInitRequest
	lastSyncReq      teamnamespace.SyncMembersRequest
}

func newTeamNamespaceTestServer(t *testing.T) (*httptest.Server, *teamNamespaceRecorder) {
	t.Helper()
	rec := &teamNamespaceRecorder{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/internal/workflow/init":
			var initReq teamnamespace.WorkflowInitRequest
			_ = json.NewDecoder(r.Body).Decode(&initReq)
			rec.mu.Lock()
			rec.initCalled = true
			rec.lastInitReq = initReq
			rec.mu.Unlock()
			_ = json.NewEncoder(w).Encode(teamnamespace.WorkflowInitResponse{
				WFRepoPath:       "t-ws/wf-docworkflow",
				WFCloneURL:       "https://gitea.test/t-ws/wf-docworkflow.git",
				WFWebURL:         "https://gitea.test/t-ws/wf-docworkflow",
				InstanceBranch:   "inst-run",
				TeamNSExists:     true,
				AlgorithmVersion: "v2",
				BotCredentials: struct {
					GiteaUsername     string `json:"gitea_username"`
					GiteaUserID       int64  `json:"gitea_user_id"`
					Token             string `json:"token"`
					CloneURLWithToken string `json:"clone_url_with_token"`
				}{
					GiteaUsername:     "multica-bot-ws",
					Token:             "pat-bot-abc",
					CloneURLWithToken: "https://multica-bot-ws:pat-bot-abc@gitea.test/t-ws/wf-docworkflow.git",
				},
			})
		case r.URL.Path == "/api/internal/teams" && r.Method == http.MethodPost:
			rec.mu.Lock()
			rec.createTeamCalled = true
			rec.mu.Unlock()
			_ = json.NewEncoder(w).Encode(teamnamespace.CreateTeamResponse{
				TeamID:       "ws-uuid",
				TeamNSOrg:    "t-ws",
				GiteaBaseURL: "https://gitea.test",
				Bot: teamnamespace.BotInfo{
					GiteaUsername: "multica-bot-ws",
					Token:         "pat-bot-abc",
					TokenSHA256:   "sha-abc",
				},
			})
		case strings.HasSuffix(r.URL.Path, "/members:sync"):
			var syncReq teamnamespace.SyncMembersRequest
			_ = json.NewDecoder(r.Body).Decode(&syncReq)
			rec.mu.Lock()
			rec.syncCalled = true
			rec.lastSyncReq = syncReq
			rec.mu.Unlock()
			_ = json.NewEncoder(w).Encode(teamnamespace.SyncMembersResponse{
				TeamNSOrg:         "t-ws",
				MembersAddedCount: 0,
			})
		default:
			t.Errorf("unexpected team-namespace request path: %s", r.URL.Path)
		}
	}))
	return srv, rec
}

func TestBuildCSCloudPayload_DocDeliverableSafetyNet_TriggersInitWorkflow(t *testing.T) {
	srv, rec := newTeamNamespaceTestServer(t)
	defer srv.Close()

	tnClient := teamnamespace.NewClient(teamnamespace.Config{
		BaseURL: srv.URL,
		Token:   "svc-token",
		Tenant:  "default",
	})

	mdb := newEnsureRepoTestDB()
	svc := &TaskService{
		Queries:       db.New(mdb),
		Bus:           events.New(),
		TeamNamespace: tnClient,
	}

	task := db.MulticaAgentTaskQueue{
		ID:                testUUID(11),
		AgentID:           mdb.agent.ID,
		IssueID:           mdb.issue.ID,
		RuntimeID:         mdb.runtime.ID,
		WorkflowNodeRunID: mdb.nodeRun.ID,
		Status:            "queued",
		Context:           []byte(`{"phase":"worker"}`),
	}

	if _, err := svc.buildCSCloudPayload(context.Background(), task, mdb.runtime); err != nil {
		t.Fatalf("buildCSCloudPayload: %v", err)
	}

	rec.mu.Lock()
	initCalled := rec.initCalled
	createTeamCalled := rec.createTeamCalled
	rec.mu.Unlock()

	if !createTeamCalled {
		t.Errorf("expected CreateTeam (interface-8 ensure precursor) to be called")
	}
	if !initCalled {
		t.Fatalf("expected InitWorkflow (interface-8) to be called for document deliverable without Gitea settings")
	}

	mdb.mu.Lock()
	gotUpdateCount := mdb.updateCount
	lastSettings := mdb.lastSettings
	mdb.mu.Unlock()

	if gotUpdateCount == 0 {
		t.Fatalf("expected UpdateWorkspace to persist bot credentials, got 0 calls")
	}
	var settings map[string]any
	if err := json.Unmarshal(lastSettings, &settings); err != nil {
		t.Fatalf("unmarshal settings: %v", err)
	}
	if v, _ := settings["gitea_clone_url"].(string); v == "" {
		t.Errorf("settings missing gitea_clone_url: %v", settings)
	}
	if v, _ := settings["gitea_pat"].(string); v == "" {
		t.Errorf("settings missing gitea_pat: %v", settings)
	}
}

func TestBuildCSCloudPayload_DocDeliverableSafetyNet_SkipsWhenSettingsHaveGiteaData(t *testing.T) {
	srv, rec := newTeamNamespaceTestServer(t)
	defer srv.Close()

	tnClient := teamnamespace.NewClient(teamnamespace.Config{
		BaseURL: srv.URL,
		Token:   "svc-token",
		Tenant:  "default",
	})

	mdb := newEnsureRepoTestDB()
	// Settings already carry the full Gitea provisioning bundle → safety net must skip.
	// (All three of gitea_clone_url + gitea_pat + last_instance_branch are required by
	// giteaProvisioningBundle.complete; seeding a partial bundle would fire the safety net.)
	mdb.workspace.Settings = []byte(`{"gitea_clone_url":"https://gitea.test/t-ws/wf-x.git","gitea_pat":"pat-existing","last_instance_branch":"inst-x"}`)

	svc := &TaskService{
		Queries:       db.New(mdb),
		Bus:           events.New(),
		TeamNamespace: tnClient,
	}

	task := db.MulticaAgentTaskQueue{
		ID:                testUUID(11),
		AgentID:           mdb.agent.ID,
		IssueID:           mdb.issue.ID,
		RuntimeID:         mdb.runtime.ID,
		WorkflowNodeRunID: mdb.nodeRun.ID,
		Status:            "queued",
		Context:           []byte(`{"phase":"worker"}`),
	}

	if _, err := svc.buildCSCloudPayload(context.Background(), task, mdb.runtime); err != nil {
		t.Fatalf("buildCSCloudPayload: %v", err)
	}

	rec.mu.Lock()
	initCalled := rec.initCalled
	rec.mu.Unlock()

	if initCalled {
		t.Errorf("InitWorkflow must NOT fire when settings already have Gitea data")
	}
	mdb.mu.Lock()
	updateCount := mdb.updateCount
	mdb.mu.Unlock()
	if updateCount != 0 {
		t.Errorf("UpdateWorkspace must NOT be called when already provisioned, got %d", updateCount)
	}
}

// --- buildCSCloudPayload delivery repo + RepoAlias (M2.5 Task 3) tests ---
//
// When the workspace settings carry the Gitea provisioning bundle, the payload
// must (1) include a repos[] entry with role="delivery" pointing at the wf repo
// (inst base_branch + bot PAT + alias="delivery"), and (2) tag each document
// deliverable with repo_alias="delivery" so cs-cloud's checkout maps it back to
// that repos[] entry. pull_request deliverables keep repo_alias empty (they go
// to a code repo). See docs/superpowers/cs-cloud-delivery-m2.5-plan.md §Task 3.

func TestBuildCSCloudPayload_DeliveryRepoAndAlias_WhenSettingsHaveGiteaData(t *testing.T) {
	srv, _ := newTeamNamespaceTestServer(t)
	defer srv.Close()

	tnClient := teamnamespace.NewClient(teamnamespace.Config{
		BaseURL: srv.URL,
		Token:   "svc-token",
		Tenant:  "default",
	})

	mdb := newEnsureRepoTestDB()
	// Seed settings WITH Gitea data → resolveDeliveryRepo returns a repo and
	// the safety net is skipped (settingsLackGiteaData == false).
	mdb.workspace.Settings = []byte(`{` +
		`"gitea_clone_url":"https://gitea.test/t-ws/wf-docworkflow.git",` +
		`"last_instance_branch":"inst-run-abc",` +
		`"gitea_pat":"pat-bot-xyz",` +
		`"gitea_bot_username":"multica-bot-ws"}`)

	svc := &TaskService{
		Queries:       db.New(mdb),
		Bus:           events.New(),
		TeamNamespace: tnClient,
	}

	task := db.MulticaAgentTaskQueue{
		ID:                testUUID(11),
		AgentID:           mdb.agent.ID,
		IssueID:           mdb.issue.ID,
		RuntimeID:         mdb.runtime.ID,
		WorkflowNodeRunID: mdb.nodeRun.ID,
		Status:            "queued",
		Context:           []byte(`{"phase":"worker"}`),
	}

	payload, err := svc.buildCSCloudPayload(context.Background(), task, mdb.runtime)
	if err != nil {
		t.Fatalf("buildCSCloudPayload: %v", err)
	}

	// (1) repos[] contains a role=delivery entry pointing at the wf repo.
	var delivery *csCloudRepoSpec
	for i := range payload.Repos {
		if payload.Repos[i].Role == "delivery" {
			delivery = &payload.Repos[i]
			break
		}
	}
	if delivery == nil {
		t.Fatalf("expected repos[] to contain a role=delivery entry; got %+v", payload.Repos)
	}
	if delivery.URL != "https://gitea.test/t-ws/wf-docworkflow.git" {
		t.Errorf("delivery URL = %q, want wf clone URL", delivery.URL)
	}
	if delivery.Provider != "gitea" {
		t.Errorf("delivery Provider = %q, want gitea", delivery.Provider)
	}
	if delivery.BaseBranch != "inst-run-abc" {
		t.Errorf("delivery BaseBranch = %q, want inst-run-abc", delivery.BaseBranch)
	}
	if delivery.Alias != "delivery" {
		t.Errorf("delivery Alias = %q, want delivery", delivery.Alias)
	}
	if delivery.BotToken != "pat-bot-xyz" {
		t.Errorf("delivery BotToken = %q, want pat-bot-xyz", delivery.BotToken)
	}

	// (2) document deliverable is tagged with repo_alias="delivery";
	//     pull_request deliverable keeps repo_alias empty (targets a code repo).
	var docCount, prCount int
	for i := range payload.Deliverables {
		d := &payload.Deliverables[i]
		switch d.Kind {
		case "document":
			docCount++
			if d.RepoAlias != "delivery" {
				t.Errorf("document deliverable RepoAlias = %q, want delivery", d.RepoAlias)
			}
		case "pull_request":
			prCount++
			if d.RepoAlias != "" {
				t.Errorf("pull_request deliverable RepoAlias = %q, want empty", d.RepoAlias)
			}
		}
	}
	if docCount == 0 {
		t.Fatalf("expected at least one document deliverable; got %+v", payload.Deliverables)
	}
	if prCount == 0 {
		t.Fatalf("expected at least one pull_request deliverable; got %+v", payload.Deliverables)
	}
}

func TestBuildCSCloudPayload_NoDeliveryRepo_WhenSettingsLackGiteaData(t *testing.T) {
	srv, _ := newTeamNamespaceTestServer(t)
	defer srv.Close()

	tnClient := teamnamespace.NewClient(teamnamespace.Config{
		BaseURL: srv.URL,
		Token:   "svc-token",
		Tenant:  "default",
	})

	mdb := newEnsureRepoTestDB()
	// Settings default to "{}" (no Gitea data). The Task-2 safety net may fire
	// here, but this in-memory mock does not reflect UpdateWorkspace back into
	// GetWorkspace reads, so resolveDeliveryRepo still sees empty settings and
	// returns false → no delivery repo. In production (real DB) a successful
	// safety net WOULD populate settings in time for the current dispatch's
	// resolveDeliveryRepo (the reorder made this true); that read-after-write
	// scenario isn't representable in this mock and is covered by the
	// safety-net tests above. This test only guards the false-return path.

	svc := &TaskService{
		Queries:       db.New(mdb),
		Bus:           events.New(),
		TeamNamespace: tnClient,
	}

	task := db.MulticaAgentTaskQueue{
		ID:                testUUID(11),
		AgentID:           mdb.agent.ID,
		IssueID:           mdb.issue.ID,
		RuntimeID:         mdb.runtime.ID,
		WorkflowNodeRunID: mdb.nodeRun.ID,
		Status:            "queued",
		Context:           []byte(`{"phase":"worker"}`),
	}

	payload, err := svc.buildCSCloudPayload(context.Background(), task, mdb.runtime)
	if err != nil {
		t.Fatalf("buildCSCloudPayload: %v", err)
	}

	for _, r := range payload.Repos {
		if r.Role == "delivery" {
			t.Errorf("did not expect a delivery repo when settings lack Gitea data; got %+v", r)
		}
	}
}

// TestBuildCSCloudPayload_NonWorkerPhaseHasNoDeliverables is a regression guard
// for the Task-3 restructure (hoisting deliverables assembly out of the worker
// block). Non-worker (critic) phases MUST keep Deliverables empty — critic tasks
// don't submit, they review. Also no delivery repo should be emitted for them.
func TestBuildCSCloudPayload_NonWorkerPhaseHasNoDeliverables(t *testing.T) {
	srv, _ := newTeamNamespaceTestServer(t)
	defer srv.Close()

	tnClient := teamnamespace.NewClient(teamnamespace.Config{
		BaseURL: srv.URL,
		Token:   "svc-token",
		Tenant:  "default",
	})

	mdb := newEnsureRepoTestDB()
	mdb.workspace.Settings = []byte(`{` +
		`"gitea_clone_url":"https://gitea.test/t-ws/wf-x.git",` +
		`"last_instance_branch":"inst-x",` +
		`"gitea_pat":"pat-x",` +
		`"gitea_bot_username":"bot-x"}`)

	svc := &TaskService{
		Queries:       db.New(mdb),
		Bus:           events.New(),
		TeamNamespace: tnClient,
	}

	task := db.MulticaAgentTaskQueue{
		ID:                testUUID(11),
		AgentID:           mdb.agent.ID,
		IssueID:           mdb.issue.ID,
		RuntimeID:         mdb.runtime.ID,
		WorkflowNodeRunID: mdb.nodeRun.ID,
		Status:            "queued",
		Context:           []byte(`{"phase":"critic"}`), // not worker
	}

	payload, err := svc.buildCSCloudPayload(context.Background(), task, mdb.runtime)
	if err != nil {
		t.Fatalf("buildCSCloudPayload: %v", err)
	}
	if len(payload.Deliverables) != 0 {
		t.Errorf("critic phase must not emit deliverables; got %+v", payload.Deliverables)
	}
	for _, r := range payload.Repos {
		if r.Role == "delivery" {
			t.Errorf("critic phase must not emit a delivery repo; got %+v", r)
		}
	}
}

// --- repositoryDeliverableEnv cross-repo alignment tests (M2.5 holistic fix) ---
//
// cs-cloud's lookupRepoRole matches the checkout URL against payload.Repos[].URL
// by EXACT equality. repos[].URL comes from workspace.settings gitea_clone_url
// (read by resolveDeliveryRepo); CS_CLOUD_REPO_CLONE_URL is what the agent passes
// to `cs-cloud repo checkout`. If the two URLs diverge — e.g. GITEA_PUBLIC_BASE_URL
// points at a different host than the tenant-scoped Gitea that wrote the settings —
// cs-cloud silently downgrades delivery → code, picks the GitLab PAT, and the
// Gitea clone 401s. These tests pin that repositoryDeliverableEnv sources
// cloneURL/instBranch/baseURL from the SAME settings fields as resolveDeliveryRepo.

func TestRepositoryDeliverableEnv_PrefersSettingsCloneURL(t *testing.T) {
	// GITEA_* env vars are required by the guard at the top of the function.
	// GITEA_PUBLIC_BASE_URL is deliberately a DIFFERENT host than the settings
	// value — if the function self-builds from it, the test fails.
	t.Setenv("GITEA_BASE_URL", "http://gitea:3000")
	t.Setenv("GITEA_ADMIN_TOKEN", "set")
	t.Setenv("GITEA_PUBLIC_BASE_URL", "http://localhost:23000")

	mdb := newEnsureRepoTestDB()
	// Settings value is on a completely different host than GITEA_PUBLIC_BASE_URL.
	mdb.workspace.Settings = []byte(`{` +
		`"gitea_clone_url":"https://gitea-tenant.example/x/wf-abc.git",` +
		`"last_instance_branch":"inst-from-settings",` +
		`"gitea_web_url":"https://gitea-tenant.example",` +
		`"gitea_pat":"pat-xyz",` +
		`"gitea_bot_username":"multica-bot"}`)

	svc := &TaskService{Queries: db.New(mdb)}
	task := db.MulticaAgentTaskQueue{WorkflowNodeRunID: mdb.nodeRun.ID}

	env := svc.repositoryDeliverableEnv(context.Background(), task)
	if env == nil {
		t.Fatal("repositoryDeliverableEnv returned nil — document deliverable not found or gitea env unset")
	}

	// Clone URL MUST come from settings so it exactly equals repos[].URL
	// (which resolveDeliveryRepo also reads from settings.gitea_clone_url).
	// Self-assembly from GITEA_PUBLIC_BASE_URL would produce http://localhost:23000/...
	if got, want := env["CS_CLOUD_REPO_CLONE_URL"], "https://gitea-tenant.example/x/wf-abc.git"; got != want {
		t.Errorf("CS_CLOUD_REPO_CLONE_URL = %q, want settings value %q", got, want)
	}
	// Inst branch MUST come from settings so it matches repos[].BaseBranch.
	if got, want := env["CS_CLOUD_REPO_INST_BRANCH"], "inst-from-settings"; got != want {
		t.Errorf("CS_CLOUD_REPO_INST_BRANCH = %q, want %q", got, want)
	}
	// Base URL (cs-cloud's PR API target) comes from settings.gitea_web_url.
	if got, want := env["CS_CLOUD_REPO_BASE_URL"], "https://gitea-tenant.example"; got != want {
		t.Errorf("CS_CLOUD_REPO_BASE_URL = %q, want %q", got, want)
	}
	// Authed clone URL derives from the settings-sourced cloneURL (token embedded).
	if got := env["CS_CLOUD_REPO_CLONE_URL_AUTHED"]; !strings.Contains(got, "gitea-tenant.example") {
		t.Errorf("CS_CLOUD_REPO_CLONE_URL_AUTHED = %q, want to derive from settings cloneURL", got)
	}
	// The legacy alias must carry the SAME settings-sourced value.
	if got := env["CS_CLOUD_GITEA_CLONE_URL"]; got != "https://gitea-tenant.example/x/wf-abc.git" {
		t.Errorf("CS_CLOUD_GITEA_CLONE_URL = %q, want settings value (aliased)", got)
	}
}

func TestRepositoryDeliverableEnv_FallsBackToSelfBuiltWhenSettingsLackCloneURL(t *testing.T) {
	// When settings are pre-provisioning (no gitea_clone_url yet), the function
	// must still produce a usable cloneURL from GITEA_PUBLIC_BASE_URL — this is
	// the fallback path, not the cross-repo-aligned happy path.
	t.Setenv("GITEA_BASE_URL", "http://gitea:3000")
	t.Setenv("GITEA_ADMIN_TOKEN", "set")
	t.Setenv("GITEA_PUBLIC_BASE_URL", "http://localhost:23000")

	mdb := newEnsureRepoTestDB()
	// Settings have PAT/bot but NO gitea_clone_url / last_instance_branch / gitea_web_url.
	mdb.workspace.Settings = []byte(`{"gitea_pat":"pat-xyz","gitea_bot_username":"multica-bot"}`)

	svc := &TaskService{Queries: db.New(mdb)}
	task := db.MulticaAgentTaskQueue{WorkflowNodeRunID: mdb.nodeRun.ID}

	env := svc.repositoryDeliverableEnv(context.Background(), task)
	if env == nil {
		t.Fatal("repositoryDeliverableEnv returned nil")
	}

	// Fallback: self-built from GITEA_PUBLIC_BASE_URL.
	if got := env["CS_CLOUD_REPO_CLONE_URL"]; !strings.Contains(got, "localhost:23000") {
		t.Errorf("CS_CLOUD_REPO_CLONE_URL = %q, want self-built from GITEA_PUBLIC_BASE_URL (localhost:23000)", got)
	}
	if strings.Contains(env["CS_CLOUD_REPO_CLONE_URL"], "gitea-tenant.example") {
		t.Errorf("CS_CLOUD_REPO_CLONE_URL should NOT be the settings value when gitea_clone_url is absent")
	}
}

func TestRewriteGiteaHostToPublic(t *testing.T) {
	t.Setenv("GITEA_BASE_URL", "http://10.20.19.101:33000")
	t.Setenv("GITEA_PUBLIC_BASE_URL", "https://zgsmtest.xyz:30443")
	got := rewriteGiteaHostToPublic("http://10.20.19.101:33000/t-ad9d561c/wf-deliverable-archive.git")
	want := "https://zgsmtest.xyz:30443/t-ad9d561c/wf-deliverable-archive.git"
	if got != want {
		t.Errorf("rewrite = %q, want %q", got, want)
	}
}

func TestRewriteGiteaHostToPublic_NoopWithoutPublicBase(t *testing.T) {
	t.Setenv("GITEA_BASE_URL", "http://10.20.19.101:33000")
	t.Setenv("GITEA_PUBLIC_BASE_URL", "")
	in := "http://10.20.19.101:33000/t-x/wf-y.git"
	if got := rewriteGiteaHostToPublic(in); got != in {
		t.Errorf("rewrite = %q, want unchanged when GITEA_PUBLIC_BASE_URL unset (single-host deploy)", got)
	}
}

func TestRewriteGiteaHostToPublic_NoopForUnknownHost(t *testing.T) {
	// A URL whose host is NOT the internal Gitea is left alone — we never
	// silently redirect an unknown host (e.g. a tenant-scoped mirror).
	t.Setenv("GITEA_BASE_URL", "http://10.20.19.101:33000")
	t.Setenv("GITEA_PUBLIC_BASE_URL", "https://zgsmtest.xyz:30443")
	in := "https://gitea-tenant.example/t-x/wf-y.git"
	if got := rewriteGiteaHostToPublic(in); got != in {
		t.Errorf("rewrite = %q, want unchanged (host is not the internal Gitea)", got)
	}
}

func TestRewriteGiteaHostToPublic_PortIsExactNotPrefix(t *testing.T) {
	// :33000 must not prefix-match :330000 — host compare is exact (port incl).
	t.Setenv("GITEA_BASE_URL", "http://h:33000")
	t.Setenv("GITEA_PUBLIC_BASE_URL", "https://pub.example")
	in := "http://h:330000/t-x/wf-y.git"
	if got := rewriteGiteaHostToPublic(in); got != in {
		t.Errorf("rewrite = %q, want unchanged (:33000 is not a prefix match for :330000)", got)
	}
}

// TestResolveDeliveryRepo_RewritesInternalHostToPublic pins the dispatch-
// boundary host rewrite on the repos[].URL exit. costrict-web emits wf_clone_url
// on its single (internal) tenant git-server endpoint, which cs-cloud can't
// reach. When settings.gitea_clone_url is on the internal GITEA_BASE_URL host,
// resolveDeliveryRepo must rewrite it to GITEA_PUBLIC_BASE_URL (host swapped,
// path preserved). repositoryDeliverableEnv runs the SAME settings value
// through the SAME rewrite helper for CS_CLOUD_REPO_CLONE_URL, keeping
// repos[].URL == CS_CLOUD_REPO_CLONE_URL so cs-cloud's lookupRepoRole equality
// contract holds.
//
// (repositoryDeliverableEnv itself isn't exercised here because its mock
// (ensureRepoTestDB) lacks the RunNodeTopoOrder SQL dispatches — a pre-existing
// gap that also leaves TestRepositoryDeliverableEnv_PrefersSettingsCloneURL
// local-red. The cloneURL exit uses the identical rewrite call, verified by the
// pure TestRewriteGiteaHostToPublic + this repos[].URL test.)
func TestResolveDeliveryRepo_RewritesInternalHostToPublic(t *testing.T) {
	t.Setenv("GITEA_BASE_URL", "http://10.20.19.101:33000")
	t.Setenv("GITEA_PUBLIC_BASE_URL", "https://zgsmtest.xyz:30443")

	mdb := newEnsureRepoTestDB()
	mdb.workspace.Settings = []byte(`{` +
		`"gitea_clone_url":"http://10.20.19.101:33000/t-ad9d561c/wf-deliverable-archive.git",` +
		`"last_instance_branch":"inst-run",` +
		`"gitea_pat":"pat-xyz"}`)

	svc := &TaskService{Queries: db.New(mdb)}
	repo, ok := svc.resolveDeliveryRepo(context.Background(), mdb.workspace.ID)
	if !ok {
		t.Fatal("resolveDeliveryRepo returned ok=false")
	}
	want := "https://zgsmtest.xyz:30443/t-ad9d561c/wf-deliverable-archive.git"
	if repo.URL != want {
		t.Errorf("repos[].URL = %q, want rewritten to public host %q", repo.URL, want)
	}
}

// TestRepositoryDeliverableEnv_RewritesInternalHostToPublic verifies the second
// dispatch exit end-to-end: CS_CLOUD_REPO_CLONE_URL / _BASE_URL /
// _CLONE_URL_AUTHED all carry the PUBLIC host when settings.gitea_clone_url is
// on the internal GITEA_BASE_URL host. cloneURL is rewritten before the bot
// token is injected, so the authed URL is public too; and CS_CLOUD_REPO_CLONE_URL
// stays EXACTLY equal to resolveDeliveryRepo's repos[].URL (lookupRepoRole).
func TestRepositoryDeliverableEnv_RewritesInternalHostToPublic(t *testing.T) {
	t.Setenv("GITEA_BASE_URL", "http://10.20.19.101:33000")
	t.Setenv("GITEA_ADMIN_TOKEN", "set")
	t.Setenv("GITEA_PUBLIC_BASE_URL", "https://zgsmtest.xyz:30443")

	mdb := newEnsureRepoTestDB()
	mdb.workspace.Settings = []byte(`{` +
		`"gitea_clone_url":"http://10.20.19.101:33000/t-ad9d561c/wf-deliverable-archive.git",` +
		`"last_instance_branch":"inst-run",` +
		`"gitea_web_url":"http://10.20.19.101:33000/t-ad9d561c/wf-deliverable-archive",` +
		`"gitea_pat":"pat-xyz",` +
		`"gitea_bot_username":"bot-t-ad9d561c"}`)

	svc := &TaskService{Queries: db.New(mdb)}
	task := db.MulticaAgentTaskQueue{WorkflowNodeRunID: mdb.nodeRun.ID}

	env := svc.repositoryDeliverableEnv(context.Background(), task)
	if env == nil {
		t.Fatal("repositoryDeliverableEnv returned nil")
	}

	wantClone := "https://zgsmtest.xyz:30443/t-ad9d561c/wf-deliverable-archive.git"
	if got := env["CS_CLOUD_REPO_CLONE_URL"]; got != wantClone {
		t.Errorf("CS_CLOUD_REPO_CLONE_URL = %q, want rewritten to public host %q", got, wantClone)
	}
	if got := env["CS_CLOUD_REPO_BASE_URL"]; got != "https://zgsmtest.xyz:30443/t-ad9d561c/wf-deliverable-archive" {
		t.Errorf("CS_CLOUD_REPO_BASE_URL = %q, want gitea_web_url rewritten to public host", got)
	}
	// Authed clone URL: host swapped BEFORE the bot token is injected.
	authed := env["CS_CLOUD_REPO_CLONE_URL_AUTHED"]
	if !strings.HasPrefix(authed, "https://bot-t-ad9d561c:pat-xyz@zgsmtest.xyz:30443/") {
		t.Errorf("CS_CLOUD_REPO_CLONE_URL_AUTHED = %q, want public host + embedded bot token", authed)
	}
	// Cross-repo equality: repos[].URL must equal the dispatched clone URL.
	repo, ok := svc.resolveDeliveryRepo(context.Background(), mdb.workspace.ID)
	if !ok {
		t.Fatal("resolveDeliveryRepo returned ok=false")
	}
	if repo.URL != wantClone {
		t.Errorf("repos[].URL = %q, want %q (must equal CS_CLOUD_REPO_CLONE_URL)", repo.URL, wantClone)
	}
}

func TestResolveCSCloudAddons_PluginMarketplaceOverride(t *testing.T) {
	// Plugin resolution is by NAME (the stored install slug), not a catalog
	// lookup. The marketplace identity is server-owned config.
	svc := &TaskService{
		Queries:                  db.New(&resolveTestDB{}),
		CSCPluginMarketplaceName: "costrict-plugins",
		CSCPluginMarketplaceRepo: "https://github.com/costrict-plugins-repo/marketplace.git",
	}

	plugin, skills := svc.resolveCSCloudAddons(context.Background(), testUUID(7), pgtype.Text{String: "superpowers", Valid: true})

	if plugin == nil {
		t.Fatal("expected plugin to be resolved from plugin_name")
	}
	if plugin.Name != "superpowers" {
		t.Errorf("plugin name = %q, want superpowers", plugin.Name)
	}
	if plugin.Install == nil || plugin.Install.PluginName != "superpowers" {
		t.Errorf("plugin install name not carried from plugin_name: %+v", plugin.Install)
	}
	// Marketplace identity is server-owned config, stamped regardless.
	if plugin.Install.MarketplaceName != "costrict-plugins" {
		t.Errorf("marketplace name = %q, want server config costrict-plugins", plugin.Install.MarketplaceName)
	}
	if plugin.Install.MarketplaceRepo != "https://github.com/costrict-plugins-repo/marketplace.git" {
		t.Errorf("marketplace repo = %q, want server config", plugin.Install.MarketplaceRepo)
	}
	if len(skills) != 0 {
		t.Errorf("expected no cloud skills, got %d", len(skills))
	}
}

func TestResolveCSCloudAddons_EmptyPluginNameLeavesPluginNil(t *testing.T) {
	// No plugin_name bound -> plugin nil, no error path. An agent without a
	// plugin_name simply has no plugin (the intended "download by name" contract).
	svc := &TaskService{Queries: db.New(&resolveTestDB{})}
	plugin, _ := svc.resolveCSCloudAddons(context.Background(), testUUID(7), pgtype.Text{})
	if plugin != nil {
		t.Fatal("expected nil plugin when plugin_name empty")
	}
}

func TestResolveCSCloudAddons_CloudSkillsPassedThrough(t *testing.T) {
	installJSON := `{"method":"csc","spec":"code-review","skill_id":"","source_url":"","verified":true}`
	mdb := &resolveTestDB{
		cloudSkillRows: []db.MulticaAgentCloudSkill{
			{
				AgentID:      testUUID(7),
				CloudSkillID: "skill-1",
				Slug:         "code-review",
				Name:         "Code Review",
				Description:  "Reviews code",
				Install:      []byte(installJSON),
				Position:     0,
			},
		},
	}
	// Empty plugin_name -> no plugin; cloud skills still pass through.
	svc := &TaskService{Queries: db.New(mdb)}

	plugin, skills := svc.resolveCSCloudAddons(context.Background(), testUUID(7), pgtype.Text{})

	if plugin != nil {
		t.Error("expected nil plugin when pluginID empty / catalog not configured")
	}
	if len(skills) != 1 {
		t.Fatalf("expected 1 cloud skill, got %d", len(skills))
	}
	s := skills[0]
	if s.ID != "skill-1" || s.Slug != "code-review" || s.Name != "Code Review" {
		t.Errorf("cloud skill row mapping wrong: %+v", s)
	}
	if s.Install == nil || s.Install.Spec != "code-review" || s.Install.Method != "csc" || !s.Install.Verified {
		t.Errorf("install metadata not passed through: %+v", s.Install)
	}
}

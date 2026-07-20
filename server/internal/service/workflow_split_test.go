package service

import (
	"context"
	"fmt"
	"io"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/events"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

func TestSplitLifecycleEventsPayload(t *testing.T) {
	bus := events.New()
	orchestrator := NewSplitOrchestrator(nil, nil, nil, bus)
	runID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	nodeRunID := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	workspaceID := pgtype.UUID{Bytes: [16]byte{3}, Valid: true}
	plannerID := pgtype.UUID{Bytes: [16]byte{4}, Valid: true}
	startedAt := time.Now().Add(-time.Second)

	var got events.Event
	bus.Subscribe(protocol.EventSplitGenerationDispatched, func(event events.Event) { got = event })
	orchestrator.publishSplitEvent(
		protocol.EventSplitGenerationDispatched,
		db.MulticaWorkflowRun{ID: runID, WorkspaceID: workspaceID},
		db.MulticaWorkflowNodeRun{ID: nodeRunID, WorkflowRunID: runID, WorkerID: plannerID, StartedAt: pgtype.Timestamptz{Time: startedAt, Valid: true}},
		SplitLifecycleEventPayload{AgentTaskID: "task-1"},
	)

	payload, ok := got.Payload.(SplitLifecycleEventPayload)
	if !ok {
		t.Fatalf("payload type = %T", got.Payload)
	}
	if payload.WorkflowNodeRunID == "" || payload.WorkflowRunID == "" || payload.PlannerAgentID == "" {
		t.Fatalf("missing fixed payload ids: %+v", payload)
	}
	if payload.AgentTaskID != "task-1" || payload.ElapsedMS < 900 {
		t.Fatalf("payload = %+v", payload)
	}
}

func TestSplitTaskDispatchKeyUsesTaskVersionAsAttempt(t *testing.T) {
	task := db.MulticaWorkflowSplitTask{
		ID:      pgtype.UUID{Bytes: [16]byte{1}, Valid: true},
		Version: 3,
	}
	got := splitTaskDispatchKey(task)
	want := "split-task:01000000-0000-0000-0000-000000000000:attempt:3"
	if got != want {
		t.Fatalf("dispatch key = %q, want %q", got, want)
	}
}

func TestValidateDraftSplitTaskRowsAllowsEmptyPlan(t *testing.T) {
	if err := validateDraftSplitTaskRows(nil); err != nil {
		t.Fatalf("validateDraftSplitTaskRows(nil) = %v, want nil", err)
	}
}

func TestSplitTaskGraphRejectsUnknownDependency(t *testing.T) {
	tasks := []splitTaskPlan{
		{ID: "a", Status: SplitTaskStatusCreated},
		{ID: "b", Status: SplitTaskStatusCreated, DependsOn: []string{"missing"}},
	}
	err := validateSplitTaskGraph(tasks)
	if err == nil || !strings.Contains(err.Error(), "unknown dependency") {
		t.Fatalf("validateSplitTaskGraph error = %v, want unknown dependency", err)
	}
}

func TestResolveSplitStatusCountsCancelledAsBarrierFailure(t *testing.T) {
	tasks := []splitTaskPlan{
		{ID: "a", Status: SplitTaskStatusDone},
		{ID: "b", Status: SplitTaskStatusCancelled},
	}
	if got := resolveSplitStatus(SplitModeBarrier, 0, tasks); got != NodeRunStatusFailed {
		t.Fatalf("status = %s, want failed", got)
	}
	if got := resolveSplitStatus(SplitModeBarrier, 1, tasks); got != NodeRunStatusCompleted {
		t.Fatalf("status = %s, want completed", got)
	}
}

func TestSplitTaskGraphRejectsCycle(t *testing.T) {
	tasks := []splitTaskPlan{
		{ID: "a", Status: SplitTaskStatusCreated, DependsOn: []string{"c"}},
		{ID: "b", Status: SplitTaskStatusCreated, DependsOn: []string{"a"}},
		{ID: "c", Status: SplitTaskStatusCreated, DependsOn: []string{"b"}},
	}
	err := validateSplitTaskGraph(tasks)
	if err == nil || !strings.Contains(err.Error(), "cycle") {
		t.Fatalf("validateSplitTaskGraph error = %v, want cycle", err)
	}
}

func TestTopologicalSplitTaskOrderHonorsDependenciesAndSortOrder(t *testing.T) {
	tasks := []splitTaskPlan{
		{ID: "c", SortOrder: 3, Status: SplitTaskStatusCreated, DependsOn: []string{"b"}},
		{ID: "a", SortOrder: 1, Status: SplitTaskStatusCreated},
		{ID: "b", SortOrder: 2, Status: SplitTaskStatusCreated, DependsOn: []string{"a"}},
		{ID: "d", SortOrder: 0, Status: SplitTaskStatusCreated},
	}
	got, err := topologicalSplitTaskIDs(tasks)
	if err != nil {
		t.Fatalf("topologicalSplitTaskIDs: %v", err)
	}
	want := []string{"d", "a", "b", "c"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("topologicalSplitTaskIDs = %v, want %v", got, want)
	}
}

func TestReadySplitTasksRespectDependenciesAndConcurrency(t *testing.T) {
	tasks := []splitTaskPlan{
		{ID: "a", SortOrder: 1, Status: SplitTaskStatusDone},
		{ID: "b", SortOrder: 2, Status: SplitTaskStatusCreated, DependsOn: []string{"a"}},
		{ID: "c", SortOrder: 3, Status: SplitTaskStatusCreated, DependsOn: []string{"a"}},
		{ID: "d", SortOrder: 4, Status: SplitTaskStatusCreated, DependsOn: []string{"b"}},
		{ID: "e", SortOrder: 5, Status: SplitTaskStatusRunning},
	}
	got, err := readySplitTaskIDs(tasks, 2)
	if err != nil {
		t.Fatalf("readySplitTaskIDs: %v", err)
	}
	want := []string{"b"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("readySplitTaskIDs = %v, want %v", got, want)
	}
}

func TestMarkSkippedSplitTasksAfterFailedDependency(t *testing.T) {
	tasks := []splitTaskPlan{
		{ID: "a", Status: SplitTaskStatusFailed},
		{ID: "b", Status: SplitTaskStatusCreated, DependsOn: []string{"a"}},
		{ID: "c", Status: SplitTaskStatusCreated, DependsOn: []string{"b"}},
		{ID: "d", Status: SplitTaskStatusDone},
	}
	got := markBlockedSplitTasksSkipped(tasks)
	statuses := map[string]string{}
	for _, task := range got {
		statuses[task.ID] = task.Status
	}
	if statuses["b"] != SplitTaskStatusSkipped || statuses["c"] != SplitTaskStatusSkipped {
		t.Fatalf("statuses after skip = %v, want b/c skipped", statuses)
	}
	if statuses["d"] != SplitTaskStatusDone {
		t.Fatalf("done task changed to %s", statuses["d"])
	}
}

func TestResolveSettledSplitStatusSkipsDependentsAndFailsBarrier(t *testing.T) {
	tasks := []splitTaskPlan{
		{ID: "a", Status: SplitTaskStatusFailed},
		{ID: "b", Status: SplitTaskStatusCreated, DependsOn: []string{"a"}},
	}

	settled, status := resolveSettledSplitStatus(SplitModeBarrier, 0, tasks)

	statuses := map[string]string{}
	for _, task := range settled {
		statuses[task.ID] = task.Status
	}
	if statuses["b"] != SplitTaskStatusSkipped {
		t.Fatalf("dependent task status = %s, want skipped", statuses["b"])
	}
	if status != NodeRunStatusFailed {
		t.Fatalf("resolved node status = %s, want failed", status)
	}
}

func TestResolveSplitPipelineCompletesAfterChildIssuesAreMaterialized(t *testing.T) {
	tasks := []splitTaskPlan{
		{ID: "a", Status: SplitTaskStatusCreated},
		{ID: "b", Status: SplitTaskStatusRunning},
	}
	got := resolveSplitStatus(SplitModePipeline, 0, tasks)
	if got != NodeRunStatusCompleted {
		t.Fatalf("resolveSplitStatus pipeline = %s, want %s", got, NodeRunStatusCompleted)
	}
}

func TestResolveSplitPipelineCompletesAfterInitialDispatch(t *testing.T) {
	tasks := []splitTaskPlan{
		{ID: "a", Status: SplitTaskStatusRunning},
		{ID: "b", Status: SplitTaskStatusDone},
	}
	got := resolveSplitStatus(SplitModePipeline, 0, tasks)
	if got != NodeRunStatusCompleted {
		t.Fatalf("resolveSplitStatus pipeline = %s, want %s", got, NodeRunStatusCompleted)
	}
}

func TestResolveSplitPipelineHonorsFailureThreshold(t *testing.T) {
	tasks := []splitTaskPlan{
		{ID: "a", Status: SplitTaskStatusFailed},
		{ID: "b", Status: SplitTaskStatusSkipped},
	}
	if got := resolveSplitStatus(SplitModePipeline, 0, tasks); got != NodeRunStatusFailed {
		t.Fatalf("resolveSplitStatus pipeline threshold=0 = %s, want failed", got)
	}
	if got := resolveSplitStatus(SplitModePipeline, 1, tasks); got != NodeRunStatusCompleted {
		t.Fatalf("resolveSplitStatus pipeline threshold=1 = %s, want completed", got)
	}
}

func TestChildIssueQueriesExcludeWorkflowOriginChildren(t *testing.T) {
	query, err := os.ReadFile("../../pkg/db/queries/issue.sql")
	if err != nil {
		t.Fatalf("read issue queries: %v", err)
	}
	sql := string(query)

	listBlock := sqlQueryBlock(t, sql, "-- name: ListChildIssues", "-- name: ListIssueDescendants")
	if !strings.Contains(listBlock, "origin_type IS NULL OR origin_type <> 'workflow'") {
		t.Fatalf("ListChildIssues must exclude workflow-origin child rows, got:\n%s", listBlock)
	}

	progressBlock := sqlQueryBlock(t, sql, "-- name: ChildIssueProgress", "-- SearchIssues:")
	if !strings.Contains(progressBlock, "origin_type IS NULL OR origin_type <> 'workflow'") {
		t.Fatalf("ChildIssueProgress must exclude workflow-origin child rows, got:\n%s", progressBlock)
	}
}

func TestResolveSplitBarrierFailureThreshold(t *testing.T) {
	tasks := []splitTaskPlan{
		{ID: "a", Status: SplitTaskStatusDone},
		{ID: "b", Status: SplitTaskStatusFailed},
		{ID: "c", Status: SplitTaskStatusSkipped},
	}
	if got := resolveSplitStatus(SplitModeBarrier, 1, tasks); got != NodeRunStatusCompleted {
		t.Fatalf("resolveSplitStatus threshold=1 = %s, want completed", got)
	}
	if got := resolveSplitStatus(SplitModeBarrier, 0, tasks); got != NodeRunStatusFailed {
		t.Fatalf("resolveSplitStatus threshold=0 = %s, want failed", got)
	}
}

func TestCanRegenerateSplitNodeStatusAllowsFailedRecovery(t *testing.T) {
	allowed := []string{
		NodeRunStatusSplitting,
		NodeRunStatusAwaitingSplitReview,
		NodeRunStatusFailed,
	}
	for _, status := range allowed {
		if !canRegenerateSplitNodeStatus(status) {
			t.Fatalf("canRegenerateSplitNodeStatus(%q) = false, want true", status)
		}
	}

	blocked := []string{
		NodeRunStatusCompleted,
		NodeRunStatusCancelled,
		NodeRunStatusSplitActive,
	}
	for _, status := range blocked {
		if canRegenerateSplitNodeStatus(status) {
			t.Fatalf("canRegenerateSplitNodeStatus(%q) = true, want false", status)
		}
	}
}

func TestTerminalWorkflowRunStatus(t *testing.T) {
	terminal := []string{RunStatusCompleted, RunStatusFailed, RunStatusCancelled}
	for _, status := range terminal {
		if !isTerminalWorkflowRunStatus(status) {
			t.Fatalf("isTerminalWorkflowRunStatus(%q) = false, want true", status)
		}
	}
	if isTerminalWorkflowRunStatus(RunStatusRunning) {
		t.Fatalf("isTerminalWorkflowRunStatus(%q) = true, want false", RunStatusRunning)
	}
	if isTerminalWorkflowRunStatus("pending") {
		t.Fatal(`isTerminalWorkflowRunStatus("pending") = true, want false`)
	}
}

func sqlQueryBlock(t *testing.T, sql, startMarker, endMarker string) string {
	t.Helper()

	start := strings.Index(sql, startMarker)
	if start < 0 {
		t.Fatalf("query block start %q not found", startMarker)
	}
	end := strings.Index(sql[start:], endMarker)
	if end < 0 {
		t.Fatalf("query block end %q not found after %q", endMarker, startMarker)
	}
	return sql[start : start+end]
}

func TestDraftSourceConstantsAreDistinct(t *testing.T) {
	sources := []struct {
		name  string
		value string
	}{
		{"DraftSourceAgent", DraftSourceAgent},
		{"DraftSourceChat", DraftSourceChat},
		{"DraftSourceRecovered", DraftSourceRecovered},
	}

	if len(sources) != 3 {
		t.Fatalf("expected 3 draft source constants, got %d", len(sources))
	}

	seen := make(map[string]string, len(sources))
	for _, s := range sources {
		if s.value == "" {
			t.Fatalf("%s is empty", s.name)
		}
		if prev, ok := seen[s.value]; ok {
			t.Fatalf("draft source %q (%s) collides with %s", s.value, s.name, prev)
		}
		seen[s.value] = s.name
	}

	if DraftSourceAgent != "agent" {
		t.Fatalf("DraftSourceAgent = %q, want %q", DraftSourceAgent, "agent")
	}
	if DraftSourceChat != "chat" {
		t.Fatalf("DraftSourceChat = %q, want %q", DraftSourceChat, "chat")
	}
	if DraftSourceRecovered != "recovered" {
		t.Fatalf("DraftSourceRecovered = %q, want %q", DraftSourceRecovered, "recovered")
	}
}

func TestParseSplitConfigAcceptsDefaultIssueWorkflowID(t *testing.T) {
	cfg, err := parseSplitConfig([]byte(`{
		"type": "split",
		"split_config": {
			"default_issue_workflow_id": "11111111-1111-1111-1111-111111111111",
			"mode": "pipeline",
			"max_concurrency": 12,
			"max_failures": 2
		}
	}`))
	if err != nil {
		t.Fatalf("parseSplitConfig: %v", err)
	}
	if cfg.DefaultIssueWorkflowID != "11111111-1111-1111-1111-111111111111" {
		t.Fatalf("DefaultIssueWorkflowID = %q", cfg.DefaultIssueWorkflowID)
	}
	if cfg.Mode != SplitModePipeline || cfg.MaxConcurrency != 12 || cfg.MaxFailures != 2 {
		t.Fatalf("cfg = %+v, want pipeline/12/2", cfg)
	}
}

func TestParseSplitConfigRequiresDefaultIssueWorkflowID(t *testing.T) {
	_, err := parseSplitConfig([]byte(`{"type":"split","split_config":{"mode":"barrier"}}`))
	if err == nil || !strings.Contains(err.Error(), "default_issue_workflow_id") {
		t.Fatalf("parseSplitConfig error = %v, want missing default_issue_workflow_id", err)
	}
}

func TestParseSplitConfigRejectsLegacyChildWorkflowID(t *testing.T) {
	_, err := parseSplitConfig([]byte(`{
		"type": "split",
		"split_config": {
			"child_workflow_id": "11111111-1111-1111-1111-111111111111",
			"mode": "barrier",
			"max_concurrency": 5,
			"max_failures": 0
		}
	}`))
	if err == nil || !strings.Contains(err.Error(), "default_issue_workflow_id") {
		t.Fatalf("parseSplitConfig error = %v, want missing default_issue_workflow_id", err)
	}
}

func TestBuildSplitDependencyContextIncludesDependencyOutputs(t *testing.T) {
	context := buildSplitDependencyContext([]splitTaskDependencyContext{
		{
			TaskTitle: "API contract",
			NodeRuns: []db.MulticaWorkflowNodeRun{
				{
					NodeTitle:    "Draft API",
					WorkerOutput: []byte(`{"output":"Spec ready"}`),
				},
				{
					NodeTitle:    "Review",
					WorkerOutput: []byte(`{"output":"Approved by critic"}`),
				},
				{
					NodeTitle:    "Ignored",
					WorkerOutput: []byte(`{"foo":"bar"}`),
				},
			},
		},
		{
			TaskTitle: "Backfill tests",
			NodeRuns: []db.MulticaWorkflowNodeRun{
				{
					NodeTitle:    "Plan coverage",
					WorkerOutput: []byte(`{"output":"Need integration coverage"}`),
				},
				{
					NodeTitle:    "Broken payload",
					WorkerOutput: []byte(`not-json`),
				},
			},
		},
	})

	want := "\n\n---\n\n## API contract Output\n\n### Draft API\n\nSpec ready\n\n### Review\n\nApproved by critic\n\n---\n\n## Backfill tests Output\n\n### Plan coverage\n\nNeed integration coverage"
	if context != want {
		t.Fatalf("buildSplitDependencyContext = %q, want %q", context, want)
	}
}

func TestBuildSplitChildIssueDescriptionAppendsDependencyContext(t *testing.T) {
	got := buildSplitChildIssueDescription("Existing child issue description", "\n\n---\n\n## API contract Output\n\nSpec ready")
	want := "Existing child issue description\n\n---\n\n## API contract Output\n\nSpec ready"
	if got != want {
		t.Fatalf("buildSplitChildIssueDescription = %q, want %q", got, want)
	}

	got = buildSplitChildIssueDescription("", "\n\n---\n\n## API contract Output\n\nSpec ready")
	want = "\n\n---\n\n## API contract Output\n\nSpec ready"
	if got != want {
		t.Fatalf("buildSplitChildIssueDescription empty = %q, want %q", got, want)
	}
}

func TestRecoverSplitGeneratedTaskPayloadFromTextCandidatesUsesCommentMarkdown(t *testing.T) {
	payload, err := recoverSplitGeneratedTaskPayloadFromTextCandidates([]string{
		"I posted the split plan in a comment.",
		strings.Join([]string{
			"## Task 1: Build API contract",
			"Define the request and response payloads.",
			"",
			"## Task 2: Implement CLI command",
			"Wire the draft add and submit commands.",
		}, "\n"),
	})
	if err != nil {
		t.Fatalf("recoverSplitGeneratedTaskPayloadFromTextCandidates: %v", err)
	}
	if len(payload.Tasks) != 2 {
		t.Fatalf("task count = %d, want 2", len(payload.Tasks))
	}
	if payload.Tasks[0].Title != "Build API contract" || payload.Tasks[1].Title != "Implement CLI command" {
		t.Fatalf("task titles = %q / %q", payload.Tasks[0].Title, payload.Tasks[1].Title)
	}
	if payload.Tasks[0].Key != "build-api-contract" || payload.Tasks[1].Key != "implement-cli-command" {
		t.Fatalf("task keys = %q / %q", payload.Tasks[0].Key, payload.Tasks[1].Key)
	}
}

func TestRecoverSplitGeneratedTaskPayloadFromTextCandidatesUsesMarkdownSummaryTable(t *testing.T) {
	payload, err := recoverSplitGeneratedTaskPayloadFromTextCandidates([]string{
		strings.Join([]string{
			"## 任务拆分完成",
			"",
			"### 各任务概要",
			"",
			"| # | Key | 任务 | 依赖 |",
			"|---|-----|------|------|",
			"| 1 | `project-init` | 项目初始化与界面布局 — HTML 骨架、CSS 布局 | — |",
			"| 2 | `board-render` | 棋盘与棋子 Canvas 渲染 — 绘制棋盘和棋子 | 1 |",
			"| 3 | `game-core` | 游戏核心逻辑 — 状态管理 | 1, 2 |",
		}, "\n"),
	})
	if err != nil {
		t.Fatalf("recoverSplitGeneratedTaskPayloadFromTextCandidates: %v", err)
	}
	if len(payload.Tasks) != 3 {
		t.Fatalf("task count = %d, want 3", len(payload.Tasks))
	}
	if payload.Tasks[0].Key != "project-init" || payload.Tasks[1].Key != "board-render" || payload.Tasks[2].Key != "game-core" {
		t.Fatalf("task keys = %q / %q / %q", payload.Tasks[0].Key, payload.Tasks[1].Key, payload.Tasks[2].Key)
	}
	if payload.Tasks[0].Title != "项目初始化与界面布局" || payload.Tasks[1].Title != "棋盘与棋子 Canvas 渲染" {
		t.Fatalf("task titles = %q / %q", payload.Tasks[0].Title, payload.Tasks[1].Title)
	}
	if got := payload.Tasks[2].DependsOnIndex; len(got) != 2 || got[0] != 0 || got[1] != 1 {
		t.Fatalf("task 3 depends_on_indices = %v, want [0 1]", got)
	}
}

func TestUpsertSplitDraftTaskByKeyDoesNotReviveDiscardedRows(t *testing.T) {
	query, err := os.ReadFile("../../pkg/db/queries/workflow_split_task.sql")
	if err != nil {
		t.Fatalf("read workflow split task queries: %v", err)
	}
	sql := string(query)
	start := strings.Index(sql, "-- name: UpsertSplitDraftTaskByKey")
	end := strings.Index(sql, "-- name: GetSplitTask")
	if start < 0 || end < 0 || end <= start {
		t.Fatal("UpsertSplitDraftTaskByKey query block not found")
	}
	upsertSQL := sql[start:end]
	if strings.Contains(upsertSQL, "status IN ('draft', 'discarded')") {
		t.Fatal("UpsertSplitDraftTaskByKey must not update discarded rows back to draft")
	}
	if !strings.Contains(upsertSQL, "WHERE draft_key IS NOT NULL AND draft_key <> '' AND status <> 'discarded'") {
		t.Fatal("draft key uniqueness must exclude discarded rows so reused keys create new draft rows")
	}
}

func TestRecoverSplitGeneratedTaskPayloadFromAttachmentCandidatesReadsTextAttachments(t *testing.T) {
	store := fakeSplitAttachmentStorage{
		"workspaces/ws/task-breakdown.md": strings.Join([]string{
			"## Task 1: Create importer",
			"Build the import command.",
			"",
			"## Task 2: Add tests",
			"Cover retry behavior.",
		}, "\n"),
		"workspaces/ws/diagram.png": "not markdown",
		"workspaces/ws/large.md":    strings.Repeat("x", maxSplitRecoveryAttachmentBytes+1),
	}

	payload, err := recoverSplitGeneratedTaskPayloadFromAttachmentCandidates(context.Background(), store, []db.MulticaAttachment{
		{
			Filename:    "diagram.png",
			Url:         "https://cdn.example/workspaces/ws/diagram.png",
			ContentType: "image/png",
			SizeBytes:   12,
		},
		{
			Filename:    "large.md",
			Url:         "https://cdn.example/workspaces/ws/large.md",
			ContentType: "text/markdown",
			SizeBytes:   int64(maxSplitRecoveryAttachmentBytes + 1),
		},
		{
			Filename:    "task-breakdown.md",
			Url:         "https://cdn.example/workspaces/ws/task-breakdown.md",
			ContentType: "text/markdown",
			SizeBytes:   128,
		},
	})
	if err != nil {
		t.Fatalf("recoverSplitGeneratedTaskPayloadFromAttachmentCandidates: %v", err)
	}
	if len(payload.Tasks) != 2 {
		t.Fatalf("task count = %d, want 2", len(payload.Tasks))
	}
	if payload.Tasks[0].Title != "Create importer" || payload.Tasks[1].Title != "Add tests" {
		t.Fatalf("task titles = %q / %q", payload.Tasks[0].Title, payload.Tasks[1].Title)
	}
}

func TestSplitRepairTaskContextHelpers(t *testing.T) {
	sourceTaskID := pgtype.UUID{Bytes: [16]byte{8}, Valid: true}
	extras := splitRepairContextExtras(db.MulticaAgentTaskQueue{
		ID:     sourceTaskID,
		Result: []byte(`{"output":"original failed output"}`),
	}, fmt.Errorf("local recovery failed"))
	if extras["repair"] != true {
		t.Fatalf("repair context repair = %v, want true", extras["repair"])
	}
	if extras["repair_source_task_id"] != "08000000-0000-0000-0000-000000000000" {
		t.Fatalf("repair source task = %v", extras["repair_source_task_id"])
	}
	if extras["repair_source_output"] != "original failed output" {
		t.Fatalf("repair source output = %v", extras["repair_source_output"])
	}
	if extras["repair_reason"] != "local recovery failed" {
		t.Fatalf("repair reason = %v", extras["repair_reason"])
	}

	if !isSplitRepairPhase([]byte(`{"type":"workflow","phase":"split_repair","repair":true}`)) {
		t.Fatalf("isSplitRepairPhase(repair context) = false, want true")
	}
	if isSplitRepairPhase([]byte(`{"type":"workflow","phase":"split_repair"}`)) {
		t.Fatalf("isSplitRepairPhase(non-repair context) = true, want false")
	}
}

type fakeSplitAttachmentStorage map[string]string

func (s fakeSplitAttachmentStorage) KeyFromURL(rawURL string) string {
	rawURL = strings.TrimPrefix(rawURL, "https://cdn.example/")
	return rawURL
}

func (s fakeSplitAttachmentStorage) GetReader(_ context.Context, key string) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader(s[key])), nil
}

func TestValidateSplitDraftDeletionTarget(t *testing.T) {
	nodeRunID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	otherNodeRunID := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	materializedIssueID := pgtype.UUID{Bytes: [16]byte{3}, Valid: true}

	tests := []struct {
		name    string
		task    db.MulticaWorkflowSplitTask
		wantErr string
	}{
		{
			name: "allows draft task from same node run",
			task: db.MulticaWorkflowSplitTask{
				NodeRunID: nodeRunID,
				Status:    SplitTaskStatusDraft,
			},
		},
		{
			name: "allows already discarded task from same node run",
			task: db.MulticaWorkflowSplitTask{
				NodeRunID: nodeRunID,
				Status:    SplitTaskStatusDiscarded,
			},
		},
		{
			name: "rejects task from another node run",
			task: db.MulticaWorkflowSplitTask{
				NodeRunID: otherNodeRunID,
				Status:    SplitTaskStatusDraft,
			},
			wantErr: "does not belong",
		},
		{
			name: "rejects approved task",
			task: db.MulticaWorkflowSplitTask{
				NodeRunID: nodeRunID,
				Status:    SplitTaskStatusApproved,
			},
			wantErr: "cannot be deleted",
		},
		{
			name: "rejects materialized task",
			task: db.MulticaWorkflowSplitTask{
				NodeRunID: nodeRunID,
				Status:    SplitTaskStatusDraft,
				IssueID:   materializedIssueID,
			},
			wantErr: "materialized",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateSplitDraftDeletionTarget(nodeRunID, tt.task)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("validateSplitDraftDeletionTarget() error = %v, want nil", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("validateSplitDraftDeletionTarget() error = %v, want containing %q", err, tt.wantErr)
			}
		})
	}
}

func TestSplitTasksToSummary(t *testing.T) {
	taskID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	workflowID := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}

	tasks := []db.MulticaWorkflowSplitTask{
		{
			ID:          taskID,
			Title:       "Build API",
			Description: "Create the API endpoint",
			Status:      SplitTaskStatusDraft,
			WorkflowID:  workflowID,
			DependsOn:   []byte(`["other-id"]`),
			SortOrder:   1,
			DraftKey:    pgtype.Text{String: "task-1", Valid: true},
			DraftSource: "chat",
		},
		{
			ID:     pgtype.UUID{Bytes: [16]byte{3}, Valid: true},
			Title:  "Discarded Task",
			Status: SplitTaskStatusDiscarded,
		},
	}

	summary := splitTasksToSummary(tasks)
	if len(summary) != 1 {
		t.Fatalf("splitTasksToSummary returned %d items, want 1", len(summary))
	}

	item := summary[0]
	if id, ok := item["id"].(string); !ok || id != "01000000-0000-0000-0000-000000000000" {
		t.Fatalf("id = %v, want 01000000-...", item["id"])
	}
	if title, ok := item["title"].(string); !ok || title != "Build API" {
		t.Fatalf("title = %v, want Build API", item["title"])
	}
	if status, ok := item["status"].(string); !ok || status != SplitTaskStatusDraft {
		t.Fatalf("status = %v, want draft", item["status"])
	}
	if workflowID, ok := item["workflow_id"].(string); !ok || workflowID != "02000000-0000-0000-0000-000000000000" {
		t.Fatalf("workflow_id = %v, want 02000000-...", item["workflow_id"])
	}
	if _, ok := item["suggested_assignee_type"]; ok {
		t.Fatalf("summary should not include suggested_assignee_type: %+v", item)
	}
	if _, ok := item["suggested_assignee_id"]; ok {
		t.Fatalf("summary should not include suggested_assignee_id: %+v", item)
	}
	dependsOn, ok := item["depends_on"].([]string)
	if !ok || len(dependsOn) != 1 || dependsOn[0] != "other-id" {
		t.Fatalf("depends_on = %v, want [other-id]", item["depends_on"])
	}
	if sortOrder, ok := item["sort_order"].(int32); !ok || sortOrder != 1 {
		t.Fatalf("sort_order = %v, want 1", item["sort_order"])
	}
	if draftKey, ok := item["draft_key"].(string); !ok || draftKey != "task-1" {
		t.Fatalf("draft_key = %v, want task-1", item["draft_key"])
	}
	if draftSource, ok := item["draft_source"].(string); !ok || draftSource != "chat" {
		t.Fatalf("draft_source = %v, want chat", item["draft_source"])
	}
}

func TestSplitChatAppliedDraftMutation(t *testing.T) {
	context := []byte(`{
		"phase": "split_chat",
		"current_drafts": [
			{
				"id": "01000000-0000-0000-0000-000000000000",
				"title": "Initial draft",
				"description": "Before chat",
				"status": "draft",
				"workflow_id": "",
				"depends_on": [],
				"sort_order": 0,
				"draft_key": "initial-draft"
			}
		]
	}`)

	unchanged := []db.MulticaWorkflowSplitTask{
		{
			ID:          pgtype.UUID{Bytes: [16]byte{1}, Valid: true},
			Title:       "Initial draft",
			Description: "Before chat",
			Status:      SplitTaskStatusDraft,
			SortOrder:   0,
			DraftKey:    pgtype.Text{String: "initial-draft", Valid: true},
			DraftSource: DraftSourceAgent,
		},
	}
	if splitChatAppliedDraftMutation(context, unchanged) {
		t.Fatal("unchanged drafts must not count as applied chat mutation")
	}

	addedByChat := append([]db.MulticaWorkflowSplitTask{}, unchanged...)
	addedByChat = append(addedByChat, db.MulticaWorkflowSplitTask{
		ID:          pgtype.UUID{Bytes: [16]byte{2}, Valid: true},
		Title:       "Security review",
		Description: "Added through draft API",
		Status:      SplitTaskStatusDraft,
		SortOrder:   1,
		DraftKey:    pgtype.Text{String: "security-review", Valid: true},
		DraftSource: DraftSourceChat,
	})
	if !splitChatAppliedDraftMutation(context, addedByChat) {
		t.Fatal("chat-sourced draft change must count as applied mutation")
	}

	changedWithoutChatSource := []db.MulticaWorkflowSplitTask{
		{
			ID:          pgtype.UUID{Bytes: [16]byte{1}, Valid: true},
			Title:       "Human edited draft",
			Description: "Before chat",
			Status:      SplitTaskStatusDraft,
			SortOrder:   0,
			DraftKey:    pgtype.Text{String: "initial-draft", Valid: true},
			DraftSource: DraftSourceAgent,
		},
	}
	if splitChatAppliedDraftMutation(context, changedWithoutChatSource) {
		t.Fatal("changed drafts without chat source must not count as applied chat mutation")
	}
}

func TestSplitChatRejectsWhenNotAwaitingReview(t *testing.T) {
	ctx := context.Background()
	orch := NewSplitOrchestrator(nil, nil, nil, nil)

	nonAwaitingStatuses := []string{
		"splitting",
		"split_active",
		"completed",
		"failed",
		"cancelled",
	}

	for _, status := range nonAwaitingStatuses {
		t.Run(status, func(t *testing.T) {
			nodeRun := db.MulticaWorkflowNodeRun{
				Status: status,
			}
			_, err := orch.SplitChat(ctx, nodeRun, pgtype.UUID{}, SplitChatRequest{
				Message: "adjust the plan",
			})
			if err == nil {
				t.Fatal("SplitChat: expected error for non-awaiting review status, got nil")
			}
			if !strings.Contains(err.Error(), "awaiting review") {
				t.Fatalf("SplitChat: error = %q, want containing 'awaiting review'", err.Error())
			}
		})
	}
}

func TestSplitChatRejectsEmptyMessage(t *testing.T) {
	ctx := context.Background()
	orch := NewSplitOrchestrator(nil, nil, nil, nil)

	nodeRun := db.MulticaWorkflowNodeRun{
		Status: NodeRunStatusAwaitingSplitReview,
	}
	_, err := orch.SplitChat(ctx, nodeRun, pgtype.UUID{}, SplitChatRequest{
		Message: "",
	})
	if err == nil {
		t.Fatal("SplitChat: expected error for empty message, got nil")
	}
	if !strings.Contains(err.Error(), "chat message is required") {
		t.Fatalf("SplitChat: error = %q, want containing 'chat message is required'", err.Error())
	}
}

func TestShouldProcessSplitTaskCompletionIncludesSplitChatReview(t *testing.T) {
	if !shouldProcessSplitTaskCompletion(NodeRunStatusAwaitingSplitReview, []byte(`{"phase":"split_chat"}`)) {
		t.Fatal("split chat completion in awaiting_split_review must be processed")
	}

	if !shouldProcessSplitTaskCompletion(NodeRunStatusSplitting, []byte(`{"phase":"split_generate"}`)) {
		t.Fatal("split generation completion in splitting must be processed")
	}

	if shouldProcessSplitTaskCompletion(NodeRunStatusAwaitingSplitReview, []byte(`{"phase":"split_generate"}`)) {
		t.Fatal("split generation completion must not be processed from awaiting_split_review")
	}
}

func TestSplitProgressSummaryCountsByStatus(t *testing.T) {
	taskID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	tasks := []db.MulticaWorkflowSplitTask{
		{ID: taskID, Title: "Task A", Status: SplitTaskStatusDraft},
		{ID: pgtype.UUID{Bytes: [16]byte{2}, Valid: true}, Title: "Task B", Status: SplitTaskStatusApproved},
		{ID: pgtype.UUID{Bytes: [16]byte{3}, Valid: true}, Title: "Task C", Status: SplitTaskStatusCreated},
		{ID: pgtype.UUID{Bytes: [16]byte{4}, Valid: true}, Title: "Task D", Status: SplitTaskStatusRunning},
		{ID: pgtype.UUID{Bytes: [16]byte{5}, Valid: true}, Title: "Task E", Status: SplitTaskStatusDone},
		{ID: pgtype.UUID{Bytes: [16]byte{6}, Valid: true}, Title: "Task F", Status: SplitTaskStatusFailed},
		{ID: pgtype.UUID{Bytes: [16]byte{7}, Valid: true}, Title: "Task G", Status: SplitTaskStatusCancelled},
		{ID: pgtype.UUID{Bytes: [16]byte{8}, Valid: true}, Title: "Task H", Status: SplitTaskStatusSkipped},
		{ID: pgtype.UUID{Bytes: [16]byte{9}, Valid: true}, Title: "Task I", Status: SplitTaskStatusDiscarded},
	}

	summary := splitProgressSummary(tasks)
	if summary["total"] != 6 {
		t.Fatalf("total = %d, want 6 (only executable statuses counted)", summary["total"])
	}
	if summary["draft"] != 1 {
		t.Fatalf("draft = %d, want 1", summary["draft"])
	}
	if summary["approved"] != 1 {
		t.Fatalf("approved = %d, want 1", summary["approved"])
	}
	if summary["created"] != 1 {
		t.Fatalf("created = %d, want 1", summary["created"])
	}
	if summary["running"] != 1 {
		t.Fatalf("running = %d, want 1", summary["running"])
	}
	if summary["done"] != 1 {
		t.Fatalf("done = %d, want 1", summary["done"])
	}
	if summary["failed"] != 1 {
		t.Fatalf("failed = %d, want 1", summary["failed"])
	}
	if summary["cancelled"] != 1 {
		t.Fatalf("cancelled = %d, want 1", summary["cancelled"])
	}
	if summary["skipped"] != 1 {
		t.Fatalf("skipped = %d, want 1", summary["skipped"])
	}
}

func TestSplitChatDispatchesAgentTaskAndReturnsChatSessionID(t *testing.T) {
	t.Skip("requires database — full integration test for SplitChat dispatch flow")
}

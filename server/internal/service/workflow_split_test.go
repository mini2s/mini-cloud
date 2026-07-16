package service

import (
	"context"
	"fmt"
	"io"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

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

func TestResolveSplitPipelineCompletesAfterMaterialization(t *testing.T) {
	tasks := []splitTaskPlan{
		{ID: "a", Status: SplitTaskStatusCreated},
		{ID: "b", Status: SplitTaskStatusRunning},
	}
	got := resolveSplitStatus(SplitModePipeline, 0, tasks)
	if got != NodeRunStatusCompleted {
		t.Fatalf("resolveSplitStatus pipeline = %s, want %s", got, NodeRunStatusCompleted)
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
	if summary["total"] != 8 {
		t.Fatalf("total = %d, want 8 (discarded excluded)", summary["total"])
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

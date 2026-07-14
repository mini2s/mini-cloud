package service

import (
	"context"
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

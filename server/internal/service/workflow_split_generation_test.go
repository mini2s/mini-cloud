package service

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestHandleNodeRunStatusChangedDoesNotStartLegacySplitGeneration(t *testing.T) {
	orchestrator := &SplitOrchestrator{}
	if err := orchestrator.HandleNodeRunStatusChanged(context.Background(), db.MulticaWorkflowNodeRun{
		Status: NodeRunStatusSplitting,
	}); err != nil {
		t.Fatalf("splitting status callback must leave generation-bound dispatch to the worker: %v", err)
	}
}

func TestSplitReviewedContentExcerptIsBoundedAndUTF8Safe(t *testing.T) {
	got := splitReviewedContentExcerpt(strings.Repeat("界", maxSplitReviewedContentRunes+10))
	if len([]rune(got)) != maxSplitReviewedContentRunes {
		t.Fatalf("excerpt runes = %d, want %d", len([]rune(got)), maxSplitReviewedContentRunes)
	}
}

func TestMaterializingSplitNodeCanBeCancelled(t *testing.T) {
	if !canCancelSplitNodeStatus(NodeRunStatusMaterializing) {
		t.Fatal("materializing split node must be cancellable")
	}
}

func TestPipelineSplitDoesNotCompleteWithOpenTasks(t *testing.T) {
	for _, status := range []string{SplitTaskStatusCreated, SplitTaskStatusRunning} {
		if got := resolveSplitStatus(SplitModePipeline, 0, []splitTaskPlan{{ID: "task", Status: status}}); got != NodeRunStatusSplitActive {
			t.Fatalf("pipeline status with %s task = %s, want %s", status, got, NodeRunStatusSplitActive)
		}
	}
}

func TestOperationalSplitFailureBlocksWithoutSkippingDependents(t *testing.T) {
	tasks, status := resolveSettledSplitStatus(SplitModeBarrier, 0, []splitTaskPlan{
		{ID: "root", Status: SplitTaskStatusFailed, OperationalFailure: true},
		{ID: "dependent", DependsOn: []string{"root"}, Status: SplitTaskStatusCreated},
	})
	if status != NodeRunStatusBlocked {
		t.Fatalf("split status = %s, want %s", status, NodeRunStatusBlocked)
	}
	if tasks[1].Status != SplitTaskStatusCreated {
		t.Fatalf("dependent status = %s, want %s", tasks[1].Status, SplitTaskStatusCreated)
	}
}

func TestExecutionSplitFailureStillHonorsFailureThreshold(t *testing.T) {
	tasks, status := resolveSettledSplitStatus(SplitModeBarrier, 0, []splitTaskPlan{
		{ID: "root", Status: SplitTaskStatusFailed},
		{ID: "dependent", DependsOn: []string{"root"}, Status: SplitTaskStatusCreated},
	})
	if status != NodeRunStatusFailed {
		t.Fatalf("split status = %s, want %s", status, NodeRunStatusFailed)
	}
	if tasks[1].Status != SplitTaskStatusSkipped {
		t.Fatalf("dependent status = %s, want %s", tasks[1].Status, SplitTaskStatusSkipped)
	}
}

func TestSplitOperationalFailureClassification(t *testing.T) {
	materializationFailure := db.MulticaWorkflowSplitTask{Status: SplitTaskStatusFailed}
	if !isSplitOperationalFailure(materializationFailure) {
		t.Fatal("unmaterialized failed task must be operational")
	}

	for _, code := range []string{"split_assignee_invalidated", "split_child_dispatch_failed"} {
		task := db.MulticaWorkflowSplitTask{
			Status:    SplitTaskStatusFailed,
			IssueID:   pgtype.UUID{Valid: true},
			LastError: []byte(`{"code":"` + code + `"}`),
		}
		if !isSplitOperationalFailure(task) {
			t.Fatalf("failure code %q must be operational", code)
		}
	}

	executionFailure := db.MulticaWorkflowSplitTask{
		Status:    SplitTaskStatusFailed,
		IssueID:   pgtype.UUID{Valid: true},
		LastError: []byte(`{"code":"split_child_execution_failed"}`),
	}
	if isSplitOperationalFailure(executionFailure) {
		t.Fatal("child execution failure must continue to use max_failures")
	}
}

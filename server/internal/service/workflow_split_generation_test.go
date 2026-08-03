package service

import (
	"context"
	"strings"
	"testing"

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

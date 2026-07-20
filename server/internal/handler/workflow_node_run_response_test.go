package handler

import (
	"testing"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestWorkflowNodeRunToResponseIncludesSplitReviewChatSessionID(t *testing.T) {
	nodeRun := db.MulticaWorkflowNodeRun{
		SplitReviewChatSessionID: parseUUID("82143ff9-46d9-4b99-9278-c26d78b33ac0"),
	}

	resp := workflowNodeRunToResponse(nodeRun)
	if resp.SplitReviewChatSessionID == nil || *resp.SplitReviewChatSessionID != "82143ff9-46d9-4b99-9278-c26d78b33ac0" {
		t.Fatalf("SplitReviewChatSessionID = %v, want %q", resp.SplitReviewChatSessionID, "82143ff9-46d9-4b99-9278-c26d78b33ac0")
	}
}

func TestWorkflowNodeRunToResponseIncludesSplitConfigVersion(t *testing.T) {
	nodeRun := db.MulticaWorkflowNodeRun{SplitConfigVersion: 7}

	resp := workflowNodeRunToResponse(nodeRun)
	if resp.SplitConfigVersion != 7 {
		t.Fatalf("SplitConfigVersion = %d, want 7", resp.SplitConfigVersion)
	}
}

package handler

import (
	"testing"

	"github.com/multica-ai/multica/server/internal/service"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestSplitProgressResponseCountsStatuses(t *testing.T) {
	progress := splitProgressResponse([]db.MulticaWorkflowSplitTask{
		{Status: service.SplitTaskStatusDraft},
		{Status: service.SplitTaskStatusApproved},
		{Status: service.SplitTaskStatusCreated},
		{Status: service.SplitTaskStatusRunning},
		{Status: service.SplitTaskStatusDone},
		{Status: service.SplitTaskStatusFailed},
		{Status: service.SplitTaskStatusCancelled},
		{Status: service.SplitTaskStatusSkipped},
		{Status: service.SplitTaskStatusDiscarded},
	})

	if progress.Total != 6 {
		t.Fatalf("expected total=6 executable tasks, got %d", progress.Total)
	}
	if progress.Created != 1 || progress.Running != 1 || progress.Done != 1 || progress.Failed != 1 || progress.Cancelled != 1 || progress.Skipped != 1 {
		t.Fatalf("unexpected split progress: %+v", progress)
	}
}

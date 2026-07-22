package service

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestSelectWorkflowRuntimeKeepsAgentBinding(t *testing.T) {
	runtimeID := runtimeTestUUID(7)
	service := &WorkflowService{}

	selection, err := service.selectWorkflowRuntime(
		context.Background(),
		nil,
		db.MulticaWorkflowRun{},
		db.MulticaAgent{RuntimeID: runtimeID},
	)
	if err != nil {
		t.Fatalf("select runtime: %v", err)
	}
	if selection.RuntimeID != runtimeID || selection.Reason != RuntimeSelectionAgentBinding {
		t.Fatalf("got runtime=%v reason=%q, want agent binding", selection.RuntimeID, selection.Reason)
	}
}

func runtimeTestUUID(value byte) pgtype.UUID {
	var bytes [16]byte
	bytes[15] = value
	return pgtype.UUID{Bytes: bytes, Valid: true}
}

func TestChooseWorkflowRuntimePriority(t *testing.T) {
	manualID := runtimeTestUUID(1)
	idleID := runtimeTestUUID(2)
	ownerBusyID := runtimeTestUUID(3)
	ownerID := runtimeTestUUID(4)
	run := db.MulticaWorkflowRun{
		RuntimeID:         manualID,
		ResponsibleUserID: ownerID,
	}
	candidates := []db.ListWorkflowRuntimeCandidatesRow{
		{ID: ownerBusyID, OwnerID: ownerID, ActiveTaskCount: 1},
		{ID: idleID, ActiveTaskCount: 0},
		{ID: manualID, ActiveTaskCount: 8},
	}

	selection, err := chooseWorkflowRuntime(run, candidates)
	if err != nil {
		t.Fatalf("choose runtime: %v", err)
	}
	if selection.RuntimeID != manualID || selection.Reason != RuntimeSelectionManual {
		t.Fatalf("got runtime=%v reason=%q, want manual runtime", selection.RuntimeID, selection.Reason)
	}
}

func TestChooseWorkflowRuntimeFallsBackToIdle(t *testing.T) {
	missingManualID := runtimeTestUUID(1)
	idleID := runtimeTestUUID(2)
	run := db.MulticaWorkflowRun{RuntimeID: missingManualID}
	candidates := []db.ListWorkflowRuntimeCandidatesRow{
		{ID: runtimeTestUUID(3), ActiveTaskCount: 2},
		{ID: idleID, ActiveTaskCount: 0},
	}

	selection, err := chooseWorkflowRuntime(run, candidates)
	if err != nil {
		t.Fatalf("choose runtime: %v", err)
	}
	if selection.RuntimeID != idleID || selection.Reason != RuntimeSelectionIdle {
		t.Fatalf("got runtime=%v reason=%q, want idle runtime", selection.RuntimeID, selection.Reason)
	}
}

func TestChooseWorkflowRuntimeUsesLeastLoadedIssueCreatorRuntime(t *testing.T) {
	ownerID := runtimeTestUUID(1)
	leastLoadedID := runtimeTestUUID(2)
	run := db.MulticaWorkflowRun{ResponsibleUserID: ownerID}
	candidates := []db.ListWorkflowRuntimeCandidatesRow{
		{ID: runtimeTestUUID(3), OwnerID: ownerID, ActiveTaskCount: 5},
		{ID: runtimeTestUUID(4), OwnerID: runtimeTestUUID(9), ActiveTaskCount: 1},
		{ID: leastLoadedID, OwnerID: ownerID, ActiveTaskCount: 2},
	}

	selection, err := chooseWorkflowRuntime(run, candidates)
	if err != nil {
		t.Fatalf("choose runtime: %v", err)
	}
	if selection.RuntimeID != leastLoadedID || selection.Reason != RuntimeSelectionIssueCreator {
		t.Fatalf("got runtime=%v reason=%q, want issue creator runtime", selection.RuntimeID, selection.Reason)
	}
}

func TestChooseWorkflowRuntimeFailsWithoutCandidate(t *testing.T) {
	_, err := chooseWorkflowRuntime(db.MulticaWorkflowRun{}, nil)
	if !errors.Is(err, ErrWorkflowRuntimeUnavailable) {
		t.Fatalf("got %v, want ErrWorkflowRuntimeUnavailable", err)
	}
}

func TestWorkflowTaskPhase(t *testing.T) {
	if got := workflowTaskPhase([]byte(`{"phase":"critic"}`)); got != "critic" {
		t.Fatalf("got %q, want critic", got)
	}
	if got := workflowTaskPhase([]byte(`{"phase":"worker"}`)); got != "worker" {
		t.Fatalf("got %q, want worker", got)
	}
}

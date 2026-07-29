package service

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestIssueAssignmentServiceRejectsUnsupportedAssigneeType(t *testing.T) {
	svc := &IssueAssignmentService{}
	err := svc.ValidateAssignee(
		context.Background(),
		nil,
		pgtype.UUID{Bytes: [16]byte{1}, Valid: true},
		AssignmentActor{Type: "member", ID: pgtype.UUID{Bytes: [16]byte{2}, Valid: true}},
		AssigneeRef{Type: "api", ID: pgtype.UUID{Bytes: [16]byte{3}, Valid: true}},
	)
	if !errors.Is(err, ErrInvalidAssignee) {
		t.Fatalf("ValidateAssignee() error = %v, want ErrInvalidAssignee", err)
	}
}

func TestIssueAssignmentServiceStampsFailedWorkflowRun(t *testing.T) {
	fixture := newWorkflowPrepareFixture(t, false)
	defer fixture.cleanup(t)

	queries := db.New(fixture.pool)
	issue, err := queries.CreateIssue(fixture.ctx, db.CreateIssueParams{
		WorkspaceID:  fixture.workspaceID,
		Title:        "Invalid workflow assignment",
		Status:       "todo",
		Priority:     "none",
		AssigneeType: pgtype.Text{String: "workflow", Valid: true},
		AssigneeID:   fixture.workflowID,
		CreatorType:  "member",
		CreatorID:    fixture.userID,
		Number:       1,
		WorkflowID:   fixture.workflowID,
	})
	if err != nil {
		t.Fatal(err)
	}

	assignment := &IssueAssignmentService{
		Queries:   queries,
		Tasks:     &TaskService{Queries: queries},
		Workflows: fixture.service,
	}
	err = assignment.AfterIssueAssigned(
		fixture.ctx,
		db.MulticaIssue{},
		issue,
		AssignmentActor{Type: "member", ID: fixture.userID},
		RuntimeSelection{},
	)
	var invalid *WorkflowConfigInvalidError
	if !errors.As(err, &invalid) {
		t.Fatalf("assignment error=%v, want WorkflowConfigInvalidError", err)
	}

	updated, err := queries.GetIssue(fixture.ctx, issue.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.WorkflowRunID != invalid.RunID {
		t.Fatalf("workflow_run_id=%v, want failed run %v", updated.WorkflowRunID, invalid.RunID)
	}
}

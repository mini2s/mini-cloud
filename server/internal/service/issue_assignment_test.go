package service

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
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

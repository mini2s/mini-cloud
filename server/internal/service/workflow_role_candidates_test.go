package service

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestNormalizeWorkflowRoleMemberCandidates(t *testing.T) {
	member1 := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	member2 := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	member3 := pgtype.UUID{Bytes: [16]byte{3}, Valid: true}
	member4 := pgtype.UUID{Bytes: [16]byte{4}, Valid: true}
	member5 := pgtype.UUID{Bytes: [16]byte{5}, Valid: true}
	user1 := pgtype.UUID{Bytes: [16]byte{11}, Valid: true}
	user2 := pgtype.UUID{Bytes: [16]byte{12}, Valid: true}
	user3 := pgtype.UUID{Bytes: [16]byte{13}, Valid: true}
	user4 := pgtype.UUID{Bytes: [16]byte{14}, Valid: true}
	user5 := pgtype.UUID{Bytes: [16]byte{15}, Valid: true}

	rows := []db.ListActiveWorkflowRoleCandidateMembersRow{
		{
			MemberID:    member1,
			UserID:      user1,
			SubjectID:   pgtype.Text{String: " universal-1 ", Valid: true},
			DisplayName: " Alice ",
		},
		{
			MemberID:    member2,
			UserID:      user2,
			SubjectID:   pgtype.Text{String: "legacy-2", Valid: true},
			DisplayName: "Bob",
		},
		{
			MemberID:    member3,
			UserID:      user3,
			SubjectID:   pgtype.Text{String: "duplicate", Valid: true},
			DisplayName: "Carol",
		},
		{
			MemberID:    member4,
			UserID:      user4,
			SubjectID:   pgtype.Text{String: "duplicate", Valid: true},
			DisplayName: "Dan",
		},
		{
			MemberID:    member5,
			UserID:      user5,
			DisplayName: "Eve",
		},
	}

	got := normalizeWorkflowRoleMemberCandidates(rows)
	if len(got) != 2 {
		t.Fatalf("expected 2 candidates, got %d: %#v", len(got), got)
	}
	if got[0].ExternalIdentity != "universal-1" || got[0].DisplayName != "Alice" {
		t.Fatalf("unexpected first candidate: %#v", got[0])
	}
	if got[1].ExternalIdentity != "legacy-2" || got[1].DisplayName != "Bob" {
		t.Fatalf("unexpected second candidate: %#v", got[1])
	}
}

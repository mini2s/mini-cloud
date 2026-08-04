package service

import (
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestBuildSplitPromptMemberContextIncludesProfileAndSnapshotPosition(t *testing.T) {
	members := make([]db.ListActiveWorkflowRoleCandidateMembersRow, maxSplitPromptMembers+1)
	for i := range members {
		members[i] = db.ListActiveWorkflowRoleCandidateMembersRow{
			MemberID:           pgtype.UUID{Bytes: [16]byte{byte(i + 1)}, Valid: true},
			DisplayName:        fmt.Sprintf(" Member %d ", i+1),
			Email:              fmt.Sprintf(" member-%d@example.com ", i+1),
			ProfileDescription: fmt.Sprintf(" Profile %d ", i+1),
			Position:           pgtype.Text{String: fmt.Sprintf(" Position %d ", i+1), Valid: true},
		}
	}
	members[1].Position = pgtype.Text{String: "must not leak", Valid: false}

	got, truncated := buildSplitPromptMemberContext(members)
	if !truncated {
		t.Fatal("expected roster truncation above the member limit")
	}
	if len(got) != maxSplitPromptMembers {
		t.Fatalf("member context length = %d, want %d", len(got), maxSplitPromptMembers)
	}
	if got[0]["display_name"] != "Member 1" || got[0]["email"] != "member-1@example.com" {
		t.Fatalf("member identity fields were not trimmed: %#v", got[0])
	}
	if got[0]["description"] != "Profile 1" || got[0]["position"] != "Position 1" {
		t.Fatalf("member context missing profile or position snapshot: %#v", got[0])
	}
	if got[1]["position"] != "" {
		t.Fatalf("invalid position snapshot must be omitted: %#v", got[1])
	}
}

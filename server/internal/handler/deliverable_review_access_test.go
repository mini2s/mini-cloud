package handler

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// canReviewDeliverable gates deliverable approve/reject on a workspace
// owner/admin, the issue's creator, the issue's assignee, or the node-run's
// designated critic. creator/assignee/critic ids are user_id under their
// member/human forms (see task.go creator mapping and workflow.go critic
// default = issue.CreatorID).
func TestCanReviewDeliverable(t *testing.T) {
	const me = "11111111-1111-1111-1111-111111111111"
	const someone = "22222222-2222-2222-2222-222222222222"

	// Issue created and assigned to someone else.
	issueOwnedByOthers := db.MulticaIssue{
		CreatorType:  "member",
		CreatorID:    parseUUID(someone),
		AssigneeType: pgtype.Text{String: "member", Valid: true},
		AssigneeID:   parseUUID(someone),
	}
	// Node-run whose critic is someone else.
	nodeRunCriticOther := db.MulticaWorkflowNodeRun{
		CriticType: "human",
		CriticID:   parseUUID(someone),
	}

	tests := []struct {
		name    string
		role    string
		userID  string
		issue   db.MulticaIssue
		nodeRun db.MulticaWorkflowNodeRun
		want    bool
	}{
		{"workspace owner", "owner", me, issueOwnedByOthers, nodeRunCriticOther, true},
		{"workspace admin", "admin", me, issueOwnedByOthers, nodeRunCriticOther, true},
		{"issue creator", "member", me,
			db.MulticaIssue{CreatorType: "member", CreatorID: parseUUID(me)},
			nodeRunCriticOther, true},
		{"issue assignee", "member", me,
			db.MulticaIssue{CreatorType: "member", CreatorID: parseUUID(someone), AssigneeType: pgtype.Text{String: "member", Valid: true}, AssigneeID: parseUUID(me)},
			nodeRunCriticOther, true},
		{"designated critic", "member", me,
			issueOwnedByOthers,
			db.MulticaWorkflowNodeRun{CriticType: "human", CriticID: parseUUID(me)}, true},
		{"unrelated member rejected", "member", me, issueOwnedByOthers, nodeRunCriticOther, false},
		{"empty role rejected", "", me, issueOwnedByOthers, nodeRunCriticOther, false},
		{"agent assignee does not match human user", "member", me,
			db.MulticaIssue{CreatorType: "member", CreatorID: parseUUID(someone), AssigneeType: pgtype.Text{String: "agent", Valid: true}, AssigneeID: parseUUID(me)},
			nodeRunCriticOther, false},
		{"agent critic does not match via critic rule", "member", me,
			issueOwnedByOthers,
			db.MulticaWorkflowNodeRun{CriticType: "agent", CriticID: parseUUID(me)}, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := canReviewDeliverable(tc.role, tc.userID, tc.nodeRun, tc.issue)
			if got != tc.want {
				t.Fatalf("canReviewDeliverable(role=%q, userID=%q) = %v, want %v", tc.role, tc.userID, got, tc.want)
			}
		})
	}
}

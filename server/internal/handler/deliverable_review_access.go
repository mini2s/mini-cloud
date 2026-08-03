package handler

import (
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// canReviewDeliverable is the pure predicate gating deliverable approve/reject
// (ReviewNodeRunDeliverable). A member may review a node-run deliverable when
// they are any of:
//
//   - a workspace owner or admin (roleAllowed),
//   - the issue's assignee (AssigneeType == "member", AssigneeID == userID),
//   - the node-run's designated human critic (CriticType == "human",
//     CriticID == userID).
//
// Assignee/critic ids hold user_id under their member/human forms, so both
// compare against userID.
func canReviewDeliverable(role, userID string, nodeRun db.MulticaWorkflowNodeRun, issue db.MulticaIssue) bool {
	if roleAllowed(role, "owner", "admin") {
		return true
	}
	if issue.ResponsibleUserID.Valid && uuidToString(issue.ResponsibleUserID) == userID {
		return true
	}
	if nodeRun.CriticType == "human" && uuidToString(nodeRun.CriticID) == userID {
		return true
	}
	return false
}

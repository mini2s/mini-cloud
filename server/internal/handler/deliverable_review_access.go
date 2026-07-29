package handler

import (
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// canReviewDeliverable is the pure predicate gating deliverable approve/reject
// (ReviewNodeRunDeliverable). A member may review a node-run deliverable when
// they are any of:
//
//   - a workspace owner or admin (roleAllowed),
//   - the issue's creator (issue.CreatorType == "member", CreatorID == userID),
//   - the issue's assignee (AssigneeType == "member", AssigneeID == userID),
//   - the node-run's designated human critic (CriticType == "human",
//     CriticID == userID).
//
// creator/assignee/critic ids hold user_id under their member/human forms
// (see task.go's creator→UserID mapping and workflow.go's critic default of
// issue.CreatorID), so all three compare against userID.
func canReviewDeliverable(role, userID string, nodeRun db.MulticaWorkflowNodeRun, issue db.MulticaIssue) bool {
	if roleAllowed(role, "owner", "admin") {
		return true
	}
	if issue.CreatorType == "member" && uuidToString(issue.CreatorID) == userID {
		return true
	}
	if issue.AssigneeType.Valid && issue.AssigneeType.String == "member" && uuidToString(issue.AssigneeID) == userID {
		return true
	}
	if nodeRun.CriticType == "human" && uuidToString(nodeRun.CriticID) == userID {
		return true
	}
	return false
}

package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// createPlainMember inserts a user + a plain (role="member") workspace member
// and returns the user id. Used to act as an unrelated non-privileged member.
func createPlainMember(t *testing.T, email string) string {
	t.Helper()
	ctx := context.Background()
	var userID string
	if err := testPool.QueryRow(ctx,
		`INSERT INTO multica_user (name, email) VALUES ($1, $2) RETURNING id`,
		email, email).Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() { testPool.Exec(context.Background(), `DELETE FROM multica_user WHERE id = $1`, userID) })
	if _, err := testPool.Exec(ctx,
		`INSERT INTO multica_member (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
		testWorkspaceID, userID); err != nil {
		t.Fatalf("create member: %v", err)
	}
	return userID
}

// seedReviewableSubmission builds the full chain ReviewNodeRunDeliverable walks:
// an issue created by creatorUserID, bound to the run (source_issue_id), with
// the node-run's critic set to criticUserID, plus a submitted document
// submission. Returns the node-run id and submission id to review.
func seedReviewableSubmission(t *testing.T, creatorUserID, criticUserID string) (nodeRunID, submissionID string) {
	t.Helper()
	ctx := context.Background()

	nrID, deliverableID := seedDeliverableAndNodeRunIn(t, testWorkspaceID, creatorUserID)
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id = $1`, nrID)
	})

	var issueID string
	if err := testPool.QueryRow(ctx,
		`INSERT INTO multica_issue (workspace_id, creator_type, creator_id, title) VALUES ($1, 'member', $2, 'review perm') RETURNING id`,
		testWorkspaceID, creatorUserID).Scan(&issueID); err != nil {
		t.Fatalf("seed issue: %v", err)
	}
	t.Cleanup(func() {
		// Unbind before delete: run.source_issue_id references this issue.
		testPool.Exec(ctx, `UPDATE multica_workflow_run SET source_issue_id = NULL WHERE source_issue_id = $1`, issueID)
		testPool.Exec(ctx, `DELETE FROM multica_issue WHERE id = $1`, issueID)
	})

	var runID string
	if err := testPool.QueryRow(ctx,
		`SELECT workflow_run_id FROM multica_workflow_node_run WHERE id = $1`, nrID).Scan(&runID); err != nil {
		t.Fatalf("load run id: %v", err)
	}
	if _, err := testPool.Exec(ctx,
		`UPDATE multica_workflow_run SET source_issue_id = $2 WHERE id = $1`, runID, issueID); err != nil {
		t.Fatalf("bind issue to run: %v", err)
	}
	if _, err := testPool.Exec(ctx,
		`UPDATE multica_workflow_node_run SET critic_type = 'human', critic_id = $2 WHERE id = $1`, nrID, criticUserID); err != nil {
		t.Fatalf("set node-run critic: %v", err)
	}

	sub, err := testHandler.Queries.UpsertNodeRunDeliverableSubmission(ctx, db.UpsertNodeRunDeliverableSubmissionParams{
		WorkflowNodeRunID: parseUUID(nrID),
		DeliverableID:     parseUUID(deliverableID),
		SubmittedByType:   "member",
		SubmittedByID:     parseUUID(creatorUserID),
		Content:           "# reviewable doc",
	})
	if err != nil {
		t.Fatalf("upsert submission: %v", err)
	}
	return nrID, uuidToString(sub.ID)
}

func reviewDeliverableAs(t *testing.T, userID, nodeRunID, submissionID string) *httptest.ResponseRecorder {
	t.Helper()
	req := newRequestAs(userID, http.MethodPost,
		"/api/node-runs/"+nodeRunID+"/deliverables/"+submissionID+"/review",
		map[string]any{"status": "approved", "review_comment": "ok"})
	req = withURLParams(req, "nodeRunId", nodeRunID, "submissionId", submissionID)
	rec := httptest.NewRecorder()
	testHandler.ReviewNodeRunDeliverable(rec, req)
	return rec
}

// TestReviewNodeRunDeliverable_RejectsNonAuthorMember asserts the permission
// gate: a plain member who is neither owner/admin, the issue creator, the
// assignee, nor the designated critic gets 403.
func TestReviewNodeRunDeliverable_RejectsNonAuthorMember(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	creatorID := createPlainMember(t, "review-perm-creator-"+uuid.NewString()+"@test")
	criticID := createPlainMember(t, "review-perm-critic-"+uuid.NewString()+"@test")
	otherID := createPlainMember(t, "review-perm-other-"+uuid.NewString()+"@test")
	nodeRunID, subID := seedReviewableSubmission(t, creatorID, criticID)

	rec := reviewDeliverableAs(t, otherID, nodeRunID, subID)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (unrelated member). body=%s", rec.Code, rec.Body.String())
	}
}

func TestReviewNodeRunDeliverable_AllowsIssueCreator(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	creatorID := createPlainMember(t, "review-perm-creator-"+uuid.NewString()+"@test")
	criticID := createPlainMember(t, "review-perm-critic-"+uuid.NewString()+"@test")
	nodeRunID, subID := seedReviewableSubmission(t, creatorID, criticID)

	rec := reviewDeliverableAs(t, creatorID, nodeRunID, subID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (issue creator). body=%s", rec.Code, rec.Body.String())
	}
}

func TestReviewNodeRunDeliverable_AllowsDesignatedCritic(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	creatorID := createPlainMember(t, "review-perm-creator-"+uuid.NewString()+"@test")
	criticID := createPlainMember(t, "review-perm-critic-"+uuid.NewString()+"@test")
	nodeRunID, subID := seedReviewableSubmission(t, creatorID, criticID)

	rec := reviewDeliverableAs(t, criticID, nodeRunID, subID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (designated critic). body=%s", rec.Code, rec.Body.String())
	}
}

func TestReviewNodeRunDeliverable_AllowsWorkspaceOwner(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	creatorID := createPlainMember(t, "review-perm-creator-"+uuid.NewString()+"@test")
	criticID := createPlainMember(t, "review-perm-critic-"+uuid.NewString()+"@test")
	nodeRunID, subID := seedReviewableSubmission(t, creatorID, criticID)

	// testUserID is the workspace owner.
	rec := reviewDeliverableAs(t, testUserID, nodeRunID, subID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (workspace owner). body=%s", rec.Code, rec.Body.String())
	}
}

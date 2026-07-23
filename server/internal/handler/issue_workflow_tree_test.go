package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

// issueNumberExpr is a SQL expression yielding a random per-insert issue
// number. Tests insert issues directly (bypassing the workspace counter), so
// each needs a distinct number to satisfy uq_issue_workspace_number; a large
// random range makes collisions with other suite rows negligibly unlikely.
const issueNumberExpr = "(floor(random() * 1000000)::int)"

// TestHandleGetIssueWorkflowTree_Descendants seeds a root issue with a workflow
// run (one node run, one document deliverable, one "submitted" submission) and
// a child issue with its own workflow run (deliverable not yet submitted), then
// requests the workflow tree with ?descendants=true. The endpoint must return
// both issues: root at depth 0 with a non-nil WorkflowRun carrying one node run
// whose deliverable SubmissionStatus == "submitted"; child at depth 1 with a
// non-nil WorkflowRun whose deliverable SubmissionStatus == "" (not yet
// submitted).
func TestHandleGetIssueWorkflowTree_Descendants(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	// Root: workflow run + node run + document deliverable + a submission.
	rootNodeRunID, rootDeliverableID := seedDeliverableAndNodeRunIn(t, testWorkspaceID, testUserID)
	var rootRunID string
	if err := testPool.QueryRow(ctx,
		`SELECT workflow_run_id FROM multica_workflow_node_run WHERE id = $1`,
		rootNodeRunID).Scan(&rootRunID); err != nil {
		t.Fatalf("read root run id: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_node_deliverable_submission (
			workflow_node_run_id, deliverable_id, submitted_by_type, status
		)
		VALUES ($1, $2, 'member', 'submitted')`,
		rootNodeRunID, rootDeliverableID); err != nil {
		t.Fatalf("seed root submission: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id = $1`, rootNodeRunID)
	})

	rootIssueID := uuid.NewString()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_issue (
			id, workspace_id, title, status, priority, creator_type, creator_id,
			workflow_run_id, number
		)
		VALUES ($1, $2, 'Root tree issue', 'todo', 'none', 'member', $3, $4, `+issueNumberExpr+`)`,
		rootIssueID, testWorkspaceID, testUserID, rootRunID); err != nil {
		t.Fatalf("seed root issue: %v", err)
	}
	t.Cleanup(func() { testPool.Exec(ctx, `DELETE FROM multica_issue WHERE id = $1`, rootIssueID) })

	// Child: its own workflow run + deliverable, no submission yet.
	childNodeRunID, _ := seedDeliverableAndNodeRunIn(t, testWorkspaceID, testUserID)
	var childRunID string
	if err := testPool.QueryRow(ctx,
		`SELECT workflow_run_id FROM multica_workflow_node_run WHERE id = $1`,
		childNodeRunID).Scan(&childRunID); err != nil {
		t.Fatalf("read child run id: %v", err)
	}
	childIssueID := uuid.NewString()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_issue (
			id, workspace_id, title, status, priority, creator_type, creator_id,
			workflow_run_id, parent_issue_id, number
		)
		VALUES ($1, $2, 'Child tree issue', 'todo', 'none', 'member', $3, $4, $5, `+issueNumberExpr+`)`,
		childIssueID, testWorkspaceID, testUserID, childRunID, rootIssueID); err != nil {
		t.Fatalf("seed child issue: %v", err)
	}
	t.Cleanup(func() { testPool.Exec(ctx, `DELETE FROM multica_issue WHERE id = $1`, childIssueID) })

	req := newRequestAs(testUserID, http.MethodGet, "/api/daemon/issues/"+rootIssueID+"/workflow-tree?descendants=true", nil)
	req.Header.Set("X-Workspace-ID", testWorkspaceID)
	req = withURLParam(req, "issue", rootIssueID)
	rec := httptest.NewRecorder()

	testHandler.HandleGetIssueWorkflowTree(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var out IssueWorkflowTreeResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(out.Issues) != 2 {
		t.Fatalf("expected 2 issues (root + child), got %d: %+v", len(out.Issues), out)
	}

	root := out.Issues[0]
	if root.Depth != 0 {
		t.Errorf("root depth = %d, want 0", root.Depth)
	}
	if root.WorkflowRun == nil {
		t.Fatalf("root WorkflowRun is nil")
	}
	if len(root.WorkflowRun.NodeRuns) != 1 {
		t.Fatalf("root node runs = %d, want 1", len(root.WorkflowRun.NodeRuns))
	}
	rootDels := root.WorkflowRun.NodeRuns[0].Deliverables
	if len(rootDels) != 1 {
		t.Fatalf("root deliverables = %d, want 1", len(rootDels))
	}
	if rootDels[0].SubmissionStatus != "submitted" {
		t.Errorf("root deliverable SubmissionStatus = %q, want \"submitted\"", rootDels[0].SubmissionStatus)
	}

	child := out.Issues[1]
	if child.Depth != 1 {
		t.Errorf("child depth = %d, want 1", child.Depth)
	}
	if child.WorkflowRun == nil {
		t.Fatalf("child WorkflowRun is nil")
	}
	if len(child.WorkflowRun.NodeRuns) != 1 {
		t.Fatalf("child node runs = %d, want 1", len(child.WorkflowRun.NodeRuns))
	}
	childDels := child.WorkflowRun.NodeRuns[0].Deliverables
	if len(childDels) != 1 {
		t.Fatalf("child deliverables = %d, want 1", len(childDels))
	}
	if childDels[0].SubmissionStatus != "" {
		t.Errorf("child deliverable SubmissionStatus = %q, want \"\" (not yet submitted)", childDels[0].SubmissionStatus)
	}
}

// TestHandleGetIssueWorkflowTree_NoWorkflowRun requests the tree for a single
// issue with no workflow run and no descendants flag. It must return one issue
// with a nil WorkflowRun (and not be filtered out).
func TestHandleGetIssueWorkflowTree_NoWorkflowRun(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	issueID := uuid.NewString()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_issue (
			id, workspace_id, title, status, priority, creator_type, creator_id
		)
		VALUES ($1, $2, 'Bare tree issue', 'todo', 'none', 'member', $3)`,
		issueID, testWorkspaceID, testUserID); err != nil {
		t.Fatalf("seed bare issue: %v", err)
	}
	t.Cleanup(func() { testPool.Exec(ctx, `DELETE FROM multica_issue WHERE id = $1`, issueID) })

	req := newRequestAs(testUserID, http.MethodGet, "/api/daemon/issues/"+issueID+"/workflow-tree", nil)
	req.Header.Set("X-Workspace-ID", testWorkspaceID)
	req = withURLParam(req, "issue", issueID)
	rec := httptest.NewRecorder()

	testHandler.HandleGetIssueWorkflowTree(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var out IssueWorkflowTreeResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(out.Issues) != 1 {
		t.Fatalf("expected 1 issue, got %d: %+v", len(out.Issues), out)
	}
	if out.Issues[0].WorkflowRun != nil {
		t.Fatalf("expected nil WorkflowRun for issue without a run, got %+v", out.Issues[0].WorkflowRun)
	}
}

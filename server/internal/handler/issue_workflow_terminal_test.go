package handler

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/multica-ai/multica/server/internal/service"
)

func TestHandleWorkflowRunTerminalCompletesDirectIssue(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()

	var workflowID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow (workspace_id, title, status, created_by_type, created_by_id)
		VALUES ($1, 'Direct issue terminal workflow', 'active', 'member', $2)
		RETURNING id`,
		testWorkspaceID, testUserID,
	).Scan(&workflowID); err != nil {
		t.Fatalf("seed workflow: %v", err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_workflow WHERE id = $1`, workflowID)
	})

	var nodeID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node (workflow_id, title, worker_type, critic_type)
		VALUES ($1, 'Direct node', 'human', 'human')
		RETURNING id`,
		workflowID,
	).Scan(&nodeID); err != nil {
		t.Fatalf("seed workflow node: %v", err)
	}

	var runID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_run (workflow_id, workspace_id, workflow_title, status, triggered_by_type, triggered_by_id)
		VALUES ($1, $2, 'Direct issue terminal workflow', 'completed', 'member', $3)
		RETURNING id`,
		workflowID, testWorkspaceID, testUserID,
	).Scan(&runID); err != nil {
		t.Fatalf("seed workflow run: %v", err)
	}

	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_node_run (workflow_run_id, workflow_node_id, node_title, status, worker_type, critic_type)
		VALUES ($1, $2, 'Direct node', 'completed', 'human', 'human')`,
		runID, nodeID,
	); err != nil {
		t.Fatalf("seed workflow node run: %v", err)
	}

	issueID := uuid.NewString()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_issue (
			id, workspace_id, title, status, priority, creator_type, creator_id,
			workflow_id, workflow_run_id
		)
		VALUES ($1, $2, 'Direct issue terminal', 'in_review', 'none', 'member', $3, $4, $5)`,
		issueID, testWorkspaceID, testUserID, workflowID, runID,
	); err != nil {
		t.Fatalf("seed direct issue: %v", err)
	}
	t.Cleanup(func() { _, _ = testPool.Exec(context.Background(), `DELETE FROM multica_issue WHERE id = $1`, issueID) })

	run, err := testHandler.Queries.GetWorkflowRun(ctx, parseUUID(runID))
	if err != nil {
		t.Fatalf("get workflow run: %v", err)
	}

	testHandler.handleWorkflowRunTerminal(ctx, run, service.RunStatusCompleted)

	var status string
	if err := testPool.QueryRow(ctx, `SELECT status FROM multica_issue WHERE id = $1`, issueID).Scan(&status); err != nil {
		t.Fatalf("read issue status: %v", err)
	}
	if status != "done" {
		t.Fatalf("issue status = %q, want done", status)
	}
}

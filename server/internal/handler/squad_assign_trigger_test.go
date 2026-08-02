package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestCreateIssueAssignedToSquadWaitsUntilInProgress verifies that creating a
// squad-assigned issue does not trigger the squad leader until a member starts
// the issue by moving it to in_progress.
func TestCreateIssueAssignedToSquadWaitsUntilInProgress(t *testing.T) {
	ctx := context.Background()

	// Look up the seeded test agent — it has a runtime, so it can lead a squad.
	var leaderID string
	if err := testPool.QueryRow(ctx, `
		SELECT id FROM multica_agent WHERE workspace_id = $1 ORDER BY created_at ASC LIMIT 1
	`, testWorkspaceID).Scan(&leaderID); err != nil {
		t.Fatalf("load test agent: %v", err)
	}

	// Create a squad with that agent as leader.
	var squadID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_squad (workspace_id, name, description, leader_id, creator_id)
		VALUES ($1, $2, '', $3, $4)
		RETURNING id
	`, testWorkspaceID, "Trigger Test Squad", leaderID, testUserID).Scan(&squadID); err != nil {
		t.Fatalf("create squad: %v", err)
	}
	defer testPool.Exec(ctx, `DELETE FROM multica_squad WHERE id = $1`, squadID)

	// Create an issue assigned to the squad.
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
		"title":         "Squad-assigned at creation",
		"status":        "todo",
		"assignee_type": "squad",
		"assignee_id":   squadID,
	})
	testHandler.CreateIssue(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateIssue: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var created IssueResponse
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode issue: %v", err)
	}
	defer func() {
		cleanupReq := newRequest("DELETE", "/api/issues/"+created.ID, nil)
		cleanupReq = withURLParam(cleanupReq, "id", created.ID)
		testHandler.DeleteIssue(httptest.NewRecorder(), cleanupReq)
	}()

	var taskCount int
	if err := testPool.QueryRow(ctx, `
		SELECT count(*) FROM multica_agent_task_queue
		WHERE issue_id = $1 AND agent_id = $2
	`, created.ID, leaderID).Scan(&taskCount); err != nil {
		t.Fatalf("count tasks: %v", err)
	}
	if taskCount != 0 {
		t.Fatalf("expected no squad-leader task before in_progress, got %d", taskCount)
	}

	w = httptest.NewRecorder()
	req = newRequest("PUT", "/api/issues/"+created.ID, map[string]any{
		"status": "in_progress",
	})
	req = withURLParam(req, "id", created.ID)
	testHandler.UpdateIssue(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("UpdateIssue: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	if err := testPool.QueryRow(ctx, `
		SELECT count(*) FROM multica_agent_task_queue
		WHERE issue_id = $1 AND agent_id = $2
	`, created.ID, leaderID).Scan(&taskCount); err != nil {
		t.Fatalf("count tasks after in_progress: %v", err)
	}
	if taskCount == 0 {
		t.Fatalf("expected squad-leader task after in_progress, got 0")
	}
}

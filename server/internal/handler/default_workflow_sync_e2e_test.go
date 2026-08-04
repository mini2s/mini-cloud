package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// TestNonWorkflowAssigneeGetsDefaultNodeRun is the end-to-end coverage for the
// status-sync fix's precondition. A member/agent/squad issue moved to in_progress
// must materialize a default-workflow run with a single node-run — that node-run
// is what syncSubIssueForNodeRun mirrors onto the issue so the board card tracks
// execution. For agent/squad a pending worker dispatch job is enqueued too.
//
// This path only activates when Gitea is configured
// (DefaultWorkflowEnabled = isGiteaConfigured), which the rest of the suite does
// NOT set — so without this test the agent/squad default-run wiring that the
// status-sync fix relies on is never exercised through the real HTTP handlers.
func TestNonWorkflowAssigneeGetsDefaultNodeRun(t *testing.T) {
	if testPool == nil {
		t.Skip("testPool not initialized (no DATABASE_URL)")
	}
	// Enable the default-workflow path exactly as a production deployment does.
	t.Setenv("GITEA_BASE_URL", "http://gitea:3000")
	ctx := context.Background()

	// Agent + runtime already seeded by the handler test fixture.
	var agentID string
	if err := testPool.QueryRow(ctx,
		`SELECT id FROM multica_agent WHERE workspace_id = $1 AND runtime_id IS NOT NULL ORDER BY created_at ASC LIMIT 1`,
		testWorkspaceID,
	).Scan(&agentID); err != nil {
		t.Fatalf("load test agent: %v", err)
	}

	// A squad led by that agent, so the squad branch is exercisable.
	var squadID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_squad (workspace_id, name, leader_id, creator_id)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, testWorkspaceID, "default-node e2e squad "+time.Now().Format(time.RFC3339Nano), agentID, testUserID).Scan(&squadID); err != nil {
		t.Fatalf("seed squad: %v", err)
	}
	t.Cleanup(func() { testPool.Exec(ctx, `DELETE FROM multica_squad WHERE id = $1`, squadID) })

	cases := []struct {
		name      string
		assignee  string
		expectJob bool // agent/squad enqueue a worker dispatch job; member (human) does not
	}{
		{name: "member", assignee: testUserID, expectJob: false},
		{name: "agent", assignee: agentID, expectJob: true},
		{name: "squad", assignee: squadID, expectJob: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Create assigned (defaults to todo), then start work by moving to
			// in_progress — the realistic assign-then-start flow that triggers
			// AfterIssueAssigned -> startDefaultWorkflow.
			createW := httptest.NewRecorder()
			createReq := newRequest("POST", "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
				"title":         "default-node e2e " + tc.name + " " + time.Now().Format(time.RFC3339Nano),
				"assignee_type": tc.name,
				"assignee_id":   tc.assignee,
			})
			testHandler.CreateIssue(createW, createReq)
			if createW.Code != http.StatusCreated {
				t.Fatalf("CreateIssue: expected 201, got %d: %s", createW.Code, createW.Body.String())
			}
			var created IssueResponse
			if err := json.NewDecoder(createW.Body).Decode(&created); err != nil {
				t.Fatalf("decode created issue: %v", err)
			}
			t.Cleanup(func() {
				delReq := newRequest("DELETE", "/api/issues/"+created.ID, nil)
				delReq = withURLParam(delReq, "id", created.ID)
				testHandler.DeleteIssue(httptest.NewRecorder(), delReq)
			})

			startW := httptest.NewRecorder()
			startReq := newRequest("PUT", "/api/issues/"+created.ID, map[string]any{"status": "in_progress"})
			startReq = withURLParam(startReq, "id", created.ID)
			testHandler.UpdateIssue(startW, startReq)
			if startW.Code != http.StatusOK {
				t.Fatalf("UpdateIssue -> in_progress: expected 200, got %d: %s", startW.Code, startW.Body.String())
			}

			// The issue must now carry a default-workflow run + a single node-run.
			var runID *string
			var wfID *string
			if err := testPool.QueryRow(ctx,
				`SELECT workflow_run_id::text, workflow_id::text FROM multica_issue WHERE id = $1`,
				created.ID,
			).Scan(&runID, &wfID); err != nil {
				t.Fatalf("read issue workflow stamping: %v", err)
			}
			if runID == nil || *runID == "" {
				t.Fatalf("%s issue has no workflow_run_id after in_progress (default run not created)", tc.name)
			}

			var wfIsDefault bool
			if err := testPool.QueryRow(ctx, `SELECT is_default FROM multica_workflow WHERE id = $1`, *wfID).Scan(&wfIsDefault); err != nil {
				t.Fatalf("load workflow: %v", err)
			}
			if !wfIsDefault {
				t.Fatalf("%s issue run is on a non-default workflow (is_default=false)", tc.name)
			}

			var nodeRunCount int
			var nodeRunID string
			if err := testPool.QueryRow(ctx,
				`SELECT count(*), (SELECT id::text FROM multica_workflow_node_run WHERE workflow_run_id = $1 ORDER BY created_at ASC LIMIT 1)
				 FROM multica_workflow_node_run WHERE workflow_run_id = $1`,
				*runID,
			).Scan(&nodeRunCount, &nodeRunID); err != nil {
				t.Fatalf("count node runs: %v", err)
			}
			if nodeRunCount == 0 {
				t.Fatalf("%s issue default run has no node-run", tc.name)
			}

			if tc.expectJob {
				var jobCount int
				if err := testPool.QueryRow(ctx,
					`SELECT count(*) FROM multica_workflow_node_run_dispatch_job
					 WHERE workflow_node_run_id = $1 AND phase = 'worker' AND status = 'pending'`,
					nodeRunID,
				).Scan(&jobCount); err != nil {
					t.Fatalf("count dispatch jobs: %v", err)
				}
				if jobCount == 0 {
					t.Fatalf("%s issue node-run has no pending worker dispatch job", tc.name)
				}
			}

			// The node-run's worker mirrors the issue assignee (agent for agent/squad).
			var workerType, workerID string
			if err := testPool.QueryRow(ctx,
				`SELECT worker_type, COALESCE(worker_id::text, '') FROM multica_workflow_node_run WHERE id = $1`,
				nodeRunID,
			).Scan(&workerType, &workerID); err != nil {
				t.Fatalf("load node-run worker: %v", err)
			}
			if tc.name == "agent" && (workerType != "agent" || workerID != agentID) {
				t.Fatalf("agent node-run worker = %s/%s, want agent/%s", workerType, workerID, agentID)
			}
		})
	}
}

package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/service"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// workflowSyncFixture is a workflow + node + run + node_run plus the
// sub-issue that the workflow engine creates for the node run
// (origin_type='workflow', origin_id=node_run_id). Tests drive node-run
// status changes and assert that the sub-issue's status change is broadcast
// as an issue:updated event, exactly like a manual status edit.
type workflowSyncFixture struct {
	workflowID string
	runID      string
	nodeRun    db.MulticaWorkflowNodeRun
	subIssue   db.MulticaIssue
	parentID   string // empty when the fixture has no parent issue
}

// newWorkflowSyncFixture builds the fixture with the sub-issue in the given
// status. When withParent is true an open parent issue is created and the
// sub-issue links to it.
func newWorkflowSyncFixture(t *testing.T, issueStatus string, withParent bool) workflowSyncFixture {
	t.Helper()
	ctx := context.Background()
	suffix := time.Now().Format(time.RFC3339Nano)

	var workflowID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow (
			workspace_id, title, description, status, max_retries, created_by_type, created_by_id
		)
		VALUES ($1, $2, '', 'active', 0, 'member', $3)
		RETURNING id
	`, testWorkspaceID, "sync-test workflow "+suffix, testUserID).Scan(&workflowID); err != nil {
		t.Fatalf("create workflow: %v", err)
	}

	var nodeID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node (
			workflow_id, title, description, position_x, position_y,
			format_schema, worker_type, critic_type, sort_order
		)
		VALUES ($1, 'Do work', '', 0, 0, '{}'::jsonb, 'agent', 'human', 0)
		RETURNING id
	`, workflowID).Scan(&nodeID); err != nil {
		t.Fatalf("create node: %v", err)
	}

	var runID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_run (workflow_id, workspace_id, workflow_title, status, triggered_by_type)
		VALUES ($1, $2, 'sync-test run', 'running', 'member')
		RETURNING id
	`, workflowID, testWorkspaceID).Scan(&runID); err != nil {
		t.Fatalf("create run: %v", err)
	}

	nodeRun, err := testHandler.Queries.CreateWorkflowNodeRun(ctx, db.CreateWorkflowNodeRunParams{
		WorkflowRunID:  parseUUID(runID),
		WorkflowNodeID: parseUUID(nodeID),
		NodeTitle:      "Do work",
		Status:         service.NodeRunStatusPending,
		RetryCount:     0,
		WorkerType:     "agent",
		CriticType:     "human",
	})
	if err != nil {
		t.Fatalf("create node run: %v", err)
	}

	parentUUID := pgtype.UUID{}
	parentID := ""
	if withParent {
		number, err := testHandler.Queries.IncrementIssueCounter(ctx, parseUUID(testWorkspaceID))
		if err != nil {
			t.Fatalf("increment issue counter: %v", err)
		}
		parent, err := testHandler.Queries.CreateIssueWithOrigin(ctx, db.CreateIssueWithOriginParams{
			WorkspaceID:       parseUUID(testWorkspaceID),
			Title:             "sync-test parent " + suffix,
			Status:            "in_progress",
			Priority:          "medium",
			ResponsibleUserID: parseUUID(testUserID),
			CreatorType:       "member",
			CreatorID:         parseUUID(testUserID),
			Number:            number,
		})
		if err != nil {
			t.Fatalf("create parent issue: %v", err)
		}
		parentUUID = parent.ID
		parentID = uuidToString(parent.ID)
	}

	number, err := testHandler.Queries.IncrementIssueCounter(ctx, parseUUID(testWorkspaceID))
	if err != nil {
		t.Fatalf("increment issue counter: %v", err)
	}
	subIssue, err := testHandler.Queries.CreateIssueWithOrigin(ctx, db.CreateIssueWithOriginParams{
		WorkspaceID:       parseUUID(testWorkspaceID),
		Title:             "sync-test sub-issue " + suffix,
		Status:            issueStatus,
		Priority:          "medium",
		ResponsibleUserID: parseUUID(testUserID),
		CreatorType:       "member",
		CreatorID:         parseUUID(testUserID),
		ParentIssueID:     parentUUID,
		Number:            number,
		OriginType:        pgtype.Text{String: "workflow", Valid: true},
		OriginID:          nodeRun.ID,
		WorkflowID:        parseUUID(workflowID),
		WorkflowRunID:     parseUUID(runID),
	})
	if err != nil {
		t.Fatalf("create sub-issue: %v", err)
	}

	t.Cleanup(func() {
		ctx := context.Background()
		testPool.Exec(ctx, `DELETE FROM multica_issue WHERE workflow_run_id = $1 OR id = $2`, runID, parentID)
		testPool.Exec(ctx, `DELETE FROM multica_workflow WHERE id = $1`, workflowID)
	})

	return workflowSyncFixture{
		workflowID: workflowID,
		runID:      runID,
		nodeRun:    nodeRun,
		subIssue:   subIssue,
		parentID:   parentID,
	}
}

// captureIssueUpdated subscribes to issue:updated on the shared test bus and
// returns a getter for the events captured so far. The bus is shared across
// the whole package suite, so callers must filter by their own issue ID.
func captureIssueUpdated() func() []events.Event {
	var mu sync.Mutex
	var captured []events.Event
	testBus.Subscribe(protocol.EventIssueUpdated, func(e events.Event) {
		mu.Lock()
		defer mu.Unlock()
		captured = append(captured, e)
	})
	return func() []events.Event {
		mu.Lock()
		defer mu.Unlock()
		return append([]events.Event(nil), captured...)
	}
}

// issueUpdatedEventsFor filters captured issue:updated events down to the
// ones whose payload issue matches the given issue ID.
func issueUpdatedEventsFor(evts []events.Event, issueID string) []events.Event {
	var out []events.Event
	for _, e := range evts {
		payload, ok := e.Payload.(map[string]any)
		if !ok {
			continue
		}
		issue, ok := payload["issue"].(IssueResponse)
		if !ok {
			continue
		}
		if issue.ID == issueID {
			out = append(out, e)
		}
	}
	return out
}

func issueStatusInDB(t *testing.T, issueID pgtype.UUID) string {
	t.Helper()
	var status string
	if err := testPool.QueryRow(context.Background(),
		`SELECT status FROM multica_issue WHERE id = $1`, issueID).Scan(&status); err != nil {
		t.Fatalf("read issue status: %v", err)
	}
	return status
}

// TestSyncSubIssuePublishesStatusChanged is the core regression test for the
// missing-notification bug: a workflow node run moving pending → working
// flips the sub-issue todo → in_progress, and that change must be broadcast
// as issue:updated with status_changed so inbox listeners, the activity log,
// and the frontend cache all react.
func TestSyncSubIssuePublishesStatusChanged(t *testing.T) {
	fx := newWorkflowSyncFixture(t, "todo", false)
	getEvents := captureIssueUpdated()

	nodeRun := fx.nodeRun
	nodeRun.Status = service.NodeRunStatusWorking
	testHandler.syncSubIssueForNodeRun(context.Background(), nodeRun)

	if got := issueStatusInDB(t, fx.subIssue.ID); got != "in_progress" {
		t.Fatalf("expected sub-issue in_progress, got %q", got)
	}

	matches := issueUpdatedEventsFor(getEvents(), uuidToString(fx.subIssue.ID))
	if len(matches) != 1 {
		t.Fatalf("expected exactly 1 issue:updated event for sub-issue, got %d", len(matches))
	}
	payload := matches[0].Payload.(map[string]any)
	if sc, _ := payload["status_changed"].(bool); !sc {
		t.Fatalf("expected status_changed=true, payload: %v", payload)
	}
	if prev, _ := payload["prev_status"].(string); prev != "todo" {
		t.Fatalf("expected prev_status=todo, got %q", prev)
	}
}

// TestSyncSubIssueDoneNotifiesParent: when a node run completes and the
// sub-issue transitions into done, the parent must receive the same
// platform system comment as a manual child → done transition (MUL-2538).
func TestSyncSubIssueDoneNotifiesParent(t *testing.T) {
	fx := newWorkflowSyncFixture(t, "in_progress", true)

	nodeRun := fx.nodeRun
	nodeRun.Status = service.NodeRunStatusCompleted
	testHandler.syncSubIssueForNodeRun(context.Background(), nodeRun)

	if got := issueStatusInDB(t, fx.subIssue.ID); got != "done" {
		t.Fatalf("expected sub-issue done, got %q", got)
	}
	if got := countSystemCommentsOn(t, fx.parentID); got != 1 {
		t.Fatalf("expected exactly 1 system comment on parent, got %d", got)
	}
}

// TestSyncSubIssueNeverRegressesDoneIssue: cancelling a run must not flip an
// already-done sub-issue back to cancelled. CancelRun used to guard this
// inline; the guard now lives in the sync path because CancelRun relies on
// the node-status callback to update the sub-issue.
func TestSyncSubIssueNeverRegressesDoneIssue(t *testing.T) {
	fx := newWorkflowSyncFixture(t, "done", false)
	getEvents := captureIssueUpdated()

	nodeRun := fx.nodeRun
	nodeRun.Status = service.NodeRunStatusCancelled
	testHandler.syncSubIssueForNodeRun(context.Background(), nodeRun)

	if got := issueStatusInDB(t, fx.subIssue.ID); got != "done" {
		t.Fatalf("expected sub-issue to stay done, got %q", got)
	}
	if matches := issueUpdatedEventsFor(getEvents(), uuidToString(fx.subIssue.ID)); len(matches) != 0 {
		t.Fatalf("expected no issue:updated event, got %d", len(matches))
	}
}

func TestWorkflowManagedIssueStatusChangeConflict(t *testing.T) {
	for _, test := range []struct {
		name       string
		originType string
		current    string
		requested  string
		want       bool
	}{
		{name: "workflow node issue", originType: "workflow", current: "in_progress", requested: "done", want: true},
		{name: "split child issue", originType: "workflow_split", current: "in_progress", requested: "done", want: true},
		{name: "unchanged workflow status", originType: "workflow", current: "done", requested: "done", want: false},
		{name: "regular child issue", current: "in_progress", requested: "done", want: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			issue := db.MulticaIssue{
				OriginType: pgtype.Text{String: test.originType, Valid: test.originType != ""},
				Status:     test.current,
			}
			if got := workflowManagedIssueStatusChangeConflict(issue, test.requested); got != test.want {
				t.Fatalf("workflowManagedIssueStatusChangeConflict() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestUpdateIssueRejectsWorkflowManagedStatusChange(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	for _, originType := range []string{"workflow", "workflow_split"} {
		t.Run(originType, func(t *testing.T) {
			fx := newWorkflowSyncFixture(t, "in_progress", false)
			ctx := context.Background()

			if _, err := testPool.Exec(ctx, `
				UPDATE multica_workflow_node_run SET status = 'working' WHERE id = $1
			`, fx.nodeRun.ID); err != nil {
				t.Fatalf("set node run working: %v", err)
			}
			if _, err := testPool.Exec(ctx, `
				UPDATE multica_issue SET origin_type = $2 WHERE id = $1
			`, fx.subIssue.ID, originType); err != nil {
				t.Fatalf("set issue origin type: %v", err)
			}

			w := httptest.NewRecorder()
			req := newRequest("PUT", "/api/issues/"+uuidToString(fx.subIssue.ID), map[string]any{
				"status": "done",
			})
			req = withURLParam(req, "id", uuidToString(fx.subIssue.ID))
			testHandler.UpdateIssue(w, req)

			if w.Code != http.StatusConflict {
				t.Fatalf("UpdateIssue status = %d, want 409: %s", w.Code, w.Body.String())
			}
			if got := issueStatusInDB(t, fx.subIssue.ID); got != "in_progress" {
				t.Fatalf("issue status = %q, want in_progress", got)
			}
			nodeRun, err := testHandler.Queries.GetWorkflowNodeRun(ctx, fx.nodeRun.ID)
			if err != nil {
				t.Fatalf("load node run: %v", err)
			}
			if nodeRun.Status != service.NodeRunStatusWorking {
				t.Fatalf("node run status = %q, want working", nodeRun.Status)
			}
		})
	}
}

func TestBatchUpdateIssuesSkipsWorkflowManagedStatusChange(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	fx := newWorkflowSyncFixture(t, "in_progress", false)
	ctx := context.Background()
	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_node_run SET status = 'working' WHERE id = $1
	`, fx.nodeRun.ID); err != nil {
		t.Fatalf("set node run working: %v", err)
	}

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues/batch-update", map[string]any{
		"issue_ids": []string{uuidToString(fx.subIssue.ID)},
		"updates":   map[string]any{"status": "done"},
	})
	testHandler.BatchUpdateIssues(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("BatchUpdateIssues status = %d, want 200: %s", w.Code, w.Body.String())
	}
	var body struct {
		Updated int `json:"updated"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Updated != 0 {
		t.Fatalf("updated = %d, want 0", body.Updated)
	}
	if got := issueStatusInDB(t, fx.subIssue.ID); got != "in_progress" {
		t.Fatalf("issue status = %q, want in_progress", got)
	}
}

// TestCancelRunPublishesSubIssueCancelled: cancelling a whole run cancels
// each non-terminal node run; the linked sub-issues must end up cancelled
// AND the change must be broadcast (previously the status was rewritten
// silently inside the transaction, so no notification ever fired).
func TestCancelRunPublishesSubIssueCancelled(t *testing.T) {
	fx := newWorkflowSyncFixture(t, "in_progress", false)
	getEvents := captureIssueUpdated()

	if _, err := testPool.Exec(context.Background(),
		`UPDATE multica_workflow_node_run SET status = 'working' WHERE id = $1`, fx.nodeRun.ID); err != nil {
		t.Fatalf("set node run working: %v", err)
	}

	if err := testHandler.WorkflowService.CancelRun(context.Background(), parseUUID(fx.runID)); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}

	if got := issueStatusInDB(t, fx.subIssue.ID); got != "cancelled" {
		t.Fatalf("expected sub-issue cancelled, got %q", got)
	}
	matches := issueUpdatedEventsFor(getEvents(), uuidToString(fx.subIssue.ID))
	if len(matches) != 1 {
		t.Fatalf("expected exactly 1 issue:updated event for sub-issue, got %d", len(matches))
	}
	payload := matches[0].Payload.(map[string]any)
	if sc, _ := payload["status_changed"].(bool); !sc {
		t.Fatalf("expected status_changed=true, payload: %v", payload)
	}
	if prev, _ := payload["prev_status"].(string); prev != "in_progress" {
		t.Fatalf("expected prev_status=in_progress, got %q", prev)
	}
}

// TestWorkflowRunTerminalPublishesParentDone: when a run completes, the
// parent issue auto-completes — subscribers must be told.
func TestWorkflowRunTerminalPublishesParentDone(t *testing.T) {
	fx := newWorkflowSyncFixture(t, "done", true)
	getEvents := captureIssueUpdated()

	run, err := testHandler.Queries.GetWorkflowRun(context.Background(), parseUUID(fx.runID))
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	testHandler.handleWorkflowRunTerminal(context.Background(), run, service.RunStatusCompleted)

	if got := issueStatusInDB(t, parseUUID(fx.parentID)); got != "done" {
		t.Fatalf("expected parent done, got %q", got)
	}
	matches := issueUpdatedEventsFor(getEvents(), fx.parentID)
	if len(matches) != 1 {
		t.Fatalf("expected exactly 1 issue:updated event for parent, got %d", len(matches))
	}
	payload := matches[0].Payload.(map[string]any)
	if sc, _ := payload["status_changed"].(bool); !sc {
		t.Fatalf("expected status_changed=true, payload: %v", payload)
	}
	if prev, _ := payload["prev_status"].(string); prev != "in_progress" {
		t.Fatalf("expected prev_status=in_progress, got %q", prev)
	}
}

// newDirectIssueSyncFixture builds a default-style single-node run (workflow +
// node + run + node_run) with a DIRECT issue linked via workflow_run_id and no
// origin row — the shape used by member/agent/squad tasks. The returned
// workflowSyncFixture.subIssue holds that direct issue (the issue under test).
func newDirectIssueSyncFixture(t *testing.T, issueStatus string) workflowSyncFixture {
	t.Helper()
	ctx := context.Background()
	suffix := time.Now().Format(time.RFC3339Nano)

	var workflowID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow (
			workspace_id, title, description, status, max_retries, created_by_type, created_by_id
		)
		VALUES ($1, $2, '', 'active', 0, 'member', $3)
		RETURNING id
	`, testWorkspaceID, "direct-sync workflow "+suffix, testUserID).Scan(&workflowID); err != nil {
		t.Fatalf("create workflow: %v", err)
	}

	var nodeID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node (
			workflow_id, title, description, position_x, position_y,
			format_schema, worker_type, critic_type, sort_order
		)
		VALUES ($1, 'Do work', '', 0, 0, '{}'::jsonb, 'agent', 'human', 0)
		RETURNING id
	`, workflowID).Scan(&nodeID); err != nil {
		t.Fatalf("create node: %v", err)
	}

	var runID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_run (workflow_id, workspace_id, workflow_title, status, triggered_by_type)
		VALUES ($1, $2, 'direct-sync run', 'running', 'member')
		RETURNING id
	`, workflowID, testWorkspaceID).Scan(&runID); err != nil {
		t.Fatalf("create run: %v", err)
	}

	nodeRun, err := testHandler.Queries.CreateWorkflowNodeRun(ctx, db.CreateWorkflowNodeRunParams{
		WorkflowRunID:  parseUUID(runID),
		WorkflowNodeID: parseUUID(nodeID),
		NodeTitle:      "Do work",
		Status:         service.NodeRunStatusPending,
		RetryCount:     0,
		WorkerType:     "agent",
		CriticType:     "human",
	})
	if err != nil {
		t.Fatalf("create node run: %v", err)
	}

	number, err := testHandler.Queries.IncrementIssueCounter(ctx, parseUUID(testWorkspaceID))
	if err != nil {
		t.Fatalf("increment issue counter: %v", err)
	}
	// Direct issue: no origin_type/origin_id, linked to the run via workflow_run_id.
	directIssue, err := testHandler.Queries.CreateIssueWithOrigin(ctx, db.CreateIssueWithOriginParams{
		WorkspaceID:       parseUUID(testWorkspaceID),
		Title:             "direct-sync issue " + suffix,
		Status:            issueStatus,
		Priority:          "medium",
		ResponsibleUserID: parseUUID(testUserID),
		CreatorType:       "member",
		CreatorID:         parseUUID(testUserID),
		Number:            number,
		WorkflowID:        parseUUID(workflowID),
		WorkflowRunID:     parseUUID(runID),
	})
	if err != nil {
		t.Fatalf("create direct issue: %v", err)
	}

	t.Cleanup(func() {
		ctx := context.Background()
		testPool.Exec(ctx, `DELETE FROM multica_issue WHERE workflow_run_id = $1`, runID)
		testPool.Exec(ctx, `DELETE FROM multica_workflow WHERE id = $1`, workflowID)
	})

	return workflowSyncFixture{
		workflowID: workflowID,
		runID:      runID,
		nodeRun:    nodeRun,
		subIssue:   directIssue,
	}
}

// TestSyncDirectIssuePublishesStatusChanged: a default single-node run's direct
// issue (member/agent/squad) must mirror node-run status changes. Here the node
// reaches awaiting_critic and the in_progress issue must flip to in_review and
// broadcast issue:updated. Previously the direct issue was invisible to the sync
// (only origin sub-issues were found), so the board card froze mid-execution.
func TestSyncDirectIssuePublishesStatusChanged(t *testing.T) {
	fx := newDirectIssueSyncFixture(t, "in_progress")
	getEvents := captureIssueUpdated()

	nodeRun := fx.nodeRun
	nodeRun.Status = service.NodeRunStatusAwaitingCritic
	testHandler.syncSubIssueForNodeRun(context.Background(), nodeRun)

	if got := issueStatusInDB(t, fx.subIssue.ID); got != "in_review" {
		t.Fatalf("expected direct issue in_review, got %q", got)
	}
	matches := issueUpdatedEventsFor(getEvents(), uuidToString(fx.subIssue.ID))
	if len(matches) != 1 {
		t.Fatalf("expected exactly 1 issue:updated event for direct issue, got %d", len(matches))
	}
	payload := matches[0].Payload.(map[string]any)
	if sc, _ := payload["status_changed"].(bool); !sc {
		t.Fatalf("expected status_changed=true, payload: %v", payload)
	}
	if prev, _ := payload["prev_status"].(string); prev != "in_progress" {
		t.Fatalf("expected prev_status=in_progress, got %q", prev)
	}
}

// TestSyncDirectIssueWorkerAssignedDoesNotRegress guards the member case: a
// member task is in_progress while its node waits in worker_assigned for a
// deliverable upload. The sync must NOT drag it back to todo — for direct
// issues worker_assigned maps to in_progress, not todo.
func TestSyncDirectIssueWorkerAssignedDoesNotRegress(t *testing.T) {
	fx := newDirectIssueSyncFixture(t, "in_progress")
	getEvents := captureIssueUpdated()

	nodeRun := fx.nodeRun
	nodeRun.Status = service.NodeRunStatusWorkerAssigned
	testHandler.syncSubIssueForNodeRun(context.Background(), nodeRun)

	if got := issueStatusInDB(t, fx.subIssue.ID); got != "in_progress" {
		t.Fatalf("expected direct issue to stay in_progress, got %q", got)
	}
	if matches := issueUpdatedEventsFor(getEvents(), uuidToString(fx.subIssue.ID)); len(matches) != 0 {
		t.Fatalf("expected no issue:updated event, got %d", len(matches))
	}
}

// TestSyncDirectIssueCompletedNoParentNotification: a direct issue has no parent,
// so completing its node must flip it to done and broadcast, while skipping the
// sub-issue-only parent notification / downstream injection.
func TestSyncDirectIssueCompletedNoParentNotification(t *testing.T) {
	fx := newDirectIssueSyncFixture(t, "in_progress")
	getEvents := captureIssueUpdated()

	nodeRun := fx.nodeRun
	nodeRun.Status = service.NodeRunStatusCompleted
	testHandler.syncSubIssueForNodeRun(context.Background(), nodeRun)

	if got := issueStatusInDB(t, fx.subIssue.ID); got != "done" {
		t.Fatalf("expected direct issue done, got %q", got)
	}
	matches := issueUpdatedEventsFor(getEvents(), uuidToString(fx.subIssue.ID))
	if len(matches) != 1 {
		t.Fatalf("expected exactly 1 issue:updated event for direct issue, got %d", len(matches))
	}
}

// TestSyncDirectIssueCancelledDoesNotOverride: cancelling a direct issue's node
// (the result of dragging the issue to todo/backlog, or reassigning) must NOT
// echo back and rewrite the issue status. The user/system action already chose
// the issue status; a cancelled node is a consequence, not a new signal.
func TestSyncDirectIssueCancelledDoesNotOverride(t *testing.T) {
	fx := newDirectIssueSyncFixture(t, "todo")
	getEvents := captureIssueUpdated()

	nodeRun := fx.nodeRun
	nodeRun.Status = service.NodeRunStatusCancelled
	testHandler.syncSubIssueForNodeRun(context.Background(), nodeRun)

	if got := issueStatusInDB(t, fx.subIssue.ID); got != "todo" {
		t.Fatalf("expected direct issue to stay todo, got %q", got)
	}
	if matches := issueUpdatedEventsFor(getEvents(), uuidToString(fx.subIssue.ID)); len(matches) != 0 {
		t.Fatalf("expected no issue:updated event, got %d", len(matches))
	}
}

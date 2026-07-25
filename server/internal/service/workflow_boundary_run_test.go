package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestBuildExecutableWorkflowGraphFiltersBoundaryNodesAndEdges(t *testing.T) {
	id := func(last byte) pgtype.UUID {
		var value [16]byte
		value[15] = last
		return pgtype.UUID{Bytes: value, Valid: true}
	}
	node := func(last byte, format string) db.MulticaWorkflowNode {
		return db.MulticaWorkflowNode{ID: id(last), FormatSchema: []byte(format)}
	}

	start := node(1, `{"type":"start"}`)
	a := node(2, `{}`)
	b := node(3, `{}`)
	end := node(4, `{"type":"end"}`)
	nodes, edges := buildExecutableWorkflowGraph(
		[]db.MulticaWorkflowNode{start, a, b, end},
		[]db.MulticaWorkflowEdge{
			{SourceNodeID: start.ID, TargetNodeID: a.ID},
			{SourceNodeID: a.ID, TargetNodeID: b.ID},
			{SourceNodeID: b.ID, TargetNodeID: end.ID},
		},
	)

	if len(nodes) != 2 || nodes[0].ID != a.ID || nodes[1].ID != b.ID {
		t.Fatalf("unexpected executable nodes: %#v", nodes)
	}
	if len(edges) != 1 || edges[0].SourceNodeID != a.ID || edges[0].TargetNodeID != b.ID {
		t.Fatalf("unexpected executable edges: %#v", edges)
	}
}

func TestWorkflowBoundaryNodesDoNotCreateRuns(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()

	ctx := context.Background()
	q := db.New(pool)
	svc := NewWorkflowService(q, pool, nil, nil)
	suffix := fmt.Sprintf("boundary-%d-%d", os.Getpid(), time.Now().UnixNano())

	var workspaceID, userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, 'boundary run test workspace', 'BND')
		RETURNING id
	`, "Boundary Run Test Workspace "+suffix, suffix).Scan(&workspaceID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_user (name, email)
		VALUES ('Boundary User', $1)
		RETURNING id
	`, suffix+"@multica.test").Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO multica_member (workspace_id, user_id, role)
		VALUES ($1, $2, 'owner')
	`, workspaceID, userID); err != nil {
		t.Fatalf("create member: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM multica_workspace WHERE id = $1`, workspaceID)
		_, _ = pool.Exec(ctx, `DELETE FROM multica_user WHERE id = $1`, userID)
	})

	var workflowID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow (workspace_id, title, description, status, max_retries, created_by_type, created_by_id)
		VALUES ($1, 'Boundary Run', 'boundary execution filtering', 'active', 3, 'member', $2)
		RETURNING id
	`, workspaceID, userID).Scan(&workflowID); err != nil {
		t.Fatalf("create workflow: %v", err)
	}

	createNode := func(title, format string, sortOrder int) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO multica_workflow_node (
				workflow_id, title, description, position_x, position_y,
				format_schema, worker_type, worker_id, critic_type, critic_id, sort_order
			)
			VALUES ($1, $2, '', 0, 0, $3::jsonb, 'human', $4, 'human', $4, $5)
			RETURNING id
		`, workflowID, title, format, userID, sortOrder).Scan(&id); err != nil {
			t.Fatalf("create node %s: %v", title, err)
		}
		return id
	}
	startID := createNode("Start", `{"type":"start"}`, 0)
	rootID := createNode("Root", `{}`, 1)
	dependentID := createNode("Dependent", `{}`, 2)
	endID := createNode("End", `{"type":"end"}`, 3)

	createEdge := func(sourceID, targetID string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			INSERT INTO multica_workflow_edge (workflow_id, source_node_id, target_node_id)
			VALUES ($1, $2, $3)
		`, workflowID, sourceID, targetID); err != nil {
			t.Fatalf("create edge %s -> %s: %v", sourceID, targetID, err)
		}
	}
	createEdge(startID, rootID)
	createEdge(rootID, dependentID)
	createEdge(startID, dependentID)
	createEdge(dependentID, endID)

	workflowUUID, err := util.ParseUUID(workflowID)
	if err != nil {
		t.Fatalf("parse workflow id: %v", err)
	}
	workspaceUUID, err := util.ParseUUID(workspaceID)
	if err != nil {
		t.Fatalf("parse workspace id: %v", err)
	}
	run, err := svc.StartRun(ctx, db.MulticaWorkflow{
		ID:          workflowUUID,
		WorkspaceID: workspaceUUID,
		Title:       "Boundary Run",
		Status:      "active",
	}, "member", userID, json.RawMessage(`{}`), pgtype.UUID{})
	if err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	nodeRuns, err := q.ListWorkflowNodeRunsByRun(ctx, run.ID)
	if err != nil {
		t.Fatalf("list node runs: %v", err)
	}
	if len(nodeRuns) != 2 {
		t.Fatalf("node run count = %d, want 2", len(nodeRuns))
	}
	byTitle := make(map[string]db.MulticaWorkflowNodeRun, len(nodeRuns))
	for _, nodeRun := range nodeRuns {
		byTitle[nodeRun.NodeTitle] = nodeRun
	}
	rootRun, rootOK := byTitle["Root"]
	dependentRun, dependentOK := byTitle["Dependent"]
	if !rootOK || !dependentOK {
		t.Fatalf("unexpected node runs: %#v", byTitle)
	}
	if rootRun.Status != NodeRunStatusFormatOk || dependentRun.Status != NodeRunStatusPending {
		t.Fatalf("initial statuses = (%s, %s), want (%s, %s)", rootRun.Status, dependentRun.Status, NodeRunStatusFormatOk, NodeRunStatusPending)
	}

	drainNextDispatch := func() {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			UPDATE multica_workflow_node_run_dispatch_job
			SET scheduled_at = '1990-01-01 00:00:00+00'
			WHERE workflow_run_id = $1 AND status = 'pending'
		`, run.ID); err != nil {
			t.Fatal(err)
		}
		worker := &WorkflowDispatchWorker{
			Queries: q, TxStarter: pool, Workflow: svc,
			WorkerID: "boundary-worker", LeaseDuration: 30 * time.Second,
		}
		if err := worker.runOnce(ctx); err != nil {
			t.Fatal(err)
		}
	}
	completeHumanNode := func(nodeRunID pgtype.UUID) {
		t.Helper()
		nodeRun, err := q.GetWorkflowNodeRun(ctx, nodeRunID)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := svc.TransitionNodeRun(ctx, nodeRun, NodeRunStatusWorking); err != nil {
			t.Fatal(err)
		}
		if err := svc.SubmitWorkerOutput(ctx, nodeRun.ID, json.RawMessage(`{"result":"done"}`)); err != nil {
			t.Fatal(err)
		}
		drainNextDispatch()
		if err := svc.ReviewNodeRun(ctx, nodeRun.ID, true, "", json.RawMessage(`{"approved":true}`)); err != nil {
			t.Fatal(err)
		}
	}

	drainNextDispatch()
	rootRun, err = q.GetWorkflowNodeRun(ctx, rootRun.ID)
	if err != nil || rootRun.Status != NodeRunStatusWorkerAssigned {
		t.Fatalf("root after dispatch=%s error=%v", rootRun.Status, err)
	}
	completeHumanNode(rootRun.ID)
	dependentRun, err = q.GetWorkflowNodeRun(ctx, dependentRun.ID)
	if err != nil {
		t.Fatalf("reload dependent run: %v", err)
	}
	if dependentRun.Status != NodeRunStatusFormatOk {
		t.Fatalf("dependent status = %s, want %s", dependentRun.Status, NodeRunStatusFormatOk)
	}
	drainNextDispatch()
	dependentRun, err = q.GetWorkflowNodeRun(ctx, dependentRun.ID)
	if err != nil || dependentRun.Status != NodeRunStatusWorkerAssigned {
		t.Fatalf("dependent after dispatch=%s error=%v", dependentRun.Status, err)
	}
	completeHumanNode(dependentRun.ID)

	completedRun, err := q.GetWorkflowRun(ctx, run.ID)
	if err != nil {
		t.Fatalf("reload workflow run: %v", err)
	}
	if completedRun.Status != RunStatusCompleted {
		t.Fatalf("workflow run status = %s, want %s", completedRun.Status, RunStatusCompleted)
	}
}

func TestWorkflowBoundaryOnlyRunCreatesFailedConfigRun(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()

	ctx := context.Background()
	q := db.New(pool)
	events := make([]string, 0, 2)
	svc := NewWorkflowService(q, pool, nil, nil)
	svc.OnRunTerminal = func(_ context.Context, _ db.MulticaWorkflowRun, status string) {
		events = append(events, status)
	}
	suffix := fmt.Sprintf("boundary-only-%d-%d", os.Getpid(), time.Now().UnixNano())

	var workspaceID, workflowID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, 'boundary only test workspace', 'BNO') RETURNING id
	`, "Boundary Only Test Workspace "+suffix, suffix).Scan(&workspaceID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM multica_workflow WHERE workspace_id = $1`, workspaceID)
		_, _ = pool.Exec(ctx, `DELETE FROM multica_workspace WHERE id = $1`, workspaceID)
	})
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow (workspace_id, title, description, status, max_retries, created_by_type, created_by_id)
		VALUES ($1, 'Boundary Only', '', 'active', 3, 'member', gen_random_uuid()) RETURNING id
	`, workspaceID).Scan(&workflowID); err != nil {
		t.Fatalf("create workflow: %v", err)
	}
	for title, kind := range map[string]string{"Start": "start", "End": "end"} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO multica_workflow_node (
				workflow_id, title, description, position_x, position_y,
				format_schema, worker_type, critic_type, sort_order
			) VALUES ($1, $2, '', 0, 0, jsonb_build_object('type', $3::text), 'human', 'human', 0)
		`, workflowID, title, kind); err != nil {
			t.Fatalf("create %s node: %v", kind, err)
		}
	}
	workflowUUID, _ := util.ParseUUID(workflowID)
	workspaceUUID, _ := util.ParseUUID(workspaceID)
	_, err := svc.StartRun(ctx, db.MulticaWorkflow{
		ID: workflowUUID, WorkspaceID: workspaceUUID, Title: "Boundary Only", Status: "active",
	}, "member", "", json.RawMessage(`{}`), pgtype.UUID{})
	var invalid *WorkflowConfigInvalidError
	if !errors.As(err, &invalid) {
		t.Fatalf("StartRun error=%v, want WorkflowConfigInvalidError", err)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM multica_workflow_run WHERE id = $1`, invalid.RunID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != RunStatusFailed {
		t.Fatalf("run status=%s, want %s", status, RunStatusFailed)
	}
	if len(events) != 0 {
		t.Fatalf("terminal callbacks=%#v, want none during preparation", events)
	}
}

package service

import (
	"context"
	"encoding/json"
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

	var workspaceID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, 'boundary run test workspace', 'BND')
		RETURNING id
	`, "Boundary Run Test Workspace "+suffix, suffix).Scan(&workspaceID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM multica_workflow WHERE workspace_id = $1`, workspaceID)
		_, _ = pool.Exec(ctx, `DELETE FROM multica_workspace WHERE id = $1`, workspaceID)
	})

	var workflowID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow (workspace_id, title, description, status, max_retries, created_by_type, created_by_id)
		VALUES ($1, 'Boundary Run', 'boundary execution filtering', 'active', 3, 'member', gen_random_uuid())
		RETURNING id
	`, workspaceID).Scan(&workflowID); err != nil {
		t.Fatalf("create workflow: %v", err)
	}

	createNode := func(title, format string, sortOrder int) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO multica_workflow_node (
				workflow_id, title, description, position_x, position_y,
				format_schema, worker_type, critic_type, sort_order
			)
			VALUES ($1, $2, '', 0, 0, $3::jsonb, 'human', 'human', $4)
			RETURNING id
		`, workflowID, title, format, sortOrder).Scan(&id); err != nil {
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
	}, "member", "", json.RawMessage(`{}`), pgtype.UUID{})
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
	if rootRun.Status != NodeRunStatusFormatChecking || dependentRun.Status != NodeRunStatusPending {
		t.Fatalf("initial statuses = (%s, %s), want (%s, %s)", rootRun.Status, dependentRun.Status, NodeRunStatusFormatChecking, NodeRunStatusPending)
	}

	completedRoot, err := svc.TransitionNodeRun(ctx, rootRun, NodeRunStatusCompleted)
	if err != nil {
		t.Fatalf("complete root: %v", err)
	}
	if err := svc.OnNodeRunCompleted(ctx, completedRoot.ID); err != nil {
		t.Fatalf("propagate root completion: %v", err)
	}
	dependentRun, err = q.GetWorkflowNodeRun(ctx, dependentRun.ID)
	if err != nil {
		t.Fatalf("reload dependent run: %v", err)
	}
	if dependentRun.Status != NodeRunStatusWorkerAssigned {
		t.Fatalf("dependent status = %s, want %s", dependentRun.Status, NodeRunStatusWorkerAssigned)
	}
	if err := svc.SubmitWorkerOutput(ctx, dependentRun.ID, json.RawMessage(`{"result":"done"}`)); err != nil {
		t.Fatalf("submit dependent output: %v", err)
	}
	if err := svc.ReviewNodeRun(ctx, dependentRun.ID, true, "", json.RawMessage(`{"approved":true}`)); err != nil {
		t.Fatalf("approve dependent output: %v", err)
	}

	completedRun, err := q.GetWorkflowRun(ctx, run.ID)
	if err != nil {
		t.Fatalf("reload workflow run: %v", err)
	}
	if completedRun.Status != RunStatusCompleted {
		t.Fatalf("workflow run status = %s, want %s", completedRun.Status, RunStatusCompleted)
	}
}

func TestWorkflowBoundaryOnlyRunCompletesAfterRootDispatch(t *testing.T) {
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
	run, err := svc.StartRun(ctx, db.MulticaWorkflow{
		ID: workflowUUID, WorkspaceID: workspaceUUID, Title: "Boundary Only", Status: "active",
	}, "member", "", json.RawMessage(`{}`), pgtype.UUID{})
	if err != nil {
		t.Fatalf("StartRun: %v", err)
	}
	events = append(events, "started")
	if run.Status != RunStatusRunning {
		t.Fatalf("start response status = %s, want %s", run.Status, RunStatusRunning)
	}
	if err := svc.DispatchRootNodeRuns(ctx, run.ID); err != nil {
		t.Fatalf("DispatchRootNodeRuns: %v", err)
	}
	completed, err := q.GetWorkflowRun(ctx, run.ID)
	if err != nil {
		t.Fatalf("reload run: %v", err)
	}
	if completed.Status != RunStatusCompleted {
		t.Fatalf("run status = %s, want %s", completed.Status, RunStatusCompleted)
	}
	if len(events) != 2 || events[0] != "started" || events[1] != RunStatusCompleted {
		t.Fatalf("event order = %#v, want [started completed]", events)
	}
}

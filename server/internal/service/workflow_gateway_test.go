package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestParseWorkflowNodeFormatGateway(t *testing.T) {
	format, ok := parseWorkflowNodeFormat(json.RawMessage(`{"type":"gateway","gateway_kind":"fork"}`))
	if !ok {
		t.Fatal("expected valid gateway format")
	}
	if format.Type != "gateway" || format.GatewayKind != "fork" {
		t.Fatalf("unexpected format: %+v", format)
	}
}

func TestParseWorkflowNodeFormatRejectsInvalidGatewayKind(t *testing.T) {
	if _, ok := parseWorkflowNodeFormat(json.RawMessage(`{"type":"gateway","gateway_kind":"split"}`)); ok {
		t.Fatal("expected invalid gateway kind to be rejected")
	}
}

func TestInvalidWorkflowGatewayFormatIsDetected(t *testing.T) {
	if !isInvalidWorkflowGatewayFormat(json.RawMessage(`{"type":"gateway","gateway_kind":"split"}`)) {
		t.Fatal("expected invalid gateway format to be detected")
	}
	if isInvalidWorkflowGatewayFormat(json.RawMessage(`{"type":"object"}`)) {
		t.Fatal("ordinary JSON schema must not be treated as an invalid gateway")
	}
}

func TestGatewayCanCompleteFromFormatChecking(t *testing.T) {
	if !isValidTransition(NodeRunStatusFormatChecking, NodeRunStatusCompleted) {
		t.Fatal("gateway nodes must be able to complete directly from format_checking")
	}
}

func TestGatewayRunForkAndJoinSemantics(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()

	ctx := context.Background()
	q := db.New(pool)
	svc := NewWorkflowService(q, pool, nil, nil)
	suffix := fmt.Sprintf("gateway-%d", os.Getpid())

	var workspaceID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, 'gateway test workspace', 'GTW')
		RETURNING id
	`, "Gateway Test Workspace "+suffix, "gateway-test-"+suffix).Scan(&workspaceID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM workflow WHERE workspace_id = $1`, workspaceID)
		_, _ = pool.Exec(ctx, `DELETE FROM workspace WHERE id = $1`, workspaceID)
	})

	var workflowID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO workflow (workspace_id, title, description, status, max_retries, created_by_type, created_by_id)
		VALUES ($1, 'Gateway Run', 'fork join run', 'active', 3, 'member', gen_random_uuid())
		RETURNING id
	`, workspaceID).Scan(&workflowID); err != nil {
		t.Fatalf("create workflow: %v", err)
	}

	createNode := func(title string, format string) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO workflow_node (
				workflow_id, title, description, position_x, position_y,
				format_schema, worker_type, critic_type, sort_order
			)
			VALUES ($1, $2, '', 0, 0, $3::jsonb, 'human', 'human', 0)
			RETURNING id
		`, workflowID, title, format).Scan(&id); err != nil {
			t.Fatalf("create node %s: %v", title, err)
		}
		return id
	}

	forkID := createNode("Fork", `{"type":"gateway","gateway_kind":"fork"}`)
	leftID := createNode("Left", `{}`)
	rightID := createNode("Right", `{}`)
	joinID := createNode("Join", `{"type":"gateway","gateway_kind":"join"}`)
	afterID := createNode("After", `{}`)

	createEdge := func(sourceID string, targetID string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			INSERT INTO workflow_edge (workflow_id, source_node_id, target_node_id)
			VALUES ($1, $2, $3)
		`, workflowID, sourceID, targetID); err != nil {
			t.Fatalf("create edge %s -> %s: %v", sourceID, targetID, err)
		}
	}
	createEdge(forkID, leftID)
	createEdge(forkID, rightID)
	createEdge(leftID, joinID)
	createEdge(rightID, joinID)
	createEdge(joinID, afterID)

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
		Title:       "Gateway Run",
		Status:      "active",
	}, "member", "", json.RawMessage(`{}`), pgtype.UUID{})
	if err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	svc.DispatchRootNodeRuns(ctx, run.ID)

	getNodeRun := func(nodeID string) db.MulticaWorkflowNodeRun {
		t.Helper()
		nodeUUID, err := util.ParseUUID(nodeID)
		if err != nil {
			t.Fatalf("parse node id: %v", err)
		}
		nodeRun, err := q.ListWorkflowNodeRunsByRunAndNode(ctx, db.ListWorkflowNodeRunsByRunAndNodeParams{
			WorkflowRunID:  run.ID,
			WorkflowNodeID: nodeUUID,
		})
		if err != nil {
			t.Fatalf("get node run %s: %v", nodeID, err)
		}
		return nodeRun
	}

	if got := getNodeRun(forkID).Status; got != NodeRunStatusCompleted {
		t.Fatalf("fork status = %s, want %s", got, NodeRunStatusCompleted)
	}
	if got := getNodeRun(leftID).Status; got != NodeRunStatusWorkerAssigned {
		t.Fatalf("left branch status = %s, want %s", got, NodeRunStatusWorkerAssigned)
	}
	if got := getNodeRun(rightID).Status; got != NodeRunStatusWorkerAssigned {
		t.Fatalf("right branch status = %s, want %s", got, NodeRunStatusWorkerAssigned)
	}

	completeHumanNode := func(nodeID string) {
		t.Helper()
		nodeRun := getNodeRun(nodeID)
		working, err := svc.TransitionNodeRun(ctx, nodeRun, NodeRunStatusWorking)
		if err != nil {
			t.Fatalf("transition %s to working: %v", nodeID, err)
		}
		completed, err := svc.TransitionNodeRun(ctx, *working, NodeRunStatusCompleted)
		if err != nil {
			t.Fatalf("transition %s to completed: %v", nodeID, err)
		}
		if err := svc.OnNodeRunCompleted(ctx, completed.ID); err != nil {
			t.Fatalf("propagate %s completion: %v", nodeID, err)
		}
	}

	completeHumanNode(leftID)
	if got := getNodeRun(joinID).Status; got != NodeRunStatusPending {
		t.Fatalf("join status after one branch = %s, want %s", got, NodeRunStatusPending)
	}

	completeHumanNode(rightID)
	if got := getNodeRun(joinID).Status; got != NodeRunStatusCompleted {
		t.Fatalf("join status after both branches = %s, want %s", got, NodeRunStatusCompleted)
	}
	if got := getNodeRun(afterID).Status; got != NodeRunStatusWorkerAssigned {
		t.Fatalf("downstream status = %s, want %s", got, NodeRunStatusWorkerAssigned)
	}
}

func TestInvalidGatewayDoesNotDispatchWorker(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()

	ctx := context.Background()
	q := db.New(pool)
	svc := NewWorkflowService(q, pool, nil, nil)
	suffix := fmt.Sprintf("invalid-gateway-%d", os.Getpid())

	var workspaceID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, 'invalid gateway test workspace', 'IGW')
		RETURNING id
	`, "Invalid Gateway Workspace "+suffix, "invalid-gateway-test-"+suffix).Scan(&workspaceID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM workflow WHERE workspace_id = $1`, workspaceID)
		_, _ = pool.Exec(ctx, `DELETE FROM workspace WHERE id = $1`, workspaceID)
	})

	var workflowID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO workflow (workspace_id, title, description, status, max_retries, created_by_type, created_by_id)
		VALUES ($1, 'Invalid Gateway Run', 'invalid gateway run', 'active', 3, 'member', gen_random_uuid())
		RETURNING id
	`, workspaceID).Scan(&workflowID); err != nil {
		t.Fatalf("create workflow: %v", err)
	}

	var nodeID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO workflow_node (
			workflow_id, title, description, position_x, position_y,
			format_schema, worker_type, critic_type, sort_order
		)
		VALUES ($1, 'Invalid gateway', '', 0, 0, '{"type":"gateway","gateway_kind":"split"}'::jsonb, 'human', 'human', 0)
		RETURNING id
	`, workflowID).Scan(&nodeID); err != nil {
		t.Fatalf("create invalid gateway node: %v", err)
	}

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
		Title:       "Invalid Gateway Run",
		Status:      "active",
	}, "member", "", json.RawMessage(`{}`), pgtype.UUID{})
	if err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	svc.DispatchRootNodeRuns(ctx, run.ID)

	nodeUUID, err := util.ParseUUID(nodeID)
	if err != nil {
		t.Fatalf("parse node id: %v", err)
	}
	nodeRun, err := q.ListWorkflowNodeRunsByRunAndNode(ctx, db.ListWorkflowNodeRunsByRunAndNodeParams{
		WorkflowRunID:  run.ID,
		WorkflowNodeID: nodeUUID,
	})
	if err != nil {
		t.Fatalf("get node run: %v", err)
	}
	if nodeRun.Status != NodeRunStatusFormatFailed {
		t.Fatalf("invalid gateway status = %s, want %s", nodeRun.Status, NodeRunStatusFormatFailed)
	}
}

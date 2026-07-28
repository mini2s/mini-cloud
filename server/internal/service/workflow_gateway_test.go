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

func TestShouldValidateNodeInputFormatSchemaRetiresOrdinaryJSONSchema(t *testing.T) {
	cases := []struct {
		name string
		raw  json.RawMessage
		want bool
	}{
		{
			name: "empty schema has no input validation",
			raw:  nil,
			want: false,
		},
		{
			name: "ordinary object JSON schema is legacy task schema",
			raw:  json.RawMessage(`{"type":"object","required":["subtask_summary"]}`),
			want: false,
		},
		{
			name: "gateway metadata is not task input schema",
			raw:  json.RawMessage(`{"type":"gateway","gateway_kind":"fork"}`),
			want: false,
		},
		{
			name: "split metadata is not task input schema",
			raw:  json.RawMessage(`{"type":"split","split_config":{"mode":"barrier"}}`),
			want: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := shouldValidateNodeInputFormatSchema(tc.raw); got != tc.want {
				t.Fatalf("shouldValidateNodeInputFormatSchema(%s) = %v, want %v", string(tc.raw), got, tc.want)
			}
		})
	}
}

func TestIsRetiredTaskJSONSchema(t *testing.T) {
	cases := []struct {
		name string
		raw  json.RawMessage
		want bool
	}{
		{
			name: "ordinary object schema",
			raw:  json.RawMessage(`{"type":"object","required":["subtask_summary"]}`),
			want: true,
		},
		{
			name: "split metadata",
			raw:  json.RawMessage(`{"type":"split","split_config":{"mode":"barrier"}}`),
			want: false,
		},
		{
			name: "gateway metadata",
			raw:  json.RawMessage(`{"type":"gateway","gateway_kind":"fork"}`),
			want: false,
		},
		{
			name: "invalid json",
			raw:  json.RawMessage(`{`),
			want: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isRetiredTaskJSONSchema(tc.raw); got != tc.want {
				t.Fatalf("isRetiredTaskJSONSchema(%s) = %v, want %v", string(tc.raw), got, tc.want)
			}
		})
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

	var workspaceID, userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, 'gateway test workspace', 'GTW')
		RETURNING id
	`, "Gateway Test Workspace "+suffix, "gateway-test-"+suffix).Scan(&workspaceID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_user (name, email)
		VALUES ('Gateway User', $1)
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
		VALUES ($1, 'Gateway Run', 'fork join run', 'active', 3, 'member', $2)
		RETURNING id
	`, workspaceID, userID).Scan(&workflowID); err != nil {
		t.Fatalf("create workflow: %v", err)
	}

	createNode := func(title string, format string) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO multica_workflow_node (
				workflow_id, title, description, position_x, position_y,
				format_schema, worker_type, worker_id, critic_type, critic_id, sort_order
			)
			VALUES ($1, $2, '', 0, 0, $3::jsonb, 'human', $4, 'human', $4, 0)
			RETURNING id
		`, workflowID, title, format, userID).Scan(&id); err != nil {
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
			INSERT INTO multica_workflow_edge (workflow_id, source_node_id, target_node_id)
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
	}, "member", userID, json.RawMessage(`{}`), pgtype.UUID{})
	if err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	drainNextDispatch := func() {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			UPDATE multica_workflow_node_run_dispatch_job
			SET scheduled_at = '1990-01-01 00:00:00+00'
			WHERE workflow_run_id = $1 AND status = 'pending'
		`, run.ID); err != nil {
			t.Fatalf("backdate dispatch jobs: %v", err)
		}
		worker := &WorkflowDispatchWorker{
			Queries: q, TxStarter: pool, Workflow: svc,
			WorkerID: "gateway-test-worker", LeaseDuration: 30 * time.Second,
		}
		if err := worker.runOnce(ctx); err != nil {
			t.Fatalf("run dispatch worker: %v", err)
		}
	}
	drainNextDispatch()

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
	drainNextDispatch()
	drainNextDispatch()
	if got := getNodeRun(leftID).Status; got != NodeRunStatusWorkerAssigned {
		t.Fatalf("left branch status = %s, want %s", got, NodeRunStatusWorkerAssigned)
	}
	if got := getNodeRun(rightID).Status; got != NodeRunStatusWorkerAssigned {
		t.Fatalf("right branch status = %s, want %s", got, NodeRunStatusWorkerAssigned)
	}

	completeHumanNode := func(nodeID string) {
		t.Helper()
		nodeRun := getNodeRun(nodeID)
		_, err := svc.TransitionNodeRun(ctx, nodeRun, NodeRunStatusWorking)
		if err != nil {
			t.Fatalf("transition %s to working: %v", nodeID, err)
		}
		if err := svc.SubmitWorkerOutput(ctx, nodeRun.ID, json.RawMessage(`{"result":"done"}`)); err != nil {
			t.Fatalf("submit %s worker output: %v", nodeID, err)
		}
		drainNextDispatch()
		if err := svc.ReviewNodeRun(ctx, nodeRun.ID, true, "", json.RawMessage(`{"approved":true}`)); err != nil {
			t.Fatalf("approve %s output: %v", nodeID, err)
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
		if got != NodeRunStatusFormatOk {
			t.Fatalf("downstream status before dispatch = %s, want %s", got, NodeRunStatusFormatOk)
		}
	}
	drainNextDispatch()
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

	var workspaceID, userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, 'invalid gateway test workspace', 'IGW')
		RETURNING id
	`, "Invalid Gateway Workspace "+suffix, "invalid-gateway-test-"+suffix).Scan(&workspaceID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_user (name, email) VALUES ('Invalid Gateway User', $1) RETURNING id
	`, suffix+"@multica.test").Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO multica_member (workspace_id, user_id, role) VALUES ($1, $2, 'owner')
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
		VALUES ($1, 'Invalid Gateway Run', 'invalid gateway run', 'active', 3, 'member', $2)
		RETURNING id
	`, workspaceID, userID).Scan(&workflowID); err != nil {
		t.Fatalf("create workflow: %v", err)
	}

	var nodeID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node (
			workflow_id, title, description, position_x, position_y,
			format_schema, worker_type, worker_id, critic_type, critic_id, sort_order
		)
		VALUES ($1, 'Invalid gateway', '', 0, 0, '{"type":"gateway","gateway_kind":"split"}'::jsonb, 'human', $2, 'human', $2, 0)
		RETURNING id
	`, workflowID, userID).Scan(&nodeID); err != nil {
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
	_, err = svc.StartRun(ctx, db.MulticaWorkflow{
		ID:          workflowUUID,
		WorkspaceID: workspaceUUID,
		Title:       "Invalid Gateway Run",
		Status:      "active",
	}, "member", userID, json.RawMessage(`{}`), pgtype.UUID{})
	var invalid *WorkflowConfigInvalidError
	if !errors.As(err, &invalid) {
		t.Fatalf("StartRun error=%v, want WorkflowConfigInvalidError", err)
	}
	var runStatus string
	if err := pool.QueryRow(ctx, `
		SELECT status FROM multica_workflow_run WHERE id = $1
	`, invalid.RunID).Scan(&runStatus); err != nil {
		t.Fatalf("get failed run: %v", err)
	}
	if runStatus != RunStatusFailed {
		t.Fatalf("invalid gateway run status = %s, want %s", runStatus, RunStatusFailed)
	}
}

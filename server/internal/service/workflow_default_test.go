package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/multica-ai/multica/server/internal/gitea"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// TestEnsureDefaultWorkflow_Idempotent verifies the workspace default workflow is
// created once (hidden, single node, one document deliverable, active) and that a
// second call returns the same row. Also verifies it never leaks into the
// user-facing list query (is_default filter).
func TestEnsureDefaultWorkflow_Idempotent(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()

	suffix := fmt.Sprintf("dw-%d-%d", os.Getpid(), time.Now().UnixNano())
	var wsID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, 'default wf test', 'DW')
		RETURNING id
	`, "Default WF WS "+suffix, "default-wf-"+suffix).Scan(&wsID); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	ws, _ := util.ParseUUID(wsID)
	t.Cleanup(func() {
		// workflow FK ON DELETE CASCADE removes nodes/runs/deliverables.
		pool.Exec(ctx, `DELETE FROM multica_workflow WHERE workspace_id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_workspace WHERE id = $1`, wsID)
	})

	svc := &WorkflowService{Queries: db.New(pool)}

	wf1, err := svc.EnsureDefaultWorkflow(ctx, ws)
	if err != nil {
		t.Fatalf("first ensure: %v", err)
	}
	if !wf1.IsDefault {
		t.Fatalf("wf1.IsDefault = false, want true")
	}
	if wf1.Status != "active" {
		t.Fatalf("wf1.Status = %q, want active", wf1.Status)
	}

	nodes, err := svc.Queries.ListWorkflowNodes(ctx, wf1.ID)
	if err != nil {
		t.Fatalf("list nodes: %v", err)
	}
	if len(nodes) != 1 {
		t.Fatalf("want exactly 1 node, got %d", len(nodes))
	}
	dels, err := svc.Queries.ListWorkflowNodeDeliverables(ctx, nodes[0].ID)
	if err != nil {
		t.Fatalf("list deliverables: %v", err)
	}
	if len(dels) != 1 || dels[0].Title != "Deliverable" {
		t.Fatalf("want 1 deliverable, got %+v", dels)
	}

	// Idempotent: second call returns the same row, no duplicate.
	wf2, err := svc.EnsureDefaultWorkflow(ctx, ws)
	if err != nil {
		t.Fatalf("second ensure: %v", err)
	}
	if wf1.ID != wf2.ID {
		t.Fatalf("ensure not idempotent: wf1=%v wf2=%v", wf1.ID, wf2.ID)
	}

	// Hidden from the user-facing list (is_default filter).
	listed, err := svc.Queries.ListWorkflowsExcludingTemplates(ctx, db.ListWorkflowsExcludingTemplatesParams{
		WorkspaceID: ws,
		Limit:       100,
		Offset:      0,
	})
	if err != nil {
		t.Fatalf("list excluding templates: %v", err)
	}
	for _, w := range listed {
		if w.ID == wf1.ID {
			t.Fatalf("default workflow leaked into ListWorkflowsExcludingTemplates")
		}
	}
}

// TestDefaultRunAssigneeMapping covers the issue→node-run type mapping: member
// assignee/creator map to "human" (UI upload / UI review); agent/squad pass
// through. Table-driven, no DB.
func TestDefaultRunAssigneeMapping(t *testing.T) {
	cases := []struct {
		name       string
		assigneeT  string
		creatorT   string
		wantWorker string
		wantCritic string
	}{
		{"agent producer, member creator", "agent", "member", "agent", "human"},
		{"squad producer, member creator", "squad", "member", "squad", "human"},
		{"member producer (UI upload), member creator", "member", "member", "human", "human"},
		{"agent producer, agent creator", "agent", "agent", "agent", "agent"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			issue := db.MulticaIssue{
				AssigneeType: pgtype.Text{String: tc.assigneeT, Valid: true},
				CreatorType:  tc.creatorT,
			}
			if got := defaultRunWorkerType(issue); got != tc.wantWorker {
				t.Errorf("worker type: got %q want %q", got, tc.wantWorker)
			}
			if got := defaultRunCriticType(issue); got != tc.wantCritic {
				t.Errorf("critic type: got %q want %q", got, tc.wantCritic)
			}
		})
	}
}

// TestStartDefaultRunForIssue_AgentAssignee is the M1 integration test: an
// agent-assigned, member-created issue gets a default-workflow run whose single
// node-run is overridden (worker=agent, critic=human/member), and an agent task
// is dispatched and linked to that node-run (so the daemon gets Gitea context).
func TestStartDefaultRunForIssue_AgentAssignee(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	// TaskSvc is required: DispatchAgentTask → NotifyTaskEnqueued dereferences it.
	// EmptyClaim nil + Wakeup nil are both guarded (no-op), so a Queries-only
	// TaskService suffices for the enqueue side-effect without redis/WS.
	svc := &WorkflowService{
		Queries:   db.New(pool),
		TxStarter: pool,
		TaskSvc:   &TaskService{Queries: db.New(pool), TxStarter: pool},
	}

	suffix := fmt.Sprintf("sd-%d-%d", os.Getpid(), time.Now().UnixNano())

	var wsID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, 'default run test', 'SD') RETURNING id
	`, "SD WS "+suffix, "sd-"+suffix).Scan(&wsID); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	ws, _ := util.ParseUUID(wsID)

	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_user (name, email) VALUES ($1, $2) RETURNING id
	`, "SD User "+suffix, "sd-"+suffix+"@multica.ai").Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	var memberID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_member (workspace_id, user_id, role) VALUES ($1, $2, 'owner') RETURNING id
	`, wsID, userID).Scan(&memberID); err != nil {
		t.Fatalf("seed member: %v", err)
	}
	// Issue creator_id for a member creator is the USER id (the handler stores the
	// authenticated user's id; runtime_authorizer_id FK references multica_user),
	// not the member row id.
	memberUUID, _ := util.ParseUUID(userID)

	var rtID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_agent_runtime (workspace_id, name, runtime_mode, provider, status)
		VALUES ($1, 'SD RT', 'local', 'legacy_local', 'online') RETURNING id
	`, wsID).Scan(&rtID); err != nil {
		t.Fatalf("seed runtime: %v", err)
	}
	var agentID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_agent (workspace_id, name, runtime_mode, runtime_id)
		VALUES ($1, 'SD Agent', 'local', $2) RETURNING id
	`, wsID, rtID).Scan(&agentID); err != nil {
		t.Fatalf("seed agent: %v", err)
	}
	agentUUID, _ := util.ParseUUID(agentID)

	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM multica_agent_task_queue WHERE agent_id = $1`, agentID)
		pool.Exec(ctx, `DELETE FROM multica_workflow WHERE workspace_id = $1`, wsID) // cascade: nodes/runs/node-runs
		pool.Exec(ctx, `DELETE FROM multica_agent WHERE id = $1`, agentID)
		pool.Exec(ctx, `DELETE FROM multica_agent_runtime WHERE id = $1`, rtID)
		pool.Exec(ctx, `DELETE FROM multica_member WHERE workspace_id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_workspace WHERE id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_user WHERE id = $1`, userID)
	})

	issue := db.MulticaIssue{
		WorkspaceID:  ws,
		Title:        "adhoc issue",
		AssigneeType: pgtype.Text{String: "agent", Valid: true},
		AssigneeID:   agentUUID,
		CreatorType:  "member",
		CreatorID:    memberUUID,
	}

	run, nr, err := svc.StartDefaultRunForIssue(ctx, issue)
	if err != nil {
		t.Fatalf("StartDefaultRunForIssue: %v", err)
	}

	// Run is on the (auto-created) default workflow.
	dwf, err := svc.Queries.GetWorkflow(ctx, run.WorkflowID)
	if err != nil {
		t.Fatalf("get workflow: %v", err)
	}
	if !dwf.IsDefault {
		t.Fatalf("run workflow is_default=%v, want true", dwf.IsDefault)
	}

	// Node-run worker overridden to the agent, critic to human/member.
	got, err := svc.Queries.GetWorkflowNodeRun(ctx, nr.ID)
	if err != nil {
		t.Fatalf("get node-run: %v", err)
	}
	if got.WorkerType != "agent" || got.WorkerID != agentUUID {
		t.Fatalf("worker override: type=%q id=%v, want agent/%v", got.WorkerType, got.WorkerID, agentUUID)
	}
	if got.CriticType != "human" || got.CriticID != memberUUID {
		t.Fatalf("critic override: type=%q id=%v, want human/%v", got.CriticType, got.CriticID, memberUUID)
	}
	if got.WorkerNameSnapshot != "SD Agent" || got.CriticNameSnapshot != "SD User "+suffix {
		t.Fatalf(
			"actor name snapshots: worker=%q critic=%q, want %q/%q",
			got.WorkerNameSnapshot, got.CriticNameSnapshot, "SD Agent", "SD User "+suffix,
		)
	}

	// Run preparation durably enqueues dispatch; the worker creates the agent
	// task asynchronously.
	var dispatchCount int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM multica_workflow_node_run_dispatch_job
		WHERE workflow_node_run_id = $1 AND phase = 'worker' AND generation = 1 AND status = 'pending'
	`, nr.ID).Scan(&dispatchCount); err != nil {
		t.Fatalf("count dispatch jobs: %v", err)
	}
	if dispatchCount != 1 {
		t.Fatalf("want 1 pending dispatch job linked to node-run, got %d", dispatchCount)
	}
}

func TestDispatchAgentTask_IgnoresBuiltinAgentRuntimeFromOtherWorkspace(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := &WorkflowService{
		Queries:   db.New(pool),
		TxStarter: pool,
		TaskSvc:   &TaskService{Queries: db.New(pool), TxStarter: pool},
	}

	suffix := fmt.Sprintf("wr-%d-%d", os.Getpid(), time.Now().UnixNano())
	var currentWsID, otherWsID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, 'workflow runtime test', 'WR') RETURNING id
	`, "WR Current "+suffix, "wr-current-"+suffix).Scan(&currentWsID); err != nil {
		t.Fatalf("seed current workspace: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, 'workflow runtime test', 'WX') RETURNING id
	`, "WR Other "+suffix, "wr-other-"+suffix).Scan(&otherWsID); err != nil {
		t.Fatalf("seed other workspace: %v", err)
	}

	var currentRuntimeID, staleRuntimeID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_agent_runtime (workspace_id, name, runtime_mode, provider, status)
		VALUES ($1, 'Current RT', 'local', 'csc', 'online') RETURNING id
	`, currentWsID).Scan(&currentRuntimeID); err != nil {
		t.Fatalf("seed current runtime: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_agent_runtime (workspace_id, name, runtime_mode, provider, status)
		VALUES ($1, 'Stale RT', 'local', 'csc', 'online') RETURNING id
	`, otherWsID).Scan(&staleRuntimeID); err != nil {
		t.Fatalf("seed stale runtime: %v", err)
	}

	var agentID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_agent (name, runtime_mode, runtime_id, is_builtin)
		VALUES ('Builtin Worker', 'local', $1, TRUE) RETURNING id
	`, staleRuntimeID).Scan(&agentID); err != nil {
		t.Fatalf("seed builtin agent: %v", err)
	}

	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_user (name, email) VALUES ($1, $2) RETURNING id
	`, "WR User "+suffix, "wr-"+suffix+"@multica.ai").Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	var memberID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_member (workspace_id, user_id, role) VALUES ($1, $2, 'owner') RETURNING id
	`, currentWsID, userID).Scan(&memberID); err != nil {
		t.Fatalf("seed member: %v", err)
	}

	var workflowID, nodeID, runID, nodeRunID, issueID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow (workspace_id, title, status, max_retries, created_by_type, created_by_id)
		VALUES ($1, 'Runtime Dispatch Workflow', 'active', 1, 'member', $2) RETURNING id
	`, currentWsID, userID).Scan(&workflowID); err != nil {
		t.Fatalf("seed workflow: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node (workflow_id, title, worker_type, worker_id, critic_type, sort_order)
		VALUES ($1, 'Worker Node', 'agent', $2, 'human', 0) RETURNING id
	`, workflowID, agentID).Scan(&nodeID); err != nil {
		t.Fatalf("seed node: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_run (workflow_id, workspace_id, workflow_title, status, triggered_by_type, triggered_by_id, runtime_id)
		VALUES ($1, $2, 'Runtime Dispatch Workflow', 'running', 'member', $3, $4) RETURNING id
	`, workflowID, currentWsID, memberID, currentRuntimeID).Scan(&runID); err != nil {
		t.Fatalf("seed run: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node_run (workflow_run_id, workflow_node_id, node_title, status, worker_type, worker_id, critic_type)
		VALUES ($1, $2, 'Worker Node', 'format_ok', 'agent', $3, 'human') RETURNING id
	`, runID, nodeID, agentID).Scan(&nodeRunID); err != nil {
		t.Fatalf("seed node run: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_issue (workspace_id, title, status, creator_id, creator_type, assignee_type, assignee_id, origin_type, origin_id, number)
		VALUES ($1, 'Worker Node', 'todo', $2, 'member', 'agent', $3, 'workflow', $4, 1) RETURNING id
	`, currentWsID, memberID, agentID, nodeRunID).Scan(&issueID); err != nil {
		t.Fatalf("seed issue: %v", err)
	}

	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM multica_agent_task_queue WHERE agent_id = $1`, agentID)
		pool.Exec(ctx, `DELETE FROM multica_issue WHERE id = $1`, issueID)
		pool.Exec(ctx, `DELETE FROM multica_workflow WHERE id = $1`, workflowID)
		pool.Exec(ctx, `DELETE FROM multica_agent WHERE id = $1`, agentID)
		pool.Exec(ctx, `DELETE FROM multica_agent_runtime WHERE id IN ($1, $2)`, currentRuntimeID, staleRuntimeID)
		pool.Exec(ctx, `DELETE FROM multica_member WHERE workspace_id = $1`, currentWsID)
		pool.Exec(ctx, `DELETE FROM multica_workspace WHERE id IN ($1, $2)`, currentWsID, otherWsID)
		pool.Exec(ctx, `DELETE FROM multica_user WHERE id = $1`, userID)
	})

	nrUUID, _ := util.ParseUUID(nodeRunID)
	nodeRun, err := svc.Queries.GetWorkflowNodeRun(ctx, nrUUID)
	if err != nil {
		t.Fatalf("get node run: %v", err)
	}
	agentUUID, _ := util.ParseUUID(agentID)
	staleRuntimeUUID, _ := util.ParseUUID(staleRuntimeID)
	agent, err := svc.Queries.GetAgent(ctx, agentUUID)
	if err != nil {
		t.Fatalf("get agent: %v", err)
	}
	if agent.RuntimeID != staleRuntimeUUID {
		t.Fatalf("fixture agent runtime = %v, want stale runtime %v", agent.RuntimeID, staleRuntimeUUID)
	}
	task, err := svc.DispatchAgentTask(ctx, nodeRun, "worker", map[string]any{})
	if err != nil {
		t.Fatalf("DispatchAgentTask: %v", err)
	}
	currentRuntimeUUID, _ := util.ParseUUID(currentRuntimeID)
	if task.RuntimeID != currentRuntimeUUID {
		t.Fatalf("task runtime = %v, want current workflow runtime %v", task.RuntimeID, currentRuntimeUUID)
	}
}

func TestResolveRuntimeForAgent_IgnoresBuiltinAgentRuntimeFromOtherWorkspace(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	taskSvc := &TaskService{Queries: db.New(pool), TxStarter: pool}

	suffix := fmt.Sprintf("tr-%d-%d", os.Getpid(), time.Now().UnixNano())
	var currentWsID, otherWsID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, 'task runtime test', 'TR') RETURNING id
	`, "TR Current "+suffix, "tr-current-"+suffix).Scan(&currentWsID); err != nil {
		t.Fatalf("seed current workspace: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, 'task runtime test', 'TX') RETURNING id
	`, "TR Other "+suffix, "tr-other-"+suffix).Scan(&otherWsID); err != nil {
		t.Fatalf("seed other workspace: %v", err)
	}
	var currentRuntimeID, staleRuntimeID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_agent_runtime (workspace_id, name, runtime_mode, provider, status)
		VALUES ($1, 'Current RT', 'local', 'csc', 'online') RETURNING id
	`, currentWsID).Scan(&currentRuntimeID); err != nil {
		t.Fatalf("seed current runtime: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_agent_runtime (workspace_id, name, runtime_mode, provider, status)
		VALUES ($1, 'Stale RT', 'local', 'csc', 'online') RETURNING id
	`, otherWsID).Scan(&staleRuntimeID); err != nil {
		t.Fatalf("seed stale runtime: %v", err)
	}
	var agentID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_agent (name, runtime_mode, runtime_id, is_builtin)
		VALUES ('Builtin Direct Worker', 'local', $1, TRUE) RETURNING id
	`, staleRuntimeID).Scan(&agentID); err != nil {
		t.Fatalf("seed builtin agent: %v", err)
	}

	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM multica_agent WHERE id = $1`, agentID)
		pool.Exec(ctx, `DELETE FROM multica_agent_runtime WHERE id IN ($1, $2)`, currentRuntimeID, staleRuntimeID)
		pool.Exec(ctx, `DELETE FROM multica_workspace WHERE id IN ($1, $2)`, currentWsID, otherWsID)
	})

	agentUUID, _ := util.ParseUUID(agentID)
	agent, err := taskSvc.Queries.GetAgent(ctx, agentUUID)
	if err != nil {
		t.Fatalf("get agent: %v", err)
	}
	wsUUID, _ := util.ParseUUID(currentWsID)
	got, err := taskSvc.resolveRuntimeForAgent(ctx, agent, wsUUID)
	if err != nil {
		t.Fatalf("resolveRuntimeForAgent: %v", err)
	}
	currentRuntimeUUID, _ := util.ParseUUID(currentRuntimeID)
	if got != currentRuntimeUUID {
		t.Fatalf("resolved runtime = %v, want current workspace runtime %v", got, currentRuntimeUUID)
	}
}

func TestStartDefaultRunForIssue_PersistsDispatchBeforeRuntimeResolution(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := &WorkflowService{
		Queries:   db.New(pool),
		TxStarter: pool,
		TaskSvc:   &TaskService{Queries: db.New(pool), TxStarter: pool},
	}

	suffix := fmt.Sprintf("ld-%d-%d", os.Getpid(), time.Now().UnixNano())

	var wsID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, 'default run dispatch-failure test', 'LD') RETURNING id
	`, "LD WS "+suffix, "ld-"+suffix).Scan(&wsID); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	ws, _ := util.ParseUUID(wsID)

	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_user (name, email) VALUES ($1, $2) RETURNING id
	`, "LD User "+suffix, "ld-"+suffix+"@multica.ai").Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	var memberID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_member (workspace_id, user_id, role) VALUES ($1, $2, 'owner') RETURNING id
	`, wsID, userID).Scan(&memberID); err != nil {
		t.Fatalf("seed member: %v", err)
	}
	// Issue creator_id for a member creator is the USER id (matches the live
	// handler contract); runtime_authorizer_id FK references multica_user.
	userUUID, _ := util.ParseUUID(userID)

	// Agent with NO runtime bound → selectWorkflowRuntime returns
	// "agent has no runtime" → DispatchAgentTask fails.
	var agentID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_agent (workspace_id, name, runtime_mode)
		VALUES ($1, 'LD Agent no-runtime', 'local') RETURNING id
	`, wsID).Scan(&agentID); err != nil {
		t.Fatalf("seed agent: %v", err)
	}
	agentUUID, _ := util.ParseUUID(agentID)

	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM multica_agent_task_queue WHERE agent_id = $1`, agentID)
		pool.Exec(ctx, `DELETE FROM multica_workflow WHERE workspace_id = $1`, wsID) // cascade: nodes/runs/node-runs
		pool.Exec(ctx, `DELETE FROM multica_agent WHERE id = $1`, agentID)
		pool.Exec(ctx, `DELETE FROM multica_member WHERE workspace_id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_workspace WHERE id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_user WHERE id = $1`, userID)
	})

	issue := db.MulticaIssue{
		WorkspaceID:  ws,
		Title:        "adhoc issue, agent has no runtime",
		AssigneeType: pgtype.Text{String: "agent", Valid: true},
		AssigneeID:   agentUUID,
		CreatorType:  "member",
		CreatorID:    userUUID,
	}

	_, nodeRun, err := svc.StartDefaultRunForIssue(ctx, issue)
	if err != nil {
		t.Fatalf("StartDefaultRunForIssue returned error: %v", err)
	}
	var dispatchCount int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM multica_workflow_node_run_dispatch_job
		WHERE workflow_node_run_id = $1 AND status = 'pending'
	`, nodeRun.ID).Scan(&dispatchCount); err != nil {
		t.Fatal(err)
	}
	if dispatchCount != 1 {
		t.Fatalf("pending dispatch jobs=%d, want 1", dispatchCount)
	}
}

// TestStartDefaultRunForIssue_SquadAssignee verifies the squad path: the
// node-run worker is set to the squad, and dispatch resolves + tasks the SQUAD
// LEADER (not the squad id) via dispatchWorker's squad case reading node-run.
func TestStartDefaultRunForIssue_SquadAssignee(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := &WorkflowService{
		Queries:   db.New(pool),
		TxStarter: pool,
		TaskSvc:   &TaskService{Queries: db.New(pool), TxStarter: pool},
	}

	suffix := fmt.Sprintf("sq-%d-%d", os.Getpid(), time.Now().UnixNano())

	var wsID, userID, memberID string
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workspace (name, slug, description, issue_prefix) VALUES ($1,$2,'t','SQ') RETURNING id`, "SQ WS "+suffix, "sq-"+suffix).Scan(&wsID); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_user (name, email) VALUES ($1,$2) RETURNING id`, "SQ User "+suffix, "sq-"+suffix+"@multica.ai").Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_member (workspace_id, user_id, role) VALUES ($1,$2,'owner') RETURNING id`, wsID, userID).Scan(&memberID); err != nil {
		t.Fatalf("seed member: %v", err)
	}
	// Issue creator_id for a member creator is the USER id (handler stores the
	// authenticated user's id; runtime_authorizer_id FK references multica_user).
	memberUUID, _ := util.ParseUUID(userID)

	var rtID, agentID string
	if err := pool.QueryRow(ctx, `INSERT INTO multica_agent_runtime (workspace_id, name, runtime_mode, provider, status) VALUES ($1,'SQ RT','local','legacy_local','online') RETURNING id`, wsID).Scan(&rtID); err != nil {
		t.Fatalf("seed runtime: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_agent (workspace_id, name, runtime_mode, runtime_id) VALUES ($1,'SQ Leader','local',$2) RETURNING id`, wsID, rtID).Scan(&agentID); err != nil {
		t.Fatalf("seed leader agent: %v", err)
	}

	var squadID string
	if err := pool.QueryRow(ctx, `INSERT INTO multica_squad (workspace_id, name, leader_id, creator_id) VALUES ($1,'SQ Squad',$2,$3) RETURNING id`, wsID, agentID, memberID).Scan(&squadID); err != nil {
		t.Fatalf("seed squad: %v", err)
	}
	squadUUID, _ := util.ParseUUID(squadID)
	wsUUID, _ := util.ParseUUID(wsID)

	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM multica_agent_task_queue WHERE agent_id = $1`, agentID)
		pool.Exec(ctx, `DELETE FROM multica_workflow WHERE workspace_id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_squad WHERE id = $1`, squadID)
		pool.Exec(ctx, `DELETE FROM multica_agent WHERE id = $1`, agentID)
		pool.Exec(ctx, `DELETE FROM multica_agent_runtime WHERE id = $1`, rtID)
		pool.Exec(ctx, `DELETE FROM multica_member WHERE workspace_id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_workspace WHERE id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_user WHERE id = $1`, userID)
	})

	issue := db.MulticaIssue{
		WorkspaceID:  wsUUID,
		Title:        "squad issue",
		AssigneeType: pgtype.Text{String: "squad", Valid: true},
		AssigneeID:   squadUUID,
		CreatorType:  "member",
		CreatorID:    memberUUID,
	}

	run, nr, err := svc.StartDefaultRunForIssue(ctx, issue)
	if err != nil {
		t.Fatalf("StartDefaultRunForIssue: %v", err)
	}
	dwf, err := svc.Queries.GetWorkflow(ctx, run.WorkflowID)
	if err != nil || !dwf.IsDefault {
		t.Fatalf("run not on the default workflow (err=%v)", err)
	}

	got, err := svc.Queries.GetWorkflowNodeRun(ctx, nr.ID)
	if err != nil {
		t.Fatalf("get node-run: %v", err)
	}
	// worker = the squad (dispatch resolves the leader from it); critic = creator.
	if got.WorkerType != "squad" || got.WorkerID != squadUUID {
		t.Fatalf("worker override: type=%q id=%v, want squad/%v", got.WorkerType, got.WorkerID, squadUUID)
	}
	if got.CriticType != "human" || got.CriticID != memberUUID {
		t.Fatalf("critic override: type=%q id=%v, want human/%v", got.CriticType, got.CriticID, memberUUID)
	}

	var dispatchCount int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM multica_workflow_node_run_dispatch_job
		WHERE workflow_node_run_id = $1 AND status = 'pending'
	`, nr.ID).Scan(&dispatchCount); err != nil {
		t.Fatalf("find dispatch for node-run: %v", err)
	}
	if dispatchCount != 1 {
		t.Fatalf("pending dispatch jobs=%d, want 1", dispatchCount)
	}
}

// uploadFakeGiteaServer stands up a minimal Gitea stand-in handling the branch /
// contents / pulls calls UploadMemberDeliverable makes. Returns the server, a
// pointer to a counter of PRs opened, and the request paths observed.
func uploadFakeGiteaServer(t *testing.T) (*httptest.Server, *int, *[]string) {
	t.Helper()
	var mu sync.Mutex
	branches := map[string]bool{}
	files := map[string]bool{}
	prs := 0
	paths := []string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		paths = append(paths, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		p := r.URL.Path
		switch {
		case r.Method == http.MethodPost && strings.HasSuffix(p, "/branches"):
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if name, ok := body["new_branch_name"].(string); ok {
				branches[name] = true
			}
			w.WriteHeader(http.StatusCreated)
		case r.Method == http.MethodPost && strings.Contains(p, "/contents/"):
			if files[p] {
				w.WriteHeader(http.StatusUnprocessableEntity)
				_ = json.NewEncoder(w).Encode(map[string]string{"message": "repository file already exists"})
				return
			}
			files[p] = true
			w.WriteHeader(http.StatusCreated)
		case r.Method == http.MethodGet && strings.Contains(p, "/contents/"):
			if !files[p] {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]string{"sha": "sha-" + fmt.Sprint(len(p))})
		case r.Method == http.MethodPut && strings.Contains(p, "/contents/"):
			files[p] = true
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodPost && strings.HasSuffix(p, "/pulls"):
			prs++
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"html_url": fmt.Sprintf("http://gitea.local/o/r/pulls/%d", prs),
				"number":   prs,
			})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	return srv, &prs, &paths
}

// TestUploadMemberDeliverable verifies the member-upload server-side path: writes
// the doc to the node branch, opens a PR, registers it on the submission, and
// advances the node-run into the critic phase.
func TestUploadMemberDeliverable(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	suffix := fmt.Sprintf("up-%d-%d", os.Getpid(), time.Now().UnixNano())

	var wsID, userID, memberID string
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workspace (name, slug, description, issue_prefix) VALUES ($1,$2,'t','UP') RETURNING id`, "UP WS "+suffix, "up-"+suffix).Scan(&wsID); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_user (name, email) VALUES ($1,$2) RETURNING id`, "UP User "+suffix, "up-"+suffix+"@multica.ai").Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_member (workspace_id, user_id, role) VALUES ($1,$2,'owner') RETURNING id`, wsID, userID).Scan(&memberID); err != nil {
		t.Fatalf("seed member: %v", err)
	}
	memberUUID, _ := util.ParseUUID(memberID)

	// default workflow + human worker/critic node + document deliverable
	var wfID, nodeID string
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow (workspace_id, title, status, created_by_type, is_default) VALUES ($1,'Default','active','system',TRUE) RETURNING id`, wsID).Scan(&wfID); err != nil {
		t.Fatalf("seed default wf: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_node (workflow_id, title, worker_type, worker_id, critic_type, critic_id, sort_order) VALUES ($1,'N','human',$2,'human',$3,0) RETURNING id`, wfID, memberID, memberID).Scan(&nodeID); err != nil {
		t.Fatalf("seed node: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO multica_workflow_node_deliverable (workflow_node_id, title, description, required, sort_order) VALUES ($1,'D','',TRUE,0)`, nodeID); err != nil {
		t.Fatalf("seed deliverable: %v", err)
	}

	var runID, nrID string
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_run (workflow_id, workspace_id, workflow_title, status, triggered_by_type, triggered_by_id) VALUES ($1,$2,'Default','running','member',$3) RETURNING id`, wfID, wsID, memberID).Scan(&runID); err != nil {
		t.Fatalf("seed run: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_node_run (workflow_run_id, workflow_node_id, node_title, status, retry_count, worker_type, worker_id, critic_type, critic_id) VALUES ($1,$2,'N','worker_assigned',0,'human',$3,'human',$4) RETURNING id`, runID, nodeID, memberID, memberID).Scan(&nrID); err != nil {
		t.Fatalf("seed node-run: %v", err)
	}
	runUUID, _ := util.ParseUUID(runID)
	nrUUID, _ := util.ParseUUID(nrID)
	nodeUUID, _ := util.ParseUUID(nodeID)
	wsUUID, _ := util.ParseUUID(wsID)
	if _, err := pool.Exec(ctx, `
		UPDATE multica_workflow_run
		SET definition_schema_version = 1,
		    definition_snapshot = jsonb_build_object(
		        'schema_version', 1, 'snapshot_origin', 'native',
		        'workflow', jsonb_build_object('id', $2::uuid, 'workspace_id', $3::uuid, 'title', 'Default', 'is_default', true),
		        'nodes', jsonb_build_array(jsonb_build_object('id', $4::uuid, 'title', 'N', 'sort_order', 0)),
		        'edges', '[]'::jsonb, 'stages', '[]'::jsonb, 'roles', '[]'::jsonb, 'deliverables', '[]'::jsonb
		    )
		WHERE id = $1
	`, runUUID, wfID, wsID, nodeID); err != nil {
		t.Fatalf("seed run snapshot: %v", err)
	}
	seedRuntimeDeliverableRequirement(t, pool, nrUUID, nodeUUID)

	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM multica_workflow WHERE workspace_id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_member WHERE workspace_id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_workspace WHERE id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_user WHERE id = $1`, userID)
	})

	srv, prCount, paths := uploadFakeGiteaServer(t)
	defer srv.Close()
	svc := &WorkflowService{
		Queries:   db.New(pool),
		TxStarter: pool,
		Gitea:     gitea.NewClient(gitea.Config{BaseURL: srv.URL, Token: "admin-tok"}),
	}

	issue := db.MulticaIssue{
		WorkspaceID:   wsUUID,
		AssigneeType:  pgtype.Text{String: "member", Valid: true},
		AssigneeID:    memberUUID,
		CreatorType:   "member",
		CreatorID:     memberUUID,
		WorkflowRunID: runUUID,
	}
	if err := svc.UploadMemberDeliverable(ctx, issue, []MemberDeliverableFile{{Name: "doc.md", Content: base64.StdEncoding.EncodeToString([]byte("# Hello\n\nDoc body."))}}, "", userID, ""); err != nil {
		t.Fatalf("UploadMemberDeliverable: %v", err)
	}

	if *prCount != 1 {
		t.Fatalf("want 1 PR opened, got %d", *prCount)
	}
	archiveRepoPath := "/api/v1/repos/" + gitea.OrgName(wsID) + "/" + gitea.RepoName(gitea.DefaultArchiveRepoName()) + "/"
	for _, p := range *paths {
		if !strings.Contains(p, archiveRepoPath) {
			t.Fatalf("Gitea request %q did not use default archive repo path %q; all paths: %v", p, archiveRepoPath, *paths)
		}
	}
	subs, err := svc.Queries.ListNodeRunDeliverableSubmissions(ctx, nrUUID)
	if err != nil {
		t.Fatalf("list submissions: %v", err)
	}
	if len(subs) != 1 || subs[0].PullRequestUrl == "" {
		t.Fatalf("want 1 submission with a PR url, got %+v", subs)
	}
	// Node-run advanced into the critic phase (human critic → critic_reviewing).
	got, err := svc.Queries.GetWorkflowNodeRun(ctx, nrUUID)
	if err != nil {
		t.Fatalf("get node-run: %v", err)
	}
	if got.Status != "critic_reviewing" && got.Status != "awaiting_critic" {
		t.Fatalf("node-run status=%q, want critic_reviewing/awaiting_critic", got.Status)
	}
}

func TestUploadMemberDeliverable_UpdatesExistingFileAfterRejection(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	suffix := fmt.Sprintf("up-retry-%d-%d", os.Getpid(), time.Now().UnixNano())

	var wsID, userID, memberID string
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workspace (name, slug, description, issue_prefix) VALUES ($1,$2,'t','UR') RETURNING id`, "UR WS "+suffix, "ur-"+suffix).Scan(&wsID); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_user (name, email) VALUES ($1,$2) RETURNING id`, "UR User "+suffix, "ur-"+suffix+"@multica.ai").Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_member (workspace_id, user_id, role) VALUES ($1,$2,'owner') RETURNING id`, wsID, userID).Scan(&memberID); err != nil {
		t.Fatalf("seed member: %v", err)
	}
	memberUUID, _ := util.ParseUUID(memberID)

	var wfID, nodeID, deliverableID string
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow (workspace_id, title, status, created_by_type, is_default) VALUES ($1,'Default','active','system',TRUE) RETURNING id`, wsID).Scan(&wfID); err != nil {
		t.Fatalf("seed default wf: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_node (workflow_id, title, worker_type, worker_id, critic_type, critic_id, sort_order) VALUES ($1,'N','human',$2,'human',$3,0) RETURNING id`, wfID, memberID, memberID).Scan(&nodeID); err != nil {
		t.Fatalf("seed node: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_node_deliverable (workflow_node_id, title, description, required, sort_order) VALUES ($1,'D','',TRUE,0) RETURNING id`, nodeID).Scan(&deliverableID); err != nil {
		t.Fatalf("seed deliverable: %v", err)
	}

	var runID, nrID string
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_run (workflow_id, workspace_id, workflow_title, status, triggered_by_type, triggered_by_id) VALUES ($1,$2,'Default','running','member',$3) RETURNING id`, wfID, wsID, memberID).Scan(&runID); err != nil {
		t.Fatalf("seed run: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_node_run (workflow_run_id, workflow_node_id, node_title, status, retry_count, worker_type, worker_id, critic_type, critic_id) VALUES ($1,$2,'N','worker_assigned',0,'human',$3,'human',$4) RETURNING id`, runID, nodeID, memberID, memberID).Scan(&nrID); err != nil {
		t.Fatalf("seed node-run: %v", err)
	}
	runUUID, _ := util.ParseUUID(runID)
	nrUUID, _ := util.ParseUUID(nrID)
	nodeUUID, _ := util.ParseUUID(nodeID)
	wsUUID, _ := util.ParseUUID(wsID)
	if _, err := pool.Exec(ctx, `
		UPDATE multica_workflow_run
		SET definition_schema_version = 1,
		    definition_snapshot = jsonb_build_object(
		        'schema_version', 1, 'snapshot_origin', 'native',
		        'workflow', jsonb_build_object('id', $2::uuid, 'workspace_id', $3::uuid, 'title', 'Default', 'is_default', true),
		        'nodes', jsonb_build_array(jsonb_build_object('id', $4::uuid, 'title', 'N', 'sort_order', 0)),
		        'edges', '[]'::jsonb, 'stages', '[]'::jsonb, 'roles', '[]'::jsonb, 'deliverables', '[]'::jsonb
		    )
		WHERE id = $1
	`, runUUID, wfID, wsID, nodeID); err != nil {
		t.Fatalf("seed run snapshot: %v", err)
	}
	runtimeDeliverableID := seedRuntimeDeliverableRequirement(t, pool, nrUUID, nodeUUID)

	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM multica_workflow WHERE workspace_id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_member WHERE workspace_id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_workspace WHERE id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_user WHERE id = $1`, userID)
	})

	srv, prCount, _ := uploadFakeGiteaServer(t)
	defer srv.Close()
	svc := &WorkflowService{
		Queries:   db.New(pool),
		TxStarter: pool,
		Gitea:     gitea.NewClient(gitea.Config{BaseURL: srv.URL, Token: "admin-tok"}),
	}

	issue := db.MulticaIssue{
		WorkspaceID:   wsUUID,
		AssigneeType:  pgtype.Text{String: "member", Valid: true},
		AssigneeID:    memberUUID,
		CreatorType:   "member",
		CreatorID:     memberUUID,
		WorkflowRunID: runUUID,
	}
	if err := svc.UploadMemberDeliverable(ctx, issue, []MemberDeliverableFile{{Name: "doc.md", Content: base64.StdEncoding.EncodeToString([]byte("# v1\n\nIncomplete."))}}, "", userID, ""); err != nil {
		t.Fatalf("first UploadMemberDeliverable: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE multica_workflow_node_run
		SET status = $1, retry_count = 1, critic_comment = 'needs more evidence'
		WHERE id = $2
	`, NodeRunStatusWorkerAssigned, nrID); err != nil {
		t.Fatalf("mark node-run rejected for retry: %v", err)
	}
	if got := nodeRunStatus(t, pool, nrUUID); got != NodeRunStatusWorkerAssigned {
		t.Fatalf("after rejection node-run status=%q, want %q", got, NodeRunStatusWorkerAssigned)
	}

	if err := svc.UploadMemberDeliverable(ctx, issue, []MemberDeliverableFile{{Name: "doc.md", Content: base64.StdEncoding.EncodeToString([]byte("# v2\n\nFinal evidence."))}}, "", userID, ""); err != nil {
		t.Fatalf("second UploadMemberDeliverable after rejection: %v", err)
	}

	if *prCount != 2 {
		t.Fatalf("want 2 PRs opened across two submissions, got %d", *prCount)
	}
	var status, prURL string
	if err := pool.QueryRow(ctx, `
		SELECT status, pull_request_url
		FROM multica_workflow_node_deliverable_submission
		WHERE workflow_node_run_id = $1 AND deliverable_id = $2
	`, nrID, runtimeDeliverableID).Scan(&status, &prURL); err != nil {
		t.Fatalf("read submission: %v", err)
	}
	if status != "submitted" || prURL == "" {
		t.Fatalf("submission after retry = status %q url %q, want submitted with PR", status, prURL)
	}
}

// TestPublishWorkflowEvent_NilBusNoPanic asserts that publishing a workflow
// event is a no-op (not a nil-pointer panic) when the service has no event Bus.
// Tests construct WorkflowService without a Bus, and dispatch / run-completion
// paths call publishWorkflowEvent; a missing Bus must never crash the process.
func TestPublishWorkflowEvent_NilBusNoPanic(t *testing.T) {
	s := &WorkflowService{} // Bus is nil
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("publishWorkflowEvent panicked with nil Bus: %v", r)
		}
	}()
	s.publishWorkflowEvent("workflow.run.completed", "ws-test", map[string]any{"k": "v"})
}

// TestUploadMemberDeliverable_PartialSetWaitsAndCarriesSummary verifies the
// tolerant advance: with both a document and a pull_request deliverable
// required, the first upload only records its submission (no error, no
// advance); the second upload advances the node-run and merges the member's
// summary into the worker output. A duplicate upload after the advance is
// rejected by the worker-phase guard (ErrNodeRunNotInWorkerPhase) before any
// side effect, leaving status and submissions untouched.
func TestUploadMemberDeliverable_PartialSetWaitsAndCarriesSummary(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	suffix := fmt.Sprintf("upp-%d-%d", os.Getpid(), time.Now().UnixNano())

	var wsID, userID, memberID string
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workspace (name, slug, description, issue_prefix) VALUES ($1,$2,'t','UPP') RETURNING id`, "UPP WS "+suffix, "upp-"+suffix).Scan(&wsID); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_user (name, email) VALUES ($1,$2) RETURNING id`, "UPP User "+suffix, "upp-"+suffix+"@multica.ai").Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_member (workspace_id, user_id, role) VALUES ($1,$2,'owner') RETURNING id`, wsID, userID).Scan(&memberID); err != nil {
		t.Fatalf("seed member: %v", err)
	}
	memberUUID := util.MustParseUUID(memberID)

	var wfID, nodeID string
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow (workspace_id, title, status, created_by_type, is_default) VALUES ($1,'Default','active','system',TRUE) RETURNING id`, wsID).Scan(&wfID); err != nil {
		t.Fatalf("seed default wf: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_node (workflow_id, title, worker_type, worker_id, critic_type, critic_id, sort_order) VALUES ($1,'N','human',$2,'human',$3,0) RETURNING id`, wfID, memberID, memberID).Scan(&nodeID); err != nil {
		t.Fatalf("seed node: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO multica_workflow_node_deliverable (workflow_node_id, title, description, required, sort_order) VALUES ($1,'Doc','',TRUE,0)`, nodeID); err != nil {
		t.Fatalf("seed document deliverable: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO multica_workflow_node_deliverable (workflow_node_id, title, description, required, sort_order) VALUES ($1,'Code','',TRUE,1)`, nodeID); err != nil {
		t.Fatalf("seed pull_request deliverable: %v", err)
	}

	var runID, nrID string
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_run (workflow_id, workspace_id, workflow_title, status, triggered_by_type, triggered_by_id) VALUES ($1,$2,'Default','running','member',$3) RETURNING id`, wfID, wsID, memberID).Scan(&runID); err != nil {
		t.Fatalf("seed run: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_node_run (workflow_run_id, workflow_node_id, node_title, status, retry_count, worker_type, worker_id, critic_type, critic_id) VALUES ($1,$2,'N','worker_assigned',0,'human',$3,'human',$4) RETURNING id`, runID, nodeID, memberID, memberID).Scan(&nrID); err != nil {
		t.Fatalf("seed node-run: %v", err)
	}
	runUUID := util.MustParseUUID(runID)
	nrUUID := util.MustParseUUID(nrID)
	nodeUUID := util.MustParseUUID(nodeID)
	wsUUID := util.MustParseUUID(wsID)
	if _, err := pool.Exec(ctx, `
		UPDATE multica_workflow_run
		SET definition_schema_version = 1,
		    definition_snapshot = jsonb_build_object(
		        'schema_version', 1, 'snapshot_origin', 'native',
		        'workflow', jsonb_build_object('id', $2::uuid, 'workspace_id', $3::uuid, 'title', 'Default', 'is_default', true),
		        'nodes', jsonb_build_array(jsonb_build_object('id', $4::uuid, 'title', 'N', 'sort_order', 0)),
		        'edges', '[]'::jsonb, 'stages', '[]'::jsonb, 'roles', '[]'::jsonb, 'deliverables', '[]'::jsonb
		    )
		WHERE id = $1
	`, runUUID, wfID, wsID, nodeID); err != nil {
		t.Fatalf("seed run snapshot: %v", err)
	}
	runtimeDocID := seedRuntimeDeliverableRequirement(t, pool, nrUUID, nodeUUID)
	runtimeCodeID := seedRuntimeDeliverableRequirement(t, pool, nrUUID, nodeUUID)

	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM multica_workflow WHERE workspace_id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_member WHERE workspace_id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_workspace WHERE id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_user WHERE id = $1`, userID)
	})

	srv, _, _ := uploadFakeGiteaServer(t)
	defer srv.Close()
	svc := &WorkflowService{
		Queries:   db.New(pool),
		TxStarter: pool,
		Gitea:     gitea.NewClient(gitea.Config{BaseURL: srv.URL, Token: "admin-tok"}),
	}

	issue := db.MulticaIssue{
		WorkspaceID:   wsUUID,
		AssigneeType:  pgtype.Text{String: "member", Valid: true},
		AssigneeID:    memberUUID,
		CreatorType:   "member",
		CreatorID:     memberUUID,
		WorkflowRunID: runUUID,
	}
	files := []MemberDeliverableFile{{Name: "doc.md", Content: base64.StdEncoding.EncodeToString([]byte("# Doc\n"))}}

	// 1. Document upload: recorded, but no advance while the code link is missing.
	if err := svc.UploadMemberDeliverable(ctx, issue, files, util.UUIDToString(runtimeDocID), userID, "done: docs"); err != nil {
		t.Fatalf("UploadMemberDeliverable (partial set): %v", err)
	}
	if got := nodeRunStatus(t, pool, nrUUID); got != NodeRunStatusWorkerAssigned {
		t.Fatalf("after partial upload status = %q, want %q", got, NodeRunStatusWorkerAssigned)
	}

	// 2. Code upload: set complete → advances, and the output carries the summary.
	if err := svc.UploadMemberDeliverablePR(ctx, issue, []string{"https://git.example/o/r/pulls/9"}, util.UUIDToString(runtimeCodeID), userID, "done: docs"); err != nil {
		t.Fatalf("UploadMemberDeliverablePR: %v", err)
	}
	got, err := svc.Queries.GetWorkflowNodeRun(ctx, nrUUID)
	if err != nil {
		t.Fatalf("get node-run: %v", err)
	}
	if got.Status != "critic_reviewing" && got.Status != "awaiting_critic" {
		t.Fatalf("node-run status=%q, want critic_reviewing/awaiting_critic", got.Status)
	}
	if out := string(got.WorkerOutput); !strings.Contains(out, "done: docs") || !strings.Contains(out, "pull_request_url") {
		t.Fatalf("worker output = %q, want summary + pull_request_url", out)
	}

	// 3. Duplicate upload after the advance: the worker-phase guard rejects it
	// before any side effect — no error-tolerant reset of the reviewed state.
	if err := svc.UploadMemberDeliverable(ctx, issue, files, "", userID, ""); !errors.Is(err, ErrNodeRunNotInWorkerPhase) {
		t.Fatalf("duplicate UploadMemberDeliverable err = %v, want ErrNodeRunNotInWorkerPhase", err)
	}
	if got := nodeRunStatus(t, pool, nrUUID); got != "critic_reviewing" && got != "awaiting_critic" {
		t.Fatalf("after rejected duplicate status=%q, want critic phase", got)
	}
	subs, err := svc.Queries.ListNodeRunDeliverableSubmissions(ctx, nrUUID)
	if err != nil {
		t.Fatalf("list submissions: %v", err)
	}
	if len(subs) != 2 {
		t.Fatalf("want 2 submissions (doc + code) after rejected duplicate, got %d: %+v", len(subs), subs)
	}
}

// multiLinkFakeGiteaServer models Gitea's one-open-PR-per-(head,base) rule,
// which uploadFakeGiteaServer does not: a duplicate POST /pulls for the same
// head+base gets a 409 and the client falls back to listing open PRs, so a
// same-link resubmit reuses its PR — the basis of submission-row idempotency.
func multiLinkFakeGiteaServer(t *testing.T) (*httptest.Server, *[]string) {
	t.Helper()
	type openPR struct {
		head string
		base string
		url  string
	}
	var mu sync.Mutex
	files := map[string]bool{}
	prs := map[string]openPR{}
	nextPR := 0
	paths := []string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		paths = append(paths, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		p := r.URL.Path
		switch {
		case r.Method == http.MethodPost && strings.HasSuffix(p, "/branches"):
			w.WriteHeader(http.StatusCreated)
		case r.Method == http.MethodPost && strings.Contains(p, "/contents/"):
			if files[p] {
				w.WriteHeader(http.StatusUnprocessableEntity)
				_ = json.NewEncoder(w).Encode(map[string]string{"message": "repository file already exists"})
				return
			}
			files[p] = true
			w.WriteHeader(http.StatusCreated)
		case r.Method == http.MethodGet && strings.Contains(p, "/contents/"):
			if !files[p] {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]string{"sha": "sha-x"})
		case r.Method == http.MethodPut && strings.Contains(p, "/contents/"):
			files[p] = true
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodPost && strings.HasSuffix(p, "/pulls"):
			var body struct {
				Head string `json:"head"`
				Base string `json:"base"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			key := body.Head + "->" + body.Base
			if _, ok := prs[key]; ok {
				w.WriteHeader(http.StatusConflict)
				return
			}
			nextPR++
			prs[key] = openPR{head: body.Head, base: body.Base, url: fmt.Sprintf("http://gitea.local/o/r/pulls/%d", nextPR)}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"html_url": prs[key].url, "number": nextPR})
		case r.Method == http.MethodGet && strings.HasSuffix(p, "/pulls"):
			out := []map[string]any{}
			for _, pr := range prs {
				out = append(out, map[string]any{
					"html_url": pr.url,
					"head":     map[string]any{"ref": pr.head},
					"base":     map[string]any{"ref": pr.base},
				})
			}
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(out)
		case r.Method == http.MethodPost && strings.HasSuffix(p, "/merge"):
			w.WriteHeader(http.StatusOK)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &paths
}

// multiLinkSeed seeds a workspace + default workflow with one human-worked
// node carrying two required pull_request deliverables, a running run and a
// worker_assigned node run, plus the run snapshot the Gitea path needs.
// Returns everything the multi-link tests parameterize over.
func multiLinkSeed(t *testing.T, pool *pgxpool.Pool, prefix string) (
	issue db.MulticaIssue, nrID string, runtimeDeliverableIDs map[string]string, userID string,
) {
	t.Helper()
	ctx := context.Background()
	suffix := fmt.Sprintf("%s-%d-%d", prefix, os.Getpid(), time.Now().UnixNano())

	var wsID, memberID string
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workspace (name, slug, description, issue_prefix) VALUES ($1,$2,'t','ML') RETURNING id`, "ML WS "+suffix, "ml-"+suffix).Scan(&wsID); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_user (name, email) VALUES ($1,$2) RETURNING id`, "ML User "+suffix, "ml-"+suffix+"@multica.ai").Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_member (workspace_id, user_id, role) VALUES ($1,$2,'owner') RETURNING id`, wsID, userID).Scan(&memberID); err != nil {
		t.Fatalf("seed member: %v", err)
	}

	var wfID, nodeID, delAID, delBID string
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow (workspace_id, title, status, created_by_type, is_default) VALUES ($1,'Default','active','system',TRUE) RETURNING id`, wsID).Scan(&wfID); err != nil {
		t.Fatalf("seed default wf: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_node (workflow_id, title, worker_type, worker_id, critic_type, critic_id, sort_order) VALUES ($1,'N','human',$2,'human',$3,0) RETURNING id`, wfID, memberID, memberID).Scan(&nodeID); err != nil {
		t.Fatalf("seed node: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_node_deliverable (workflow_node_id, title, description, required, sort_order) VALUES ($1,'Code A','',TRUE,0) RETURNING id`, nodeID).Scan(&delAID); err != nil {
		t.Fatalf("seed deliverable A: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_node_deliverable (workflow_node_id, title, description, required, sort_order) VALUES ($1,'Code B','',TRUE,1) RETURNING id`, nodeID).Scan(&delBID); err != nil {
		t.Fatalf("seed deliverable B: %v", err)
	}

	var runID string
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_run (workflow_id, workspace_id, workflow_title, status, triggered_by_type, triggered_by_id) VALUES ($1,$2,'Default','running','member',$3) RETURNING id`, wfID, wsID, memberID).Scan(&runID); err != nil {
		t.Fatalf("seed run: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_node_run (workflow_run_id, workflow_node_id, node_title, status, retry_count, worker_type, worker_id, critic_type, critic_id) VALUES ($1,$2,'N','worker_assigned',0,'human',$3,'human',$4) RETURNING id`, runID, nodeID, memberID, memberID).Scan(&nrID); err != nil {
		t.Fatalf("seed node-run: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE multica_workflow_run
		SET definition_schema_version = 1,
		    definition_snapshot = jsonb_build_object(
		        'schema_version', 1, 'snapshot_origin', 'native',
		        'workflow', jsonb_build_object('id', $2::uuid, 'workspace_id', $3::uuid, 'title', 'Default', 'is_default', true),
		        'nodes', jsonb_build_array(jsonb_build_object('id', $4::uuid, 'title', 'N', 'sort_order', 0)),
		        'edges', '[]'::jsonb, 'stages', '[]'::jsonb, 'roles', '[]'::jsonb, 'deliverables', '[]'::jsonb
		    )
		WHERE id = $1
	`, runID, wfID, wsID, nodeID); err != nil {
		t.Fatalf("seed run snapshot: %v", err)
	}

	// Runtime requirements for BOTH pull_request deliverables (the shared
	// seedRuntimeDeliverableRequirement copies only the first of a kind).
	runtimeDeliverableIDs = map[string]string{}
	for _, pair := range [][2]string{{"A", delAID}, {"B", delBID}} {
		var reqID string
		if err := pool.QueryRow(ctx, `
			INSERT INTO multica_workflow_node_run_deliverable (
				workflow_node_run_id, source_deliverable_id, title, description, required, sort_order
			)
			SELECT $1, deliverable.id, deliverable.title,
			       deliverable.description, deliverable.required, deliverable.sort_order
			FROM multica_workflow_node_deliverable deliverable
			WHERE deliverable.id = $2
			RETURNING id
		`, nrID, pair[1]).Scan(&reqID); err != nil {
			t.Fatalf("seed runtime requirement %s: %v", pair[0], err)
		}
		runtimeDeliverableIDs[pair[0]] = reqID
	}

	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM multica_workflow WHERE workspace_id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_member WHERE workspace_id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_workspace WHERE id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_user WHERE id = $1`, userID)
	})

	issue = db.MulticaIssue{
		WorkspaceID:   util.MustParseUUID(wsID),
		AssigneeType:  pgtype.Text{String: "member", Valid: true},
		AssigneeID:    util.MustParseUUID(memberID),
		CreatorType:   "member",
		CreatorID:     util.MustParseUUID(memberID),
		WorkflowRunID: util.MustParseUUID(runID),
	}
	return issue, nrID, runtimeDeliverableIDs, userID
}

// TestUploadMemberDeliverablePR_MultiLinkPerDeliverable covers the multi-link
// data model (migration 149) end to end at the service level: one call carries
// two links for the same deliverable and records one submission row per link
// (each archived on its own branch/PR); an explicit deliverable_id unlocks two
// same-kind required deliverables (partial set waits, completion advances);
// re-submitting an existing link after a rework round updates its row in
// place instead of duplicating it or overwriting the sibling link.
func TestUploadMemberDeliverablePR_MultiLinkPerDeliverable(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	issue, nrID, reqIDs, userID := multiLinkSeed(t, pool, "ml")
	nrUUID := util.MustParseUUID(nrID)

	srv, paths := multiLinkFakeGiteaServer(t)
	svc := &WorkflowService{
		Queries:   db.New(pool),
		TxStarter: pool,
		Gitea:     gitea.NewClient(gitea.Config{BaseURL: srv.URL, Token: "admin-tok"}),
	}

	linkA1 := "https://git.example/o/r/-/merge_requests/1"
	linkA2 := "https://git.example/o/r/-/merge_requests/2"
	linkB1 := "https://git.example/o/r/-/merge_requests/3"

	// 1. Two links for deliverable A in one call: two distinct submission
	// rows, no advance while required deliverable B is still missing.
	if err := svc.UploadMemberDeliverablePR(ctx, issue, []string{linkA1, linkA2}, reqIDs["A"], userID, "half"); err != nil {
		t.Fatalf("upload links for A: %v", err)
	}
	if got := nodeRunStatus(t, pool, nrUUID); got != NodeRunStatusWorkerAssigned {
		t.Fatalf("after partial multi-link upload status = %q, want %q", got, NodeRunStatusWorkerAssigned)
	}
	subs, err := svc.Queries.ListNodeRunDeliverableSubmissions(ctx, nrUUID)
	if err != nil {
		t.Fatalf("list submissions: %v", err)
	}
	if len(subs) != 2 {
		t.Fatalf("want 2 link submissions for deliverable A, got %d: %+v", len(subs), subs)
	}
	for _, sub := range subs {
		if util.UUIDToString(sub.DeliverableID) != reqIDs["A"] {
			t.Fatalf("submission %v landed on the wrong deliverable, want A=%s", sub.DeliverableID, reqIDs["A"])
		}
		if !strings.Contains(sub.PullRequestUrl, "gitea.local") {
			t.Fatalf("submission URL %q, want the archived Gitea PR", sub.PullRequestUrl)
		}
	}
	if subs[0].PullRequestUrl == subs[1].PullRequestUrl {
		t.Fatalf("both links collapsed onto one review URL %q — per-link branch required", subs[0].PullRequestUrl)
	}

	// 2. Deliverable B by explicit id: the set completes and the node advances.
	if err := svc.UploadMemberDeliverablePR(ctx, issue, []string{linkB1}, reqIDs["B"], userID, "all links in"); err != nil {
		t.Fatalf("upload link for B: %v", err)
	}
	got, err := svc.Queries.GetWorkflowNodeRun(ctx, nrUUID)
	if err != nil {
		t.Fatalf("get node-run: %v", err)
	}
	if got.Status != "critic_reviewing" && got.Status != "awaiting_critic" {
		t.Fatalf("node-run status=%q, want critic phase", got.Status)
	}
	if out := string(got.WorkerOutput); !strings.Contains(out, "all links in") {
		t.Fatalf("worker output = %q, want the summary", out)
	}

	// 3. Rework round: re-submitting link A1 reuses its branch/PR (the fake
	// 409s the duplicate POST and the client finds the open PR), so the row
	// count stays at three and every URL is unchanged.
	if _, err := pool.Exec(ctx, `UPDATE multica_workflow_node_run SET status = $1, retry_count = 1 WHERE id = $2`, NodeRunStatusWorkerAssigned, nrID); err != nil {
		t.Fatalf("reset for rework: %v", err)
	}
	if err := svc.UploadMemberDeliverablePR(ctx, issue, []string{linkA1}, reqIDs["A"], userID, ""); err != nil {
		t.Fatalf("resubmit link A1: %v", err)
	}
	subs, err = svc.Queries.ListNodeRunDeliverableSubmissions(ctx, nrUUID)
	if err != nil {
		t.Fatalf("list submissions after resubmit: %v", err)
	}
	if len(subs) != 3 {
		t.Fatalf("same-link resubmit must be idempotent — want 3 rows, got %d: %+v", len(subs), subs)
	}
	linkArchives := 0
	for _, p := range *paths {
		// The per-link archive file carries the link hash (branch names travel
		// in the request body, so the fake's path log only sees the file).
		if strings.Contains(p, "/contents/") && strings.Contains(p, "Code A-") {
			linkArchives++
		}
	}
	if linkArchives == 0 {
		t.Fatalf("no per-link archive file seen in Gitea traffic: %v", *paths)
	}
}

// TestUploadMemberDeliverablePR_ConcurrentRequirementsAdvance verifies that
// two uploads completing different required deliverables serialize on the
// node-run row. Without the upload-scoped lock both transactions can see only
// their own new row, commit as partial, and leave a complete node stranded in
// worker_assigned.
func TestUploadMemberDeliverablePR_ConcurrentRequirementsAdvance(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	issue, nrID, reqIDs, userID := multiLinkSeed(t, pool, "mlc")
	nrUUID := util.MustParseUUID(nrID)
	svc := &WorkflowService{Queries: db.New(pool), TxStarter: pool}

	start := make(chan struct{})
	errs := make(chan error, 2)
	upload := func(deliverableID, link string) {
		<-start
		errs <- svc.UploadMemberDeliverablePR(ctx, issue, []string{link}, deliverableID, userID, "")
	}
	go upload(reqIDs["A"], "https://git.example/o/r/-/merge_requests/41")
	go upload(reqIDs["B"], "https://git.example/o/r/-/merge_requests/42")
	close(start)

	for range 2 {
		if err := <-errs; err != nil {
			t.Fatalf("concurrent upload: %v", err)
		}
	}
	if got := nodeRunStatus(t, pool, nrUUID); got != NodeRunStatusAwaitingCritic && got != NodeRunStatusCriticReviewing {
		t.Fatalf("after concurrent complete set status=%q, want critic phase", got)
	}
	subs, err := svc.Queries.ListNodeRunDeliverableSubmissions(ctx, nrUUID)
	if err != nil {
		t.Fatalf("list concurrent submissions: %v", err)
	}
	if len(subs) != 2 {
		t.Fatalf("concurrent complete set recorded %d submissions, want 2", len(subs))
	}
}

// TestUploadMemberDeliverablePR_DormantMultiLink covers the no-Gitea fallback:
// links are recorded verbatim, several per deliverable, and a same-link
// resubmit upserts the same row (idempotent by URL).
func TestUploadMemberDeliverablePR_DormantMultiLink(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	issue, nrID, reqIDs, userID := multiLinkSeed(t, pool, "mld")
	nrUUID := util.MustParseUUID(nrID)

	svc := &WorkflowService{Queries: db.New(pool), TxStarter: pool} // no Gitea — dormant

	linkA1 := "https://git.example/o/r/-/merge_requests/1"
	linkA2 := "https://git.example/o/r/-/merge_requests/2"

	// Both required deliverables in one call each: A first (partial), then B
	// (advances, recorded with the raw pasted URL).
	if err := svc.UploadMemberDeliverablePR(ctx, issue, []string{linkA1, linkA2}, reqIDs["A"], userID, ""); err != nil {
		t.Fatalf("dormant upload A: %v", err)
	}
	if err := svc.UploadMemberDeliverablePR(ctx, issue, []string{"https://git.example/o/r/-/merge_requests/3"}, reqIDs["B"], userID, ""); err != nil {
		t.Fatalf("dormant upload B: %v", err)
	}
	if got := nodeRunStatus(t, pool, nrUUID); got != "critic_reviewing" && got != "awaiting_critic" {
		t.Fatalf("dormant node-run status=%q, want critic phase", got)
	}
	subs, err := svc.Queries.ListNodeRunDeliverableSubmissions(ctx, nrUUID)
	if err != nil {
		t.Fatalf("list submissions: %v", err)
	}
	if len(subs) != 3 {
		t.Fatalf("want 3 dormant submissions, got %d: %+v", len(subs), subs)
	}
	urls := map[string]int{}
	for _, sub := range subs {
		urls[sub.PullRequestUrl]++
	}
	if urls[linkA1] != 1 || urls[linkA2] != 1 {
		t.Fatalf("dormant submissions must record the pasted links, got %v", urls)
	}

	// Same-link resubmit after a rework reset upserts by URL — still 3 rows.
	if _, err := pool.Exec(ctx, `UPDATE multica_workflow_node_run SET status = $1, retry_count = 1 WHERE id = $2`, NodeRunStatusWorkerAssigned, nrID); err != nil {
		t.Fatalf("reset for rework: %v", err)
	}
	if err := svc.UploadMemberDeliverablePR(ctx, issue, []string{linkA1}, reqIDs["A"], userID, ""); err != nil {
		t.Fatalf("dormant resubmit A1: %v", err)
	}
	subs, err = svc.Queries.ListNodeRunDeliverableSubmissions(ctx, nrUUID)
	if err != nil {
		t.Fatalf("list submissions after resubmit: %v", err)
	}
	if len(subs) != 3 {
		t.Fatalf("dormant same-link resubmit must stay idempotent — want 3 rows, got %d", len(subs))
	}
}

// TestMergeDeliverablePRs_SkipsRejectedSubmissions pins the multi-row merge
// contract: only live (submitted) rows have their review PRs merged and get
// marked approved — a rejected link keeps its never-closed PR unmerged and
// its status untouched.
func TestMergeDeliverablePRs_SkipsRejectedSubmissions(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	_, nrID, reqIDs, _ := multiLinkSeed(t, pool, "mgm")
	nrUUID := util.MustParseUUID(nrID)

	srv, paths := multiLinkFakeGiteaServer(t)
	svc := &WorkflowService{
		Queries:   db.New(pool),
		TxStarter: pool,
		Gitea:     gitea.NewClient(gitea.Config{BaseURL: srv.URL, Token: "admin-tok"}),
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO multica_workflow_node_deliverable_submission (
			workflow_node_run_id, deliverable_id, submitted_by_type, status, pull_request_url
		) VALUES
			($1, $2, 'member', 'submitted', 'http://gitea.local/o/r/pulls/1'),
			($1, $2, 'member', 'rejected',  'http://gitea.local/o/r/pulls/2')
	`, nrID, reqIDs["A"]); err != nil {
		t.Fatalf("seed submissions: %v", err)
	}

	nodeRun, err := svc.Queries.GetWorkflowNodeRun(ctx, nrUUID)
	if err != nil {
		t.Fatalf("get node-run: %v", err)
	}
	if err := svc.mergeDeliverablePRs(ctx, nodeRun); err != nil {
		t.Fatalf("mergeDeliverablePRs: %v", err)
	}

	merged1, merged2 := false, false
	for _, p := range *paths {
		if strings.HasSuffix(p, "/pulls/1/merge") {
			merged1 = true
		}
		if strings.HasSuffix(p, "/pulls/2/merge") {
			merged2 = true
		}
	}
	if !merged1 {
		t.Fatalf("submitted link's PR was not merged: %v", *paths)
	}
	if merged2 {
		t.Fatalf("rejected link's PR must not merge: %v", *paths)
	}

	svc.markDeliverableSubmissionsApproved(ctx, nodeRun)
	rows, err := pool.Query(ctx, `SELECT status, pull_request_url FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id = $1 ORDER BY pull_request_url`, nrID)
	if err != nil {
		t.Fatalf("read submissions: %v", err)
	}
	defer rows.Close()
	statusByURL := map[string]string{}
	for rows.Next() {
		var status, url string
		if err := rows.Scan(&status, &url); err != nil {
			t.Fatalf("scan: %v", err)
		}
		statusByURL[url] = status
	}
	if got := statusByURL["http://gitea.local/o/r/pulls/1"]; got != "approved" {
		t.Fatalf("merged submission status = %q, want approved", got)
	}
	if got := statusByURL["http://gitea.local/o/r/pulls/2"]; got != "rejected" {
		t.Fatalf("rejected submission status = %q, want it to stay rejected", got)
	}
}

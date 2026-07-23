package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
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
	if len(dels) != 1 || dels[0].Kind != "document" {
		t.Fatalf("want 1 document deliverable, got %+v", dels)
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
	memberUUID, _ := util.ParseUUID(memberID)

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

	// Agent task dispatched and linked to the node-run (so the daemon receives
	// Gitea deliverable context via buildGiteaDeliverableContext).
	var taskCount int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM multica_agent_task_queue WHERE workflow_node_run_id = $1
	`, nr.ID).Scan(&taskCount); err != nil {
		t.Fatalf("count tasks: %v", err)
	}
	if taskCount != 1 {
		t.Fatalf("want 1 agent task linked to node-run, got %d", taskCount)
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
	memberUUID, _ := util.ParseUUID(memberID)

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

	// dispatchWorker's squad case must resolve + task the LEADER agent, linked to
	// the node-run (so buildGiteaDeliverableContext fires for the leader).
	var taskAgentID string
	if err := pool.QueryRow(ctx, `
		SELECT agent_id FROM multica_agent_task_queue WHERE workflow_node_run_id = $1
	`, nr.ID).Scan(&taskAgentID); err != nil {
		t.Fatalf("find task for node-run: %v", err)
	}
	if taskAgentID != agentID {
		t.Fatalf("squad dispatch tasked agent %s, want the leader %s", taskAgentID, agentID)
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
	if _, err := pool.Exec(ctx, `INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order) VALUES ($1,'document','D','',TRUE,0)`, nodeID); err != nil {
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
	wsUUID, _ := util.ParseUUID(wsID)

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
	if err := svc.UploadMemberDeliverable(ctx, issue, []MemberDeliverableFile{{Name: "doc.md", Content: base64.StdEncoding.EncodeToString([]byte("# Hello\n\nDoc body."))}}); err != nil {
		t.Fatalf("UploadMemberDeliverable: %v", err)
	}

	if *prCount != 1 {
		t.Fatalf("want 1 PR opened, got %d", *prCount)
	}
	archiveRepoPath := "/api/v1/repos/" + gitea.OrgName(wsID) + "/" + gitea.DefaultArchiveRepoName() + "/"
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
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order) VALUES ($1,'document','D','',TRUE,0) RETURNING id`, nodeID).Scan(&deliverableID); err != nil {
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
	wsUUID, _ := util.ParseUUID(wsID)

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
	if err := svc.UploadMemberDeliverable(ctx, issue, []MemberDeliverableFile{{Name: "doc.md", Content: base64.StdEncoding.EncodeToString([]byte("# v1\n\nIncomplete."))}}); err != nil {
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

	if err := svc.UploadMemberDeliverable(ctx, issue, []MemberDeliverableFile{{Name: "doc.md", Content: base64.StdEncoding.EncodeToString([]byte("# v2\n\nFinal evidence."))}}); err != nil {
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
	`, nrID, deliverableID).Scan(&status, &prURL); err != nil {
		t.Fatalf("read submission: %v", err)
	}
	if status != "submitted" || prURL == "" {
		t.Fatalf("submission after retry = status %q url %q, want submitted with PR", status, prURL)
	}
}

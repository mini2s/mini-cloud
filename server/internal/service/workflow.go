package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/coderepo"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/teamnamespace"
	"github.com/multica-ai/multica/server/internal/util"
	"github.com/multica-ai/multica/server/internal/workflowmeta"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// WorkflowService manages workflow DAG validation, run lifecycle,
// node-run state machine transitions, and the Worker-Critic loop.
type WorkflowService struct {
	Queries                          *db.Queries
	TxStarter                        TxStarter
	Bus                              *events.Bus
	TaskSvc                          *TaskService
	AutoResolveRoles                 bool
	RoleResolutionModel              string
	RoleResolutionPromptVersion      string
	RoleResolutionWorkspaceAllowlist map[string]struct{}
	RoleResolutionMaxActiveJobs      int64

	// RepositoryProvider is the provider-neutral surface for deliverable
	// repository file, branch, review-request, and merge operations.
	RepositoryProvider coderepo.RepositoryProvider

	// are unset — the client is always non-nil post-construction; dormancy is
	// TeamNamespace is the costrict-web-backend internal API client for team
	// namespace lifecycle, membership sync, bot credentials, and workflow repo
	// initialization. When configured, it is the source of truth for every
	// TEAM_NAMESPACE_API_REFERENCE.md boundary; Gitea remains only for current
	// document PR/file operations that are not covered by that contract.
	TeamNamespace *teamnamespace.Client

	// OnNodeStatusChanged fires after TransitionNodeRun succeeds.
	OnNodeStatusChanged func(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun)

	// OnRunTerminal fires when a workflow run reaches a terminal status
	// (completed, failed, or cancelled).
	OnRunTerminal func(ctx context.Context, run db.MulticaWorkflowRun, status string)
}

var ErrWorkflowRoleResolutionLimit = errors.New("workflow role resolution active job limit reached")
var ErrWorkflowHasRuns = errors.New("workflow has runs")
var ErrWorkflowDefinitionInUse = errors.New("workflow definition is used by an active run")

func (s *WorkflowService) roleResolutionEnabledFor(workspaceID pgtype.UUID) bool {
	if !s.AutoResolveRoles {
		return false
	}
	if len(s.RoleResolutionWorkspaceAllowlist) == 0 {
		return true
	}
	_, ok := s.RoleResolutionWorkspaceAllowlist[util.UUIDToString(workspaceID)]
	return ok
}

func NewWorkflowService(q *db.Queries, tx TxStarter, bus *events.Bus, taskSvc *TaskService) *WorkflowService {
	return &WorkflowService{Queries: q, TxStarter: tx, Bus: bus, TaskSvc: taskSvc}
}

// ── State machine constants ──────────────────────────────────────────────────

const (
	NodeRunStatusPending         = "pending"
	NodeRunStatusFormatChecking  = "format_checking"
	NodeRunStatusFormatOk        = "format_ok"
	NodeRunStatusFormatFailed    = "format_failed"
	NodeRunStatusWorkerAssigned  = "worker_assigned"
	NodeRunStatusWorking         = "working"
	NodeRunStatusAwaitingInput   = "awaiting_input"
	NodeRunStatusAwaitingCritic  = "awaiting_critic"
	NodeRunStatusCriticReviewing = "critic_reviewing"
	NodeRunStatusCriticApproved  = "critic_approved"
	NodeRunStatusCriticRework    = "critic_rework"
	NodeRunStatusCompleted       = "completed"
	NodeRunStatusFailed          = "failed"
	NodeRunStatusBlocked         = "blocked"
	NodeRunStatusSkipped         = "skipped"
	NodeRunStatusCancelled       = "cancelled"

	RunStatusRunning               = "running"
	RunStatusResolvingRoles        = "resolving_roles"
	RunStatusWaitingRoleAssignment = "waiting_role_assignment"
	RunStatusCompleted             = "completed"
	RunStatusFailed                = "failed"
	RunStatusCancelled             = "cancelled"
)

// validTransitions defines the allowed status transitions for a node run.
var validTransitions = map[string][]string{
	NodeRunStatusPending:             {NodeRunStatusFormatChecking, NodeRunStatusSplitting, NodeRunStatusSkipped, NodeRunStatusCancelled},
	NodeRunStatusFormatChecking:      {NodeRunStatusFormatOk, NodeRunStatusCompleted, NodeRunStatusFormatFailed, NodeRunStatusCancelled},
	NodeRunStatusFormatOk:            {NodeRunStatusWorkerAssigned, NodeRunStatusWorking, NodeRunStatusSplitting, NodeRunStatusCancelled, NodeRunStatusSkipped},
	NodeRunStatusFormatFailed:        {},
	NodeRunStatusWorkerAssigned:      {NodeRunStatusWorking, NodeRunStatusCancelled, NodeRunStatusSkipped},
	NodeRunStatusWorking:             {NodeRunStatusAwaitingInput, NodeRunStatusAwaitingCritic, NodeRunStatusFailed, NodeRunStatusCancelled, NodeRunStatusBlocked},
	NodeRunStatusAwaitingInput:       {NodeRunStatusWorking, NodeRunStatusCancelled, NodeRunStatusSkipped},
	NodeRunStatusAwaitingCritic:      {NodeRunStatusCriticReviewing, NodeRunStatusCancelled, NodeRunStatusSkipped},
	NodeRunStatusCriticReviewing:     {NodeRunStatusCriticApproved, NodeRunStatusCriticRework, NodeRunStatusFailed, NodeRunStatusCancelled},
	NodeRunStatusCriticApproved:      {NodeRunStatusCompleted, NodeRunStatusBlocked},
	NodeRunStatusCriticRework:        {NodeRunStatusFormatOk, NodeRunStatusBlocked},
	NodeRunStatusCompleted:           {},
	NodeRunStatusFailed:              {},
	NodeRunStatusSplitting:           {NodeRunStatusAwaitingSplitReview, NodeRunStatusFailed, NodeRunStatusCancelled},
	NodeRunStatusAwaitingSplitReview: {NodeRunStatusSplitting, NodeRunStatusSplitActive, NodeRunStatusCancelled},
	NodeRunStatusSplitActive:         {NodeRunStatusCompleted, NodeRunStatusFailed, NodeRunStatusCancelled},
	// blocked is reached two ways: rework-exhausted ("stuck", completed_at set)
	// and human takeover ("paused", completed_at NULL). Both reuse the status;
	// the extra outgoing edges below serve the takeover lifecycle —
	// working (handback), completed/failed (finalize while held), cancelled.
	NodeRunStatusBlocked:   {NodeRunStatusFormatOk, NodeRunStatusSkipped, NodeRunStatusWorking, NodeRunStatusCompleted, NodeRunStatusFailed, NodeRunStatusCancelled},
	NodeRunStatusSkipped:   {},
	NodeRunStatusCancelled: {},
}

// isValidTransition checks whether a status transition is allowed.
func isValidTransition(from, to string) bool {
	allowed, ok := validTransitions[from]
	if !ok {
		return false
	}
	for _, a := range allowed {
		if a == to {
			return true
		}
	}
	return false
}

// isTerminal reports whether the status represents a terminal (non-active) state.
func isTerminalNodeRunStatus(s string) bool {
	switch s {
	case NodeRunStatusCompleted, NodeRunStatusFailed, NodeRunStatusSkipped,
		NodeRunStatusFormatFailed, NodeRunStatusCancelled:
		return true
	}
	return false
}

func isSatisfiedDependencyNodeRunStatus(s string) bool {
	return s == NodeRunStatusCompleted || s == NodeRunStatusSkipped
}

type workflowNodeFormat struct {
	Type        string `json:"type"`
	GatewayKind string `json:"gateway_kind"`
}

func classifyWorkflowGatewayFormat(raw json.RawMessage) (workflowNodeFormat, bool, bool) {
	if len(raw) == 0 {
		return workflowNodeFormat{}, false, false
	}
	var format workflowNodeFormat
	if err := json.Unmarshal(raw, &format); err != nil {
		return workflowNodeFormat{}, false, false
	}
	if format.Type != "gateway" {
		return workflowNodeFormat{}, false, false
	}
	if format.GatewayKind != "fork" && format.GatewayKind != "join" {
		return format, true, false
	}
	return format, true, true
}

func parseWorkflowNodeFormat(raw json.RawMessage) (workflowNodeFormat, bool) {
	format, isGateway, valid := classifyWorkflowGatewayFormat(raw)
	return format, isGateway && valid
}

func isInvalidWorkflowGatewayFormat(raw json.RawMessage) bool {
	_, isGateway, valid := classifyWorkflowGatewayFormat(raw)
	return isGateway && !valid
}

func buildExecutableWorkflowGraph(
	nodes []db.MulticaWorkflowNode,
	edges []db.MulticaWorkflowEdge,
) ([]db.MulticaWorkflowNode, []db.MulticaWorkflowEdge) {
	ids := make(map[string]struct{}, len(nodes))
	keptNodes := make([]db.MulticaWorkflowNode, 0, len(nodes))
	for _, node := range nodes {
		if workflowmeta.IsBoundary(node.FormatSchema) {
			continue
		}
		ids[util.UUIDToString(node.ID)] = struct{}{}
		keptNodes = append(keptNodes, node)
	}

	keptEdges := make([]db.MulticaWorkflowEdge, 0, len(edges))
	for _, edge := range edges {
		_, sourceOK := ids[util.UUIDToString(edge.SourceNodeID)]
		_, targetOK := ids[util.UUIDToString(edge.TargetNodeID)]
		if sourceOK && targetOK {
			keptEdges = append(keptEdges, edge)
		}
	}
	return keptNodes, keptEdges
}

// ── DAG validation ───────────────────────────────────────────────────────────

// ValidateDAG checks the workflow for cycles via DFS topological sort.
// O(V+E) complexity.
func (s *WorkflowService) ValidateDAG(ctx context.Context, workflowID pgtype.UUID) error {
	nodes, err := s.Queries.ListWorkflowNodes(ctx, workflowID)
	if err != nil {
		return fmt.Errorf("list nodes: %w", err)
	}
	edges, err := s.Queries.ListWorkflowEdges(ctx, workflowID)
	if err != nil {
		return fmt.Errorf("list edges: %w", err)
	}

	nodeIDs := make(map[string]bool)
	for _, n := range nodes {
		nodeIDs[util.UUIDToString(n.ID)] = true
	}

	// Build adjacency list.
	adj := make(map[string][]string)
	inDegree := make(map[string]int)
	for _, n := range nodes {
		nid := util.UUIDToString(n.ID)
		adj[nid] = nil
		inDegree[nid] = 0
	}
	for _, e := range edges {
		src := util.UUIDToString(e.SourceNodeID)
		dst := util.UUIDToString(e.TargetNodeID)
		adj[src] = append(adj[src], dst)
		inDegree[dst]++
	}

	// DFS-based cycle detection with three colors.
	const (
		white = 0
		gray  = 1
		black = 2
	)
	color := make(map[string]int)
	var dfs func(string) error
	dfs = func(u string) error {
		color[u] = gray
		for _, v := range adj[u] {
			switch color[v] {
			case gray:
				return fmt.Errorf("cycle detected: node %s reaches %s", u, v)
			case white:
				if err := dfs(v); err != nil {
					return err
				}
			}
		}
		color[u] = black
		return nil
	}

	for _, n := range nodes {
		nid := util.UUIDToString(n.ID)
		if color[nid] == white {
			if err := dfs(nid); err != nil {
				return err
			}
		}
	}

	return nil
}

// ── Run lifecycle ────────────────────────────────────────────────────────────

type workflowRunRuntimeContext struct {
	SourceIssueID       pgtype.UUID
	ResponsibleUserID   pgtype.UUID
	RuntimeAuthorizerID pgtype.UUID
}

func (s *WorkflowService) resolveWorkflowUser(
	ctx context.Context,
	actorType string,
	actorID pgtype.UUID,
) pgtype.UUID {
	if !actorID.Valid {
		return pgtype.UUID{}
	}
	switch actorType {
	case "member":
		return actorID
	case "agent":
		agent, err := s.Queries.GetAgent(ctx, actorID)
		if err == nil && agent.OwnerID.Valid {
			return agent.OwnerID
		}
	}
	return pgtype.UUID{}
}

func (s *WorkflowService) issueResponsibleUser(ctx context.Context, issue db.MulticaIssue) pgtype.UUID {
	return issue.ResponsibleUserID
}

// StartRun creates a workflow_run and node_runs for every node, then
// kicks off root nodes (nodes with no incoming edges).
func (s *WorkflowService) StartRun(ctx context.Context, workflow db.MulticaWorkflow, triggeredByType, triggeredByID string, input json.RawMessage, runtimeID pgtype.UUID) (*db.MulticaWorkflowRun, error) {
	return s.StartRunWithRuntimeSelection(ctx, workflow, triggeredByType, triggeredByID, input, "", runtimeID)
}

func (s *WorkflowService) StartRunWithRuntimeSelection(ctx context.Context, workflow db.MulticaWorkflow, triggeredByType, triggeredByID string, input json.RawMessage, runtimeSelectionPolicy string, runtimeID pgtype.UUID) (*db.MulticaWorkflowRun, error) {
	triggeredByUUID, err := util.ParseUUID(triggeredByID)
	if err != nil && triggeredByID != "" {
		triggeredByUUID = pgtype.UUID{}
	}
	return s.startRun(ctx, workflow, triggeredByType, triggeredByID, input, runtimeSelectionPolicy, runtimeID, "", workflowRunRuntimeContext{
		RuntimeAuthorizerID: s.resolveWorkflowUser(ctx, triggeredByType, triggeredByUUID),
	})
}

func (s *WorkflowService) startRun(ctx context.Context, workflow db.MulticaWorkflow, triggeredByType, triggeredByID string, input json.RawMessage, runtimeSelectionPolicy string, runtimeID pgtype.UUID, dispatchKey string, runtimeContext workflowRunRuntimeContext) (*db.MulticaWorkflowRun, error) {
	if workflow.IsTemplate {
		return nil, errors.New("workflow template cannot be run")
	}
	triggeredByUUID, err := util.ParseUUID(triggeredByID)
	if err != nil && triggeredByID != "" {
		triggeredByUUID = pgtype.UUID{}
	}
	prepared, err := s.PrepareWorkflowRunSnapshot(ctx, workflow.ID, PrepareWorkflowRunParams{
		TriggeredByType: triggeredByType, TriggeredByID: triggeredByUUID, Input: input,
		RuntimeSelectionPolicy: runtimeSelectionPolicy, RuntimeID: runtimeID, DispatchKey: dispatchKey,
		SourceIssueID: runtimeContext.SourceIssueID, ResponsibleUserID: runtimeContext.ResponsibleUserID,
		RuntimeAuthorizerID: runtimeContext.RuntimeAuthorizerID,
	})
	if err != nil {
		return nil, err
	}
	return &prepared.Run, nil
}

// DispatchRootNodeRuns kicks off root node runs after the run is created.
// format_checking -> format_ok -> dispatchWorker.
// Must be called after sub-issues exist so DispatchAgentTask can link issue_id.
func (s *WorkflowService) DispatchRootNodeRuns(ctx context.Context, runID pgtype.UUID) error {
	nodeRuns, err := s.Queries.ListWorkflowNodeRunsByRun(ctx, runID)
	if err != nil {
		return fmt.Errorf("list root node runs: %w", err)
	}
	for _, nr := range nodeRuns {
		if nr.Status == NodeRunStatusFormatChecking {
			handled, err := s.completeGatewayNodeRun(ctx, nr)
			if err != nil {
				return fmt.Errorf("complete root gateway node %s: %w", util.UUIDToString(nr.ID), err)
			}
			if handled {
				continue
			}
			if _, err := s.TransitionNodeRun(ctx, nr, NodeRunStatusFormatOk); err != nil {
				return fmt.Errorf("transition root node %s to format_ok: %w", util.UUIDToString(nr.ID), err)
			}
		}
	}
	nodeRuns, err = s.Queries.ListWorkflowNodeRunsByRun(ctx, runID)
	if err != nil {
		return fmt.Errorf("reload root node runs: %w", err)
	}
	for _, nr := range nodeRuns {
		if nr.Status == NodeRunStatusFormatOk {
			if err := s.dispatchWorker(ctx, nr); err != nil {
				return fmt.Errorf("dispatch root worker %s: %w", util.UUIDToString(nr.ID), err)
			}
		}
	}
	s.checkRunCompletion(ctx, runID)
	return nil
}

// StartRunForIssue creates a workflow run from an issue assignment and returns
// all created node runs so the caller can create corresponding sub-issues.
func (s *WorkflowService) StartRunForIssue(
	ctx context.Context,
	workflow db.MulticaWorkflow,
	issue db.MulticaIssue,
	triggeredByType string,
	triggeredByID string,
	runtimeID pgtype.UUID,
) (*db.MulticaWorkflowRun, []db.MulticaWorkflowNodeRun, error) {
	return s.StartRunForIssueWithRuntimeSelection(ctx, workflow, issue, triggeredByType, triggeredByID, "", runtimeID)
}

func (s *WorkflowService) StartRunForIssueWithRuntimeSelection(
	ctx context.Context,
	workflow db.MulticaWorkflow,
	issue db.MulticaIssue,
	triggeredByType string,
	triggeredByID string,
	runtimeSelectionPolicy string,
	runtimeID pgtype.UUID,
) (*db.MulticaWorkflowRun, []db.MulticaWorkflowNodeRun, error) {
	input, err := json.Marshal(map[string]any{
		"issue_id":    util.UUIDToString(issue.ID),
		"title":       issue.Title,
		"description": textToString(issue.Description),
	})
	if err != nil {
		return nil, nil, fmt.Errorf("marshal issue input: %w", err)
	}

	triggeredByUUID, parseErr := util.ParseUUID(triggeredByID)
	if parseErr != nil && triggeredByID != "" {
		triggeredByUUID = pgtype.UUID{}
	}
	run, err := s.startRun(ctx, workflow, triggeredByType, triggeredByID, input, runtimeSelectionPolicy, runtimeID, "", workflowRunRuntimeContext{
		SourceIssueID:       issue.ID,
		ResponsibleUserID:   s.issueResponsibleUser(ctx, issue),
		RuntimeAuthorizerID: s.resolveWorkflowUser(ctx, triggeredByType, triggeredByUUID),
	})
	if err != nil {
		return nil, nil, err
	}

	nodeRuns, err := s.Queries.ListWorkflowNodeRunsByRun(ctx, run.ID)
	if err != nil {
		return nil, nil, fmt.Errorf("list node runs: %w", err)
	}

	// Scaffold deliverable git storage for this run, mirroring the workflow-run
	// path (handler/workflow_run.go). Fire-and-forget: ScaffoldRunDeliverables
	// runs detached, panic-recovered, and no-ops when Gitea is unconfigured.
	if run != nil {
		go s.ScaffoldRunDeliverables(context.Background(), *run)
	}

	return run, nodeRuns, nil
}

// EnsureDefaultWorkflow get-or-creates the workspace's system default workflow —
// the hidden, single-node, one-document-deliverable archive sink for issues
// assigned to agent/member/squad that have no bound workflow. Idempotent: the
// uniq_workflow_default_per_workspace index guarantees at most one per workspace,
// so concurrent callers (CreateIssue + UpdateIssue) race without harm — a Create
// that loses the race re-reads the winner.
func (s *WorkflowService) EnsureDefaultWorkflow(ctx context.Context, workspaceID pgtype.UUID) (db.MulticaWorkflow, error) {
	if wf, err := s.Queries.GetDefaultWorkflow(ctx, workspaceID); err == nil {
		return wf, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return db.MulticaWorkflow{}, fmt.Errorf("get default workflow: %w", err)
	}
	wf, err := s.Queries.CreateDefaultWorkflow(ctx, db.CreateDefaultWorkflowParams{
		WorkspaceID: workspaceID,
		Title:       "Default Archive Workflow",
	})
	if err != nil {
		// Race: another caller created it between our Get and Create. Re-read.
		if wf2, err2 := s.Queries.GetDefaultWorkflow(ctx, workspaceID); err2 == nil {
			return wf2, nil
		}
		return db.MulticaWorkflow{}, fmt.Errorf("create default workflow: %w", err)
	}
	node, err := s.Queries.CreateWorkflowNode(ctx, db.CreateWorkflowNodeParams{
		WorkflowID:  wf.ID,
		Title:       "Deliverable",
		Description: pgtype.Text{String: "", Valid: true}, // NOT NULL DEFAULT ''
		WorkerType:  "agent",
		CriticType:  "human",
		PositionX:   0,
		PositionY:   0,
		SortOrder:   0,
	})
	if err != nil {
		return db.MulticaWorkflow{}, fmt.Errorf("create default node: %w", err)
	}
	if _, err := s.Queries.CreateWorkflowNodeDeliverable(ctx, db.CreateWorkflowNodeDeliverableParams{
		WorkflowNodeID: node.ID,
		Title:          "Deliverable",
		Description:    "",
		Required:       true,
		SortOrder:      0,
	}); err != nil {
		return db.MulticaWorkflow{}, fmt.Errorf("create default deliverable: %w", err)
	}
	return wf, nil
}

// StartDefaultRunForIssue starts a run of the workspace's default workflow for
// an agent/member/squad-assigned issue that has no bound workflow, so the issue
// gets a Gitea deliverable home: one inst branch in the default repo, with the
// full scaffold → submit → review → merge path reusable unchanged. The single
// node-run's worker is set to the issue's assignee and critic to the issue's
// creator, then the root node-run is dispatched (agent/squad → agent task;
// member → human worker, awaits UI upload in M2). Gitea scaffolding fires
// async (dormant no-op when unconfigured). Returns the run + the single node-run.
//
// The caller (CreateIssue/UpdateIssue) MUST gate on Gitea configured — this
// method always builds the run + node-run regardless, so calling it with Gitea
// unconfigured would create a run whose inst branch never gets scaffolded.
func (s *WorkflowService) StartDefaultRunForIssue(ctx context.Context, issue db.MulticaIssue) (*db.MulticaWorkflowRun, db.MulticaWorkflowNodeRun, error) {
	wf, err := s.EnsureDefaultWorkflow(ctx, issue.WorkspaceID)
	if err != nil {
		return nil, db.MulticaWorkflowNodeRun{}, err
	}
	input, err := json.Marshal(map[string]any{
		"title":       issue.Title,
		"description": textToString(issue.Description),
	})
	if err != nil {
		return nil, db.MulticaWorkflowNodeRun{}, fmt.Errorf("marshal issue input: %w", err)
	}
	prepared, err := s.PrepareWorkflowRunSnapshot(ctx, wf.ID, PrepareWorkflowRunParams{
		TriggeredByType: issue.CreatorType, TriggeredByID: issue.CreatorID, Input: input,
		SourceIssueID: issue.ID, ResponsibleUserID: s.issueResponsibleUser(ctx, issue),
		RuntimeAuthorizerID: s.issueResponsibleUser(ctx, issue),
		defaultWorkerType:   defaultRunWorkerType(issue), defaultWorkerID: issue.AssigneeID,
		defaultCriticType: defaultRunCriticType(issue), defaultCriticID: issue.AssigneeID,
	})
	if err != nil {
		return nil, db.MulticaWorkflowNodeRun{}, fmt.Errorf("start default run: %w", err)
	}
	run := &prepared.Run
	nodeRuns := prepared.NodeRuns
	if len(nodeRuns) == 0 {
		return nil, db.MulticaWorkflowNodeRun{}, fmt.Errorf("default workflow %s has no node", util.UUIDToString(wf.ID))
	}
	nr := nodeRuns[0]

	// Scaffold Gitea for the run (dormant no-op when unconfigured).
	go s.ScaffoldRunDeliverables(context.Background(), *run)

	return run, nr, nil
}

// defaultRunWorkerType maps an issue's assignee to a node-run worker type. The
// node-run worker type drives dispatchWorker's switch (human/agent/squad/role),
// so a member assignee — who produces via UI upload — maps to "human".
// issue.AssigneeType is already constrained to member/agent/squad at the API.
func defaultRunWorkerType(issue db.MulticaIssue) string {
	if issue.AssigneeType.Valid && issue.AssigneeType.String == "member" {
		return "human"
	}
	return issue.AssigneeType.String // "agent" | "squad"
}

// defaultRunCriticType maps an issue's assignee to a node-run critic type. The
// critic type drives dispatchCritic's switch (human/agent/squad/api/role), so a
// member assignee — who reviews via the multica UI — maps to "human".
func defaultRunCriticType(issue db.MulticaIssue) string {
	if issue.AssigneeType.Valid && issue.AssigneeType.String == "member" {
		return "human"
	}
	return issue.AssigneeType.String // "agent" | "squad"
}
func (s *WorkflowService) StartRunForIssueWithDispatchKey(
	ctx context.Context,
	workflow db.MulticaWorkflow,
	issue db.MulticaIssue,
	triggeredByType string,
	triggeredByID string,
	runtimeID pgtype.UUID,
	dispatchKey string,
) (*db.MulticaWorkflowRun, []db.MulticaWorkflowNodeRun, error) {
	input, err := json.Marshal(map[string]any{
		"issue_id":    util.UUIDToString(issue.ID),
		"title":       issue.Title,
		"description": textToString(issue.Description),
	})
	if err != nil {
		return nil, nil, fmt.Errorf("marshal issue input: %w", err)
	}
	triggeredByUUID, parseErr := util.ParseUUID(triggeredByID)
	if parseErr != nil && triggeredByID != "" {
		triggeredByUUID = pgtype.UUID{}
	}
	run, err := s.startRun(ctx, workflow, triggeredByType, triggeredByID, input, "", runtimeID, dispatchKey, workflowRunRuntimeContext{
		SourceIssueID:       issue.ID,
		ResponsibleUserID:   s.issueResponsibleUser(ctx, issue),
		RuntimeAuthorizerID: s.resolveWorkflowUser(ctx, triggeredByType, triggeredByUUID),
	})
	if err != nil {
		return nil, nil, err
	}
	nodeRuns, err := s.Queries.ListWorkflowNodeRunsByRun(ctx, run.ID)
	if err != nil {
		return nil, nil, fmt.Errorf("list node runs: %w", err)
	}
	return run, nodeRuns, nil
}

func textToString(t pgtype.Text) string {
	if t.Valid {
		return t.String
	}
	return ""
}

func textToPgText(s string) pgtype.Text {
	return pgtype.Text{String: s, Valid: true}
}

// CancelRun cancels all active node_runs and marks the run as cancelled.
func (s *WorkflowService) CancelRun(ctx context.Context, runID pgtype.UUID) error {
	cancelledNodeRuns := make([]db.MulticaWorkflowNodeRun, 0)
	var cancelledRun db.MulticaWorkflowRun
	if err := s.runInTx(ctx, func(qtx *db.Queries) error {
		run, err := qtx.GetWorkflowRun(ctx, runID)
		if err != nil {
			return fmt.Errorf("get workflow run: %w", err)
		}
		cancelledRun = run

		nodeRuns, err := qtx.ListWorkflowNodeRunsByRun(ctx, runID)
		if err != nil {
			return fmt.Errorf("list node runs: %w", err)
		}
		for _, nr := range nodeRuns {
			if !isTerminalNodeRunStatus(nr.Status) {
				updated, err := qtx.UpdateWorkflowNodeRunStatus(ctx, db.UpdateWorkflowNodeRunStatusParams{
					ID:     nr.ID,
					Status: NodeRunStatusCancelled,
				})
				if err != nil {
					return fmt.Errorf("cancel node run: %w", err)
				}
				cancelledNodeRuns = append(cancelledNodeRuns, updated)
			}
			// Cancel any active agent tasks for this node run's sub-issue.
			// The sub-issue STATUS is not updated here: the
			// OnNodeStatusChanged callback (handler.syncSubIssueForNodeRun)
			// syncs it after commit and broadcasts issue:updated — writing
			// the status inside this tx would preempt that path and silence
			// inbox notifications, activity log, and frontend refresh.
			subIssue, err := qtx.GetIssueByOrigin(ctx, db.GetIssueByOriginParams{
				WorkspaceID: run.WorkspaceID,
				OriginType:  pgtype.Text{String: "workflow", Valid: true},
				OriginID:    nr.ID,
			})
			if err != nil {
				continue // sub-issue may not exist yet; not an error
			}
			if _, err := qtx.CancelAgentTasksByIssue(ctx, subIssue.ID); err != nil {
				slog.Warn("failed to cancel agent tasks for sub-issue", "issue_id", util.UUIDToString(subIssue.ID), "error", err)
			}
		}
		if err := qtx.CancelWorkflowRoleResolutionJobs(ctx, runID); err != nil {
			return fmt.Errorf("cancel role resolution jobs: %w", err)
		}
		_, err = qtx.UpdateWorkflowRunStatus(ctx, db.UpdateWorkflowRunStatusParams{
			ID:     runID,
			Status: RunStatusCancelled,
		})
		return err
	}); err != nil {
		return err
	}

	for _, nodeRun := range cancelledNodeRuns {
		if s.OnNodeStatusChanged != nil {
			s.OnNodeStatusChanged(ctx, nodeRun)
		}
	}
	if s.OnRunTerminal != nil {
		cancelledRun.Status = RunStatusCancelled
		s.OnRunTerminal(ctx, cancelledRun, RunStatusCancelled)
	}
	return nil
}

// ── State machine ────────────────────────────────────────────────────────────

// TransitionNodeRun validates the transition and updates the node run status.
func (s *WorkflowService) TransitionNodeRun(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, newStatus string) (*db.MulticaWorkflowNodeRun, error) {
	if !isValidTransition(nodeRun.Status, newStatus) {
		return nil, fmt.Errorf("invalid transition: %s → %s", nodeRun.Status, newStatus)
	}
	if newStatus == NodeRunStatusFailed || newStatus == NodeRunStatusFormatFailed {
		reason := "node_failed"
		if newStatus == NodeRunStatusFormatFailed {
			reason = "format_validation_failed"
		}
		if err := s.failWorkflowFromNode(ctx, nodeRun, newStatus, reason); err != nil {
			return nil, err
		}
		updated, err := s.Queries.GetWorkflowNodeRun(ctx, nodeRun.ID)
		if err != nil {
			return nil, fmt.Errorf("get failed node run: %w", err)
		}
		return &updated, nil
	}

	updated, err := s.Queries.UpdateWorkflowNodeRunStatus(ctx, db.UpdateWorkflowNodeRunStatusParams{
		ID:     nodeRun.ID,
		Status: newStatus,
	})
	if err != nil {
		return nil, fmt.Errorf("update node run status: %w", err)
	}

	if s.OnNodeStatusChanged != nil {
		s.OnNodeStatusChanged(ctx, updated)
	}
	if isTerminalNodeRunStatus(newStatus) && newStatus != NodeRunStatusCompleted {
		s.checkRunCompletion(ctx, updated.WorkflowRunID)
	}

	return &updated, nil
}

func (s *WorkflowService) completeGatewayNodeRun(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) (bool, error) {
	if isInvalidWorkflowGatewayFormat(nodeRun.FormatSchema) {
		if _, err := s.TransitionNodeRun(ctx, nodeRun, NodeRunStatusFormatFailed); err != nil {
			return true, err
		}
		return true, nil
	}
	if _, ok := parseWorkflowNodeFormat(nodeRun.FormatSchema); !ok {
		return false, nil
	}

	updated, err := s.TransitionNodeRun(ctx, nodeRun, NodeRunStatusCompleted)
	if err != nil {
		return true, err
	}
	if err := s.OnNodeRunCompleted(ctx, updated.ID); err != nil {
		return true, fmt.Errorf("propagate gateway completion: %w", err)
	}
	return true, nil
}

// syncNodeRunSessionFromTask backfills a node run's session_id/runtime_id from
// its worker agent task when the daemon's asynchronous BindNodeRunSession has
// not landed yet. This prevents "node run has no active session" in Cloud Web
// when a human takes over shortly after the agent reveals its CSC session.
func (s *WorkflowService) syncNodeRunSessionFromTask(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) error {
	if nodeRun.SessionID.Valid {
		return nil
	}
	if !nodeRun.WorkerAgentTaskID.Valid {
		return nil
	}
	task, err := s.Queries.GetAgentTask(ctx, nodeRun.WorkerAgentTaskID)
	if err != nil {
		return fmt.Errorf("get worker task: %w", err)
	}
	if !task.SessionID.Valid {
		return nil
	}
	params := db.BindWorkflowNodeRunSessionParams{ID: nodeRun.ID}
	params.SessionID = task.SessionID
	if task.RuntimeID.Valid {
		params.RuntimeID = task.RuntimeID
	} else if nodeRun.RuntimeID.Valid {
		params.RuntimeID = nodeRun.RuntimeID
	}
	if nodeRun.DeviceID.Valid {
		params.DeviceID = nodeRun.DeviceID
	}
	if _, err := s.Queries.BindWorkflowNodeRunSession(ctx, params); err != nil {
		return fmt.Errorf("bind node-run session: %w", err)
	}
	return nil
}

// ── Human takeover / handback (Design Two) ───────────────────────────────────

// TakeoverNodeRun pauses an actively-running node so a human can intervene in
// its CSC session (working → blocked). It deliberately does NOT mark the node
// completed: the dedicated query leaves completed_at NULL, which is what tells
// a paused/taken-over blocked apart from a rework-exhausted "stuck" blocked
// (the latter sets completed_at via UpdateWorkflowNodeRunStatus). Because
// blocked is non-terminal, the run stays active while the human holds control.
func (s *WorkflowService) TakeoverNodeRun(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) (*db.MulticaWorkflowNodeRun, error) {
	if !isValidTransition(nodeRun.Status, NodeRunStatusBlocked) {
		return nil, fmt.Errorf("invalid transition: %s → %s", nodeRun.Status, NodeRunStatusBlocked)
	}
	// The daemon writes the CSC session binding asynchronously. If a human
	// takes over before that write lands, the node run appears to have no
	// session. Sync from the worker task so Cloud Web can attach immediately.
	if err := s.syncNodeRunSessionFromTask(ctx, nodeRun); err != nil {
		return nil, fmt.Errorf("sync node-run session: %w", err)
	}
	updated, err := s.Queries.TakeoverWorkflowNodeRun(ctx, nodeRun.ID)
	if err != nil {
		return nil, fmt.Errorf("takeover node run: %w", err)
	}
	if s.OnNodeStatusChanged != nil {
		s.OnNodeStatusChanged(ctx, updated)
	}
	return &updated, nil
}

// HandbackNodeRun returns control to the agent (blocked → working) and
// re-dispatches the worker so the daemon resumes the SAME CSC session the human
// just drove via Cloud (Design Two). worker_output is preserved (unlike rework).
// The dispatched task carries the node_run_id; the daemon claim handler resolves
// the resume session from the node-run's bound session_id. Human-worker nodes
// have no agent session to resume and are left at working with no dispatch.
func (s *WorkflowService) HandbackNodeRun(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) (*db.MulticaWorkflowNodeRun, error) {
	if nodeRun.Status != NodeRunStatusBlocked {
		return nil, fmt.Errorf("node run is not blocked (status=%s)", nodeRun.Status)
	}
	// Ensure the node run carries the CSC session binding before handing back.
	// The daemon claim handler resolves the resume session from this row, so a
	// missing session_id would force a fresh session instead of continuing the
	// conversation the human just steered.
	if err := s.syncNodeRunSessionFromTask(ctx, nodeRun); err != nil {
		return nil, fmt.Errorf("sync node-run session: %w", err)
	}
	var updated db.MulticaWorkflowNodeRun
	err := s.runInTx(ctx, func(qtx *db.Queries) error {
		fresh, err := qtx.GetWorkflowNodeRunForUpdate(ctx, nodeRun.ID)
		if err != nil {
			return err
		}
		if fresh.Status != NodeRunStatusBlocked {
			return fmt.Errorf("node run is not blocked (status=%s)", fresh.Status)
		}
		updated, err = qtx.HandbackWorkflowNodeRun(ctx, fresh.ID)
		if err != nil {
			return fmt.Errorf("handback node run: %w", err)
		}
		generation, err := NextWorkflowDispatchGeneration(ctx, qtx, fresh.ID, "recovery")
		if err != nil {
			return err
		}
		return EnqueueWorkflowDispatch(ctx, qtx, fresh.ID, "recovery", generation)
	})
	if err != nil {
		return nil, err
	}
	if s.OnNodeStatusChanged != nil {
		s.OnNodeStatusChanged(ctx, updated)
	}
	return &updated, nil
}

// FinalizeNodeRun lets a human conclude a taken-over node directly
// (blocked → completed / failed) instead of handing it back, then propagates
// downstream exactly like the normal completion path.
func (s *WorkflowService) FinalizeNodeRun(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, outcome string) (*db.MulticaWorkflowNodeRun, error) {
	if outcome != NodeRunStatusCompleted && outcome != NodeRunStatusFailed {
		return nil, fmt.Errorf("invalid finalize outcome: %s", outcome)
	}
	if outcome == NodeRunStatusFailed {
		if !isValidTransition(nodeRun.Status, outcome) {
			return nil, fmt.Errorf("invalid transition: %s → %s", nodeRun.Status, outcome)
		}
		if err := s.failWorkflowFromNode(ctx, nodeRun, NodeRunStatusFailed, "human_finalized_failed"); err != nil {
			return nil, err
		}
		updated, err := s.Queries.GetWorkflowNodeRun(ctx, nodeRun.ID)
		if err != nil {
			return nil, fmt.Errorf("get finalized node run: %w", err)
		}
		return &updated, nil
	}
	updated, err := s.TransitionNodeRun(ctx, nodeRun, outcome)
	if err != nil {
		return nil, err
	}
	if err := s.OnNodeRunCompleted(ctx, nodeRun.ID); err != nil {
		return nil, fmt.Errorf("propagate node completion: %w", err)
	}
	return updated, nil
}

// RetryNodeRun reactivates a stuck node run and dispatches its worker again.
// This is scoped to the workflow node run, so it does not depend on the parent
// issue being assigned to an agent or squad.
//
// A node failure fails the whole run (fail-fast) and cascade-cancels every
// non-terminal sibling, so retrying a node of a failed run must also revive
// the run and the cancelled siblings — otherwise the fresh dispatch is
// rejected by the run-not-running guard and the run can never make progress
// again.
func (s *WorkflowService) RetryNodeRun(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) (*db.MulticaWorkflowNodeRun, error) {
	var updated db.MulticaWorkflowNodeRun
	var revived []db.MulticaWorkflowNodeRun
	err := s.runInTx(ctx, func(qtx *db.Queries) error {
		fresh, err := qtx.GetWorkflowNodeRunForUpdate(ctx, nodeRun.ID)
		if err != nil {
			return err
		}
		switch fresh.Status {
		case NodeRunStatusFailed, NodeRunStatusBlocked, NodeRunStatusFormatFailed, NodeRunStatusCriticRework:
		default:
			return fmt.Errorf("node run cannot be retried from status %s", fresh.Status)
		}
		run, err := qtx.GetWorkflowRun(ctx, fresh.WorkflowRunID)
		if err != nil {
			return fmt.Errorf("get workflow run: %w", err)
		}
		if run.Status == RunStatusFailed {
			if _, err := qtx.ReviveWorkflowRunForRetry(ctx, run.ID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("revive workflow run: %w", err)
			}
			// Non-terminal dispatch jobs left over from before the failure are
			// stale: their node runs are being reset, so they must not fire
			// again and re-fail the run.
			if err := qtx.FailStaleWorkflowDispatchJobs(ctx, run.ID); err != nil {
				return fmt.Errorf("fail stale dispatch jobs: %w", err)
			}
			revived, err = qtx.ReviveCancelledWorkflowNodeRuns(ctx, run.ID)
			if err != nil {
				return fmt.Errorf("revive cancelled node runs: %w", err)
			}
		}
		updated, err = qtx.UpdateWorkflowNodeRunRework(ctx, db.UpdateWorkflowNodeRunReworkParams{
			ID: fresh.ID, Status: NodeRunStatusFormatOk,
		})
		if err != nil {
			return fmt.Errorf("retry node run: %w", err)
		}
		generation, err := NextWorkflowDispatchGeneration(ctx, qtx, fresh.ID, "worker")
		if err != nil {
			return err
		}
		if err := EnqueueWorkflowDispatch(ctx, qtx, fresh.ID, "worker", generation); err != nil {
			return err
		}
		// Revived siblings whose upstreams already completed (parallel
		// branches) would never see another completion event, so activate
		// them now; the rest wait for the normal propagation.
		for i := range revived {
			if err := activateNodeRunIfReady(ctx, qtx, revived[i].ID); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if s.OnNodeStatusChanged != nil {
		s.OnNodeStatusChanged(ctx, updated)
		for i := range revived {
			current, err := s.Queries.GetWorkflowNodeRun(ctx, revived[i].ID)
			if err != nil {
				continue
			}
			s.OnNodeStatusChanged(ctx, current)
		}
	}
	return &updated, nil
}

// OnNodeRunCompleted checks downstream nodes after a node run completes or is
// intentionally skipped. If all required upstreams reached one of those
// dependency-satisfying states, it advances the downstream node to
// format_checking.
func (s *WorkflowService) OnNodeRunCompleted(ctx context.Context, nodeRunID pgtype.UUID) error {
	nodeRun, err := s.Queries.GetWorkflowNodeRun(ctx, nodeRunID)
	if err != nil {
		return fmt.Errorf("get node run: %w", err)
	}
	if nodeRun.Status != NodeRunStatusCompleted && nodeRun.Status != NodeRunStatusSkipped {
		return nil
	}

	run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		return fmt.Errorf("get run: %w", err)
	}
	if run.Status != RunStatusRunning {
		return nil
	}

	if err := s.runInTx(ctx, func(qtx *db.Queries) error {
		return ActivateDownstreamAndEnqueue(ctx, qtx, nodeRun.ID)
	}); err != nil {
		return err
	}

	// Check run completion.
	s.checkRunCompletion(ctx, nodeRun.WorkflowRunID)

	return nil
}

// checkRunCompletion evaluates whether all node runs are terminal and marks
// the run as completed or failed accordingly.
func (s *WorkflowService) checkRunCompletion(ctx context.Context, runID pgtype.UUID) {
	nodeRuns, err := s.Queries.ListWorkflowNodeRunsByRun(ctx, runID)
	if err != nil {
		return
	}

	hasActive := false
	hasFailed := false
	for _, nr := range nodeRuns {
		if !isTerminalNodeRunStatus(nr.Status) {
			hasActive = true
			break
		}
		if nr.Status == NodeRunStatusFailed || nr.Status == NodeRunStatusFormatFailed {
			hasFailed = true
		}
	}
	if hasActive {
		return
	}

	status := RunStatusCompleted
	if hasFailed {
		status = RunStatusFailed
	}
	s.Queries.UpdateWorkflowRunStatus(ctx, db.UpdateWorkflowRunStatusParams{
		ID:     runID,
		Status: status,
	})

	run, err := s.Queries.GetWorkflowRun(ctx, runID)
	if err != nil {
		return
	}
	if status == RunStatusFailed {
		s.publishWorkflowEvent(EventWorkflowRunFailed, util.UUIDToString(run.WorkspaceID), map[string]any{
			"run_id":      util.UUIDToString(runID),
			"workflow_id": util.UUIDToString(run.WorkflowID),
		})
	} else {
		s.publishWorkflowEvent(EventWorkflowRunCompleted, util.UUIDToString(run.WorkspaceID), map[string]any{
			"run_id":      util.UUIDToString(runID),
			"workflow_id": util.UUIDToString(run.WorkflowID),
		})
	}

	if s.OnRunTerminal != nil {
		s.OnRunTerminal(ctx, run, status)
	}
}

// ── Worker-Critic loop ───────────────────────────────────────────────────────

// SubmitWorkerOutput handles human/agent submitting the worker phase output.
func (s *WorkflowService) SubmitWorkerOutput(ctx context.Context, nodeRunID pgtype.UUID, output json.RawMessage) error {
	var nodeRun db.MulticaWorkflowNodeRun
	if err := s.runInTx(ctx, func(qtx *db.Queries) error {
		nr, err := qtx.GetWorkflowNodeRun(ctx, nodeRunID)
		if err != nil {
			return fmt.Errorf("get node run: %w", err)
		}
		if nr.Status != NodeRunStatusWorking && nr.Status != NodeRunStatusWorkerAssigned {
			return fmt.Errorf("node run is not in worker phase (status=%s)", nr.Status)
		}
		if err := autoSubmitSingleRequiredDeliverable(ctx, qtx, nr, output); err != nil {
			return fmt.Errorf("auto-submit required deliverable: %w", err)
		}
		if satisfied, err := requiredDeliverablesSatisfiedWithQueries(ctx, qtx, nr); err != nil {
			return fmt.Errorf("check deliverables: %w", err)
		} else if !satisfied {
			return fmt.Errorf("all required deliverables must be submitted before this node can enter review")
		}

		updated, err := qtx.SetWorkflowNodeRunWorkerOutput(ctx, db.SetWorkflowNodeRunWorkerOutputParams{
			ID:           nr.ID,
			WorkerOutput: output,
			Status:       NodeRunStatusAwaitingCritic,
		})
		if err != nil {
			return fmt.Errorf("set worker output: %w", err)
		}
		nodeRun = updated
		generation, err := NextWorkflowDispatchGeneration(ctx, qtx, nr.ID, "critic")
		if err != nil {
			return err
		}
		return EnqueueWorkflowDispatch(ctx, qtx, nr.ID, "critic", generation)
	}); err != nil {
		return err
	}

	// Code MR links carried in the worker output are filed as submissions by
	// autoSubmitSingleRequiredDeliverable; they are archived to the inst branch
	// only on approval (archiveCodeLinksToInst), not here.

	if s.OnNodeStatusChanged != nil {
		s.OnNodeStatusChanged(ctx, nodeRun)
	}
	return nil
}

func (s *WorkflowService) requiredDeliverablesSatisfied(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) (bool, error) {
	return requiredDeliverablesSatisfiedWithQueries(ctx, s.Queries, nodeRun)
}

func requiredDeliverablesSatisfiedWithQueries(ctx context.Context, q *db.Queries, nodeRun db.MulticaWorkflowNodeRun) (bool, error) {
	deliverables, err := q.ListNodeRunDeliverableRequirements(ctx, nodeRun.ID)
	if err != nil {
		return false, fmt.Errorf("list deliverables: %w", err)
	}
	// No deliverables defined → trivially satisfied.
	if len(deliverables) == 0 {
		return true, nil
	}

	submissions, err := q.ListNodeRunDeliverableSubmissions(ctx, nodeRun.ID)
	if err != nil {
		return false, fmt.Errorf("list submissions: %w", err)
	}

	// A deliverable may carry several submissions (multiple code links —
	// migration 149): it counts as satisfied when ANY of its rows is live
	// (not missing/rejected). A rejected sibling does not block satisfaction;
	// the per-submission review owns each row's verdict.
	satisfied := make(map[string]bool, len(submissions))
	for _, sub := range submissions {
		if sub.Status == "missing" || sub.Status == "rejected" {
			continue
		}
		satisfied[util.UUIDToString(sub.DeliverableID)] = true
	}

	for _, d := range deliverables {
		if !d.Required {
			continue
		}
		if !satisfied[util.UUIDToString(d.ID)] {
			return false, nil
		}
	}
	return true, nil
}

var gitlabMergeRequestURLPattern = regexp.MustCompile(`https?://[^\s"'<>]+/-/merge_requests/\d+`)

func extractPullRequestURLFromWorkerOutput(output json.RawMessage) string {
	candidates := []string{string(output)}
	var payload struct {
		Output string `json:"output"`
		PRURL  string `json:"pr_url"`
	}
	if json.Unmarshal(output, &payload) == nil {
		candidates = append(candidates, payload.Output, payload.PRURL)
	}
	for _, candidate := range candidates {
		if url := gitlabMergeRequestURLPattern.FindString(candidate); url != "" {
			return strings.TrimRight(url, ".,);]")
		}
	}
	return ""
}

func autoSubmitSingleRequiredDeliverable(ctx context.Context, q *db.Queries, nodeRun db.MulticaWorkflowNodeRun, output json.RawMessage) error {
	prURL := extractPullRequestURLFromWorkerOutput(output)
	if prURL == "" {
		return nil
	}

	deliverables, err := q.ListNodeRunDeliverableRequirements(ctx, nodeRun.ID)
	if err != nil {
		return fmt.Errorf("list deliverables: %w", err)
	}
	var deliverableID pgtype.UUID
	for _, d := range deliverables {
		if !d.Required {
			continue
		}
		if deliverableID.Valid {
			return nil
		}
		deliverableID = d.ID
	}
	if !deliverableID.Valid {
		return nil
	}

	submissions, err := q.ListNodeRunDeliverableSubmissions(ctx, nodeRun.ID)
	if err != nil {
		return fmt.Errorf("list submissions: %w", err)
	}
	for _, sub := range submissions {
		if sub.DeliverableID == deliverableID && sub.Status != "missing" && sub.Status != "rejected" {
			return nil
		}
	}

	_, err = q.UpsertNodeRunDeliverableSubmission(ctx, db.UpsertNodeRunDeliverableSubmissionParams{
		WorkflowNodeRunID: nodeRun.ID,
		DeliverableID:     deliverableID,
		SubmittedByType:   "agent",
		SubmittedByID:     nodeRun.WorkerID,
		Content:           "",
		PullRequestUrl:    prURL,
	})
	return err
}

// ReviewNodeRun handles the Critic's approval or rework decision.
func (s *WorkflowService) ReviewNodeRun(ctx context.Context, nodeRunID pgtype.UUID, approved bool, comment string, criticOutput json.RawMessage) error {
	var nodeRun db.MulticaWorkflowNodeRun
	if err := s.runInTx(ctx, func(qtx *db.Queries) error {
		nr, err := qtx.GetWorkflowNodeRun(ctx, nodeRunID)
		if err != nil {
			return fmt.Errorf("get node run: %w", err)
		}
		if nr.Status != NodeRunStatusCriticReviewing && nr.Status != NodeRunStatusAwaitingCritic {
			return fmt.Errorf("node run is not awaiting critic review (status=%s)", nr.Status)
		}

		if approved {
			// Gate: all required deliverables must be satisfied before approval.
			if satisfied, err := s.requiredDeliverablesSatisfied(ctx, nr); err != nil {
				return fmt.Errorf("check deliverables: %w", err)
			} else if !satisfied {
				return fmt.Errorf("all required deliverables must be submitted and approved before this node can be approved")
			}

			// Persist critic_approved + critic output. Do NOT complete inside the
			// tx — the document-PR merge is an external call that can't be rolled
			// back, so completion happens after the tx commits (below).
			updated, err := qtx.UpdateWorkflowNodeRunStatus(ctx, db.UpdateWorkflowNodeRunStatusParams{
				ID:     nr.ID,
				Status: NodeRunStatusCriticApproved,
			})
			if err != nil {
				return fmt.Errorf("approve node run: %w", err)
			}
			// Store critic output; stay critic_approved (completed after merge).
			updated, err = qtx.SetWorkflowNodeRunCriticOutput(ctx, db.SetWorkflowNodeRunCriticOutputParams{
				ID:            nr.ID,
				CriticOutput:  criticOutput,
				CriticComment: pgtype.Text{String: comment, Valid: comment != ""},
				Status:        NodeRunStatusCriticApproved,
			})
			if err != nil {
				return fmt.Errorf("store critic output: %w", err)
			}
			nodeRun = updated
		} else {
			// Rework: increment retry count and go through critic_rework first.
			newRetry := nr.RetryCount + 1
			run, err := qtx.GetWorkflowRun(ctx, nr.WorkflowRunID)
			if err != nil {
				return fmt.Errorf("get run: %w", err)
			}

			// Always go through critic_rework first (state machine contract).
			updated, err := qtx.SetWorkflowNodeRunCriticOutput(ctx, db.SetWorkflowNodeRunCriticOutputParams{
				ID:            nr.ID,
				CriticOutput:  nil,
				CriticComment: pgtype.Text{String: comment, Valid: comment != ""},
				Status:        NodeRunStatusCriticRework,
				RetryCount:    pgtype.Int4{Int32: newRetry, Valid: true},
			})
			if err != nil {
				return fmt.Errorf("rework node run: %w", err)
			}

			if newRetry > run.MaxRetries {
				// Max retries exhausted: transition from critic_rework to blocked.
				updated, err = qtx.UpdateWorkflowNodeRunStatus(ctx, db.UpdateWorkflowNodeRunStatusParams{
					ID:     updated.ID,
					Status: NodeRunStatusBlocked,
				})
				if err != nil {
					return fmt.Errorf("block node run: %w", err)
				}
				nodeRun = updated
				return nil // Blocked is terminal; handled after tx.
			}

			nodeRun = updated

			// Re-dispatch to format_ok for the next retry.
			u, err := qtx.UpdateWorkflowNodeRunStatus(ctx, db.UpdateWorkflowNodeRunStatusParams{
				ID:     updated.ID,
				Status: NodeRunStatusFormatOk,
			})
			if err != nil {
				return fmt.Errorf("re-dispatch after rework: %w", err)
			}
			nodeRun = u
			generation, err := NextWorkflowDispatchGeneration(ctx, qtx, nr.ID, "worker")
			if err != nil {
				return err
			}
			if err := EnqueueWorkflowDispatch(ctx, qtx, nr.ID, "worker", generation); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return err
	}

	// Archive the review comment to Gitea as a document (journey 7: review
	// opinion is itself a deliverable, archived to the repo). Best-effort.
	if comment != "" {
		decision := "approved"
		if !approved {
			decision = "rejected"
		}
		s.ArchiveReviewComment(context.Background(), nodeRun, decision, comment)
	}

	// Approve path: the tx persisted critic_approved. Merge deliverable review
	// requests, then complete or block on merge failure. UpdateWorkflowNodeRunStatus is called DIRECTLY (not
	// TransitionNodeRun) so OnNodeStatusChanged fires exactly once, from the
	// completed/blocked blocks below. The reject/rework path (FormatOk) is
	// untouched and skips this block entirely.
	if approved && nodeRun.Status == NodeRunStatusCriticApproved {
		finalStatus := NodeRunStatusCompleted
		if err := s.mergeDeliverablePRs(ctx, nodeRun); err != nil {
			slog.Error("merge deliverable review requests failed; blocking node run",
				"node_run_id", util.UUIDToString(nodeRun.ID), "error", err)
			finalStatus = NodeRunStatusBlocked
		} else {
			s.markDeliverableSubmissionsApproved(ctx, nodeRun)
			// Code MR links no longer ride the document PR: on approval, write the
			// code-links audit file directly to the inst branch. Best-effort — the
			// function logs internally and never blocks completion.
			s.archiveCodeLinksToInst(ctx, nodeRun.ID)
		}
		updated, err := s.Queries.UpdateWorkflowNodeRunStatus(ctx, db.UpdateWorkflowNodeRunStatusParams{
			ID: nodeRun.ID, Status: finalStatus,
		})
		if err != nil {
			return fmt.Errorf("set node run status after merge decision: %w", err)
		}
		nodeRun = updated
	}

	if nodeRun.Status == NodeRunStatusFormatOk {
		if s.OnNodeStatusChanged != nil {
			s.OnNodeStatusChanged(ctx, nodeRun)
		}
		return nil
	}

	if nodeRun.Status == NodeRunStatusBlocked {
		if s.OnNodeStatusChanged != nil {
			s.OnNodeStatusChanged(ctx, nodeRun)
		}
		return s.OnNodeRunCompleted(ctx, nodeRunID)
	}

	if nodeRun.Status == NodeRunStatusCompleted {
		if s.OnNodeStatusChanged != nil {
			s.OnNodeStatusChanged(ctx, nodeRun)
		}
		return s.OnNodeRunCompleted(ctx, nodeRunID)
	}

	return nil
}

// dispatchWorker advances a node run from format_ok to the worker phase.
func (s *WorkflowService) dispatchWorker(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) error {
	return s.dispatchWorkerForJob(ctx, nodeRun, pgtype.UUID{})
}

func (s *WorkflowService) dispatchWorkerForJob(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, dispatchJobID pgtype.UUID) error {
	if err := s.ensureNodeRunBranch(ctx, nodeRun); err != nil {
		return fmt.Errorf("ensure node branch: %w", err)
	}

	if workflowNodeType(nodeRun.FormatSchema) == "split" {
		_, err := s.TransitionNodeRun(ctx, nodeRun, NodeRunStatusSplitting)
		return err
	}

	switch nodeRun.WorkerType {
	case "human":
		if err := s.validateResolvedHumanMember(ctx, nodeRun, "worker"); err != nil {
			return err
		}
		return s.transitionHumanRolePhase(ctx, nodeRun, "worker", NodeRunStatusWorkerAssigned)
	case "agent", "squad":
		agentID := nodeRun.WorkerID
		if nodeRun.WorkerType == "squad" && nodeRun.WorkerID.Valid {
			squad, err := s.Queries.GetSquad(ctx, nodeRun.WorkerID)
			if err == nil {
				agentID = squad.LeaderID
			}
		}
		if !agentID.Valid {
			// No specific agent assigned yet — mark as assigned so it can be claimed.
			_, err := s.TransitionNodeRun(ctx, nodeRun, NodeRunStatusWorkerAssigned)
			return err
		}
		if _, err := s.dispatchAgentTask(ctx, nodeRun, "worker", nil, dispatchJobID); err != nil {
			return fmt.Errorf("dispatch agent task: %w", err)
		}
		return s.transitionNodeRunAfterDispatch(ctx, nodeRun.ID, NodeRunStatusWorking)
	default:
		return fmt.Errorf("unknown worker type: %s", nodeRun.WorkerType)
	}
}

func (s *WorkflowService) dispatchCritic(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) error {
	return s.dispatchCriticForJob(ctx, nodeRun, pgtype.UUID{})
}

func (s *WorkflowService) dispatchCriticForJob(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, dispatchJobID pgtype.UUID) error {
	switch nodeRun.CriticType {
	case "human":
		if err := s.validateResolvedHumanMember(ctx, nodeRun, "critic"); err != nil {
			return err
		}
		return s.transitionHumanRolePhase(ctx, nodeRun, "critic", NodeRunStatusCriticReviewing)
	case "agent", "squad":
		agentID := nodeRun.CriticID
		if nodeRun.CriticType == "squad" && nodeRun.CriticID.Valid {
			squad, err := s.Queries.GetSquad(ctx, nodeRun.CriticID)
			if err == nil {
				agentID = squad.LeaderID
			}
		}
		if !agentID.Valid {
			return fmt.Errorf("no agent resolved for critic")
		}
		_, err := s.dispatchAgentTask(ctx, nodeRun, "critic", nil, dispatchJobID)
		if err != nil {
			return fmt.Errorf("dispatch critic task: %w", err)
		}
		return s.transitionNodeRunAfterDispatch(ctx, nodeRun.ID, NodeRunStatusCriticReviewing)
	case "api":
		// For API critics, we transition to critic_reviewing and let the
		// API call happen asynchronously (handled by the caller or a sweeper).
		_, err := s.TransitionNodeRun(ctx, nodeRun, NodeRunStatusCriticReviewing)
		return err
	default:
		return fmt.Errorf("unknown critic type: %s", nodeRun.CriticType)
	}
}

// ── Agent task dispatch ──────────────────────────────────────────────────────

// DispatchAgentTaskWithContextExtras creates an agent task and merges caller
// supplied metadata into the workflow task context. The runtime-aware dispatch
// lives in workflow_runtime_selection.go; this wrapper only adds the extras.
func (s *WorkflowService) DispatchAgentTaskWithContextExtras(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, phase string, contextExtras map[string]any) (*db.MulticaAgentTaskQueue, error) {
	return s.DispatchAgentTask(ctx, nodeRun, phase, contextExtras)
}

// ── Format checker ───────────────────────────────────────────────────────────

// executeFormatChecker advances format checking. Runtime input validation from
// task JSON Schema is retired; format_schema is still used as node metadata by
// split and gateway handling.
func (s *WorkflowService) executeFormatChecker(ctx context.Context, qtx *db.Queries, nodeRun db.MulticaWorkflowNodeRun) error {
	if len(nodeRun.FormatSchema) == 0 || !shouldValidateNodeInputFormatSchema(nodeRun.FormatSchema) {
		// Continue to worker dispatch while preserving node metadata handling downstream.
		if isRetiredTaskJSONSchema(nodeRun.FormatSchema) {
			slog.Warn("workflow: skipping retired task format_schema validation",
				"node_run_id", util.UUIDToString(nodeRun.ID),
				"workflow_node_id", util.UUIDToString(nodeRun.WorkflowNodeID),
				"node_title", nodeRun.NodeTitle,
			)
		}
		if _, err := s.TransitionNodeRun(ctx, nodeRun, NodeRunStatusFormatOk); err != nil {
			return err
		}
		updated, err := s.Queries.GetWorkflowNodeRun(ctx, nodeRun.ID)
		if err != nil {
			return err
		}
		return s.dispatchWorker(ctx, updated)
	}

	// Run JSON Schema validation.
	run, err := qtx.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		return err
	}

	valid, valErr := validateJSONSchema(nodeRun.FormatSchema, run.Input)
	if !valid {
		if _, err := s.TransitionNodeRun(ctx, nodeRun, NodeRunStatusFormatFailed); err != nil {
			return err
		}
		if valErr != nil {
			s.Queries.SetWorkflowNodeRunCriticOutput(ctx, db.SetWorkflowNodeRunCriticOutputParams{
				ID:            nodeRun.ID,
				CriticComment: pgtype.Text{String: valErr.Error(), Valid: true},
				Status:        NodeRunStatusFormatFailed,
			})
		}
		return nil
	}

	if _, err := s.TransitionNodeRun(ctx, nodeRun, NodeRunStatusFormatOk); err != nil {
		return err
	}
	updated, err := s.Queries.GetWorkflowNodeRun(ctx, nodeRun.ID)
	if err != nil {
		return err
	}
	return s.dispatchWorker(ctx, updated)
}

func shouldValidateNodeInputFormatSchema(_ json.RawMessage) bool {
	return false
}

func isRetiredTaskJSONSchema(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var schema struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &schema); err != nil {
		return false
	}
	switch schema.Type {
	case "object", "array", "string", "number", "boolean", "null":
		return true
	default:
		return false
	}
}

// validateJSONSchema validates input JSON against a JSON Schema.
// Uses a simple structural check; for full JSON Schema support, integrate
// gojsonschema as noted in the architecture plan.
func validateJSONSchema(schema, input []byte) (bool, error) {
	if len(schema) == 0 {
		return true, nil
	}
	if len(input) == 0 {
		return true, nil
	}

	var schemaMap map[string]any
	if err := json.Unmarshal(schema, &schemaMap); err != nil {
		// Schema is valid JSON but not a JSON object (e.g., a bare string,
		// number, or null — which can happen when the frontend sends a
		// textarea string without parsing it back to an object first).
		// Treat non-object schemas as "no type constraint", same as an
		// empty schema.
		return true, nil
	}

	typeStr, _ := schemaMap["type"].(string)
	if typeStr == "" {
		return true, nil // No type constraint, anything passes.
	}

	var inputVal any
	if err := json.Unmarshal(input, &inputVal); err != nil {
		return false, fmt.Errorf("invalid input JSON: %w", err)
	}

	switch typeStr {
	case "object":
		if _, ok := inputVal.(map[string]any); !ok {
			return false, fmt.Errorf("expected object, got %T", inputVal)
		}
	case "array":
		if _, ok := inputVal.([]any); !ok {
			return false, fmt.Errorf("expected array, got %T", inputVal)
		}
	case "string":
		if _, ok := inputVal.(string); !ok {
			return false, fmt.Errorf("expected string, got %T", inputVal)
		}
	case "number":
		switch inputVal.(type) {
		case float64, float32, int, int64, int32, json.Number:
		default:
			return false, fmt.Errorf("expected number, got %T", inputVal)
		}
	case "boolean":
		if _, ok := inputVal.(bool); !ok {
			return false, fmt.Errorf("expected boolean, got %T", inputVal)
		}
	case "null":
		if inputVal != nil {
			return false, fmt.Errorf("expected null, got %T", inputVal)
		}
	}

	// Check required fields for objects.
	if typeStr == "object" {
		required, _ := schemaMap["required"].([]any)
		if len(required) > 0 {
			obj := inputVal.(map[string]any)
			for _, r := range required {
				key, ok := r.(string)
				if !ok {
					continue
				}
				if _, exists := obj[key]; !exists {
					return false, fmt.Errorf("missing required field: %s", key)
				}
			}
		}
	}

	return true, nil
}

// ── Tx helpers ───────────────────────────────────────────────────────────────

func (s *WorkflowService) runInTx(ctx context.Context, fn func(*db.Queries) error) error {
	if s.TxStarter == nil {
		return fn(s.Queries)
	}
	tx, err := s.TxStarter.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if err := fn(s.Queries.WithTx(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// qtxForRun returns queries or nil. Used to pass a non-nil Queries to
// format checker dispatch while keeping the simple call signature.
func qtxForRun(q *db.Queries) *db.Queries {
	return q
}

// ── Agent task gateway (called from TaskService.CompleteTask) ────────────────

// HandleWorkflowTaskCompletion is called when an agent task linked to a
// workflow node run reaches completion. It transitions the node run based
// on the completed task's phase (worker → awaiting_critic, critic → review).
func (s *WorkflowService) HandleWorkflowTaskCompletion(ctx context.Context, task db.MulticaAgentTaskQueue) error {
	if !task.WorkflowNodeRunID.Valid {
		return nil
	}

	nodeRun, err := s.Queries.GetWorkflowNodeRun(ctx, task.WorkflowNodeRunID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("get node run: %w", err)
	}

	// Determine the phase from the task context.
	var ctxPayload struct {
		Phase string `json:"phase"`
	}
	if len(task.Context) > 0 {
		json.Unmarshal(task.Context, &ctxPayload)
	}

	switch ctxPayload.Phase {
	case "worker":
		if nodeRun.Status == NodeRunStatusWorking {
			// Check for awaiting_input signal before normal worker completion.
			if len(task.Result) > 0 {
				var awaitingSignal struct {
					Status      string   `json:"status"`
					Question    string   `json:"question"`
					Options     []string `json:"options"`
					Recommended string   `json:"recommended"`
				}
				found := false
				if json.Unmarshal(task.Result, &awaitingSignal) == nil &&
					awaitingSignal.Status == "awaiting_input" {
					found = true
				}
				if !found {
					var completeReq struct {
						Output string `json:"output"`
					}
					if json.Unmarshal(task.Result, &completeReq) == nil && completeReq.Output != "" {
						if idx := strings.Index(completeReq.Output, "\"status\":\"awaiting_input\""); idx >= 0 {
							jsonStr := extractJSONObject(completeReq.Output, idx)
							if json.Unmarshal([]byte(jsonStr), &awaitingSignal) == nil &&
								awaitingSignal.Status == "awaiting_input" {
								found = true
							} else {
								found = true
							}
						}
					}
				}
				if found {
					// Store worker output and transition to awaiting_input.
					if err := s.runInTx(ctx, func(qtx *db.Queries) error {
						updated, err := qtx.SetWorkflowNodeRunWorkerOutput(ctx, db.SetWorkflowNodeRunWorkerOutputParams{
							ID:           nodeRun.ID,
							WorkerOutput: task.Result,
							Status:       NodeRunStatusAwaitingInput,
						})
						if err != nil {
							return err
						}
						nodeRun = updated
						return nil
					}); err != nil {
						return err
					}
					// Check if auto-reply is enabled for this workspace.
					if s.autoReplyEnabled(ctx, nodeRun) {
						return s.handleAutoReply(ctx, nodeRun, task)
					}
					return nil
				}
			}

			return s.SubmitWorkerOutput(ctx, nodeRun.ID, task.Result)
		}
	case "critic":
		if nodeRun.Status == NodeRunStatusCriticReviewing {
			approved, comment, err := criticDecisionFromResult(task.Result)
			if err != nil {
				return err
			}
			comment = normalizeAgentCriticComment(approved, comment)
			return s.ReviewNodeRun(ctx, nodeRun.ID, approved, comment, task.Result)
		}
	}

	return nil
}

type agentCriticDecision struct {
	Approved *bool  `json:"approved"`
	Comment  string `json:"comment"`
	Output   string `json:"output"`
}

func parseAgentCriticDecision(result json.RawMessage) (bool, string, error) {
	if strings.TrimSpace(string(result)) == "" {
		return false, "", fmt.Errorf("critic task completed without output")
	}

	var output agentCriticDecision
	if err := json.Unmarshal(result, &output); err != nil {
		return false, "", fmt.Errorf("parse critic output: %w", err)
	}

	if output.Approved == nil && strings.TrimSpace(output.Output) != "" {
		var nested agentCriticDecision
		if json.Unmarshal([]byte(strings.TrimSpace(output.Output)), &nested) == nil &&
			(nested.Approved != nil || strings.TrimSpace(nested.Comment) != "") {
			output.Approved = nested.Approved
			if strings.TrimSpace(nested.Comment) != "" {
				output.Comment = nested.Comment
			}
		}
	}

	comment := strings.TrimSpace(output.Comment)
	if comment == "" {
		comment = strings.TrimSpace(output.Output)
	}
	if output.Approved == nil && comment == "" {
		return false, "", fmt.Errorf("critic task completed without a decision")
	}

	approved := true
	if output.Approved != nil {
		approved = *output.Approved
	} else {
		lower := strings.ToLower(comment)
		approved = !strings.Contains(lower, "不通过") &&
			!strings.Contains(lower, "reject")
	}
	return approved, comment, nil
}

// criticDecisionFromResult resolves a critic's approve/reject decision from a
// completed task's result JSON. It prefers an explicit decision carried by the
// agent's "complete task" tool call (decision=approve|reject + reason); when
// absent it falls back to parsing the critic's free-text output. The task
// result is the marshaled TaskCompleteRequest, so decision/reason sit alongside
// output/session_id/work_dir.
func criticDecisionFromResult(result json.RawMessage) (bool, string, error) {
	var explicit struct {
		Decision string `json:"decision"`
		Reason   string `json:"reason"`
	}
	if json.Unmarshal(result, &explicit) == nil &&
		(explicit.Decision == "approve" || explicit.Decision == "reject") {
		return explicit.Decision == "approve", explicit.Reason, nil
	}
	return parseAgentCriticDecision(result)
}

func normalizeAgentCriticComment(approved bool, comment string) string {
	comment = strings.TrimSpace(comment)
	lower := strings.ToLower(comment)
	if strings.Contains(lower, "approved") ||
		strings.Contains(lower, "rejected") ||
		strings.Contains(comment, "通过") ||
		strings.Contains(comment, "驳回") {
		return comment
	}
	if approved {
		if comment == "" {
			return "Approved."
		}
		return "Approved: " + comment
	}
	if comment == "" {
		return "Rejected."
	}
	return "Rejected: " + comment
}

// HandleWorkflowTaskFailure is called when an agent task linked to a workflow
// node run fails and will not be retried. It fails the current node and the
// workflow run, then cancels all unfinished nodes and tasks so no downstream
// work can start.
func (s *WorkflowService) HandleWorkflowTaskFailure(ctx context.Context, task db.MulticaAgentTaskQueue) error {
	if !task.WorkflowNodeRunID.Valid {
		return nil
	}

	nodeRun, err := s.Queries.GetWorkflowNodeRun(ctx, task.WorkflowNodeRunID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("get node run: %w", err)
	}

	var ctxPayload struct {
		Phase string `json:"phase"`
	}
	if len(task.Context) > 0 {
		_ = json.Unmarshal(task.Context, &ctxPayload)
	}

	var targetStatus string
	switch ctxPayload.Phase {
	case "worker":
		if nodeRun.Status == NodeRunStatusWorking || nodeRun.Status == NodeRunStatusWorkerAssigned {
			targetStatus = NodeRunStatusFailed
		}
	case "critic":
		if nodeRun.Status == NodeRunStatusCriticReviewing {
			targetStatus = NodeRunStatusFailed
		}
	}
	if targetStatus == "" {
		return nil
	}

	if err := s.failWorkflowFromNode(ctx, nodeRun, NodeRunStatusFailed, taskFailureReason(task)); err != nil {
		return fmt.Errorf("fail workflow on task failure: %w", err)
	}
	return nil
}

// ── Awaiting input helpers ──────────────────────────────────────────────────

// autoReplyEnabled checks whether the workspace has workflow_auto_reply_enabled
// set in its settings JSONB.
func (s *WorkflowService) autoReplyEnabled(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) bool {
	run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		return false
	}
	ws, err := s.Queries.GetWorkspace(ctx, run.WorkspaceID)
	if err != nil {
		return false
	}
	if len(ws.Settings) == 0 {
		return false
	}
	var settings map[string]any
	if json.Unmarshal(ws.Settings, &settings) != nil {
		return false
	}
	enabled, _ := settings["workflow_auto_reply_enabled"].(bool)
	return enabled
}

// handleAutoReply posts a system comment with the recommended option and
// resumes the agent task.
func (s *WorkflowService) handleAutoReply(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, task db.MulticaAgentTaskQueue) error {
	// Parse the awaiting_input signal to get the recommended option.
	var signal struct {
		Status      string   `json:"status"`
		Question    string   `json:"question"`
		Options     []string `json:"options"`
		Recommended string   `json:"recommended"`
	}
	if json.Unmarshal(task.Result, &signal) != nil || signal.Recommended == "" {
		return nil // Cannot auto-reply without a recommended option.
	}

	// Find the sub-issue for this node run.
	run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		return err
	}
	subIssue, err := s.Queries.GetIssueByOrigin(ctx, db.GetIssueByOriginParams{
		WorkspaceID: run.WorkspaceID,
		OriginType:  pgtype.Text{String: "workflow", Valid: true},
		OriginID:    nodeRun.ID,
	})
	if err != nil {
		return err
	}

	// Post a system comment with the auto-reply text.
	commentContent := fmt.Sprintf("**%s**\n\nAuto-reply (recommended): %s", signal.Question, signal.Recommended)
	s.createSystemComment(ctx, subIssue.ID, run.WorkspaceID, commentContent)

	// Transition awaiting_input → working and dispatch a resume agent task.
	updated, err := s.resumeNodeRunAndEnqueue(ctx, nodeRun)
	if err != nil {
		return err
	}
	if s.OnNodeStatusChanged != nil {
		s.OnNodeStatusChanged(ctx, updated)
	}
	return nil
}

// ResumeNodeRunFromComment handles a user's manual reply to an awaiting_input
// node. It transitions the node back to working and dispatches a resume task
// with the user's reply content.
func (s *WorkflowService) ResumeNodeRunFromComment(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, comment db.MulticaComment) error {
	updated, err := s.resumeNodeRunAndEnqueue(ctx, nodeRun)
	if err != nil {
		return err
	}
	if s.OnNodeStatusChanged != nil {
		s.OnNodeStatusChanged(ctx, updated)
	}
	return nil
}

func (s *WorkflowService) resumeNodeRunAndEnqueue(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) (db.MulticaWorkflowNodeRun, error) {
	var updated db.MulticaWorkflowNodeRun
	err := s.runInTx(ctx, func(qtx *db.Queries) error {
		fresh, err := qtx.GetWorkflowNodeRunForUpdate(ctx, nodeRun.ID)
		if err != nil {
			return err
		}
		if fresh.Status != NodeRunStatusAwaitingInput {
			return fmt.Errorf("node run is not awaiting input (status=%s)", fresh.Status)
		}
		updated, err = qtx.UpdateWorkflowNodeRunStatus(ctx, db.UpdateWorkflowNodeRunStatusParams{
			ID: fresh.ID, Status: NodeRunStatusWorking,
		})
		if err != nil {
			return err
		}
		generation, err := NextWorkflowDispatchGeneration(ctx, qtx, fresh.ID, "recovery")
		if err != nil {
			return err
		}
		return EnqueueWorkflowDispatch(ctx, qtx, fresh.ID, "recovery", generation)
	})
	return updated, err
}

// extractJSONObject attempts to extract a balanced JSON object from s starting
// near startIdx (which should point at a `"status":"awaiting_input"` substring
// inside a JSON object). It walks back to find the opening `{` and forward to
// find the matching `}`, returning the substring. If no balanced object can be
// found, it returns s[startIdx:] as a best-effort fallback.
func extractJSONObject(s string, startIdx int) string {
	// Walk back to find the opening brace.
	openIdx := -1
	for i := startIdx; i >= 0; i-- {
		if s[i] == '{' {
			openIdx = i
			break
		}
	}
	if openIdx < 0 {
		return s[startIdx:]
	}

	// Walk forward, counting braces to find the matching close.
	depth := 0
	inString := false
	escaped := false
	for i := openIdx; i < len(s); i++ {
		c := s[i]
		if escaped {
			escaped = false
			continue
		}
		if inString {
			if c == '\\' {
				escaped = true
			} else if c == '"' {
				inString = false
			}
			continue
		}
		if c == '"' {
			inString = true
		} else if c == '{' {
			depth++
		} else if c == '}' {
			depth--
			if depth == 0 {
				return s[openIdx : i+1]
			}
		}
	}
	return s[startIdx:]
}

// createSystemComment posts a system-authored comment on an issue.
func (s *WorkflowService) createSystemComment(ctx context.Context, issueID pgtype.UUID, workspaceID pgtype.UUID, content string) {
	_, err := s.Queries.CreateComment(ctx, db.CreateCommentParams{
		IssueID:     issueID,
		WorkspaceID: workspaceID,
		AuthorType:  "system",
		Content:     content,
		Type:        "comment",
	})
	if err != nil {
		slog.Warn("failed to create system comment for awaiting_input", "issue_id", util.UUIDToString(issueID), "error", err)
	}
}

// ── WS event helpers ─────────────────────────────────────────────────────────

func (s *WorkflowService) publishWorkflowEvent(eventType, workspaceID string, payload any) {
	if s.Bus == nil {
		return // best-effort: no event bus wired (e.g. service constructed in tests) — skip, don't crash.
	}
	s.Bus.Publish(events.Event{
		Type:        eventType,
		WorkspaceID: workspaceID,
		ActorType:   "system",
		Payload:     payload,
	})
}

// workflow event type constants — duplicated here to avoid circular imports
// with protocol package when new events haven't been added yet.
const (
	EventWorkflowCreated          = "workflow:created"
	EventWorkflowUpdated          = "workflow:updated"
	EventWorkflowDeleted          = "workflow:deleted"
	EventWorkflowRunStarted       = "workflow:run_started"
	EventWorkflowRunCompleted     = "workflow:run_completed"
	EventWorkflowRunFailed        = "workflow:run_failed"
	EventWorkflowRunCancelled     = "workflow:run_cancelled"
	EventWorkflowNodeRunStarted   = "workflow:node_run_started"
	EventWorkflowNodeRunCompleted = "workflow:node_run_completed"
	EventWorkflowNodeRunFailed    = "workflow:node_run_failed"
	EventWorkflowNodeRunBlocked   = "workflow:node_run_blocked"
	EventWorkflowNodeRunReviewed  = "workflow:node_run_reviewed"
)

// ── Template management ──────────────────────────────────────────────────────

// CloneWorkflowFromTemplate creates a new workflow by cloning a template's
// stages, nodes, and edges within a single transaction. The new workflow is
// created with is_template=false, source_template_id=templateID, status="active".
// Returns the created workflow, its nodes, and edges.
func (s *WorkflowService) CloneWorkflowFromTemplate(
	ctx context.Context,
	templateID pgtype.UUID,
	workspaceID pgtype.UUID,
	title string,
	description string,
	creatorType string,
	creatorID pgtype.UUID,
) (db.MulticaWorkflow, []db.MulticaWorkflowNode, []db.MulticaWorkflowEdge, error) {
	var newWorkflow db.MulticaWorkflow
	var newNodes []db.MulticaWorkflowNode
	var newEdges []db.MulticaWorkflowEdge

	err := s.runInTx(ctx, func(qtx *db.Queries) error {
		// 1. Verify the template exists and is actually a template.
		tmpl, err := qtx.GetWorkflow(ctx, templateID)
		if err != nil {
			return fmt.Errorf("template workflow not found: %w", err)
		}
		if !tmpl.IsTemplate {
			return fmt.Errorf("workflow %s is not a template", util.UUIDToString(templateID))
		}

		// 2. Create the new workflow from template.
		desc := pgtype.Text{String: description, Valid: true}
		wf, err := qtx.CreateWorkflowFromTemplate(ctx, db.CreateWorkflowFromTemplateParams{
			WorkspaceID:      workspaceID,
			Title:            title,
			Description:      desc,
			Status:           "active",
			MaxRetries:       tmpl.MaxRetries,
			CreatedByType:    creatorType,
			CreatedByID:      creatorID,
			SourceTemplateID: templateID,
		})
		if err != nil {
			return fmt.Errorf("create workflow from template: %w", err)
		}
		newWorkflow = wf

		// 3. Clone all template stages with new UUIDs and new workflow_id.
		tmplStages, err := qtx.ListWorkflowStagesByWorkflow(ctx, templateID)
		if err != nil {
			return fmt.Errorf("list template stages: %w", err)
		}
		oldStageToNew := make(map[string]pgtype.UUID, len(tmplStages))
		for _, stage := range tmplStages {
			stageDesc := pgtype.Text{String: stage.Description, Valid: true}
			s, err := qtx.CreateWorkflowStage(ctx, db.CreateWorkflowStageParams{
				WorkflowID:  wf.ID,
				Name:        stage.Name,
				SortOrder:   stage.SortOrder,
				Description: stageDesc,
			})
			if err != nil {
				return fmt.Errorf("clone stage %s: %w", stage.Name, err)
			}
			oldStageToNew[util.UUIDToString(stage.ID)] = s.ID
		}

		// 4. Clone all template nodes with new UUIDs and new workflow_id.
		tmplNodes, err := qtx.ListWorkflowNodes(ctx, templateID)
		if err != nil {
			return fmt.Errorf("list template nodes: %w", err)
		}

		// Roles are workspace-scoped with per-workspace UUIDs, so a role carried
		// by a template node cannot be copied verbatim into another workspace.
		// Remap each role to the target workspace's same-named role; builtin
		// roles (developer/qa/tech_lead) are seeded into every workspace, so they
		// always resolve. A role with no target counterpart is left unchanged.
		remapRole, err := buildCloneRoleRemap(ctx, qtx, tmpl.WorkspaceID, workspaceID)
		if err != nil {
			return fmt.Errorf("build role remap: %w", err)
		}

		oldToNew := make(map[string]pgtype.UUID, len(tmplNodes))
		for _, node := range tmplNodes {
			criticType := node.CriticType
			criticID := node.CriticID
			criticRoleID := remapRole(node.CriticRoleID)
			criticAPIURL := node.CriticApiUrl
			workerRoleID := remapRole(node.WorkerRoleID)
			if workflowmeta.KindOf(node.FormatSchema) == workflowmeta.KindSplit &&
				criticType == "human" && !criticID.Valid && !criticRoleID.Valid && !criticAPIURL.Valid {
				criticType = "human"
				criticID = creatorID
				criticRoleID = pgtype.UUID{}
				criticAPIURL = pgtype.Text{}
			}
			n, err := qtx.CreateWorkflowNode(ctx, db.CreateWorkflowNodeParams{
				WorkflowID:   wf.ID,
				Title:        node.Title,
				Description:  textToPgText(node.Description),
				PositionX:    node.PositionX,
				PositionY:    node.PositionY,
				FormatSchema: node.FormatSchema,
				WorkerType:   node.WorkerType,
				WorkerID:     node.WorkerID,
				WorkerRoleID: workerRoleID,
				CriticType:   criticType,
				CriticID:     criticID,
				CriticRoleID: criticRoleID,
				CriticApiUrl: criticAPIURL,
				SortOrder:    node.SortOrder,
			})
			if err != nil {
				return fmt.Errorf("clone node %s: %w", node.Title, err)
			}
			oldToNew[util.UUIDToString(node.ID)] = n.ID

			// 4a. Remap stage_id to the cloned stage.
			if node.StageID.Valid {
				newStageID, ok := oldStageToNew[util.UUIDToString(node.StageID)]
				if ok {
					_, err := qtx.AssignNodeToStage(ctx, db.AssignNodeToStageParams{
						ID:      n.ID,
						StageID: newStageID,
					})
					if err != nil {
						return fmt.Errorf("assign cloned node %s to stage: %w", node.Title, err)
					}
					n.StageID = newStageID
				}
			}
			newNodes = append(newNodes, n)
		}

		// 5. Clone all template edges with remapped node IDs.
		tmplEdges, err := qtx.ListWorkflowEdges(ctx, templateID)
		if err != nil {
			return fmt.Errorf("list template edges: %w", err)
		}
		for _, edge := range tmplEdges {
			newSrc, ok := oldToNew[util.UUIDToString(edge.SourceNodeID)]
			if !ok {
				continue
			}
			newTgt, ok := oldToNew[util.UUIDToString(edge.TargetNodeID)]
			if !ok {
				continue
			}
			e, err := qtx.CreateWorkflowEdge(ctx, db.CreateWorkflowEdgeParams{
				WorkflowID:   wf.ID,
				SourceNodeID: newSrc,
				TargetNodeID: newTgt,
				Condition:    edge.Condition,
			})
			if err != nil {
				return fmt.Errorf("clone edge: %w", err)
			}
			newEdges = append(newEdges, e)
		}
		return nil
	})
	if err != nil {
		return db.MulticaWorkflow{}, nil, nil, err
	}
	return newWorkflow, newNodes, newEdges, nil
}

// buildCloneRoleRemap returns a function that translates a workflow role ID
// from the source (template) workspace into the equivalent role ID in the
// target workspace, matched by normalized name. A role with no same-named
// counterpart in the target workspace is left unchanged (the caller still
// receives a valid, non-remapped ID). Builtin roles (developer/qa/tech_lead)
// are seeded into every workspace on creation, so they always remap.
func buildCloneRoleRemap(
	ctx context.Context,
	qtx *db.Queries,
	sourceWorkspaceID, targetWorkspaceID pgtype.UUID,
) (func(pgtype.UUID) pgtype.UUID, error) {
	if !sourceWorkspaceID.Valid || !targetWorkspaceID.Valid {
		return func(id pgtype.UUID) pgtype.UUID { return id }, nil
	}
	sourceRoles, err := qtx.ListWorkflowRoles(ctx, sourceWorkspaceID)
	if err != nil {
		return nil, err
	}
	sourceName := make(map[string]string, len(sourceRoles))
	for _, r := range sourceRoles {
		sourceName[util.UUIDToString(r.ID)] = r.NormalizedName
	}
	targetRoles, err := qtx.ListWorkflowRoles(ctx, targetWorkspaceID)
	if err != nil {
		return nil, err
	}
	targetID := make(map[string]pgtype.UUID, len(targetRoles))
	for _, r := range targetRoles {
		targetID[r.NormalizedName] = r.ID
	}
	return func(id pgtype.UUID) pgtype.UUID {
		if !id.Valid {
			return id
		}
		name, ok := sourceName[util.UUIDToString(id)]
		if !ok {
			return id
		}
		if tgt, ok := targetID[name]; ok {
			return tgt
		}
		return id
	}, nil
}

// SetWorkflowTemplate toggles the is_template flag on a workflow.
func (s *WorkflowService) SetWorkflowTemplate(ctx context.Context, workflowID pgtype.UUID, isTemplate bool) (db.MulticaWorkflow, error) {
	workflow, err := s.Queries.GetWorkflow(ctx, workflowID)
	if err != nil {
		return db.MulticaWorkflow{}, err
	}
	var updated db.MulticaWorkflow
	err = s.RunDefinitionWrite(ctx, workflow.WorkspaceID, workflow.ID, DefinitionLockWorkflowOnly, func(qtx *db.Queries) error {
		var err error
		updated, err = qtx.SetWorkflowTemplate(ctx, db.SetWorkflowTemplateParams{ID: workflowID, IsTemplate: isTemplate})
		return err
	})
	return updated, err
}

// DeleteWorkflowWithTemplateCheck checks whether a template workflow has
// derived workflows (via source_template_id). If count > 0, it returns an
// error. Callers should use this before deleting a template workflow.
func (s *WorkflowService) DeleteWorkflowWithTemplateCheck(ctx context.Context, workflowID pgtype.UUID) error {
	count, err := s.Queries.CountWorkflowsBySourceTemplate(ctx, workflowID)
	if err != nil {
		return fmt.Errorf("count derived workflows: %w", err)
	}
	if count > 0 {
		return fmt.Errorf("template has %d derived workflows, cannot delete", count)
	}
	return nil
}

func (s *WorkflowService) DeleteWorkflowDefinition(ctx context.Context, workflowID pgtype.UUID) error {
	return s.runInTx(ctx, func(qtx *db.Queries) error {
		workflow, err := qtx.LockWorkflowDefinitionForUpdate(ctx, workflowID)
		if err != nil {
			return fmt.Errorf("lock workflow definition: %w", err)
		}
		hasRuns, err := qtx.WorkflowHasRuns(ctx, workflow.ID)
		if err != nil {
			return fmt.Errorf("check workflow runs: %w", err)
		}
		if hasRuns {
			return ErrWorkflowHasRuns
		}
		if err := qtx.DeleteWorkflow(ctx, workflow.ID); err != nil {
			return fmt.Errorf("delete workflow: %w", err)
		}
		return nil
	})
}

// CanManageWorkflows checks whether the given user has the
// can_manage_workflows permission bit set (global, not workspace-scoped).
func (s *WorkflowService) CanManageWorkflows(ctx context.Context, userID pgtype.UUID) (bool, error) {
	user, err := s.Queries.GetUser(ctx, userID)
	if err != nil {
		return false, fmt.Errorf("get user: %w", err)
	}
	return user.CanManageWorkflows, nil
}

package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const workflowRuntimeStaleSeconds = 90

const (
	RuntimeSelectionManual       = "manual"
	RuntimeSelectionIdle         = "idle"
	RuntimeSelectionIssueCreator = "issue_creator"
	RuntimeSelectionAgentBinding = "agent_binding"
)

const (
	RuntimeSelectionPolicySpecifiedRuntimeFirst = "specified_runtime_first"
	RuntimeSelectionPolicyIdleFirst             = "idle_first"
	RuntimeSelectionPolicyIssueCreatorFirst     = "issue_creator_first"
)

var ErrWorkflowRuntimeUnavailable = errors.New("no eligible runtime is available for workflow node")
var ErrWorkflowRunNotRunning = errors.New("workflow run is not running")
var ErrWorkflowRuntimeSelectionInvalid = errors.New("invalid workflow runtime selection")

func IsWorkflowRuntimeSelectionPolicy(policy string) bool {
	switch policy {
	case RuntimeSelectionPolicySpecifiedRuntimeFirst,
		RuntimeSelectionPolicyIdleFirst,
		RuntimeSelectionPolicyIssueCreatorFirst:
		return true
	default:
		return false
	}
}

func resolveWorkflowRuntimeSelectionPolicy(
	workflow db.MulticaWorkflow,
	requestedPolicy string,
	runtimeID pgtype.UUID,
) (string, pgtype.UUID, error) {
	policy := strings.TrimSpace(requestedPolicy)
	if policy == "" {
		if runtimeID.Valid {
			policy = RuntimeSelectionPolicySpecifiedRuntimeFirst
		} else {
			policy = strings.TrimSpace(workflow.DefaultRuntimeSelectionPolicy)
			if policy == "" {
				policy = RuntimeSelectionPolicyIdleFirst
			}
			if policy == RuntimeSelectionPolicySpecifiedRuntimeFirst {
				runtimeID = workflow.DefaultRuntimeID
			}
		}
	}
	if !IsWorkflowRuntimeSelectionPolicy(policy) {
		return "", pgtype.UUID{}, fmt.Errorf("%w: invalid policy %s", ErrWorkflowRuntimeSelectionInvalid, policy)
	}
	if policy == RuntimeSelectionPolicySpecifiedRuntimeFirst {
		if !runtimeID.Valid {
			return "", pgtype.UUID{}, fmt.Errorf("%w: specified policy requires a runtime", ErrWorkflowRuntimeSelectionInvalid)
		}
		return policy, runtimeID, nil
	}
	return policy, pgtype.UUID{}, nil
}

type workflowRuntimeSelection struct {
	RuntimeID       pgtype.UUID
	Reason          string
	ActiveTaskCount int64
}

func (s *WorkflowService) selectWorkflowRuntime(
	ctx context.Context,
	qtx *db.Queries,
	run db.MulticaWorkflowRun,
	agent db.MulticaAgent,
) (workflowRuntimeSelection, error) {
	if agent.RuntimeID.Valid {
		return workflowRuntimeSelection{
			RuntimeID: agent.RuntimeID,
			Reason:    RuntimeSelectionAgentBinding,
		}, nil
	}
	if !agent.IsBuiltin {
		return workflowRuntimeSelection{}, fmt.Errorf("agent has no runtime")
	}

	candidates, err := qtx.ListWorkflowRuntimeCandidates(ctx, db.ListWorkflowRuntimeCandidatesParams{
		WorkspaceID:       run.WorkspaceID,
		StaleSeconds:      workflowRuntimeStaleSeconds,
		AuthorizerUserID:  run.RuntimeAuthorizerID,
		ResponsibleUserID: run.ResponsibleUserID,
	})
	if err != nil {
		return workflowRuntimeSelection{}, fmt.Errorf("list workflow runtime candidates: %w", err)
	}
	return chooseWorkflowRuntime(run, candidates)
}

func chooseWorkflowRuntime(
	run db.MulticaWorkflowRun,
	candidates []db.ListWorkflowRuntimeCandidatesRow,
) (workflowRuntimeSelection, error) {
	policy := run.RuntimeSelectionPolicy
	if policy == "" {
		if run.RuntimeID.Valid {
			policy = RuntimeSelectionPolicySpecifiedRuntimeFirst
		} else {
			policy = RuntimeSelectionPolicyIdleFirst
		}
	}
	if policy == RuntimeSelectionPolicySpecifiedRuntimeFirst && run.RuntimeID.Valid {
		for _, candidate := range candidates {
			if candidate.ID == run.RuntimeID {
				return workflowRuntimeSelection{
					RuntimeID:       candidate.ID,
					Reason:          RuntimeSelectionManual,
					ActiveTaskCount: candidate.ActiveTaskCount,
				}, nil
			}
		}
	}

	chooseIdle := func() (workflowRuntimeSelection, bool) {
		for _, candidate := range candidates {
			if candidate.ActiveTaskCount == 0 {
				return workflowRuntimeSelection{
					RuntimeID: candidate.ID,
					Reason:    RuntimeSelectionIdle,
				}, true
			}
		}
		return workflowRuntimeSelection{}, false
	}
	chooseIssueCreator := func() (workflowRuntimeSelection, bool) {
		if !run.ResponsibleUserID.Valid {
			return workflowRuntimeSelection{}, false
		}
		var selected *db.ListWorkflowRuntimeCandidatesRow
		for i := range candidates {
			candidate := &candidates[i]
			if !candidate.OwnerID.Valid || candidate.OwnerID != run.ResponsibleUserID {
				continue
			}
			if selected == nil || candidate.ActiveTaskCount < selected.ActiveTaskCount {
				selected = candidate
			}
		}
		if selected != nil {
			return workflowRuntimeSelection{
				RuntimeID:       selected.ID,
				Reason:          RuntimeSelectionIssueCreator,
				ActiveTaskCount: selected.ActiveTaskCount,
			}, true
		}
		return workflowRuntimeSelection{}, false
	}

	if policy == RuntimeSelectionPolicyIssueCreatorFirst {
		if selection, ok := chooseIssueCreator(); ok {
			return selection, nil
		}
		if selection, ok := chooseIdle(); ok {
			return selection, nil
		}
	} else {
		if selection, ok := chooseIdle(); ok {
			return selection, nil
		}
		if selection, ok := chooseIssueCreator(); ok {
			return selection, nil
		}
	}

	return workflowRuntimeSelection{}, ErrWorkflowRuntimeUnavailable
}

func (s *WorkflowService) resolveWorkflowAgent(
	ctx context.Context,
	qtx *db.Queries,
	node db.MulticaWorkflowNode,
	phase string,
) (db.MulticaAgent, error) {
	var agentID pgtype.UUID
	switch phase {
	case "worker", "split":
		agentID = node.WorkerID
		if node.WorkerType == "squad" && node.WorkerID.Valid {
			squad, err := qtx.GetSquad(ctx, node.WorkerID)
			if err != nil {
				return db.MulticaAgent{}, fmt.Errorf("get worker squad: %w", err)
			}
			agentID = squad.LeaderID
		}
	case "critic":
		agentID = node.CriticID
		if node.CriticType == "squad" && node.CriticID.Valid {
			squad, err := qtx.GetSquad(ctx, node.CriticID)
			if err != nil {
				return db.MulticaAgent{}, fmt.Errorf("get critic squad: %w", err)
			}
			agentID = squad.LeaderID
		}
	default:
		return db.MulticaAgent{}, fmt.Errorf("unknown phase: %s", phase)
	}
	if !agentID.Valid {
		return db.MulticaAgent{}, fmt.Errorf("no agent configured for %s phase", phase)
	}
	agent, err := qtx.GetAgent(ctx, agentID)
	if err != nil {
		return db.MulticaAgent{}, fmt.Errorf("get agent: %w", err)
	}
	return agent, nil
}

// DispatchAgentTask atomically selects a runtime, creates the task, and records
// the actual runtime on the node run. Caller-supplied contextExtras are merged
// into the task context payload (used by split callers to inject split state).
func (s *WorkflowService) DispatchAgentTask(
	ctx context.Context,
	nodeRun db.MulticaWorkflowNodeRun,
	phase string,
	contextExtras map[string]any,
) (*db.MulticaAgentTaskQueue, error) {
	var task db.MulticaAgentTaskQueue
	var selection workflowRuntimeSelection
	err := s.runInTx(ctx, func(qtx *db.Queries) error {
		freshNodeRun, err := qtx.GetWorkflowNodeRun(ctx, nodeRun.ID)
		if err != nil {
			return fmt.Errorf("get node run: %w", err)
		}
		node, err := qtx.GetWorkflowNode(ctx, freshNodeRun.WorkflowNodeID)
		if err != nil {
			return fmt.Errorf("get node: %w", err)
		}
		run, err := qtx.GetWorkflowRun(ctx, freshNodeRun.WorkflowRunID)
		if err != nil {
			return fmt.Errorf("get run: %w", err)
		}
		workflow, err := qtx.GetWorkflow(ctx, run.WorkflowID)
		if err != nil {
			return fmt.Errorf("get workflow: %w", err)
		}
		if s.TxStarter != nil {
			if _, err := qtx.AcquireWorkflowRuntimeSelectionLock(ctx, util.UUIDToString(run.WorkspaceID)); err != nil {
				return fmt.Errorf("acquire runtime selection lock: %w", err)
			}
		}
		run, err = qtx.GetWorkflowRun(ctx, freshNodeRun.WorkflowRunID)
		if err != nil {
			return fmt.Errorf("refresh workflow run: %w", err)
		}
		if run.Status != RunStatusRunning {
			return ErrWorkflowRunNotRunning
		}
		agent, err := s.resolveWorkflowAgent(ctx, qtx, node, phase)
		if err != nil {
			return err
		}
		selection, err = s.selectWorkflowRuntime(ctx, qtx, run, agent)
		if err != nil {
			return err
		}

		contextPayload := map[string]any{
			"type":                   "workflow",
			"workflow_id":            util.UUIDToString(workflow.ID),
			"workflow_title":         workflow.Title,
			"workflow_run_id":        util.UUIDToString(run.ID),
			"workflow_node_id":       util.UUIDToString(node.ID),
			"node_title":             node.Title,
			"node_run_id":            util.UUIDToString(freshNodeRun.ID),
			"phase":                  phase,
			"worker_can_await_input": phase == "worker",
		}
		for key, value := range contextExtras {
			contextPayload[key] = value
		}
		contextJSON, err := json.Marshal(contextPayload)
		if err != nil {
			return fmt.Errorf("marshal context: %w", err)
		}

		var issueID pgtype.UUID
		subIssue, err := qtx.GetIssueByOrigin(ctx, db.GetIssueByOriginParams{
			WorkspaceID: workflow.WorkspaceID,
			OriginType:  pgtype.Text{String: "workflow", Valid: true},
			OriginID:    freshNodeRun.ID,
		})
		if err == nil {
			issueID = subIssue.ID
		}

		var chatSessionID pgtype.UUID
		if rawChatSessionID, ok := contextExtras["chat_session_id"]; ok {
			if value, ok := rawChatSessionID.(string); ok && strings.TrimSpace(value) != "" {
				if parsed, err := util.ParseUUID(value); err == nil {
					chatSessionID = parsed
				} else {
					slog.Warn("workflow dispatch: invalid chat_session_id context extra", "node_run_id", util.UUIDToString(freshNodeRun.ID), "chat_session_id", value, "error", err)
				}
			}
		}

		task, err = qtx.CreateWorkflowAgentTask(ctx, db.CreateWorkflowAgentTaskParams{
			AgentID:           agent.ID,
			RuntimeID:         selection.RuntimeID,
			Priority:          2,
			Context:           contextJSON,
			WorkflowNodeRunID: freshNodeRun.ID,
			ChatSessionID:     chatSessionID,
			IssueID:           issueID,
		})
		if err != nil {
			return fmt.Errorf("create workflow agent task: %w", err)
		}

		reason := pgtype.Text{String: selection.Reason, Valid: true}
		switch phase {
		case "worker":
			_, err = qtx.LinkNodeRunWorkerTask(ctx, db.LinkNodeRunWorkerTaskParams{
				ID:                     freshNodeRun.ID,
				WorkerAgentTaskID:      task.ID,
				RuntimeID:              selection.RuntimeID,
				RuntimeSelectionReason: reason,
			})
		case "critic":
			_, err = qtx.LinkNodeRunCriticTask(ctx, db.LinkNodeRunCriticTaskParams{
				ID:                     freshNodeRun.ID,
				CriticAgentTaskID:      task.ID,
				RuntimeID:              selection.RuntimeID,
				RuntimeSelectionReason: reason,
			})
		}
		if err != nil {
			return fmt.Errorf("link %s task: %w", phase, err)
		}
		return nil
	})
	if errors.Is(err, ErrWorkflowRuntimeUnavailable) {
		if failErr := s.failWorkflowForRuntimeUnavailable(ctx, nodeRun); failErr != nil {
			return nil, fmt.Errorf("%w; fail workflow: %v", err, failErr)
		}
		return nil, err
	}
	if err != nil {
		return nil, err
	}

	slog.Info("selected runtime for workflow node",
		"workflow_node_run_id", util.UUIDToString(nodeRun.ID),
		"runtime_id", util.UUIDToString(selection.RuntimeID),
		"selection_reason", selection.Reason,
		"active_task_count", selection.ActiveTaskCount,
	)
	s.TaskSvc.NotifyTaskEnqueued(ctx, task)
	return &task, nil
}

// transitionNodeRunAfterDispatch prevents a status update from resurrecting a
// node that a concurrent fail-fast path has already cancelled.
func (s *WorkflowService) transitionNodeRunAfterDispatch(
	ctx context.Context,
	nodeRunID pgtype.UUID,
	newStatus string,
) error {
	var updated db.MulticaWorkflowNodeRun
	err := s.runInTx(ctx, func(qtx *db.Queries) error {
		freshNodeRun, err := qtx.GetWorkflowNodeRun(ctx, nodeRunID)
		if err != nil {
			return fmt.Errorf("get node run: %w", err)
		}
		run, err := qtx.GetWorkflowRun(ctx, freshNodeRun.WorkflowRunID)
		if err != nil {
			return fmt.Errorf("get workflow run: %w", err)
		}
		if s.TxStarter != nil {
			if _, err := qtx.AcquireWorkflowRuntimeSelectionLock(ctx, util.UUIDToString(run.WorkspaceID)); err != nil {
				return fmt.Errorf("acquire runtime selection lock: %w", err)
			}
		}
		run, err = qtx.GetWorkflowRun(ctx, freshNodeRun.WorkflowRunID)
		if err != nil {
			return fmt.Errorf("refresh workflow run: %w", err)
		}
		if run.Status != RunStatusRunning {
			return ErrWorkflowRunNotRunning
		}
		if !isValidTransition(freshNodeRun.Status, newStatus) {
			return fmt.Errorf("invalid transition: %s → %s", freshNodeRun.Status, newStatus)
		}
		updated, err = qtx.UpdateWorkflowNodeRunStatus(ctx, db.UpdateWorkflowNodeRunStatusParams{
			ID:     freshNodeRun.ID,
			Status: newStatus,
		})
		return err
	})
	if err != nil {
		return err
	}
	if s.OnNodeStatusChanged != nil {
		s.OnNodeStatusChanged(ctx, updated)
	}
	return nil
}

func (s *WorkflowService) failWorkflowForRuntimeUnavailable(
	ctx context.Context,
	nodeRun db.MulticaWorkflowNodeRun,
) error {
	var failedNode db.MulticaWorkflowNodeRun
	var failedRun db.MulticaWorkflowRun
	var cancelled []db.MulticaAgentTaskQueue
	if err := s.runInTx(ctx, func(qtx *db.Queries) error {
		var err error
		run, err := qtx.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
		if err != nil {
			return fmt.Errorf("get workflow run: %w", err)
		}
		if s.TxStarter != nil {
			if _, err := qtx.AcquireWorkflowRuntimeSelectionLock(ctx, util.UUIDToString(run.WorkspaceID)); err != nil {
				return fmt.Errorf("acquire runtime selection lock: %w", err)
			}
		}
		run, err = qtx.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
		if err != nil {
			return fmt.Errorf("refresh workflow run: %w", err)
		}
		if run.Status != RunStatusRunning {
			return ErrWorkflowRunNotRunning
		}
		failedNode, err = qtx.FailWorkflowNodeRunForRuntime(ctx, nodeRun.ID)
		if err != nil {
			return fmt.Errorf("fail node run: %w", err)
		}
		if err := qtx.CancelWorkflowNodeRuns(ctx, failedNode.WorkflowRunID); err != nil {
			return fmt.Errorf("cancel sibling node runs: %w", err)
		}
		cancelled, err = qtx.CancelWorkflowTasksByRun(ctx, failedNode.WorkflowRunID)
		if err != nil {
			return fmt.Errorf("cancel workflow tasks: %w", err)
		}
		failedRun, err = qtx.FailWorkflowRun(ctx, failedNode.WorkflowRunID)
		if err != nil {
			return fmt.Errorf("fail workflow run: %w", err)
		}
		return nil
	}); err != nil {
		if errors.Is(err, ErrWorkflowRunNotRunning) {
			return nil
		}
		return err
	}

	if s.OnNodeStatusChanged != nil {
		s.OnNodeStatusChanged(ctx, failedNode)
	}
	if s.TaskSvc != nil {
		s.TaskSvc.BroadcastCancelledTasks(ctx, cancelled)
	}
	s.publishWorkflowEvent(EventWorkflowNodeRunFailed, util.UUIDToString(failedRun.WorkspaceID), map[string]any{
		"run_id":      util.UUIDToString(failedRun.ID),
		"node_run_id": util.UUIDToString(failedNode.ID),
		"reason":      "runtime_unavailable",
	})
	s.publishWorkflowEvent(EventWorkflowRunFailed, util.UUIDToString(failedRun.WorkspaceID), map[string]any{
		"run_id":      util.UUIDToString(failedRun.ID),
		"workflow_id": util.UUIDToString(failedRun.WorkflowID),
		"reason":      "runtime_unavailable",
	})
	if s.OnRunTerminal != nil {
		s.OnRunTerminal(ctx, failedRun, RunStatusFailed)
	}
	return nil
}

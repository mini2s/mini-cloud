package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/gitea"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

const (
	NodeRunStatusSplitting           = "splitting"
	NodeRunStatusAwaitingSplitReview = "awaiting_split_review"
	NodeRunStatusMaterializing       = "materializing"
	NodeRunStatusSplitActive         = "split_active"

	SplitModeBarrier  = "barrier"
	SplitModePipeline = "pipeline"

	SplitTaskStatusDiscarded = "discarded"
	SplitTaskStatusCreated   = "created"
	SplitTaskStatusRunning   = "running"
	SplitTaskStatusDone      = "done"
	SplitTaskStatusFailed    = "failed"
	SplitTaskStatusCancelled = "cancelled"
	SplitTaskStatusSkipped   = "skipped"

	SplitDeliverablePurpose       = "split_task_plan"
	SplitGenerationSplitting      = "splitting"
	SplitGenerationAwaitingReview = "awaiting_review"
	SplitGenerationMaterializing  = "materializing"
	SplitGenerationActive         = "active"
	SplitGenerationFailed         = "failed"
	SplitGenerationCancelled      = "cancelled"
	SplitGenerationSuperseded     = "superseded"
)

var ErrSplitReviewerUnresolved = errors.New("split reviewer role did not resolve to an active workspace member")

const maxSplitRecoveryAttachmentBytes = 2 << 20
const maxSplitReviewedContentRunes = 12000

func splitReviewedContentExcerpt(content string) string {
	runes := []rune(content)
	if len(runes) > maxSplitReviewedContentRunes {
		runes = runes[:maxSplitReviewedContentRunes]
	}
	return string(runes)
}

type SplitErrorStatus string

const (
	SplitErrorBadRequest    SplitErrorStatus = "bad_request"
	SplitErrorConflict      SplitErrorStatus = "conflict"
	SplitErrorForbidden     SplitErrorStatus = "forbidden"
	SplitErrorUnprocessable SplitErrorStatus = "unprocessable"
	SplitErrorUpstream      SplitErrorStatus = "upstream"
)

type SplitAPIError struct {
	Status                 SplitErrorStatus
	Code                   string
	Err                    error
	Details                []SplitValidationDetail
	CurrentSplitGeneration int32
	CurrentSubmissionID    string
}

func (e *SplitAPIError) Error() string { return e.Err.Error() }
func (e *SplitAPIError) Unwrap() error { return e.Err }

func NewSplitAPIError(status SplitErrorStatus, code string, err error) error {
	return &SplitAPIError{Status: status, Code: code, Err: err}
}

func NewSplitValidationAPIError(code string, err error, details []SplitValidationDetail) error {
	return &SplitAPIError{Status: SplitErrorUnprocessable, Code: code, Err: err, Details: details}
}

// Split task context phases.
const (
	splitPhaseGenerate = "split_generate"
)

type SplitConfig struct {
	Mode           string `json:"mode"`
	MaxConcurrency int32  `json:"max_concurrency"`
	MaxFailures    int32  `json:"max_failures"`
}

type SplitApproveRequest struct {
	ExpectedSplitGeneration int32  `json:"expected_split_generation"`
	ExpectedSubmissionID    string `json:"expected_submission_id"`
	ReviewComment           string `json:"review_comment,omitempty"`
}

type SplitOrchestrator struct {
	Queries     *db.Queries
	TxStarter   TxStarter
	WfService   *WorkflowService
	Assignments *IssueAssignmentService
	Bus         *events.Bus

	// OnChildIssueStatusChanged fires after a split child issue's status is
	// changed by the orchestrator (currently: cancellation via
	// CancelSplitNode), so the handler layer can broadcast issue:updated —
	// inbox notifications, the activity log, and frontend cache invalidation
	// all hang off that event.
	OnChildIssueStatusChanged func(ctx context.Context, prev, issue db.MulticaIssue)
}

// splitIssueStatusChange records one child-issue status transition performed
// inside CancelSplitNode's per-task transactions, for post-commit broadcast.
type splitIssueStatusChange struct {
	prev  db.MulticaIssue
	issue db.MulticaIssue
}

type SplitLifecycleEventPayload struct {
	WorkflowNodeRunID   string `json:"workflow_node_run_id"`
	WorkflowRunID       string `json:"workflow_run_id"`
	AgentTaskID         string `json:"agent_task_id,omitempty"`
	PlannerAgentID      string `json:"planner_agent_id,omitempty"`
	ElapsedMS           int64  `json:"elapsed_ms,omitempty"`
	SplitTaskID         string `json:"split_task_id,omitempty"`
	ChildIssueID        string `json:"child_issue_id,omitempty"`
	Error               string `json:"error,omitempty"`
	SplitPlanGeneration int32  `json:"split_plan_generation,omitempty"`
}

func NewSplitOrchestrator(
	q *db.Queries,
	tx TxStarter,
	wfSvc *WorkflowService,
	assignments *IssueAssignmentService,
	bus *events.Bus,
) *SplitOrchestrator {
	return &SplitOrchestrator{
		Queries:     q,
		TxStarter:   tx,
		WfService:   wfSvc,
		Assignments: assignments,
		Bus:         bus,
	}
}

func (s *SplitOrchestrator) publishSplitEvent(
	eventType string,
	run db.MulticaWorkflowRun,
	nodeRun db.MulticaWorkflowNodeRun,
	payload SplitLifecycleEventPayload,
) {
	if s.Bus == nil {
		return
	}
	payload.WorkflowNodeRunID = util.UUIDToString(nodeRun.ID)
	payload.WorkflowRunID = util.UUIDToString(nodeRun.WorkflowRunID)
	if payload.PlannerAgentID == "" && nodeRun.WorkerID.Valid {
		payload.PlannerAgentID = util.UUIDToString(nodeRun.WorkerID)
	}
	if nodeRun.StartedAt.Valid {
		payload.ElapsedMS = max(0, time.Since(nodeRun.StartedAt.Time).Milliseconds())
	}
	s.Bus.Publish(events.Event{
		Type:        eventType,
		WorkspaceID: util.UUIDToString(run.WorkspaceID),
		ActorType:   "system",
		Payload:     payload,
	})
}

func (s *SplitOrchestrator) runInTx(ctx context.Context, fn func(*db.Queries) error) error {
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

type splitTaskPlan struct {
	ID                 string
	DependsOn          []string
	SortOrder          int
	Status             string
	OperationalFailure bool
}

type splitNodeFormat struct {
	Type        string      `json:"type"`
	SplitConfig SplitConfig `json:"split_config"`
}

func validateSplitTaskGraph(tasks []splitTaskPlan) error {
	byID := make(map[string]splitTaskPlan, len(tasks))
	for _, task := range tasks {
		if task.ID == "" {
			return fmt.Errorf("split task has empty id")
		}
		if _, ok := byID[task.ID]; ok {
			return fmt.Errorf("duplicate split task id: %s", task.ID)
		}
		byID[task.ID] = task
	}

	for _, task := range tasks {
		for _, depID := range task.DependsOn {
			if depID == task.ID {
				return fmt.Errorf("cycle detected at split task %s", task.ID)
			}
			if _, ok := byID[depID]; !ok {
				return fmt.Errorf("unknown dependency %s for split task %s", depID, task.ID)
			}
		}
	}

	color := make(map[string]int, len(tasks))
	var visit func(string) error
	visit = func(id string) error {
		switch color[id] {
		case 1:
			return fmt.Errorf("cycle detected at split task %s", id)
		case 2:
			return nil
		}
		color[id] = 1
		for _, depID := range byID[id].DependsOn {
			if err := visit(depID); err != nil {
				return err
			}
		}
		color[id] = 2
		return nil
	}
	for _, task := range tasks {
		if err := visit(task.ID); err != nil {
			return err
		}
	}
	return nil
}

func topologicalSplitTaskIDs(tasks []splitTaskPlan) ([]string, error) {
	if err := validateSplitTaskGraph(tasks); err != nil {
		return nil, err
	}

	byID := make(map[string]splitTaskPlan, len(tasks))
	dependents := make(map[string][]string, len(tasks))
	indegree := make(map[string]int, len(tasks))
	for _, task := range tasks {
		byID[task.ID] = task
		indegree[task.ID] = len(task.DependsOn)
		for _, depID := range task.DependsOn {
			dependents[depID] = append(dependents[depID], task.ID)
		}
	}

	ready := make([]string, 0, len(tasks))
	for _, task := range tasks {
		if indegree[task.ID] == 0 {
			ready = append(ready, task.ID)
		}
	}

	ordered := make([]string, 0, len(tasks))
	for len(ready) > 0 {
		sortSplitTaskIDs(ready, byID)
		id := ready[0]
		ready = ready[1:]
		ordered = append(ordered, id)

		for _, childID := range dependents[id] {
			indegree[childID]--
			if indegree[childID] == 0 {
				ready = append(ready, childID)
			}
		}
	}

	if len(ordered) != len(tasks) {
		return nil, fmt.Errorf("cycle detected in split task graph")
	}
	return ordered, nil
}

func readySplitTaskIDs(tasks []splitTaskPlan, maxConcurrency int) ([]string, error) {
	if maxConcurrency < 1 {
		maxConcurrency = 1
	}
	if err := validateSplitTaskGraph(tasks); err != nil {
		return nil, err
	}

	byID := make(map[string]splitTaskPlan, len(tasks))
	activeTasks := 0
	for _, task := range tasks {
		byID[task.ID] = task
		if task.Status == SplitTaskStatusRunning {
			activeTasks++
		}
	}
	remainingSlots := maxConcurrency - activeTasks
	if remainingSlots <= 0 {
		return []string{}, nil
	}

	ordered, err := topologicalSplitTaskIDs(tasks)
	if err != nil {
		return nil, err
	}
	ready := make([]string, 0, remainingSlots)
	for _, id := range ordered {
		task := byID[id]
		if task.Status != SplitTaskStatusCreated {
			continue
		}
		allDone := true
		for _, depID := range task.DependsOn {
			if byID[depID].Status != SplitTaskStatusDone {
				allDone = false
				break
			}
		}
		if !allDone {
			continue
		}
		ready = append(ready, id)
		if len(ready) == remainingSlots {
			break
		}
	}
	return ready, nil
}

func markBlockedSplitTasksSkipped(tasks []splitTaskPlan) []splitTaskPlan {
	next := make([]splitTaskPlan, len(tasks))
	copy(next, tasks)

	for {
		changed := false
		byID := make(map[string]splitTaskPlan, len(next))
		for _, task := range next {
			byID[task.ID] = task
		}
		for i, task := range next {
			if task.Status != SplitTaskStatusCreated {
				continue
			}
			for _, depID := range task.DependsOn {
				dependency := byID[depID]
				switch dependency.Status {
				case SplitTaskStatusFailed, SplitTaskStatusCancelled, SplitTaskStatusSkipped:
					if dependency.OperationalFailure {
						continue
					}
					next[i].Status = SplitTaskStatusSkipped
					changed = true
				}
			}
		}
		if !changed {
			return next
		}
	}
}

func resolveSplitStatus(mode string, maxFailures int, tasks []splitTaskPlan) string {
	for _, task := range tasks {
		if task.OperationalFailure {
			return NodeRunStatusBlocked
		}
	}
	switch mode {
	case SplitModePipeline:
		failures := 0
		for _, task := range tasks {
			switch task.Status {
			case SplitTaskStatusFailed:
				failures++
			case SplitTaskStatusDone, SplitTaskStatusCancelled, SplitTaskStatusSkipped, SplitTaskStatusDiscarded:
				continue
			default:
				return NodeRunStatusSplitActive
			}
		}
		if failures > maxFailures {
			return NodeRunStatusFailed
		}
		return NodeRunStatusCompleted
	default:
		failures := 0
		for _, task := range tasks {
			switch task.Status {
			case SplitTaskStatusFailed, SplitTaskStatusCancelled, SplitTaskStatusSkipped:
				failures++
			case SplitTaskStatusDone, SplitTaskStatusDiscarded:
				continue
			default:
				return NodeRunStatusSplitActive
			}
		}
		if failures > maxFailures {
			return NodeRunStatusFailed
		}
		return NodeRunStatusCompleted
	}
}

func resolveSettledSplitStatus(mode string, maxFailures int, tasks []splitTaskPlan) ([]splitTaskPlan, string) {
	settled := markBlockedSplitTasksSkipped(tasks)
	return settled, resolveSplitStatus(mode, maxFailures, settled)
}

func sortSplitTaskIDs(ids []string, byID map[string]splitTaskPlan) {
	sort.SliceStable(ids, func(i, j int) bool {
		left := byID[ids[i]]
		right := byID[ids[j]]
		if left.SortOrder != right.SortOrder {
			return left.SortOrder < right.SortOrder
		}
		return left.ID < right.ID
	})
}

func parseSplitConfig(raw []byte) (SplitConfig, error) {
	var format splitNodeFormat
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &format); err != nil {
			return SplitConfig{}, err
		}
	}
	cfg := format.SplitConfig
	if cfg.Mode == "" {
		cfg.Mode = SplitModeBarrier
	}
	if cfg.MaxConcurrency < 1 {
		cfg.MaxConcurrency = 5
	}
	if cfg.MaxFailures < 0 {
		cfg.MaxFailures = 0
	}
	return cfg, nil
}

func workflowNodeType(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	var format struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &format); err != nil {
		return ""
	}
	return format.Type
}

func splitRunNodeConfig(ctx context.Context, q *db.Queries, nodeRun db.MulticaWorkflowNodeRun) (RunNodeConfig, SplitConfig, error) {
	runtimeNode, err := (WorkflowRuntimeRepository{Queries: q}).GetRunNodeConfig(ctx, nodeRun.ID)
	if err != nil {
		return RunNodeConfig{}, SplitConfig{}, err
	}
	if workflowNodeType(runtimeNode.FormatSchema) != "split" {
		return RunNodeConfig{}, SplitConfig{}, errors.New("node run is not a split node")
	}
	cfg, err := parseSplitConfig(runtimeNode.RuntimeConfig)
	if err != nil {
		return RunNodeConfig{}, SplitConfig{}, err
	}
	return runtimeNode, cfg, nil
}

func resolveSplitReviewerWithQueries(ctx context.Context, q *db.Queries, nodeRun db.MulticaWorkflowNodeRun) (pgtype.UUID, error) {
	if nodeRun.CriticType != "human" || !nodeRun.CriticID.Valid {
		return pgtype.UUID{}, ErrSplitReviewerUnresolved
	}
	run, err := q.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		return pgtype.UUID{}, err
	}
	member, err := q.GetMemberByUserAndWorkspace(ctx, db.GetMemberByUserAndWorkspaceParams{
		UserID:      nodeRun.CriticID,
		WorkspaceID: run.WorkspaceID,
	})
	if err != nil || member.Status != "active" {
		return pgtype.UUID{}, ErrSplitReviewerUnresolved
	}
	return nodeRun.CriticID, nil
}

func (s *SplitOrchestrator) resolveSplitReviewer(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) (pgtype.UUID, error) {
	return resolveSplitReviewerWithQueries(ctx, s.Queries, nodeRun)
}

func (s *SplitOrchestrator) RequireSplitReviewer(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, actorUserID pgtype.UUID) error {
	reviewerID, err := s.resolveSplitReviewer(ctx, nodeRun)
	if err != nil {
		return err
	}
	if reviewerID != actorUserID {
		return NewSplitAPIError(SplitErrorForbidden, "split_reviewer_required", errors.New("only the split reviewer may change or approve drafts"))
	}
	return nil
}

func (s *SplitOrchestrator) ensureSplitReviewerResolved(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) (bool, error) {
	if _, err := s.resolveSplitReviewer(ctx, nodeRun); err == nil {
		return true, nil
	} else if !errors.Is(err, ErrSplitReviewerUnresolved) {
		return false, err
	}

	updated, err := s.Queries.BlockSplitNodeRunForReviewerResolution(ctx, nodeRun.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		current, loadErr := s.Queries.GetWorkflowNodeRun(ctx, nodeRun.ID)
		if loadErr == nil && current.Status == NodeRunStatusBlocked {
			return false, nil
		}
		return false, err
	}
	if err != nil {
		return false, err
	}
	if s.WfService != nil && s.WfService.OnNodeStatusChanged != nil {
		s.WfService.OnNodeStatusChanged(ctx, updated)
	}
	return false, nil
}

func splitTaskPlansFromRows(tasks []db.MulticaWorkflowSplitTask) ([]splitTaskPlan, error) {
	plans := make([]splitTaskPlan, 0, len(tasks))
	for _, task := range tasks {
		var dependsOn []string
		if len(task.DependsOn) > 0 {
			if err := json.Unmarshal(task.DependsOn, &dependsOn); err != nil {
				return nil, fmt.Errorf("parse depends_on for split task %s: %w", util.UUIDToString(task.ID), err)
			}
		}
		plans = append(plans, splitTaskPlan{
			ID:                 util.UUIDToString(task.ID),
			DependsOn:          dependsOn,
			SortOrder:          int(task.SortOrder),
			Status:             task.Status,
			OperationalFailure: isSplitOperationalFailure(task),
		})
	}
	return plans, nil
}

func isSplitOperationalFailure(task db.MulticaWorkflowSplitTask) bool {
	if task.Status != SplitTaskStatusFailed {
		return false
	}
	// A failed row without a child issue exhausted task materialization. This
	// is an operational creation failure, not a child execution result.
	if !task.IssueID.Valid {
		return true
	}
	var failure struct {
		Code string `json:"code"`
	}
	if len(task.LastError) == 0 || json.Unmarshal(task.LastError, &failure) != nil {
		return false
	}
	switch failure.Code {
	case "split_assignee_invalidated", "split_child_dispatch_failed":
		return true
	default:
		return false
	}
}

func splitTaskMap(tasks []db.MulticaWorkflowSplitTask) map[string]db.MulticaWorkflowSplitTask {
	byID := make(map[string]db.MulticaWorkflowSplitTask, len(tasks))
	for _, task := range tasks {
		byID[util.UUIDToString(task.ID)] = task
	}
	return byID
}

func splitTaskDispatchLockKey(taskID pgtype.UUID) string {
	return "split-task-dispatch:" + util.UUIDToString(taskID)
}

func isTerminalSplitTaskStatus(status string) bool {
	switch status {
	case SplitTaskStatusDone, SplitTaskStatusFailed, SplitTaskStatusCancelled, SplitTaskStatusSkipped, SplitTaskStatusDiscarded:
		return true
	default:
		return false
	}
}

func isTerminalWorkflowRunStatus(status string) bool {
	switch status {
	case RunStatusCompleted, RunStatusFailed, RunStatusCancelled:
		return true
	default:
		return false
	}
}

func canCancelSplitNodeStatus(status string) bool {
	switch status {
	case NodeRunStatusPending,
		NodeRunStatusFormatChecking,
		NodeRunStatusFormatOk,
		NodeRunStatusWorkerAssigned,
		NodeRunStatusWorking,
		NodeRunStatusAwaitingInput,
		NodeRunStatusAwaitingCritic,
		NodeRunStatusCriticReviewing,
		NodeRunStatusBlocked,
		NodeRunStatusSplitting,
		NodeRunStatusAwaitingSplitReview,
		NodeRunStatusMaterializing,
		NodeRunStatusSplitActive:
		return true
	default:
		return false
	}
}

func (s *SplitOrchestrator) HandleNodeRunStatusChanged(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) error {
	if nodeRun.Status == NodeRunStatusCancelled {
		if workflowNodeType(nodeRun.FormatSchema) != "split" {
			return nil
		}
		_, _, err := splitRunNodeConfig(ctx, s.Queries, nodeRun)
		if err != nil {
			return err
		}
		run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
		if err != nil {
			return err
		}
		_, err = s.CancelSplitNode(ctx, nodeRun, run.WorkspaceID)
		return err
	}

	// Generation-bound split planning is dispatched exclusively by the
	// workflow dispatch worker. A status callback must never start or recover
	// the retired draft-based planner path.
	return nil
}

func (s *SplitOrchestrator) GenerateSplitTasksForDispatch(
	ctx context.Context,
	nodeRun db.MulticaWorkflowNodeRun,
	dispatchJobID pgtype.UUID,
) error {
	job, err := s.Queries.GetWorkflowDispatchJob(ctx, dispatchJobID)
	if err != nil {
		return fmt.Errorf("get split dispatch job: %w", err)
	}
	if job.Phase != "split" || !job.SplitPlanGeneration.Valid {
		return fmt.Errorf("dispatch job is not generation-bound split work")
	}
	if nodeRun.SplitPlanGeneration != job.SplitPlanGeneration.Int32 || nodeRun.Status != NodeRunStatusSplitting {
		return nil
	}
	generation, err := s.Queries.GetWorkflowSplitGeneration(ctx, db.GetWorkflowSplitGenerationParams{
		NodeRunID: nodeRun.ID, Generation: job.SplitPlanGeneration.Int32,
	})
	if err != nil {
		return fmt.Errorf("get split plan generation: %w", err)
	}
	if generation.Status != SplitGenerationSplitting {
		return nil
	}
	return s.dispatchSplitPlanGeneration(ctx, nodeRun, generation, dispatchJobID)
}

func (s *SplitOrchestrator) dispatchSplitPlanGeneration(
	ctx context.Context,
	nodeRun db.MulticaWorkflowNodeRun,
	generation db.MulticaWorkflowSplitGeneration,
	dispatchJobID pgtype.UUID,
) error {
	run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		return fmt.Errorf("get workflow run for split generation: %w", err)
	}
	if run.Status != RunStatusRunning {
		return ErrWorkflowRunNotRunning
	}
	_, cfg, err := splitRunNodeConfig(ctx, s.Queries, nodeRun)
	if err != nil {
		return err
	}
	parentIssue, err := s.findParentIssue(ctx, nodeRun)
	if err != nil {
		return fmt.Errorf("find parent issue: %w", err)
	}
	members, err := s.Queries.ListActiveWorkflowRoleCandidateMembers(ctx, run.WorkspaceID)
	if err != nil {
		return fmt.Errorf("list split assignee candidates: %w", err)
	}
	workspaceMembers := make([]map[string]string, 0, min(len(members), 200))
	for index, member := range members {
		if index == 200 {
			break
		}
		workspaceMembers = append(workspaceMembers, map[string]string{
			"member_id":    util.UUIDToString(member.MemberID),
			"display_name": strings.TrimSpace(member.DisplayName),
			"email":        strings.TrimSpace(member.Email),
		})
	}
	contextExtras := map[string]any{
		"phase":                       splitPhaseGenerate,
		"parent_issue_id":             util.UUIDToString(parentIssue.ID),
		"parent_issue_title":          parentIssue.Title,
		"parent_issue_description":    textToString(parentIssue.Description),
		"split_config":                cfg,
		"split_plan_generation":       generation.Generation,
		"split_deliverable_id":        util.UUIDToString(generation.DeliverableID),
		"workspace_members":           workspaceMembers,
		"workspace_members_truncated": len(members) > len(workspaceMembers),
	}
	if generation.ReviewComment != "" {
		topo, err := RunNodeTopoOrder(ctx, s.Queries, run.ID)
		if err != nil {
			return fmt.Errorf("get split node topological order: %w", err)
		}
		reviewTaskPath := gitea.DeliverablePath(topo[util.UUIDToString(nodeRun.ID)], nodeRun.NodeTitle, util.UUIDToString(nodeRun.ID), "task")
		contextExtras["review_comment"] = generation.ReviewComment
		contextExtras["reviewed_content"] = splitReviewedContentExcerpt(generation.ReviewedContent)
		contextExtras["review_head_commit_sha"] = generation.ReviewHeadCommitSha
		contextExtras["review_task_path"] = reviewTaskPath
	}
	task, err := s.WfService.dispatchAgentTask(ctx, nodeRun, "split", contextExtras, dispatchJobID)
	if err != nil {
		return fmt.Errorf("dispatch split generation task: %w", err)
	}
	if err := s.runInTx(ctx, func(qtx *db.Queries) error {
		lockedGeneration, err := qtx.GetWorkflowSplitGenerationForUpdate(ctx, db.GetWorkflowSplitGenerationForUpdateParams{
			NodeRunID: nodeRun.ID, Generation: generation.Generation,
		})
		if err != nil {
			return err
		}
		if lockedGeneration.Status != SplitGenerationSplitting || lockedGeneration.PlannerTaskID.Valid {
			return nil
		}
		if _, err := qtx.BindWorkflowSplitGenerationPlannerTask(ctx, db.BindWorkflowSplitGenerationPlannerTaskParams{
			NodeRunID: nodeRun.ID, Generation: generation.Generation, PlannerTaskID: task.ID,
		}); err != nil {
			return err
		}
		_, err = qtx.LinkNodeRunAgentTask(ctx, db.LinkNodeRunAgentTaskParams{ID: nodeRun.ID, AgentTaskID: task.ID})
		return err
	}); err != nil {
		return fmt.Errorf("bind split generation planner task: %w", err)
	}
	s.publishSplitEvent(protocol.EventSplitGenerationDispatched, run, nodeRun, SplitLifecycleEventPayload{
		AgentTaskID: util.UUIDToString(task.ID), SplitPlanGeneration: generation.Generation,
	})
	return nil
}

func (s *SplitOrchestrator) PatchSplitConfig(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, maxConcurrency int32, expectedConfigVersion int64) error {
	if maxConcurrency < 1 || maxConcurrency > 50 {
		return NewSplitAPIError(SplitErrorBadRequest, "invalid_split_request", errors.New("max_concurrency must be between 1 and 50"))
	}
	if expectedConfigVersion < 1 {
		return NewSplitAPIError(SplitErrorBadRequest, "invalid_split_request", errors.New("expected_config_version is required"))
	}
	var shouldSchedule bool
	if err := s.runInTx(ctx, func(qtx *db.Queries) error {
		lockedNodeRun, err := qtx.GetWorkflowNodeRunForUpdate(ctx, nodeRun.ID)
		if err != nil {
			return fmt.Errorf("lock split node run: %w", err)
		}
		switch lockedNodeRun.Status {
		case NodeRunStatusAwaitingSplitReview, NodeRunStatusSplitActive:
		default:
			return NewSplitAPIError(SplitErrorBadRequest, "invalid_split_request", errors.New("split config cannot be patched from current status"))
		}

		cfg, err := parseSplitConfig(lockedNodeRun.RuntimeConfig)
		if err != nil {
			return err
		}
		cfg.MaxConcurrency = maxConcurrency

		var runtimeConfig map[string]any
		if len(lockedNodeRun.RuntimeConfig) > 0 {
			if err := json.Unmarshal(lockedNodeRun.RuntimeConfig, &runtimeConfig); err != nil {
				return fmt.Errorf("parse split node runtime config: %w", err)
			}
		}
		if runtimeConfig == nil {
			runtimeConfig = make(map[string]any)
		}
		runtimeConfig["split_config"] = cfg
		nextRuntimeConfig, err := json.Marshal(runtimeConfig)
		if err != nil {
			return fmt.Errorf("marshal split node runtime config: %w", err)
		}
		if _, err := qtx.UpdateNodeRunRuntimeConfig(ctx, db.UpdateNodeRunRuntimeConfigParams{
			ID: lockedNodeRun.ID, RuntimeConfig: nextRuntimeConfig,
			SplitConfigVersion: expectedConfigVersion,
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return NewSplitAPIError(SplitErrorConflict, "split_config_conflict", errors.New("split config version conflict"))
			}
			return fmt.Errorf("update split config version: %w", err)
		}
		shouldSchedule = lockedNodeRun.Status == NodeRunStatusSplitActive
		return nil
	}); err != nil {
		return err
	}
	if shouldSchedule {
		if err := s.ScheduleReadyTasks(ctx, nodeRun.ID); err != nil {
			return err
		}
	}
	return nil
}

func (s *SplitOrchestrator) HandleTaskCompletion(ctx context.Context, task db.MulticaAgentTaskQueue) error {
	if !task.WorkflowNodeRunID.Valid || !isSplitGeneratePhase(task.Context) {
		return nil
	}
	var taskContext splitPlannerTaskContext
	if err := json.Unmarshal(task.Context, &taskContext); err != nil || taskContext.SplitPlanGeneration < 1 {
		return nil
	}
	var nodeRun db.MulticaWorkflowNodeRun
	shouldFail := false
	err := s.runInTx(ctx, func(qtx *db.Queries) error {
		var err error
		nodeRun, err = qtx.GetWorkflowNodeRunForUpdate(ctx, task.WorkflowNodeRunID)
		if err != nil {
			return fmt.Errorf("lock split node run: %w", err)
		}
		if nodeRun.SplitPlanGeneration != taskContext.SplitPlanGeneration || nodeRun.Status != NodeRunStatusSplitting {
			return nil
		}
		generation, err := qtx.GetWorkflowSplitGenerationForUpdate(ctx, db.GetWorkflowSplitGenerationForUpdateParams{
			NodeRunID: nodeRun.ID, Generation: taskContext.SplitPlanGeneration,
		})
		if err != nil {
			return fmt.Errorf("lock split generation: %w", err)
		}
		lockedTask, err := qtx.GetAgentTaskForUpdate(ctx, task.ID)
		if err != nil {
			return fmt.Errorf("lock split planner task: %w", err)
		}
		if !generation.PlannerTaskID.Valid || generation.PlannerTaskID != lockedTask.ID || generation.Status != SplitGenerationSplitting || generation.SubmissionID.Valid {
			return nil
		}
		if _, err := qtx.UpdateWorkflowSplitGenerationStatus(ctx, db.UpdateWorkflowSplitGenerationStatusParams{
			NodeRunID: nodeRun.ID, Generation: generation.Generation, Status: SplitGenerationFailed,
		}); err != nil {
			return fmt.Errorf("fail split generation without submission: %w", err)
		}
		shouldFail = true
		return nil
	})
	if err != nil || !shouldFail {
		return err
	}
	return s.WfService.failWorkflowFromNode(ctx, nodeRun, NodeRunStatusFailed, "split_plan_not_submitted")
}

func ensureSplitChildIssueAssignee(
	ctx context.Context,
	q *db.Queries,
	task db.MulticaWorkflowSplitTask,
	issue db.MulticaIssue,
) (db.MulticaIssue, error) {
	if !task.AssigneeType.Valid || !task.AssigneeID.Valid {
		return db.MulticaIssue{}, errors.New("split task is missing assignee")
	}
	if issue.AssigneeType.Valid || issue.AssigneeID.Valid {
		if issue.AssigneeType == task.AssigneeType && issue.AssigneeID == task.AssigneeID {
			return issue, nil
		}
		return db.MulticaIssue{}, errors.New("split child issue was assigned outside the scheduler")
	}
	assigned, err := q.AssignSplitChildIssueIfUnassigned(ctx, db.AssignSplitChildIssueIfUnassignedParams{
		ID:           issue.ID,
		AssigneeType: task.AssigneeType,
		AssigneeID:   task.AssigneeID,
	})
	if err != nil {
		return db.MulticaIssue{}, fmt.Errorf("assign split child issue: %w", err)
	}
	return assigned, nil
}

func (s *SplitOrchestrator) CancelSplitNode(
	ctx context.Context,
	nodeRun db.MulticaWorkflowNodeRun,
	workspaceID pgtype.UUID,
) (*db.MulticaWorkflowNodeRun, error) {
	currentNode, err := s.Queries.GetWorkflowNodeRun(ctx, nodeRun.ID)
	if err != nil {
		return nil, fmt.Errorf("load split node: %w", err)
	}
	if currentNode.Status != NodeRunStatusCancelled {
		if !canCancelSplitNodeStatus(currentNode.Status) {
			return nil, fmt.Errorf("split node cannot be cancelled from current status")
		}
		fenced, fenceErr := s.WfService.TransitionNodeRun(ctx, currentNode, NodeRunStatusCancelled)
		if fenceErr != nil {
			return nil, fenceErr
		}
		currentNode = *fenced
	}
	tasks, err := s.Queries.ListSplitTasksByGeneration(ctx, db.ListSplitTasksByGenerationParams{
		NodeRunID:           currentNode.ID,
		SplitPlanGeneration: pgtype.Int4{Int32: currentNode.SplitPlanGeneration, Valid: currentNode.SplitPlanGeneration > 0},
	})
	if err != nil {
		return nil, fmt.Errorf("list split tasks: %w", err)
	}

	cancelledIssues := make([]splitIssueStatusChange, 0, len(tasks))
	for _, task := range tasks {
		if err := s.runInTx(ctx, func(qtx *db.Queries) error {
			lockedNode, err := qtx.GetWorkflowNodeRunForUpdate(ctx, nodeRun.ID)
			if err != nil {
				return fmt.Errorf("lock split node cancellation: %w", err)
			}
			if lockedNode.Status != NodeRunStatusCancelled {
				return errors.New("split cancellation fence is not active")
			}
			if err := qtx.LockIssueDuplicateKey(ctx, splitTaskDispatchLockKey(task.ID)); err != nil {
				return fmt.Errorf("lock split task cancellation: %w", err)
			}
			currentTask, err := qtx.GetSplitTaskForUpdate(ctx, task.ID)
			if err != nil {
				return fmt.Errorf("reload split task for cancellation: %w", err)
			}
			if isTerminalSplitTaskStatus(currentTask.Status) {
				return nil
			}
			if currentTask.RunID.Valid {
				run, err := qtx.GetWorkflowRun(ctx, currentTask.RunID)
				if err != nil {
					return fmt.Errorf("get child run: %w", err)
				}
				if !isTerminalWorkflowRunStatus(run.Status) {
					if err := s.WfService.CancelRun(ctx, currentTask.RunID); err != nil {
						return fmt.Errorf("cancel child run: %w", err)
					}
				}
			}
			if currentTask.IssueID.Valid {
				issue, err := qtx.GetIssue(ctx, currentTask.IssueID)
				if err != nil {
					return fmt.Errorf("get child issue: %w", err)
				}
				if issue.Status != "cancelled" && issue.Status != "done" {
					updated, err := qtx.UpdateIssueStatus(ctx, db.UpdateIssueStatusParams{
						ID:          currentTask.IssueID,
						Status:      "cancelled",
						WorkspaceID: workspaceID,
					})
					if err != nil {
						return fmt.Errorf("cancel child issue: %w", err)
					}
					cancelledIssues = append(cancelledIssues, splitIssueStatusChange{prev: issue, issue: updated})
				}
			}
			if _, err := qtx.CancelOpenSplitTask(ctx, currentTask.ID); err != nil {
				return fmt.Errorf("cancel split task: %w", err)
			}
			return nil
		}); err != nil {
			return nil, err
		}
	}

	// Broadcast after commit so listeners never read uncommitted state.
	if s.OnChildIssueStatusChanged != nil {
		for _, change := range cancelledIssues {
			s.OnChildIssueStatusChanged(ctx, change.prev, change.issue)
		}
	}

	if currentNode.Status == NodeRunStatusCancelled {
		if s.WfService != nil {
			s.WfService.checkRunCompletion(ctx, currentNode.WorkflowRunID)
		}
		return &currentNode, nil
	}
	if !canCancelSplitNodeStatus(nodeRun.Status) {
		return nil, fmt.Errorf("split node cannot be cancelled from current status")
	}

	updated, err := s.WfService.TransitionNodeRun(ctx, nodeRun, NodeRunStatusCancelled)
	if err != nil {
		return nil, err
	}
	return updated, nil
}

func (s *SplitOrchestrator) CancelSplitNodeExpected(
	ctx context.Context,
	nodeRun db.MulticaWorkflowNodeRun,
	workspaceID pgtype.UUID,
	expectedGeneration int32,
) (*db.MulticaWorkflowNodeRun, error) {
	if expectedGeneration < 1 {
		return nil, NewSplitAPIError(SplitErrorBadRequest, "invalid_split_request", errors.New("expected_split_generation is required"))
	}
	var fenced db.MulticaWorkflowNodeRun
	err := s.runInTx(ctx, func(qtx *db.Queries) error {
		lockedNode, err := qtx.GetWorkflowNodeRunForUpdate(ctx, nodeRun.ID)
		if err != nil {
			return err
		}
		generation, err := qtx.GetWorkflowSplitGenerationForUpdate(ctx, db.GetWorkflowSplitGenerationForUpdateParams{
			NodeRunID: lockedNode.ID, Generation: lockedNode.SplitPlanGeneration,
		})
		if err != nil {
			return err
		}
		if lockedNode.SplitPlanGeneration != expectedGeneration {
			return staleSplitGenerationError(lockedNode, generation)
		}
		if lockedNode.Status == NodeRunStatusCancelled {
			fenced = lockedNode
			return nil
		}
		if !canCancelSplitNodeStatus(lockedNode.Status) {
			return NewSplitAPIError(SplitErrorConflict, "split_cancel_not_allowed", errors.New("split node cannot be cancelled from current status"))
		}
		if _, err := qtx.UpdateWorkflowSplitGenerationStatus(ctx, db.UpdateWorkflowSplitGenerationStatusParams{
			NodeRunID: lockedNode.ID, Generation: generation.Generation, Status: "cancelled",
		}); err != nil {
			return err
		}
		if err := qtx.InvalidateSplitGenerationDispatchJobs(ctx, db.InvalidateSplitGenerationDispatchJobsParams{
			WorkflowNodeRunID:   lockedNode.ID,
			SplitPlanGeneration: pgtype.Int4{Int32: generation.Generation, Valid: true},
		}); err != nil {
			return err
		}
		if generation.PlannerTaskID.Valid {
			_, _ = qtx.CancelAgentTask(ctx, generation.PlannerTaskID)
		}
		fenced, err = qtx.UpdateWorkflowNodeRunStatus(ctx, db.UpdateWorkflowNodeRunStatusParams{ID: lockedNode.ID, Status: NodeRunStatusCancelled})
		return err
	})
	if err != nil {
		return nil, err
	}
	if s.WfService != nil && s.WfService.OnNodeStatusChanged != nil {
		s.WfService.OnNodeStatusChanged(ctx, fenced)
	}
	return s.CancelSplitNode(ctx, fenced, workspaceID)
}

func (s *SplitOrchestrator) ScheduleReadyTasks(ctx context.Context, nodeRunID pgtype.UUID) error {
	assigned := make([]splitIssueStatusChange, 0)
	var reviewerActor AssignmentActor
	if err := s.WfService.runInTx(ctx, func(qtx *db.Queries) error {
		nodeRun, err := qtx.GetWorkflowNodeRunForUpdate(ctx, nodeRunID)
		if err != nil {
			return err
		}
		if nodeRun.Status != NodeRunStatusSplitActive {
			return nil
		}
		_, cfg, err := splitRunNodeConfig(ctx, qtx, nodeRun)
		if err != nil {
			return err
		}
		reviewerID, err := resolveSplitReviewerWithQueries(ctx, qtx, nodeRun)
		if err != nil {
			return err
		}
		reviewerActor = AssignmentActor{Type: "member", ID: reviewerID}
		tasks, err := qtx.ListSplitTasksByGeneration(ctx, db.ListSplitTasksByGenerationParams{
			NodeRunID: nodeRunID, SplitPlanGeneration: pgtype.Int4{Int32: nodeRun.SplitPlanGeneration, Valid: true},
		})
		if err != nil {
			return err
		}
		plans, err := splitTaskPlansFromRows(tasks)
		if err != nil {
			return err
		}
		readyIDs, err := readySplitTaskIDs(plans, int(cfg.MaxConcurrency))
		if err != nil {
			return err
		}
		byID := splitTaskMap(tasks)
		for _, id := range readyIDs {
			task := byID[id]
			// Preserve the same lock order as materialization and cancellation:
			// node row -> per-task advisory lock -> task row. Re-read after the
			// lock so a concurrent retry/cancel cannot start stale work.
			if err := qtx.LockIssueDuplicateKey(ctx, splitTaskDispatchLockKey(task.ID)); err != nil {
				return err
			}
			task, err = qtx.GetSplitTaskForUpdate(ctx, task.ID)
			if err != nil {
				return err
			}
			if !task.SplitPlanGeneration.Valid || task.SplitPlanGeneration.Int32 != nodeRun.SplitPlanGeneration || task.Status != SplitTaskStatusCreated {
				continue
			}
			if task.RunID.Valid || !task.IssueID.Valid || !task.AssigneeType.Valid || !task.AssigneeID.Valid {
				continue
			}
			assignee := AssigneeRef{Type: task.AssigneeType.String, ID: task.AssigneeID}
			if err := s.Assignments.ValidateAssignee(ctx, qtx, task.WorkspaceID, reviewerActor, assignee); err != nil {
				if _, updateErr := qtx.UpdateSplitTaskStatusWithError(ctx, db.UpdateSplitTaskStatusWithErrorParams{
					ID: task.ID, Status: SplitTaskStatusFailed, LastError: splitAssigneeInvalidatedError(task, err),
				}); updateErr != nil {
					return fmt.Errorf("validate split assignee: %v; mark failed: %w", err, updateErr)
				}
				continue
			}
			prevIssue, err := qtx.GetIssue(ctx, task.IssueID)
			if err != nil {
				return err
			}
			issue, err := ensureSplitChildIssueAssignee(ctx, qtx, task, prevIssue)
			if err != nil {
				return err
			}
			if _, err := qtx.MarkSplitTaskRunningIfCreated(ctx, task.ID); err != nil {
				return err
			}
			assigned = append(assigned, splitIssueStatusChange{prev: prevIssue, issue: issue})
		}
		return nil
	}); err != nil {
		return err
	}

	for _, change := range assigned {
		if err := s.Assignments.AfterIssueAssigned(ctx, change.prev, change.issue, reviewerActor, RuntimeSelection{}); err != nil {
			if failErr := s.HandleChildDispatchFailed(ctx, change.issue.ID, err); failErr != nil {
				return fmt.Errorf("run split child assignment side effects: %v; mark failed: %w", err, failErr)
			}
		}
	}
	if err := s.markBlockedDependents(ctx, nodeRunID); err != nil {
		return err
	}
	return s.reconcileParentNode(ctx, nodeRunID)
}

func splitAssigneeInvalidatedError(task db.MulticaWorkflowSplitTask, err error) []byte {
	payload, marshalErr := json.Marshal(map[string]any{
		"code":          "split_assignee_invalidated",
		"message":       err.Error(),
		"split_task_id": util.UUIDToString(task.ID),
		"issue_id":      util.UUIDToString(task.IssueID),
	})
	if marshalErr != nil {
		return []byte(`{"code":"split_assignee_invalidated","message":"split assignee is no longer valid"}`)
	}
	return payload
}

func (s *SplitOrchestrator) splitTaskGenerationIsActive(ctx context.Context, task db.MulticaWorkflowSplitTask) (bool, error) {
	nodeRun, err := s.Queries.GetWorkflowNodeRun(ctx, task.NodeRunID)
	if err != nil {
		return false, err
	}
	return (nodeRun.Status == NodeRunStatusSplitActive || nodeRun.Status == NodeRunStatusBlocked) && task.SplitPlanGeneration.Valid &&
		task.SplitPlanGeneration.Int32 == nodeRun.SplitPlanGeneration, nil
}

func (s *SplitOrchestrator) HandleChildIssueStatusChanged(ctx context.Context, prev, issue db.MulticaIssue) error {
	if prev.Status == issue.Status || !issue.OriginType.Valid || issue.OriginType.String != "workflow_split" {
		return nil
	}
	task, err := s.Queries.GetSplitTaskByIssueID(ctx, issue.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if task.RunID.Valid {
		return nil
	}
	active, err := s.splitTaskGenerationIsActive(ctx, task)
	if err != nil || !active {
		return err
	}

	var status string
	switch issue.Status {
	case "done":
		status = SplitTaskStatusDone
	case "cancelled":
		status = SplitTaskStatusCancelled
	default:
		return nil
	}
	if _, err := s.Queries.SetSplitTaskTerminalByIssue(ctx, db.SetSplitTaskTerminalByIssueParams{
		IssueID: issue.ID,
		Status:  status,
	}); errors.Is(err, pgx.ErrNoRows) {
		return nil
	} else if err != nil {
		return err
	}
	if err := s.ScheduleReadyTasks(ctx, task.NodeRunID); err != nil {
		return err
	}
	return s.reconcileParentNode(ctx, task.NodeRunID)
}

func (s *SplitOrchestrator) HandleChildExecutionFailed(ctx context.Context, issueID pgtype.UUID, cause error) error {
	return s.failSplitChild(ctx, issueID, cause, "split_child_execution_failed", "split child execution failed")
}

func (s *SplitOrchestrator) HandleChildDispatchFailed(ctx context.Context, issueID pgtype.UUID, cause error) error {
	return s.failSplitChild(ctx, issueID, cause, "split_child_dispatch_failed", "split child dispatch failed")
}

func (s *SplitOrchestrator) failSplitChild(ctx context.Context, issueID pgtype.UUID, cause error, code, fallbackMessage string) error {
	task, err := s.Queries.GetSplitTaskByIssueID(ctx, issueID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if task.RunID.Valid {
		return nil
	}
	active, err := s.splitTaskGenerationIsActive(ctx, task)
	if err != nil || !active {
		return err
	}
	payload, marshalErr := json.Marshal(map[string]any{
		"code":          code,
		"message":       cause.Error(),
		"split_task_id": util.UUIDToString(task.ID),
		"issue_id":      util.UUIDToString(issueID),
	})
	if marshalErr != nil {
		payload, _ = json.Marshal(map[string]string{"code": code, "message": fallbackMessage})
	}
	if _, err := s.Queries.FailSplitTaskExecutionByIssue(ctx, db.FailSplitTaskExecutionByIssueParams{
		LastError: payload,
		IssueID:   issueID,
	}); errors.Is(err, pgx.ErrNoRows) {
		return nil
	} else if err != nil {
		return err
	}
	if err := s.markBlockedDependents(ctx, task.NodeRunID); err != nil {
		return err
	}
	return s.reconcileParentNode(ctx, task.NodeRunID)
}

func (s *SplitOrchestrator) HandleChildExecutionRetried(ctx context.Context, issueID pgtype.UUID) error {
	task, err := s.Queries.GetSplitTaskByIssueID(ctx, issueID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	active, err := s.splitTaskGenerationIsActive(ctx, task)
	if err != nil || !active {
		return err
	}
	_, err = s.Queries.RetrySplitTaskExecutionByIssue(ctx, issueID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := s.reconcileParentNode(ctx, task.NodeRunID); err != nil {
		return err
	}
	return s.ScheduleReadyTasks(ctx, task.NodeRunID)
}

func (s *SplitOrchestrator) HandleChildRunTerminal(ctx context.Context, run db.MulticaWorkflowRun, status string) error {
	tasks, err := s.Queries.ListSplitTasksByRunID(ctx, run.ID)
	if err != nil {
		return nil
	}
	if len(tasks) == 0 {
		return nil
	}
	active, err := s.splitTaskGenerationIsActive(ctx, tasks[0])
	if err != nil || !active {
		return err
	}

	taskStatus := SplitTaskStatusDone
	switch status {
	case RunStatusFailed:
		taskStatus = SplitTaskStatusFailed
	case RunStatusCancelled:
		taskStatus = SplitTaskStatusCancelled
	}

	for _, task := range tasks {
		if _, err := s.Queries.UpdateSplitTaskStatus(ctx, db.UpdateSplitTaskStatusParams{
			ID:     task.ID,
			Status: taskStatus,
		}); err != nil {
			return err
		}
	}

	nodeRunID := tasks[0].NodeRunID
	nodeRun, err := s.Queries.GetWorkflowNodeRun(ctx, nodeRunID)
	if err != nil {
		return err
	}
	if nodeRun.Status == NodeRunStatusCancelled {
		return nil
	}
	if err := s.markBlockedDependents(ctx, nodeRunID); err != nil {
		return err
	}
	if err := s.ScheduleReadyTasks(ctx, nodeRunID); err != nil {
		return err
	}
	return s.reconcileParentNode(ctx, nodeRunID)
}

func BuildWorkflowWorkerSubIssueDescription(parentIssue db.MulticaIssue, node db.MulticaWorkflowNode) string {
	parentDescription := strings.TrimSpace(textToString(parentIssue.Description))
	workerInstruction := ExtractWorkflowRoleInstruction(parentDescription, "worker", []string{"critic", "reviewer"})
	if workerInstruction == "" {
		workerInstruction = parentDescription
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Workflow worker task for node: %s\n\n", strings.TrimSpace(node.Title))
	b.WriteString("Complete the worker portion of the parent issue and submit every required deliverable before finishing.\n")
	b.WriteString("Do not perform critic review, approve, or reject this work; the review phase runs after your deliverable is submitted.\n\n")
	if workerInstruction != "" {
		b.WriteString("Worker instructions:\n")
		b.WriteString(workerInstruction)
		b.WriteString("\n\n")
	}
	b.WriteString("Parent issue title:\n")
	b.WriteString(parentIssue.Title)
	return strings.TrimSpace(b.String())
}

func ExtractWorkflowRoleInstruction(description string, role string, stopRoles []string) string {
	lower := strings.ToLower(description)
	marker := strings.ToLower(role) + ":"
	start := strings.Index(lower, marker)
	if start < 0 {
		return ""
	}
	contentStart := start + len(marker)
	end := len(description)
	for _, stopRole := range stopRoles {
		stopMarker := strings.ToLower(stopRole) + ":"
		if idx := strings.Index(lower[contentStart:], stopMarker); idx >= 0 && contentStart+idx < end {
			end = contentStart + idx
		}
	}
	return strings.TrimSpace(description[contentStart:end])
}

func (s *SplitOrchestrator) markBlockedDependents(ctx context.Context, nodeRunID pgtype.UUID) error {
	nodeRun, err := s.Queries.GetWorkflowNodeRun(ctx, nodeRunID)
	if err != nil {
		return err
	}
	if nodeRun.Status != NodeRunStatusSplitActive && nodeRun.Status != NodeRunStatusBlocked {
		return nil
	}
	tasks, err := s.Queries.ListSplitTasksByGeneration(ctx, db.ListSplitTasksByGenerationParams{
		NodeRunID: nodeRunID, SplitPlanGeneration: pgtype.Int4{Int32: nodeRun.SplitPlanGeneration, Valid: true},
	})
	if err != nil {
		return err
	}
	plans, err := splitTaskPlansFromRows(tasks)
	if err != nil {
		return err
	}
	next := markBlockedSplitTasksSkipped(plans)
	currentByID := make(map[string]string, len(plans))
	for _, plan := range plans {
		currentByID[plan.ID] = plan.Status
	}
	for _, plan := range next {
		if currentByID[plan.ID] == plan.Status {
			continue
		}
		u, err := util.ParseUUID(plan.ID)
		if err != nil {
			return err
		}
		if _, err := s.Queries.UpdateSplitTaskStatus(ctx, db.UpdateSplitTaskStatusParams{
			ID:     u,
			Status: plan.Status,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *SplitOrchestrator) reconcileParentNode(ctx context.Context, nodeRunID pgtype.UUID) error {
	nodeRun, err := s.Queries.GetWorkflowNodeRun(ctx, nodeRunID)
	if err != nil {
		return err
	}
	if nodeRun.Status != NodeRunStatusSplitActive && nodeRun.Status != NodeRunStatusBlocked {
		return nil
	}
	_, cfg, err := splitRunNodeConfig(ctx, s.Queries, nodeRun)
	if err != nil {
		return err
	}
	tasks, err := s.Queries.ListSplitTasksByGeneration(ctx, db.ListSplitTasksByGenerationParams{
		NodeRunID: nodeRunID, SplitPlanGeneration: pgtype.Int4{Int32: nodeRun.SplitPlanGeneration, Valid: true},
	})
	if err != nil {
		return err
	}
	plans, err := splitTaskPlansFromRows(tasks)
	if err != nil {
		return err
	}
	_, nextStatus := resolveSettledSplitStatus(cfg.Mode, int(cfg.MaxFailures), plans)
	if nextStatus == nodeRun.Status {
		return nil
	}
	updated, err := s.WfService.TransitionNodeRun(ctx, nodeRun, nextStatus)
	if err != nil {
		return err
	}
	if nextStatus == NodeRunStatusCompleted {
		return s.WfService.OnNodeRunCompleted(ctx, updated.ID)
	}
	return nil
}

func (s *SplitOrchestrator) findParentIssue(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) (db.MulticaIssue, error) {
	run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		return db.MulticaIssue{}, fmt.Errorf("get workflow run: %w", err)
	}
	splitIssue, err := s.Queries.GetIssueByOrigin(ctx, db.GetIssueByOriginParams{
		WorkspaceID: run.WorkspaceID,
		OriginType:  pgtype.Text{String: "workflow", Valid: true},
		OriginID:    nodeRun.ID,
	})
	if err != nil {
		return db.MulticaIssue{}, fmt.Errorf("get split sub-issue: %w", err)
	}
	if splitIssue.ParentIssueID.Valid {
		return s.Queries.GetIssue(ctx, splitIssue.ParentIssueID)
	}
	return splitIssue, nil
}

func isSplitGeneratePhase(contextJSON []byte) bool {
	if len(contextJSON) == 0 {
		return false
	}
	var payload struct {
		Phase string `json:"phase"`
	}
	if err := json.Unmarshal(contextJSON, &payload); err != nil {
		return false
	}
	return payload.Phase == splitPhaseGenerate
}

type SplitProgressSummary struct {
	Total     int
	Created   int
	Running   int
	Done      int
	Failed    int
	Cancelled int
	Skipped   int
}

func (s *SplitProgressSummary) AddStatus(status string) {
	switch status {
	case SplitTaskStatusCreated:
		s.Total++
		s.Created++
	case SplitTaskStatusRunning:
		s.Total++
		s.Running++
	case SplitTaskStatusDone:
		s.Total++
		s.Done++
	case SplitTaskStatusFailed:
		s.Total++
		s.Failed++
	case SplitTaskStatusCancelled:
		s.Total++
		s.Cancelled++
	case SplitTaskStatusSkipped:
		s.Total++
		s.Skipped++
	}
}

func SplitExecutionProgressSummary(tasks []db.MulticaWorkflowSplitTask) SplitProgressSummary {
	var summary SplitProgressSummary
	for _, t := range tasks {
		summary.AddStatus(t.Status)
	}
	return summary
}

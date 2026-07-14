package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"path"
	"regexp"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const (
	NodeRunStatusSplitting           = "splitting"
	NodeRunStatusAwaitingSplitReview = "awaiting_split_review"
	NodeRunStatusSplitActive         = "split_active"

	SplitModeBarrier  = "barrier"
	SplitModePipeline = "pipeline"

	SplitTaskStatusDraft     = "draft"
	SplitTaskStatusApproved  = "approved"
	SplitTaskStatusDiscarded = "discarded"
	SplitTaskStatusCreated   = "created"
	SplitTaskStatusRunning   = "running"
	SplitTaskStatusDone      = "done"
	SplitTaskStatusFailed    = "failed"
	SplitTaskStatusCancelled = "cancelled"
	SplitTaskStatusSkipped   = "skipped"

	DraftSourceAgent     = "agent"
	DraftSourceChat      = "chat"
	DraftSourceRecovered = "recovered"
)

const maxSplitRecoveryAttachmentBytes = 2 << 20

// Split task context phases.
const (
	splitPhaseGenerate = "split_generate"
	splitPhaseRepair   = "split_repair"
	splitPhaseChat     = "split_chat"
)

type splitAttachmentStorage interface {
	KeyFromURL(rawURL string) string
	GetReader(ctx context.Context, key string) (io.ReadCloser, error)
}

type SplitConfig struct {
	SubTemplateID  string `json:"sub_template_id"`
	Mode           string `json:"mode"`
	MaxConcurrency int32  `json:"max_concurrency"`
	MaxFailures    int32  `json:"max_failures"`
}

type SplitApproveRequest struct {
	ApprovedTaskIDs []string                `json:"approved_task_ids"`
	Modifications   []SplitTaskModification `json:"modifications"`
}

type SplitTaskModification struct {
	Action                string   `json:"action"`
	ID                    string   `json:"id"`
	Title                 *string  `json:"title"`
	Description           *string  `json:"description"`
	DependsOn             []string `json:"depends_on"`
	SuggestedAssigneeType *string  `json:"suggested_assignee_type"`
	SuggestedAssigneeID   *string  `json:"suggested_assignee_id"`
}

type SplitDraftTaskRequest struct {
	Key                   string   `json:"key"`
	Title                 string   `json:"title"`
	Description           string   `json:"description"`
	SuggestedAssigneeType *string  `json:"suggested_assignee_type"`
	SuggestedAssigneeID   *string  `json:"suggested_assignee_id"`
	DependsOnKeys         []string `json:"depends_on_keys"`
}

type splitGeneratedTask struct {
	Title          string  `json:"title"`
	Description    string  `json:"description"`
	AssigneeType   *string `json:"assignee_type"`
	AssigneeID     *string `json:"assignee_id"`
	DependsOnIndex []int   `json:"depends_on_indices"`
}

type splitGeneratedTaskPayload struct {
	Tasks []splitGeneratedTask `json:"tasks"`
}

var markdownSplitTaskHeadingRE = regexp.MustCompile(`(?im)^\s*(?:#{1,6}\s*)?(?:task|任务)\s*\d+\s*[:：.\-)]\s*(.+?)\s*$`)

type SplitOrchestrator struct {
	Queries           *db.Queries
	TxStarter         TxStarter
	WfService         *WorkflowService
	Bus               *events.Bus
	AttachmentStorage splitAttachmentStorage
}

func NewSplitOrchestrator(
	q *db.Queries,
	tx TxStarter,
	wfSvc *WorkflowService,
	bus *events.Bus,
	attachmentStorage ...splitAttachmentStorage,
) *SplitOrchestrator {
	var store splitAttachmentStorage
	if len(attachmentStorage) > 0 {
		store = attachmentStorage[0]
	}
	return &SplitOrchestrator{
		Queries:           q,
		TxStarter:         tx,
		WfService:         wfSvc,
		Bus:               bus,
		AttachmentStorage: store,
	}
}

type splitTaskPlan struct {
	ID        string
	DependsOn []string
	SortOrder int
	Status    string
}

type splitNodeFormat struct {
	Type        string      `json:"type"`
	SplitConfig SplitConfig `json:"split_config"`
}

type splitTaskDependencyContext struct {
	TaskTitle string
	NodeRuns  []db.MulticaWorkflowNodeRun
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
	running := 0
	for _, task := range tasks {
		byID[task.ID] = task
		if task.Status == SplitTaskStatusRunning {
			running++
		}
	}
	remainingSlots := maxConcurrency - running
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
				switch byID[depID].Status {
				case SplitTaskStatusFailed, SplitTaskStatusCancelled, SplitTaskStatusSkipped:
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
	switch mode {
	case SplitModePipeline:
		for _, task := range tasks {
			if task.Status == SplitTaskStatusDraft || task.Status == SplitTaskStatusApproved {
				return NodeRunStatusSplitActive
			}
		}
		return NodeRunStatusCompleted
	default:
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
	}
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
	if cfg.SubTemplateID == "" {
		return SplitConfig{}, fmt.Errorf("split node is missing sub_template_id")
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
			ID:        util.UUIDToString(task.ID),
			DependsOn: dependsOn,
			SortOrder: int(task.SortOrder),
			Status:    task.Status,
		})
	}
	return plans, nil
}

func splitTaskMap(tasks []db.MulticaWorkflowSplitTask) map[string]db.MulticaWorkflowSplitTask {
	byID := make(map[string]db.MulticaWorkflowSplitTask, len(tasks))
	for _, task := range tasks {
		byID[util.UUIDToString(task.ID)] = task
	}
	return byID
}

func parseSuggestedAssignee(task db.MulticaWorkflowSplitTask) (pgtype.Text, pgtype.UUID) {
	if !task.SuggestedAssigneeType.Valid {
		return pgtype.Text{}, pgtype.UUID{}
	}
	switch task.SuggestedAssigneeType.String {
	case "member", "agent", "squad":
		return task.SuggestedAssigneeType, task.SuggestedAssigneeID
	default:
		return pgtype.Text{}, pgtype.UUID{}
	}
}

func isTerminalSplitTaskStatus(status string) bool {
	switch status {
	case SplitTaskStatusDone, SplitTaskStatusFailed, SplitTaskStatusCancelled, SplitTaskStatusSkipped, SplitTaskStatusDiscarded:
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
		NodeRunStatusSplitActive:
		return true
	default:
		return false
	}
}

func extractSplitTaskOutputText(nodeRun db.MulticaWorkflowNodeRun) string {
	if len(nodeRun.WorkerOutput) == 0 {
		return ""
	}
	var output map[string]any
	if err := json.Unmarshal(nodeRun.WorkerOutput, &output); err != nil {
		return ""
	}
	text, ok := output["output"].(string)
	if !ok || text == "" {
		return ""
	}
	if len(text) > 2000 {
		text = text[:2000] + "..."
	}
	return text
}

func buildSplitDependencyContext(dependencies []splitTaskDependencyContext) string {
	sections := make([]string, 0, len(dependencies))
	for _, dependency := range dependencies {
		outputs := make([]string, 0, len(dependency.NodeRuns))
		for _, nodeRun := range dependency.NodeRuns {
			text := extractSplitTaskOutputText(nodeRun)
			if text == "" {
				continue
			}
			if nodeRun.NodeTitle != "" {
				outputs = append(outputs, fmt.Sprintf("### %s\n\n%s", nodeRun.NodeTitle, text))
			} else {
				outputs = append(outputs, text)
			}
		}
		if len(outputs) == 0 {
			continue
		}
		title := dependency.TaskTitle
		if title == "" {
			title = "Dependency"
		}
		sections = append(sections, fmt.Sprintf("## %s Output\n\n%s", title, strings.Join(outputs, "\n\n")))
	}
	if len(sections) == 0 {
		return ""
	}
	return "\n\n---\n\n" + strings.Join(sections, "\n\n---\n\n")
}

func buildSplitChildIssueDescription(baseDescription string, dependencyContext string) string {
	if dependencyContext == "" {
		return baseDescription
	}
	return baseDescription + dependencyContext
}

func (s *SplitOrchestrator) HandleNodeRunStatusChanged(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) error {
	if nodeRun.Status == NodeRunStatusCancelled {
		node, err := s.Queries.GetWorkflowNode(ctx, nodeRun.WorkflowNodeID)
		if err != nil {
			return err
		}
		if workflowNodeType(node.FormatSchema) != "split" {
			return nil
		}
		run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
		if err != nil {
			return err
		}
		_, err = s.CancelSplitNode(ctx, nodeRun, run.WorkspaceID)
		return err
	}

	if nodeRun.Status != NodeRunStatusSplitting {
		return nil
	}
	tasks, err := s.Queries.ListSplitTasksByNodeRun(ctx, nodeRun.ID)
	if err != nil {
		return err
	}
	if len(tasks) == 0 {
		return s.GenerateSplitTasks(ctx, nodeRun)
	}
	_, err = s.WfService.TransitionNodeRun(ctx, nodeRun, NodeRunStatusAwaitingSplitReview)
	return err
}

func (s *SplitOrchestrator) GenerateSplitTasks(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) error {
	currentNodeRun := nodeRun
	if !canRegenerateSplitNodeStatus(currentNodeRun.Status) {
		return fmt.Errorf("split node cannot generate tasks from current status")
	}
	switch currentNodeRun.Status {
	case NodeRunStatusAwaitingSplitReview:
		updated, err := s.WfService.TransitionNodeRun(ctx, currentNodeRun, NodeRunStatusSplitting)
		if err != nil {
			return err
		}
		currentNodeRun = *updated
	case NodeRunStatusFailed:
		updated, err := s.Queries.ReactivateWorkflowNodeRunStatus(ctx, db.ReactivateWorkflowNodeRunStatusParams{
			ID:     currentNodeRun.ID,
			Status: NodeRunStatusSplitting,
		})
		if err != nil {
			return fmt.Errorf("reactivate failed split node: %w", err)
		}
		currentNodeRun = updated
		if s.WfService != nil && s.WfService.OnNodeStatusChanged != nil {
			s.WfService.OnNodeStatusChanged(ctx, currentNodeRun)
		}
	case NodeRunStatusSplitting:
		// Already in the right state.
	}

	node, err := s.Queries.GetWorkflowNode(ctx, currentNodeRun.WorkflowNodeID)
	if err != nil {
		return fmt.Errorf("get split node: %w", err)
	}
	cfg, err := parseSplitConfig(node.FormatSchema)
	if err != nil {
		return err
	}
	if err := s.validateSubTemplate(ctx, cfg.SubTemplateID); err != nil {
		return err
	}

	run, err := s.Queries.GetWorkflowRun(ctx, currentNodeRun.WorkflowRunID)
	if err != nil {
		return fmt.Errorf("get workflow run for split issue lookup: %w", err)
	}
	splitIssue, err := s.Queries.GetIssueByOrigin(ctx, db.GetIssueByOriginParams{
		WorkspaceID: run.WorkspaceID,
		OriginType:  pgtype.Text{String: "workflow", Valid: true},
		OriginID:    currentNodeRun.ID,
	})
	if err != nil {
		return fmt.Errorf("get split sub-issue: %w", err)
	}

	activeTasks, err := s.Queries.ListActiveTasksByIssue(ctx, splitIssue.ID)
	if err != nil {
		return fmt.Errorf("list active split generation tasks: %w", err)
	}
	for _, task := range activeTasks {
		if task.WorkflowNodeRunID == currentNodeRun.ID && isAnySplitPhase(task.Context) {
			return nil
		}
	}

	task, err := s.WfService.DispatchAgentTaskWithContextExtras(ctx, currentNodeRun, "split", map[string]any{
		"phase": splitPhaseGenerate,
	})
	if err != nil {
		return fmt.Errorf("dispatch split generation task: %w", err)
	}
	if _, err := s.Queries.LinkNodeRunAgentTask(ctx, db.LinkNodeRunAgentTaskParams{
		ID:          currentNodeRun.ID,
		AgentTaskID: task.ID,
	}); err != nil {
		return fmt.Errorf("link split generation task: %w", err)
	}
	return nil
}

func canRegenerateSplitNodeStatus(status string) bool {
	switch status {
	case NodeRunStatusSplitting, NodeRunStatusAwaitingSplitReview, NodeRunStatusFailed:
		return true
	default:
		return false
	}
}

func (s *SplitOrchestrator) RecoverSplitDraftTasks(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) error {
	if nodeRun.Status != NodeRunStatusFailed {
		return fmt.Errorf("split node can only recover drafts after failure")
	}
	node, err := s.Queries.GetWorkflowNode(ctx, nodeRun.WorkflowNodeID)
	if err != nil {
		return fmt.Errorf("get split node: %w", err)
	}
	if workflowNodeType(node.FormatSchema) != "split" {
		return fmt.Errorf("node run is not a split node")
	}
	task, err := s.loadSplitRecoveryTask(ctx, nodeRun)
	if err != nil {
		return err
	}
	payload, err := s.recoverSplitGeneratedTaskPayloadFromTaskSources(ctx, task)
	if err != nil {
		return err
	}
	existing, err := s.Queries.ListSplitTasksByNodeRun(ctx, nodeRun.ID)
	if err != nil {
		return fmt.Errorf("list existing split tasks: %w", err)
	}
	if err := s.replaceSplitDraftTasksFromPayload(ctx, nodeRun, existing, payload, pgtype.Text{String: DraftSourceRecovered, Valid: true}); err != nil {
		return err
	}
	updated, err := s.Queries.ReactivateWorkflowNodeRunStatus(ctx, db.ReactivateWorkflowNodeRunStatusParams{
		ID:     nodeRun.ID,
		Status: NodeRunStatusAwaitingSplitReview,
	})
	if err != nil {
		return fmt.Errorf("reactivate split node for review: %w", err)
	}
	if s.WfService != nil && s.WfService.OnNodeStatusChanged != nil {
		s.WfService.OnNodeStatusChanged(ctx, updated)
	}
	return nil
}

func (s *SplitOrchestrator) loadSplitRecoveryTask(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) (db.MulticaAgentTaskQueue, error) {
	if nodeRun.AgentTaskID.Valid {
		task, err := s.Queries.GetAgentTask(ctx, nodeRun.AgentTaskID)
		if err != nil {
			return db.MulticaAgentTaskQueue{}, fmt.Errorf("get split generation task: %w", err)
		}
		if task.WorkflowNodeRunID == nodeRun.ID && isAnySplitPhase(task.Context) {
			return task, nil
		}
	}

	run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		return db.MulticaAgentTaskQueue{}, fmt.Errorf("get workflow run for split recovery: %w", err)
	}
	splitIssue, err := s.Queries.GetIssueByOrigin(ctx, db.GetIssueByOriginParams{
		WorkspaceID: run.WorkspaceID,
		OriginType:  pgtype.Text{String: "workflow", Valid: true},
		OriginID:    nodeRun.ID,
	})
	if err != nil {
		return db.MulticaAgentTaskQueue{}, fmt.Errorf("get split sub-issue for recovery: %w", err)
	}
	tasks, err := s.Queries.ListTasksByIssue(ctx, splitIssue.ID)
	if err != nil {
		return db.MulticaAgentTaskQueue{}, fmt.Errorf("list split issue tasks for recovery: %w", err)
	}
	for _, task := range tasks {
		if task.WorkflowNodeRunID == nodeRun.ID && isAnySplitPhase(task.Context) {
			return task, nil
		}
	}
	return db.MulticaAgentTaskQueue{}, fmt.Errorf("no split generation task found for recovery")
}

func (s *SplitOrchestrator) recoverSplitGeneratedTaskPayloadFromTaskSources(ctx context.Context, task db.MulticaAgentTaskQueue) (splitGeneratedTaskPayload, error) {
	payload, err := parseSplitGeneratedTaskPayload(task.Result)
	if err == nil {
		return payload, nil
	}
	payload, err = recoverSplitGeneratedTaskPayload(task.Result)
	if err == nil {
		return payload, nil
	}
	payload, err = s.recoverSplitGeneratedTaskPayloadFromComments(ctx, task)
	if err == nil {
		return payload, nil
	}
	return s.recoverSplitGeneratedTaskPayloadFromAttachments(ctx, task)
}

func (s *SplitOrchestrator) replaceSplitDraftTasksFromPayload(
	ctx context.Context,
	nodeRun db.MulticaWorkflowNodeRun,
	existing []db.MulticaWorkflowSplitTask,
	payload splitGeneratedTaskPayload,
	draftSource pgtype.Text,
) error {
	if len(payload.Tasks) == 0 {
		return fmt.Errorf("split task generation produced no tasks")
	}
	for _, task := range existing {
		switch task.Status {
		case SplitTaskStatusDraft, SplitTaskStatusDiscarded:
			if _, err := s.Queries.UpdateSplitTaskStatus(ctx, db.UpdateSplitTaskStatusParams{
				ID:     task.ID,
				Status: SplitTaskStatusDiscarded,
			}); err != nil {
				return fmt.Errorf("discard existing split draft task: %w", err)
			}
		default:
			return fmt.Errorf("split node already has materialized tasks")
		}
	}

	run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		return fmt.Errorf("get workflow run: %w", err)
	}

	inserted := make([]db.MulticaWorkflowSplitTask, 0, len(payload.Tasks))
	for i, generated := range payload.Tasks {
		suggestedType := ptrStringToText(generated.AssigneeType)
		suggestedID := pgtype.UUID{}
		if generated.AssigneeID != nil && *generated.AssigneeID != "" {
			parsedID, err := util.ParseUUID(*generated.AssigneeID)
			if err != nil {
				return fmt.Errorf("invalid generated assignee_id: %w", err)
			}
			suggestedID = parsedID
		}
		created, err := s.Queries.CreateSplitTask(ctx, db.CreateSplitTaskParams{
			NodeRunID:             nodeRun.ID,
			WorkspaceID:           run.WorkspaceID,
			Title:                 generated.Title,
			Description:           generated.Description,
			DependsOn:             []byte("[]"),
			SortOrder:             int32(i),
			Status:                SplitTaskStatusDraft,
			SuggestedAssigneeType: suggestedType,
			SuggestedAssigneeID:   suggestedID,
			DraftSource:           draftSource,
			})
		if err != nil {
			return fmt.Errorf("create generated split task: %w", err)
		}
		inserted = append(inserted, created)
	}

	plans := make([]splitTaskPlan, 0, len(inserted))
	for i, taskRow := range inserted {
		dependsOn := make([]string, 0, len(payload.Tasks[i].DependsOnIndex))
		for _, depIndex := range payload.Tasks[i].DependsOnIndex {
			if depIndex < 0 || depIndex >= len(inserted) {
				return fmt.Errorf("split task dependency index %d out of range", depIndex)
			}
			dependsOn = append(dependsOn, util.UUIDToString(inserted[depIndex].ID))
		}
		dependsOnJSON, err := json.Marshal(dependsOn)
		if err != nil {
			return fmt.Errorf("marshal generated split depends_on: %w", err)
		}
		if _, err := s.Queries.UpdateSplitTaskFields(ctx, db.UpdateSplitTaskFieldsParams{
			ID:                    taskRow.ID,
			Title:                 pgtype.Text{},
			Description:           pgtype.Text{},
			SuggestedAssigneeType: taskRow.SuggestedAssigneeType,
			SuggestedAssigneeID:   taskRow.SuggestedAssigneeID,
			DependsOn:             dependsOnJSON,
			SortOrder:             pgtype.Int4{},
		}); err != nil {
			return fmt.Errorf("set generated split depends_on: %w", err)
		}
		plans = append(plans, splitTaskPlan{
			ID:        util.UUIDToString(taskRow.ID),
			DependsOn: dependsOn,
			SortOrder: i,
			Status:    SplitTaskStatusDraft,
		})
	}
	return validateSplitTaskGraph(plans)
}

func (s *SplitOrchestrator) AddSplitDraftTask(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, taskID, agentID pgtype.UUID, req SplitDraftTaskRequest) error {
	task, err := s.validateSplitDraftTaskAccess(ctx, nodeRun, taskID, agentID)
	if err != nil {
		return err
	}
	if nodeRun.Status != NodeRunStatusSplitting {
		return fmt.Errorf("split draft tasks can only be added while the node is splitting")
	}

	// Determine draft source from task phase.
	draftSource := DraftSourceAgent
	if isSplitChatPhase(task.Context) {
		draftSource = DraftSourceChat
	}

	return s.WfService.runInTx(ctx, func(qtx *db.Queries) error {
		run, err := qtx.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
		if err != nil {
			return fmt.Errorf("get workflow run: %w", err)
		}
		key := strings.TrimSpace(req.Key)
		title := strings.TrimSpace(req.Title)
		description := strings.TrimSpace(req.Description)
		if key == "" {
			return fmt.Errorf("key is required")
		}
		if title == "" {
			return fmt.Errorf("title is required")
		}
		if description == "" {
			return fmt.Errorf("description is required")
		}

		suggestedType, suggestedID, err := s.validateSplitDraftAssignee(ctx, qtx, run.WorkspaceID, req.SuggestedAssigneeType, req.SuggestedAssigneeID)
		if err != nil {
			return err
		}

		existing, err := qtx.ListSplitTasksByNodeRun(ctx, nodeRun.ID)
		if err != nil {
			return fmt.Errorf("list split draft tasks: %w", err)
		}
		byKey := make(map[string]db.MulticaWorkflowSplitTask, len(existing))
		sortOrder := int32(0)
		foundExisting := false
		for _, task := range existing {
			if task.Status != SplitTaskStatusDiscarded {
				sortOrder++
			}
			if task.DraftKey.Valid {
				byKey[task.DraftKey.String] = task
				if task.DraftKey.String == key {
					sortOrder = task.SortOrder
					foundExisting = true
				}
			}
		}
		if !foundExisting {
			sortOrder = int32(len(byKey))
		}

		dependsOn := make([]string, 0, len(req.DependsOnKeys))
		for _, depKey := range req.DependsOnKeys {
			depKey = strings.TrimSpace(depKey)
			if depKey == "" {
				continue
			}
			if depKey == key {
				return fmt.Errorf("split draft task cannot depend on itself")
			}
			dep, ok := byKey[depKey]
			if !ok || dep.Status == SplitTaskStatusDiscarded {
				return fmt.Errorf("unknown dependency key %s", depKey)
			}
			dependsOn = append(dependsOn, util.UUIDToString(dep.ID))
		}
		dependsOnJSON, err := json.Marshal(dependsOn)
		if err != nil {
			return fmt.Errorf("marshal depends_on: %w", err)
		}

		if _, err := qtx.UpsertSplitDraftTaskByKey(ctx, db.UpsertSplitDraftTaskByKeyParams{
			NodeRunID:             nodeRun.ID,
			WorkspaceID:           run.WorkspaceID,
			DraftKey:              pgtype.Text{String: key, Valid: true},
			Title:                 title,
			Description:           description,
			DependsOn:             dependsOnJSON,
			SortOrder:             sortOrder,
			SuggestedAssigneeType: suggestedType,
			SuggestedAssigneeID:   suggestedID,
			DraftSource:           pgtype.Text{String: draftSource, Valid: true},
		}); err != nil {
			return fmt.Errorf("upsert split draft task: %w", err)
		}

		current, err := qtx.ListSplitTasksByNodeRun(ctx, nodeRun.ID)
		if err != nil {
			return fmt.Errorf("reload split draft tasks: %w", err)
		}
		return validateDraftSplitTaskRows(current)
	})
}

func (s *SplitOrchestrator) SubmitSplitDraftTasks(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, taskID, agentID pgtype.UUID) error {
	if _, err := s.validateSplitDraftTaskAccess(ctx, nodeRun, taskID, agentID); err != nil {
		return err
	}
	return s.transitionSplitDraftsToReview(ctx, nodeRun)
}

func (s *SplitOrchestrator) DeleteSplitDraftTask(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, draftTaskID, taskID, agentID pgtype.UUID) error {
	if _, err := s.validateSplitDraftTaskAccess(ctx, nodeRun, taskID, agentID); err != nil {
		return err
	}
	if nodeRun.Status != NodeRunStatusSplitting {
		return fmt.Errorf("split draft tasks can only be deleted while the node is splitting")
	}
	task, err := s.Queries.GetSplitTask(ctx, draftTaskID)
	if err != nil {
		return fmt.Errorf("split draft task not found")
	}
	if err := validateSplitDraftDeletionTarget(nodeRun.ID, task); err != nil {
		return err
	}
	if _, err := s.Queries.UpdateSplitTaskStatus(ctx, db.UpdateSplitTaskStatusParams{
		ID:     draftTaskID,
		Status: SplitTaskStatusDiscarded,
	}); err != nil {
		return fmt.Errorf("discard split draft task: %w", err)
	}
	return nil
}

func validateSplitDraftDeletionTarget(nodeRunID pgtype.UUID, task db.MulticaWorkflowSplitTask) error {
	if task.NodeRunID != nodeRunID {
		return fmt.Errorf("split draft task does not belong to this node run")
	}
	if task.IssueID.Valid || task.RunID.Valid {
		return fmt.Errorf("split draft task is already materialized")
	}
	switch task.Status {
	case SplitTaskStatusDraft, SplitTaskStatusDiscarded:
		return nil
	default:
		return fmt.Errorf("split draft task with status %q cannot be deleted", task.Status)
	}
}

func (s *SplitOrchestrator) validateSplitDraftTaskAccess(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, taskID, agentID pgtype.UUID) (db.MulticaAgentTaskQueue, error) {
	task, err := s.Queries.GetAgentTask(ctx, taskID)
	if err != nil {
		return db.MulticaAgentTaskQueue{}, fmt.Errorf("split draft task header is invalid")
	}
	if !agentID.Valid || task.AgentID != agentID {
		return db.MulticaAgentTaskQueue{}, fmt.Errorf("split draft task agent does not match this request")
	}
	if task.Status != "running" {
		return db.MulticaAgentTaskQueue{}, fmt.Errorf("split draft task must be running")
	}
	if !task.WorkflowNodeRunID.Valid || task.WorkflowNodeRunID != nodeRun.ID || !isAnySplitPhase(task.Context) {
		return db.MulticaAgentTaskQueue{}, fmt.Errorf("split draft task does not match this node run")
	}

	// Validate phase matches node run status.
	if isSplitChatPhase(task.Context) {
		if nodeRun.Status != NodeRunStatusAwaitingSplitReview {
			return db.MulticaAgentTaskQueue{}, fmt.Errorf("split chat draft API is only allowed in awaiting_split_review state")
		}
	} else if isSplitGeneratePhase(task.Context) || isSplitRepairPhase(task.Context) {
		if nodeRun.Status != NodeRunStatusSplitting {
			return db.MulticaAgentTaskQueue{}, fmt.Errorf("split generate/repair draft API is only allowed in splitting state")
		}
	}

	return task, nil
}

func (s *SplitOrchestrator) validateSplitDraftAssignee(ctx context.Context, q *db.Queries, workspaceID pgtype.UUID, assigneeType, assigneeID *string) (pgtype.Text, pgtype.UUID, error) {
	if assigneeType == nil || strings.TrimSpace(*assigneeType) == "" {
		return pgtype.Text{}, pgtype.UUID{}, fmt.Errorf("suggested_assignee_type is required")
	}
	if assigneeID == nil || strings.TrimSpace(*assigneeID) == "" {
		return pgtype.Text{}, pgtype.UUID{}, fmt.Errorf("suggested_assignee_id is required")
	}

	parsedID, err := util.ParseUUID(strings.TrimSpace(*assigneeID))
	if err != nil {
		return pgtype.Text{}, pgtype.UUID{}, fmt.Errorf("invalid suggested_assignee_id: %w", err)
	}
	switch strings.TrimSpace(*assigneeType) {
	case "agent":
		if _, err := q.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{ID: parsedID, WorkspaceID: workspaceID}); err != nil {
			return pgtype.Text{}, pgtype.UUID{}, fmt.Errorf("suggested agent is not in this workspace")
		}
	case "member":
		member, err := q.GetMember(ctx, parsedID)
		if err != nil || member.WorkspaceID != workspaceID {
			return pgtype.Text{}, pgtype.UUID{}, fmt.Errorf("suggested member is not in this workspace")
		}
	default:
		return pgtype.Text{}, pgtype.UUID{}, fmt.Errorf("suggested_assignee_type must be agent or member")
	}
	return pgtype.Text{String: strings.TrimSpace(*assigneeType), Valid: true}, parsedID, nil
}

func (s *SplitOrchestrator) transitionSplitDraftsToReview(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) error {
	if nodeRun.Status == NodeRunStatusAwaitingSplitReview {
		return nil
	}
	if nodeRun.Status != NodeRunStatusSplitting {
		return fmt.Errorf("split node cannot submit drafts from current status")
	}
	tasks, err := s.Queries.ListSplitTasksByNodeRun(ctx, nodeRun.ID)
	if err != nil {
		return fmt.Errorf("list split draft tasks: %w", err)
	}
	if err := validateDraftSplitTaskRows(tasks); err != nil {
		return err
	}
	_, err = s.WfService.TransitionNodeRun(ctx, nodeRun, NodeRunStatusAwaitingSplitReview)
	return err
}

func validateDraftSplitTaskRows(tasks []db.MulticaWorkflowSplitTask) error {
	plans := make([]splitTaskPlan, 0, len(tasks))
	for _, task := range tasks {
		if task.Status == SplitTaskStatusDiscarded {
			continue
		}
		if task.IssueID.Valid || task.RunID.Valid {
			return fmt.Errorf("split node already has materialized tasks")
		}
		if task.Status != SplitTaskStatusDraft {
			return fmt.Errorf("split draft contains non-draft task")
		}
		var dependsOn []string
		if len(task.DependsOn) > 0 {
			if err := json.Unmarshal(task.DependsOn, &dependsOn); err != nil {
				return fmt.Errorf("parse depends_on for split task %s: %w", util.UUIDToString(task.ID), err)
			}
		}
		plans = append(plans, splitTaskPlan{
			ID:        util.UUIDToString(task.ID),
			DependsOn: dependsOn,
			SortOrder: int(task.SortOrder),
			Status:    task.Status,
		})
	}
	if len(plans) == 0 {
		return fmt.Errorf("split draft submit requires at least one task")
	}
	return validateSplitTaskGraph(plans)
}

func (s *SplitOrchestrator) HandleTaskCompletion(ctx context.Context, task db.MulticaAgentTaskQueue) error {
	if !task.WorkflowNodeRunID.Valid || !isAnySplitPhase(task.Context) {
		return nil
	}
	if err := s.handleTaskCompletion(ctx, task); err != nil {
		nodeRun, loadErr := s.Queries.GetWorkflowNodeRun(ctx, task.WorkflowNodeRunID)
		if loadErr == nil && nodeRun.Status == NodeRunStatusSplitting {
			if _, transitionErr := s.WfService.TransitionNodeRun(ctx, nodeRun, NodeRunStatusFailed); transitionErr != nil {
				return fmt.Errorf("%w; mark split node failed: %v", err, transitionErr)
			}
		}
		return err
	}
	return nil
}

func (s *SplitOrchestrator) handleTaskCompletion(ctx context.Context, task db.MulticaAgentTaskQueue) error {
	nodeRun, err := s.Queries.GetWorkflowNodeRun(ctx, task.WorkflowNodeRunID)
	if err != nil {
		return fmt.Errorf("get split node run: %w", err)
	}
	if nodeRun.Status != NodeRunStatusSplitting {
		return nil
	}

	existing, err := s.Queries.ListSplitTasksByNodeRun(ctx, nodeRun.ID)
	if err != nil {
		return fmt.Errorf("list existing split tasks: %w", err)
	}
	if len(existing) > 0 {
		if err := validateDraftSplitTaskRows(existing); err == nil {
			return s.transitionSplitDraftsToReview(ctx, nodeRun)
		}
		for _, existingTask := range existing {
			switch existingTask.Status {
			case SplitTaskStatusDraft, SplitTaskStatusDiscarded:
				continue
			default:
				return fmt.Errorf("split node already has materialized tasks")
			}
		}
	}

	payload, err := s.recoverSplitGeneratedTaskPayloadFromTaskSources(ctx, task)
	if err != nil {
		if !isSplitRepairPhase(task.Context) {
			return s.dispatchSplitRepairTask(ctx, nodeRun, task, err)
		}
		return err
	}
	if err := s.replaceSplitDraftTasksFromPayload(ctx, nodeRun, existing, payload, pgtype.Text{String: DraftSourceAgent, Valid: true}); err != nil {
		return err
	}
	_, err = s.WfService.TransitionNodeRun(ctx, nodeRun, NodeRunStatusAwaitingSplitReview)
	return err
}

func (s *SplitOrchestrator) dispatchSplitRepairTask(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, sourceTask db.MulticaAgentTaskQueue, recoveryErr error) error {
	run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		return fmt.Errorf("get workflow run for split repair: %w", err)
	}
	splitIssue, err := s.Queries.GetIssueByOrigin(ctx, db.GetIssueByOriginParams{
		WorkspaceID: run.WorkspaceID,
		OriginType:  pgtype.Text{String: "workflow", Valid: true},
		OriginID:    nodeRun.ID,
	})
	if err != nil {
		return fmt.Errorf("get split sub-issue for repair: %w", err)
	}
	activeTasks, err := s.Queries.ListActiveTasksByIssue(ctx, splitIssue.ID)
	if err != nil {
		return fmt.Errorf("list active split repair tasks: %w", err)
	}
	for _, activeTask := range activeTasks {
		if activeTask.WorkflowNodeRunID == nodeRun.ID && isAnySplitPhase(activeTask.Context) && isSplitRepairPhase(activeTask.Context) {
			return nil
		}
	}

	task, err := s.WfService.DispatchAgentTaskWithContextExtras(ctx, nodeRun, "split", splitRepairContextExtras(sourceTask, recoveryErr))
	if err != nil {
		return fmt.Errorf("dispatch split repair task: %w", err)
	}
	if _, err := s.Queries.LinkNodeRunAgentTask(ctx, db.LinkNodeRunAgentTaskParams{
		ID:          nodeRun.ID,
		AgentTaskID: task.ID,
	}); err != nil {
		return fmt.Errorf("link split repair task: %w", err)
	}
	return nil
}

func splitRepairContextExtras(sourceTask db.MulticaAgentTaskQueue, recoveryErr error) map[string]any {
	reason := recoveryErr.Error()
	if len(reason) > 1000 {
		reason = reason[:1000] + "..."
	}
	sourceOutput := splitTaskResultOutput(sourceTask.Result)
	if len(sourceOutput) > 4000 {
		sourceOutput = sourceOutput[:4000] + "..."
	}
	return map[string]any{
		"phase":                  splitPhaseRepair,
		"repair":                 true,
		"repair_source_task_id":  util.UUIDToString(sourceTask.ID),
		"repair_reason":          reason,
		"repair_source_output":   sourceOutput,
		"worker_can_await_input": false,
	}
}

func (s *SplitOrchestrator) ApproveSplit(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, req SplitApproveRequest) error {
	approvedIDs := make(map[string]struct{}, len(req.ApprovedTaskIDs))
	approvedUUIDs := make([]pgtype.UUID, 0, len(req.ApprovedTaskIDs))
	for _, id := range req.ApprovedTaskIDs {
		u, err := util.ParseUUID(id)
		if err != nil {
			return fmt.Errorf("invalid approved_task_id: %w", err)
		}
		approvedIDs[id] = struct{}{}
		approvedUUIDs = append(approvedUUIDs, u)
	}

	node, err := s.Queries.GetWorkflowNode(ctx, nodeRun.WorkflowNodeID)
	if err != nil {
		return fmt.Errorf("get split node: %w", err)
	}
	cfg, err := parseSplitConfig(node.FormatSchema)
	if err != nil {
		return err
	}

	parentIssue, err := s.findParentIssue(ctx, nodeRun)
	if err != nil {
		return err
	}

	if err := s.WfService.runInTx(ctx, func(qtx *db.Queries) error {
		lockedNodeRun, err := qtx.GetWorkflowNodeRunForUpdate(ctx, nodeRun.ID)
		if err != nil {
			return fmt.Errorf("lock split node run: %w", err)
		}
		if lockedNodeRun.Status != NodeRunStatusAwaitingSplitReview {
			return fmt.Errorf("split node cannot be approved from current status")
		}

		existing, err := qtx.ListSplitTasksByNodeRun(ctx, nodeRun.ID)
		if err != nil {
			return fmt.Errorf("list split tasks: %w", err)
		}
		existingByID := splitTaskMap(existing)
		deletedIDs := make(map[string]struct{})

		for _, mod := range req.Modifications {
			switch mod.Action {
			case "add":
				dependsOn, err := json.Marshal(mod.DependsOn)
				if err != nil {
					return fmt.Errorf("marshal depends_on: %w", err)
				}
				suggestedType := ptrStringToText(mod.SuggestedAssigneeType)
				suggestedID := pgtype.UUID{}
				if mod.SuggestedAssigneeID != nil && *mod.SuggestedAssigneeID != "" {
					u, err := util.ParseUUID(*mod.SuggestedAssigneeID)
					if err != nil {
						return fmt.Errorf("invalid suggested_assignee_id: %w", err)
					}
					suggestedID = u
				}
				task, err := qtx.CreateSplitTask(ctx, db.CreateSplitTaskParams{
					NodeRunID:             nodeRun.ID,
					WorkspaceID:           parentIssue.WorkspaceID,
					Title:                 valueOrEmpty(mod.Title),
					Description:           valueOrEmpty(mod.Description),
					DependsOn:             dependsOn,
					SortOrder:             int32(len(existingByID) + len(deletedIDs)),
					Status:                SplitTaskStatusDraft,
					SuggestedAssigneeType: suggestedType,
					SuggestedAssigneeID:   suggestedID,
				})
				if err != nil {
					return fmt.Errorf("create split task: %w", err)
				}
				id := util.UUIDToString(task.ID)
				existingByID[id] = task
				approvedIDs[id] = struct{}{}
				approvedUUIDs = append(approvedUUIDs, task.ID)
			case "delete":
				if mod.ID == "" {
					return fmt.Errorf("delete modification is missing id")
				}
				deletedIDs[mod.ID] = struct{}{}
				delete(approvedIDs, mod.ID)
			default:
				if mod.ID == "" {
					return fmt.Errorf("task modification is missing id")
				}
				task, ok := existingByID[mod.ID]
				if !ok {
					return fmt.Errorf("unknown split task %s", mod.ID)
				}
				dependsOn := task.DependsOn
				if mod.DependsOn != nil {
					payload, err := json.Marshal(mod.DependsOn)
					if err != nil {
						return fmt.Errorf("marshal depends_on: %w", err)
					}
					dependsOn = payload
				}
				suggestedType := task.SuggestedAssigneeType
				suggestedID := task.SuggestedAssigneeID
				if mod.SuggestedAssigneeType != nil {
					suggestedType = ptrStringToText(mod.SuggestedAssigneeType)
					if !suggestedType.Valid {
						suggestedID = pgtype.UUID{}
					}
				}
				if mod.SuggestedAssigneeID != nil {
					if *mod.SuggestedAssigneeID == "" {
						suggestedID = pgtype.UUID{}
					} else {
						u, err := util.ParseUUID(*mod.SuggestedAssigneeID)
						if err != nil {
							return fmt.Errorf("invalid suggested_assignee_id: %w", err)
						}
						suggestedID = u
					}
				}
				updated, err := qtx.UpdateSplitTaskFields(ctx, db.UpdateSplitTaskFieldsParams{
					ID:                    task.ID,
					Title:                 ptrStringToText(mod.Title),
					Description:           ptrStringToText(mod.Description),
					SuggestedAssigneeType: suggestedType,
					SuggestedAssigneeID:   suggestedID,
					DependsOn:             dependsOn,
					SortOrder:             pgtype.Int4{},
				})
				if err != nil {
					return fmt.Errorf("update split task: %w", err)
				}
				existingByID[mod.ID] = updated
			}
		}

		current, err := qtx.ListSplitTasksByNodeRun(ctx, nodeRun.ID)
		if err != nil {
			return fmt.Errorf("reload split tasks: %w", err)
		}
		allowed := make([]db.MulticaWorkflowSplitTask, 0, len(current))
		for _, task := range current {
			id := util.UUIDToString(task.ID)
			if _, deleted := deletedIDs[id]; deleted {
				if _, err := qtx.UpdateSplitTaskStatus(ctx, db.UpdateSplitTaskStatusParams{
					ID:     task.ID,
					Status: SplitTaskStatusDiscarded,
				}); err != nil {
					return fmt.Errorf("discard split task: %w", err)
				}
				continue
			}
			if _, approved := approvedIDs[id]; approved {
				allowed = append(allowed, task)
			}
		}
		if len(allowed) == 0 {
			return fmt.Errorf("split approval requires at least one task")
		}
		plans, err := splitTaskPlansFromRows(allowed)
		if err != nil {
			return err
		}
		if err := validateSplitTaskGraph(plans); err != nil {
			return err
		}

		if err := qtx.MarkSplitTasksApproved(ctx, db.MarkSplitTasksApprovedParams{
			NodeRunID: nodeRun.ID,
			Column2:   approvedUUIDs,
		}); err != nil {
			return fmt.Errorf("mark approved split tasks: %w", err)
		}
		if err := qtx.MarkSplitTasksDiscardedExcept(ctx, db.MarkSplitTasksDiscardedExceptParams{
			NodeRunID: nodeRun.ID,
			Column2:   approvedUUIDs,
		}); err != nil {
			return fmt.Errorf("mark discarded split tasks: %w", err)
		}

		orderedIDs, err := topologicalSplitTaskIDs(plans)
		if err != nil {
			return err
		}
		allowedByID := splitTaskMap(allowed)
		for _, id := range orderedIDs {
			task := allowedByID[id]
			if task.IssueID.Valid {
				continue
			}
			issueNumber, err := qtx.IncrementIssueCounter(ctx, parentIssue.WorkspaceID)
			if err != nil {
				return fmt.Errorf("increment issue counter: %w", err)
			}
			assigneeType, assigneeID := parseSuggestedAssignee(task)
			childIssue, err := qtx.CreateIssueWithOrigin(ctx, db.CreateIssueWithOriginParams{
				WorkspaceID:   parentIssue.WorkspaceID,
				Title:         task.Title,
				Description:   textToPgText(task.Description),
				Status:        "todo",
				Priority:      parentIssue.Priority,
				AssigneeType:  assigneeType,
				AssigneeID:    assigneeID,
				CreatorType:   "member",
				CreatorID:     parentIssue.CreatorID,
				ParentIssueID: parentIssue.ID,
				Position:      0,
				Number:        issueNumber,
				ProjectID:     parentIssue.ProjectID,
				OriginType:    pgtype.Text{String: "workflow_split", Valid: true},
				OriginID:      task.ID,
				WorkflowID:    util.MustParseUUID(cfg.SubTemplateID),
			})
			if err != nil {
				return fmt.Errorf("create child issue: %w", err)
			}
			if err := qtx.UpdateSplitTaskIssueID(ctx, db.UpdateSplitTaskIssueIDParams{
				ID:      task.ID,
				IssueID: childIssue.ID,
			}); err != nil {
				return fmt.Errorf("set split task issue_id: %w", err)
			}
		}
		return nil
	}); err != nil {
		return err
	}

	currentNodeRun, err := s.Queries.GetWorkflowNodeRun(ctx, nodeRun.ID)
	if err != nil {
		return err
	}
	if currentNodeRun.Status == NodeRunStatusAwaitingSplitReview {
		if _, err := s.WfService.TransitionNodeRun(ctx, currentNodeRun, NodeRunStatusSplitActive); err != nil {
			return err
		}
	}
	if err := s.ScheduleReadyTasks(ctx, nodeRun.ID); err != nil {
		return err
	}
	return s.reconcileParentNode(ctx, nodeRun.ID)
}

func (s *SplitOrchestrator) CancelSplitNode(
	ctx context.Context,
	nodeRun db.MulticaWorkflowNodeRun,
	workspaceID pgtype.UUID,
) (*db.MulticaWorkflowNodeRun, error) {
	tasks, err := s.Queries.ListSplitTasksByNodeRun(ctx, nodeRun.ID)
	if err != nil {
		return nil, fmt.Errorf("list split tasks: %w", err)
	}

	for _, task := range tasks {
		if isTerminalSplitTaskStatus(task.Status) {
			continue
		}

		if task.RunID.Valid {
			run, err := s.Queries.GetWorkflowRun(ctx, task.RunID)
			if err != nil {
				return nil, fmt.Errorf("get child workflow run: %w", err)
			}
			if run.Status == RunStatusRunning {
				if err := s.WfService.CancelRun(ctx, task.RunID); err != nil {
					return nil, fmt.Errorf("cancel child workflow run: %w", err)
				}
			}
		}

		if task.IssueID.Valid {
			issue, err := s.Queries.GetIssue(ctx, task.IssueID)
			if err != nil {
				return nil, fmt.Errorf("get child issue: %w", err)
			}
			if issue.Status != "cancelled" && issue.Status != "done" {
				if _, err := s.Queries.UpdateIssueStatus(ctx, db.UpdateIssueStatusParams{
					ID:          task.IssueID,
					Status:      "cancelled",
					WorkspaceID: workspaceID,
				}); err != nil {
					return nil, fmt.Errorf("cancel child issue: %w", err)
				}
			}
		}
	}

	if err := s.Queries.CancelOpenSplitTasksByNodeRun(ctx, nodeRun.ID); err != nil {
		return nil, fmt.Errorf("cancel split tasks: %w", err)
	}

	if nodeRun.Status == NodeRunStatusCancelled {
		return &nodeRun, nil
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

func (s *SplitOrchestrator) ScheduleReadyTasks(ctx context.Context, nodeRunID pgtype.UUID) error {
	claimed := make([]db.MulticaWorkflowSplitTask, 0)
	var splitNodeRun db.MulticaWorkflowNodeRun
	var cfg SplitConfig
	if err := s.WfService.runInTx(ctx, func(qtx *db.Queries) error {
		nodeRun, err := qtx.GetWorkflowNodeRunForUpdate(ctx, nodeRunID)
		if err != nil {
			return err
		}
		if nodeRun.Status == NodeRunStatusCancelled {
			return nil
		}
		splitNodeRun = nodeRun
		node, err := s.Queries.GetWorkflowNode(ctx, nodeRun.WorkflowNodeID)
		if err != nil {
			return err
		}
		cfg, err = parseSplitConfig(node.FormatSchema)
		if err != nil {
			return err
		}
		tasks, err := s.Queries.ListSplitTasksByNodeRun(ctx, nodeRunID)
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
			if task.RunID.Valid || !task.IssueID.Valid {
				continue
			}
			claimedTask, err := qtx.ClaimSplitTaskForRunStart(ctx, task.ID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					continue
				}
				return err
			}
			claimed = append(claimed, claimedTask)
		}
		if err := s.markBlockedDependents(ctx, nodeRunID); err != nil {
			return err
		}
		return nil
	}); err != nil {
		return err
	}

	for _, task := range claimed {
		if err := s.startChildTaskRun(ctx, splitNodeRun, cfg, task); err != nil {
			slog.Warn("split: failed to start child workflow run", "split_task_id", util.UUIDToString(task.ID), "error", err)
			if _, updateErr := s.Queries.UpdateSplitTaskStatus(ctx, db.UpdateSplitTaskStatusParams{
				ID:     task.ID,
				Status: SplitTaskStatusFailed,
			}); updateErr != nil {
				return fmt.Errorf("start child run failed (%v) and marking failed also failed: %w", err, updateErr)
			}
		}
	}
	return nil
}

func (s *SplitOrchestrator) HandleChildRunTerminal(ctx context.Context, run db.MulticaWorkflowRun, status string) error {
	tasks, err := s.Queries.ListSplitTasksByRunID(ctx, run.ID)
	if err != nil {
		return nil
	}
	if len(tasks) == 0 {
		return nil
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

func (s *SplitOrchestrator) startChildTaskRun(ctx context.Context, splitNodeRun db.MulticaWorkflowNodeRun, cfg SplitConfig, task db.MulticaWorkflowSplitTask) error {
	workflowID, err := util.ParseUUID(cfg.SubTemplateID)
	if err != nil {
		return err
	}
	workflow, err := s.Queries.GetWorkflow(ctx, workflowID)
	if err != nil {
		return err
	}
	issue, err := s.Queries.GetIssue(ctx, task.IssueID)
	if err != nil {
		return err
	}
	dependencyContext, err := s.splitDependencyContextForTask(ctx, splitNodeRun.ID, task)
	if err != nil {
		return err
	}
	issue.Description = textToPgText(buildSplitChildIssueDescription(textToString(issue.Description), dependencyContext))

	run, nodeRuns, err := s.WfService.StartRunForIssue(ctx, workflow, issue, "api", "", pgtype.UUID{})
	if err != nil {
		return err
	}
	for _, nr := range nodeRuns {
		issueNumber, err := s.Queries.IncrementIssueCounter(ctx, issue.WorkspaceID)
		if err != nil {
			return err
		}
		if _, err := s.createWorkflowSubIssue(ctx, issue, nr, issueNumber); err != nil {
			return err
		}
	}
	s.WfService.DispatchRootNodeRuns(ctx, run.ID)

	if _, err := s.Queries.UpdateIssue(ctx, db.UpdateIssueParams{
		ID:            issue.ID,
		Title:         textToPgText(issue.Title),
		Description:   issue.Description,
		Status:        pgtype.Text{String: issue.Status, Valid: true},
		Priority:      pgtype.Text{String: issue.Priority, Valid: true},
		AssigneeType:  issue.AssigneeType,
		AssigneeID:    issue.AssigneeID,
		Position:      pgtype.Float8{Float64: issue.Position, Valid: true},
		StartDate:     issue.StartDate,
		DueDate:       issue.DueDate,
		ParentIssueID: issue.ParentIssueID,
		ProjectID:     issue.ProjectID,
		WorkflowID:    workflowID,
		WorkflowRunID: run.ID,
		StageID:       issue.StageID,
	}); err != nil {
		return err
	}

	return s.Queries.UpdateSplitTaskRunID(ctx, db.UpdateSplitTaskRunIDParams{
		ID:    task.ID,
		RunID: run.ID,
	})
}

func (s *SplitOrchestrator) splitDependencyContextForTask(
	ctx context.Context,
	splitNodeRunID pgtype.UUID,
	task db.MulticaWorkflowSplitTask,
) (string, error) {
	var dependsOn []string
	if len(task.DependsOn) > 0 {
		if err := json.Unmarshal(task.DependsOn, &dependsOn); err != nil {
			return "", fmt.Errorf("parse split task depends_on: %w", err)
		}
	}
	if len(dependsOn) == 0 {
		return "", nil
	}

	allTasks, err := s.Queries.ListSplitTasksByNodeRun(ctx, splitNodeRunID)
	if err != nil {
		return "", fmt.Errorf("list split tasks for dependency context: %w", err)
	}
	byID := splitTaskMap(allTasks)

	dependencies := make([]splitTaskDependencyContext, 0, len(dependsOn))
	for _, dependencyID := range dependsOn {
		dependencyTask, ok := byID[dependencyID]
		if !ok || !dependencyTask.RunID.Valid {
			continue
		}
		nodeRuns, err := s.Queries.ListWorkflowNodeRunsByRun(ctx, dependencyTask.RunID)
		if err != nil {
			return "", fmt.Errorf("list dependency workflow node runs: %w", err)
		}
		dependencies = append(dependencies, splitTaskDependencyContext{
			TaskTitle: dependencyTask.Title,
			NodeRuns:  nodeRuns,
		})
	}

	return buildSplitDependencyContext(dependencies), nil
}

func (s *SplitOrchestrator) createWorkflowSubIssue(
	ctx context.Context,
	parentIssue db.MulticaIssue,
	nodeRun db.MulticaWorkflowNodeRun,
	issueNumber int32,
) (db.MulticaIssue, error) {
	node, err := s.Queries.GetWorkflowNode(ctx, nodeRun.WorkflowNodeID)
	if err != nil {
		return db.MulticaIssue{}, fmt.Errorf("get workflow node: %w", err)
	}

	subTitle := fmt.Sprintf("%s — %s", parentIssue.Title, node.Title)
	var assigneeType pgtype.Text
	var assigneeID pgtype.UUID
	if node.WorkerType != "" {
		switch node.WorkerType {
		case "human":
			assigneeType = pgtype.Text{String: "member", Valid: true}
		case "agent":
			assigneeType = pgtype.Text{String: "agent", Valid: true}
		case "squad":
			assigneeType = pgtype.Text{String: "squad", Valid: true}
		}
		assigneeID = node.WorkerID
	}

	return s.Queries.CreateIssueWithOrigin(ctx, db.CreateIssueWithOriginParams{
		WorkspaceID:   parentIssue.WorkspaceID,
		Title:         subTitle,
		Description:   parentIssue.Description,
		Status:        "todo",
		Priority:      parentIssue.Priority,
		AssigneeType:  assigneeType,
		AssigneeID:    assigneeID,
		CreatorType:   "member",
		CreatorID:     parentIssue.CreatorID,
		ParentIssueID: parentIssue.ID,
		Position:      0,
		Number:        issueNumber,
		ProjectID:     parentIssue.ProjectID,
		OriginType:    pgtype.Text{String: "workflow", Valid: true},
		OriginID:      nodeRun.ID,
		WorkflowID:    node.WorkflowID,
		WorkflowRunID: nodeRun.WorkflowRunID,
		StageID:       node.StageID,
	})
}

func (s *SplitOrchestrator) markBlockedDependents(ctx context.Context, nodeRunID pgtype.UUID) error {
	tasks, err := s.Queries.ListSplitTasksByNodeRun(ctx, nodeRunID)
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
	node, err := s.Queries.GetWorkflowNode(ctx, nodeRun.WorkflowNodeID)
	if err != nil {
		return err
	}
	cfg, err := parseSplitConfig(node.FormatSchema)
	if err != nil {
		return err
	}
	tasks, err := s.Queries.ListSplitTasksByNodeRun(ctx, nodeRunID)
	if err != nil {
		return err
	}
	plans, err := splitTaskPlansFromRows(tasks)
	if err != nil {
		return err
	}
	nextStatus := resolveSplitStatus(cfg.Mode, int(cfg.MaxFailures), plans)
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

func valueOrEmpty(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func ptrStringToText(v *string) pgtype.Text {
	if v == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *v, Valid: true}
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

func isSplitRepairPhase(contextJSON []byte) bool {
	if len(contextJSON) == 0 {
		return false
	}
	var payload struct {
		Type   string `json:"type"`
		Phase  string `json:"phase"`
		Repair bool   `json:"repair"`
	}
	if err := json.Unmarshal(contextJSON, &payload); err != nil {
		return false
	}
	return payload.Type == "workflow" && payload.Phase == splitPhaseRepair && payload.Repair
}

func isSplitChatPhase(contextJSON []byte) bool {
	if len(contextJSON) == 0 {
		return false
	}
	var payload struct {
		Phase string `json:"phase"`
	}
	if err := json.Unmarshal(contextJSON, &payload); err != nil {
		return false
	}
	return payload.Phase == splitPhaseChat
}

func isAnySplitPhase(contextJSON []byte) bool {
	return isSplitGeneratePhase(contextJSON) || isSplitRepairPhase(contextJSON) || isSplitChatPhase(contextJSON)
}

func parseSplitGeneratedTaskPayload(raw []byte) (splitGeneratedTaskPayload, error) {
	if len(raw) == 0 {
		return splitGeneratedTaskPayload{}, fmt.Errorf("split task generation returned empty result")
	}

	var payload splitGeneratedTaskPayload
	if err := json.Unmarshal(raw, &payload); err == nil && len(payload.Tasks) > 0 {
		return payload, nil
	}

	var completed struct {
		Output string `json:"output"`
	}
	if err := json.Unmarshal(raw, &completed); err != nil {
		return splitGeneratedTaskPayload{}, fmt.Errorf("parse split generation result wrapper: %w", err)
	}
	if completed.Output == "" {
		return splitGeneratedTaskPayload{}, fmt.Errorf("split task generation returned empty output")
	}
	if err := json.Unmarshal([]byte(completed.Output), &payload); err != nil {
		return splitGeneratedTaskPayload{}, fmt.Errorf("parse split generation output: %w", err)
	}
	if len(payload.Tasks) == 0 {
		return splitGeneratedTaskPayload{}, fmt.Errorf("split task generation produced no tasks")
	}
	return payload, nil
}

func recoverSplitGeneratedTaskPayload(raw []byte) (splitGeneratedTaskPayload, error) {
	output := splitTaskResultOutput(raw)
	if output == "" {
		return splitGeneratedTaskPayload{}, fmt.Errorf("split task generation returned no recoverable output")
	}
	return recoverSplitGeneratedTaskPayloadFromTextCandidates([]string{output})
}

func (s *SplitOrchestrator) recoverSplitGeneratedTaskPayloadFromComments(ctx context.Context, task db.MulticaAgentTaskQueue) (splitGeneratedTaskPayload, error) {
	if !task.IssueID.Valid {
		return splitGeneratedTaskPayload{}, fmt.Errorf("split task has no issue for comment recovery")
	}
	since := task.StartedAt
	if !since.Valid {
		since = task.CreatedAt
	}
	if !since.Valid {
		return splitGeneratedTaskPayload{}, fmt.Errorf("split task has no start time for comment recovery")
	}
	issue, err := s.Queries.GetIssue(ctx, task.IssueID)
	if err != nil {
		return splitGeneratedTaskPayload{}, fmt.Errorf("load split issue for comment recovery: %w", err)
	}
	comments, err := s.Queries.ListCommentsSinceForIssue(ctx, db.ListCommentsSinceForIssueParams{
		IssueID:     task.IssueID,
		WorkspaceID: issue.WorkspaceID,
		CreatedAt:   since,
		Limit:       200,
	})
	if err != nil {
		return splitGeneratedTaskPayload{}, fmt.Errorf("list split task comments for recovery: %w", err)
	}
	candidates := make([]string, 0, len(comments))
	for _, comment := range comments {
		if comment.AuthorType != "agent" || comment.AuthorID != task.AgentID {
			continue
		}
		if strings.TrimSpace(comment.Content) == "" {
			continue
		}
		candidates = append(candidates, comment.Content)
	}
	return recoverSplitGeneratedTaskPayloadFromTextCandidates(candidates)
}

func (s *SplitOrchestrator) recoverSplitGeneratedTaskPayloadFromAttachments(ctx context.Context, task db.MulticaAgentTaskQueue) (splitGeneratedTaskPayload, error) {
	if s.AttachmentStorage == nil {
		return splitGeneratedTaskPayload{}, fmt.Errorf("split attachment recovery storage is not configured")
	}
	if !task.IssueID.Valid {
		return splitGeneratedTaskPayload{}, fmt.Errorf("split task has no issue for attachment recovery")
	}
	since := task.StartedAt
	if !since.Valid {
		since = task.CreatedAt
	}
	if !since.Valid {
		return splitGeneratedTaskPayload{}, fmt.Errorf("split task has no start time for attachment recovery")
	}
	issue, err := s.Queries.GetIssue(ctx, task.IssueID)
	if err != nil {
		return splitGeneratedTaskPayload{}, fmt.Errorf("load split issue for attachment recovery: %w", err)
	}
	attachments, err := s.Queries.ListAttachmentsByIssue(ctx, db.ListAttachmentsByIssueParams{
		IssueID:     task.IssueID,
		WorkspaceID: issue.WorkspaceID,
	})
	if err != nil {
		return splitGeneratedTaskPayload{}, fmt.Errorf("list split task attachments for recovery: %w", err)
	}
	candidates := make([]db.MulticaAttachment, 0, len(attachments))
	for _, attachment := range attachments {
		if attachment.UploaderType != "agent" || attachment.UploaderID != task.AgentID {
			continue
		}
		if attachment.CreatedAt.Valid && attachment.CreatedAt.Time.Before(since.Time) {
			continue
		}
		candidates = append(candidates, attachment)
	}
	return recoverSplitGeneratedTaskPayloadFromAttachmentCandidates(ctx, s.AttachmentStorage, candidates)
}

func recoverSplitGeneratedTaskPayloadFromTextCandidates(candidates []string) (splitGeneratedTaskPayload, error) {
	for _, candidate := range candidates {
		if strings.TrimSpace(candidate) == "" {
			continue
		}
		payload := recoverSplitTasksFromMarkdown(candidate)
		if len(payload.Tasks) > 0 {
			return payload, nil
		}
	}
	return splitGeneratedTaskPayload{}, fmt.Errorf("split task generation output did not contain recoverable tasks")
}

func recoverSplitGeneratedTaskPayloadFromAttachmentCandidates(ctx context.Context, store splitAttachmentStorage, attachments []db.MulticaAttachment) (splitGeneratedTaskPayload, error) {
	if store == nil {
		return splitGeneratedTaskPayload{}, fmt.Errorf("split attachment recovery storage is not configured")
	}
	candidates := make([]string, 0, len(attachments))
	for _, attachment := range attachments {
		if !isSplitRecoveryTextAttachment(attachment.ContentType, attachment.Filename) {
			continue
		}
		if attachment.SizeBytes > maxSplitRecoveryAttachmentBytes {
			continue
		}
		key := store.KeyFromURL(attachment.Url)
		reader, err := store.GetReader(ctx, key)
		if err != nil {
			slog.Warn("failed to open split recovery attachment", "filename", attachment.Filename, "error", err)
			continue
		}
		body, readErr := io.ReadAll(io.LimitReader(reader, maxSplitRecoveryAttachmentBytes+1))
		closeErr := reader.Close()
		if readErr != nil {
			slog.Warn("failed to read split recovery attachment", "filename", attachment.Filename, "error", readErr)
			continue
		}
		if closeErr != nil {
			slog.Warn("failed to close split recovery attachment", "filename", attachment.Filename, "error", closeErr)
		}
		if len(body) > maxSplitRecoveryAttachmentBytes {
			continue
		}
		candidates = append(candidates, string(body))
	}
	return recoverSplitGeneratedTaskPayloadFromTextCandidates(candidates)
}

func isSplitRecoveryTextAttachment(contentType, filename string) bool {
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if idx := strings.Index(ct, ";"); idx >= 0 {
		ct = strings.TrimSpace(ct[:idx])
	}
	if strings.HasPrefix(ct, "text/") {
		return true
	}
	switch ct {
	case "application/json",
		"application/javascript",
		"application/xml",
		"application/x-yaml",
		"application/yaml",
		"application/toml":
		return true
	}

	ext := strings.ToLower(path.Ext(filename))
	switch ext {
	case ".md", ".markdown",
		".txt", ".log",
		".csv", ".tsv",
		".html", ".htm",
		".json", ".xml",
		".yml", ".yaml", ".toml",
		".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
		".go", ".py", ".rb", ".rs", ".java", ".kt", ".swift",
		".c", ".cc", ".cpp", ".h", ".hpp", ".cs",
		".sql", ".sh", ".bash", ".zsh":
		return true
	}
	base := strings.ToLower(path.Base(filename))
	return base == "dockerfile" || base == "makefile"
}

func splitTaskResultOutput(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	var completed struct {
		Output string `json:"output"`
	}
	if err := json.Unmarshal(raw, &completed); err == nil {
		return strings.TrimSpace(completed.Output)
	}
	return strings.TrimSpace(string(raw))
}

func recoverSplitTasksFromMarkdown(text string) splitGeneratedTaskPayload {
	matches := markdownSplitTaskHeadingRE.FindAllStringSubmatchIndex(text, -1)
	if len(matches) == 0 {
		return splitGeneratedTaskPayload{}
	}

	tasks := make([]splitGeneratedTask, 0, len(matches))
	for i, match := range matches {
		title := strings.TrimSpace(text[match[2]:match[3]])
		title = strings.Trim(title, "#*` ")
		title = strings.TrimSpace(title)
		if title == "" {
			continue
		}

		bodyStart := match[1]
		bodyEnd := len(text)
		if i+1 < len(matches) {
			bodyEnd = matches[i+1][0]
		}
		description := strings.TrimSpace(text[bodyStart:bodyEnd])
		description = strings.Trim(description, "- \n\r\t")
		if description == "" {
			description = title
		}
		tasks = append(tasks, splitGeneratedTask{
			Title:          title,
			Description:    description,
			DependsOnIndex: []int{},
		})
	}
	return splitGeneratedTaskPayload{Tasks: tasks}
}

func (s *SplitOrchestrator) validateSubTemplate(ctx context.Context, subTemplateID string) error {
	workflowID, err := util.ParseUUID(subTemplateID)
	if err != nil {
		return fmt.Errorf("invalid split sub_template_id: %w", err)
	}
	workflow, err := s.Queries.GetWorkflow(ctx, workflowID)
	if err != nil {
		return fmt.Errorf("get split child workflow: %w", err)
	}
	if workflow.Status != "active" {
		return fmt.Errorf("split child workflow is not active")
	}
	nodes, err := s.Queries.ListWorkflowNodes(ctx, workflowID)
	if err != nil {
		return fmt.Errorf("list split child workflow nodes: %w", err)
	}
	for _, node := range nodes {
		if workflowNodeType(node.FormatSchema) == "split" {
			return fmt.Errorf("split child workflow cannot contain nested split nodes")
		}
	}
	return nil
}

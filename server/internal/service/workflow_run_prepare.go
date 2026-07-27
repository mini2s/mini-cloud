package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type PrepareWorkflowRunParams struct {
	TriggeredByType        string
	TriggeredByID          pgtype.UUID
	Input                  json.RawMessage
	RuntimeSelectionPolicy string
	RuntimeID              pgtype.UUID
	DispatchKey            string
	SourceIssueID          pgtype.UUID
	ResponsibleUserID      pgtype.UUID
	RuntimeAuthorizerID    pgtype.UUID
	defaultWorkerType      string
	defaultWorkerID        pgtype.UUID
	defaultCriticType      string
	defaultCriticID        pgtype.UUID
}

type PreparedWorkflowRun struct {
	Run      db.MulticaWorkflowRun
	NodeRuns []db.MulticaWorkflowNodeRun
}

type WorkflowConfigInvalidError struct {
	RunID  pgtype.UUID
	Issues []WorkflowConfigIssue
}

func (e *WorkflowConfigInvalidError) Error() string {
	return fmt.Sprintf("workflow configuration is invalid: %v", e.Issues)
}

func (s *WorkflowService) PrepareWorkflowRunSnapshot(
	ctx context.Context,
	workflowID pgtype.UUID,
	params PrepareWorkflowRunParams,
) (*PreparedWorkflowRun, error) {
	var prepared PreparedWorkflowRun
	var configErr *WorkflowConfigInvalidError
	err := s.runInTx(ctx, func(qtx *db.Queries) error {
		workspaceID, err := qtx.GetWorkflowWorkspaceID(ctx, workflowID)
		if err != nil {
			return err
		}
		if err := qtx.LockWorkflowRoleDefinitionsShared(ctx, workspaceID); err != nil {
			return fmt.Errorf("lock workflow role definitions: %w", err)
		}
		workflow, err := qtx.LockWorkflowDefinitionForShare(ctx, workflowID)
		if err != nil {
			return fmt.Errorf("lock workflow definition: %w", err)
		}
		if workflow.Status != "active" {
			return fmt.Errorf("workflow is not active (status=%s)", workflow.Status)
		}
		if _, err := qtx.LockWorkflowRolesForSnapshot(ctx, workflowID); err != nil {
			return fmt.Errorf("lock workflow roles: %w", err)
		}
		rows, err := loadWorkflowDefinitionRows(ctx, qtx, workflow)
		if err != nil {
			return err
		}
		snapshot, err := BuildWorkflowDefinitionSnapshot(rows)
		if err != nil {
			return err
		}
		if workflow.IsDefault && params.defaultWorkerType != "" {
			workerName, err := workflowActorSnapshotName(ctx, qtx, params.defaultWorkerType, params.defaultWorkerID)
			if err != nil {
				return fmt.Errorf("snapshot default worker name: %w", err)
			}
			criticName, err := workflowActorSnapshotName(ctx, qtx, params.defaultCriticType, params.defaultCriticID)
			if err != nil {
				return fmt.Errorf("snapshot default critic name: %w", err)
			}
			for i := range snapshot.Nodes {
				if !snapshotNodeExecutesActors(snapshot.Nodes[i].Kind) {
					continue
				}
				snapshot.Nodes[i].WorkerType = params.defaultWorkerType
				snapshot.Nodes[i].WorkerID = util.UUIDToString(params.defaultWorkerID)
				snapshot.Nodes[i].WorkerName = workerName
				snapshot.Nodes[i].WorkerRoleID = ""
				snapshot.Nodes[i].CriticType = params.defaultCriticType
				snapshot.Nodes[i].CriticID = util.UUIDToString(params.defaultCriticID)
				snapshot.Nodes[i].CriticName = criticName
				snapshot.Nodes[i].CriticRoleID = ""
			}
		}
		issues, err := validateWorkflowDefinitionForRun(ctx, qtx, workflow, snapshot)
		if err != nil {
			return err
		}
		invalid, err := s.persistPreparedWorkflowRun(ctx, qtx, workflow, snapshot, issues, params, &prepared)
		if err != nil {
			return err
		}
		configErr = invalid
		return nil
	})
	if err != nil {
		return nil, err
	}
	if configErr != nil {
		s.notifyWorkflowConfigInvalid(ctx, prepared.Run, configErr.Issues)
		return nil, configErr
	}
	return &prepared, nil
}

func workflowActorSnapshotName(ctx context.Context, qtx *db.Queries, actorType string, actorID pgtype.UUID) (string, error) {
	if !actorID.Valid {
		return "", nil
	}
	switch actorType {
	case "human", "member":
		actor, err := qtx.GetUser(ctx, actorID)
		if err != nil {
			return "", err
		}
		return actor.Name, nil
	case "agent":
		actor, err := qtx.GetAgent(ctx, actorID)
		if err != nil {
			return "", err
		}
		return actor.Name, nil
	case "squad":
		actor, err := qtx.GetSquad(ctx, actorID)
		if err != nil {
			return "", err
		}
		return actor.Name, nil
	default:
		return "", nil
	}
}

func validateWorkflowDefinitionForRun(
	ctx context.Context,
	qtx *db.Queries,
	workflow db.MulticaWorkflow,
	snapshot WorkflowDefinitionSnapshot,
) ([]WorkflowConfigIssue, error) {
	issues := ValidateWorkflowDefinition(snapshot)
	for _, node := range snapshot.Nodes {
		if node.Kind != WorkflowSnapshotNodeKindSplit || node.SplitConfig == nil {
			continue
		}
		targetID, err := util.ParseUUID(node.SplitConfig.DefaultIssueWorkflowID)
		if err != nil {
			continue
		}
		if targetID == workflow.ID {
			issues = append(issues, workflowIssue("split_config_invalid", node, "Split issue workflow cannot be the parent workflow"))
			continue
		}
		target, err := qtx.LockWorkflowDefinitionForShare(ctx, targetID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				issues = append(issues, workflowIssue("split_config_invalid", node, "Split issue workflow does not exist"))
				continue
			}
			return nil, fmt.Errorf("lock split issue workflow: %w", err)
		}
		if target.WorkspaceID != workflow.WorkspaceID {
			issues = append(issues, workflowIssue("split_config_invalid", node, "Split issue workflow belongs to another workspace"))
			continue
		}
		if target.Status != "active" {
			issues = append(issues, workflowIssue("split_config_invalid", node, "Split issue workflow is not active"))
			continue
		}
		nodes, err := qtx.ListWorkflowNodes(ctx, targetID)
		if err != nil {
			return nil, fmt.Errorf("list split issue workflow nodes: %w", err)
		}
		for _, targetNode := range nodes {
			if workflowNodeType(targetNode.FormatSchema) == WorkflowSnapshotNodeKindSplit {
				issues = append(issues, workflowIssue("split_config_invalid", node, "Split issue workflow cannot contain nested split nodes"))
				break
			}
		}
	}
	slices.SortFunc(issues, compareWorkflowConfigIssue)
	return issues, nil
}

func (s *WorkflowService) notifyWorkflowConfigInvalid(ctx context.Context, run db.MulticaWorkflowRun, issues []WorkflowConfigIssue) {
	s.publishWorkflowEvent(EventWorkflowRunFailed, util.UUIDToString(run.WorkspaceID), map[string]any{
		"run_id": util.UUIDToString(run.ID), "workflow_id": util.UUIDToString(run.WorkflowID),
		"failure_reason": "config_invalid", "issues": issues,
	})
	if !run.ResponsibleUserID.Valid {
		return
	}
	details, err := json.Marshal(map[string]any{
		"run_id": util.UUIDToString(run.ID), "workflow_id": util.UUIDToString(run.WorkflowID), "issues": issues,
	})
	if err != nil {
		slog.Warn("workflow config invalid: encode inbox details", "run_id", util.UUIDToString(run.ID), "error", err)
		return
	}
	if _, err := s.Queries.CreateInboxItem(ctx, db.CreateInboxItemParams{
		WorkspaceID: run.WorkspaceID, RecipientType: "member", RecipientID: run.ResponsibleUserID,
		Type: "workflow_config_invalid", Severity: "action_required", IssueID: run.SourceIssueID,
		Title:     "Workflow configuration needs attention",
		Body:      pgtype.Text{String: "The workflow could not start because its configuration is invalid.", Valid: true},
		ActorType: pgtype.Text{String: "system", Valid: true}, Details: details,
	}); err != nil {
		slog.Warn("workflow config invalid: create inbox notification", "run_id", util.UUIDToString(run.ID), "error", err)
	}
}

func loadWorkflowDefinitionRows(
	ctx context.Context,
	qtx *db.Queries,
	workflow db.MulticaWorkflow,
) (WorkflowDefinitionRows, error) {
	row, err := qtx.ListWorkflowDefinitionForSnapshot(ctx, workflow.ID)
	if err != nil {
		return WorkflowDefinitionRows{}, fmt.Errorf("load workflow definition snapshot: %w", err)
	}
	rows := WorkflowDefinitionRows{
		Workflow: WorkflowSnapshotWorkflow{
			ID: util.UUIDToString(row.WorkflowID), WorkspaceID: util.UUIDToString(row.WorkspaceID),
			Title: row.Title, Description: row.Description, IsDefault: row.IsDefault, MaxRetries: row.MaxRetries,
			RuntimeSelectionPolicy: row.DefaultRuntimeSelectionPolicy,
			RuntimeID:              util.UUIDToString(row.DefaultRuntimeID), ConfigRevision: row.ConfigRevision,
		},
	}
	items := []struct {
		raw  string
		dest any
		name string
	}{
		{row.Nodes, &rows.Nodes, "nodes"},
		{row.Edges, &rows.Edges, "edges"},
		{row.Stages, &rows.Stages, "stages"},
		{row.Roles, &rows.Roles, "roles"},
		{row.Deliverables, &rows.Deliverables, "deliverables"},
	}
	for _, item := range items {
		if err := json.Unmarshal([]byte(item.raw), item.dest); err != nil {
			return WorkflowDefinitionRows{}, fmt.Errorf("decode workflow snapshot %s: %w", item.name, err)
		}
	}
	for i := range rows.Nodes {
		if rows.Nodes[i].WorkerRoleID != "" {
			rows.Nodes[i].WorkerType = "role"
		}
		if rows.Nodes[i].CriticRoleID != "" {
			rows.Nodes[i].CriticType = "role"
		}
	}
	return rows, nil
}

func (s *WorkflowService) persistPreparedWorkflowRun(
	ctx context.Context,
	qtx *db.Queries,
	workflow db.MulticaWorkflow,
	snapshot WorkflowDefinitionSnapshot,
	issues []WorkflowConfigIssue,
	params PrepareWorkflowRunParams,
	prepared *PreparedWorkflowRun,
) (*WorkflowConfigInvalidError, error) {
	resolvedPolicy, resolvedRuntimeID, err := resolveWorkflowRuntimeSelectionPolicy(workflow, params.RuntimeSelectionPolicy, params.RuntimeID)
	if err != nil {
		return nil, err
	}
	snapshotJSON, err := json.Marshal(snapshot)
	if err != nil {
		return nil, fmt.Errorf("marshal workflow definition snapshot: %w", err)
	}
	hasRoleSlots := false
	for _, node := range snapshot.Nodes {
		hasRoleSlots = hasRoleSlots || node.WorkerRoleID != "" || node.CriticRoleID != ""
	}
	autoResolveRoles := hasRoleSlots && s.roleResolutionEnabledFor(workflow.WorkspaceID)
	runStatus := RunStatusRunning
	if len(issues) > 0 {
		runStatus = RunStatusFailed
	} else if hasRoleSlots {
		runStatus = RunStatusWaitingRoleAssignment
		if autoResolveRoles {
			runStatus = RunStatusResolvingRoles
		}
	}
	validationErrors, err := json.Marshal(issues)
	if err != nil {
		return nil, fmt.Errorf("marshal workflow validation issues: %w", err)
	}
	dispatchKey := pgtype.Text{}
	if params.DispatchKey != "" {
		dispatchKey = pgtype.Text{String: params.DispatchKey, Valid: true}
	}
	failureReason := pgtype.Text{}
	if len(issues) > 0 {
		failureReason = pgtype.Text{String: "config_invalid", Valid: true}
	}
	run, err := qtx.CreateWorkflowRunSnapshot(ctx, db.CreateWorkflowRunSnapshotParams{
		WorkflowID: workflow.ID, WorkspaceID: workflow.WorkspaceID, WorkflowTitle: workflow.Title,
		Status: runStatus, TriggeredByType: params.TriggeredByType, TriggeredByID: params.TriggeredByID,
		Input: params.Input, RuntimeSelectionPolicy: resolvedPolicy, RuntimeID: resolvedRuntimeID,
		DispatchKey: dispatchKey, SourceIssueID: params.SourceIssueID,
		ResponsibleUserID: params.ResponsibleUserID, RuntimeAuthorizerID: params.RuntimeAuthorizerID,
		SourceConfigRevision: workflow.ConfigRevision, DefinitionSchemaVersion: int32(WorkflowDefinitionSchemaVersion),
		DefinitionSnapshot: snapshotJSON, MaxRetries: workflow.MaxRetries,
		FailureReason: failureReason, ValidationErrors: validationErrors,
	})
	if err != nil {
		return nil, fmt.Errorf("create workflow run snapshot: %w", err)
	}
	prepared.Run = run
	existingNodeRuns, err := qtx.ListWorkflowNodeRunsByRun(ctx, run.ID)
	if err != nil {
		return nil, fmt.Errorf("list prepared workflow node runs: %w", err)
	}
	if len(existingNodeRuns) > 0 {
		prepared.NodeRuns = existingNodeRuns
		return nil, nil
	}
	if run.FailureReason.Valid && run.FailureReason.String == "config_invalid" {
		var existingIssues []WorkflowConfigIssue
		if err := json.Unmarshal(run.ValidationErrors, &existingIssues); err != nil {
			return nil, fmt.Errorf("decode existing workflow validation issues: %w", err)
		}
		return &WorkflowConfigInvalidError{RunID: run.ID, Issues: existingIssues}, nil
	}
	if len(issues) > 0 {
		return &WorkflowConfigInvalidError{RunID: run.ID, Issues: issues}, nil
	}

	if autoResolveRoles && s.RoleResolutionMaxActiveJobs > 0 {
		if err := qtx.LockWorkflowRoleResolutionWorkspace(ctx, workflow.WorkspaceID); err != nil {
			return nil, fmt.Errorf("lock workflow role resolution workspace: %w", err)
		}
		activeJobs, err := qtx.CountActiveWorkflowRoleResolutionJobsForWorkspace(ctx, workflow.WorkspaceID)
		if err != nil {
			return nil, fmt.Errorf("count active workflow role resolution jobs: %w", err)
		}
		if activeJobs >= s.RoleResolutionMaxActiveJobs {
			return nil, ErrWorkflowRoleResolutionLimit
		}
	}

	runtimeNodeIDs := make(map[string]bool, len(snapshot.Nodes))
	for _, node := range snapshot.Nodes {
		if snapshotNodeCreatesRun(node.Kind) {
			runtimeNodeIDs[node.ID] = true
		}
	}
	runtimeEdges := make([]WorkflowSnapshotEdge, 0, len(snapshot.Edges))
	hasIncoming := make(map[string]bool, len(snapshot.Nodes))
	for _, edge := range snapshot.Edges {
		if runtimeNodeIDs[edge.SourceNodeID] && runtimeNodeIDs[edge.TargetNodeID] {
			runtimeEdges = append(runtimeEdges, edge)
			hasIncoming[edge.TargetNodeID] = true
		}
	}
	stageByID := make(map[string]WorkflowSnapshotStage, len(snapshot.Stages))
	for _, stage := range snapshot.Stages {
		stageByID[stage.ID] = stage
	}
	roleByID := make(map[string]WorkflowSnapshotRole, len(snapshot.Roles))
	for _, role := range snapshot.Roles {
		roleByID[role.ID] = role
	}
	nodeRunBySourceID := make(map[string]db.MulticaWorkflowNodeRun, len(runtimeNodeIDs))
	for _, node := range snapshot.Nodes {
		if !runtimeNodeIDs[node.ID] {
			continue
		}
		status := NodeRunStatusPending
		if hasRoleSlots {
			status = NodeRunStatusBlocked
		} else if !hasIncoming[node.ID] {
			status = NodeRunStatusFormatOk
		}
		stageSnapshot, err := marshalOptionalSnapshot(stageByID[node.StageID], node.StageID != "")
		if err != nil {
			return nil, err
		}
		workerRoleSnapshot, err := marshalOptionalSnapshot(roleByID[node.WorkerRoleID], node.WorkerRoleID != "")
		if err != nil {
			return nil, err
		}
		criticRoleSnapshot, err := marshalOptionalSnapshot(roleByID[node.CriticRoleID], node.CriticRoleID != "")
		if err != nil {
			return nil, err
		}
		runtimeConfig := json.RawMessage(`{}`)
		if node.SplitConfig != nil {
			runtimeConfig, err = json.Marshal(map[string]any{"split_config": node.SplitConfig})
			if err != nil {
				return nil, err
			}
		}
		nodeRun, err := qtx.CreateWorkflowNodeRunSnapshot(ctx, db.CreateWorkflowNodeRunSnapshotParams{
			WorkflowRunID: run.ID, WorkflowNodeID: parseSnapshotUUID(node.ID), NodeTitle: node.Title,
			NodeDescription: node.Description, Status: status, RetryCount: 0,
			WorkerType: node.WorkerType, WorkerID: parseSnapshotUUID(node.WorkerID),
			CriticType: node.CriticType, CriticID: parseSnapshotUUID(node.CriticID),
			FormatSchema: node.FormatSchema, CriticApiUrl: optionalSnapshotText(node.CriticAPIURL),
			StageSnapshot: stageSnapshot, WorkerRoleSnapshot: workerRoleSnapshot,
			CriticRoleSnapshot: criticRoleSnapshot, RuntimeConfig: runtimeConfig,
			WorkerNameSnapshot: node.WorkerName, CriticNameSnapshot: node.CriticName,
		})
		if err != nil {
			return nil, fmt.Errorf("create snapshot node run %q: %w", node.Title, err)
		}
		prepared.NodeRuns = append(prepared.NodeRuns, nodeRun)
		nodeRunBySourceID[node.ID] = nodeRun

		for _, slot := range []struct {
			slotType string
			roleID   string
		}{{"worker", node.WorkerRoleID}, {"critic", node.CriticRoleID}} {
			if slot.roleID == "" {
				continue
			}
			role := roleByID[slot.roleID]
			resolutionStatus, reasonCode := "pending", ""
			if !autoResolveRoles {
				resolutionStatus, reasonCode = "needs_human", "resolver_not_configured"
			}
			if role.Description == "" {
				resolutionStatus, reasonCode = "needs_human", "insufficient_data"
			}
			if _, err := qtx.CreateWorkflowRoleResolution(ctx, db.CreateWorkflowRoleResolutionParams{
				WorkflowRunID: run.ID, WorkflowNodeRunID: nodeRun.ID, SlotType: slot.slotType,
				RoleID: parseSnapshotUUID(slot.roleID), RoleNameSnapshot: role.Name,
				RoleDescriptionSnapshot: role.Description, Status: resolutionStatus,
				ReasonCode: reasonCode, ReasonDetail: "",
			}); err != nil {
				return nil, fmt.Errorf("create %s role resolution for %q: %w", slot.slotType, node.Title, err)
			}
		}
	}
	for _, edge := range runtimeEdges {
		if _, err := qtx.CreateRunEdge(ctx, db.CreateRunEdgeParams{
			WorkflowRunID: run.ID, SourceNodeRunID: nodeRunBySourceID[edge.SourceNodeID].ID,
			TargetNodeRunID: nodeRunBySourceID[edge.TargetNodeID].ID, Condition: edge.Condition,
		}); err != nil {
			return nil, fmt.Errorf("create snapshot run edge %q: %w", edge.ID, err)
		}
	}
	for _, deliverable := range snapshot.Deliverables {
		nodeRun, ok := nodeRunBySourceID[deliverable.WorkflowNodeID]
		if !ok {
			continue
		}
		if _, err := qtx.CreateNodeRunDeliverableRequirement(ctx, db.CreateNodeRunDeliverableRequirementParams{
			WorkflowNodeRunID: nodeRun.ID, SourceDeliverableID: parseSnapshotUUID(deliverable.ID),
			Kind: deliverable.Kind, Title: deliverable.Title, Description: deliverable.Description,
			Required: deliverable.Required, SortOrder: deliverable.SortOrder,
		}); err != nil {
			return nil, fmt.Errorf("create snapshot deliverable %q: %w", deliverable.Title, err)
		}
	}
	if hasRoleSlots && !autoResolveRoles {
		resolutions, err := qtx.ListWorkflowRoleResolutions(ctx, run.ID)
		if err != nil {
			return nil, fmt.Errorf("list manual workflow role resolutions: %w", err)
		}
		if err := enqueueWorkflowRoleManualNotifications(ctx, qtx, run, resolutions); err != nil {
			return nil, fmt.Errorf("enqueue manual workflow role notifications: %w", err)
		}
	}
	if autoResolveRoles {
		if _, err := qtx.CreateWorkflowRoleResolutionJob(ctx, db.CreateWorkflowRoleResolutionJobParams{
			WorkspaceID: workflow.WorkspaceID, WorkflowRunID: run.ID,
			Model: s.RoleResolutionModel, PromptVersion: s.RoleResolutionPromptVersion,
		}); err != nil {
			return nil, fmt.Errorf("create workflow role resolution job: %w", err)
		}
	}
	if !hasRoleSlots {
		for sourceID, nodeRun := range nodeRunBySourceID {
			if hasIncoming[sourceID] {
				continue
			}
			if err := EnqueueWorkflowDispatch(ctx, qtx, nodeRun.ID, "worker", 1); err != nil {
				return nil, fmt.Errorf("create root workflow dispatch job: %w", err)
			}
		}
	}
	return nil, nil
}

func marshalOptionalSnapshot(value any, valid bool) ([]byte, error) {
	if !valid {
		return nil, nil
	}
	return json.Marshal(value)
}

func parseSnapshotUUID(value string) pgtype.UUID {
	id, err := util.ParseUUID(value)
	if err != nil {
		return pgtype.UUID{}
	}
	return id
}

func optionalSnapshotText(value string) pgtype.Text {
	if value == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: value, Valid: true}
}

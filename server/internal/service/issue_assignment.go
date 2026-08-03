package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

var (
	ErrInvalidAssignee   = errors.New("invalid issue assignee")
	ErrForbiddenAssignee = errors.New("forbidden issue assignee")
)

type AssigneeRef struct {
	Type string
	ID   pgtype.UUID
}

type AssignmentActor struct {
	Type string
	ID   pgtype.UUID
}

type RuntimeSelection struct {
	Policy    string
	RuntimeID pgtype.UUID
}

type IssueAssignmentHooks struct {
	CanAccessPrivateAgent   func(context.Context, db.MulticaAgent, AssignmentActor, pgtype.UUID) bool
	CreateWorkflowSubIssues func(context.Context, db.MulticaIssue, db.MulticaWorkflowRun, []db.MulticaWorkflowNodeRun) error
	DefaultWorkflowEnabled  func() bool
}

type IssueAssignmentService struct {
	Queries   *db.Queries
	Tasks     *TaskService
	Workflows *WorkflowService
	Hooks     IssueAssignmentHooks
}

func IssueStatusStartsWork(status string) bool {
	return status == "in_progress"
}

func (s *IssueAssignmentService) ValidateAssignee(
	ctx context.Context,
	q *db.Queries,
	workspaceID pgtype.UUID,
	actor AssignmentActor,
	assignee AssigneeRef,
) error {
	if !assignee.ID.Valid {
		return fmt.Errorf("%w: assignee id is required", ErrInvalidAssignee)
	}
	if q == nil {
		if assignee.Type != "member" && assignee.Type != "agent" && assignee.Type != "squad" && assignee.Type != "workflow" {
			return fmt.Errorf("%w: unsupported assignee type %q", ErrInvalidAssignee, assignee.Type)
		}
		return fmt.Errorf("%w: queries are required", ErrInvalidAssignee)
	}

	switch assignee.Type {
	case "member":
		member, err := q.GetMemberByUserAndWorkspace(ctx, db.GetMemberByUserAndWorkspaceParams{UserID: assignee.ID, WorkspaceID: workspaceID})
		if err != nil || member.Status != "active" {
			return fmt.Errorf("%w: assignee is not an active workspace member", ErrInvalidAssignee)
		}
	case "agent":
		agent, err := q.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{ID: assignee.ID, WorkspaceID: workspaceID})
		if err != nil {
			agent, err = q.GetBuiltinAgent(ctx, assignee.ID)
			if err != nil {
				return fmt.Errorf("%w: assignee is not an agent in this workspace", ErrInvalidAssignee)
			}
		}
		if agent.ArchivedAt.Valid {
			return fmt.Errorf("%w: agent is archived", ErrInvalidAssignee)
		}
		if agent.Visibility == "private" && (s.Hooks.CanAccessPrivateAgent == nil || !s.Hooks.CanAccessPrivateAgent(ctx, agent, actor, workspaceID)) {
			return fmt.Errorf("%w: private agent is not accessible", ErrForbiddenAssignee)
		}
	case "squad":
		squad, err := q.GetSquadInWorkspace(ctx, db.GetSquadInWorkspaceParams{ID: assignee.ID, WorkspaceID: workspaceID})
		if err != nil || squad.ArchivedAt.Valid {
			return fmt.Errorf("%w: assignee is not an active squad in this workspace", ErrInvalidAssignee)
		}
		leader, err := q.GetAgent(ctx, squad.LeaderID)
		if err != nil || leader.ArchivedAt.Valid {
			return fmt.Errorf("%w: squad leader is archived", ErrInvalidAssignee)
		}
	case "workflow":
		workflow, err := q.GetWorkflowInWorkspace(ctx, db.GetWorkflowInWorkspaceParams{ID: assignee.ID, WorkspaceID: workspaceID})
		if err != nil || workflow.IsDefault || workflow.Status != "active" {
			return fmt.Errorf("%w: assignee is not an active assignable workflow", ErrInvalidAssignee)
		}
		nodes, err := q.ListWorkflowNodes(ctx, assignee.ID)
		if err != nil {
			return fmt.Errorf("inspect assignee workflow: %w", err)
		}
		for _, node := range nodes {
			if node.WorkerType == "" {
				return fmt.Errorf("%w: workflow node %q has no worker type", ErrInvalidAssignee, node.Title)
			}
		}
	default:
		return fmt.Errorf("%w: unsupported assignee type %q", ErrInvalidAssignee, assignee.Type)
	}
	return nil
}

func (s *IssueAssignmentService) AfterIssueAssigned(
	ctx context.Context,
	prev db.MulticaIssue,
	issue db.MulticaIssue,
	actor AssignmentActor,
	runtimeSelection RuntimeSelection,
) error {
	if s.Queries == nil || s.Tasks == nil || s.Workflows == nil {
		return errors.New("issue assignment service is not configured")
	}
	s.Tasks.CancelTasksForIssue(ctx, issue.ID)
	if prev.WorkflowRunID.Valid {
		if err := s.Workflows.CancelRun(ctx, prev.WorkflowRunID); err != nil {
			slog.Warn("failed to cancel workflow run on reassign", "error", err)
		}
	}
	if !IssueStatusStartsWork(issue.Status) {
		return nil
	}
	if !issue.AssigneeType.Valid || !issue.AssigneeID.Valid {
		return nil
	}

	switch issue.AssigneeType.String {
	case "agent":
		agent, err := s.Queries.GetAgent(ctx, issue.AssigneeID)
		if err != nil || agent.ArchivedAt.Valid || (!agent.RuntimeID.Valid && !agent.IsBuiltin) {
			return nil
		}
		_, err = s.Tasks.EnqueueTaskForIssue(ctx, issue, pgtype.UUID{}, runtimeSelection.RuntimeID)
		return err
	case "squad":
		squad, err := s.Queries.GetSquadInWorkspace(ctx, db.GetSquadInWorkspaceParams{ID: issue.AssigneeID, WorkspaceID: issue.WorkspaceID})
		if err != nil {
			return nil
		}
		leader, err := s.Queries.GetAgent(ctx, squad.LeaderID)
		if err != nil {
			return nil
		}
		ready, _, err := AgentReadiness(ctx, s.Queries, leader)
		if err != nil || !ready {
			return nil
		}
		hasPending, err := s.Queries.HasPendingTaskForIssueAndAgent(ctx, db.HasPendingTaskForIssueAndAgentParams{IssueID: issue.ID, AgentID: squad.LeaderID})
		if err != nil || hasPending {
			return err
		}
		_, err = s.Tasks.EnqueueTaskForSquadLeader(ctx, issue, squad.LeaderID, pgtype.UUID{})
		return err
	case "member":
		s.startDefaultWorkflow(ctx, issue)
		return nil
	case "workflow":
		if issue.WorkflowRunID.Valid {
			return nil
		}
		workflow, err := s.Queries.GetWorkflow(ctx, issue.AssigneeID)
		if err != nil {
			return err
		}
		run, nodeRuns, err := s.Workflows.StartRunForIssueWithRuntimeSelection(
			ctx, workflow, issue, actor.Type, util.UUIDToString(actor.ID), runtimeSelection.Policy, runtimeSelection.RuntimeID,
		)
		if err != nil {
			var invalid *WorkflowConfigInvalidError
			if errors.As(err, &invalid) {
				if stampErr := s.stampWorkflowRun(ctx, issue, issue.AssigneeID, invalid.RunID); stampErr != nil {
					return errors.Join(err, fmt.Errorf("stamp failed workflow run: %w", stampErr))
				}
			}
			return err
		}
		if s.Hooks.CreateWorkflowSubIssues != nil {
			if err := s.Hooks.CreateWorkflowSubIssues(ctx, issue, *run, nodeRuns); err != nil {
				return err
			}
		}
		return s.stampWorkflowRun(ctx, issue, issue.AssigneeID, run.ID)
	}
	return nil
}

func (s *IssueAssignmentService) startDefaultWorkflow(ctx context.Context, issue db.MulticaIssue) bool {
	if s.Hooks.DefaultWorkflowEnabled == nil || !s.Hooks.DefaultWorkflowEnabled() {
		return false
	}
	run, _, err := s.Workflows.StartDefaultRunForIssue(ctx, issue)
	if err != nil {
		slog.Warn("default workflow run failed", "issue_id", issue.ID, "error", err)
		return false
	}
	if err := s.stampWorkflowRun(ctx, issue, run.WorkflowID, run.ID); err != nil {
		slog.Warn("failed to stamp default workflow run on issue", "issue_id", issue.ID, "error", err)
	}
	return true
}

func (s *IssueAssignmentService) stampWorkflowRun(ctx context.Context, issue db.MulticaIssue, workflowID, runID pgtype.UUID) error {
	_, err := s.Queries.UpdateIssue(ctx, db.UpdateIssueParams{
		ID: issue.ID, AssigneeType: issue.AssigneeType, AssigneeID: issue.AssigneeID,
		StartDate: issue.StartDate, DueDate: issue.DueDate, ParentIssueID: issue.ParentIssueID,
		ProjectID: issue.ProjectID, WorkflowID: workflowID, WorkflowRunID: runID,
	})
	return err
}

package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"

	"github.com/multica-ai/multica/server/internal/util"
)

// commandPromptQueries defines the subset of *db.Queries methods needed by BuildCommandPrompt.
type commandPromptQueries interface {
	GetIssue(ctx context.Context, id pgtype.UUID) (db.MulticaIssue, error)
	ListAgents(ctx context.Context, workspaceID pgtype.UUID) ([]db.MulticaAgent, error)
	ListSquads(ctx context.Context, workspaceID pgtype.UUID) ([]db.MulticaSquad, error)
	ListMembersWithUser(ctx context.Context, workspaceID pgtype.UUID) ([]db.ListMembersWithUserRow, error)
	ListWorkflows(ctx context.Context, arg db.ListWorkflowsParams) ([]db.MulticaWorkflow, error)
}

// BuildCommandPrompt constructs the prompt sent to the agent for AI command tasks.
// The prompt includes workspace context (agents, squads, members, workflows),
// chat history for multi-turn context, and the user's NL input.
func BuildCommandPrompt(
	ctx context.Context,
	queries commandPromptQueries,
	workspaceID pgtype.UUID,
	cmdCtx CommandContext,
) (string, error) {
	var b strings.Builder
	var errs []error

	// System instruction based on context_type
	switch cmdCtx.ContextType {
	case "issue":
		b.WriteString("You are an issue management agent.\n")
		b.WriteString("You can: assign issues, change status, set priority, add/remove labels.\n")
		b.WriteString("Use the available tools to execute the user's command.\n\n")

		// Load issue context if context_id is provided
		if cmdCtx.ContextID != "" {
			id, err := util.ParseUUID(cmdCtx.ContextID)
			if err == nil {
				issue, err := queries.GetIssue(ctx, id)
				if err != nil {
					slog.Warn("failed to fetch issue for command prompt", "issue_id", cmdCtx.ContextID, "error", err)
					errs = append(errs, fmt.Errorf("get issue: %w", err))
				} else {
					fmt.Fprintf(&b, "Current issue: %s (status: %s, priority: %s)\n\n",
						issue.Title, issue.Status, issue.Priority)
				}
			} else {
				slog.Warn("invalid issue context ID", "context_id", cmdCtx.ContextID, "error", err)
				errs = append(errs, fmt.Errorf("parse issue context ID: %w", err))
			}
		}

	case "workflow":
		b.WriteString("You are a workflow design agent.\n")
		b.WriteString("You create and modify workflows based on natural language descriptions.\n")
		b.WriteString("Use the workflow tools to build the requested automation.\n\n")

	case "inbox":
		b.WriteString("You are an inbox management agent.\n")
		b.WriteString("You can: archive items, mark as read, summarize activity.\n")
		b.WriteString("Use the available tools to execute the user's command.\n\n")

	case "agent":
		b.WriteString("You are an agent configuration assistant.\n")
		b.WriteString("You create agents based on natural language descriptions.\n")
		b.WriteString("Extract: name, model provider, skills, and description from the user's input.\n\n")
	}

	// Add workspace context: available agents, squads, members, workflow templates
	b.WriteString("---\nWorkspace resources:\n")

	agents, err := queries.ListAgents(ctx, workspaceID)
	if err != nil {
		slog.Warn("failed to list agents for command prompt", "error", err)
		errs = append(errs, fmt.Errorf("list agents: %w", err))
	} else if len(agents) > 0 {
		b.WriteString("Available agents:\n")
		for _, a := range agents {
			desc := ""
			if a.Description != "" {
				desc = " - " + a.Description
			}
			fmt.Fprintf(&b, "- %s%s\n", a.Name, desc)
		}
		b.WriteString("\n")
	}

	squads, err := queries.ListSquads(ctx, workspaceID)
	if err != nil {
		slog.Warn("failed to list squads for command prompt", "error", err)
		errs = append(errs, fmt.Errorf("list squads: %w", err))
	} else if len(squads) > 0 {
		b.WriteString("Available squads:\n")
		for _, s := range squads {
			fmt.Fprintf(&b, "- %s\n", s.Name)
		}
		b.WriteString("\n")
	}

	members, err := queries.ListMembersWithUser(ctx, workspaceID)
	if err != nil {
		slog.Warn("failed to list members for command prompt", "error", err)
		errs = append(errs, fmt.Errorf("list members: %w", err))
	} else if len(members) > 0 {
		b.WriteString("Workspace members:\n")
		for _, m := range members {
			fmt.Fprintf(&b, "- %s (%s)\n", m.UserName, m.UserEmail)
		}
		b.WriteString("\n")
	}

	// Include workflow templates for reuse/matching
	workflows, err := queries.ListWorkflows(ctx, db.ListWorkflowsParams{
		WorkspaceID: workspaceID,
		Limit:       50,
		Offset:      0,
		Status:      pgtype.Text{String: "active", Valid: true},
	})
	if err != nil {
		slog.Warn("failed to list workflows for command prompt", "error", err)
		errs = append(errs, fmt.Errorf("list workflows: %w", err))
	} else if len(workflows) > 0 {
		b.WriteString("Existing workflows (templates for reuse):\n")
		for _, w := range workflows {
			desc := ""
			if w.Description != "" {
				desc = " - " + w.Description
			}
			fmt.Fprintf(&b, "- %s%s\n", w.Title, desc)
		}
		b.WriteString("\n")
	}

	b.WriteString("---\n")

	// Include chat history for multi-turn context (workflow chat mode)
	if cmdCtx.Mode == "chat" && len(cmdCtx.Messages) > 0 {
		b.WriteString("Conversation history:\n")
		for _, m := range cmdCtx.Messages {
			label := "User"
			if m.Role == "assistant" {
				label = "Assistant"
			}
			fmt.Fprintf(&b, "%s: %s\n", label, m.Content)
		}
		b.WriteString("\n")
	}

	fmt.Fprintf(&b, "User command: %s\n", cmdCtx.UserInput)

	return b.String(), errors.Join(errs...)
}

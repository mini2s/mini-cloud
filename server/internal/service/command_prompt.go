package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"

	"github.com/multica-ai/multica/server/internal/util"
)

// BuildCommandPrompt constructs the prompt sent to the agent for AI command tasks.
// The prompt includes workspace context (agents, squads, members) and the user's NL input.
func BuildCommandPrompt(
	ctx context.Context,
	queries *db.Queries,
	workspaceID pgtype.UUID,
	cmdCtx CommandContext,
) (string, error) {
	var b strings.Builder

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
				if err == nil {
					fmt.Fprintf(&b, "Current issue: %s (status: %s, priority: %s)\n\n",
						issue.Title, issue.Status, issue.Priority)
				}
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

	// Add workspace context: available agents, squads, members
	b.WriteString("---\nWorkspace resources:\n")

	agents, _ := queries.ListAgents(ctx, workspaceID)
	if len(agents) > 0 {
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

	squads, _ := queries.ListSquads(ctx, workspaceID)
	if len(squads) > 0 {
		b.WriteString("Available squads:\n")
		for _, s := range squads {
			fmt.Fprintf(&b, "- %s\n", s.Name)
		}
		b.WriteString("\n")
	}

	members, _ := queries.ListMembersWithUser(ctx, workspaceID)
	if len(members) > 0 {
		b.WriteString("Workspace members:\n")
		for _, m := range members {
			fmt.Fprintf(&b, "- %s (%s)\n", m.UserName, m.UserEmail)
		}
		b.WriteString("\n")
	}

	b.WriteString("---\n")
	fmt.Fprintf(&b, "User command: %s\n", cmdCtx.UserInput)

	return b.String(), nil
}

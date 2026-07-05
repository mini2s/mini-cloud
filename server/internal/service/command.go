package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// CommandContext is stored in agent_task_queue.context for AI command tasks.
type CommandContext struct {
	Type        string `json:"type"`         // always "ai_command"
	ContextType string `json:"context_type"` // "workflow" | "issue" | "inbox" | "agent"
	ContextID   string `json:"context_id"`   // entity ID (issue UUID, workflow UUID, etc.)
	UserInput   string `json:"user_input"`   // the raw NL input
	Mode        string `json:"mode"`         // "chat" | "command"
	Prompt      string `json:"prompt,omitempty"` // built prompt sent to agent
}

type CommandTaskParams struct {
	AgentID     pgtype.UUID
	RuntimeID   pgtype.UUID
	Priority    int32
	WorkspaceID pgtype.UUID
	CtxPayload  CommandContext
}

// EnqueueCommandTask creates an AI command task and notifies the daemon.
// It does NOT broadcast task:queued — command tasks complete quickly, and
// frontend feedback comes via optimistic updates + task:completed/failed.
func (s *TaskService) EnqueueCommandTask(ctx context.Context, params CommandTaskParams) (db.MulticaAgentTaskQueue, error) {
	// Build and include the prompt in the context
	prompt, err := BuildCommandPrompt(ctx, s.Queries, params.WorkspaceID, params.CtxPayload)
	if err != nil {
		// Non-fatal — agent can still work with just the user input
		slog.Warn("failed to build command prompt", "error", err)
	}
	params.CtxPayload.Prompt = prompt

	rawCtx, err := json.Marshal(params.CtxPayload)
	if err != nil {
		return db.MulticaAgentTaskQueue{}, fmt.Errorf("marshal command context: %w", err)
	}

	task, err := s.Queries.CreateCommandTask(ctx, db.CreateCommandTaskParams{
		AgentID:   params.AgentID,
		RuntimeID: params.RuntimeID,
		Priority:  params.Priority,
		Context:   rawCtx,
	})
	if err != nil {
		return db.MulticaAgentTaskQueue{}, fmt.Errorf("create command task: %w", err)
	}

	s.NotifyTaskEnqueued(ctx, task)
	return task, nil
}

// CommandContextType marks a task as an AI command job.
const CommandContextType = "ai_command"

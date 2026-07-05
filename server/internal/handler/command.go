package handler

import (
	"encoding/json"
	"net/http"

	"github.com/multica-ai/multica/server/internal/service"
)

// CommandRequest is the POST /api/commands request body.
type CommandRequest struct {
	ContextType string `json:"context_type"` // "workflow" | "issue" | "inbox" | "agent"
	ContextID   string `json:"context_id"`   // entity ID
	UserInput   string `json:"user_input"`   // NL input
	Mode        string `json:"mode"`         // "chat" | "command"
}

// CommandResponse is the POST /api/commands response body.
type CommandResponse struct {
	TaskID  string `json:"task_id"`
	AgentID string `json:"agent_id"`
}

var validContextTypes = map[string]bool{
	"workflow": true,
	"issue":    true,
	"inbox":    true,
	"agent":    true,
}

var validModes = map[string]bool{
	"chat":    true,
	"command": true,
}

func (h *Handler) SendCommand(w http.ResponseWriter, r *http.Request) {
	_, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace_id")
	if !ok {
		return
	}

	var req CommandRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate context_type
	if !validContextTypes[req.ContextType] {
		writeError(w, http.StatusBadRequest, "context_type must be one of: workflow, issue, inbox, agent")
		return
	}

	// Validate mode
	if !validModes[req.Mode] {
		writeError(w, http.StatusBadRequest, "mode must be one of: chat, command")
		return
	}

	// Validate user_input
	if req.UserInput == "" {
		writeError(w, http.StatusBadRequest, "user_input is required")
		return
	}

	// Resolve context_id to a UUID (only when provided)
	var contextID string
	if req.ContextID != "" {
		id, ok := parseUUIDOrBadRequest(w, req.ContextID, "context_id")
		if !ok {
			return
		}
		contextID = uuidToString(id)
	}

	// Resolve agent: use ListAgents and take the first non-archived agent.
	agents, err := h.Queries.ListAgents(r.Context(), wsUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list agents")
		return
	}
	if len(agents) == 0 {
		writeError(w, http.StatusInternalServerError, "no agents available in workspace")
		return
	}
	agent := agents[0]

	// Resolve runtime for the agent
	runtimeID := agent.RuntimeID
	if !agent.RuntimeID.Valid {
		runtimes, err := h.Queries.ListAgentRuntimes(r.Context(), wsUUID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list agent runtimes")
			return
		}
		if len(runtimes) == 0 {
			writeError(w, http.StatusInternalServerError, "no available runtime for agent")
			return
		}
		// Prefer online runtimes; fall back to first available.
		runtimeID = runtimes[0].ID
		for _, rt := range runtimes {
			if rt.Status == "online" {
				runtimeID = rt.ID
				break
			}
		}
	}

	task, err := h.TaskService.EnqueueCommandTask(r.Context(), service.CommandTaskParams{
		AgentID:   agent.ID,
		RuntimeID: runtimeID,
		Priority:  3, // high priority — user is waiting
		CtxPayload: service.CommandContext{
			Type:        service.CommandContextType,
			ContextType: req.ContextType,
			ContextID:   contextID,
			UserInput:   req.UserInput,
			Mode:        req.Mode,
		},
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to enqueue command task")
		return
	}

	writeJSON(w, http.StatusCreated, CommandResponse{
		TaskID:  uuidToString(task.ID),
		AgentID: uuidToString(agent.ID),
	})
}

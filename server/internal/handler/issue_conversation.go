package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/cloudruntime"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const csCloudRuntimeProvider = "cs-cloud"

type IssueConversationSessionResponse struct {
	ConversationID     string `json:"conversation_id"`
	WorkspaceDirectory string `json:"workspace_directory"`
	EventsURL          string `json:"events_url"`
}

type createConversationRequest struct {
	Agent              string `json:"agent"`
	WorkspaceDirectory string `json:"workspace_directory"`
	InitialPrompt      string `json:"initial_prompt"`
}

type createConversationResponse struct {
	ID string `json:"id"`
}

// GetIssueConversationSession returns the conversation tied to an issue,
// creating it through the Gateway/cs-cloud when necessary.
func (h *Handler) GetIssueConversationSession(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	issueID := chi.URLParam(r, "issueID")

	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace_id")
	if !ok {
		return
	}
	issueUUID, ok := parseUUIDOrBadRequest(w, issueID, "issue_id")
	if !ok {
		return
	}

	// Verify workspace membership.
	if _, err := h.Queries.GetMemberByUserAndWorkspace(r.Context(), db.GetMemberByUserAndWorkspaceParams{
		UserID:      parseUUID(userID),
		WorkspaceID: wsUUID,
	}); err != nil {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}

	issue, err := h.Queries.GetIssueInWorkspace(r.Context(), db.GetIssueInWorkspaceParams{
		ID:          issueUUID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "issue not found")
		return
	}

	// Resolve local directory from project.
	workspaceDir, ok := h.resolveIssueWorkspaceDirectory(w, r.Context(), issue)
	if !ok {
		return
	}

	// Serialize concurrent first-time creation for the same issue to avoid
	// creating orphan conversations on the device.
	if err := h.Queries.LockIssueConversation(r.Context(), issueID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to lock issue conversation")
		return
	}

	// Existing mapping? Re-check under the advisory lock.
	conv, err := h.Queries.GetIssueConversation(r.Context(), issueUUID)
	if err == nil && conv.ConversationID != "" {
		h.writeIssueConversationSession(w, conv.ConversationID, conv.WorkspaceDirectory, conv.DeviceID)
		return
	}

	// Find an online cs-cloud runtime for this workspace.
	deviceID, ok := h.resolveCSCloudDeviceID(w, r.Context(), wsUUID)
	if !ok {
		return
	}

	// Create conversation through Gateway.
	convID, ok := h.createConversationOnDevice(w, r, deviceID, userID, workspaceDir, issue)
	if !ok {
		return
	}

	// Persist mapping.
	created, err := h.Queries.CreateIssueConversation(r.Context(), db.CreateIssueConversationParams{
		IssueID:            issueUUID,
		ConversationID:     convID,
		WorkspaceDirectory: workspaceDir,
		DeviceID:           deviceID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save issue conversation")
		return
	}

	h.writeIssueConversationSession(w, created.ConversationID, created.WorkspaceDirectory, created.DeviceID)
}

func (h *Handler) resolveIssueWorkspaceDirectory(w http.ResponseWriter, ctx context.Context, issue db.MulticaIssue) (string, bool) {
	if !issue.ProjectID.Valid {
		writeError(w, http.StatusBadRequest, "issue has no project")
		return "", false
	}

	localDir, err := h.Queries.GetProjectLocalDirectory(ctx, db.GetProjectLocalDirectoryParams{
		ID:          issue.ProjectID,
		WorkspaceID: issue.WorkspaceID,
	})
	if err != nil || !localDir.Valid || strings.TrimSpace(localDir.String) == "" {
		writeError(w, http.StatusBadRequest, "project local_directory not configured")
		return "", false
	}
	return strings.TrimSpace(localDir.String), true
}

func (h *Handler) resolveCSCloudDeviceID(w http.ResponseWriter, ctx context.Context, wsUUID pgtype.UUID) (string, bool) {
	runtimes, err := h.Queries.ListOnlineAgentRuntimesByWorkspaceAndProvider(ctx, db.ListOnlineAgentRuntimesByWorkspaceAndProviderParams{
		WorkspaceID: wsUUID,
		Provider:    csCloudRuntimeProvider,
	})
	if err != nil || len(runtimes) == 0 {
		writeError(w, http.StatusServiceUnavailable, "cs-cloud device not online")
		return "", false
	}

	for _, rt := range runtimes {
		var meta map[string]any
		_ = json.Unmarshal(rt.Metadata, &meta)
		if id, _ := meta["device_id"].(string); id != "" {
			return id, true
		}
		// Fallback: daemon_id itself is the device id.
		if rt.DaemonID.Valid && rt.DaemonID.String != "" {
			return rt.DaemonID.String, true
		}
	}

	writeError(w, http.StatusServiceUnavailable, "cs-cloud device has no device_id")
	return "", false
}

func (h *Handler) createConversationOnDevice(w http.ResponseWriter, r *http.Request, deviceID, userID, workspaceDir string, issue db.MulticaIssue) (string, bool) {
	if h.CloudRuntime == nil || !h.CloudRuntime.Enabled() {
		writeError(w, http.StatusServiceUnavailable, "cloud runtime is not configured")
		return "", false
	}

	initialPrompt := fmt.Sprintf("Issue #%d: %s", issue.Number, issue.Title)
	if issue.Description.Valid && strings.TrimSpace(issue.Description.String) != "" {
		initialPrompt += "\n\n" + strings.TrimSpace(issue.Description.String)
	}

	body, _ := json.Marshal(createConversationRequest{
		Agent:              "csc",
		WorkspaceDirectory: workspaceDir,
		InitialPrompt:      initialPrompt,
	})

	hdr := http.Header{}
	hdr.Set("X-Workspace-Directory", workspaceDir)
	if auth := r.Header.Get("Authorization"); auth != "" {
		hdr.Set("Authorization", auth)
	}

	resp, err := h.CloudRuntime.Do(r.Context(), cloudruntime.Request{
		Method:    http.MethodPost,
		Path:      fmt.Sprintf("/device/%s/proxy/api/v1/conversations", deviceID),
		Body:      body,
		UserID:    userID,
		RequestID: cloudRuntimeRequestID(r),
		Headers:   hdr,
	})
	if err != nil {
		writeCloudRuntimeError(w, r, err)
		return "", false
	}
	if resp.StatusCode >= 300 {
		writeError(w, http.StatusServiceUnavailable, "failed to create conversation on device")
		return "", false
	}

	var created createConversationResponse
	if err := json.Unmarshal(resp.Body, &created); err != nil || created.ID == "" {
		writeError(w, http.StatusBadGateway, "invalid conversation response from device")
		return "", false
	}
	return created.ID, true
}

func (h *Handler) writeIssueConversationSession(w http.ResponseWriter, conversationID, workspaceDir, deviceID string) {
	prefix := gatewayProxyPrefix(h.cfg, deviceID)
	query := url.Values{}
	query.Set("conversation_id", conversationID)
	eventsURL := prefix + "/api/v1/events?" + query.Encode()

	writeJSON(w, http.StatusOK, IssueConversationSessionResponse{
		ConversationID:     conversationID,
		WorkspaceDirectory: workspaceDir,
		EventsURL:          eventsURL,
	})
}

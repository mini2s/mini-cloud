package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/cloudruntime"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const csCloudRuntimeProvider = "cs-cloud"

// createConversationTimeout bounds the synchronous Gateway HTTP call made
// inside the issue-conversation transaction. The advisory lock is still held
// during this window, so keeping the timeout short limits head-of-line
// blocking for concurrent requests targeting the same issue.
const createConversationTimeout = 15 * time.Second

type IssueConversationSessionResponse struct {
	ConversationID     string `json:"conversation_id"`
	WorkspaceDirectory string `json:"workspace_directory"`
	EventsURL          string `json:"events_url"`
	QuestionsURL       string `json:"questions_url"`
	PermissionsURL     string `json:"permissions_url"`
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

	// Verify workspace membership. In production this is already done by the
	// RequireWorkspaceMemberFromURL middleware, which injects the member into
	// context; workspaceMember uses the context value when present and falls back
	// to a DB lookup for direct handler tests.
	if _, ok := h.workspaceMember(w, r, workspaceID); !ok {
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

	// Fast path: existing mapping outside the transaction.
	conv, err := h.Queries.GetIssueConversation(r.Context(), issueUUID)
	if err == nil && conv.ConversationID != "" {
		if h.isCSCloudDeviceOnline(r.Context(), h.Queries, wsUUID, conv.DeviceID) {
			h.writeIssueConversationSession(w, conv.ConversationID, conv.WorkspaceDirectory, conv.DeviceID)
			return
		}
		// Device recorded in the mapping is offline; fall through to recreate
		// the conversation under the advisory lock.
	}

	// Resolve local directory from project.
	workspaceDir, ok := h.resolveIssueWorkspaceDirectory(w, r.Context(), issue)
	if !ok {
		return
	}

	// Use a transaction so the advisory lock is held while we re-check the
	// mapping, query the runtime, call the Gateway, and insert the new row.
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	if err := qtx.LockIssueConversation(r.Context(), uuidToString(issueUUID)); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to lock issue conversation")
		return
	}

	// Re-check under the advisory lock.
	conv, err = qtx.GetIssueConversation(r.Context(), issueUUID)
	if err == nil && conv.ConversationID != "" {
		if h.isCSCloudDeviceOnline(r.Context(), qtx, wsUUID, conv.DeviceID) {
			h.writeIssueConversationSession(w, conv.ConversationID, conv.WorkspaceDirectory, conv.DeviceID)
			return
		}
		// Device offline: recreate below.
	}

	// Find an online cs-cloud runtime for this workspace.
	deviceID, ok := h.resolveCSCloudDeviceID(w, r.Context(), qtx, wsUUID)
	if !ok {
		return
	}

	// Create conversation through Gateway.
	convID, ok := h.createConversationOnDevice(w, r, deviceID, userID, workspaceDir, issue)
	if !ok {
		return
	}

	// Persist mapping.
	created, err := qtx.CreateIssueConversation(r.Context(), db.CreateIssueConversationParams{
		IssueID:            issueUUID,
		ConversationID:     convID,
		WorkspaceDirectory: workspaceDir,
		DeviceID:           deviceID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save issue conversation")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to commit issue conversation")
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
	if err != nil {
		slog.ErrorContext(ctx, "failed to query project local_directory", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to query project local_directory")
		return "", false
	}
	if !localDir.Valid || strings.TrimSpace(localDir.String) == "" {
		writeError(w, http.StatusBadRequest, "project local_directory not configured")
		return "", false
	}
	return strings.TrimSpace(localDir.String), true
}

func (h *Handler) resolveCSCloudDeviceID(w http.ResponseWriter, ctx context.Context, queries *db.Queries, wsUUID pgtype.UUID) (string, bool) {
	runtimes, err := queries.ListOnlineAgentRuntimesByWorkspaceAndProvider(ctx, db.ListOnlineAgentRuntimesByWorkspaceAndProviderParams{
		WorkspaceID: wsUUID,
		Provider:    csCloudRuntimeProvider,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to query cs-cloud runtimes", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to query cs-cloud runtimes")
		return "", false
	}
	if len(runtimes) == 0 {
		writeError(w, http.StatusServiceUnavailable, "cs-cloud device not online")
		return "", false
	}

	for _, rt := range runtimes {
		var meta map[string]any
		if err := json.Unmarshal(rt.Metadata, &meta); err != nil {
			slog.DebugContext(ctx, "failed to unmarshal runtime metadata", "daemon_id", rt.DaemonID, "error", err)
			continue
		}
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

func (h *Handler) isCSCloudDeviceOnline(ctx context.Context, queries *db.Queries, wsUUID pgtype.UUID, deviceID string) bool {
	runtimes, err := queries.ListOnlineAgentRuntimesByWorkspaceAndProvider(ctx, db.ListOnlineAgentRuntimesByWorkspaceAndProviderParams{
		WorkspaceID: wsUUID,
		Provider:    csCloudRuntimeProvider,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to query cs-cloud runtimes for device online check", "error", err)
		return false
	}

	for _, rt := range runtimes {
		var meta map[string]any
		if err := json.Unmarshal(rt.Metadata, &meta); err != nil {
			slog.DebugContext(ctx, "failed to unmarshal runtime metadata", "daemon_id", rt.DaemonID, "error", err)
			continue
		}
		if id, _ := meta["device_id"].(string); id == deviceID {
			return true
		}
		if rt.DaemonID.Valid && rt.DaemonID.String == deviceID {
			return true
		}
	}
	return false
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

	// Bound the Gateway HTTP call to avoid holding the DB advisory lock and
	// transaction for an unbounded amount of time.
	ctx, cancel := context.WithTimeout(r.Context(), createConversationTimeout)
	defer cancel()

	resp, err := h.CloudRuntime.Do(ctx, cloudruntime.Request{
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
		bodySnippet := strings.TrimSpace(string(resp.Body))
		if len(bodySnippet) > 200 {
			bodySnippet = bodySnippet[:200] + "..."
		}
		slog.WarnContext(ctx, "device returned non-success status when creating conversation",
			"device_id", deviceID,
			"status_code", resp.StatusCode,
			"body_snippet", bodySnippet,
		)
		writeError(w, http.StatusServiceUnavailable, fmt.Sprintf("device returned %d when creating conversation", resp.StatusCode))
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

	eventsQuery := url.Values{}
	eventsQuery.Set("conversation_id", conversationID)
	eventsURL := prefix + "/api/v1/events?" + eventsQuery.Encode()

	questionsURL := prefix + "/api/v1/questions"
	permissionsURL := prefix + "/api/v1/permissions"

	writeJSON(w, http.StatusOK, IssueConversationSessionResponse{
		ConversationID:     conversationID,
		WorkspaceDirectory: workspaceDir,
		EventsURL:          eventsURL,
		QuestionsURL:       questionsURL,
		PermissionsURL:     permissionsURL,
	})
}

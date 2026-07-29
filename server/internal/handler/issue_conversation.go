package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/cloudruntime"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// csCloudRuntimeProvider identifies a cs-cloud device runtime; it filters
// ListOnlineAgentRuntimesByWorkspaceAndProvider when resolving the device for
// an issue conversation. MUST stay equal to csCloudProvider in
// internal/service/task_cscloud_push.go and to the value cs-cloud registers
// (internal/workflowrunner/driver.go, const providerCSCloud, in cs-cloud repo).
const csCloudRuntimeProvider = "cs-cloud"

// createConversationTimeout bounds the synchronous Gateway HTTP call made
// inside the issue-conversation transaction. The advisory lock is still held
// during this window, so keeping the timeout short limits head-of-line
// blocking for concurrent requests targeting the same issue.
const createConversationTimeout = 15 * time.Second

// verifyConversationTimeout bounds the existence check made on the fast path.
// It runs outside the advisory lock, so a slow device only delays this one
// request.
const verifyConversationTimeout = 10 * time.Second

type IssueConversationSessionResponse struct {
	ConversationID     string `json:"conversation_id"`
	WorkspaceDirectory string `json:"workspace_directory"`
	// ProxyBaseURL is the device proxy prefix (…/proxy) through which all
	// cs-cloud conversation APIs are reachable: events (SSE), prompt,
	// abort, messages, todo, questions, permissions, etc.
	ProxyBaseURL string `json:"proxy_base_url"`
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
	staleConversationID := ""
	if err == nil && conv.ConversationID != "" {
		if h.isCSCloudDeviceOnline(r.Context(), h.Queries, wsUUID, conv.DeviceID) {
			// The mapping alone is not proof of life: csc keeps a conversation
			// in memory until its first prompt, so an agent restart or idle
			// eviction silently kills it while the mapping survives. Verify
			// before handing the id back.
			status, verr := h.verifyConversationOnDevice(r, userID, conv.DeviceID, conv.ConversationID)
			if verr == nil && status == http.StatusNotFound {
				// Definitively gone — recreate it under the advisory lock.
				staleConversationID = conv.ConversationID
			} else {
				// Alive — or verification was inconclusive (timeout, 5xx,
				// unreachable), in which case trust the mapping rather than
				// destroy state that may still be good.
				h.writeIssueConversationSession(w, conv.ConversationID, conv.WorkspaceDirectory, conv.DeviceID)
				return
			}
		}
		// Stale conversation, or the recorded device is offline; fall through
		// to recreate the conversation under the advisory lock.
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
		// Trust the mapping only if it is not the conversation this request
		// already verified as gone — a concurrent request may have recreated
		// it while we waited on the lock (the id would then differ).
		if conv.ConversationID != staleConversationID && h.isCSCloudDeviceOnline(r.Context(), qtx, wsUUID, conv.DeviceID) {
			h.writeIssueConversationSession(w, conv.ConversationID, conv.WorkspaceDirectory, conv.DeviceID)
			return
		}
		// Stale conversation or offline device: recreate below (Create upserts).
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

// resolveIssueWorkspaceDirectory resolves the device's local directory for the
// issue's project. An issue without a project — or whose project has no
// local_directory configured — is NOT an error: the conversation is created
// with an empty directory and the device-side agent falls back to its default
// working directory. Only a DB failure aborts the request.
func (h *Handler) resolveIssueWorkspaceDirectory(w http.ResponseWriter, ctx context.Context, issue db.MulticaIssue) (string, bool) {
	if !issue.ProjectID.Valid {
		return "", true
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
	if !localDir.Valid {
		return "", true
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

// verifyConversationOnDevice GETs the conversation through the Gateway and
// returns the device-side HTTP status. A 404 means the conversation is
// definitively gone (csc answers "session not found"); any other status, or a
// transport error, is inconclusive and callers should keep the cached mapping.
func (h *Handler) verifyConversationOnDevice(r *http.Request, userID, deviceID, conversationID string) (int, error) {
	if h.CloudRuntime == nil || !h.CloudRuntime.Enabled() {
		return 0, fmt.Errorf("cloud runtime is not configured")
	}

	hdr := http.Header{}
	if auth := r.Header.Get("Authorization"); auth != "" {
		hdr.Set("Authorization", auth)
	}
	// Same internal-secret requirement as the create path.
	if secret := os.Getenv("COSTRICT_INTERNAL_SECRET"); secret != "" {
		hdr.Set("X-Internal-Secret", secret)
	}

	ctx, cancel := context.WithTimeout(r.Context(), verifyConversationTimeout)
	defer cancel()

	resp, err := h.CloudRuntime.Do(ctx, cloudruntime.Request{
		Method:    http.MethodGet,
		Path:      fmt.Sprintf("/device/%s/proxy/api/v1/conversations/%s", deviceID, conversationID),
		UserID:    userID,
		RequestID: cloudRuntimeRequestID(r),
		Headers:   hdr,
	})
	if err != nil {
		return 0, err
	}
	return resp.StatusCode, nil
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
	// Only send the directory header when a project directory was resolved;
	// an empty header would otherwise override the agent's default cwd.
	if workspaceDir != "" {
		hdr.Set("X-Workspace-Directory", workspaceDir)
	}
	if auth := r.Header.Get("Authorization"); auth != "" {
		hdr.Set("Authorization", auth)
	}
	// The gateway's device proxy requires the shared internal secret (same as
	// the task push path); without it the gateway rejects with 403.
	if secret := os.Getenv("COSTRICT_INTERNAL_SECRET"); secret != "" {
		hdr.Set("X-Internal-Secret", secret)
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
	writeJSON(w, http.StatusOK, IssueConversationSessionResponse{
		ConversationID:     conversationID,
		WorkspaceDirectory: workspaceDir,
		ProxyBaseURL:       gatewayProxyPrefix(h.cfg, deviceID),
	})
}

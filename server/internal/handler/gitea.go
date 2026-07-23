package handler

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/multica-ai/multica/server/internal/middleware"
)

// ── Env config (mirror githubWebhookSecret / githubAppSlug in github.go) ─────
// Read on every call (not cached) so rotation takes effect without restart.

func giteaBaseURL() string { return strings.TrimSpace(os.Getenv("GITEA_BASE_URL")) }

// giteaPublicBaseURL is the caller-reachable Gitea base for the clone_url /
// credential returned to daemons + agents. The server itself talks to Gitea
// over the container-internal GITEA_BASE_URL (e.g. http://gitea:3000); a
// daemon running on the host can't resolve that container DNS, so when
// GITEA_PUBLIC_BASE_URL is set (e.g. http://localhost:23000) the clone_url +
// credential use it instead. Defaults to GITEA_BASE_URL when unset (single-host).
func giteaPublicBaseURL() string {
	if pub := strings.TrimSpace(os.Getenv("GITEA_PUBLIC_BASE_URL")); pub != "" {
		return pub
	}
	return giteaBaseURL()
}

func giteaAdminToken() string { return strings.TrimSpace(os.Getenv("GITEA_ADMIN_TOKEN")) }

// isGiteaConfigured reports whether the server can act as an admin against the
// platform Gitea (scaffolding + merge). The per-workspace bot PAT lives in
// workspace.settings and is independent of this flag.
func isGiteaConfigured() bool { return giteaBaseURL() != "" && giteaAdminToken() != "" }

// ── workspace.settings partial view (mirror gitlabSettings) ──────────────────

// giteaSettings represents the Gitea-related keys stored in workspace.settings
// JSONB. The bot username + PAT are provisioned lazily by M2 (server-run
// scaffolding) and consumed by the credential endpoint below.
type giteaSettings struct {
	GiteaBotUsername *string `json:"gitea_bot_username"` // written by M2 provisioning; not used by the M1 credential endpoint
	GiteaPat         *string `json:"gitea_pat"`
}

func parseGiteaSettings(raw []byte) (giteaSettings, error) {
	var s giteaSettings
	if len(raw) == 0 {
		return s, nil
	}
	err := json.Unmarshal(raw, &s)
	return s, err
}

// HandleGiteaCredential (GET /api/gitea/credential) returns the workspace's
// Gitea bot PAT + the platform Gitea base URL for the authenticated daemon.
// Used by the cs-workflow CLI (M3) to push document deliverables and open PRs.
// Mirrors HandleGitlabCredential; base_url comes from env (not hardcoded),
// because the platform Gitea URL is a deployment-wide constant.
func (h *Handler) HandleGiteaCredential(w http.ResponseWriter, r *http.Request) {
	workspaceID := middleware.DaemonWorkspaceIDFromContext(r.Context())
	if workspaceID == "" {
		workspaceID = r.Header.Get("X-Workspace-ID")
	}
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "daemon workspace context missing")
		return
	}
	wsUUID := parseUUID(workspaceID)

	ws, err := h.Queries.GetWorkspace(r.Context(), wsUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}

	settings, err := parseGiteaSettings(ws.Settings)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to parse settings")
		return
	}

	token := ""
	if settings.GiteaPat != nil {
		token = *settings.GiteaPat
	}
	if token == "" {
		writeError(w, http.StatusNotFound, "gitea workspace token not configured")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"base_url": giteaPublicBaseURL(),
		"token":    token,
	})
}

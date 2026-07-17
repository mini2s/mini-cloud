package gitea

import (
	"context"
	"fmt"
)

// provisionAPI is the subset of *Client that ProvisionWorkspaceBot needs.
type provisionAPI interface {
	AdminCreateUser(ctx context.Context, username, email string) error
	CreateUserToken(ctx context.Context, username, tokenName string) (string, error)
	AddOrgMember(ctx context.Context, org, username string) error
	GetOrg(ctx context.Context, org string) (bool, error)
}

// Compile-time check that *Client satisfies provisionAPI.
var _ provisionAPI = (*Client)(nil)

// BotParams identifies the workspace a bot is provisioned for.
type BotParams struct {
	WorkspaceID string
}

// BotUsername is the deterministic Gitea username for a workspace's bot:
// mc-bot-<workspace.id[:8]>. Exposed so callers can reference the bot without
// provisioning (e.g. credential endpoint lookups).
func BotUsername(workspaceID string) string { return "mc-bot-" + shortHex(workspaceID) }

// ProvisionWorkspaceBot creates the per-workspace Gitea bot user, mints a PAT
// (scopes: write repo, read user/org), and adds the bot to the workspace org.
// Idempotent: AdminCreateUser tolerates already-exists (the client maps 422 to
// nil). Returns (username, token). The caller (M2) persists these into
// workspace.settings.
// Note: re-provisioning always mints a fresh PAT (Gitea allows multiple tokens
// per user); the caller is responsible for revoking any prior PAT it stored.
func ProvisionWorkspaceBot(ctx context.Context, c provisionAPI, p BotParams) (username, token string, err error) {
	username = BotUsername(p.WorkspaceID)
	org := OrgName(p.WorkspaceID)

	if err := c.AdminCreateUser(ctx, username, botEmail(username)); err != nil {
		return "", "", fmt.Errorf("create gitea bot user: %w", err)
	}
	token, err = c.CreateUserToken(ctx, username, "workspace-pat")
	if err != nil {
		return "", "", fmt.Errorf("create gitea bot pat: %w", err)
	}
	// NOTE: org membership is added ONLY when the org already exists at
	// provision time. If provisioning runs before the first scaffold (both are
	// lazy and independent), the bot is created with a PAT but NOT added to the
	// org — so the daemon's first clone/push of org-private repos would 403.
	// M2's wiring MUST order scaffold-before-provision (or re-add membership
	// after scaffold) so the org exists when provision runs. This package keeps
	// no DB/settings dependency, so it cannot self-heal here.
	if exists, gErr := c.GetOrg(ctx, org); gErr == nil && exists {
		if err := c.AddOrgMember(ctx, org, username); err != nil {
			return "", "", fmt.Errorf("add gitea bot to org: %w", err)
		}
	}
	return username, token, nil
}

func botEmail(username string) string {
	return fmt.Sprintf("%s@multica.local", username)
}

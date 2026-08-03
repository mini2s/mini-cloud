package gitea

import (
	"context"
	"fmt"
	"strings"
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
// bot-t-<workspace.id[:8]>. Exposed so callers can reference the bot without
// provisioning (e.g. credential endpoint lookups).
func BotUsername(workspaceID string) string { return "bot-t-" + shortHex(workspaceID) }

// ProvisionWorkspaceBot creates the per-workspace Gitea bot user, mints a PAT
// (scopes: write repo, read user), and adds the bot to the workspace org.
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
	token, err = c.CreateUserToken(ctx, username, "costrict-team-bot-default")
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
	short := strings.TrimPrefix(username, "bot-t-")
	return fmt.Sprintf("bot+%s@costrict.internal", short)
}

// MemberParams identifies a workspace member to provision into the Gitea org.
type MemberParams struct {
	WorkspaceID string
	UserID      string // multica user id (audit/logging only)
	Email       string // member's multica email; the local-part is the Casdoor username
}

// MemberUsername derives a member's Gitea username from their email local-part.
// In this deployment Casdoor usernames ARE the email local-part (e.g.
// 29219@dept.local → "29219", admin@multica.ai → "admin"), so the Gitea user
// created here matches the user Gitea-Casdoor SSO creates on first login —
// meaning an SSO-authenticated member lands on their synced org identity (not a
// second, non-member user) and can read the org's PRs directly on Gitea.
//
// Sanitized to Gitea's username rules; falls back to "mc-member" when the
// local-part is empty/unsalvageable. Collisions (two members with the same
// local-part in different domains) are a known edge case — they would share a
// Gitea identity; a future refinement can disambiguate via the Casdoor UUID.
func MemberUsername(email string) string {
	local := email
	if at := strings.IndexByte(local, '@'); at >= 0 {
		local = local[:at]
	}
	var b strings.Builder
	for _, r := range strings.ToLower(local) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			b.WriteRune(r)
		}
	}
	s := strings.Trim(b.String(), "-_")
	if s == "" {
		return "mc-member"
	}
	return s
}

// ProvisionMember creates the member's Gitea user (idempotent) and adds them to
// the workspace org so they can read the org's repos / PRs — implementing
// TEAM_NAMESPACE_API §1.1 ("team ns org 成员 = team 成员"). No PAT is minted:
// members view PRs via their Gitea login (SSO), and pushing is done by the
// workspace bot, not individual members. Best-effort per member: a missing org
// (sync before first scaffold) is skipped, not an error.
func ProvisionMember(ctx context.Context, c provisionAPI, p MemberParams) (string, error) {
	username := MemberUsername(p.Email)
	org := OrgName(p.WorkspaceID)
	email := p.Email
	if email == "" {
		email = botEmail(username)
	}
	if err := c.AdminCreateUser(ctx, username, email); err != nil {
		return "", fmt.Errorf("create gitea member user: %w", err)
	}
	// Only add to org if the org exists (scaffold creates it; a sync racing
	// ahead of the first scaffold is a no-op, retried on the next run).
	if exists, gErr := c.GetOrg(ctx, org); gErr != nil {
		return "", fmt.Errorf("check org %s: %w", org, gErr)
	} else if !exists {
		return username, nil
	}
	if err := c.AddOrgMember(ctx, org, username); err != nil {
		return "", fmt.Errorf("add gitea member to org: %w", err)
	}
	return username, nil
}

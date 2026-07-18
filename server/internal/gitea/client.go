package gitea

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ErrNotConfigured is returned when the admin client has no base URL or token.
var ErrNotConfigured = errors.New("gitea is not configured")

// Config configures the admin-token Gitea client used for scaffolding,
// provisioning, and (in M2) merging. The token is a server-level admin PAT
// kept in env (GITEA_ADMIN_TOKEN) — it is NEVER stored in workspace.settings.
type Config struct {
	BaseURL string
	Token   string
	Timeout time.Duration
}

// Client talks to a platform-owned Gitea instance using the admin token.
// Mirrors server/internal/deptsync/client.go's shape.
type Client struct {
	baseURL    string
	token      string
	httpClient *http.Client
}

// NewClient constructs an admin client. Tests in this package overwrite the
// httpClient field to inject httptest.Server.Client(); production callers
// leave it nil and NewClient installs a default *http.Client.
func NewClient(cfg Config) *Client {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	c := &Client{
		baseURL: strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/"),
		token:   strings.TrimSpace(cfg.Token),
	}
	c.httpClient = &http.Client{Timeout: timeout}
	return c
}

// Configured reports whether the client has a base URL and token.
func (c *Client) Configured() bool {
	return c != nil && c.baseURL != "" && c.token != ""
}

// do issues an authenticated JSON request. A nil body means no body.
func (c *Client) do(ctx context.Context, method, path string, body any) (*http.Response, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(buf)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+"/api/v1"+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "token "+c.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return c.httpClient.Do(req)
}

// decodeError turns a non-2xx response into an error including the body. It
// reads but does NOT close resp.Body — the caller owns the body lifecycle
// (each Get*/Create* method defers resp.Body.Close()).
func decodeError(resp *http.Response) error {
	b, _ := io.ReadAll(resp.Body)
	return fmt.Errorf("gitea api %s failed: status %d: %s", resp.Request.URL.Path, resp.StatusCode, strings.TrimSpace(string(b)))
}

// randomToken returns a random hex string of n bytes (2n hex chars). Used for
// the throwaway bot-user password; never returned to callers. The rand.Read
// error is intentionally ignored: crypto/rand almost never fails on a non-empty
// buffer, and a zero result would only lower the throwaway password's entropy
// (harmless under PAT-only auth).
func randomToken(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// ── Orgs ────────────────────────────────────────────────────────────────────

// GetOrg reports whether the org exists. 404 → (false, nil); other non-2xx → error.
func (c *Client) GetOrg(ctx context.Context, org string) (bool, error) {
	resp, err := c.do(ctx, http.MethodGet, "/orgs/"+org, nil)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusOK:
		return true, nil
	case resp.StatusCode == http.StatusNotFound:
		return false, nil
	default:
		return false, decodeError(resp)
	}
}

// CreateOrg creates a private org with the given description (human-readable
// title — Chinese/special chars allowed; the org name itself is ID-derived).
func (c *Client) CreateOrg(ctx context.Context, org, description string) error {
	resp, err := c.do(ctx, http.MethodPost, "/orgs", map[string]any{
		"username":    org,
		"visibility":  "private",
		"description": description,
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	return decodeError(resp)
}

// ── Repos ───────────────────────────────────────────────────────────────────

// GetRepo reports whether the repo exists. 404 → (false, nil); other non-2xx → error.
func (c *Client) GetRepo(ctx context.Context, owner, name string) (bool, error) {
	resp, err := c.do(ctx, http.MethodGet, "/repos/"+owner+"/"+name, nil)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusOK:
		return true, nil
	case resp.StatusCode == http.StatusNotFound:
		return false, nil
	default:
		return false, decodeError(resp)
	}
}

// CreateRepo creates a private repo under the org with an auto-initialized main
// branch (so inst branches can base off main immediately).
func (c *Client) CreateRepo(ctx context.Context, owner, name, description string) error {
	resp, err := c.do(ctx, http.MethodPost, "/orgs/"+owner+"/repos", map[string]any{
		"name":           name,
		"description":    description,
		"private":        true,
		"default_branch": "main",
		"auto_init":      true,
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	return decodeError(resp)
}

// ── Branches ────────────────────────────────────────────────────────────────

// GetBranch reports whether the branch exists. 404 → (false, nil); other non-2xx → error.
func (c *Client) GetBranch(ctx context.Context, owner, repo, branch string) (bool, error) {
	resp, err := c.do(ctx, http.MethodGet, "/repos/"+owner+"/"+repo+"/branches/"+branch, nil)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusOK:
		return true, nil
	case resp.StatusCode == http.StatusNotFound:
		return false, nil
	default:
		return false, decodeError(resp)
	}
}

// CreateBranch creates branch from an existing ref (e.g. "main" or an inst branch).
func (c *Client) CreateBranch(ctx context.Context, owner, repo, branch, fromRef string) error {
	resp, err := c.do(ctx, http.MethodPost, "/repos/"+owner+"/"+repo+"/branches", map[string]any{
		"new_branch_name": branch,
		"old_ref_name":    fromRef,
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	return decodeError(resp)
}

// ── Contents ────────────────────────────────────────────────────────────────

// CreateFile commits a file on the given branch. content is the raw string; it
// is base64-encoded per Gitea contents API. Used to seed main with the workflow
// definition snapshot (readable; DB remains source of truth, no drift check).
func (c *Client) CreateFile(ctx context.Context, owner, repo, branch, path, content, message string) error {
	resp, err := c.do(ctx, http.MethodPost, "/repos/"+owner+"/"+repo+"/contents/"+path, map[string]any{
		"branch":  branch,
		"message": message,
		"content": base64.StdEncoding.EncodeToString([]byte(content)),
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	return decodeError(resp)
}

// ── Branch protection ───────────────────────────────────────────────────────

// ProtectBranch configures branch protection (push blocked; used for main and
// the inst-* wildcard so daemon pushes go through node branches + PRs only).
func (c *Client) ProtectBranch(ctx context.Context, owner, repo, rule string) error {
	resp, err := c.do(ctx, http.MethodPost, "/repos/"+owner+"/"+repo+"/branch_protections", map[string]any{
		"rule_name":   rule,
		"protected":   true,
		"enable_push": false,
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	// 422 "protected branch already exists" → idempotent no-op.
	if resp.StatusCode == http.StatusUnprocessableEntity {
		return nil
	}
	return decodeError(resp)
}

// ── Users ───────────────────────────────────────────────────────────────────

// AdminCreateUser creates a Gitea user with a random strong password (the
// password is never used — auth is via the PAT minted by CreateUserToken).
func (c *Client) AdminCreateUser(ctx context.Context, username, email string) error {
	resp, err := c.do(ctx, http.MethodPost, "/admin/users", map[string]any{
		"username":             username,
		"email":                email,
		"password":             randomToken(32),
		"must_change_password": false,
		"source_id":            0,
		"login_name":           "",
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	// 422 user-exists → idempotent no-op (provisioning may retry).
	if resp.StatusCode == http.StatusUnprocessableEntity {
		return nil
	}
	return decodeError(resp)
}

// CreateUserToken mints a PAT for the user. Requires admin token (admin can
// create tokens for any user). Returns the raw token (sha1).
//
// Gitea's POST /users/{username}/tokens endpoint REJECTS token auth with 401
// ("auth required") — it only accepts HTTP basic auth. The admin token works
// as the basic-auth password (Gitea resolves the user from the token itself;
// the basic-auth username is ignored), so we send Basic with an arbitrary
// username and the admin token as the password. This is Gitea 1.22 behavior.
func (c *Client) CreateUserToken(ctx context.Context, username, tokenName string) (string, error) {
	body, err := json.Marshal(map[string]any{
		"name":   tokenName,
		"scopes": []string{"write:repository", "read:user", "read:organization"},
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/api/v1/users/"+username+"/tokens", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	// Basic-auth, NOT "token <admin>": the /users/{name}/tokens endpoint
	// requires it. Username is arbitrary; password is the admin token.
	req.SetBasicAuth("token", c.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", decodeError(resp)
	}
	var out struct {
		Sha1 string `json:"sha1"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("gitea create token: invalid response: %w", err)
	}
	return out.Sha1, nil
}

// ── Org membership ──────────────────────────────────────────────────────────

// OrgTeam is the minimal Gitea team shape AddOrgMember needs.
type OrgTeam struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// ListOrgTeams lists the teams in an org. Gitea grants org membership via
// teams — there is no PUT /orgs/{org}/members/{username} endpoint (it 405s).
func (c *Client) ListOrgTeams(ctx context.Context, org string) ([]OrgTeam, error) {
	resp, err := c.do(ctx, http.MethodGet, "/orgs/"+org+"/teams", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, decodeError(resp)
	}
	var teams []OrgTeam
	if err := json.NewDecoder(resp.Body).Decode(&teams); err != nil {
		return nil, fmt.Errorf("gitea list org teams: invalid response: %w", err)
	}
	return teams, nil
}

// AddOrgMember adds a user to the org by attaching them to the org's first
// team. Gitea has NO direct add-org-member endpoint — PUT /orgs/{org}/members/{u}
// returns 405; membership is granted through a team. Org creation seeds an
// Owners team (admin permission) as the first team, so the bot gains write
// access to the org's repos via that team.
func (c *Client) AddOrgMember(ctx context.Context, org, username string) error {
	teams, err := c.ListOrgTeams(ctx, org)
	if err != nil {
		return fmt.Errorf("list org teams: %w", err)
	}
	if len(teams) == 0 {
		return fmt.Errorf("org %s has no team to add %s to", org, username)
	}
	teamID := teams[0].ID
	resp, err := c.do(ctx, http.MethodPut,
		"/teams/"+strconv.FormatInt(teamID, 10)+"/members/"+username, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	return decodeError(resp)
}

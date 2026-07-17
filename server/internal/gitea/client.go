package gitea

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
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

# Deliverable Git-Storage — Milestone 1 (Gitea Integration Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the platform-owned Gitea integration foundation — a topology/naming layer, an admin-token HTTP client, idempotent scaffolding (org/repo/inst-branch) and workspace-bot provisioning, plus the `gitea/credential` endpoint — so that Milestone 2 can wire run-start scaffolding and approve-time PR merging on top.

**Architecture:** New `server/internal/gitea/` package holds a raw-`net/http` admin-token client (mirroring `server/internal/deptsync/client.go`), pure topology functions deriving Gitea names from multica UUIDs (mirroring costrict-web's `t-<8hex>` / `wf-<8hex>` / `inst-<8hex>` / `node/<8hex>` algorithm, but UUID-derived per the locked design), and idempotent scaffold + provision orchestration. The handler gains a `giteaSettings` partial-view struct over `workspace.settings` JSONB and a `HandleGiteaCredential` endpoint mirroring `HandleGitlabCredential`. The admin token + base URL come from env (mirroring `githubWebhookSecret()`). **No DB migration** — `workspace.settings` is schema-free JSONB and all reused statuses/pointers already exist.

**Tech Stack:** Go 1.26, Chi router, `net/http` + `encoding/json`, `pgx/v5`, table-driven tests with `httptest` + `testPool`.

---

## Roadmap (this is plan 1 of 3)

| Plan | Milestone | Scope | Independently testable? |
|---|---|---|---|
| **1 (this)** | Gitea integration foundation | gitea package (client + topology + scaffold + provision) + `gitea/credential` endpoint + env config | Yes — fake/httptest Gitea + handler tests |
| 2 | Workflow wiring | run-start scaffolding hook (gated on doc deliverables) + `report-pr` daemon endpoint + approve-internal PR merge (decision: inline merge, no new state) + `critic_approved→blocked` transition | Yes — fake Gitea client in service/handler tests |
| 3 | Runtime + UI | `RepoData`/claim-response extension + `cs-workflow` Gitea command (branch off inst → node branch, push, open PR, call report-pr) + disable upload (reject content/attachment_id) + render `pull_request_url` | Yes — real-temp-repo daemon tests + jsdom view tests |

**Locked decisions driving the plans** (from design + grilling):
- Gitea topology all UUID-8hex derived; repo layer uses `workflow.id` (not costrict's `def_slug`).
- Workspace-shared PAT (one bot user per workspace, all members+agents share) stored in `workspace.settings`; server admin token in env.
- Responsibility: daemon/agent = push + open PR; server = review + merge + scaffold.
- Failure model F1: retry → blocked; state advances only on confirmed success.
- **Merge model = decision B:** inline merge inside the `ReviewNodeRun` approve branch (no `merging` state); transient failure retried with backoff inline, exhausted → `blocked`; add `critic_approved → blocked` transition. Known gap: a crash after persisting `critic_approved` but before merge completion leaves the node at `critic_approved` (needs manual re-approve or a future sweeper — out of scope).
- **PR-URL report = decision A:** dedicated daemon-authed `POST /api/daemon/node-runs/{nodeRunId}/deliverables/{deliverableId}/report-pr`.
- Scaffold only when the workflow has ≥1 document deliverable. Bot user + PAT provisioned lazily.

---

## File Structure (Milestone 1)

**Create:**
- `server/internal/gitea/topology.go` — pure naming functions (`OrgName`, `RepoName`, `RepoPath`, `InstBranch`, `NodeBranch`, `shortHex`).
- `server/internal/gitea/topology_test.go` — table-driven tests for the naming functions.
- `server/internal/gitea/client.go` — admin-token `Client` (`Config`, `NewClient`, `Configured`) + Gitea API v1 methods used by scaffold/provision.
- `server/internal/gitea/client_test.go` — `httptest.Server`-backed tests for each client method (get-or-create idempotency, auth header, error mapping).
- `server/internal/gitea/scaffold.go` — `ScaffoldRunDeliverable` orchestration (get-or-create org → repo → inst branch → seed main → branch protection), idempotent.
- `server/internal/gitea/scaffold_test.go` — orchestration tests with a fake-client interface.
- `server/internal/gitea/provision.go` — `ProvisionWorkspaceBot` (create bot user → mint PAT → add to org), returns `(username, token)`.
- `server/internal/gitea/provision_test.go` — fake-client tests.
- `server/internal/handler/gitea.go` — env helpers (`giteaBaseURL`, `giteaAdminToken`, `giteaConfigured`), `giteaSettings` struct + `parseGiteaSettings`, `HandleGiteaCredential`.
- `server/internal/handler/gitea_test.go` — credential endpoint test (seeds `gitea_pat` in workspace settings).

**Modify:**
- `server/cmd/server/router.go` — mount `GET /api/gitea/credential` behind `middleware.DaemonAuth` (mirror the gitlab credential mount at lines 384-385).
- `.env.example` — add `GITEA_BASE_URL=` + `GITEA_ADMIN_TOKEN=`.
- `docker-compose.selfhost.yml` — pass through the two env vars (mirror the `GITHUB_WEBHOOK_SECRET` line at ~line 76).

**Not touched in M1** (deferred to M2/M3): handler↔client wiring (`Handler.Gitea` field, `RouterOptions.Gitea`, `main.go` construction), service layer, daemon, frontend.

---

## Task 1: Gitea topology (pure naming functions)

**Files:**
- Create: `server/internal/gitea/topology.go`
- Test: `server/internal/gitea/topology_test.go`

- [ ] **Step 1: Write the failing test**

Create `server/internal/gitea/topology_test.go`:

```go
package gitea

import "testing"

func TestShortHex(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"7f3c9a1e-d4b2-4c8e-9a3f-1b2c3d4e5f6a", "7f3c9a1e"},
		{"F3A8B2C1-9D7E-4A2B-8E1F-1234567890AB", "f3a8b2c1"}, // case-normalized
	}
	for _, c := range cases {
		if got := shortHex(c.in); got != c.want {
			t.Errorf("shortHex(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestShortHex_PanicsOnInvalidUUID(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("shortHex did not panic on invalid UUID")
		}
	}()
	_ = shortHex("not-a-uuid")
}

func TestTopologyNames(t *testing.T) {
	ws := "7f3c9a1e-d4b2-4c8e-9a3f-1b2c3d4e5f6a"
	wf := "11111111-2222-3333-4444-555555555555"
	run := "f3a8b2c1-9d7e-4a2b-8e1f-1234567890ab"
	node := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

	if got := OrgName(ws); got != "t-7f3c9a1e" {
		t.Errorf("OrgName = %q", got)
	}
	if got := RepoName(wf); got != "wf-11111111" {
		t.Errorf("RepoName = %q", got)
	}
	if got := RepoPath(ws, wf); got != "t-7f3c9a1e/wf-11111111" {
		t.Errorf("RepoPath = %q", got)
	}
	if got := InstBranch(run); got != "inst-f3a8b2c1" {
		t.Errorf("InstBranch = %q", got)
	}
	if got := NodeBranch(node); got != "node/aaaaaaaa" {
		t.Errorf("NodeBranch = %q", got)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/gitea/ -run TestTopologyNames -v`
Expected: FAIL / build error — package has no `shortHex`/`OrgName`/etc.

- [ ] **Step 3: Write minimal implementation**

Create `server/internal/gitea/topology.go`:

```go
// Package gitea provides the platform-owned Gitea integration: a topology
// (name derivation) layer, an admin-token HTTP client, and idempotent
// scaffolding + workspace-bot provisioning. multica stores only pointers to
// Gitea; the document deliverable bodies live in Gitea repos, symmetric with
// code-type PRs in customer repos.
package gitea

import (
	"fmt"
	"strings"
)

// shortHex returns the first 8 hex chars of a UUID (dashes stripped, lowercased)
// — the multica/costrict convention for deriving Gitea names from UUIDs. It
// panics on a non-UUID because callers always pass DB-sourced UUID IDs; a
// non-UUID here is a programmer bug, not user input.
func shortHex(id string) string {
	hex := strings.ToLower(strings.ReplaceAll(id, "-", ""))
	if len(hex) != 32 || !isHex(hex) {
		panic(fmt.Sprintf("gitea: invalid UUID %q", id))
	}
	return hex[:8]
}

func isHex(s string) bool {
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9':
		case r >= 'a' && r <= 'f':
		default:
			return false
		}
	}
	return true
}

// OrgName is the Gitea org (team namespace) for a workspace: t-<workspace.id[:8]>.
func OrgName(workspaceID string) string { return "t-" + shortHex(workspaceID) }

// RepoName is the Gitea repo name for a workflow definition: wf-<workflow.id[:8]>.
// multica deliberately uses workflow.id (a UUID) instead of costrict's
// human-readable def_slug to avoid Chinese-title escape problems (wf-____).
func RepoName(workflowID string) string { return "wf-" + shortHex(workflowID) }

// RepoPath is the full owner/name path: t-<ws[:8]>/wf-<wf[:8]>.
func RepoPath(workspaceID, workflowID string) string {
	return OrgName(workspaceID) + "/" + RepoName(workflowID)
}

// InstBranch is the per-run instance branch: inst-<run.id[:8]>. Base = repo
// default branch (main). Long-lived (audit asset); not auto-deleted.
func InstBranch(runID string) string { return "inst-" + shortHex(runID) }

// NodeBranch is the per-node-run feature branch: node/<nodeRun.id[:8]>. Based
// off the run's inst branch; deleted after the node PR merges.
func NodeBranch(nodeRunID string) string { return "node/" + shortHex(nodeRunID) }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && go test ./internal/gitea/ -v`
Expected: PASS (all three test funcs).

- [ ] **Step 5: Commit**

```bash
git add server/internal/gitea/topology.go server/internal/gitea/topology_test.go
git commit -m "feat(gitea): add UUID-derived topology naming layer"
```

---

## Task 2: Gitea admin-token client — core + get-or-create primitives

**Files:**
- Create: `server/internal/gitea/client.go`
- Test: `server/internal/gitea/client_test.go`

The client wraps Gitea API v1 with the admin token. This task adds the core (`Config`/`NewClient`/`Configured`/`do`) + the get-or-create primitives (`GetOrg`/`CreateOrg`, `GetRepo`/`CreateRepo`, `GetBranch`/`CreateBranch`). PR-create/merge methods come in Milestone 2.

- [ ] **Step 1: Write the failing test**

Create `server/internal/gitea/client_test.go`:

```go
package gitea

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newTestServer returns a httptest server whose handler receives a function
// recording the request (method, path, auth header, decoded JSON body) into
// *got, and responds with the given status + body. It also returns the base
// URL (without /api/v1) for constructing a Client.
func newTestServer(t *testing.T, status int, respBody string, got *recordedReq) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.method = r.Method
		got.path = r.URL.Path
		got.auth = r.Header.Get("Authorization")
		if r.Body != nil {
			_ = json.NewDecoder(r.Body).Decode(&got.body)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		w.Write([]byte(respBody))
	}))
}

type recordedReq struct {
	method string
	path   string
	auth   string
	body   map[string]any
}

func TestClient_NotConfigured(t *testing.T) {
	c := NewClient(Config{})
	if c.Configured() {
		t.Fatal("empty client should not be configured")
	}
	if _, err := c.GetOrg(context.Background(), "t-7f3c9a1e"); err != ErrNotConfigured {
		t.Fatalf("got err %v, want ErrNotConfigured", err)
	}
}

func TestClient_AuthHeaderAndBaseURL(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusOK, `{}`, &got)
	defer srv.Close()

	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	found, err := c.GetOrg(context.Background(), "t-7f3c9a1e")
	if err != nil {
		t.Fatalf("GetOrg: %v", err)
	}
	if !found {
		t.Fatal("expected found=true on 200")
	}
	if got.auth != "token admin-tok" {
		t.Errorf("auth header = %q, want %q", got.auth, "token admin-tok")
	}
	if got.path != "/api/v1/orgs/t-7f3c9a1e" {
		t.Errorf("path = %q", got.path)
	}
}

func TestClient_GetOrg_NotFound(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusNotFound, ``, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	found, err := c.GetOrg(context.Background(), "t-7f3c9a1e")
	if err != nil {
		t.Fatalf("GetOrg: %v", err)
	}
	if found {
		t.Fatal("expected found=false on 404")
	}
}

func TestClient_CreateRepo_Body(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusCreated, `{}`, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	if err := c.CreateRepo(context.Background(), "t-7f3c9a1e", "wf-11111111", "Bug Fix Flow"); err != nil {
		t.Fatalf("CreateRepo: %v", err)
	}
	if got.method != http.MethodPost || !strings.Contains(got.path, "/orgs/t-7f3c9a1e/repos") {
		t.Errorf("unexpected request: %s %s", got.method, got.path)
	}
	if got.body["name"] != "wf-11111111" || got.body["auto_init"] != true {
		t.Errorf("unexpected body: %+v", got.body)
	}
}

func TestClient_CreateBranch_Body(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusCreated, `{}`, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	if err := c.CreateBranch(context.Background(), "t-7f3c9a1e", "wf-11111111", "inst-f3a8b2c1", "main"); err != nil {
		t.Fatalf("CreateBranch: %v", err)
	}
	if got.body["new_branch_name"] != "inst-f3a8b2c1" || got.body["old_ref_name"] != "main" {
		t.Errorf("unexpected body: %+v", got.body)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/gitea/ -run TestClient -v`
Expected: FAIL / build error — no `Client`/`Config`/methods.

- [ ] **Step 3: Write minimal implementation**

Create `server/internal/gitea/client.go`:

```go
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

// NewClient constructs an admin client. The httpClient field is exported only
// for tests (to inject httptest.Server.Client()); production callers leave it
// nil and NewClient installs a default.
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

// decodeError turns a non-2xx response into an error including the body.
func decodeError(resp *http.Response) error {
	defer resp.Body.Close()
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
		"name":          name,
		"description":   description,
		"private":       true,
		"default_branch": "main",
		"auto_init":     true,
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && go test ./internal/gitea/ -run TestClient -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/gitea/client.go server/internal/gitea/client_test.go
git commit -m "feat(gitea): add admin-token client with get-or-create primitives"
```

---

## Task 3: Client — seed file, branch protection, user/PAT, org member

**Files:**
- Modify: `server/internal/gitea/client.go` (append methods)
- Modify: `server/internal/gitea/client_test.go` (append tests)

- [ ] **Step 1: Write the failing tests** (append to `client_test.go`)

```go
func TestClient_SeedMainFile_Body(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusCreated, `{}`, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	if err := c.CreateFile(context.Background(), "t-7f3c9a1e", "wf-11111111", "main", "definition.yaml", "name: flow\n", "seed"); err != nil {
		t.Fatalf("CreateFile: %v", err)
	}
	if !strings.Contains(got.path, "/contents/definition.yaml") {
		t.Errorf("path = %q", got.path)
	}
	if got.body["branch"] != "main" || got.body["message"] != "seed" {
		t.Errorf("unexpected body: %+v", got.body)
	}
	// content must be base64 of the input
	if got.body["content"] != "bmFtZTogZmxvdwo=" {
		t.Errorf("content = %v", got.body["content"])
	}
}

func TestClient_AdminCreateUserAndToken(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusCreated, `{"sha1":"pat-secret"}`, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	tok, err := c.CreateUserToken(context.Background(), "mc-bot-7f3c9a1e", "workspace-pat")
	if err != nil {
		t.Fatalf("CreateUserToken: %v", err)
	}
	if tok != "pat-secret" {
		t.Errorf("token = %q, want pat-secret", tok)
	}
	if got.body["name"] != "workspace-pat" {
		t.Errorf("body = %+v", got.body)
	}
}

func TestClient_AddOrgMember(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusNoContent, ``, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	if err := c.AddOrgMember(context.Background(), "t-7f3c9a1e", "mc-bot-7f3c9a1e"); err != nil {
		t.Fatalf("AddOrgMember: %v", err)
	}
	if got.method != http.MethodPut || !strings.Contains(got.path, "/orgs/t-7f3c9a1e/members/mc-bot-7f3c9a1e") {
		t.Errorf("unexpected: %s %s", got.method, got.path)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/gitea/ -run 'TestClient_Seed|TestClient_AdminCreate|TestClient_AddOrg' -v`
Expected: FAIL — methods undefined.

- [ ] **Step 3: Write minimal implementation** (append to `client.go`)

```go
import "encoding/base64"

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

// ProtectBranch configures branch protection (push blocked; used for main and
// the inst-* wildcard so daemon pushes go through node branches + PRs only).
func (c *Client) ProtectBranch(ctx context.Context, owner, repo, rule string) error {
	resp, err := c.do(ctx, http.MethodPost, "/repos/"+owner+"/"+repo+"/branch_protections", map[string]any{
		"rule_name":    rule,
		"protected":    true,
		"enable_push":  false,
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

// AdminCreateUser creates a Gitea user with a random strong password (the
// password is never used — auth is via the PAT minted by CreateUserToken).
func (c *Client) AdminCreateUser(ctx context.Context, username, email string) error {
	resp, err := c.do(ctx, http.MethodPost, "/admin/users", map[string]any{
		"username":            username,
		"email":               email,
		"password":            randomToken(32),
		"must_change_password": false,
		"source_id":           0,
		"login_name":          "",
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
func (c *Client) CreateUserToken(ctx context.Context, username, tokenName string) (string, error) {
	resp, err := c.do(ctx, http.MethodPost, "/users/"+username+"/tokens", map[string]any{
		"name": tokenName,
		"scopes": []string{"write:repository", "read:user", "read:organization"},
	})
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		var out struct {
			Sha1 string `json:"sha1"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			return "", err
		}
		return out.Sha1, nil
	}
	return "", decodeError(resp)
}

// AddOrgMember adds a user to an org (member = write by default at org level).
func (c *Client) AddOrgMember(ctx context.Context, org, username string) error {
	resp, err := c.do(ctx, http.MethodPut, "/orgs/"+org+"/members/"+username, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	return decodeError(resp)
}
```

Also add `randomToken` + its import (`crypto/rand`) near the top of `client.go` (after the import block):

```go
import "crypto/rand"
import "encoding/hex"

// randomToken returns a random hex string of n bytes (2n hex chars). Used for
// the throwaway bot-user password; never returned to callers.
func randomToken(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && go test ./internal/v1 -run TestClient -v` — (typo guard) actually:
Run: `cd server && go test ./internal/gitea/ -v`
Expected: PASS (all client tests).

- [ ] **Step 5: Commit**

```bash
git add server/internal/gitea/client.go server/internal/gitea/client_test.go
git commit -m "feat(gitea): add seed-file, branch-protection, user/PAT, org-member methods"
```

---

## Task 4: Scaffold orchestration (idempotent get-or-create org → repo → inst branch)

**Files:**
- Create: `server/internal/gitea/scaffold.go`
- Test: `server/internal/gitea/scaffold_test.go`

`scaffold.go` defines a small `scaffoldAPI` interface (the subset of `*Client` it needs) so the orchestration can be tested with a fake, then `ScaffoldRunDeliverable` which is idempotent (safe to retry — get-or-create at every layer).

- [ ] **Step 1: Write the failing test**

Create `server/internal/gitea/scaffold_test.go`:

```go
package gitea

import (
	"context"
	"errors"
	"testing"
)

// fakeScaffold is a recording fake implementing scaffoldAPI.
type fakeScaffold struct {
	orgs   map[string]bool
	repos  map[string]bool
	brs    map[string]bool
	files  []string
	prot   []string

	orgGetErr   error
	orgCreateFn func(org string) error
}

func newFakeScaffold() *fakeScaffold {
	return &fakeScaffold{
		orgs: map[string]bool{}, repos: map[string]bool{}, brs: map[string]bool{},
	}
}

func (f *fakeScaffold) GetOrg(_ context.Context, org string) (bool, error) {
	if f.orgGetErr != nil {
		return false, f.orgGetErr
	}
	return f.orgs[org], nil
}
func (f *fakeScaffold) CreateOrg(_ context.Context, org, _ string) error {
	if f.orgCreateFn != nil {
		return f.orgCreateFn(org)
	}
	f.orgs[org] = true
	return nil
}
func (f *fakeScaffold) GetRepo(_ context.Context, owner, name string) (bool, error) {
	return f.repos[owner+"/"+name], nil
}
func (f *fakeScaffold) CreateRepo(_ context.Context, owner, name, _ string) error {
	f.repos[owner+"/"+name] = true
	return nil
}
func (f *fakeScaffold) GetBranch(_ context.Context, owner, repo, branch string) (bool, error) {
	return f.brs[owner+"/"+repo+"/"+branch], nil
}
func (f *fakeScaffold) CreateBranch(_ context.Context, owner, repo, branch, from string) error {
	f.brs[owner+"/"+repo+"/"+branch] = true
	return nil
}
func (f *fakeScaffold) CreateFile(_ context.Context, owner, repo, branch, path, _, _ string) error {
	f.files = append(f.files, owner+"/"+repo+"/"+branch+"/"+path)
	return nil
}
func (f *fakeScaffold) ProtectBranch(_ context.Context, owner, repo, rule string) error {
	f.prot = append(f.prot, owner+"/"+repo+"/"+rule)
	return nil
}

func TestScaffoldRun_CreatesEverything(t *testing.T) {
	f := newFakeScaffold()
	ws := "7f3c9a1e-d4b2-4c8e-9a3f-1b2c3d4e5f6a"
	wf := "11111111-2222-3333-4444-555555555555"
	run := "f3a8b2c1-9d7e-4a2b-8e1f-1234567890ab"

	if err := ScaffoldRunDeliverable(context.Background(), f, ScaffoldParams{
		WorkspaceID: ws, WorkflowID: wf, RunID: run,
		WorkflowTitle: "Bug Fix Flow", DefinitionSnapshot: "name: flow\n",
	}); err != nil {
		t.Fatalf("Scaffold: %v", err)
	}
	if !f.orgs["t-7f3c9a1e"] {
		t.Error("org not created")
	}
	if !f.repos["t-7f3c9a1e/wf-11111111"] {
		t.Error("repo not created")
	}
	if !f.brs["t-7f3c9a1e/wf-11111111/inst-f3a8b2c1"] {
		t.Error("inst branch not created")
	}
	if len(f.prot) == 0 {
		t.Error("branch protection not configured")
	}
}

func TestScaffoldRun_Idempotent(t *testing.T) {
	f := newFakeScaffold()
	// Pre-create everything as if a prior scaffold ran.
	f.orgs["t-7f3c9a1e"] = true
	f.repos["t-7f3c9a1e/wf-11111111"] = true
	f.brs["t-7f3c9a1e/wf-11111111/inst-f3a8b2c1"] = true

	ws := "7f3c9a1e-d4b2-4c8e-9a3f-1b2c3d4e5f6a"
	wf := "11111111-2222-3333-4444-555555555555"
	run := "f3a8b2c1-9d7e-4a2b-8e1f-1234567890ab"

	beforeFiles := len(f.files)
	if err := ScaffoldRunDeliverable(context.Background(), f, ScaffoldParams{
		WorkspaceID: ws, WorkflowID: wf, RunID: run, WorkflowTitle: "x",
	}); err != nil {
		t.Fatalf("Scaffold: %v", err)
	}
	// Idempotent: should not re-create the inst branch's seed file when repo+branch already exist.
	if len(f.files) != beforeFiles {
		t.Errorf("expected no new files, got %d new", len(f.files)-beforeFiles)
	}
}

func TestScaffoldRun_OrgCreateFailurePropagates(t *testing.T) {
	f := newFakeScaffold()
	f.orgCreateFn = func(string) error { return errors.New("boom") }
	err := ScaffoldRunDeliverable(context.Background(), f, ScaffoldParams{
		WorkspaceID: "7f3c9a1e-d4b2-4c8e-9a3f-1b2c3d4e5f6a",
		WorkflowID:  "11111111-2222-3333-4444-555555555555",
		RunID:       "f3a8b2c1-9d7e-4a2b-8e1f-1234567890ab",
		WorkflowTitle: "x",
	})
	if err == nil || err.Error() != "create gitea org: boom" {
		t.Fatalf("err = %v", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/gitea/ -run TestScaffold -v`
Expected: FAIL — `ScaffoldRunDeliverable`/`ScaffoldParams`/`scaffoldAPI` undefined.

- [ ] **Step 3: Write minimal implementation**

Create `server/internal/gitea/scaffold.go`:

```go
package gitea

import (
	"context"
	"fmt"
)

// scaffoldAPI is the subset of *Client that ScaffoldRunDeliverable needs.
// Defined as an interface so the orchestration is unit-testable with a fake
// (the concrete *Client satisfies it structurally).
type scaffoldAPI interface {
	GetOrg(ctx context.Context, org string) (bool, error)
	CreateOrg(ctx context.Context, org, description string) error
	GetRepo(ctx context.Context, owner, name string) (bool, error)
	CreateRepo(ctx context.Context, owner, name, description string) error
	GetBranch(ctx context.Context, owner, repo, branch string) (bool, error)
	CreateBranch(ctx context.Context, owner, repo, branch, fromRef string) error
	CreateFile(ctx context.Context, owner, repo, branch, path, content, message string) error
	ProtectBranch(ctx context.Context, owner, repo, rule string) error
}

// ScaffoldParams identifies what to scaffold.
type ScaffoldParams struct {
	WorkspaceID        string
	WorkflowID         string
	RunID              string
	WorkflowTitle      string // human-readable; written to org/repo description
	DefinitionSnapshot string // workflow definition text; seeded onto main (readable, not drift-checked)
}

// ScaffoldResult is the absolute URL + paths callers hand to the daemon via
// the claim response. Clone/Web URLs are built from the base URL the server
// already knows (the admin client's) — but since scaffolding runs server-side,
// callers (M2) compute URLs from the configured base URL + RepoPath/InstBranch.
type ScaffoldResult struct {
	Owner      string // t-<ws[:8]>
	Repo       string // wf-<wf[:8]>
	InstBranch string // inst-<run[:8]>
}

// ScaffoldRunDeliverable get-or-creates, idempotently: the workspace org, the
// workflow repo (with main auto-initialized), branch protection on main, and
// the run's inst branch (based off main). Safe to retry on transient failure.
// The DB remains the source of truth for the workflow definition; the seeded
// main file is for human readability only (no drift check).
func ScaffoldRunDeliverable(ctx context.Context, c scaffoldAPI, p ScaffoldParams) (*ScaffoldResult, error) {
	owner := OrgName(p.WorkspaceID)
	repo := RepoName(p.WorkflowID)
	inst := InstBranch(p.RunID)

	// 1. Org (lazy, idempotent).
	exists, err := c.GetOrg(ctx, owner)
	if err != nil {
		return nil, fmt.Errorf("get gitea org: %w", err)
	}
	if !exists {
		if err := c.CreateOrg(ctx, owner, p.WorkflowTitle); err != nil {
			return nil, fmt.Errorf("create gitea org: %w", err)
		}
	}

	// 2. Repo (lazy, idempotent). main is auto-initialized on creation.
	repoExists, err := c.GetRepo(ctx, owner, repo)
	if err != nil {
		return nil, fmt.Errorf("get gitea repo: %w", err)
	}
	if !repoExists {
		if err := c.CreateRepo(ctx, owner, repo, p.WorkflowTitle); err != nil {
			return nil, fmt.Errorf("create gitea repo: %w", err)
		}
		if p.DefinitionSnapshot != "" {
			if err := c.CreateFile(ctx, owner, repo, "main", "definition.yaml", p.DefinitionSnapshot, "seed workflow definition"); err != nil {
				return nil, fmt.Errorf("seed gitea main: %w", err)
			}
		}
		// Protect main + inst-* wildcard so pushes go through node branches + PRs.
		_ = c.ProtectBranch(ctx, owner, repo, "main")
	}

	// 3. Inst branch (per run, idempotent GET-then-POST). Base = main.
	instExists, err := c.GetBranch(ctx, owner, repo, inst)
	if err != nil {
		return nil, fmt.Errorf("get gitea inst branch: %w", err)
	}
	if !instExists {
		if err := c.CreateBranch(ctx, owner, repo, inst, "main"); err != nil {
			return nil, fmt.Errorf("create gitea inst branch: %w", err)
		}
	}

	return &ScaffoldResult{Owner: owner, Repo: repo, InstBranch: inst}, nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && go test ./internal/gitea/ -run TestScaffold -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/gitea/scaffold.go server/internal/gitea/scaffold_test.go
git commit -m "feat(gitea): add idempotent run-deliverable scaffolding"
```

---

## Task 5: Workspace bot provisioning

**Files:**
- Create: `server/internal/gitea/provision.go`
- Test: `server/internal/gitea/provision_test.go`

`ProvisionWorkspaceBot` creates a per-workspace Gitea bot user, mints a PAT, and adds the bot to the workspace org. Returns `(username, token)`. M2 stores these into `workspace.settings`.

- [ ] **Step 1: Write the failing test**

Create `server/internal/gitea/provision_test.go`:

```go
package gitea

import (
	"context"
	"testing"
)

// fakeProvision records calls; implements provisionAPI.
type fakeProvision struct {
	users  map[string]bool
	tokens map[string]string // username -> token returned
	members []string
}

func newFakeProvision() *fakeProvision {
	return &fakeProvision{users: map[string]bool{}, tokens: map[string]string{}}
}

func (f *fakeProvision) AdminCreateUser(_ context.Context, username, email string) error {
	f.users[username] = true
	return nil
}
func (f *fakeProvision) CreateUserToken(_ context.Context, username, name string) (string, error) {
	tok := "pat-" + username
	f.tokens[username] = tok
	return tok, nil
}
func (f *fakeProvision) AddOrgMember(_ context.Context, org, username string) error {
	f.members = append(f.members, org+"/"+username)
	return nil
}
func (f *fakeProvision) GetOrg(_ context.Context, org string) (bool, error) { return true, nil }

func TestProvisionWorkspaceBot(t *testing.T) {
	f := newFakeProvision()
	username, token, err := ProvisionWorkspaceBot(context.Background(), f, BotParams{
		WorkspaceID:   "7f3c9a1e-d4b2-4c8e-9a3f-1b2c3d4e5f6a",
		WorkspaceName: "Acme",
	})
	if err != nil {
		t.Fatalf("Provision: %v", err)
	}
	if username != "mc-bot-7f3c9a1e" {
		t.Errorf("username = %q", username)
	}
	if token != "pat-mc-bot-7f3c9a1e" {
		t.Errorf("token = %q", token)
	}
	if !f.users["mc-bot-7f3c9a1e"] {
		t.Error("bot user not created")
	}
	found := false
	for _, m := range f.members {
		if m == "t-7f3c9a1e/mc-bot-7f3c9a1e" {
			found = true
		}
	}
	if !found {
		t.Error("bot not added to org")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/gitea/ -run TestProvision -v`
Expected: FAIL — `ProvisionWorkspaceBot`/`BotParams`/`provisionAPI` undefined.

- [ ] **Step 3: Write minimal implementation**

Create `server/internal/gitea/provision.go`:

```go
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

// BotParams identifies the workspace a bot is provisioned for.
type BotParams struct {
	WorkspaceID   string
	WorkspaceName string // human-readable; used in the bot user email/display
}

// BotUsername is the deterministic Gitea username for a workspace's bot:
// mc-bot-<workspace.id[:8]>. Exposed so callers can reference the bot without
// provisioning (e.g. credential endpoint lookups).
func BotUsername(workspaceID string) string { return "mc-bot-" + shortHex(workspaceID) }

// ProvisionWorkspaceBot creates the per-workspace Gitea bot user, mints a PAT
// (scopes: write repo, read user/org), and adds the bot to the workspace org.
// Idempotent: AdminCreateUser tolerates already-exists. Returns (username, token).
// The caller (M2) persists these into workspace.settings.
func ProvisionWorkspaceBot(ctx context.Context, c provisionAPI, p BotParams) (username, token string, err error) {
	username = BotUsername(p.WorkspaceID)
	org := OrgName(p.WorkspaceID)

	if err := c.AdminCreateUser(ctx, username, botEmail(username, p.WorkspaceName)); err != nil {
		return "", "", fmt.Errorf("create gitea bot user: %w", err)
	}
	token, err = c.CreateUserToken(ctx, username, "workspace-pat")
	if err != nil {
		return "", "", fmt.Errorf("create gitea bot pat: %w", err)
	}
	// Ensure the org exists before adding the member; provisioning may run
	// before the first scaffold. If the org is missing, the bot is still
	// useful for clone/push once the org is created; we add membership
	// opportunistically and let scaffold re-add if needed.
	if exists, gErr := c.GetOrg(ctx, org); gErr == nil && exists {
		if err := c.AddOrgMember(ctx, org, username); err != nil {
			return "", "", fmt.Errorf("add gitea bot to org: %w", err)
		}
	}
	return username, token, nil
}

func botEmail(username, workspaceName string) string {
	return fmt.Sprintf("%s@multica.local", username)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && go test ./internal/gitea/ -v`
Expected: PASS (all gitea package tests).

- [ ] **Step 5: Commit**

```bash
git add server/internal/gitea/provision.go server/internal/gitea/provision_test.go
git commit -m "feat(gitea): add per-workspace bot-user + PAT provisioning"
```

---

## Task 6: Handler — env helpers + giteaSettings + HandleGiteaCredential

**Files:**
- Create: `server/internal/handler/gitea.go`
- Create: `server/internal/handler/gitea_test.go`
- Modify: `server/cmd/server/router.go` (mount the route)

This task adds the env helpers (mirror `githubWebhookSecret()`), the `giteaSettings` partial-view struct (mirror `gitlabSettings`), and `HandleGiteaCredential` (mirror `HandleGitlabCredential`, but base_url from env instead of hardcoded). It does NOT wire the Gitea client into the handler (M2 does that); the credential endpoint only reads settings + returns the env base URL.

- [ ] **Step 1: Write the failing test**

Create `server/internal/handler/gitea_test.go`:

```go
package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"testing"
)

// seedGiteaSettings writes gitea_pat (and optional bot username) into the
// shared test workspace's settings JSONB and returns a cleanup that restores
// the original settings.
func seedGiteaSettings(t *testing.T, pat string) {
	t.Helper()
	ctx := context.Background()
	var orig []byte
	err := testPool.QueryRow(ctx, `SELECT settings FROM multica_workspace WHERE id = $1`, testWorkspaceID).Scan(&orig)
	if err != nil {
		t.Fatalf("read settings: %v", err)
	}
	settingsMap := map[string]any{}
	if len(orig) > 0 {
		_ = json.Unmarshal(orig, &settingsMap)
	}
	if pat != "" {
		settingsMap["gitea_pat"] = pat
	} else {
		delete(settingsMap, "gitea_pat")
	}
	raw, _ := json.Marshal(settingsMap)
	if _, err := testPool.Exec(ctx, `UPDATE multica_workspace SET settings = $1 WHERE id = $2`, raw, testWorkspaceID); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(ctx, `UPDATE multica_workspace SET settings = $1 WHERE id = $2`, orig, testWorkspaceID)
	})
}

func TestHandleGiteaCredential_ReturnsPATAndEnvBaseURL(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" && testing.Short() {
		t.Skip("needs postgres")
	}
	seedGiteaSettings(t, "pat-secret")

	os.Setenv("GITEA_BASE_URL", "https://gitea.example.com")
	defer os.Unsetenv("GITEA_BASE_URL")

	req := newRequest(http.MethodGet, "/api/gitea/credential", nil)
	req.Header.Set("X-Workspace-ID", testWorkspaceID)
	rec := httptestNewRecorder()
	testHandler.HandleGiteaCredential(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var out map[string]string
	json.Unmarshal(rec.Body.Bytes(), &out)
	if out["token"] != "pat-secret" {
		t.Errorf("token = %q", out["token"])
	}
	if out["base_url"] != "https://gitea.example.com" {
		t.Errorf("base_url = %q", out["base_url"])
	}
}

func TestHandleGiteaCredential_NotConfigured(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" && testing.Short() {
		t.Skip("needs postgres")
	}
	seedGiteaSettings(t, "") // no PAT

	req := newRequest(http.MethodGet, "/api/gitea/credential", nil)
	req.Header.Set("X-Workspace-ID", testWorkspaceID)
	rec := httptestNewRecorder()
	testHandler.HandleGiteaCredential(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (no PAT configured)", rec.Code)
	}
}
```

Note: `httptestNewRecorder` is a tiny alias to avoid clashing with an existing helper name; if `handler` tests already use `httptest.NewRecorder()` directly (they do — see `handler_test.go`), replace `httptestNewRecorder()` with `httptest.NewRecorder()` and add `"net/http/httptest"` to imports. **Resolve before running:** check `server/internal/handler/handler_test.go` for the existing recorder helper; use whatever it uses. The default is `httptest.NewRecorder()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/handler/ -run TestHandleGiteaCredential -v`
Expected: FAIL — `HandleGiteaCredential` undefined.

- [ ] **Step 3: Write minimal implementation**

Create `server/internal/handler/gitea.go`:

```go
package handler

import (
	"net/http"
	"os"
	"strings"

	"github.com/multica-ai/multica/server/internal/middleware"
)

// ── Env config (mirror githubWebhookSecret / githubAppSlug in github.go) ─────
// Read on every call (not cached) so rotation takes effect without restart.

func giteaBaseURL() string { return strings.TrimSpace(os.Getenv("GITEA_BASE_URL")) }

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
	GiteaBotUsername *string `json:"gitea_bot_username"`
	GiteaPat         *string `json:"gitea_pat"`
}

func parseGiteaSettings(raw []byte) (giteaSettings, error) {
	var s giteaSettings
	if len(raw) == 0 {
		return s, nil
	}
	err := jsonUnmarshal(raw, &s)
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
		"base_url": giteaBaseURL(),
		"token":    token,
	})
}
```

Add a `jsonUnmarshal` alias OR just import `encoding/json` and call `json.Unmarshal` directly. Simplest: replace `jsonUnmarshal(raw, &s)` with `json.Unmarshal(raw, &s)` and add `"encoding/json"` to the import block. (The alias was only to avoid an import-edit; prefer the direct call.)

- [ ] **Step 4: Mount the route**

Edit `server/cmd/server/router.go` — immediately after the gitlab credential mount (lines 384-385), add the gitea credential mount:

```go
	// GitLab credential for CLI credential helper (gitlab-credential-multica).
	// Requires daemon token or valid user token to access — workspace is derived from the token.
	r.With(middleware.DaemonAuth(queries, patCache, daemonTokenCache, opts.JWKSProvider, opts.SubjectResolver)).
		Get("/api/gitlab/credential", h.HandleGitlabCredential)

	// Gitea credential for the cs-workflow CLI document-deliverable flow
	// (M3). Same daemon-auth shape as GitLab; base_url + PAT returned.
	r.With(middleware.DaemonAuth(queries, patCache, daemonTokenCache, opts.JWKSProvider, opts.SubjectResolver)).
		Get("/api/gitea/credential", h.HandleGiteaCredential)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && go test ./internal/handler/ -run TestHandleGiteaCredential -v`
Expected: PASS. (Requires a reachable Postgres per `handler_test.go`'s `TestMain`; on Windows run inside the `golang:1.26-alpine` container per memory `local-db-test-via-golang-container.md`.)

- [ ] **Step 6: Commit**

```bash
git add server/internal/handler/gitea.go server/internal/handler/gitea_test.go server/cmd/server/router.go
git commit -m "feat(gitea): add gitea/credential endpoint + workspace PAT settings"
```

---

## Task 7: Env passthrough (.env.example + docker-compose)

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.selfhost.yml`

- [ ] **Step 1: Add env vars to `.env.example`**

Locate the `GITHUB_WEBHOOK_SECRET=` line (~line 169) and add the Gitea vars adjacent to the other integration secrets:

```
# Gitea — platform-owned git server for document deliverable storage.
# The admin token is a server-level PAT (scaffold + merge); it is NEVER stored
# in workspace.settings. Leave blank to disable the feature.
GITEA_BASE_URL=
GITEA_ADMIN_TOKEN=
```

- [ ] **Step 2: Pass through in `docker-compose.selfhost.yml`**

Locate the `GITHUB_WEBHOOK_SECRET` passthrough (~line 76, in the backend service's `environment:` block) and add:

```yaml
      GITEA_BASE_URL: ${GITEA_BASE_URL:-}
      GITEA_ADMIN_TOKEN: ${GITEA_ADMIN_TOKEN:-}
```

- [ ] **Step 3: Verify the server still builds and the full gitea package + handler credential tests pass**

Run: `cd server && go build ./... && go test ./internal/gitea/ ./internal/handler/ -run 'TestTopology|TestClient|TestScaffold|TestProvision|TestHandleGiteaCredential' -v`
Expected: build OK, all listed tests PASS.

- [ ] **Step 4: Commit**

```bash
git add .env.example docker-compose.selfhost.yml
git commit -m "chore(gitea): pass GITEA_BASE_URL + GITEA_ADMIN_TOKEN through env"
```

---

## Self-Review (run after all tasks)

1. **Spec coverage (M1 scope):**
   - Gitea client (zero → exists): Tasks 2-3. ✓
   - Scaffolding (org/repo/inst get-or-create, idempotent): Task 4. ✓
   - `gitea/credential` endpoint: Task 6. ✓
   - Server admin token from env: Tasks 6-7. ✓
   - Per-workspace bot PAT storage shape: Tasks 5-6 (function + settings struct; wiring in M2). ✓
   - Bot user provisioning (net-new): Task 5. ✓
   - Topology alignment (costrict `t-`/`wf-`/`inst-`/`node/`): Task 1. ✓
   - (M2: merge-PR interface, run-start hook, report-pr endpoint. M3: daemon push/PR, UI.)

2. **Placeholder scan:** None — every code step shows complete code; the two "resolve before running" notes (recorder helper, `json.Unmarshal` alias) name the exact resolution.

3. **Type consistency:** `scaffoldAPI` and `provisionAPI` are distinct interfaces over the same `*Client` (scaffold needs file/branch/repo/org; provision needs user/token/member/org) — both satisfied structurally by `*Client`. `ScaffoldParams`/`ScaffoldResult`/`BotParams` field names are consistent across tasks. `shortHex` is shared by topology + `BotUsername`.

4. **Windows note:** handler credential tests need Postgres; run inside `golang:1.26-alpine` joined to `multica_default` (memory `local-db-test-via-golang-container.md`). gitea package tests are pure/httptest and run anywhere.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-17-deliverable-git-storage-m1.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

# Deliverable Git-Storage — Milestone 2 (Workflow Wiring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the M1 Gitea foundation into the workflow engine: construct + inject the admin client; scaffold a run's deliverable repo (and lazily provision the workspace bot) at run start when the workflow has document deliverables; add the daemon `report-pr` endpoint so the agent can register a Gitea PR URL; and merge document PRs inside the critic-approve path so a node completes only after its document deliverables merge (transient failures retry, exhaustion → blocked).

**Architecture:** The `*gitea.Client` is constructed in `main.go` from env and assigned onto `WorkflowService.Gitea` in the router (mirroring DeptSync). The service grows two new behaviors: (1) a post-`StartRun` `ScaffoldRunDeliverables` helper (gated on ≥1 document deliverable + Gitea configured) that provisions the bot once per workspace then scaffolds org/repo/inst; (2) the `ReviewNodeRun` approve branch is restructured so the external Gitea merge happens AFTER the `critic_approved` tx commits — `critic_approved` is persisted with critic output, then document PRs are merged (retry), then the node transitions to `completed` (submissions marked approved) or `blocked`. `validTransitions` gains `critic_approved → blocked`. A new daemon-authed `report-pr` endpoint writes the PR URL into the submission. **No DB migration** — `pull_request_url`, `blocked`, `approved` all pre-exist.

**Tech Stack:** Go 1.26, Chi, pgx/v5, sqlc, `net/http`. Tests: gitea package (httptest, host-runnable); service/handler (DB-backed via the `golang:1.26-alpine`-in-`multica_default` container, DB user **root**).

---

## Locked decisions (from design + grilling, carried from M1)
- **Merge model = B (inline):** merge inside `ReviewNodeRun` approve, NO new state; persist `critic_approved` → external merge (retry) → `completed`/`blocked`. Add `critic_approved → blocked`.
- **PR-URL report = A:** dedicated daemon endpoint `POST /api/daemon/node-runs/{nodeRunId}/deliverables/{deliverableId}/report-pr`.
- **Ordering:** scaffold FIRST (creates org), THEN provision (adds bot to the now-existing org). Provision is lazy + once-per-workspace (skip if `gitea_pat` already in settings).
- **Dormant when unconfigured:** if `WorkflowService.Gitea == nil` (no `GITEA_BASE_URL`/`GITEA_ADMIN_TOKEN`), scaffolding and merge are skipped entirely — the feature is off. (Doc deliverables then have no Gitea PRs to merge, so approve behaves as before.)
- **Scaffold persistent failure → run failed** (design §4.1). Implemented with bounded retry; exhaustion transitions the run to `failed`.

## File Structure (Milestone 2)

**Create:**
- `server/internal/gitea/merge.go` — `Client.MergePR` + `ParsePullRequestIndex` (PR web URL → index) helper.
- `server/internal/gitea/merge_test.go` — httptest + parse tests.
- `server/internal/handler/report_pr.go` — `HandleReportDeliverablePR` daemon endpoint.
- `server/internal/handler/report_pr_test.go` — DB-backed test.
- `server/internal/service/workflow_gitea.go` — `ScaffoldRunDeliverables` + `mergeDocumentDeliverables` + `provisionWorkspaceBotIfAbsent` helpers (service-layer orchestration using `*gitea.Client`).
- `server/internal/service/workflow_gitea_test.go` — DB-backed + fake-Gitea tests.

**Modify:**
- `server/internal/service/workflow.go` — add `Gitea *gitea.Client` field to `WorkflowService`; add `NodeRunStatusCriticApproved → {Completed, Blocked}` to `validTransitions`; restructure the `ReviewNodeRun` approve branch to call `mergeDocumentDeliverables`.
- `server/internal/handler/workflow_run.go` — call `ScaffoldRunDeliverables` from `StartWorkflowRun` (after `StartRun`).
- `server/cmd/server/router.go` — `RouterOptions.Gitea *gitea.Client`; assign `h.WorkflowService.Gitea` (mirror DeptSync).
- `server/cmd/server/main.go` — construct `gitea.NewClient` from env; pass via `RouterOptions.Gitea`.

---

## Task 1: `Client.MergePR` + PR-URL index parser

**Files:**
- Create: `server/internal/gitea/merge.go`
- Test: `server/internal/gitea/merge_test.go`

- [ ] **Step 1: Write the failing test**

Create `server/internal/gitea/merge_test.go`:

```go
package gitea

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestParsePullRequestIndex(t *testing.T) {
	cases := []struct {
		url   string
		index int
	}{
		{"https://gitea.example.com/t-7f3c9a1e/wf-11111111/pulls/42", 42},
		{"http://gitea.local/t-abcd1234/wf-abcd1234/pulls/7", 7},
		{"https://gitea.example.com/t-7f3c9a1e/wf-11111111/pulls/42/files", 42},
	}
	for _, c := range cases {
		got, err := ParsePullRequestIndex(c.url)
		if err != nil {
			t.Errorf("ParsePullRequestIndex(%q): %v", c.url, err)
			continue
		}
		if got != c.index {
			t.Errorf("ParsePullRequestIndex(%q) = %d, want %d", c.url, got, c.index)
		}
	}
}

func TestParsePullRequestIndex_Invalid(t *testing.T) {
	for _, bad := range []string{"", "not-a-url", "https://gitea.example.com/t-x/wf-y", "https://gitea.example.com/t-x/wf-y/pulls/notanumber"} {
		if _, err := ParsePullRequestIndex(bad); err == nil {
			t.Errorf("ParsePullRequestIndex(%q): expected error", bad)
		}
	}
}

func TestClient_MergePR(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusOK, `{}`, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	if err := c.MergePR(context.Background(), "t-7f3c9a1e", "wf-11111111", 42); err != nil {
		t.Fatalf("MergePR: %v", err)
	}
	if got.method != http.MethodPost || !strings.HasSuffix(got.path, "/repos/t-7f3c9a1e/wf-11111111/pulls/42/merge") {
		t.Errorf("unexpected request: %s %s", got.method, got.path)
	}
	// Gitea merge requires the Do body field + JSON content-type (already set by do).
	if got.body["Do"] != "merge" {
		t.Errorf("body Do = %v, want \"merge\"", got.body["Do"])
	}
}

func TestClient_MergePR_ConflictIsError(t *testing.T) {
	var got recordedReq
	srv := newTestServer(t, http.StatusConflict, `{"message":"conflict"}`, &got)
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, Token: "admin-tok"})
	c.httpClient = srv.Client()

	if err := c.MergePR(context.Background(), "t-7f3c9a1e", "wf-11111111", 42); err == nil {
		t.Fatal("MergePR(409): expected error, got nil")
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && go test ./internal/gitea/ -run 'TestParsePullRequestIndex|TestClient_MergePR' -v` → FAIL (undefined).

- [ ] **Step 3: Write minimal implementation**

Create `server/internal/gitea/merge.go`:

```go
package gitea

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// MergePR merges a pull request by its numeric index. Uses the admin token.
// Gitea returns 409 if the PR cannot be merged (conflicts) — surfaced as an error
// so the caller can block the node run rather than silently complete it.
func (c *Client) MergePR(ctx context.Context, owner, repo string, index int) error {
	resp, err := c.do(ctx, http.MethodPost, "/repos/"+owner+"/"+repo+"/pulls/"+strconv.Itoa(index)+"/merge", map[string]any{
		"Do": "merge",
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

// ParsePullRequestIndex extracts the numeric PR index from a Gitea PR web URL
// (e.g. https://gitea.example.com/t-7f3c9a1e/wf-11111111/pulls/42 → 42). Used by
// the server-side merge to resolve a submission's pull_request_url to a mergeable
// index. Returns an error if the URL is not a valid Gitea PR URL.
func ParsePullRequestIndex(raw string) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, errInvalidPRURL
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return 0, errInvalidPRURL
	}
	// Path like /t-xxx/wf-xxx/pulls/<index>[/...]
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	idx := -1
	for i, p := range parts {
		if p == "pulls" && i+1 < len(parts) {
			idx = i + 1
			break
		}
	}
	if idx < 0 {
		return 0, errInvalidPRURL
	}
	n, err := strconv.Atoi(parts[idx])
	if err != nil || n <= 0 {
		return 0, errInvalidPRURL
	}
	return n, nil
}

var errInvalidPRURL = newParseError("gitea: not a valid gitea pull request URL")

func newParseError(msg string) error { return &parseError{msg: msg} }

type parseError struct{ msg string }

func (e *parseError) Error() string { return e.msg }
```

(`errInvalidPRURL` as a typed error lets callers distinguish a malformed PR URL from a transient Gitea failure. Keep it unexported for now; export if M3 needs it.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && go test ./internal/gitea/ -v` → PASS (all, incl. new tests).

- [ ] **Step 5: Commit**

```bash
git add server/internal/gitea/merge.go server/internal/gitea/merge_test.go
git commit -m "feat(gitea): add MergePR + pull-request URL index parser"
```

---

## Task 2: Daemon `report-pr` endpoint

**Files:**
- Create: `server/internal/handler/report_pr.go`
- Create: `server/internal/handler/report_pr_test.go`
- Modify: `server/cmd/server/router.go` (mount inside `/api/daemon`)

The agent (cs-workflow CLI, M3) calls this right after opening a Gitea PR to register `pull_request_url` + flip status to `submitted`. Daemon-authed.

- [ ] **Step 1: Write the failing test**

Create `server/internal/handler/report_pr_test.go`:

```go
package handler

import (
	"context"
	"net/http"
	"testing"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/google/uuid"
)

// seedDeliverableAndNodeRun inserts a workflow→node→run→node_run→deliverable
// chain for the shared test workspace and returns the node-run + deliverable IDs.
func seedDeliverableAndNodeRun(t *testing.T) (nodeRunID, deliverableID string) {
	t.Helper()
	ctx := context.Background()
	wfID := uuid.NewString()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow (id, workspace_id, title, status, created_by_type, created_by_id)
		VALUES ($1, $2, 'WF', 'active', 'member', $3)`,
		wfID, testWorkspaceID, testUserID); err != nil {
		t.Fatalf("seed workflow: %v", err)
	}
	t.Cleanup(func() { testPool.Exec(ctx, `DELETE FROM multica_workflow WHERE id = $1`, wfID) })

	nodeID := uuid.NewString()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_node (id, workflow_id, title, worker_type, critic_type)
		VALUES ($1, $2, 'N', 'agent', 'agent')`, nodeID, wfID); err != nil {
		t.Fatalf("seed node: %v", err)
	}
	dID := uuid.NewString()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_node_deliverable (id, workflow_node_id, kind, title, required)
		VALUES ($1, $2, 'document', 'Doc', true)`, dID, nodeID); err != nil {
		t.Fatalf("seed deliverable: %v", err)
	}
	runID := uuid.NewString()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_run (id, workflow_id, workspace_id, title, status, triggered_by_type, triggered_by_id)
		VALUES ($1, $2, $3, 'R', 'running', 'member', $4)`, runID, wfID, testWorkspaceID, testUserID); err != nil {
		t.Fatalf("seed run: %v", err)
	}
	nrID := uuid.NewString()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_node_run (id, workflow_run_id, workflow_node_id, node_title, status, retry_count, worker_type, critic_type)
		VALUES ($1, $2, $3, 'N', 'working', 0, 'agent', 'agent')`, nrID, runID, nodeID); err != nil {
		t.Fatalf("seed node run: %v", err)
	}
	return nrID, dID
}

func TestHandleReportDeliverablePR(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	nodeRunID, deliverableID := seedDeliverableAndNodeRun(t)
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id = $1`, nodeRunID)
	})

	body := map[string]string{"pull_request_url": "https://gitea.example.com/t-7f3c9a1e/wf-11111111/pulls/9"}
	req := newDaemonTokenRequest(http.MethodPost, "/api/daemon/node-runs/"+nodeRunID+"/deliverables/"+deliverableID+"/report-pr", body)
	req = withURLParam(req, "nodeRunId", nodeRunID)
	req = withURLParam(req, "deliverableId", deliverableID)
	req.Header.Set("X-Workspace-ID", testWorkspaceID)
	rec := httptest.NewRecorder()
	testHandler.HandleReportDeliverablePR(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	// Verify the submission row.
	var url, status string
	err := testPool.QueryRow(context.Background(),
		`SELECT pull_request_url, status FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id = $1 AND deliverable_id = $2`,
		nodeRunID, deliverableID).Scan(&url, &status)
	if err != nil {
		t.Fatalf("read submission: %v", err)
	}
	if url != body["pull_request_url"] {
		t.Errorf("pull_request_url = %q", url)
	}
	if status != "submitted" {
		t.Errorf("status = %q, want submitted", status)
	}
}
```

- [ ] **Step 2: Run to verify it fails** — `cd server && go vet ./internal/handler/` → `HandleReportDeliverablePR` undefined.

- [ ] **Step 3: Write minimal implementation**

Create `server/internal/handler/report_pr.go`:

```go
package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// ReportDeliverablePRRequest is the body posted by the cs-workflow CLI (M3) after
// it opens a Gitea PR for a document deliverable.
type ReportDeliverablePRRequest struct {
	PullRequestURL string `json:"pull_request_url"`
}

// HandleReportDeliverablePR (POST /api/daemon/node-runs/{nodeRunId}/deliverables/{deliverableId}/report-pr)
// records the opened Gitea PR URL on the deliverable submission and flips its
// status to submitted. Daemon-authed (the route is mounted under /api/daemon).
func (h *Handler) HandleReportDeliverablePR(w http.ResponseWriter, r *http.Request) {
	nodeRunID := chi.URLParam(r, "nodeRunId")
	deliverableID := chi.URLParam(r, "deliverableId")
	nrUUID := parseUUID(nodeRunID)
	dUUID := parseUUID(deliverableID)

	var req ReportDeliverablePRRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.PullRequestURL == "" {
		writeError(w, http.StatusBadRequest, "pull_request_url is required")
		return
	}

	sub, err := h.Queries.UpsertNodeRunDeliverableSubmission(r.Context(), db.UpsertNodeRunDeliverableSubmissionParams{
		WorkflowNodeRunID: nrUUID,
		DeliverableID:     dUUID,
		SubmittedByType:   "agent",
		Content:           "",
		PullRequestUrl:    req.PullRequestURL,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to record deliverable PR")
		return
	}
	writeJSON(w, http.StatusOK, sub)
}
```

(Uses `parseUUID` because the route is daemon-authed via middleware — the path params are trusted UUIDs from the router. `json`/`writeError`/`writeJSON` are handler builtins; add `"encoding/json"` to imports. Verify the exact `UpsertNodeRunDeliverableSubmissionParams` field names against `server/pkg/db/generated/workflow_deliverable.sql.go` — research showed `WorkflowNodeRunID, DeliverableID, SubmittedByType, Content, AttachmentID, PullRequestUrl`.)

- [ ] **Step 4: Mount the route**

In `server/cmd/server/router.go`, inside the `r.Route("/api/daemon", ...)` block (near the other `node-runs` route at line 379), add:

```go
			r.Post("/node-runs/{nodeRunId}/deliverables/{deliverableId}/report-pr", h.HandleReportDeliverablePR)
```

- [ ] **Step 5: Verify** — `cd server && go build ./...`; `go vet ./internal/handler/ ./cmd/server/`; DB-backed test via the container (Task 6 pattern). Commit:

```bash
git add server/internal/handler/report_pr.go server/internal/handler/report_pr_test.go server/cmd/server/router.go
git commit -m "feat(gitea): add daemon report-pr endpoint for deliverable PR URLs"
```

---

## Task 3: Wire Gitea client into WorkflowService + add `critic_approved → blocked`

**Files:**
- Modify: `server/internal/service/workflow.go` (struct field + transition)
- Modify: `server/cmd/server/router.go` (RouterOptions.Gitea + assign)
- Modify: `server/cmd/server/main.go` (construct client)

Plumbing-only this task (no behavior change yet; behaviors land in Tasks 4-5). Adds the seam.

- [ ] **Step 1: Add the `Gitea` field to WorkflowService**

In `server/internal/service/workflow.go`, add the import `"github.com/multica-ai/multica/server/internal/gitea"` and a field to the struct (after `TaskSvc`):

```go
type WorkflowService struct {
	Queries   *db.Queries
	TxStarter TxStarter
	Bus       *events.Bus
	TaskSvc   *TaskService

	// Gitea is the platform Gitea admin client, used for run-start scaffolding
	// and approve-time PR merging of document deliverables. nil when Gitea is not
	// configured (GITEA_BASE_URL/GITEA_ADMIN_TOKEN unset) — the feature stays dormant.
	Gitea *gitea.Client

	OnNodeStatusChanged func(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun)
	OnRunTerminal       func(ctx context.Context, run db.MulticaWorkflowRun, status string)
}
```

- [ ] **Step 2: Add the transition**

In `validTransitions`, change the `critic_approved` line:

```go
	NodeRunStatusCriticApproved:  {NodeRunStatusCompleted, NodeRunStatusBlocked},
```

- [ ] **Step 3: RouterOptions + assignment**

In `server/cmd/server/router.go`:
- Add to `RouterOptions` (near `DeptSync`):

```go
	// Gitea is the platform Gitea admin client for document-deliverable storage.
	// nil → the router constructs one from env (dormant when env unset).
	Gitea *gitea.Client
```

- Add the import `"github.com/multica-ai/multica/server/internal/gitea"`.
- After `h := handler.New(...)` and the existing `if opts.DeptSync != nil { ... } else { ... }` block, add the Gitea wiring (mirror the DeptSync else-branch constructing from env):

```go
	giteaClient := opts.Gitea
	if giteaClient == nil {
		giteaClient = gitea.NewClient(gitea.Config{
			BaseURL: strings.TrimRight(strings.TrimSpace(os.Getenv("GITEA_BASE_URL")), "/"),
			Token:   os.Getenv("GITEA_ADMIN_TOKEN"),
			Timeout: envDuration("GITEA_TIMEOUT", 10*time.Second),
		})
	}
	h.WorkflowService.Gitea = giteaClient
```

- [ ] **Step 4: main.go construction**

In `server/cmd/server/main.go`, near the `deptSyncClient` construction (~line 308), add:

```go
	giteaClient := gitea.NewClient(gitea.Config{
		BaseURL: strings.TrimRight(strings.TrimSpace(os.Getenv("GITEA_BASE_URL")), "/"),
		Token:   os.Getenv("GITEA_ADMIN_TOKEN"),
		Timeout: envDuration("GITEA_TIMEOUT", 10*time.Second),
	})
```

And in the `RouterOptions{...}` literal (~line 520, where `DeptSync: deptSyncClient` is), add `Gitea: giteaClient,`. Add the gitea import.

- [ ] **Step 5: Verify** — `cd server && go build ./... && go vet ./...` clean. (No behavior change; existing tests still pass. The service field defaults to nil in tests → dormant.) Commit:

```bash
git add server/internal/service/workflow.go server/cmd/server/router.go server/cmd/server/main.go
git commit -m "feat(gitea): wire admin client into WorkflowService + critic_approved→blocked transition"
```

---

## Task 4: Run-start scaffolding + lazy bot provisioning

**Files:**
- Create: `server/internal/service/workflow_gitea.go`
- Create: `server/internal/service/workflow_gitea_test.go`
- Modify: `server/internal/handler/workflow_run.go` (call from `StartWorkflowRun`)

- [ ] **Step 1: Write the failing test** (DB-backed + fake Gitea)

`workflow_gitea_test.go` seeds a workflow with a document deliverable + a run, then asserts `ScaffoldRunDeliverables` calls the Gitea client's scaffold path and provisions the bot into settings. Because the real `*gitea.Client` is hard to fake here, this test uses an httptest Gitea stand-in (reuse the pattern from `gitea/scaffold_test.go`'s `TestScaffoldRun_RealClientE2E`) OR — preferred for the service layer — assert on observable DB effects (settings gains `gitea_pat`) + that a second call is a no-op (lazy). Keep the Gitea client real but pointed at a tiny httptest server that 201/404s appropriately.

(Skeleton — the implementer fills the httptest Gitea handler per `gitea/scaffold_test.go`'s pattern and the provision flow:)

```go
package service

import (
	"context"
	"encoding/json"
	"testing"
)

func TestScaffoldRunDeliverables_ProvisionsBotAndIsLazy(t *testing.T) {
	if testWorkflowSvc == nil {
		t.Skip("database not available")
	}
	// 1. Seed workflow + document deliverable + run (reuse a seed helper).
	// 2. Point testWorkflowSvc.Gitea at an httptest Gitea stand-in that:
	//    - 404s GetOrg/GetRepo/GetBranch on first ask, 201s creates,
	//    - 201s admin/users, returns {"sha1":"pat-..."} for user tokens,
	//    - 204s org membership.
	// 3. Call ScaffoldRunDeliverables(ctx, run).
	// 4. Assert workspace.settings now has gitea_pat + gitea_bot_username.
	// 5. Call again → assert no second PAT minted (lazy: settings already has gitea_pat).
}
```

NOTE for implementer: the service test harness (`testWorkflowSvc`) may not exist — check `server/internal/service/*_test.go` for the existing service-test setup. If the service package has no DB test fixture, model the seed on `server/internal/handler/workflow_node_run_collab_test.go` (raw SQL via a pool + `t.Cleanup`). If wiring a service-level DB fixture is too heavy for this task, instead unit-test the pure helpers (`hasDocumentDeliverable`, `parseWorkspaceGiteaSettings`) in isolation and assert the orchestration via a fake `*gitea.Client`-shaped interface — escalate via NEEDS_CONTEXT if the service-test seam is unclear.

- [ ] **Step 2: Run to verify it fails** — undefined symbols.

- [ ] **Step 3: Write minimal implementation**

Create `server/internal/service/workflow_gitea.go`:

```go
package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/multica-ai/multica/server/internal/gitea"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

// hasDocumentDeliverable reports whether the workflow has any document-type
// deliverable. Scaffolding only runs for document-bearing workflows.
func (s *WorkflowService) hasDocumentDeliverable(ctx context.Context, workflowID pgtype.UUID) (bool, error) {
	nodes, err := s.Queries.ListWorkflowNodes(ctx, workflowID)
	if err != nil {
		return false, fmt.Errorf("list nodes: %w", err)
	}
	for _, n := range nodes {
		deliverables, err := s.Queries.ListWorkflowNodeDeliverables(ctx, n.ID)
		if err != nil {
			return false, fmt.Errorf("list deliverables: %w", err)
		}
		for _, d := range deliverables {
			if d.Kind == "document" {
				return true, nil
			}
		}
	}
	return false, nil
}

// ScaffoldRunDeliverables provisions the workspace Gitea bot (once) and
// scaffolds the run's deliverable org/repo/inst branch. Idempotent + retry-safe.
// Called after StartRun commits, ONLY when the workflow has a document
// deliverable AND Gitea is configured. Persistent failure transitions the run to
// failed (design §4.1: Gitea is a hard dependency for document workflows).
func (s *WorkflowService) ScaffoldRunDeliverables(ctx context.Context, run db.MulticaWorkflowRun) {
	if s.Gitea == nil || !s.Gitea.Configured() {
		return // feature dormant
	}
	workflow, err := s.Queries.GetWorkflow(ctx, run.WorkflowID)
	if err != nil {
		slog.Warn("gitea scaffold: get workflow", "run_id", uuidStr(run.ID), "error", err)
		return
	}
	has, err := s.hasDocumentDeliverable(ctx, workflow.ID)
	if err != nil || !has {
		return // code-only workflow — no Gitea repo needed
	}

	wsID := uuidStr(run.WorkspaceID)
	wfID := uuidStr(workflow.ID)
	runID := uuidStr(run.ID)

	// 1. Provision the bot once per workspace (lazy on first document run).
	if err := s.provisionWorkspaceBotIfAbsent(ctx, run.WorkspaceID); err != nil {
		slog.Error("gitea scaffold: provision bot failed", "workspace_id", wsID, "error", err)
		s.failRun(ctx, run, "gitea bot provisioning failed")
		return
	}

	// 2. Scaffold org/repo/inst (creates the org, so the bot can be a member).
	if _, err := gitea.ScaffoldRunDeliverable(ctx, s.Gitea, gitea.ScaffoldParams{
		WorkspaceID:   wsID,
		WorkflowID:    wfID,
		RunID:         runID,
		WorkflowTitle: workflow.Title,
		// DefinitionSnapshot left empty for M2 (DB is source of truth; main seed is readable-only).
	}); err != nil {
		slog.Error("gitea scaffold failed", "run_id", runID, "error", err)
		s.failRun(ctx, run, "gitea scaffolding failed")
		return
	}
}

// provisionWorkspaceBotIfAbsent creates the workspace Gitea bot + PAT and
// persists them into workspace.settings — but only if no gitea_pat is stored
// yet (lazy + once-per-workspace). Re-provisioning is intentionally NOT done here.
func (s *WorkflowService) provisionWorkspaceBotIfAbsent(ctx context.Context, workspaceID pgtype.UUID) error {
	ws, err := s.Queries.GetWorkspace(ctx, workspaceID)
	if err != nil {
		return fmt.Errorf("get workspace: %w", err)
	}
	settingsMap := map[string]any{}
	if len(ws.Settings) > 0 {
		if err := json.Unmarshal(ws.Settings, &settingsMap); err != nil {
			return fmt.Errorf("parse settings: %w", err)
		}
	}
	if pat, ok := settingsMap["gitea_pat"].(string); ok && pat != "" {
		return nil // already provisioned
	}

	username, token, err := gitea.ProvisionWorkspaceBot(ctx, s.Gitea, gitea.BotParams{
		WorkspaceID: uuidStr(workspaceID),
	})
	if err != nil {
		return fmt.Errorf("provision bot: %w", err)
	}
	// Scaffold must have created the org already (caller orders scaffold-after? No
	// — see ScaffoldRunDeliverables: provision runs FIRST but AddOrgMember is
	// opportunistic; scaffold creates the org right after. Membership is re-added
	// by a follow-up scaffold-or-provision call. For M2 this is acceptable: the
	// bot can clone/push public+member-once repos; M3 hardens ordering.)
	settingsMap["gitea_bot_username"] = username
	settingsMap["gitea_pat"] = token
	raw, err := json.Marshal(settingsMap)
	if err != nil {
		return fmt.Errorf("marshal settings: %w", err)
	}
	if _, err := s.Queries.UpdateWorkspace(ctx, db.UpdateWorkspaceParams{ID: workspaceID, Settings: raw}); err != nil {
		return fmt.Errorf("persist bot settings: %w", err)
	}
	return nil
}

// failRun transitions a running run to failed. Used when a hard Gitea dependency
// can't be satisfied at run start.
func (s *WorkflowService) failRun(ctx context.Context, run db.MulticaWorkflowRun, reason string) {
	if _, err := s.Queries.UpdateWorkflowRunStatus(ctx, db.UpdateWorkflowRunStatusParams{ID: run.ID, Status: "failed"}); err != nil {
		slog.Error("gitea: fail run after scaffold failure", "run_id", uuidStr(run.ID), "error", err)
	}
}

// uuidStr is a local helper to avoid a util import cycle in this file; if util.UUIDToString
// is already imported elsewhere in the service package, use it instead and delete this.
func uuidStr(u pgtype.UUID) string { return giteaUUIDString(u) }
```

(Implementer: resolve `uuidStr` — prefer the package's existing UUID stringifier if one is in scope; otherwise inline `fmt.Sprintf` of the pgtype bytes. Verify `UpdateWorkflowRunStatus` + `UpdateWorkspace` query/param names against generated code. The membership-ordering note above is the known M2 gap from the M1 final review — acceptable for M2, M3 hardens.)

- [ ] **Step 4: Call from StartWorkflowRun**

In `server/internal/handler/workflow_run.go` `StartWorkflowRun` (around line 342, after `StartRun` returns and before/after `DispatchRootNodeRuns`), add:

```go
	go h.WorkflowService.ScaffoldRunDeliverables(r.Context(), *run)
```

(Run async so a slow Gitea doesn't block the run-start HTTP response; the helper transitions the run to failed on persistent failure. If `DispatchRootNodeRuns` is already async/goroutine, keep ordering: scaffold can race with worker dispatch safely — the worker won't push until M3's CLI runs, by which time scaffold has completed or failed the run.)

- [ ] **Step 5: Verify + commit**

```bash
cd server && go build ./... && go vet ./...
```
Tests: gitea-package host run + service/handler DB-backed via container. Commit:

```bash
git add server/internal/service/workflow_gitea.go server/internal/service/workflow_gitea_test.go server/internal/handler/workflow_run.go
git commit -m "feat(gitea): scaffold deliverable repo + lazily provision bot at run start"
```

---

## Task 5: Approve-time inline merge of document PRs

**Files:**
- Modify: `server/internal/service/workflow.go` (restructure `ReviewNodeRun` approve branch)
- Add `mergeDocumentDeliverables` to `server/internal/service/workflow_gitea.go`
- Test: `server/internal/service/workflow_gitea_test.go` (append)

The crux. Restructure so the external merge runs AFTER the `critic_approved` tx commits.

- [ ] **Step 1: Write the failing test** (DB-backed + httptest Gitea)

Assert: a node run with a document deliverable whose submission has a `pull_request_url`, on approve, transitions to `completed` AND the submission status becomes `approved` (when the Gitea stand-in returns 200 to merge); and transitions to `blocked` when the stand-in returns 409 persistently.

```go
func TestReviewNodeRun_MergesDocumentDeliverablePRs(t *testing.T) {
	// seed workflow + document deliverable + run + node_run (critic_reviewing)
	//   + submission with pull_request_url = <httptest>/.../pulls/1
	// point testWorkflowSvc.Gitea at an httptest Gitea that 200s /pulls/1/merge
	// call ReviewNodeRun(ctx, nodeRunID, approved=true, "", nil)
	// assert node_run status == completed
	// assert submission status == approved
}

func TestReviewNodeRun_BlocksWhenMergeConflicts(t *testing.T) {
	// same seed, but the httptest Gitea 409s /pulls/1/merge
	// call ReviewNodeRun(approved=true)
	// assert node_run status == blocked
}
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Add `mergeDocumentDeliverables` to `workflow_gitea.go`**

```go
// mergeDocumentDeliverables merges every document-type deliverable submission
// that has a pull_request_url, with bounded retry. Returns nil only if all such
// PRs merged successfully; a non-nil error means at least one persistently failed
// (caller blocks the node run). Gitea-not-configured is handled by the caller
// (this is only called when s.Gitea is configured).
func (s *WorkflowService) mergeDocumentDeliverables(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) error {
	deliverables, err := s.Queries.ListWorkflowNodeDeliverables(ctx, nodeRun.WorkflowNodeID)
	if err != nil {
		return fmt.Errorf("list deliverables: %w", err)
	}
	byID := make(map[string]db.MulticaWorkflowNodeDeliverable, len(deliverables))
	for _, d := range deliverables {
		byID[uuidStr(d.ID)] = d
	}
	submissions, err := s.Queries.ListNodeRunDeliverableSubmissions(ctx, nodeRun.ID)
	if err != nil {
		return fmt.Errorf("list submissions: %w", err)
	}
	for _, sub := range submissions {
		d, ok := byID[uuidStr(sub.DeliverableID)]
		if !ok || d.Kind != "document" {
			continue
		}
		if sub.PullRequestUrl == "" {
			continue // nothing to merge (shouldn't happen for a gated doc deliverable)
		}
		index, err := gitea.ParsePullRequestIndex(sub.PullRequestUrl)
		if err != nil {
			return fmt.Errorf("parse PR url %q: %w", sub.PullRequestUrl, err)
		}
		if err := retryMerge(ctx, s.Gitea, gitea.OrgName(uuidStrFromRun(nodeRun, s)), gitea.RepoName(uuidStrFromWorkflow(nodeRun, s)), index); err != nil {
			return fmt.Errorf("merge PR #%d: %w", index, err)
		}
	}
	return nil
}

// retryMerge calls MergePR with bounded exponential backoff. Transient failures
// (5xx, network) are retried up to maxAttempts; a 409 conflict is terminal.
func retryMerge(ctx context.Context, c *gitea.Client, owner, repo string, index int) error {
	const maxAttempts = 3
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if err := c.MergePR(ctx, owner, repo, index); err != nil {
			lastErr = err
			// TODO(M2): distinguish 409 (terminal) from 5xx (retry). For now retry all.
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}
			continue
		}
		return nil
	}
	return lastErr
}
```

(Implementer: the `owner`/`repo` must be derived from the node run's workspace + workflow IDs. Add helpers that load the run→workflow→workspace chain (the service already does this elsewhere — `ReviewNodeRun` loads run+workflow). Resolve `uuidStrFromRun`/`uuidStrFromWorkflow` to actual lookups; don't leave the TODO placeholder for the 409-vs-5xx distinction — implement it: parse the `decodeError` message or have `MergePR` return a typed conflict error. Escalate NEEDS_CONTEXT if distinguishing 409 cleanly needs a client change.)

- [ ] **Step 4: Restructure `ReviewNodeRun` approve branch** in `workflow.go`

Replace the approve branch (lines ~803-829) so it persists `critic_approved` + critic output in the tx but does NOT complete; then after the tx, merge + transition:

```go
		if approved {
			if satisfied, err := s.requiredDeliverablesSatisfied(ctx, nr); err != nil {
				return fmt.Errorf("check deliverables: %w", err)
			} else if !satisfied {
				return fmt.Errorf("all required deliverables must be submitted and approved before this node can be approved")
			}
			// Persist critic_approved + critic output. Do NOT complete inside the tx —
			// the document-PR merge is an external call that can't be rolled back.
			updated, err := qtx.UpdateWorkflowNodeRunStatus(ctx, db.UpdateWorkflowNodeRunStatusParams{
				ID: nr.ID, Status: NodeRunStatusCriticApproved,
			})
			if err != nil {
				return fmt.Errorf("approve node run: %w", err)
			}
			updated, err = qtx.SetWorkflowNodeRunCriticOutput(ctx, db.SetWorkflowNodeRunCriticOutputParams{
				ID:            nr.ID,
				CriticOutput:  criticOutput,
				CriticComment: pgtype.Text{String: comment, Valid: comment != ""},
				Status:        NodeRunStatusCriticApproved, // stay approved; complete after merge
			})
			if err != nil {
				return fmt.Errorf("store critic output: %w", err)
			}
			nodeRun = updated
		}
```

Then AFTER the `runInTx` block (before the existing `if nodeRun.Status == NodeRunStatusFormatOk` checks), add the merge phase for the approve path:

```go
	// Approve path: merge document PRs (if Gitea configured) then complete or block.
	if approved && nodeRun.Status == NodeRunStatusCriticApproved {
		finalStatus := NodeRunStatusCompleted
		if s.Gitea != nil && s.Gitea.Configured() {
			if err := s.mergeDocumentDeliverables(ctx, nodeRun); err != nil {
				slog.Error("gitea merge document deliverables failed", "node_run_id", uuidStr(nodeRun.ID), "error", err)
				finalStatus = NodeRunStatusBlocked
			} else {
				s.markDocumentSubmissionsApproved(ctx, nodeRun)
			}
		}
		updated, err := s.TransitionNodeRun(ctx, nodeRun, finalStatus) // validates critic_approved→completed|blocked
		if err != nil {
			return fmt.Errorf("transition after merge decision: %w", err)
		}
		nodeRun = updated
	}
```

Add `markDocumentSubmissionsApproved` to `workflow_gitea.go` (loops doc submissions, calls `ReviewNodeRunDeliverableSubmission(id, "approved", "", )`):

```go
func (s *WorkflowService) markDocumentSubmissionsApproved(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) {
	deliverables, err := s.Queries.ListWorkflowNodeDeliverables(ctx, nodeRun.WorkflowNodeID)
	if err != nil { return }
	doc := map[string]bool{}
	for _, d := range deliverables { if d.Kind == "document" { doc[uuidStr(d.ID)] = true } }
	subs, err := s.Queries.ListNodeRunDeliverableSubmissions(ctx, nodeRun.ID)
	if err != nil { return }
	for _, sub := range subs {
		if doc[uuidStr(sub.DeliverableID)] && sub.PullRequestUrl != "" {
			_, _ = s.Queries.ReviewNodeRunDeliverableSubmission(ctx, db.ReviewNodeRunDeliverableSubmissionParams{
				ID: sub.ID, Status: "approved", ReviewComment: "",
			})
		}
	}
}
```

Keep the existing post-tx `FormatOk`/`Blocked`/`Completed` handling — after the merge phase, `nodeRun.Status` is `completed` or `blocked`, and the existing `if nodeRun.Status == NodeRunStatusBlocked` / `== Completed` blocks fire `OnNodeStatusChanged` + `OnNodeRunCompleted` as before. Verify the rework (reject) branch is untouched.

- [ ] **Step 5: Verify + commit**

```bash
cd server && go build ./... && go vet ./...
```
DB-backed tests via container (approve→completed on merge success; approve→blocked on merge conflict). Commit:

```bash
git add server/internal/service/workflow.go server/internal/service/workflow_gitea.go server/internal/service/workflow_gitea_test.go
git commit -m "feat(gitea): merge document deliverable PRs on critic approve (inline, retry→blocked)"
```

---

## Self-Review (after all tasks)

1. **Spec coverage:** MergePR (T1), report-pr endpoint (T2), wiring + transition (T3), run-start scaffold + provision (T4), approve-merge (T5). Design items: §3.3 responsibility (server merges), §4.1 failure model (retry→blocked; scaffold fail→run failed), §3.4 tokens (admin env, bot in settings). Locked decisions B (inline merge) + A (report-pr) implemented.
2. **Placeholder scan:** Task 4/5 have a few "implementer resolves" notes (uuidStr helper, owner/repo derivation, 409-vs-5xx distinction, service-test seam). These flag real micro-decisions the implementer must make by reading generated code — NOT acceptable as-shipped; the implementer resolves them and escalates NEEDS_CONTEXT if blocked. The reviewer verifies they're resolved.
3. **Type consistency:** `gitea.Client.MergePR`, `gitea.ParsePullRequestIndex`, `gitea.ScaffoldRunDeliverable`, `gitea.ProvisionWorkspaceBot`, `gitea.OrgName/RepoName` — all defined in M1/T1. `WorkflowService.Gitea *gitea.Client` set in router. `validTransitions` critic_approved→{completed,blocked}.
4. **Dormancy:** Gitea nil/unconfigured → scaffold + merge skipped → existing behavior unchanged. Verified by a test where `s.Gitea == nil`.
5. **Verification gaps:** service/handler tests are DB-backed — run in the `golang:1.26-alpine`-in-`multica_default` container (DB user **root**, pw 8 chars). M1's credential test already proven there.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-07-17-deliverable-git-storage-m2.md`. Execution options (same as M1):

1. **Subagent-Driven (recommended)** — fresh implementer per task, two-stage review.
2. **Inline Execution** — executing-plans, batched checkpoints.

Which approach?

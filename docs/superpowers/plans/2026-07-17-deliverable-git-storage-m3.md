# Deliverable Git-Storage — Milestone 3 (Runtime + UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the deliverable git-storage feature: carry Gitea deliverable context from server → daemon → CLI, add a `cs-workflow gitea submit` command that pushes a document deliverable and opens a Gitea PR, disable inline content upload for document deliverables (closing I1 at the source), and render the PR link in the node-run review UI.

**Architecture:** The server's `ClaimTaskByRuntime` attaches a new `GiteaDeliverableContext` (owner/repo/inst-branch/node-branch + per-deliverable id/title/path) to the claim response when Gitea is configured and the node has document deliverables. The daemon already deserializes the claim response into its `Task` struct (same JSON field names — `UpstreamStageContext` flows this exact way), so adding the field to `daemon.Task` auto-populates it; the daemon then (1) exports `MULTICA_NODE_RUN_ID` + `MULTICA_GITEA_*` env vars for the agent, and (2) adds a "Document Deliverables" section to `BuildPrompt` instructing the agent to run the new CLI command. The CLI command (`cs-workflow gitea submit --deliverable <id> --file <path>`) fetches the workspace PAT, shallow-clones the inst branch, creates the node branch, writes the file, commits, pushes, opens a Gitea PR (node→inst), and POSTs `report-pr`. The user-facing `SubmitNodeRunDeliverable` handler rejects `content`/`attachment_id` for `kind=document` when Gitea is configured (dormant otherwise). The frontend `NodeRunCard` (the critic's review surface) consumes the currently-dead `nodeRunDeliverableSubmissionsOptions` and renders each document submission's `pull_request_url`.

**Tech Stack:** Go 1.26 (Chi, sqlc, pgx/v5, cobra, net/http, os/exec git), React + TanStack Query (shared in `packages/`). Tests: Go (DB-backed via the `golang:1.26-alpine`-in-`multica_default` container, DB user **root**; httptest for HTTP seams); Vitest + jsdom for the shared view.

---

## Locked decisions (from design + codebase patterns)

- **Transport = claim response → daemon Task (JSON mirror) → env → CLI.** The daemon `Task` (`server/internal/daemon/types.go`) is JSON-deserialized from the server's `AgentTaskResponse`; same-named fields auto-populate. `UpstreamStageContext` already flows server→daemon→prompt this way — Gitea context mirrors it exactly. The credential endpoint (`GET /api/gitea/credential`) stays per-workspace (base_url + PAT only); owner/repo/inst/node-branch travel via the claim response so the CLI does NOT re-derive topology.
- **CLI git ops = shelled-out `exec.Command("git")`.** `cmd_mr.go` already shells out to git; `go-git` is not used anywhere in the repo (no new dependency). Git operations are structured behind a `gitOps` interface so the orchestration is unit-testable with a fake + httptest.
- **CLI write mechanism = git push (clone+branch+commit+push), NOT the Gitea contents API.** Matches design §3.3 ("push…daemon") and the existing GitLab `mr create` precedent. (The contents API was considered and deferred — it would avoid a local clone but deviates from the locked design's "push" wording and from `cmd_mr.go`'s established pattern.)
- **Document in-repo path = `nodes/<nodeRunShort8>/<deliverableShort8>.md`.** Aligns with costrict-web `WORKFLOW_REPO_PATH_ALGORITHM.md` §7 (`nodes/` holds node deliverables); multica derives segments from UUIDs via the existing `shortHex`. Server computes + sends the path in the context; the CLI never re-derives.
- **I1 closure = disable document content upload at the source.** After Task 1, the ONLY path to a document submission is `report-pr` (which always sets `pull_request_url`), so `mergeDocumentDeliverables`' `sub.PullRequestUrl == ""` skip can never fire for a document deliverable; a required document with no submission is already blocked by the existing `requiredDeliverablesSatisfied` gate. A merge-phase guard is therefore **intentionally NOT added** — it would be dead code (violates the no-dead-code rule).
- **Upload-disable is dormant-aware.** `SubmitNodeRunDeliverable` rejects document `content`/`attachment_id` ONLY when `isGiteaConfigured()` is true; when Gitea is off, document uploads behave as before (legacy). The daemon→CLI chain is naturally dormant (server omits the context → daemon omits env+prompt → CLI errors cleanly if invoked).
- **CLI command shape = one PR per invocation.** `cs-workflow gitea submit --deliverable <id> --file <path>`; the agent invokes once per document deliverable (mirrors `mr create`'s one-MR-per-call shape). The deliverable list from `MULTICA_GITEA_DELIVERABLES` is read only to resolve the in-repo `path` for the given `--deliverable`.
- **Node branch force-push is acceptable.** A node branch has exactly one writer (the agent for that node-run) pre-merge; re-submission replaces WIP and the PR auto-updates. Plain `git push --force` from a fresh shallow clone handles both first-push and re-submit.

## File Structure (Milestone 3)

**Create:**
- `server/cmd/cs-workflow/cmd_gitea.go` — `giteaCmd` + `giteaSubmitCmd`; credential fetch, gitOps interface + exec impl, Gitea PR create, report-pr; `runGiteaSubmit` orchestration.
- `server/cmd/cs-workflow/cmd_gitea_test.go` — fake `gitOps` + httptest Gitea + httptest Multica; asserts PR opened + report-pr received the PR URL.
- `packages/views/workflows/components/node-run-deliverables.tsx` — submissions block rendering document PR links (consumed by `NodeRunCard`).
- `packages/views/workflows/components/node-run-deliverables.test.tsx` — jsdom render test.

**Modify:**
- `server/internal/gitea/topology.go` — add exported `DeliverablePath`.
- `server/internal/gitea/topology_test.go` — `DeliverablePath` test.
- `server/internal/handler/agent.go` — add `GiteaDeliverableContext` + `GiteaDeliverableRef` types; `GiteaDeliverables` field on `AgentTaskResponse`.
- `server/internal/handler/daemon.go` — `buildGiteaDeliverableContext` helper + call it in `ClaimTaskByRuntime`.
- `server/internal/handler/workflow_run.go` — reject document `content`/`attachment_id` in `SubmitNodeRunDeliverable` (dormant-aware) + `deliverableKind` helper.
- `server/internal/handler/workflow_run_test.go` (or new) — document-upload-reject test.
- `server/internal/daemon/types.go` — mirror `GiteaDeliverableContext`/`GiteaDeliverableRef` + `Task.GiteaDeliverables` field.
- `server/internal/daemon/daemon.go` — export `MULTICA_NODE_RUN_ID` + `MULTICA_GITEA_*` in the agent env block.
- `server/internal/daemon/daemon_test.go` (or new) — env-block test.
- `server/internal/daemon/prompt.go` — "Document Deliverables" section in `BuildPrompt`.
- `server/internal/daemon/prompt_test.go` — prompt-section test.
- `server/cmd/cs-workflow/main.go` — `rootCmd.AddCommand(giteaCmd)`.
- `packages/views/workflows/components/node-run-card.tsx` — render `<NodeRunDeliverables wsId={wsId} nodeRunId={nodeRun.id} />`.

---

## Task 1: Disable inline document content upload (dormant-aware) — closes I1

**Files:**
- Modify: `server/internal/handler/workflow_run.go` (`SubmitNodeRunDeliverable` ~line 974 + new `deliverableKind` helper)
- Test: `server/internal/handler/workflow_run_deliverable_test.go` (create)

`SubmitNodeRunDeliverable` currently accepts `content`/`attachment_id` for any kind. After M3, document deliverables go through git (report-pr). Reject inline content/attachment for document kind — but only when Gitea is configured (dormant deployments keep legacy behavior).

- [ ] **Step 1: Write the failing test**

Create `server/internal/handler/workflow_run_deliverable_test.go`:

```go
package handler

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

// seedDocumentDeliverableNodeRun seeds a workflow→node(document deliverable)→run→node_run
// and returns (nodeRunID, documentDeliverableID, pullRequestDeliverableID).
func seedDocumentDeliverableNodeRun(t *testing.T) (string, string) {
	t.Helper()
	ctx := context.Background()
	wfID := uuid.NewString()
	mustExec(t, ctx, `INSERT INTO multica_workflow (id, workspace_id, title, status, created_by_type, created_by_id)
		VALUES ($1, $2, 'WF', 'active', 'member', $3)`, wfID, testWorkspaceID, testUserID)
	t.Cleanup(func() { testPool.Exec(ctx, `DELETE FROM multica_workflow WHERE id = $1`, wfID) })

	nodeID := uuid.NewString()
	mustExec(t, ctx, `INSERT INTO multica_workflow_node (id, workflow_id, title, worker_type, critic_type)
		VALUES ($1, $2, 'N', 'agent', 'agent')`, nodeID, wfID)

	docID := uuid.NewString()
	mustExec(t, ctx, `INSERT INTO multica_workflow_node_deliverable (id, workflow_node_id, kind, title, required)
		VALUES ($1, $2, 'document', 'Doc', true)`, docID, nodeID)

	runID := uuid.NewString()
	mustExec(t, ctx, `INSERT INTO multica_workflow_run (id, workflow_id, workspace_id, title, status, triggered_by_type, triggered_by_id)
		VALUES ($1, $2, $3, 'R', 'running', 'member', $4)`, runID, wfID, testWorkspaceID, testUserID)

	nrID := uuid.NewString()
	mustExec(t, ctx, `INSERT INTO multica_workflow_node_run (id, workflow_run_id, workflow_node_id, node_title, status, retry_count, worker_type, critic_type)
		VALUES ($1, $2, $3, 'N', 'working', 0, 'agent', 'agent')`, nrID, runID, nodeID)
	return nrID, docID
}

// TestSubmitNodeRunDeliverable_RejectsDocumentContentUpload asserts that a
// content upload for a document deliverable is rejected with 422 — but ONLY
// when Gitea is configured. (When dormant, legacy content upload still works.)
// Requires GITEA_BASE_URL + GITEA_ADMIN_TOKEN set in the test env to exercise
// the configured path; unset them in a sibling test for the dormant path.
func TestSubmitNodeRunDeliverable_RejectsDocumentContentUpload(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	t.Setenv("GITEA_BASE_URL", "https://gitea.test")
	t.Setenv("GITEA_ADMIN_TOKEN", "admin-tok")

	nodeRunID, docID := seedDocumentDeliverableNodeRun(t)
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id = $1`, nodeRunID)
	})

	req := newAuthRequest(http.MethodPost, "/api/node-runs/"+nodeRunID+"/deliverables/"+docID+"/submit",
		map[string]any{"content": "# my document"})
	req = withURLParam(req, "nodeRunId", nodeRunID)
	req = withURLParam(req, "deliverableId", docID)
	req.Header.Set("X-Workspace-ID", testWorkspaceID)
	rec := newRequestRecorder()
	testHandler.SubmitNodeRunDeliverable(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (document content rejected when Gitea configured). body=%s", rec.Code, rec.Body.String())
	}
}

// TestSubmitNodeRunDeliverable_AllowsDocumentPullRequestURL asserts that a
// document submission carrying only pull_request_url (the pointer) is still
// accepted even when Gitea is configured — only content/attachment are blocked.
func TestSubmitNodeRunDeliverable_AllowsDocumentPullRequestURL(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	t.Setenv("GITEA_BASE_URL", "https://gitea.test")
	t.Setenv("GITEA_ADMIN_TOKEN", "admin-tok")

	nodeRunID, docID := seedDocumentDeliverableNodeRun(t)
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id = $1`, nodeRunID)
	})

	req := newAuthRequest(http.MethodPost, "/api/node-runs/"+nodeRunID+"/deliverables/"+docID+"/submit",
		map[string]any{"pull_request_url": "https://gitea.test/t-aaa/wf-bbb/pulls/1"})
	req = withURLParam(req, "nodeRunId", nodeRunID)
	req = withURLParam(req, "deliverableId", docID)
	req.Header.Set("X-Workspace-ID", testWorkspaceID)
	rec := newRequestRecorder()
	testHandler.SubmitNodeRunDeliverable(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (pull_request_url pointer is allowed). body=%s", rec.Code, rec.Body.String())
	}
}
```

> **Implementer note (verify, don't guess):** the test helpers `newAuthRequest`, `withURLParam`, `newRequestRecorder`, `mustExec`, `testHandler`, `testPool`, `testWorkspaceID`, `testUserID` are the handler package's existing DB-test fixtures — confirm their exact names in `server/internal/handler/*_test.go` (e.g. the report-pr test at `report_pr_test.go` uses `newDaemonTokenRequest`; find the user-authed equivalent for this route). Adapt names to match; the assertions are what matter. If no user-authed request helper exists, model it on `newDaemonTokenRequest` minus the daemon-token header (this route is `CasdoorAuth`-protected).

- [ ] **Step 2: Run to verify it fails**

Run (in the `golang:1.26-alpine` container joined to `multica_default`, DB user **root**):
```bash
cd server && go test ./internal/handler/ -run TestSubmitNodeRunDeliverable -v
```
Expected: FAIL — `status = 200, want 422` (content currently accepted).

- [ ] **Step 3: Write minimal implementation**

In `server/internal/handler/workflow_run.go`, add a `deliverableKind` helper near the other deliverable helpers (after `workflowNodeDeliverableSubmissionToResponse`):

```go
// deliverableKind resolves the kind of the deliverable submitted against the
// given node run. Used to gate document deliverables out of the inline-content
// upload path (document bodies live in Gitea when configured).
func (h *Handler) deliverableKind(ctx context.Context, nodeRunID, deliverableID pgtype.UUID) (string, error) {
	nr, err := h.Queries.GetWorkflowNodeRun(ctx, nodeRunID)
	if err != nil {
		return "", fmt.Errorf("get node run: %w", err)
	}
	deliverables, err := h.Queries.ListWorkflowNodeDeliverables(ctx, nr.WorkflowNodeID)
	if err != nil {
		return "", fmt.Errorf("list deliverables: %w", err)
	}
	for _, d := range deliverables {
		if d.ID == deliverableID {
			return d.Kind, nil
		}
	}
	return "", fmt.Errorf("deliverable %s not found on node run %s", deliverableID, nodeRunID)
}
```

Then modify `SubmitNodeRunDeliverable` — insert this block immediately AFTER the request body is decoded into `req` (after `req.AttachmentID` is in scope) and BEFORE the upsert query call:

```go
	// Document deliverables are submitted via Gitea PRs (the agent's report-pr
	// flow), not inline content uploads — but only when the platform Gitea is
	// configured. When dormant, document content uploads behave as before.
	if isGiteaConfigured() && (req.Content != "" || req.AttachmentID != nil) {
		kind, err := h.deliverableKind(r.Context(), nrUUID, dUUID)
		if err != nil {
			writeError(w, http.StatusNotFound, "deliverable not found")
			return
		}
		if kind == "document" {
			writeError(w, http.StatusUnprocessableEntity,
				"document deliverables are submitted via git PR; inline content upload is disabled")
			return
		}
	}
```

> Ensure `pgtype`, `fmt`, and the `isGiteaConfigured` symbol are imported/in-scope. `nrUUID`/`dUUID` are the parsed path-param UUIDs already computed at the top of the handler (rename to match the handler's actual locals — see how `report_pr.go` parses `nodeRunID`/`deliverableID`). `isGiteaConfigured()` is defined in `gitea.go:22` (same package).

- [ ] **Step 4: Run to verify it passes**

```bash
cd server && go test ./internal/handler/ -run TestSubmitNodeRunDeliverable -v
```
Expected: PASS (both subtests).

- [ ] **Step 5: Commit**

```bash
git add server/internal/handler/workflow_run.go server/internal/handler/workflow_run_deliverable_test.go
git commit -m "feat(gitea): reject inline content upload for document deliverables (dormant-aware)"
```

---

## Task 2: `GiteaDeliverableContext` on the claim response

**Files:**
- Modify: `server/internal/gitea/topology.go` (+ `topology_test.go`)
- Modify: `server/internal/handler/agent.go` (new types + field)
- Modify: `server/internal/handler/daemon.go` (`buildGiteaDeliverableContext` + call in `ClaimTaskByRuntime`)
- Test: `server/internal/handler/daemon_test.go` (append) or new `gitea_context_test.go`

- [ ] **Step 1: Add `DeliverablePath` to the gitea package**

Append to `server/internal/gitea/topology.go`:

```go
// DeliverablePath is the in-repo path where a document deliverable body lives:
// nodes/<nodeRunShort>/<deliverableShort>.md. Aligns with costrict-web's
// `nodes/` convention (WORKFLOW_REPO_PATH_ALGORITHM.md §7); multica derives the
// segments from UUIDs (not costrict's seq-slug). The server computes this and
// sends it in the claim response; the CLI consumes it verbatim (no re-derivation).
func DeliverablePath(nodeRunID, deliverableID string) string {
	return "nodes/" + shortHex(nodeRunID) + "/" + shortHex(deliverableID) + ".md"
}
```

Append to `server/internal/gitea/topology_test.go`:

```go
func TestDeliverablePath(t *testing.T) {
	nodeRun := "11111111-2222-3333-4444-555555555555"
	deliv := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	got := DeliverablePath(nodeRun, deliv)
	want := "nodes/11111111/aaaaaaaa.md"
	if got != want {
		t.Errorf("DeliverablePath = %q, want %q", got, want)
	}
}
```

- [ ] **Step 2: Add the claim-response types**

In `server/internal/handler/agent.go`, add (near `UpstreamStageNode`, ~line 219):

```go
// GiteaDeliverableContext carries everything the daemon + CLI need to push a
// document deliverable into the platform Gitea and open a PR, without
// re-deriving topology. Attached to a workflow-node claim response ONLY when
// Gitea is configured and the node has ≥1 document deliverable. nil/absent
// otherwise — the feature is dormant.
type GiteaDeliverableContext struct {
	Owner        string                 `json:"owner"`         // t-<ws[:8]>
	Repo         string                 `json:"repo"`          // wf-<wf[:8]>
	InstBranch   string                 `json:"inst_branch"`   // inst-<run[:8]>
	NodeBranch   string                 `json:"node_branch"`   // node/<nodeRun[:8]>
	Deliverables []GiteaDeliverableRef `json:"deliverables"` // one entry per document deliverable on the node
}

// GiteaDeliverableRef identifies one document deliverable's slot in the repo.
type GiteaDeliverableRef struct {
	ID    string `json:"deliverable_id"`
	Title string `json:"title"`
	Path  string `json:"path"` // nodes/<nodeRun[:8]>/<deliverable[:8]>.md
}
```

Add the field to `AgentTaskResponse` (after `UpstreamStageContext`, ~line 183):

```go
	GiteaDeliverables *GiteaDeliverableContext `json:"gitea_deliverables,omitempty"` // M3: document deliverable git context (nil when dormant)
```

- [ ] **Step 3: Write the failing test for the builder**

Create `server/internal/handler/gitea_context_test.go`:

```go
package handler

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

// TestBuildGiteaDeliverableContext_Configured seeds a node run with a document
// deliverable and asserts the builder returns owner/repo/inst/node-branch +
// one deliverable ref whose Path matches gitea.DeliverablePath.
func TestBuildGiteaDeliverableContext_Configured(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	t.Setenv("GITEA_BASE_URL", "https://gitea.test")
	t.Setenv("GITEA_ADMIN_TOKEN", "admin-tok")

	ctx := context.Background()
	wfID := uuid.NewString()
	mustExec(t, ctx, `INSERT INTO multica_workflow (id, workspace_id, title, status, created_by_type, created_by_id)
		VALUES ($1, $2, 'WF', 'active', 'member', $3)`, wfID, testWorkspaceID, testUserID)
	t.Cleanup(func() { testPool.Exec(ctx, `DELETE FROM multica_workflow WHERE id = $1`, wfID) })

	nodeID := uuid.NewString()
	mustExec(t, ctx, `INSERT INTO multica_workflow_node (id, workflow_id, title, worker_type, critic_type)
		VALUES ($1, $2, 'N', 'agent', 'agent')`, nodeID, wfID)
	docID := uuid.NewString()
	mustExec(t, ctx, `INSERT INTO multica_workflow_node_deliverable (id, workflow_node_id, kind, title, required)
		VALUES ($1, $2, 'document', 'Doc', true)`, docID, nodeID)
	// a code deliverable that must NOT appear in the context
	codeID := uuid.NewString()
	mustExec(t, ctx, `INSERT INTO multica_workflow_node_deliverable (id, workflow_node_id, kind, title, required)
		VALUES ($1, $2, 'pull_request', 'Code', true)`, codeID, nodeID)

	runID := uuid.NewString()
	mustExec(t, ctx, `INSERT INTO multica_workflow_run (id, workflow_id, workspace_id, title, status, triggered_by_type, triggered_by_id)
		VALUES ($1, $2, $3, 'R', 'running', 'member', $4)`, runID, wfID, testWorkspaceID, testUserID)
	nrID := uuid.NewString()
	mustExec(t, ctx, `INSERT INTO multica_workflow_node_run (id, workflow_run_id, workflow_node_id, node_title, status, retry_count, worker_type, critic_type)
		VALUES ($1, $2, $3, 'N', 'working', 0, 'agent', 'agent')`, nrID, runID, nodeID)

	task := dbTaskWithNodeRun(t, nrID) // helper: builds a db.MulticaAgentTaskQueue with WorkflowNodeRunID=nrID
	got := testHandler.buildGiteaDeliverableContext(ctx, task)
	if got == nil {
		t.Fatal("expected non-nil context when Gitea configured + document deliverable present")
	}
	if len(got.Deliverables) != 1 || got.Deliverables[0].ID != docID {
		t.Fatalf("expected exactly the document deliverable, got %+v", got.Deliverables)
	}
	// Owner/repo/inst/node-branch are ID-derived; just assert they're non-empty + shaped.
	for _, f := range []string{got.Owner, got.Repo, got.InstBranch, got.NodeBranch, got.Deliverables[0].Path} {
		if f == "" {
			t.Errorf("empty field in context: %+v", got)
		}
	}
	// round-trips through JSON (the daemon deserializes it this way).
	bs, _ := json.Marshal(got)
	var rt GiteaDeliverableContext
	if err := json.Unmarshal(bs, &rt); err != nil {
		t.Fatalf("round-trip: %v", err)
	}
}

// TestBuildGiteaDeliverableContext_Dormant asserts nil when Gitea is unconfigured.
func TestBuildGiteaDeliverableContext_Dormant(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	t.Setenv("GITEA_BASE_URL", "")
	t.Setenv("GITEA_ADMIN_TOKEN", "")
	task := dbTaskWithNodeRun(t, uuid.NewString())
	if got := testHandler.buildGiteaDeliverableContext(context.Background(), task); got != nil {
		t.Fatalf("expected nil when dormant, got %+v", got)
	}
}
```

> **Implementer note (verify):** `dbTaskWithNodeRun(t, nrID)` builds a `db.MulticaAgentTaskQueue` with `WorkflowNodeRunID` set — inspect the generated model (`server/pkg/db/generated/models.go` `MulticaAgentTaskQueue`) for the exact field type (string vs pgtype.UUID) and set the minimum required non-zero fields so `buildGiteaDeliverableContext`'s `parseUUID` path works. `mustExec`/`testHandler`/`testPool`/`testWorkspaceID`/`testUserID` per Task 1.

- [ ] **Step 4: Run to verify it fails**

```bash
cd server && go test ./internal/handler/ -run TestBuildGiteaDeliverableContext -v
```
Expected: FAIL — `buildGiteaDeliverableContext` undefined.

- [ ] **Step 5: Write the builder + wire into `ClaimTaskByRuntime`**

In `server/internal/handler/daemon.go`, add the helper (near `buildUpstreamStageContext`, ~line 1625). Add imports `"github.com/multica-ai/multica/server/internal/gitea"` and `"github.com/multica-ai/multica/server/internal/util"` if not present:

```go
// buildGiteaDeliverableContext attaches the platform-Gitea context the daemon
// + CLI need to push document deliverables, when (a) Gitea is configured, (b)
// the task executes a workflow node-run, and (c) that node has ≥1 document
// deliverable. Returns nil otherwise (dormant). Errors are swallowed (nil
// return) — a transient DB blip here must not break the claim; the agent would
// simply lack the Gitea context and the run surfaces a clone failure later.
func (h *Handler) buildGiteaDeliverableContext(ctx context.Context, task db.MulticaAgentTaskQueue) *GiteaDeliverableContext {
	if !isGiteaConfigured() || strings.TrimSpace(task.WorkflowNodeRunID) == "" {
		return nil
	}
	nr, err := h.Queries.GetWorkflowNodeRun(ctx, parseUUID(task.WorkflowNodeRunID))
	if err != nil {
		return nil
	}
	run, err := h.Queries.GetWorkflowRun(ctx, nr.WorkflowRunID)
	if err != nil {
		return nil
	}
	deliverables, err := h.Queries.ListWorkflowNodeDeliverables(ctx, nr.WorkflowNodeID)
	if err != nil {
		return nil
	}
	nodeRunIDStr := util.UUIDToString(nr.ID)
	var refs []GiteaDeliverableRef
	for _, d := range deliverables {
		if d.Kind != "document" {
			continue
		}
		refs = append(refs, GiteaDeliverableRef{
			ID:    util.UUIDToString(d.ID),
			Title: d.Title,
			Path:  gitea.DeliverablePath(nodeRunIDStr, util.UUIDToString(d.ID)),
		})
	}
	if len(refs) == 0 {
		return nil
	}
	return &GiteaDeliverableContext{
		Owner:      gitea.OrgName(util.UUIDToString(run.WorkspaceID)),
		Repo:       gitea.RepoName(util.UUIDToString(run.WorkflowID)),
		InstBranch: gitea.InstBranch(util.UUIDToString(run.ID)),
		NodeBranch: gitea.NodeBranch(nodeRunIDStr),
		Deliverables: refs,
	}
}
```

> **Verify** `task.WorkflowNodeRunID` is a `string` on `db.MulticaAgentTaskQueue` (the existing `taskToResponse` at `agent.go:288` assigns it to the string `resp.WorkflowNodeRunID`, so it is). `parseUUID` (handler builtin) is the trusted-round-trip variant — safe because the value is DB-sourced. `util.UUIDToString` handles `pgtype.UUID`.

Wire it in `ClaimTaskByRuntime`, right after the upstream-stage context is attached (~line 1614, before the final `writeJSON` at 1618):

```go
	if gctx := h.buildGiteaDeliverableContext(ctx, *task); gctx != nil {
		resp.GiteaDeliverables = gctx
	}
```

- [ ] **Step 6: Run to verify it passes**

```bash
cd server && go build ./... && go test ./internal/gitea/ -run TestDeliverablePath -v
cd server && go test ./internal/handler/ -run 'TestBuildGiteaDeliverableContext|TestSubmitNodeRunDeliverable' -v
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/internal/gitea/topology.go server/internal/gitea/topology_test.go \
  server/internal/handler/agent.go server/internal/handler/daemon.go \
  server/internal/handler/gitea_context_test.go
git commit -m "feat(gitea): attach GiteaDeliverableContext to workflow-node claim responses"
```

---

## Task 3: Daemon `Task` field + `MULTICA_GITEA_*` env vars

**Files:**
- Modify: `server/internal/daemon/types.go` (mirror types + field)
- Modify: `server/internal/daemon/daemon.go` (env block ~line 2431)
- Test: `server/internal/daemon/daemon_test.go` (append) or new

The daemon `Task` is JSON-deserialized from the server's `AgentTaskResponse` (same field names), so mirroring the types auto-populates the field.

- [ ] **Step 1: Mirror the types + add the field**

In `server/internal/daemon/types.go`, add (after `UpstreamStageContext` on the `Task` struct, ~line 60):

```go
	GiteaDeliverables *GiteaDeliverableContext `json:"gitea_deliverables,omitempty"` // M3: document deliverable git context (nil when dormant)
```

And add the two mirror types (the daemon needs them to deserialize):

```go
// GiteaDeliverableContext mirrors handler.GiteaDeliverableContext — the
// platform-Gitea context the CLI needs to push document deliverables. Populated
// by JSON-deserializing the claim response; nil when dormant.
type GiteaDeliverableContext struct {
	Owner        string                 `json:"owner"`
	Repo         string                 `json:"repo"`
	InstBranch   string                 `json:"inst_branch"`
	NodeBranch   string                 `json:"node_branch"`
	Deliverables []GiteaDeliverableRef `json:"deliverables"`
}

// GiteaDeliverableRef mirrors handler.GiteaDeliverableRef.
type GiteaDeliverableRef struct {
	ID    string `json:"deliverable_id"`
	Title string `json:"title"`
	Path  string `json:"path"`
}
```

- [ ] **Step 2: Write the failing env-block test**

In `server/internal/daemon/daemon_test.go` (append; or create `daemon_env_test.go`). The env block is built inline in `runAgentTask`-style logic — test the helper that materializes it. If the env map is built inline (not in a testable helper), first extract it: see Step 3.

```go
func TestAgentEnvIncludesGiteaContext(t *testing.T) {
	task := Task{
		ID:                "task-1",
		WorkspaceID:       "ws-1",
		WorkflowNodeRunID: "nr-1",
		GiteaDeliverables: &GiteaDeliverableContext{
			Owner:      "t-aaa",
			Repo:       "wf-bbb",
			InstBranch: "inst-cccc",
			NodeBranch: "node/dddd",
			Deliverables: []GiteaDeliverableRef{{ID: "d1", Title: "Doc", Path: "nodes/dddd/d1.md"}},
		},
	}
	env := buildAgentEnv(task, "slot-1") // extracted helper (Step 3)
	if env["MULTICA_NODE_RUN_ID"] != "nr-1" {
		t.Errorf("MULTICA_NODE_RUN_ID = %q", env["MULTICA_NODE_RUN_ID"])
	}
	if env["MULTICA_GITEA_OWNER"] != "t-aaa" {
		t.Errorf("MULTICA_GITEA_OWNER = %q", env["MULTICA_GITEA_OWNER"])
	}
	if env["MULTICA_GITEA_REPO"] != "wf-bbb" {
		t.Errorf("MULTICA_GITEA_REPO = %q", env["MULTICA_GITEA_REPO"])
	}
	if env["MULTICA_GITEA_INST_BRANCH"] != "inst-cccc" {
		t.Errorf("MULTICA_GITEA_INST_BRANCH = %q", env["MULTICA_GITEA_INST_BRANCH"])
	}
	if env["MULTICA_GITEA_NODE_BRANCH"] != "node/dddd" {
		t.Errorf("MULTICA_GITEA_NODE_BRANCH = %q", env["MULTICA_GITEA_NODE_BRANCH"])
	}
	if env["MULTICA_GITEA_DELIVERABLES"] == "" {
		t.Error("MULTICA_GITEA_DELIVERABLES not set")
	}
}

func TestAgentEnvOmitsGiteaWhenDormant(t *testing.T) {
	env := buildAgentEnv(Task{ID: "t", WorkspaceID: "ws"}, "slot-1")
	if _, ok := env["MULTICA_GITEA_OWNER"]; ok {
		t.Error("Gitea env must be absent when task has no GiteaDeliverables")
	}
	if _, ok := env["MULTICA_NODE_RUN_ID"]; ok {
		t.Error("MULTICA_NODE_RUN_ID must be absent when task has no node-run")
	}
}
```

- [ ] **Step 3: Extract `buildAgentEnv` + populate Gitea vars**

In `server/internal/daemon/daemon.go`, the env map is the literal `agentEnv := map[string]string{...}` at line ~2409. Extract it into a pure, testable helper:

```go
// buildAgentEnv materializes the environment variables passed to the spawned
// agent CLI. Extracted from runAgentTask so the Gitea context plumbing is
// unit-testable without spawning an agent.
func (d *Daemon) buildAgentEnv(task Task, agentName, slot string) map[string]string {
	env := map[string]string{
		"MULTICA_TOKEN":        d.client.Token(),
		"MULTICA_SERVER_URL":   d.cfg.ServerBaseURL,
		"MULTICA_DAEMON_PORT":  fmt.Sprintf("%d", d.cfg.HealthPort),
		"MULTICA_WORKSPACE_ID": task.WorkspaceID,
		"MULTICA_AGENT_NAME":   agentName,
		"MULTICA_AGENT_ID":     task.AgentID,
		"MULTICA_TASK_ID":      task.ID,
		"MULTICA_TASK_SLOT":    slot,
	}
	if task.AutopilotRunID != "" {
		env["MULTICA_AUTOPILOT_RUN_ID"] = task.AutopilotRunID
	}
	if task.AutopilotID != "" {
		env["MULTICA_AUTOPILOT_ID"] = task.AutopilotID
	}
	if task.QuickCreatePrompt != "" {
		env["MULTICA_QUICK_CREATE_TASK_ID"] = task.ID
	}
	if task.WorkflowNodeRunID != "" {
		env["MULTICA_NODE_RUN_ID"] = task.WorkflowNodeRunID
	}
	if g := task.GiteaDeliverables; g != nil {
		env["MULTICA_GITEA_OWNER"] = g.Owner
		env["MULTICA_GITEA_REPO"] = g.Repo
		env["MULTICA_GITEA_INST_BRANCH"] = g.InstBranch
		env["MULTICA_GITEA_NODE_BRANCH"] = g.NodeBranch
		if raw, err := json.Marshal(g.Deliverables); err == nil {
			env["MULTICA_GITEA_DELIVERABLES"] = string(raw)
		}
	}
	return env
}
```

Replace the inline `agentEnv := map[string]string{...}` block (lines ~2409–2431) with:

```go
	agentEnv := d.buildAgentEnv(task, agentName, strconv.Itoa(slot))
```

(Keep the subsequent `PATH`/`CODEX_HOME`/`OPENCLAW_CONFIG_PATH` env mutations that currently follow the literal — they read/modify `agentEnv` after construction. `agentName` is the variable already in scope above; `slot` is the int already in scope — pass `strconv.Itoa(slot)` if the helper takes a string, or change the signature to `slot int`. Match the existing types.)

- [ ] **Step 4: Run to verify it passes**

```bash
cd server && go build ./... && go test ./internal/daemon/ -run TestAgentEnv -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/daemon/types.go server/internal/daemon/daemon.go server/internal/daemon/daemon_test.go
git commit -m "feat(gitea): export MULTICA_NODE_RUN_ID + Gitea deliverable env to the agent"
```

---

## Task 4: Daemon prompt "Document Deliverables" section

**Files:**
- Modify: `server/internal/daemon/prompt.go` (`BuildPrompt` default branch, after the upstream block ~line 59)
- Test: `server/internal/daemon/prompt_test.go` (append)

- [ ] **Step 1: Write the failing test**

Append to `server/internal/daemon/prompt_test.go`:

```go
func TestBuildPromptGiteaDeliverables(t *testing.T) {
	task := Task{
		IssueID:  "iss-1",
		AgentID:  "a-1",
		GiteaDeliverables: &GiteaDeliverableContext{
			Owner: "t-aaa", Repo: "wf-bbb", InstBranch: "inst-cc", NodeBranch: "node/dd",
			Deliverables: []GiteaDeliverableRef{
				{ID: "d1", Title: "Design Doc", Path: "nodes/dd/d1.md"},
				{ID: "d2", Title: "API Spec", Path: "nodes/dd/d2.md"},
			},
		},
	}
	got := BuildPrompt(task, "claude")
	if !strings.Contains(got, "Document Deliverables") {
		t.Errorf("prompt missing Document Deliverables section:\n%s", got)
	}
	if !strings.Contains(got, `cs-workflow gitea submit --deliverable d1 --file`) {
		t.Errorf("prompt missing gitea submit command for d1:\n%s", got)
	}
	if !strings.Contains(got, "Design Doc") || !strings.Contains(got, "API Spec") {
		t.Errorf("prompt missing deliverable titles:\n%s", got)
	}
}

func TestBuildPromptNoGiteaDeliverablesWhenAbsent(t *testing.T) {
	got := BuildPrompt(Task{IssueID: "iss-1", AgentID: "a-1"}, "claude")
	if strings.Contains(got, "Document Deliverables") {
		t.Errorf("prompt must not mention document deliverables when context absent:\n%s", got)
	}
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd server && go test ./internal/daemon/ -run TestBuildPromptGiteaDeliverables -v
```
Expected: FAIL.

- [ ] **Step 3: Add the section**

In `server/internal/daemon/prompt.go` `BuildPrompt`, insert this block in the default branch, immediately AFTER the upstream-stage block closes (after the `b.WriteString("---\n\n")` at line ~58, before the final `fmt.Fprintf(&b, "Start by running...")` at line ~61):

```go
	// Document deliverables: instruct the agent to produce each doc and submit
	// via the Gitea CLI (which pushes + opens a PR + reports). Only present when
	// Gitea is configured for this run (task.GiteaDeliverables != nil).
	if task.GiteaDeliverables != nil {
		b.WriteString("## Document Deliverables\n\n")
		b.WriteString("This node has document deliverables stored in the platform git server. For EACH deliverable below: write the document to a local file, then submit it with the CLI — the command creates a node branch off the run's instance branch, pushes your file, opens a Gitea PR, and registers the PR back here. Do NOT use inline content upload for these; document deliverables go through git.\n\n")
		for _, d := range task.GiteaDeliverables.Deliverables {
			fmt.Fprintf(&b, "- **%s** (id=%s): run `cs-workflow gitea submit --deliverable %s --file <local-path-to-your-document>`\n", d.Title, d.ID, d.ID)
		}
		b.WriteString("A deliverable is not considered submitted until its PR is registered. Complete every listed deliverable before finishing.\n\n")
		b.WriteString("---\n\n")
	}
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd server && go test ./internal/daemon/ -run 'TestBuildPromptGitea|TestBuildPromptNoGitea' -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/daemon/prompt.go server/internal/daemon/prompt_test.go
git commit -m "feat(gitea): instruct agent to submit document deliverables via cs-workflow gitea"
```

---

## Task 5: `cs-workflow gitea submit` CLI command

**Files:**
- Create: `server/cmd/cs-workflow/cmd_gitea.go`
- Create: `server/cmd/cs-workflow/cmd_gitea_test.go`
- Modify: `server/cmd/cs-workflow/main.go` (register `giteaCmd`)

The largest task. The command reads `MULTICA_GITEA_*` env, fetches the workspace PAT, shallow-clones the inst branch, creates the node branch, writes the file, commits, force-pushes, opens a Gitea PR, and POSTs `report-pr`. Git ops live behind a `gitOps` interface so the orchestration is unit-testable with a fake + httptest (the real impl uses `exec.Command("git")`, mirroring `cmd_mr.go`).

- [ ] **Step 1: Write the failing orchestration test**

Create `server/cmd/cs-workflow/cmd_gitea_test.go`:

```go
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// fakeGitOps records the sequence of git operations without touching the
// filesystem or a real git binary.
type fakeGitOps struct {
	cloneCalls  []cloneCall
	branchCalls []string
	written     []writtenFile
	commitMsgs  []string
	pushCalls   []string
}

type cloneCall struct{ authURL, branch, dir string }
type writtenFile struct{ dir, path string; content []byte }

func (f *fakeGitOps) Clone(authURL, branch, dir string) error {
	f.cloneCalls = append(f.cloneCalls, cloneCall{authURL, branch, dir})
	return nil
}
func (f *fakeGitOps) PrepareBranch(dir, nodeBranch, instBranch string) error {
	f.branchCalls = append(f.branchCalls, nodeBranch+":"+instBranch)
	return nil
}
func (f *fakeGitOps) WriteFile(dir, path string, content []byte) error {
	f.written = append(f.written, writtenFile{dir, path, content})
	return nil
}
func (f *fakeGitOps) Commit(dir, message string) error {
	f.commitMsgs = append(f.commitMsgs, message)
	return nil
}
func (f *fakeGitOps) Push(dir, authURL, branch string) error {
	f.pushCalls = append(f.pushCalls, branch)
	return nil
}

// TestRunGiteaSubmit_HappyPath wires a fake git + httptest Gitea + httptest
// Multica and asserts the full submit flow: credential fetch → clone inst →
// prepare node branch → write file → commit → push → open PR → report-pr with
// the PR URL.
func TestRunGiteaSubmit_HappyPath(t *testing.T) {
	// Multica server: credential + report-pr.
	var reportedURL string
	multica := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/gitea/credential":
			writeJSON(w, 200, map[string]string{"base_url": "https://gitea.test", "token": "pat-xyz"})
		case "/api/daemon/node-runs/nr-1/deliverables/d1/report-pr":
			var body struct{ PullRequestURL string `json:"pull_request_url"` }
			_ = json.NewDecoder(r.Body).Decode(&body)
			reportedURL = body.PullRequestURL
			writeJSON(w, 200, map[string]any{"id": "sub-1", "pull_request_url": body.PullRequestURL})
		default:
			http.NotFound(w, r)
		}
	}))
	defer multica.Close()

	// Gitea: open PR returns the web URL.
	giteaSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/pulls") {
			writeJSON(w, 201, map[string]any{
				"number":   7,
				"html_url": "https://gitea.test/t-aaa/wf-bbb/pulls/7",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer giteaSrv.Close()

	t.Setenv("MULTICA_TOKEN", "tok")
	t.Setenv("MULTICA_SERVER_URL", multica.URL)
	t.Setenv("MULTICA_WORKSPACE_ID", "ws-1")
	t.Setenv("MULTICA_NODE_RUN_ID", "nr-1")
	t.Setenv("MULTICA_GITEA_OWNER", "t-aaa")
	t.Setenv("MULTICA_GITEA_REPO", "wf-bbb")
	t.Setenv("MULTICA_GITEA_INST_BRANCH", "inst-cc")
	t.Setenv("MULTICA_GITEA_NODE_BRANCH", "node/dd")
	t.Setenv("MULTICA_GITEA_DELIVERABLES", `[{"deliverable_id":"d1","title":"Doc","path":"nodes/dd/d1.md"}]`)

	// credential points at the httptest gitea via base_url override.
	tmpFile := tempFile(t, "# my document body")

	fake := &fakeGitOps{}
	err := submitDeliverable(submitConfig{
		giteaBaseOverride: giteaSrv.URL, // point PR create at httptest instead of https://gitea.test
		deliverableID:     "d1",
		filePath:          tmpFile,
		gitOps:            fake,
	})
	if err != nil {
		t.Fatalf("submitDeliverable: %v", err)
	}
	if len(fake.cloneCalls) != 1 || fake.cloneCalls[0].branch != "inst-cc" {
		t.Errorf("expected one clone of inst-cc, got %+v", fake.cloneCalls)
	}
	if len(fake.written) != 1 || fake.written[0].path != "nodes/dd/d1.md" {
		t.Errorf("expected file written to nodes/dd/d1.md, got %+v", fake.written)
	}
	if len(fake.pushCalls) != 1 || fake.pushCalls[0] != "node/dd" {
		t.Errorf("expected push of node/dd, got %+v", fake.pushCalls)
	}
	if reportedURL != "https://gitea.test/t-aaa/wf-bbb/pulls/7" {
		t.Errorf("report-pr received %q, want the PR html_url", reportedURL)
	}
}

// writeJSON is a tiny test helper (the real one is in the handler pkg; the CLI
// test pkg has its own).
func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func tempFile(t *testing.T, content string) string {
	t.Helper()
	f, err := os.CreateTemp(t.TempDir(), "doc-*.md")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = f.WriteString(content)
	_ = f.Close()
	return f.Name()
}

// smoke: env-missing errors cleanly
func TestRunGiteaSubmit_MissingNodeRunID(t *testing.T) {
	t.Setenv("MULTICA_NODE_RUN_ID", "")
	if err := submitDeliverable(submitConfig{deliverableID: "d1", filePath: "x", gitOps: &fakeGitOps{}}); err == nil {
		t.Fatal("expected error when MULTICA_NODE_RUN_ID missing")
	}
	_ = fmt.Sprint // keep fmt import if unused elsewhere
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd server && go test ./cmd/cs-workflow/ -run TestRunGiteaSubmit -v
```
Expected: FAIL — `submitDeliverable`/`submitConfig`/`giteaCmd` undefined.

- [ ] **Step 3: Write `cmd_gitea.go`**

Create `server/cmd/cs-workflow/cmd_gitea.go`:

```go
package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
)

var giteaCmd = &cobra.Command{
	Use:   "gitea",
	Short: "Platform git-server deliverable operations",
}

var giteaSubmitCmd = &cobra.Command{
	Use:   "submit",
	Short: "Push a document deliverable to the platform Gitea and open a PR",
	Long:  "Reads MULTICA_GITEA_* env (set by the daemon), fetches the workspace Gitea PAT, pushes the document to the node branch, opens a Gitea PR (node→inst), and registers the PR URL back to Multica.",
	RunE:  runGiteaSubmit,
}

func init() {
	giteaCmd.AddCommand(giteaSubmitCmd)
	giteaSubmitCmd.Flags().String("deliverable", "", "Deliverable ID (required)")
	giteaSubmitCmd.Flags().String("file", "", "Local file whose content is the document body (required)")
	_ = giteaSubmitCmd.MarkFlagRequired("deliverable")
	_ = giteaSubmitCmd.MarkFlagRequired("file")
}

func runGiteaSubmit(cmd *cobra.Command, _ []string) error {
	deliverableID, _ := cmd.Flags().GetString("deliverable")
	filePath, _ := cmd.Flags().GetString("file")
	return submitDeliverable(submitConfig{
		deliverableID: deliverableID,
		filePath:      filePath,
		gitOps:        &execGitOps{},
	})
}

// submitConfig parameterizes submitDeliverable for testing.
type submitConfig struct {
	deliverableID     string
	filePath          string
	gitOps            gitOps
	giteaBaseOverride string // test-only: override the Gitea base URL (else from credential)
}

// gitOps abstracts the git operations so the submit flow is unit-testable.
// The production impl (execGitOps) shells out to git, mirroring cmd_mr.go.
type gitOps interface {
	Clone(authURL, branch, dir string) error      // shallow single-branch clone of `branch`
	PrepareBranch(dir, nodeBranch, instBranch string) error // create/reset nodeBranch off instBranch
	WriteFile(dir, path string, content []byte) error
	Commit(dir, message string) error
	Push(dir, authURL, branch string) error
}

// giteaContext is the scalar Gitea context read from MULTICA_GITEA_* env.
type giteaContext struct {
	nodeRunID   string
	owner       string
	repo        string
	instBranch  string
	nodeBranch  string
	deliverables []giteaDeliverableRef
}

type giteaDeliverableRef struct {
	ID    string `json:"deliverable_id"`
	Title string `json:"title"`
	Path  string `json:"path"`
}

func readGiteaContext() (*giteaContext, error) {
	c := &giteaContext{
		nodeRunID:  os.Getenv("MULTICA_NODE_RUN_ID"),
		owner:      os.Getenv("MULTICA_GITEA_OWNER"),
		repo:       os.Getenv("MULTICA_GITEA_REPO"),
		instBranch: os.Getenv("MULTICA_GITEA_INST_BRANCH"),
		nodeBranch: os.Getenv("MULTICA_GITEA_NODE_BRANCH"),
	}
	if c.nodeRunID == "" {
		return nil, fmt.Errorf("MULTICA_NODE_RUN_ID not set; this command must run inside a workflow-node task")
	}
	for _, f := range []string{c.owner, c.repo, c.instBranch, c.nodeBranch} {
		if f == "" {
			return nil, fmt.Errorf("MULTICA_GITEA_* env incomplete (owner/repo/inst/node-branch required)")
		}
	}
	raw := os.Getenv("MULTICA_GITEA_DELIVERABLES")
	if raw == "" {
		return nil, fmt.Errorf("MULTICA_GITEA_DELIVERABLES not set")
	}
	if err := json.Unmarshal([]byte(raw), &c.deliverables); err != nil {
		return nil, fmt.Errorf("parse MULTICA_GITEA_DELIVERABLES: %w", err)
	}
	return c, nil
}

func (c *giteaContext) deliverablePath(id string) (string, error) {
	for _, d := range c.deliverables {
		if d.ID == id {
			return d.Path, nil
		}
	}
	return "", fmt.Errorf("deliverable %q not in MULTICA_GITEA_DELIVERABLES", id)
}

// submitDeliverable is the testable core: it does NOT read cobra flags or
// globals beyond env + cfg. Returns nil only after the PR is registered.
func submitDeliverable(cfg submitConfig) error {
	ctx := context.Background()

	gctx, err := readGiteaContext()
	if err != nil {
		return err
	}
	docPath, err := gctx.deliverablePath(cfg.deliverableID)
	if err != nil {
		return err
	}
	content, err := os.ReadFile(cfg.filePath)
	if err != nil {
		return fmt.Errorf("read --file: %w", err)
	}

	cred, err := fetchGiteaCredential(envOr("MULTICA_SERVER_URL", ""), os.Getenv("MULTICA_TOKEN"), os.Getenv("MULTICA_WORKSPACE_ID"))
	if err != nil {
		return fmt.Errorf("fetch gitea credential: %w", err)
	}
	giteaBase := cred.BaseURL
	if cfg.giteaBaseOverride != "" {
		giteaBase = cfg.giteaBaseOverride
	}
	cloneAuth := injectToken(cred.BaseURL, gctx.owner, gctx.repo, cred.Token)
	if cfg.giteaBaseOverride != "" {
		cloneAuth = injectToken(cfg.giteaBaseOverride, gctx.owner, gctx.repo, cred.Token)
	}

	dir, err := os.MkdirTemp("", "multica-gitea-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)

	if err := cfg.gitOps.Clone(cloneAuth, gctx.instBranch, dir); err != nil {
		return fmt.Errorf("clone: %w", err)
	}
	if err := cfg.gitOps.PrepareBranch(dir, gctx.nodeBranch, gctx.instBranch); err != nil {
		return fmt.Errorf("prepare node branch: %w", err)
	}
	if err := cfg.gitOps.WriteFile(dir, docPath, content); err != nil {
		return fmt.Errorf("write document: %w", err)
	}
	if err := cfg.gitOps.Commit(dir, "deliverable: "+cfg.deliverableID); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	if err := cfg.gitOps.Push(dir, cloneAuth, gctx.nodeBranch); err != nil {
		return fmt.Errorf("push: %w", err)
	}

	prURL, err := openGiteaPR(ctx, giteaBase, cred.Token, gctx.owner, gctx.repo, gctx.nodeBranch, gctx.instBranch, cfg.deliverableID)
	if err != nil {
		return fmt.Errorf("open PR: %w", err)
	}
	if err := reportDeliverablePR(ctx, envOr("MULTICA_SERVER_URL", ""), os.Getenv("MULTICA_TOKEN"), gctx.nodeRunID, cfg.deliverableID, prURL); err != nil {
		return fmt.Errorf("report PR: %w", err)
	}
	fmt.Println(prURL)
	return nil
}

func envOr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

// injectToken builds an HTTPS clone URL with the PAT embedded for git auth:
// https://oauth2:<token>@<host>/<owner>/<repo>.git. Mirrors cmd_mr.go's
// buildAuthURL pattern (Gitea accepts the token as the password).
func injectToken(baseURL, owner, repo, token string) string {
	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || u.Host == "" {
		return ""
	}
	u.User = url.UserPassword("oauth2", token)
	u.Path = fmt.Sprintf("/%s/%s.git", owner, repo)
	return u.String()
}

// fetchGiteaCredential calls GET /api/gitea/credential. Mirrors
// fetchGitlabCredential in cmd_mr.go.
func fetchGiteaCredential(serverURL, token, workspaceID string) (struct {
	BaseURL string `json:"base_url"`
	Token   string `json:"token"`
}, error) {
	var out struct {
		BaseURL string `json:"base_url"`
		Token   string `json:"token"`
	}
	if serverURL == "" || token == "" {
		return out, fmt.Errorf("MULTICA_SERVER_URL/MULTICA_TOKEN not set")
	}
	req, _ := http.NewRequest(http.MethodGet, serverURL+"/api/gitea/credential", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	if workspaceID != "" {
		req.Header.Set("X-Workspace-ID", workspaceID)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return out, fmt.Errorf("credential: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return out, err
	}
	if out.BaseURL == "" || out.Token == "" {
		return out, fmt.Errorf("credential response missing base_url/token")
	}
	return out, nil
}

// openGiteaPR POSTs /api/v1/repos/{owner}/{repo}/pulls and returns html_url.
func openGiteaPR(ctx context.Context, base, token, owner, repo, head, baseBranch, deliverableID string) (string, error) {
	body, _ := json.Marshal(map[string]string{
		"head":  head,
		"base":  baseBranch,
		"title": "document deliverable " + deliverableID,
	})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(base, "/")+"/api/v1/repos/"+owner+"/"+repo+"/pulls", bytes.NewReader(body))
	req.Header.Set("Authorization", "token "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// 409 conflict / others: surface to caller (the agent can retry).
		return "", fmt.Errorf("gitea create PR: status %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	var pr struct {
		HTMLURL string `json:"html_url"`
		Number  int    `json:"number"`
	}
	if err := json.Unmarshal(respBody, &pr); err != nil {
		return "", fmt.Errorf("parse PR response: %w", err)
	}
	return pr.HTMLURL, nil
}

// reportDeliverablePR POSTs the PR URL to the daemon report-pr endpoint.
func reportDeliverablePR(ctx context.Context, serverURL, token, nodeRunID, deliverableID, prURL string) error {
	body, _ := json.Marshal(map[string]string{"pull_request_url": prURL})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		serverURL+"/api/daemon/node-runs/"+nodeRunID+"/deliverables/"+deliverableID+"/report-pr", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("report-pr: status %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return nil
}

// keep base64 + filepath referenced for the exec impl below
var _ = base64.StdEncoding
var _ = filepath.Join

// execGitOps implements gitOps via shelled-out git (mirrors cmd_mr.go).
type execGitOps struct{}

func (execGitOps) Clone(authURL, branch, dir string) error {
	return runGit(dir, "clone", "--depth", "1", "--single-branch", "--branch", branch, authURL, dir)
}
func (execGitOps) PrepareBranch(dir, nodeBranch, instBranch string) error {
	// Create/reset node branch off the cloned inst branch. -B resets if it
	// already exists locally (idempotent re-submit from a fresh shallow clone).
	if err := runGit(dir, "checkout", "-B", nodeBranch, "HEAD"); err != nil {
		return err
	}
	return nil
}
func (execGitOps) WriteFile(dir, path string, content []byte) error {
	full := filepath.Join(dir, path)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return err
	}
	return os.WriteFile(full, content, 0o644)
}
func (execGitOps) Commit(dir, message string) error {
	if err := runGit(dir, "add", "-A"); err != nil {
		return err
	}
	return runGit(dir, "-c", "user.email=bot@multica", "-c", "user.name=Multica Bot",
		"commit", "-m", message)
}
func (execGitOps) Push(dir, authURL, branch string) error {
	// Force-push: a node branch has a single writer pre-merge; re-submit
	// replaces WIP and the open PR auto-updates.
	return runGit(dir, "push", "--force", authURL, branch)
}

// runGit runs git with cwd=dir, streaming stderr to the caller's stderr.
func runGit(dir string, args ...string) error {
	cmd := exec.Command("git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	return cmd.Run()
}
```

- [ ] **Step 4: Register the command**

In `server/cmd/cs-workflow/main.go`, in the `init()` command-registration block (after `rootCmd.AddCommand(mrCmd)` at ~line 75), add:

```go
	rootCmd.AddCommand(giteaCmd)
```

- [ ] **Step 5: Run to verify it passes**

```bash
cd server && go build ./... && go vet ./cmd/cs-workflow/...
cd server && go test ./cmd/cs-workflow/ -run TestRunGiteaSubmit -v
```
Expected: PASS (orchestration with fake gitOps + httptest; no real git/network).

> **Manual integration check (not automated, mirroring cmd_mr.go which has no tests):** against a real Gitea + Multica, run the command inside a claimed node-run task env and confirm a PR opens + the submission row gains `pull_request_url`. Document the result in the commit message.

- [ ] **Step 6: Commit**

```bash
git add server/cmd/cs-workflow/cmd_gitea.go server/cmd/cs-workflow/cmd_gitea_test.go server/cmd/cs-workflow/main.go
git commit -m "feat(gitea): add cs-workflow gitea submit (push doc, open PR, report-pr)"
```

---

## Task 6: Frontend — render document-deliverable PR links in `NodeRunCard`

**Files:**
- Create: `packages/views/workflows/components/node-run-deliverables.tsx`
- Create: `packages/views/workflows/components/node-run-deliverables.test.tsx`
- Modify: `packages/views/workflows/components/node-run-card.tsx` (render the block)

The critic reviews on `NodeRunCard` (it has the approve/reject UI). Wire the currently-dead `nodeRunDeliverableSubmissionsOptions` and render each submission's `pull_request_url` as a link. `pull_request_url` on a submission is the document-PR pointer (code-type PRs live in `issue_pull_request`/`issue_merge_request`, not here), so render a PR link for any submission with a non-empty `pull_request_url`.

- [ ] **Step 1: Write the failing test**

Create `packages/views/workflows/components/node-run-deliverables.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NodeRunDeliverables } from "./node-run-deliverables";

vi.mock("@multica/core/api", () => ({
  api: {
    listNodeRunDeliverableSubmissions: vi.fn(),
  },
}));

import { api } from "@multica/core/api";

function withClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("NodeRunDeliverables", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a PR link for a submission with pull_request_url", async () => {
    vi.mocked(api.listNodeRunDeliverableSubmissions).mockResolvedValue([
      {
        id: "sub-1",
        workflow_node_run_id: "nr-1",
        deliverable_id: "d-1",
        submitted_by_type: "agent",
        submitted_by_id: null,
        status: "submitted",
        content: "",
        attachment_id: null,
        pull_request_url: "https://gitea.test/t-aaa/wf-bbb/pulls/7",
        review_comment: "",
        submitted_at: "2026-07-18T00:00:00Z",
        reviewed_at: null,
        created_at: "2026-07-18T00:00:00Z",
        updated_at: "2026-07-18T00:00:00Z",
      },
    ]);
    withClient(<NodeRunDeliverables wsId="ws-1" nodeRunId="nr-1" />);

    const link = await screen.findByRole("link", { name: /pull request/i });
    expect(link).toHaveAttribute("href", "https://gitea.test/t-aaa/wf-bbb/pulls/7");
  });

  it("renders nothing notable when there are no submissions", async () => {
    vi.mocked(api.listNodeRunDeliverableSubmissions).mockResolvedValue([]);
    const { container } = withClient(<NodeRunDeliverables wsId="ws-1" nodeRunId="nr-1" />);
    // No PR link rendered.
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).not.toContain("pull_request_url");
  });
});
```

> **Implementer note (verify):** confirm the `api.listNodeRunDeliverableSubmissions` signature + return type in `packages/core/api/client.ts:2486` (it returns `WorkflowNodeDeliverableSubmission[]` with all fields above). The mock pattern matches the CLAUDE.md mocking convention (`@multica/core/api`). The test lives in `packages/views/` per the testing-rules table (shared component behavior).

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @multica/views exec vitest run workflows/components/node-run-deliverables.test.tsx
```
Expected: FAIL — module `./node-run-deliverables` not found.

- [ ] **Step 3: Create the component**

Create `packages/views/workflows/components/node-run-deliverables.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { nodeRunDeliverableSubmissionsOptions } from "@multica/core/workflows/queries";
import { ExternalLink } from "lucide-react"; // existing icon dep in packages/ui/views

/**
 * Renders the document-deliverable submissions for a node run: for each
 * submission carrying a pull_request_url, a link to the Gitea PR. This is the
 * critic's review surface for document deliverables (click through to Gitea to
 * read the diff, then approve/reject in NodeRunCard).
 *
 * `pull_request_url` on a submission is the document-PR pointer (code-type PRs
 * are tracked separately in issue_pull_request/issue_merge_request), so any
 * non-empty URL here is a document deliverable PR.
 */
export function NodeRunDeliverables({ wsId, nodeRunId }: { wsId: string; nodeRunId: string }) {
  const { data: submissions } = useQuery({
    ...nodeRunDeliverableSubmissionsOptions(wsId, nodeRunId),
    enabled: !!nodeRunId,
  });

  const withPR = (submissions ?? []).filter((s) => s.pull_request_url && s.pull_request_url.length > 0);
  if (withPR.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1.5 py-1">
      <div className="text-muted-foreground text-xs font-medium">Deliverable PRs</div>
      <ul className="space-y-1">
        {withPR.map((s) => (
          <li key={s.id}>
            <a
              href={s.pull_request_url}
              target="_blank"
              rel="noreferrer"
              className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
            >
              <ExternalLink className="size-3.5" />
              <span>
                Pull request · {s.status}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

> **Verify** `lucide-react` is the icon source used elsewhere in `packages/views` (it is the conventional dep); swap to whichever icon import the neighboring components use (e.g. `node-run-card.tsx`). Use semantic tokens (`text-muted-foreground`, `text-primary`) per the CSS rules — no hardcoded colors.

- [ ] **Step 4: Wire into `NodeRunCard`**

In `packages/views/workflows/components/node-run-card.tsx`, import the component and render it inside the card body (after the critic-comment/critic-output block, ~line 116, before the review textarea at ~line 132). The card already receives `wsId` (verify the prop name — `NodeRunCard` is rendered by `WorkflowRunPage` which has `wsId`); pass `wsId` + `nodeRun.id`:

```tsx
import { NodeRunDeliverables } from "./node-run-deliverables";
// ...
// inside the card JSX, after the critic output block:
<NodeRunDeliverables wsId={wsId} nodeRunId={nodeRun.id} />
```

> **Verify** the prop in scope: `NodeRunCard`'s signature + whether `wsId` is already a prop or needs threading from `WorkflowRunPage`. The CLAUDE.md rule "hooks that need workspace context should accept wsId as a parameter" applies — pass it explicitly.

- [ ] **Step 5: Run to verify it passes**

```bash
pnpm --filter @multica/views exec vitest run workflows/components/node-run-deliverables.test.tsx
pnpm typecheck
```
Expected: PASS + clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add packages/views/workflows/components/node-run-deliverables.tsx \
  packages/views/workflows/components/node-run-deliverables.test.tsx \
  packages/views/workflows/components/node-run-card.tsx
git commit -m "feat(gitea): render document-deliverable PR links in NodeRunCard"
```

---

## Self-Review

**1. Spec coverage (design §五 + M3 backlog):**
- §五.2 "claim response 扩展 (repo URL + inst + node branch + 路径)" → Task 2 (`GiteaDeliverableContext` + `DeliverablePath`).
- §五.3 "daemon 侧: 文档型 push + 开 Gitea PR" → Tasks 3 (env) + 4 (prompt) + 5 (CLI command).
- §五.4 "submission 指针: document 型改用 git 指针; approve 钩子触发 server 合并" → M2 done (merge); Task 5 (report-pr) + Task 6 (render pointer) close the loop.
- §五.5 "关闭上传入口" → Task 1.
- M3 backlog I1 → Task 1 (disable-upload closes it at source; merge guard intentionally not added — would be dead code).
- Credential "may need owner/repo" → resolved: NO; owner/repo travel via claim response (Locked decisions).
- Frontend "submissions query is dead code" → Task 6 is its first consumer.

**2. Placeholder scan:** Steps contain real code. "Verify" notes flag exact-symbol confirmations against generated/existing code (test-fixture helper names, `MulticaAgentTaskQueue.WorkflowNodeRunID` type, `NodeRunCard` wsId prop, lucide import) — these are confirmation steps, not undefined references; the code shown compiles once the confirmed names are plugged in. No "TODO/TBD/implement later".

**3. Type consistency:** `GiteaDeliverableContext{Owner,Repo,InstBranch,NodeBranch,Deliverables[]GiteaDeliverableRef}` + `GiteaDeliverableRef{ID,Title,Path}` are identical across `handler` (Task 2) and `daemon` (Task 3) — JSON tags match (`gitea_deliverables`, `deliverable_id`, `title`, `path`) so deserialization auto-populates. CLI `giteaDeliverableRef` uses the same JSON tags. `MULTICA_GITEA_DELIVERABLES` JSON shape (`[{deliverable_id,title,path}]`) is produced by Task 3's `json.Marshal(g.Deliverables)` and consumed by Task 5's `readGiteaContext`. `gitea.DeliverablePath`, `OrgName`, `RepoName`, `InstBranch`, `NodeBranch` all exist (M1 + Task 2). `submitDeliverable(submitConfig{...})` signature matches across Task 5 impl + test.

**4. Dormancy:** Gitea unconfigured → Task 1 allows legacy uploads; Task 2 returns nil context → Task 3 omits env → Task 4 omits prompt section → Task 5 errors cleanly if somehow invoked. Frontend (Task 6) is independent of dormancy (renders whatever submissions exist).

**5. Verification gaps:** DB-backed Go tests (Tasks 1, 2) run in the `golang:1.26-alpine`-in-`multica_default` container, DB user **root** pw 8 chars (per memory). CLI (Task 5) is fully unit-tested via fake gitOps + httptest (no real git/network). Frontend (Task 6) jsdom. The real end-to-end (clone→push→PR→report against a live Gitea) is a manual check, mirroring `cmd_mr.go`'s test posture.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-07-17-deliverable-git-storage-m3.md`. Execution options (same as M1/M2):

1. **Subagent-Driven (recommended)** — fresh implementer per task, two-stage review.
2. **Inline Execution** — executing-plans, batched checkpoints.

Which approach?

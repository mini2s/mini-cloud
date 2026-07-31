# 交付物地址公网转换 + 代码 PR 链接归档 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Rewrite deliverable PR URLs to the public Gitea host at API response time so frontend links open; (2) archive every code-MR link (human + agent, all three submission paths) into one `.md` on the node branch reusing a single node PR; (3) stop Multica from auto-merging code MRs (user merges them).

**Architecture:** Req 1 = one-line host rewrite in the single deliverable-submission response assembler, reusing the existing `rewriteGiteaHostToPublic` (exported). Req 2 = a shared best-effort async service method `ArchiveNodeCodeLinks` that rebuilds a node-run's code-links `.md` on `NodeBranch` and (re)opens `NodeBranch → inst`, triggered after each of the three submission paths commits. Req 3 = `mergeReviewURL` no-ops on any non-Gitea URL.

**Tech Stack:** Go (Chi, sqlc), Gitea via `coderepo.RepositoryProvider`, Vitest-free (Go `testing`). DB-backed tests run via the golang-container recipe (`docs`/memory: `local-db-test-via-golang-container`).

**Spec:** `docs/superpowers/specs/2026-07-31-deliverable-url-and-code-pr-archive-design.md`

**Branch:** `feat/deliverable-kind-unification` (continue on it).

**Design refinements since spec v1 (folded in, all align with user's "用户自己合代码 MR"):**
- Submission `pull_request_url` **keeps the real code-MR URL** (not overwritten with the node-PR URL) — so users can click → merge it themselves. The node PR is archive-only.
- The agent's **main** code-MR path is `autoSubmitSingleRequiredDeliverable` (worker-output) — it is covered (Task 6), not just `/submit`.
- `mergeReviewURL` must skip code MRs (Task 7) — it auto-merges GitLab MRs today.

---

## File Structure

- `server/internal/service/task_cscloud_push.go` — export `rewriteGiteaHostToPublic` → `RewriteGiteaHostToPublic` (Task 1).
- `server/internal/handler/workflow_run.go` — apply host rewrite in `workflowNodeDeliverableSubmissionToResponse` (Task 2); replace the GitLab-only archive block in `SubmitNodeRunDeliverable` with async `ArchiveNodeCodeLinks` (Task 4).
- `server/internal/service/workflow_deliverable_repo.go` — add `isArchiveGiteaURL`, `ArchiveNodeCodeLinks`, `codeLinksArchiveFile` (Task 3); refactor `UploadMemberDeliverablePR` (Task 5); skip code MRs in `mergeReviewURL` (Task 7).
- `server/internal/service/workflow.go` — trigger `ArchiveNodeCodeLinks` after `SubmitWorkerOutput` commits (Task 6).
- `server/internal/gitea/topology.go` — no change needed (reuse `NodeBranch`/`NodeDir`/`InstBranch`/`OrgName`).
- Tests: `server/internal/service/task_cscloud_push_test.go` (Task 1), `server/internal/handler/workflow_run_deliverable_test.go` (Tasks 2, 4), `server/internal/service/workflow_deliverable_repo_test.go` (Tasks 3, 5, 7), `server/internal/service/workflow_test.go` or neighbour (Task 6).

---

## Task 1: Export `rewriteGiteaHostToPublic`

**Files:**
- Modify: `server/internal/service/task_cscloud_push.go` (def ~line 951; callers ~544, ~854, ~862)
- Modify: `server/internal/service/task_cscloud_push_test.go` (4 tests ~2478-2516)

- [ ] **Step 1: Rename the function (definition)**

In `server/internal/service/task_cscloud_push.go`, rename the func signature:

```go
func RewriteGiteaHostToPublic(rawURL string) string {
```

(body unchanged; only the identifier changes from `rewriteGiteaHostToPublic`)

- [ ] **Step 2: Update the two call sites in the same file**

`resolveDeliveryRepo` (~line 544) and `repositoryDeliverableEnv` (~lines 854, 862) call `rewriteGiteaHostToPublic(...)`. Change each to `RewriteGiteaHostToPublic(...)`.

- [ ] **Step 3: Update the tests**

In `server/internal/service/task_cscloud_push_test.go`, the four tests `TestRewriteGiteaHostToPublic`, `..._NoopWithoutPublicBase`, `..._NoopForUnknownHost`, `..._PortIsExactNotPrefix` call the unexported name. Rename each call to `RewriteGiteaHostToPublic`. (Also `TestResolveDeliveryRepo_RewritesInternalHostToPublic` / `TestRepositoryDeliverableEnv_RewritesInternalHostToPublic` exercise it indirectly — no change needed there.)

- [ ] **Step 4: Build the service package**

Run: `cd server && go build ./internal/service/`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/task_cscloud_push.go server/internal/service/task_cscloud_push_test.go
git commit -m "refactor(service): export RewriteGiteaHostToPublic for reuse by handlers"
```

---

## Task 2: Rewrite deliverable PR URL in the API response (Req 1)

**Files:**
- Modify: `server/internal/handler/workflow_run.go:1061-1078` (`workflowNodeDeliverableSubmissionToResponse`)
- Test: `server/internal/handler/workflow_run_deliverable_test.go`

- [ ] **Step 1: Write the failing test**

Append to `server/internal/handler/workflow_run_deliverable_test.go`:

```go
func TestWorkflowNodeDeliverableSubmissionToResponse_RewritesGiteaHost(t *testing.T) {
	t.Setenv("GITEA_BASE_URL", "http://10.20.19.101:33000")
	t.Setenv("GITEA_PUBLIC_BASE_URL", "https://zgsmtest.xyz:30443")

	internal := "http://10.20.19.101:33000/t-aaa/wf-bbb/pulls/7"
	sub := db.MulticaWorkflowNodeDeliverableSubmission{PullRequestUrl: internal}
	got := workflowNodeDeliverableSubmissionToResponse(sub)
	want := "https://zgsmtest.xyz:30443/t-aaa/wf-bbb/pulls/7"
	if got.PullRequestURL != want {
		t.Errorf("PullRequestURL = %q, want %q", got.PullRequestURL, want)
	}

	// External code MRs (non-Gitea) pass through unchanged.
	mr := db.MulticaWorkflowNodeDeliverableSubmission{PullRequestUrl: "https://gitlab.example.com/g/p/-/merge_requests/3"}
	if got := workflowNodeDeliverableSubmissionToResponse(mr); got.PullRequestURL != mr.PullRequestUrl {
		t.Errorf("external MR URL should pass through; got %q", got.PullRequestURL)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && go test ./internal/handler/ -run TestWorkflowNodeDeliverableSubmissionToResponse_RewritesGiteaHost`
Expected: FAIL (response still returns the raw internal URL).

- [ ] **Step 3: Apply the rewrite in the response assembler**

In `server/internal/handler/workflow_run.go`, change the `PullRequestURL` line inside `workflowNodeDeliverableSubmissionToResponse`:

```go
		PullRequestURL:    service.RewriteGiteaHostToPublic(s.PullRequestUrl),
```

(The handler package already imports `service` — it uses `*service.WorkflowService`. Confirm `server/internal/service` is in the import block; add it if missing.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && go test ./internal/handler/ -run TestWorkflowNodeDeliverableSubmissionToResponse_RewritesGiteaHost`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/handler/workflow_run.go server/internal/handler/workflow_run_deliverable_test.go
git commit -m "feat(deliverable): rewrite PR URL to public Gitea host in submission response"
```

---

## Task 3: `ArchiveNodeCodeLinks` shared service method

**Files:**
- Modify: `server/internal/service/workflow_deliverable_repo.go` (add helper + method; place near `ArchiveCodeDeliverable` ~line 658)
- Test: `server/internal/service/workflow_deliverable_repo_test.go` (extend `spyRepoProvider` to record `OpenReviewRequest`)

- [ ] **Step 1: Add the `isArchiveGiteaURL` helper**

In `server/internal/service/workflow_deliverable_repo.go`, add (near the other archive helpers):

```go
// isArchiveGiteaURL reports whether rawURL points at the internal archive
// Gitea (scheme+host exact-match GITEA_BASE_URL). Used to tell a Gitea doc-PR
// submission apart from an external code-MR submission when rebuilding the
// node's code-links archive. Returns false when GITEA_BASE_URL is unset.
func isArchiveGiteaURL(rawURL string) bool {
	rawURL = strings.TrimSpace(rawURL)
	internalBase := strings.TrimSpace(os.Getenv("GITEA_BASE_URL"))
	if rawURL == "" || internalBase == "" {
		return false
	}
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return false
	}
	in, err := url.Parse(internalBase)
	if err != nil || in.Scheme == "" || in.Host == "" {
		return false
	}
	return u.Scheme == in.Scheme && u.Host == in.Host
}
```

(Confirm `net/url` is imported in this file — it is used elsewhere; if not, add it.)

- [ ] **Step 2: Add `ArchiveNodeCodeLinks`**

Add the constant + method:

```go
// codeLinksArchiveFile is the single file under a node-run's NodeDir that lists
// every external code-MR link submitted against that node-run. CJK is safe in
// in-repo paths (git stores bytes, Gitea renders UTF-8).
const codeLinksArchiveFile = "代码合并请求.md"

// ArchiveNodeCodeLinks rebuilds the node-run's code-MR-links archive file on
// the node branch (NodeBranch) and (re)opens the node PR (NodeBranch → inst).
// It collects every submission on the node-run whose pull_request_url is an
// EXTERNAL code MR (not the archive Gitea) — human- and agent-submitted links
// accumulate in one .md under one node PR (reused across submissions).
//
// Best-effort + fire-and-forget (callers run it in a goroutine): dormant when
// the repository provider is not configured; errors are logged, never
// returned. Idempotent: the .md is fully rebuilt from current submissions, and
// OpenReviewRequest reuses an existing open PR. The node PR URL is NOT stored
// on any submission — the archive is the deliverable's 合并请求; the displayed
// link stays the real code MR so users can merge it themselves.
func (s *WorkflowService) ArchiveNodeCodeLinks(ctx context.Context, nodeRunID pgtype.UUID) {
	repoProvider := s.deliverableRepository()
	if !repoProvider.Configured() {
		return
	}
	nodeRun, err := s.Queries.GetWorkflowNodeRun(ctx, nodeRunID)
	if err != nil {
		slog.Warn("archive node code links: get node run", "node_run_id", util.UUIDToString(nodeRunID), "error", err)
		return
	}
	run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		slog.Warn("archive node code links: get run", "error", err)
		return
	}
	workflow, err := s.workflowFromRunSnapshot(ctx, run)
	if err != nil {
		slog.Warn("archive node code links: get snapshot", "error", err)
		return
	}
	submissions, err := s.Queries.ListNodeRunDeliverableSubmissions(ctx, nodeRun.ID)
	if err != nil {
		slog.Warn("archive node code links: list submissions", "error", err)
		return
	}
	var links []string
	for _, sub := range submissions {
		if sub.Status == "missing" || sub.Status == "rejected" {
			continue
		}
		if sub.PullRequestUrl == "" || isArchiveGiteaURL(sub.PullRequestUrl) {
			continue
		}
		links = append(links, sub.PullRequestUrl)
	}
	if len(links) == 0 {
		return
	}

	topo, err := NodeTopoOrder(ctx, s.Queries, run.WorkflowID)
	if err != nil {
		slog.Warn("archive node code links: node topo order", "error", err)
		return
	}
	nodeSeq := topo[util.UUIDToString(nodeRun.WorkflowNodeID)]
	owner := gitea.OrgName(util.UUIDToString(run.WorkspaceID))
	repo := DeliverableRepoNameForWorkflow(workflow)
	inst := gitea.InstBranch(util.UUIDToString(run.ID))
	nodeBranch := gitea.NodeBranch(nodeSeq, util.UUIDToString(nodeRun.ID))
	filePath := gitea.NodeDir(nodeSeq, nodeRun.NodeTitle, util.UUIDToString(nodeRun.ID)) + "/" + codeLinksArchiveFile

	var b strings.Builder
	fmt.Fprintf(&b, "---\nnode_run: %s\nlinks: %d\n---\n\n## 代码合并请求\n\n", util.UUIDToString(nodeRun.ID), len(links))
	for _, l := range links {
		fmt.Fprintf(&b, "- %s\n", l)
	}
	if err := repoProvider.UpsertFile(ctx, owner, repo, nodeBranch, filePath, b.String(), "archive code MR links"); err != nil {
		slog.Warn("archive node code links: write file", "node_run_id", util.UUIDToString(nodeRun.ID), "path", filePath, "error", err)
		return
	}
	// Best-effort: ensure NodeBranch exists (ensureNodeRunBranch usually created
	// it at node entry) then (re)open the node PR. CreateBranch is tolerant of
	// an existing branch; OpenReviewRequest reuses an existing open PR.
	_ = repoProvider.CreateBranch(ctx, owner, repo, nodeBranch, inst)
	if _, err := repoProvider.OpenReviewRequest(ctx, owner, repo, nodeBranch, inst, "node code MR links"); err != nil {
		slog.Warn("archive node code links: open review request", "node_run_id", util.UUIDToString(nodeRun.ID), "error", err)
		return
	}
	slog.Info("archived node code links", "node_run_id", util.UUIDToString(nodeRun.ID), "links", len(links), "path", filePath)
}
```

- [ ] **Step 3: Extend `spyRepoProvider` to record `OpenReviewRequest`**

In `server/internal/service/workflow_deliverable_repo_test.go`, the `spyRepoProvider` (~line 829) records `upserts` and `branches`. Add `openReviews`:

```go
type spyOpenReviewCall struct{ Owner, Repo, Head, Base, Title string }
```

Add a field `openReviews []spyOpenReviewCall` to `spyRepoProvider`, and replace its `OpenReviewRequest`:

```go
func (s *spyRepoProvider) OpenReviewRequest(ctx context.Context, owner, repo, head, base, title string) (string, error) {
	s.mu.Lock()
	s.openReviews = append(s.openReviews, spyOpenReviewCall{owner, repo, head, base, title})
	s.mu.Unlock()
	return "https://gitea.test/" + repo + "/pulls/1", nil
}
```

Add an accessor `openReviewCalls()` mirroring `branchCalls()`.

- [ ] **Step 4: Write the failing test**

Append to `server/internal/service/workflow_deliverable_repo_test.go` (uses the existing `seedGiteaFixture` + `openTestPool` pattern; follow the shape of the `ensureNodeRunBranch` test at ~line 690):

```go
func TestArchiveNodeCodeLinks_WritesNodeBranchMDAndOpensNodePR(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	queries := db.New(pool)
	fix := seedGiteaFixture(t, pool, false, 1)

	tnSrv, _ := newTeamNamespaceTestServer(t)
	defer tnSrv.Close()
	spy := &spyRepoProvider{configured: true}
	svc := &WorkflowService{
		Queries:            queries,
		TeamNamespace:      teamnamespace.NewClient(teamnamespace.Config{BaseURL: tnSrv.URL, Token: "svc-token"}),
		RepositoryProvider: spy,
	}

	// Seed a node-run in worker phase + a code-MR link submission on it.
	nodeRun := seedRuntimeNodeRun(t, pool, fix) // helper used elsewhere in this file; status 'working'
	const mrURL = "https://gitlab.example.com/g/p/-/merge_requests/42"
	seedSubmission(t, pool, nodeRun.ID, fix, mrURL) // helper: inserts a pull_request_url submission row

	svc.ArchiveNodeCodeLinks(context.Background(), nodeRun.ID)

	upserts := spy.snapshot()
	if len(upserts) != 1 {
		t.Fatalf("expected 1 UpsertFile, got %d: %+v", len(upserts), upserts)
	}
	if !strings.HasSuffix(upserts[0].Path, "/"+codeLinksArchiveFile) {
		t.Errorf("Path = %q, want suffix %q", upserts[0].Path, "/"+codeLinksArchiveFile)
	}
	if !strings.Contains(upserts[0].Content, mrURL) {
		t.Errorf("content missing MR URL %q: %q", mrURL, upserts[0].Content)
	}
	// Must be written to the node branch (NodeBranch), not inst and not a per-link branch.
	wantBranch := gitea.NodeBranch(nodeTopoSeq(t, queries, fix, nodeRun), util.UUIDToString(nodeRun.ID))
	if upserts[0].Branch != wantBranch {
		t.Errorf("Branch = %q, want node branch %q", upserts[0].Branch, wantBranch)
	}
	opens := spy.openReviewCalls()
	if len(opens) != 1 || opens[0].Head != wantBranch || opens[0].Base != gitea.InstBranch(util.UUIDToString(fix.run1)) {
		t.Errorf("expected one OpenReviewRequest(nodeBranch → inst), got %+v", opens)
	}
}
```

> NOTE: `seedRuntimeNodeRun`, `seedSubmission`, `nodeTopoSeq` — if these exact helpers do not exist in the test file, adapt by inlining the raw SQL used in `seedGiteaFixture` / `seedDeliverableAndNodeRunIn` (insert `multica_workflow_node_run` with status `'working'`, then a `multica_workflow_node_deliverable_submission` row with `pull_request_url = $mrURL`, `status = 'submitted'`). Compute the node topo seq via `RunNodeTopoOrder(ctx, queries, fix.run1)`.

- [ ] **Step 5: Run the test to verify it passes**

Run (DB-backed, via the golang container or local `DATABASE_URL=...multica_test`):
```
cd server && go test ./internal/service/ -run TestArchiveNodeCodeLinks_WritesNodeBranchMDAndOpensNodePR
```
Expected: PASS. If the DB is unreachable, the test self-skips — run via the container recipe to exercise it for real.

- [ ] **Step 6: Build + commit**

```bash
cd server && go build ./internal/service/
git add server/internal/service/workflow_deliverable_repo.go server/internal/service/workflow_deliverable_repo_test.go
git commit -m "feat(deliverable): add ArchiveNodeCodeLinks to archive code MR links on node PR"
```

---

## Task 4: Trigger archive from the `/submit` handler (agent explicit path)

**Files:**
- Modify: `server/internal/handler/workflow_run.go:1184-1207` (the post-upsert archive block in `SubmitNodeRunDeliverable`)
- Test: `server/internal/handler/workflow_run_deliverable_test.go` (`TestSubmitNodeRunDeliverable_ArchivesGitLabMRPointer` ~line 286)

- [ ] **Step 1: Replace the archive block**

In `SubmitNodeRunDeliverable` (`server/internal/handler/workflow_run.go`), replace the entire block currently spanning the `if req.PullRequestURL != "" && h.WorkflowService != nil { ... }` (the `gitea.ParsePullRequestIndex` / `gitlab.ParseMergeRequestURL` branching that calls `ArchiveCodeDeliverable`) with:

```go
	// Archive the node's code-MR links into the node PR (best-effort, async —
	// never blocks the submission response). Rebuilds the .md from all code-link
	// submissions on this node-run. pull_request_url keeps the real MR URL.
	if req.PullRequestURL != "" && h.WorkflowService != nil {
		go h.WorkflowService.ArchiveNodeCodeLinks(context.Background(), nrUUID)
	}
```

(`nrUUID` is the parsed `nodeRunId` pgtype.UUID from the top of the handler.)

- [ ] **Step 2: Update the existing handler test**

In `server/internal/handler/workflow_run_deliverable_test.go`, rewrite `TestSubmitNodeRunDeliverable_ArchivesGitLabMRPointer` (~line 286) assertions. The setup (swap `WorkflowService` to use `handlerSpyRepoProvider`, seed node-run + deliverable, POST the MR URL) stays; change the assertions to:

```go
	calls := spy.waitForCall(t, 1, 3*time.Second)
	if len(calls) < 1 {
		t.Fatalf("expected ArchiveNodeCodeLinks to fire; spy recorded %d calls", len(calls))
	}
	got := calls[0]
	if !strings.HasSuffix(got.Path, "/代码合并请求.md") {
		t.Errorf("UpsertFile path = %q, want suffix /代码合并请求.md", got.Path)
	}
	if !strings.Contains(got.Content, mrURL) {
		t.Errorf("UpsertFile content missing MR URL %q; content=%q", mrURL, got.Content)
	}
```

Also update the sibling `TestSubmitNodeRunDeliverable_DoesNotArchiveGiteaPR` (~line 358): under the new model a Gitea PR URL still triggers `ArchiveNodeCodeLinks`, but the Gitea-PR submission is filtered out by `isArchiveGiteaURL`, so the spy records **zero UpsertFile calls**. Keep it asserting zero calls (it now exercises the "doc PR excluded" filter). Add a `t.Setenv("GITEA_BASE_URL", "https://gitea.example.com")` in that test so `isArchiveGiteaURL` recognizes the Gitea PR host and the filter actually excludes it.

- [ ] **Step 3: Run the handler tests**

Run: `cd server && go test ./internal/handler/ -run 'TestSubmitNodeRunDeliverable'`
Expected: PASS (DB-backed; via container if needed).

- [ ] **Step 4: Commit**

```bash
git add server/internal/handler/workflow_run.go server/internal/handler/workflow_run_deliverable_test.go
git commit -m "feat(deliverable): archive code MR links via node PR on /submit"
```

---

## Task 5: Refactor `UploadMemberDeliverablePR` (human path)

**Files:**
- Modify: `server/internal/service/workflow_deliverable_repo.go:1286-1371` (`UploadMemberDeliverablePR`)
- Test: `server/internal/service/workflow_deliverable_repo_test.go`

- [ ] **Step 1: Replace the method body**

Replace the whole `UploadMemberDeliverablePR` with the simplified form (store real links; archive async after commit):

```go
func (s *WorkflowService) UploadMemberDeliverablePR(ctx context.Context, issue db.MulticaIssue, pullRequestURLs []string, deliverableID, userID, summary string) error {
	if len(pullRequestURLs) == 0 {
		return errors.New("no pull request URLs to submit")
	}
	var uploadedNodeRunID pgtype.UUID
	err := s.runLockedMemberUpload(ctx, issue, func(q *db.Queries, run db.MulticaWorkflowRun, nodeRun db.MulticaWorkflowNodeRun) (db.MulticaWorkflowNodeRun, bool, error) {
		uploadedNodeRunID = nodeRun.ID
		deliverables, err := q.ListNodeRunDeliverableRequirements(ctx, nodeRun.ID)
		if err != nil {
			return db.MulticaWorkflowNodeRun{}, false, fmt.Errorf("list deliverables: %w", err)
		}
		deliverable, err := resolveUploadDeliverable(deliverables, deliverableID)
		if err != nil {
			return db.MulticaWorkflowNodeRun{}, false, err
		}
		// Store the real code-MR links as-is (no Gitea PR, no per-link branch).
		// The node PR archive is reconciled async after the commit below.
		submissions := make([]db.UpsertNodeRunDeliverableSubmissionParams, 0, len(pullRequestURLs))
		var firstLink string
		for _, link := range pullRequestURLs {
			if firstLink == "" {
				firstLink = link
			}
			submissions = append(submissions, db.UpsertNodeRunDeliverableSubmissionParams{
				WorkflowNodeRunID: nodeRun.ID,
				DeliverableID:     deliverable.ID,
				SubmittedByType:   "member",
				SubmittedByID:     util.MustParseUUID(userID),
				PullRequestUrl:    link,
			})
		}
		return recordMemberUploadAndAdvance(ctx, q, nodeRun, submissions, workerOutputForAdvance(firstLink, summary))
	})
	if err != nil {
		return err
	}
	// Best-effort: rebuild the node's code-links .md + node PR.
	if s.deliverableRepository().Configured() {
		go s.ArchiveNodeCodeLinks(context.Background(), uploadedNodeRunID)
	}
	slog.Info("member code deliverable uploaded",
		"issue_id", util.UUIDToString(issue.ID), "node_run_id", util.UUIDToString(uploadedNodeRunID), "links", len(pullRequestURLs))
	return nil
}
```

This removes the prior `repoProvider.Configured()` branch (per-link `CreateBranch`/`UpsertFile`/`OpenReviewRequest`) and the dormant fallback — both now unify on "store links, archive async". The helpers `linkArchiveHash` may become unused after this; if `go build`/lint flags it unused, leave it (exported-less package-level funcs are allowed unused) or remove it — confirm no other caller first.

- [ ] **Step 2: Adjust existing `UploadMemberDeliverablePR` tests**

Find tests in `workflow_deliverable_repo_test.go` that assert the old per-link branch / per-link PR / flat `.md` / Gitea-PR-overwrites-link behavior (grep for `UploadMemberDeliverablePR` and `link-` branch expectations). Update them to assert:
- the submission row's `pull_request_url` equals the **pasted link** (not a Gitea PR URL);
- the spy records a single `UpsertFile` to the node branch `代码合并请求.md` containing all pasted links (after `ArchiveNodeCodeLinks` runs — call it synchronously in the test or assert via the goroutine; simplest: call `svc.ArchiveNodeCodeLinks(ctx, nodeRunID)` explicitly in the test after upload, then assert the spy).

If a test relied on the old dormant branch returning a specific error or the configured branch opening N PRs, rewrite it to the new single-archive behavior.

- [ ] **Step 3: Build + run service tests**

```
cd server && go build ./internal/service/
cd server && go test ./internal/service/ -run UploadMemberDeliverablePR
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/internal/service/workflow_deliverable_repo.go server/internal/service/workflow_deliverable_repo_test.go
git commit -m "refactor(deliverable): UploadMemberDeliverablePR stores real links, archives to node PR"
```

---

## Task 6: Trigger archive from worker-output auto-submit (agent main path)

**Files:**
- Modify: `server/internal/service/workflow.go` (`SubmitWorkerOutput` ~line 1005, after the `runInTx` block)
- Test: `server/internal/service/workflow_test.go` (or nearest neighbour)

- [ ] **Step 1: Add the async trigger after the transaction**

In `SubmitWorkerOutput` (`server/internal/service/workflow.go`), immediately after the `s.runInTx(ctx, func(qtx *db.Queries) error { ... })` call returns `nil` (i.e. after the worker output is committed and the node advanced to `awaiting_critic`), add:

```go
	// Best-effort: if the worker output carried a code MR that was auto-filed by
	// autoSubmitSingleRequiredDeliverable, reconcile the node's code-links
	// archive (.md + node PR). Fire-and-forget; no-op when there are no links.
	if s.deliverableRepository().Configured() {
		go s.ArchiveNodeCodeLinks(context.Background(), nodeRunID)
	}
```

(Do not change `autoSubmitSingleRequiredDeliverable` itself — it still just upserts the real MR URL; the archive is triggered by this caller after commit.)

- [ ] **Step 2: Write a test**

Add a test that: seeds a node-run in `working` with a single required deliverable, calls `SubmitWorkerOutput` with a worker-output JSON containing a GitLab MR URL (so `autoSubmitSingleRequiredDeliverable` files it), with a `spyRepoProvider` wired on `svc`, then asserts the spy recorded an `UpsertFile` to the node-branch `代码合并请求.md` containing that MR URL. Mirror the `SubmitWorkerOutput` test setup already present in `workflow_test.go` (grep for `SubmitWorkerOutput`).

```go
// Assert shape (adapt to the existing SubmitWorkerOutput test helper):
spy := &spyRepoProvider{configured: true}
svc := &WorkflowService{Queries: queries, RepositoryProvider: spy, /* +TxStarter/onStatus deps as the existing test sets */}
// ... seed node-run (working, 1 required deliverable) ...
svc.SubmitWorkerOutput(ctx, nodeRunID, json.RawMessage(`{"pull_request_url":"https://gitlab.example.com/g/p/-/merge_requests/9"}`))
// allow goroutine:
upserts := spy.snapshot() // or a short poll loop
// assert one UpsertFile, path suffix /代码合并请求.md, content contains the MR URL
```

- [ ] **Step 3: Build + run**

```
cd server && go build ./internal/service/
cd server && go test ./internal/service/ -run SubmitWorkerOutput
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/internal/service/workflow.go server/internal/service/workflow_test.go
git commit -m "feat(deliverable): archive auto-submitted code MR to node PR after worker output"
```

---

## Task 7: Stop auto-merging code MRs

**Files:**
- Modify: `server/internal/service/workflow_deliverable_repo.go:913-932` (`mergeReviewURL`)
- Test: `server/internal/service/workflow_deliverable_repo_test.go`

- [ ] **Step 1: Make `mergeReviewURL` no-op on non-Gitea URLs**

Replace the GitLab-merge tail of `mergeReviewURL` so external code MRs are skipped:

```go
func (s *WorkflowService) mergeReviewURL(ctx context.Context, workspaceID pgtype.UUID, owner, repo, rawURL string) error {
	if index, err := gitea.ParsePullRequestIndex(rawURL); err == nil {
		if s.Gitea == nil || !s.Gitea.Configured() {
			return nil // Gitea dormant
		}
		return retryMergeDocPR(ctx, s.deliverableRepository(), owner, repo, index)
	}
	// Any non-Gitea URL (GitLab MR, GitHub PR, ...) is a code MR that the user
	// merges themselves — Multica does NOT auto-merge code MRs. Only the archive
	// Gitea doc-PR is merged above (sign-off).
	return nil
}
```

(`workspaceID` becomes unused in the body — that's fine, Go allows unused params. `retryGitlabMR` and `gitlabAccessToken` may lose their only caller; leave them in place — unused package-level funcs compile fine. If a linter later flags them, remove in a follow-up.)

- [ ] **Step 2: Write the test**

Append to `server/internal/service/workflow_deliverable_repo_test.go`:

```go
func TestMergeReviewURL_SkipsCodeMR(t *testing.T) {
	spy := &spyRepoProvider{configured: true}
	svc := &WorkflowService{Queries: db.New(openTestPool(t)), RepositoryProvider: spy,
		Gitea: gitea.NewClient(gitea.Config{BaseURL: "http://gitea.test", Token: "tok"})}
	// External code MR URL: must NOT merge (no error, no provider merge call).
	if err := svc.mergeReviewURL(context.Background(), pgtype.UUID{}, "t-x", "wf-y",
		"https://gitlab.example.com/g/p/-/merge_requests/5"); err != nil {
		t.Fatalf("mergeReviewURL(code MR) = %v, want nil (skip)", err)
	}
	// A Gitea doc-PR URL still dispatches to the provider (merge sign-off).
	giteaURL := "http://gitea.test/t-x/wf-y/pulls/3"
	_ = svc.mergeReviewURL(context.Background(), pgtype.UUID{}, "t-x", "wf-y", giteaURL)
	// (spy.OpenReviewRequest is the PR opener; merging is MergeReviewRequest on
	// the real client. The point of this test is the code-MR branch returns nil
	// without error — proving we no longer attempt to merge code MRs.)
}
```

> If the spy lacks a `MergeReviewRequest` recorder and the Gitea-URL assertion is awkward, keep only the first assertion (code MR returns nil) — that is the regression guard.

- [ ] **Step 3: Build + run**

```
cd server && go build ./internal/service/
cd server && go test ./internal/service/ -run TestMergeReviewURL_SkipsCodeMR
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/internal/service/workflow_deliverable_repo.go server/internal/service/workflow_deliverable_repo_test.go
git commit -m "feat(deliverable): stop auto-merging code MRs (user merges them)"
```

---

## Task 8: Full verification

- [ ] **Step 1: Vet + build the whole module**

```
cd server && go vet ./...
cd server && go build ./...
```
Expected: no errors.

- [ ] **Step 2: Run the full Go test suite (DB-backed via the golang container)**

Use the local DB-test recipe (memory: `local-db-test-via-golang-container`): run `go test ./...` from inside a `golang:1.26-alpine` container joined to `multica_default`, with `DATABASE_URL` pointing at the migrated `multica_test` DB. Confirm the targeted tests actually ran (not skipped).

Expected: all green, including:
- `TestRewriteGiteaHostToPublic*`
- `TestWorkflowNodeDeliverableSubmissionToResponse_RewritesGiteaHost`
- `TestArchiveNodeCodeLinks_WritesNodeBranchMDAndOpensNodePR`
- `TestSubmitNodeRunDeliverable_ArchivesGitLabMRPointer` / `_DoesNotArchiveGiteaPR`
- `UploadMemberDeliverablePR` tests
- `SubmitWorkerOutput` test
- `TestMergeReviewURL_SkipsCodeMR`

- [ ] **Step 3: Frontend typecheck (Req 1 touches the response but no TS types change — sanity)**

Run: `pnpm typecheck`
Expected: PASS (no type changes expected; the response field is unchanged, only its value is host-rewritten server-side).

- [ ] **Step 4: Final commit if any remaining edits**

```bash
git add -A
git commit -m "test(deliverable): full verification for URL rewrite + code-link archive"
```

---

## Notes for the executor

- **No DB migration.** This change is pure code (response rewrite + archive method + merge skip). `pull_request_url` column is unchanged.
- **Best-effort archiving.** `ArchiveNodeCodeLinks` is always called in a goroutine and logs failures; it must never block a submission or a worker-output advance.
- **`NodeBranch` is shared with document branches** (`<NodeBranch>-deliverable-<suffix>`). The code-links `.md` lives on `NodeBranch` itself; documents live on derivative branches — they don't collide.
- **`OpenReviewRequest` is find-or-create** (it tries `findOpenPR` before creating), so repeated archive calls reuse one node PR — satisfying "复用节点 PR, 不开新 PR".
- **Display vs archive.** `pull_request_url` keeps the real code-MR URL (users click → merge). The node PR is archive-only; its URL is not stored on submissions. Req 1's host rewrite therefore transforms document Gitea PRs; external code-MR URLs pass through unchanged (matches "仅 Gitea 交付仓 PR" scope).

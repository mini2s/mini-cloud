# 交付物类型统一（去 kind）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `document`/`pull_request` `kind` from node deliverables so a node treats every deliverable as a typeless PR-slot; submission method is decided by the actor (human: file-or-link; agent: any PR link), and review/merge/close dispatch by URL host instead of kind.

**Architecture:** Delete the `kind` column (migration 150, two tables), regenerate sqlc, then collapse every `kind` branch in multica service/handler/frontend and the cs-cloud payload contract. Per-deliverable upload targeting **already exists** (multi-link feature) — only the `kind` gate inside `resolveUploadDeliverable` is removed. cs-cloud reports every deliverable to one unified `/submit` endpoint. Multi-link (N submission rows per deliverable, migration 149) is orthogonal and unchanged.

**Base:** `feat/deliverable-kind-unification` off `origin/main` (HEAD `22115d9d5`, includes M1–M5 + multi-link). Line numbers below are against this base.

**Tech Stack:** Go (Chi, sqlc, pgx), PostgreSQL migrations, React + TanStack Query + Zustand, cs-cloud Go. Tests: `go test` (DB-backed via golang container per [[local-db-test-via-golang-container]]), Vitest (`packages/views`).

**Spec:** `docs/superpowers/specs/2026-07-30-deliverable-kind-unification-design.md`

---

## Phase 0 — Setup

### Task 0.1: Commit spec + plan

- [ ] **Step 1:** `git -C /e/Projects/multica add docs/superpowers/specs/2026-07-30-deliverable-kind-unification-design.md docs/superpowers/plans/2026-07-30-deliverable-kind-unification.md && git -C /e/Projects/multica commit -m "docs(deliverable): spec + plan for kind unification"`

---

## Phase 1 — Data model (drop `kind`)

### Task 1.1: Migration 150 — drop `kind` from both deliverable tables

**Files:** Create `server/migrations/150_deliverable_drop_kind.up.sql` + `.down.sql`

> Confirm 150 is free: `ls server/migrations | grep -oE '^[0-9]+' | sort -n | tail` (149 = multi-link, taken).

- [ ] **Step 1 — up:**
```sql
-- 150_deliverable_drop_kind.up.sql
-- Deliverables are typeless PR-slots; kind is gone.
ALTER TABLE multica_workflow_node_deliverable DROP COLUMN kind;
ALTER TABLE multica_workflow_node_run_deliverable DROP COLUMN kind;
```
- [ ] **Step 2 — down:**
```sql
-- 150_deliverable_drop_kind.down.sql
ALTER TABLE multica_workflow_node_run_deliverable ADD COLUMN kind TEXT;
ALTER TABLE multica_workflow_node_deliverable
    ADD COLUMN kind TEXT NOT NULL DEFAULT 'document' CHECK (kind IN ('document', 'pull_request'));
ALTER TABLE multica_workflow_node_deliverable ALTER COLUMN kind DROP DEFAULT;
```
- [ ] **Step 3 — verify apply/rollback:** `cd server && go run ./cmd/migrate up && go run ./cmd/migrate down && go run ./cmd/migrate up` (kind gone → restored → gone).
- [ ] **Step 4 — commit:** `feat(db): drop deliverable kind column (migration 150)`

### Task 1.2: sqlc — remove `kind` from queries

**Files:** `server/pkg/db/queries/workflow_deliverable.sql`

- [ ] **Step 1 — rename + drop predicate:** `WorkflowHasDocumentDeliverable` →
```sql
-- name: WorkflowHasDeliverable :one
SELECT EXISTS (SELECT 1 FROM multica_workflow_node_deliverable WHERE workflow_node_id = $1) AS has;
```
- [ ] **Step 2 — strip `kind`** from `CreateWorkflowNodeDeliverable` (col list + values) and `UpdateWorkflowNodeDeliverable` (the `kind = COALESCE(sqlc.narg('kind'), kind)` line + param). Grep: `git grep -n kind server/pkg/db/queries/workflow_deliverable.sql`.
- [ ] **Step 3 — regen:** `make sqlc`. Expect `MulticaWorkflowNodeDeliverable` / `MulticaWorkflowNodeRunDeliverable` to lose `Kind`; `CreateWorkflowNodeDeliverableParams` loses `Kind`; `UpdateWorkflowNodeDeliverableParams` loses `Kind`.
- [ ] **Step 4 — commit:** `refactor(db): remove kind from deliverable sqlc queries`

### Task 1.3: Make it compile (transient)

- [ ] **Step 1 — `cd server && go build ./... 2>&1 | grep -i kind`**; for each error delete the `.Kind` read/assign (Phase 2–4 rewrites these properly). Goal: builds.
- [ ] **Step 2 — commit:** `wip(db): compile after kind column drop`

---

## Phase 2 — Service layer

### Task 2.1: `resolveUploadDeliverable` — drop the `kind` gate

**Files:** `server/internal/service/workflow_deliverable_repo.go` (`resolveUploadDeliverable:1210`, `UploadMemberDeliverable:1412`, `UploadMemberDeliverablePR:1304`); Test: `workflow_deliverable_repo_test.go`

- [ ] **Step 1 — failing test:**
```go
func TestResolveUploadDeliverable_KindAgnostic(t *testing.T) {
    // deliverables: [dA, dB] (no kind). resolveUploadDeliverable(ds, dA.ID) -> dA.
    // resolveUploadDeliverable(ds, <none>) with 2 deliverables -> error "specify deliverable_id".
    // resolveUploadDeliverable([single], <none>) -> that one.
}
```
Run: `cd server && go test ./internal/service -run TestResolveUploadDeliverable_KindAgnostic` → FAIL.
- [ ] **Step 2 — change signature:** drop the `kind string` param. If `deliverableID` valid → look up by ID (must belong to this node-run, else NotFound). Else: exactly one deliverable → return it; >1 → error `multiple deliverables, specify deliverable_id`; 0 → NotFound.
- [ ] **Step 3 — update callers:** `UploadMemberDeliverable` (drop `"document"`) and `UploadMemberDeliverablePR` (drop `"pull_request"`).
- [ ] **Step 4 — PASS; commit:** `refactor(deliverable): resolveUploadDeliverable is kind-agnostic`

### Task 2.2: Remove `kind` branches in branch/merge/approve

**Files:** `workflow_deliverable_repo.go` — `ensureNodeRunBranch:404`, `mergeDeliverablePRs:869` (isPRBacked:890), `markDeliverableSubmissionsApproved:1078` (:1086); Test: `workflow_deliverable_repo_test.go`

- [ ] **Step 1 — failing test:** `TestDeliverableFlow_KindAgnostic` — a node-run whose deliverables have no kind still: provisions a node branch; merges every submission with a non-empty `pull_request_url`; approves every live PR-backed submission.
- [ ] **Step 2 — edits:**
  - `ensureNodeRunBranch`: delete `if d.Kind == "document" { hasDocument = true }`; branch-worthy when the node has any deliverable.
  - `mergeDeliverablePRs` / `isPRBacked`: replace `d.Kind == "document" || d.Kind == "pull_request"` with "submission has non-empty `PullRequestUrl`".
  - `markDeliverableSubmissionsApproved`: same replacement.
- [ ] **Step 3 — PASS; commit:** `refactor(deliverable): drop kind in branch/merge/approve`

### Task 2.3: `closeDeliverableReviewRequests` keyed on URL host

**Files:** `workflow_deliverable_repo.go:994` (kind check at `:1019`); Test: `workflow_deliverable_repo_test.go`

- [ ] **Step 1 — failing test:** `TestCloseDeliverableReviewRequests_ByURLHost` — rejected node-run with two submissions: Gitea-host URL → `ClosePR` called; GitLab-host URL → NOT called (worker revises in place). Assert fake gitea `ClosePR` invoked exactly once.
- [ ] **Step 2 — edit:** replace the `isDocument` map / `if d.Kind == "document"` with per-submission URL dispatch: `gitea.ParsePullRequestIndex(url)` ok → close; else (GitLab MR per `gitlab.ParseMergeRequestURL` / host match) → skip. Same shape as `mergeReviewURL`.
- [ ] **Step 3 — PASS; commit:** `refactor(deliverable): close-on-reject keyed on URL host`

### Task 2.4: `ArchiveCodeDeliverable` guard keyed on URL host

**Files:** `workflow_deliverable_repo.go:665` + call site in `SubmitNodeRunDeliverable` (handler, `:1217-1230`); Test: `workflow_deliverable_repo_test.go`

- [ ] **Step 1 — failing test:** `TestArchiveCodeDeliverable_OnlyForCodeRepoURL` — GitLab MR URL submission → archive written to `nodes/<worker>/code/<id>.md`; Gitea PR URL → archive NOT called.
- [ ] **Step 2 — edit:** replace `d.Kind == "pull_request"` guard with "submitted URL resolves to a GitLab MR" (host check). `ArchiveCodeDeliverable` stops reading `Kind`.
- [ ] **Step 3 — PASS; commit:** `refactor(deliverable): archive-code guard keyed on URL host`

### Task 2.5: Widen `autoSubmitSinglePullRequestDeliverable`

**Files:** `server/internal/service/workflow.go:1110` (filter at `:1122`); Test: `workflow_test.go`

- [ ] **Step 1 — failing test:** `TestAutoSubmit_AnySingleRequiredDeliverable` — worker output with a GitLab MR URL + ONE required deliverable (no kind) → submission auto-created; TWO deliverables → no auto-submit (ambiguity preserved).
- [ ] **Step 2 — edit:** delete `d.Kind != "pull_request"` from the filter; keep `!d.Required` + the exactly-one-candidate guard.
- [ ] **Step 3 — PASS; commit:** `refactor(deliverable): auto-submit any single required deliverable`

### Task 2.6: Default-workflow seed drops `Kind`

**Files:** `server/internal/service/workflow.go:488-497`

- [ ] **Step 1 — edit:** remove `Kind: "document"` from the seeded `CreateWorkflowNodeDeliverable` params (param struct no longer has `Kind` after 1.2).
- [ ] **Step 2 — `go test ./internal/service -run TestEnsureDefaultWorkflow -v`; commit:** `refactor(deliverable): default-workflow seed has no kind`

### Task 2.7: Preflight drops `validKind`

**Files:** `server/internal/service/workflow_preflight.go:208` (`validateSnapshotDeliverables`)

- [ ] **Step 1 — edit:** delete the `validKind` check + the `deliverable_invalid` it raises. Update preflight tests that asserted invalid-kind rejection.
- [ ] **Step 2 — `go test ./internal/service -run TestPreflight -v`; commit:** `refactor(deliverable): drop kind validation in preflight`

---

## Phase 3 — cs-cloud payload

### Task 3.1: `task_cscloud_push.go` — unify report endpoint, drop kind

**Files:** `server/internal/service/task_cscloud_push.go` — `csCloudDeliverableSpec:56`, `deliverableSpecsForTask:638` (switch `:657`), `repositoryDeliverableEnv:790` (guard `:817`); Test: `task_cscloud_push_test.go`

- [ ] **Step 1 — failing test:** `TestDeliverableSpecsForTask_UnifiedEndpoint` — every spec: `Report.Endpoint == "/api/node-runs/<nr>/deliverables/<d>/submit"`, `BodyField == "pull_request_url"`, no kind-based `RepoAlias` split; and `repositoryDeliverableEnv` injects `CS_CLOUD_REPO_*`/`CS_CLOUD_GITEA_*` whenever the task has ANY deliverable.
- [ ] **Step 2 — `deliverableSpecsForTask`:** delete the `switch d.Kind`; all deliverables get the `/submit` endpoint + `pull_request_url` body field. Drop the `spec.RepoAlias = "delivery"` document special-case.
- [ ] **Step 3 — `csCloudDeliverableSpec`:** remove `Kind` field.
- [ ] **Step 4 — `repositoryDeliverableEnv`:** delete `if d.Kind != "document" { continue }`; inject when `hasAnyDeliverableSpec(...)`.
- [ ] **Step 5 — PASS; commit:** `refactor(csc): unify deliverable report endpoint, drop kind`

---

## Phase 4 — Handlers

### Task 4.1: `SubmitNodeRunDeliverable` + response mapper

**Files:** `server/internal/handler/workflow_run.go` — `deliverableKind:1088`, `SubmitNodeRunDeliverable:1149` (kind-reject `:1180-1186`, archive guard `:1217-1230`), `workflowNodeRunDeliverableToResponse:1101`

- [ ] **Step 1 — edits:** delete `deliverableKind` helper + its call; delete the `kind == "document"` reject-content branch (submit endpoint now only accepts `pull_request_url`); change the archive guard to the URL-host check from Task 2.4; drop `Kind` from `workflowNodeRunDeliverableToResponse` and `WorkflowNodeDeliverableSubmissionResponse`.
- [ ] **Step 2 — `go test ./internal/handler -run 'TestSubmitNodeRunDeliverable|TestListNodeRunDeliverable' -v`; commit:** `refactor(handler): submit endpoint + response kind-agnostic`

### Task 4.2: Drop `/report-pr` + Gitea-context kind filters

**Files:** `server/internal/handler/report_pr.go` (`HandleReportDeliverablePR` + route), `daemon.go:1827` (`giteaContextForNodeRun`, filter `:1852`), `issue_gitea_deliverables.go:157` (filter `:194`)

- [ ] **Step 1 — edits:** remove the `POST /api/daemon/node-runs/{nr}/deliverables/{d}/report-pr` route + handler (cs-cloud now reports via `/submit`). Delete `if d.Kind != "document" { continue }` in both Gitea-context builders — build context for every deliverable.
- [ ] **Step 2 — `go test ./internal/handler -run 'TestGitea|TestReport' -v`; commit:** `refactor(handler): drop report-pr route, gitea context covers all deliverables`

### Task 4.3: Deliverable CRUD — drop `kind`

**Files:** `server/internal/handler/workflow.go` — `CreateWorkflowNodeDeliverableRequest:80`, `UpdateWorkflowNodeDeliverableRequest:88`, `WorkflowNodeDeliverableResponse:146`, `CreateWorkflowNodeDeliverable:1307` (default `:1320`)

- [ ] **Step 1 — edits:** remove `Kind` from the request/response DTOs; delete the `req.Kind = "document"` default; drop `Kind` from the create/update handler calls.
- [ ] **Step 2 — `go test ./internal/handler -run TestCreateWorkflowNode -v`; commit:** `refactor(handler): deliverable CRUD without kind`

---

## Phase 5 — Frontend

### Task 5.1: Types — drop `WorkflowDeliverableKind`

**Files:** `packages/core/types/workflow.ts` (`:757` union, `:760-770` `WorkflowNodeDeliverable.kind`)

- [ ] **Step 1 — remove** the union + the `kind` field. `pnpm typecheck` (expect errors in 5.3/5.4 sites — fix there). Commit: `refactor(types): remove WorkflowDeliverableKind`

### Task 5.2: API client + schemas — drop `kind`

**Files:** `packages/core/api/client.ts` (`createWorkflowNodeDeliverable:2711`, `updateWorkflowNodeDeliverable`), `packages/core/api/schemas.ts` (`WorkflowNodeDeliverableSchema:1464`)

- [ ] **Step 1 — remove** `kind` from create/update call bodies + the zod schema (`kind: z.string().default("document")`). Commit: `refactor(api): deliverable create/update without kind`

### Task 5.3: `node-run-deliverables.tsx` — single section

**Files:** `packages/views/workflows/components/node-run-deliverables.tsx`; Test: `node-run-deliverables.test.tsx`

- [ ] **Step 1 — failing test:** renders ONE "交付物" section; each deliverable slot offers both upload-file + paste-link actions (regardless of kind); hides actions when `!canUpload`.
- [ ] **Step 2 — rewrite:** drop `kindById`/`documentDeliverables`/`pullRequestDeliverables`/`docLinks`/`codeLinks`; iterate `deliverables` once. For each: show its submissions' PR links (group by `deliverable_id`) +, when `canUpload`, render `<DocumentUpload deliverableId={d.id}>` and `<PRLinkUpload deliverableId={d.id}>`. (`DocumentUpload`/`PRLinkUpload` already accept `deliverableId`.)
- [ ] **Step 3 — PASS; commit:** `feat(views): unified deliverables section (node-run)`

### Task 5.4: `node-run-delivery-form.tsx` — single deliverable selector

**Files:** `packages/views/issues/components/execution/node-run-delivery-form.tsx`; Test: `execution-detail-panel.test.tsx`

- [ ] **Step 1 — failing test:** the human delivery form shows ONE list of deliverables (no doc/code split); when multiple, a single selector picks the target; both file-upload and link-paste are available for the selected deliverable.
- [ ] **Step 2 — rewrite:** drop `documentDeliverables`/`pullRequestDeliverables`/`selectedDocumentID`/`selectedPullRequestID`/`linksOf(kind)`; use one `deliverables` list + one `selectedDeliverableID`. The single `submitMutation` routes staged files → `uploadIssueDeliverable(issueId, files, note, selectedDeliverableID)` and links → `uploadIssueDeliverablePR(issueId, links, note, selectedDeliverableID)`.
- [ ] **Step 3 — PASS; commit:** `feat(views): unified deliverable delivery form`

### Task 5.5: i18n keys

**Files:** `packages/views/locales/{en,zh-Hans}/{issues,workflows}.json`

- [ ] **Step 1 — replace** `document_section` + `code_section` (and any doc/code-specific copy) with a single `deliverables_section` key (`交付物` / `Deliverables`). Remove dead keys. Commit: `refactor(i18n): single deliverables section key`

---

## Phase 6 — cs-cloud repo

> Separate stream once multica's unified `/submit` contract (Phase 3) is settled.

### Task 6.1: Drop `DeliverableSpec.Kind`

**Files:** `e:/Projects/cs-cloud/internal/workflow/models.go`

- [ ] **Step 1 — remove** the field; `go build ./...`; fix readers (only `deliverableSummary`). Commit: `refactor(csc): drop DeliverableSpec.Kind`

### Task 6.2: Document submit reports via unified `/submit`

**Files:** `e:/Projects/cs-cloud/internal/cli/gitea.go` (`reportDeliverablePR`/`submitDeliverable`)

- [ ] **Step 1 — change report target** to `POST /api/node-runs/{nr}/deliverables/{d}/submit` with `{ "pull_request_url": <giteaPRURL> }` (same runtime identity the code path uses). httptest asserts path + body. Commit: `refactor(csc): document submit reports via /submit`

### Task 6.3: `deliverableSummary` drops kind

**Files:** `e:/Projects/cs-cloud/internal/workflowrunner/redact.go`

- [ ] **Step 1 — edit** to `id(repo=<alias>)` without kind. Commit: `refactor(csc): deliverableSummary without kind`

---

## Phase 7 — Verify

### Task 7.1: Full checks + zero `kind` references

- [ ] **Step 1 — multica:** `cd server && go vet ./... && go build ./...` then DB-backed `make test`; `pnpm typecheck && pnpm --filter @multica/views test`.
- [ ] **Step 2 — cs-cloud:** `go vet ./... && go test ./...`.
- [ ] **Step 3 — confirm clean:**
```bash
git -C /e/Projects/multica grep -nE '\.Kind\b|"document"|"pull_request"|WorkflowDeliverableKind|deliverableKind' -- server/internal server/pkg packages | grep -iv testdata
git -C /e/Projects/cs-cloud grep -nE '\.Kind\b|DeliverableSpec.*Kind' -- internal
```
Expected: empty (ignore unrelated `kind` like node-phase autopilot `042`). Fix stragglers.

### Task 7.2: Cross-repo mock-device E2E

- [ ] **Step 1 — document task:** push → cs-cloud `gitea submit --file` opens Gitea PR → reports `/submit` → multica stores `pull_request_url`, node advances. Validates unified-endpoint auth (risk #4).
- [ ] **Step 2 — code task:** GitLab MR → `/submit` → stored + critic merges by URL host.
- [ ] **Step 3 — commit E2E fixes; note result in PR.**

---

## Self-Review (completed)

- **Spec coverage:** data model (1.1–1.3), uploads kind-gate removal (2.1), branch/merge/approve (2.2), close by host (2.3), archive guard (2.4), auto-submit (2.5), default seed (2.6), preflight (2.7), payload unify (3.1), handler cleanup (4.1–4.3), frontend two components + types/api/i18n (5.1–5.5), cs-cloud (6.1–6.3), verify (7.1–7.2). ✓
- **Placeholder scan:** none (migration 150 verified-free step; 1.3 explicitly transient). ✓
- **Type consistency:** `resolveUploadDeliverable(deliverables, deliverableID)` signature consistent in 2.1 test + callers; unified `/submit` path consistent across 3.1/4.2/6.2; frontend `selectedDeliverableID` consistent in 5.4; migration 150 referenced consistently. ✓
- **Re-based:** all line numbers from the post-multi-link origin/main re-map; per-deliverable upload targeting (already present) accounted for in 2.1. ✓

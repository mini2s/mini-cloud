# Workflow User Journey Gap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the highest-impact gaps between `docs/企业编程协作平台-用户旅程-工作流.md` and the current workflow implementation, starting with broken contracts and then adding deliverables, reviewer/executor task flow, notifications, and code-delivery foundations.

**Architecture:** Keep the current Go + sqlc backend and shared frontend package boundaries. Stabilize existing workflow run APIs first, then introduce first-class workflow deliverables and role mappings as additive domain models, with React Query as the server-state owner and workflow editor UI state staying in `packages/core/workflows`.

**Tech Stack:** Go, Chi, pgx/sqlc, PostgreSQL migrations, Next.js shared views, TanStack Query, Zustand, Vitest, Go tests, Playwright E2E where user flow coverage is needed.

---

## Scope And Delivery Strategy

This is a multi-subsystem change. Execute it as four independent milestones:

1. **Milestone A - Contract Stabilization:** Fix current broken API/UI contracts and incorrect node action mappings.
2. **Milestone B - Deliverables:** Add first-class deliverable definitions, submissions, and status rendering.
3. **Milestone C - Human Task And Review Loop:** Make human executor/reviewer work discoverable and actionable.
4. **Milestone D - Enterprise Extensions:** Add workflow notifications, role mapping, Plugin/Skill linkage, and code-delivery foundations.

Milestone A should ship before any schema-heavy work. Milestones B-D can be split into separate PRs.

## File Map

### Backend

- `server/migrations/129_workflow_deliverables.up.sql`
  Creates deliverable definition and submission tables.
- `server/migrations/129_workflow_deliverables.down.sql`
  Rolls back deliverable tables.
- `server/pkg/db/queries/workflow_deliverable.sql`
  sqlc queries for deliverables and submissions.
- `server/pkg/db/queries/workflow_node_run.sql`
  Adjust `ListMyWorkflowTasks` response support only if needed by generated rows.
- `server/internal/handler/workflow_run.go`
  Fix response fields, `ListMyWorkflowTasks`, node-run actions, deliverable submission endpoints.
- `server/internal/handler/workflow.go`
  Include deliverable definitions in workflow detail and node responses when needed.
- `server/internal/service/workflow.go`
  Add explicit retry/finalize behavior for failed/blocked node runs and connect deliverable status updates.
- `server/cmd/server/router.go`
  Register deliverable and retry endpoints.

### Frontend Core

- `packages/core/types/workflow.ts`
  Add deliverable types, submission types, corrected task response types.
- `packages/core/api/schemas.ts`
  Parse corrected workflow run, node run, task, deliverable response shapes.
- `packages/core/api/client.ts`
  Fix `getWorkflowRun`, `listMyWorkflowTasks`, add deliverable and retry calls.
- `packages/core/workflows/queries.ts`
  Add deliverable queries/mutations and correct invalidation.

### Frontend Views

- `packages/views/workflows/components/node-config-panel.tsx`
  Replace user-facing JSON schema area with deliverable requirement editor; keep `format_schema` collapsed as advanced/internal.
- `packages/views/issues/components/execution/runtime-node-card.tsx`
  Render deliverable traffic-light status from real data.
- `packages/views/issues/components/execution/artifact-list.tsx`
  Render deliverable submissions rather than raw worker/critic output only.
- `packages/views/issues/components/execution/execution-detail-panel.tsx`
  Show deliverable requirements, submitted artifacts, review state, retry/finalize actions.
- `packages/views/issues/components/execution/execution-panorama-page.tsx`
  Fix action mapping for submit/retry/complete and wire deliverable mutations.
- `packages/views/issues/components/pickers/assignee-picker.tsx`
  Keep runtime selection but expose clearer no-runtime failure and workflow activation validation.
- `packages/views/my-issues/components/my-issues-page.tsx`
  Add workflow node tasks tab or section after `myWorkflowTasksOptions` is fixed.
- `packages/views/locales/en/workflows.json`
- `packages/views/locales/zh-Hans/workflows.json`
- `packages/views/locales/en/issues.json`
- `packages/views/locales/zh-Hans/issues.json`
  Add UI copy.

### Tests

- `server/internal/handler/workflow_run_test.go`
  API contract tests for run and my-tasks responses.
- `server/internal/service/workflow_transitions_test.go`
  Retry/finalize transition tests.
- `server/internal/handler/workflow_deliverable_test.go`
  Deliverable definition/submission tests.
- `packages/core/api/schemas.test.ts`
  Drift-safe schema tests.
- `packages/core/workflows/queries.test.ts`
  Query select/invalidation tests where practical.
- `packages/views/issues/components/execution/runtime-node-card.test.tsx`
  Real deliverable status rendering tests.
- `packages/views/issues/components/execution/execution-panorama-page.test.tsx`
  Action mapping tests.
- `packages/views/workflows/components/node-config-panel.test.tsx`
  Deliverable editor tests.
- `e2e/workflow-execution/deliverables.spec.ts`
  End-to-end coverage for assign workflow, submit deliverable, review, and display status.

---

## Milestone A - Contract Stabilization

### Task 1: Fix `ListMyWorkflowTasks` Response Contract

**Files:**
- Modify: `server/internal/handler/workflow_run.go`
- Modify: `packages/core/types/workflow.ts`
- Modify: `packages/core/api/schemas.ts`
- Modify: `packages/core/workflows/queries.ts`
- Test: `server/internal/handler/workflow_run_test.go`
- Test: `packages/core/api/schemas.test.ts`

- [ ] **Step 1: Write backend contract test**

Add a Go handler test that calls `GET /api/my-tasks` and asserts the JSON field is `node_runs`.

```go
func TestListMyWorkflowTasksReturnsNodeRunsField(t *testing.T) {
	h, ctx := newTestHandler(t)
	userID, workspaceID := seedWorkflowHumanTask(t, ctx, h)

	req := newAuthenticatedRequest(t, "GET", "/api/my-tasks?workspace_id="+uuidToString(workspaceID), nil, userID)
	rr := httptest.NewRecorder()

	h.ListMyWorkflowTasks(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if _, ok := body["node_runs"]; !ok {
		t.Fatalf("expected node_runs field, got %s", rr.Body.String())
	}
	if _, ok := body["tasks"]; ok {
		t.Fatalf("did not expect legacy tasks field, got %s", rr.Body.String())
	}
}
```

- [ ] **Step 2: Run backend test and verify it fails**

Run:

```bash
cd server && go test ./internal/handler -run TestListMyWorkflowTasksReturnsNodeRunsField
```

Expected: fails because response currently uses `tasks`.

- [ ] **Step 3: Change backend response field**

In `ListMyWorkflowTasks`, change:

```go
writeJSON(w, http.StatusOK, map[string]any{"tasks": resp, "total": len(resp)})
```

to:

```go
writeJSON(w, http.StatusOK, map[string]any{"node_runs": resp, "total": len(resp)})
```

- [ ] **Step 4: Add schema drift test**

In `packages/core/api/schemas.test.ts`, add:

```ts
it("parses my workflow tasks from node_runs", () => {
  const parsed = MyWorkflowTasksResponseSchema.parse({
    node_runs: [{ id: "nr-1", workflow_run_id: "run-1", workflow_node_id: "n-1" }],
    total: 1,
  });

  expect(parsed.node_runs).toHaveLength(1);
  expect(parsed.total).toBe(1);
});

it("does not treat legacy tasks as node_runs", () => {
  const parsed = MyWorkflowTasksResponseSchema.parse({
    tasks: [{ id: "nr-1", workflow_run_id: "run-1", workflow_node_id: "n-1" }],
    total: 1,
  });

  expect(parsed.node_runs).toEqual([]);
});
```

- [ ] **Step 5: Run targeted tests**

Run:

```bash
cd server && go test ./internal/handler -run TestListMyWorkflowTasksReturnsNodeRunsField
pnpm --filter @multica/core exec vitest run api/schemas.test.ts
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add server/internal/handler/workflow_run.go server/internal/handler/workflow_run_test.go packages/core/api/schemas.ts packages/core/api/schemas.test.ts packages/core/types/workflow.ts packages/core/workflows/queries.ts
git commit -m "fix(workflows): align my workflow tasks response"
```

### Task 2: Fix `getWorkflowRun` Response Parsing

**Files:**
- Modify: `packages/core/types/workflow.ts`
- Modify: `packages/core/api/schemas.ts`
- Modify: `packages/core/api/client.ts`
- Test: `packages/core/api/schemas.test.ts`
- Test: `packages/core/api/client.test.ts`

- [ ] **Step 1: Add response type**

In `packages/core/types/workflow.ts`, add:

```ts
export interface WorkflowRunDetailResponse {
  run: WorkflowRun;
  node_runs: WorkflowNodeRun[];
}
```

- [ ] **Step 2: Add schema**

In `packages/core/api/schemas.ts`, add:

```ts
export const WorkflowRunDetailResponseSchema = z.object({
  run: WorkflowRunSchema,
  node_runs: z.array(WorkflowNodeRunSchema).default([]),
}).loose();

export const EMPTY_WORKFLOW_RUN_DETAIL_RESPONSE = {
  run: EMPTY_WORKFLOW_RUN,
  node_runs: [],
};
```

- [ ] **Step 3: Update client**

Change `getWorkflowRun` to return the actual wrapper:

```ts
async getWorkflowRun(workflowId: string, runId: string): Promise<WorkflowRunDetailResponse> {
  const raw = await this.fetch<unknown>(`/api/workflows/${workflowId}/runs/${runId}`);
  return parseWithFallback(raw, WorkflowRunDetailResponseSchema, EMPTY_WORKFLOW_RUN_DETAIL_RESPONSE, {
    endpoint: "GET /api/workflows/:id/runs/:runId",
  });
}
```

- [ ] **Step 4: Update call sites**

Find call sites:

```bash
rg -n "getWorkflowRun\\(|workflowRunOptions\\(" packages apps
```

For UI that only needs run, select `data.run`. For UI that needs node runs, prefer `workflowNodeRunsOptions` unless the wrapper already has the data.

- [ ] **Step 5: Add schema test**

```ts
it("parses workflow run detail wrapper", () => {
  const parsed = WorkflowRunDetailResponseSchema.parse({
    run: { id: "run-1", workflow_id: "wf-1", workspace_id: "ws-1" },
    node_runs: [{ id: "nr-1", workflow_run_id: "run-1", workflow_node_id: "node-1" }],
  });

  expect(parsed.run.id).toBe("run-1");
  expect(parsed.node_runs[0]?.id).toBe("nr-1");
});
```

- [ ] **Step 6: Run targeted tests**

```bash
pnpm --filter @multica/core exec vitest run api/schemas.test.ts api/client.test.ts
pnpm typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/types/workflow.ts packages/core/api/schemas.ts packages/core/api/schemas.test.ts packages/core/api/client.ts packages/core/api/client.test.ts
git commit -m "fix(workflows): parse workflow run detail response"
```

### Task 3: Expose Worker And Critic Task IDs On Node Runs

**Files:**
- Modify: `server/internal/handler/workflow_run.go`
- Modify: `packages/core/api/schemas.ts`
- Modify: `packages/core/types/workflow.ts`
- Test: `server/internal/handler/workflow_run_test.go`
- Test: `packages/core/api/schemas.test.ts`

- [ ] **Step 1: Add backend response fields**

In `WorkflowNodeRunResponse`, add:

```go
WorkerAgentTaskID *string `json:"worker_agent_task_id"`
CriticAgentTaskID *string `json:"critic_agent_task_id"`
```

In `workflowNodeRunToResponse`, set:

```go
WorkerAgentTaskID: uuidToPtr(nr.WorkerAgentTaskID),
CriticAgentTaskID: uuidToPtr(nr.CriticAgentTaskID),
```

- [ ] **Step 2: Add backend serialization test**

Add a test that inserts a node run with both task ids and verifies response JSON contains both fields:

```go
if got := string(body["worker_agent_task_id"]); !strings.Contains(got, workerTaskID) {
	t.Fatalf("worker_agent_task_id missing: %s", rr.Body.String())
}
if got := string(body["critic_agent_task_id"]); !strings.Contains(got, criticTaskID) {
	t.Fatalf("critic_agent_task_id missing: %s", rr.Body.String())
}
```

- [ ] **Step 3: Confirm frontend schema already accepts fields**

`WorkflowNodeRunSchema` already defines both fields. Keep the defaults:

```ts
worker_agent_task_id: z.string().nullable().default(null),
critic_agent_task_id: z.string().nullable().default(null),
```

- [ ] **Step 4: Run tests**

```bash
cd server && go test ./internal/handler -run 'Test.*Workflow.*NodeRun'
pnpm --filter @multica/core exec vitest run api/schemas.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add server/internal/handler/workflow_run.go server/internal/handler/workflow_run_test.go packages/core/api/schemas.ts packages/core/types/workflow.ts
git commit -m "fix(workflows): expose phase task ids on node runs"
```

### Task 4: Correct Execution Panorama Action Mapping

**Files:**
- Modify: `server/internal/handler/workflow_run.go`
- Modify: `server/internal/service/workflow.go`
- Modify: `server/cmd/server/router.go`
- Modify: `packages/core/api/client.ts`
- Modify: `packages/core/workflows/queries.ts`
- Modify: `packages/views/issues/components/execution/execution-panorama-page.tsx`
- Modify: `packages/views/issues/components/execution/runtime-node-card.tsx`
- Test: `server/internal/service/workflow_transitions_test.go`
- Test: `packages/views/issues/components/execution/execution-panorama-page.test.tsx`

- [ ] **Step 1: Add explicit retry endpoint**

Register:

```go
r.Post("/api/node-runs/{nodeRunId}/retry", h.RetryNodeRun)
```

Implement handler:

```go
func (h *Handler) RetryNodeRun(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	nodeRun, run, workspaceID, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	updated, err := h.WorkflowService.RetryNodeRun(r.Context(), nodeRun)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	resp := workflowNodeRunToResponse(*updated)
	h.publish(protocol.EventWorkflowNodeRunResumed, workspaceID, "member", userID, map[string]any{
		"node_run": resp,
		"run_id": uuidToString(run.ID),
	})
	writeJSON(w, http.StatusOK, resp)
}
```

- [ ] **Step 2: Add service retry behavior**

Add:

```go
func (s *WorkflowService) RetryNodeRun(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) (*db.MulticaWorkflowNodeRun, error) {
	switch nodeRun.Status {
	case NodeRunStatusFailed, NodeRunStatusBlocked, NodeRunStatusFormatFailed:
		updated, err := s.Queries.UpdateWorkflowNodeRunRework(ctx, db.UpdateWorkflowNodeRunReworkParams{
			ID: nodeRun.ID,
			Status: NodeRunStatusFormatOk,
		})
		if err != nil {
			return nil, fmt.Errorf("retry node run: %w", err)
		}
		if s.OnNodeStatusChanged != nil {
			s.OnNodeStatusChanged(ctx, updated)
		}
		if err := s.dispatchWorker(ctx, updated); err != nil {
			return nil, fmt.Errorf("dispatch retry worker: %w", err)
		}
		return &updated, nil
	default:
		return nil, fmt.Errorf("node run cannot be retried from status %s", nodeRun.Status)
	}
}
```

- [ ] **Step 3: Add frontend API and mutation**

In `client.ts`:

```ts
async retryNodeRun(nodeRunId: string): Promise<WorkflowNodeRun> {
  return this.fetch(`/api/node-runs/${nodeRunId}/retry`, { method: "POST" });
}
```

In `queries.ts`:

```ts
export function useRetryNodeRun(wsId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: NodeRunControlVars) => api.retryNodeRun(vars.nodeRunId),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.myTasks(wsId) });
      if (vars.workflowId && vars.runId) {
        queryClient.invalidateQueries({ queryKey: workflowKeys.nodeRuns(wsId, vars.workflowId, vars.runId) });
      }
    },
  });
}
```

- [ ] **Step 4: Fix action mapping**

In `ExecutionPanoramaPage`, use:

```ts
case "retry": {
  start("retry");
  retryMutation.mutate(
    { nodeRunId, workflowId, runId: runId ?? undefined },
    { onSettled: () => { end("retry"); invalidateNodeRuns(); } },
  );
  break;
}
case "complete": {
  start("complete");
  finalizeMutation.mutate(
    { nodeRunId, workflowId, runId: runId ?? undefined, approved: true },
    { onSettled: () => { end("complete"); invalidateNodeRuns(); } },
  );
  break;
}
```

For `submit`, keep mutation but block empty output until Milestone B:

```ts
submitMutation.mutate(
  { nodeRunId, output: { submitted_by: "human", submitted_at: new Date().toISOString() } },
  { onSettled: () => { end("submit"); invalidateNodeRuns(); } },
);
```

- [ ] **Step 5: Test action mapping**

In `execution-panorama-page.test.tsx`, click each button and assert the correct mocked mutation:

```ts
await user.click(screen.getByTestId("runtime-node-action-retry"));
expect(api.retryNodeRun).toHaveBeenCalledWith("node-run-blocked");

await user.click(screen.getByTestId("runtime-node-action-complete"));
expect(api.finalizeNodeRun).toHaveBeenCalledWith("node-run-blocked", true);
```

- [ ] **Step 6: Run tests**

```bash
cd server && go test ./internal/service ./internal/handler -run 'Test.*Retry|Test.*Finalize|Test.*Workflow'
pnpm --filter @multica/views exec vitest run issues/components/execution/execution-panorama-page.test.tsx
pnpm typecheck
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add server/internal/handler/workflow_run.go server/internal/service/workflow.go server/cmd/server/router.go packages/core/api/client.ts packages/core/workflows/queries.ts packages/views/issues/components/execution/execution-panorama-page.tsx packages/views/issues/components/execution/runtime-node-card.tsx
git commit -m "fix(workflows): correct node run action semantics"
```

---

## Milestone B - First-Class Deliverables

### Task 5: Add Workflow Deliverable Schema And Queries

**Files:**
- Create: `server/migrations/129_workflow_deliverables.up.sql`
- Create: `server/migrations/129_workflow_deliverables.down.sql`
- Create: `server/pkg/db/queries/workflow_deliverable.sql`
- Modify: `server/sqlc.yaml` only if query paths require explicit inclusion
- Test: `server/internal/handler/workflow_deliverable_test.go`

- [ ] **Step 1: Create migration**

```sql
CREATE TABLE multica_workflow_node_deliverable (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_node_id UUID NOT NULL REFERENCES multica_workflow_node(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('document', 'pull_request')),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    required BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflow_node_deliverable_node
    ON multica_workflow_node_deliverable(workflow_node_id, sort_order);

CREATE TABLE multica_workflow_node_deliverable_submission (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_node_run_id UUID NOT NULL REFERENCES multica_workflow_node_run(id) ON DELETE CASCADE,
    deliverable_id UUID NOT NULL REFERENCES multica_workflow_node_deliverable(id) ON DELETE CASCADE,
    submitted_by_type TEXT NOT NULL CHECK (submitted_by_type IN ('member', 'agent', 'system')),
    submitted_by_id UUID,
    status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('missing', 'submitted', 'approved', 'rejected')),
    content TEXT NOT NULL DEFAULT '',
    attachment_id UUID REFERENCES multica_attachment(id) ON DELETE SET NULL,
    pull_request_url TEXT NOT NULL DEFAULT '',
    review_comment TEXT NOT NULL DEFAULT '',
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(workflow_node_run_id, deliverable_id)
);

CREATE INDEX idx_workflow_node_deliverable_submission_run
    ON multica_workflow_node_deliverable_submission(workflow_node_run_id);
```

- [ ] **Step 2: Create down migration**

```sql
DROP TABLE IF EXISTS multica_workflow_node_deliverable_submission;
DROP TABLE IF EXISTS multica_workflow_node_deliverable;
```

- [ ] **Step 3: Add sqlc queries**

```sql
-- name: ListWorkflowNodeDeliverables :many
SELECT * FROM multica_workflow_node_deliverable
WHERE workflow_node_id = $1
ORDER BY sort_order ASC, created_at ASC;

-- name: CreateWorkflowNodeDeliverable :one
INSERT INTO multica_workflow_node_deliverable (
    workflow_node_id, kind, title, description, required, sort_order
) VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: UpdateWorkflowNodeDeliverable :one
UPDATE multica_workflow_node_deliverable SET
    kind = COALESCE(sqlc.narg('kind'), kind),
    title = COALESCE(sqlc.narg('title'), title),
    description = COALESCE(sqlc.narg('description'), description),
    required = COALESCE(sqlc.narg('required')::boolean, required),
    sort_order = COALESCE(sqlc.narg('sort_order')::int, sort_order),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteWorkflowNodeDeliverable :exec
DELETE FROM multica_workflow_node_deliverable WHERE id = $1;

-- name: ListNodeRunDeliverableSubmissions :many
SELECT * FROM multica_workflow_node_deliverable_submission
WHERE workflow_node_run_id = $1
ORDER BY created_at ASC;

-- name: UpsertNodeRunDeliverableSubmission :one
INSERT INTO multica_workflow_node_deliverable_submission (
    workflow_node_run_id, deliverable_id, submitted_by_type, submitted_by_id,
    status, content, attachment_id, pull_request_url
) VALUES ($1, $2, $3, sqlc.narg('submitted_by_id'), 'submitted', $4, sqlc.narg('attachment_id'), $5)
ON CONFLICT (workflow_node_run_id, deliverable_id)
DO UPDATE SET
    submitted_by_type = EXCLUDED.submitted_by_type,
    submitted_by_id = EXCLUDED.submitted_by_id,
    status = 'submitted',
    content = EXCLUDED.content,
    attachment_id = EXCLUDED.attachment_id,
    pull_request_url = EXCLUDED.pull_request_url,
    submitted_at = now(),
    updated_at = now()
RETURNING *;

-- name: ReviewNodeRunDeliverableSubmission :one
UPDATE multica_workflow_node_deliverable_submission SET
    status = $2,
    review_comment = $3,
    reviewed_at = now(),
    updated_at = now()
WHERE id = $1
RETURNING *;
```

- [ ] **Step 4: Generate sqlc**

```bash
make sqlc
```

Expected: generated files under `server/pkg/db/generated/` update without errors.

- [ ] **Step 5: Commit**

```bash
git add server/migrations/129_workflow_deliverables.up.sql server/migrations/129_workflow_deliverables.down.sql server/pkg/db/queries/workflow_deliverable.sql server/pkg/db/generated
git commit -m "feat(workflows): add deliverable persistence"
```

### Task 6: Add Deliverable API And Frontend Types

**Files:**
- Modify: `server/internal/handler/workflow.go`
- Modify: `server/internal/handler/workflow_run.go`
- Modify: `server/cmd/server/router.go`
- Modify: `packages/core/types/workflow.ts`
- Modify: `packages/core/api/schemas.ts`
- Modify: `packages/core/api/client.ts`
- Modify: `packages/core/workflows/queries.ts`
- Test: `server/internal/handler/workflow_deliverable_test.go`
- Test: `packages/core/api/schemas.test.ts`

- [ ] **Step 1: Add TS types**

```ts
export type WorkflowDeliverableKind = "document" | "pull_request";
export type WorkflowDeliverableSubmissionStatus = "missing" | "submitted" | "approved" | "rejected";

export interface WorkflowNodeDeliverable {
  id: string;
  workflow_node_id: string;
  kind: WorkflowDeliverableKind;
  title: string;
  description: string;
  required: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface WorkflowNodeDeliverableSubmission {
  id: string;
  workflow_node_run_id: string;
  deliverable_id: string;
  submitted_by_type: "member" | "agent" | "system";
  submitted_by_id: string | null;
  status: WorkflowDeliverableSubmissionStatus;
  content: string;
  attachment_id: string | null;
  pull_request_url: string;
  review_comment: string;
  submitted_at: string;
  reviewed_at: string | null;
}
```

- [ ] **Step 2: Add API routes**

Register:

```go
r.Get("/api/workflows/{id}/nodes/{nodeId}/deliverables", h.ListWorkflowNodeDeliverables)
r.Post("/api/workflows/{id}/nodes/{nodeId}/deliverables", h.CreateWorkflowNodeDeliverable)
r.Put("/api/workflows/{id}/nodes/{nodeId}/deliverables/{deliverableId}", h.UpdateWorkflowNodeDeliverable)
r.Delete("/api/workflows/{id}/nodes/{nodeId}/deliverables/{deliverableId}", h.DeleteWorkflowNodeDeliverable)
r.Get("/api/node-runs/{nodeRunId}/deliverables", h.ListNodeRunDeliverableSubmissions)
r.Post("/api/node-runs/{nodeRunId}/deliverables/{deliverableId}/submit", h.SubmitNodeRunDeliverable)
r.Post("/api/node-runs/{nodeRunId}/deliverables/{submissionId}/review", h.ReviewNodeRunDeliverable)
```

- [ ] **Step 3: Add frontend client methods**

```ts
async listWorkflowNodeDeliverables(workflowId: string, nodeId: string): Promise<WorkflowNodeDeliverable[]> {
  const raw = await this.fetch<unknown>(`/api/workflows/${workflowId}/nodes/${nodeId}/deliverables`);
  return parseWithFallback(raw, WorkflowNodeDeliverablesResponseSchema, { deliverables: [] }, {
    endpoint: "GET /api/workflows/:id/nodes/:nodeId/deliverables",
  }).deliverables;
}

async submitNodeRunDeliverable(nodeRunId: string, deliverableId: string, body: {
  content?: string;
  attachment_id?: string | null;
  pull_request_url?: string;
}): Promise<WorkflowNodeDeliverableSubmission> {
  return this.fetch(`/api/node-runs/${nodeRunId}/deliverables/${deliverableId}/submit`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
```

- [ ] **Step 4: Add tests and run**

```bash
cd server && go test ./internal/handler -run TestWorkflowDeliverable
pnpm --filter @multica/core exec vitest run api/schemas.test.ts
pnpm typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add server/internal/handler/workflow.go server/internal/handler/workflow_run.go server/cmd/server/router.go packages/core/types/workflow.ts packages/core/api/schemas.ts packages/core/api/client.ts packages/core/workflows/queries.ts
git commit -m "feat(workflows): expose deliverable APIs"
```

### Task 7: Build Deliverable Editor In Node Config

**Files:**
- Modify: `packages/views/workflows/components/node-config-panel.tsx`
- Create: `packages/views/workflows/components/node-deliverables-editor.tsx`
- Test: `packages/views/workflows/components/node-config-panel.test.tsx`
- Test: `packages/views/workflows/components/node-deliverables-editor.test.tsx`

- [ ] **Step 1: Create editor component**

The component accepts `workflowId`, `nodeId`, `disabled`, loads deliverables, and supports add/update/delete.

```tsx
export function NodeDeliverablesEditor({
  workflowId,
  nodeId,
  disabled,
}: {
  workflowId: string;
  nodeId: string;
  disabled?: boolean;
}) {
  const wsId = useWorkspaceId();
  const { data: deliverables = [] } = useQuery(workflowNodeDeliverablesOptions(wsId, workflowId, nodeId));
  const createDeliverable = useCreateWorkflowNodeDeliverable(wsId, workflowId, nodeId);

  return (
    <section className="space-y-2">
      <Label>Deliverables</Label>
      {deliverables.map((item) => (
        <DeliverableRow key={item.id} workflowId={workflowId} nodeId={nodeId} deliverable={item} disabled={disabled} />
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || createDeliverable.isPending}
        onClick={() => createDeliverable.mutate({
          kind: "document",
          title: "Document",
          description: "",
          required: true,
          sort_order: deliverables.length,
        })}
      >
        Add deliverable
      </Button>
    </section>
  );
}
```

- [ ] **Step 2: Replace prominent schema editor**

In `node-config-panel.tsx`, render:

```tsx
<NodeDeliverablesEditor
  workflowId={workflowId}
  nodeId={node.id}
  disabled={disabled}
/>
```

Move `format_schema` under a collapsed advanced section:

```tsx
<details className="rounded-md border p-3">
  <summary className="cursor-pointer text-sm text-muted-foreground">
    Advanced format schema
  </summary>
  <Textarea ... />
</details>
```

- [ ] **Step 3: Add view tests**

Test that the deliverables section appears and schema is not the primary visible section:

```tsx
expect(screen.getByText("Deliverables")).toBeInTheDocument();
expect(screen.getByText("Advanced format schema")).toBeInTheDocument();
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @multica/views exec vitest run workflows/components/node-config-panel.test.tsx workflows/components/node-deliverables-editor.test.tsx
pnpm typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/node-config-panel.tsx packages/views/workflows/components/node-deliverables-editor.tsx packages/views/workflows/components/*.test.tsx packages/views/locales/en/workflows.json packages/views/locales/zh-Hans/workflows.json
git commit -m "feat(workflows): configure node deliverables"
```

### Task 8: Render Deliverable Status In Execution Panorama

**Files:**
- Modify: `packages/views/issues/components/execution/runtime-node-card.tsx`
- Modify: `packages/views/issues/components/execution/artifact-list.tsx`
- Modify: `packages/views/issues/components/execution/execution-detail-panel.tsx`
- Modify: `packages/views/issues/components/execution/execution-panorama-page.tsx`
- Test: `packages/views/issues/components/execution/runtime-node-card.test.tsx`
- Test: `packages/views/issues/components/execution/artifact-list.test.tsx`

- [ ] **Step 1: Define status derivation**

Create helper in `runtime-node-card.tsx` or extracted file:

```ts
export function deriveDeliverableSignal(items: Array<{ required: boolean; status: string }>) {
  const required = items.filter((item) => item.required);
  if (required.length === 0) return "none";
  if (required.some((item) => item.status === "rejected")) return "red";
  if (required.some((item) => item.status === "missing")) return "red";
  if (required.some((item) => item.status === "submitted")) return "yellow";
  return "green";
}
```

- [ ] **Step 2: Render traffic light**

Use:

```tsx
<span
  aria-label={`Deliverables ${signal}`}
  className={cn(
    "h-2 w-2 rounded-full",
    signal === "green" && "bg-emerald-500",
    signal === "yellow" && "bg-amber-500",
    signal === "red" && "bg-red-500",
    signal === "none" && "bg-muted-foreground/30",
  )}
/>
```

- [ ] **Step 3: Show submission list**

`ArtifactList` should render each deliverable title, kind, status, content or PR URL.

```tsx
{items.map((item) => (
  <div key={item.deliverable.id} className="rounded border p-2">
    <div className="flex items-center justify-between">
      <span>{item.deliverable.title}</span>
      <Badge variant={item.submission?.status === "approved" ? "default" : "secondary"}>
        {item.submission?.status ?? "missing"}
      </Badge>
    </div>
    {item.submission?.pull_request_url && (
      <a href={item.submission.pull_request_url} target="_blank" rel="noreferrer">
        {item.submission.pull_request_url}
      </a>
    )}
  </div>
))}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @multica/views exec vitest run issues/components/execution/runtime-node-card.test.tsx issues/components/execution/artifact-list.test.tsx
pnpm typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/views/issues/components/execution/runtime-node-card.tsx packages/views/issues/components/execution/artifact-list.tsx packages/views/issues/components/execution/execution-detail-panel.tsx packages/views/issues/components/execution/execution-panorama-page.tsx packages/views/issues/components/execution/*.test.tsx
git commit -m "feat(workflows): show deliverable execution status"
```

---

## Milestone C - Human Task And Review Loop

### Task 9: Add Workflow Tasks Surface To My Issues

**Files:**
- Modify: `packages/views/my-issues/components/my-issues-page.tsx`
- Modify: `packages/core/workflows/queries.ts`
- Test: `packages/views/my-issues/components/my-issues-page.test.tsx`

- [ ] **Step 1: Render node tasks from `myWorkflowTasksOptions`**

Add a section:

```tsx
const { data: workflowTasks = [] } = useQuery(myWorkflowTasksOptions(wsId));

{workflowTasks.length > 0 && (
  <section aria-label="Workflow tasks">
    <h2>Workflow tasks</h2>
    {workflowTasks.map((task) => (
      <WorkflowTaskRow key={task.id} task={task} />
    ))}
  </section>
)}
```

- [ ] **Step 2: Add row actions**

For worker tasks:

```tsx
{task.status === "worker_assigned" || task.status === "working" ? (
  <Button onClick={() => openSubmitDialog(task)}>Submit deliverable</Button>
) : null}
```

For critic tasks:

```tsx
{task.status === "awaiting_critic" ? (
  <>
    <Button onClick={() => reviewMutation.mutate({ nodeRunId: task.id, approved: true })}>Approve</Button>
    <Button variant="outline" onClick={() => reviewMutation.mutate({ nodeRunId: task.id, approved: false })}>Reject</Button>
  </>
) : null}
```

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @multica/views exec vitest run my-issues/components/my-issues-page.test.tsx
pnpm typecheck
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add packages/views/my-issues/components/my-issues-page.tsx packages/core/workflows/queries.ts packages/views/my-issues/components/my-issues-page.test.tsx
git commit -m "feat(workflows): surface human node tasks"
```

### Task 10: Make Review Decisions Deliverable-Aware

**Files:**
- Modify: `server/internal/service/workflow.go`
- Modify: `server/internal/handler/workflow_run.go`
- Modify: `packages/views/issues/components/execution/execution-detail-panel.tsx`
- Test: `server/internal/service/workflow_transitions_test.go`
- Test: `packages/views/issues/components/execution/execution-detail-panel.test.tsx`

- [ ] **Step 1: Gate approval on required deliverables**

Before `ReviewNodeRun(... approved=true ...)` transitions to approved, load required deliverables and submissions. Reject approval if any required item is missing or rejected.

```go
func (s *WorkflowService) requiredDeliverablesSatisfied(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) (bool, error) {
	deliverables, err := s.Queries.ListWorkflowNodeDeliverables(ctx, nodeRun.WorkflowNodeID)
	if err != nil {
		return false, err
	}
	submissions, err := s.Queries.ListNodeRunDeliverableSubmissions(ctx, nodeRun.ID)
	if err != nil {
		return false, err
	}
	byDeliverable := map[string]db.MulticaWorkflowNodeDeliverableSubmission{}
	for _, submission := range submissions {
		byDeliverable[util.UUIDToString(submission.DeliverableID)] = submission
	}
	for _, deliverable := range deliverables {
		if !deliverable.Required {
			continue
		}
		submission, ok := byDeliverable[util.UUIDToString(deliverable.ID)]
		if !ok || submission.Status == "missing" || submission.Status == "rejected" {
			return false, nil
		}
	}
	return true, nil
}
```

- [ ] **Step 2: Add UI copy for blocked approval**

When backend returns 400 with missing deliverables, show:

```tsx
toast.error(t(($) => $.execution.review.missing_required_deliverables));
```

- [ ] **Step 3: Run tests**

```bash
cd server && go test ./internal/service -run TestReviewNodeRunRequiresDeliverables
pnpm --filter @multica/views exec vitest run issues/components/execution/execution-detail-panel.test.tsx
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add server/internal/service/workflow.go server/internal/handler/workflow_run.go packages/views/issues/components/execution/execution-detail-panel.tsx packages/views/locales/en/issues.json packages/views/locales/zh-Hans/issues.json
git commit -m "feat(workflows): require deliverables for approval"
```

---

## Milestone D - Enterprise Extensions

### Task 11: Add Workflow Notification Event Matrix

**Files:**
- Modify: `server/cmd/server/notification_listeners.go`
- Modify: `server/pkg/db/queries/inbox.sql`
- Modify: `packages/core/types/notification-preference.ts`
- Modify: `packages/views/settings/components/notifications-tab.tsx`
- Test: `server/cmd/server/notification_listeners_test.go`

- [ ] **Step 1: Add notification groups**

Add groups:

```ts
export type NotificationGroupKey =
  | "mentions"
  | "assigned_issues"
  | "workflow_tasks"
  | "workflow_reviews"
  | "workflow_blockers"
  | "system_notifications";
```

- [ ] **Step 2: Emit inbox items for node-run events**

Map:

```go
workflow:node_run_blocked   -> workflow_blockers
workflow:node_run_reviewed  -> workflow_reviews
workflow:node_run_started   -> workflow_tasks
```

Recipient resolution:

```go
if nodeRun.WorkerType == "human" && nodeRun.WorkerID.Valid {
	recipientType = "member"
	recipientID = nodeRun.WorkerID
}
if nodeRun.Status == service.NodeRunStatusAwaitingCritic && nodeRun.CriticType == "human" && nodeRun.CriticID.Valid {
	recipientType = "member"
	recipientID = nodeRun.CriticID
}
```

- [ ] **Step 3: Add tests**

Test blocked node creates inbox item for parent issue subscriber and assigned human where applicable.

- [ ] **Step 4: Run tests**

```bash
cd server && go test ./cmd/server -run TestWorkflowNotification
pnpm --filter @multica/views exec vitest run settings/components/notifications-tab.test.tsx
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add server/cmd/server/notification_listeners.go server/cmd/server/notification_listeners_test.go packages/core/types/notification-preference.ts packages/views/settings/components/notifications-tab.tsx packages/views/locales/en/settings.json packages/views/locales/zh-Hans/settings.json
git commit -m "feat(workflows): notify workflow task events"
```

### Task 12: Add Workflow Role Mapping Foundation

**Files:**
- Create: `server/migrations/130_workflow_roles.up.sql`
- Create: `server/migrations/130_workflow_roles.down.sql`
- Create: `server/pkg/db/queries/workflow_role.sql`
- Modify: `packages/core/types/workflow.ts`
- Modify: `packages/views/workflows/components/node-config-panel.tsx`
- Test: `server/internal/handler/workflow_role_test.go`

- [ ] **Step 1: Add role tables**

```sql
CREATE TABLE multica_workflow_role (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES multica_workspace(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(workspace_id, name)
);

CREATE TABLE multica_workflow_role_binding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES multica_workflow_role(id) ON DELETE CASCADE,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('member', 'agent', 'squad')),
    actor_id UUID NOT NULL,
    priority INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Extend node actor types**

Add `role` to worker/critic type checks in a separate migration:

```sql
ALTER TABLE multica_workflow_node DROP CONSTRAINT IF EXISTS workflow_node_worker_type_check;
ALTER TABLE multica_workflow_node ADD CONSTRAINT workflow_node_worker_type_check
  CHECK (worker_type IN ('human', 'agent', 'squad', 'role'));

ALTER TABLE multica_workflow_node DROP CONSTRAINT IF EXISTS workflow_node_critic_type_check;
ALTER TABLE multica_workflow_node ADD CONSTRAINT workflow_node_critic_type_check
  CHECK (critic_type IN ('human', 'agent', 'squad', 'api', 'role'));
```

- [ ] **Step 3: Add resolver behavior**

At dispatch time, resolve role to the highest-priority available actor. If no binding exists, set node run `blocked` with a clear error.

- [ ] **Step 4: Run tests**

```bash
make sqlc
cd server && go test ./internal/handler ./internal/service -run TestWorkflowRole
pnpm typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add server/migrations/130_workflow_roles.* server/pkg/db/queries/workflow_role.sql server/pkg/db/generated packages/core/types/workflow.ts packages/views/workflows/components/node-config-panel.tsx
git commit -m "feat(workflows): add role-based node assignment"
```

### Task 13: Add Node-Level Plugin/Skill Binding Foundation

**Files:**
- Create: `server/migrations/131_workflow_node_capabilities.up.sql`
- Create: `server/migrations/131_workflow_node_capabilities.down.sql`
- Create: `server/pkg/db/queries/workflow_node_capability.sql`
- Modify: `server/internal/service/workflow.go`
- Modify: `packages/views/workflows/components/node-config-panel.tsx`
- Test: `server/internal/service/workflow_test.go`

- [ ] **Step 1: Add capability table**

```sql
CREATE TABLE multica_workflow_node_capability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_node_id UUID NOT NULL REFERENCES multica_workflow_node(id) ON DELETE CASCADE,
    capability_type TEXT NOT NULL CHECK (capability_type IN ('plugin', 'skill')),
    capability_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(workflow_node_id, capability_type, capability_id)
);
```

- [ ] **Step 2: Include capabilities in agent task context**

In `DispatchAgentTask`, add:

```go
"node_capabilities": capabilities,
```

where `capabilities` is loaded from `ListWorkflowNodeCapabilities`.

- [ ] **Step 3: UI selection**

Add Plugin/Skill pickers in node config with links:

```tsx
<AppLink href={paths.skills()}>
  Manage skills
</AppLink>
```

- [ ] **Step 4: Run tests**

```bash
make sqlc
cd server && go test ./internal/service -run TestWorkflowNodeCapabilitiesInTaskContext
pnpm --filter @multica/views exec vitest run workflows/components/node-config-panel.test.tsx
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add server/migrations/131_workflow_node_capabilities.* server/pkg/db/queries/workflow_node_capability.sql server/internal/service/workflow.go packages/views/workflows/components/node-config-panel.tsx
git commit -m "feat(workflows): bind capabilities to nodes"
```

### Task 14: Add Code Delivery Foundations

**Files:**
- Create: `server/migrations/132_workflow_code_delivery.up.sql`
- Create: `server/migrations/132_workflow_code_delivery.down.sql`
- Modify: `server/pkg/db/queries/workflow_deliverable.sql`
- Modify: `packages/core/types/workflow.ts`
- Modify: `packages/views/workflows/components/node-deliverables-editor.tsx`
- Modify: `packages/views/issues/components/execution/artifact-list.tsx`
- Test: `server/internal/handler/workflow_deliverable_test.go`
- Test: `packages/views/issues/components/execution/artifact-list.test.tsx`

- [ ] **Step 1: Add repository reference fields**

```sql
ALTER TABLE multica_workflow_node_deliverable
ADD COLUMN repository_id UUID REFERENCES multica_project_resource(id) ON DELETE SET NULL,
ADD COLUMN branch_policy TEXT NOT NULL DEFAULT '',
ADD COLUMN integration_required BOOLEAN NOT NULL DEFAULT FALSE;
```

- [ ] **Step 2: Add integration node marker**

For workflow nodes, add:

```sql
ALTER TABLE multica_workflow_node
ADD COLUMN node_kind TEXT NOT NULL DEFAULT 'standard'
CHECK (node_kind IN ('standard', 'code_integration'));
```

- [ ] **Step 3: UI behavior**

When deliverable kind is `pull_request`, show repository selector and PR URL submission field. When node kind is `code_integration`, show integration policy text.

- [ ] **Step 4: Run tests**

```bash
make sqlc
cd server && go test ./internal/handler -run TestWorkflowDeliverable
pnpm --filter @multica/views exec vitest run workflows/components/node-deliverables-editor.test.tsx issues/components/execution/artifact-list.test.tsx
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add server/migrations/132_workflow_code_delivery.* server/pkg/db/queries/workflow_deliverable.sql packages/core/types/workflow.ts packages/views/workflows/components/node-deliverables-editor.tsx packages/views/issues/components/execution/artifact-list.tsx
git commit -m "feat(workflows): add code delivery metadata"
```

---

## Verification Plan

Run after each milestone:

```bash
pnpm typecheck
pnpm test
cd server && go test ./...
```

Run after all milestones:

```bash
make check
```

Add one E2E after Milestone B:

```bash
pnpm exec playwright test e2e/workflow-execution/deliverables.spec.ts
```

E2E scenario:

1. Create or seed active workflow with one human worker node, one required document deliverable, one human critic.
2. Assign workflow to an issue.
3. Open issue detail and verify execution panorama shows missing deliverable red status.
4. Open human task, submit deliverable content.
5. Verify status changes to submitted/yellow.
6. Approve review.
7. Verify node completed and deliverable status green.

## Risk Notes

- Deliverables touch schema, API, editor UI, execution UI, and review transitions. Keep Milestone B in its own PR after Milestone A lands.
- Role mapping and Plugin/Skill binding can ship as foundations without full scheduling intelligence. Avoid dynamic task decomposition until deliverables and task inbox are stable.
- Do not delete `format_schema` immediately. Hide it from primary UI first, migrate existing workflows safely, then remove it in a later migration after data analysis.
- Workflow node-run `blocked` currently represents both human takeover and terminal blockage. If ambiguity causes UI bugs, introduce `blocked_reason` or `control_state` before expanding notification logic.

## Self-Review

- Spec coverage: creation/editing, execution viewing, human executor, agent executor, review, notifications, code delivery all map to milestones.
- Placeholder scan: no implementation step uses open-ended placeholder wording.
- Type consistency: deliverable names use `WorkflowNodeDeliverable` and `WorkflowNodeDeliverableSubmission` consistently across API, schema, and UI.

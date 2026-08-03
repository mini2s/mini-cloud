# Workflow Default Boundaries and Actor Identity Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every newly created blank workflow atomically include Start and End nodes, and make workflow actor slots clearly show responsibility, avatar, entity type, and agent availability.

**Architecture:** The workflow handler owns an atomic `workflow + Start + End` transaction while template cloning remains unchanged. A shared, presentation-only `WorkflowActorSlot` accepts fully resolved identity data; editor and runtime pages resolve that data once at page level, including one workspace-wide presence map, and pass it through React Flow node data.

**Tech Stack:** Go 1.26, pgx/sqlc, Chi handlers, TypeScript 5.9, React 19, TanStack Query, React Flow, Vitest, Testing Library, Tailwind CSS, lucide-react.

## Global Constraints

- Work only in `D:\code\multica-1\.worktrees\workflow-default-boundaries-actor-identity` on branch `feat/workflow-default-boundaries-actor-identity`.
- Only future non-template workflow creation gets default boundaries; do not migrate or repair existing workflows.
- Keep Start and End in the manual node template catalog and preserve the existing uniqueness-disable behavior.
- Do not create a default edge or change boundary execution semantics.
- React Query owns all server state; do not add Zustand copies or per-card query subscriptions.
- Reuse `@multica/ui/components/common/actor-avatar`; `packages/ui` must not import `@multica/core`.
- Keep `packages/views` free of `next/*` and `react-router-dom` imports.
- Use semantic design tokens, fixed card dimensions, icons plus text for status, and no color-only distinctions.
- Code comments must be English; UI copy must be added to both `packages/views/locales/en/workflows.json` and `packages/views/locales/zh-Hans/workflows.json`.
- Follow TDD for every behavior change and make one focused Conventional Commit per task.

---

## File Map

- `server/internal/handler/workflow.go`: transact blank workflow creation and define the two default boundary node parameters.
- `server/internal/handler/workflow_create_test.go`: integration coverage for persisted defaults, response count, and rollback.
- `packages/views/common/workflow-actor-slots.tsx`: shared actor identity contract and visual rendering; no queries or business resolution.
- `packages/views/common/workflow-actor-slots.test.tsx`: direct rendering coverage for all identity and fallback states.
- `packages/views/locales/en/workflows.json`: English actor type, availability, and empty-state strings.
- `packages/views/locales/zh-Hans/workflows.json`: Chinese equivalents using “数智人”, “成员”, “研发角色”, and “小队”.
- `packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.tsx`: accept and render editor actor identities.
- `packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx`: editor card contract and fixed-layout assertions.
- `packages/views/workflows/components/overview/workflow-panorama-page.tsx`: resolve editor identities and one workspace presence map.
- `packages/views/workflows/components/overview/workflow-panorama-page.test.tsx`: prove node data includes identity/avatar/availability and presence is page-scoped.
- `packages/views/issues/components/execution/runtime-node-card.tsx`: accept and render runtime identities.
- `packages/views/issues/components/execution/runtime-node-card.test.tsx`: runtime slot rendering coverage.
- `packages/views/issues/components/execution/runtime-canvas-node.tsx`: thread identities from React Flow data into `RuntimeNodeCard`.
- `packages/views/issues/components/execution/runtime-canvas-node.test.tsx`: prop-forwarding coverage.
- `packages/views/issues/components/execution/execution-panorama-page.tsx`: resolve actual node-run actors before unresolved roles and attach workspace presence.
- `packages/views/issues/components/execution/execution-panorama-page.test.tsx`: prove role-to-member resolution and agent availability data flow.

---

### Task 1: Atomically Create Default Boundary Nodes

**Files:**
- Modify: `server/internal/handler/workflow.go:410`
- Create: `server/internal/handler/workflow_create_test.go`

**Interfaces:**
- Consumes: `Handler.TxStarter.Begin(context.Context)`, `Queries.WithTx(pgx.Tx)`, `CreateWorkflow`, and `CreateWorkflowNode`.
- Produces: ordinary `POST /api/workflows` responses with `node_count: 2`; no API shape change.

- [ ] **Step 1: Write the successful creation integration test**

Create a request through `testHandler.CreateWorkflow`, decode `WorkflowResponse`, and query the persisted nodes:

```go
func TestCreateWorkflowCreatesDefaultBoundaries(t *testing.T) {
	if testHandler == nil { t.Skip("database not available") }
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/workflows", map[string]any{"title": "Default boundaries"})
	testHandler.CreateWorkflow(w, req)
	if w.Code != http.StatusCreated { t.Fatalf("got %d: %s", w.Code, w.Body.String()) }

	var response WorkflowResponse
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil { t.Fatal(err) }
	t.Cleanup(func() { _, _ = testPool.Exec(context.Background(), `DELETE FROM multica_workflow WHERE id = $1`, response.ID) })
	if response.NodeCount != 2 { t.Fatalf("node_count = %d, want 2", response.NodeCount) }

	rows, err := testPool.Query(context.Background(), `
		SELECT title, format_schema->>'type', format_schema->>'shape',
		       format_schema->>'template_id', position_x, position_y, sort_order,
		       worker_id, critic_id, stage_id
		FROM multica_workflow_node WHERE workflow_id = $1 ORDER BY sort_order`, response.ID)
	if err != nil { t.Fatal(err) }
	defer rows.Close()
	type boundary struct {
		title, kind, shape, templateID string
		x, y                           float64
		sortOrder                      int32
		workerID, criticID, stageID     *string
	}
	var got []boundary
	for rows.Next() {
		var item boundary
		if err := rows.Scan(&item.title, &item.kind, &item.shape, &item.templateID,
			&item.x, &item.y, &item.sortOrder, &item.workerID, &item.criticID, &item.stageID); err != nil {
			t.Fatal(err)
		}
		got = append(got, item)
	}
	if err := rows.Err(); err != nil { t.Fatal(err) }
	if len(got) != 2 { t.Fatalf("got %d nodes, want 2", len(got)) }
	if got[0].title != "Start" || got[0].kind != "start" || got[0].shape != "pill" ||
		got[0].templateID != "workflow-start" || got[0].x != 120 || got[0].y != 0 || got[0].sortOrder != 0 {
		t.Fatalf("unexpected Start node: %#v", got[0])
	}
	if got[1].title != "End" || got[1].kind != "end" || got[1].shape != "pill" ||
		got[1].templateID != "workflow-end" || got[1].x != 600 || got[1].y != 0 || got[1].sortOrder != 1 {
		t.Fatalf("unexpected End node: %#v", got[1])
	}
	for _, item := range got {
		if item.workerID != nil || item.criticID != nil || item.stageID != nil {
			t.Fatalf("boundary actor/stage IDs must be null: %#v", item)
		}
	}
}
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `cd server && go test ./internal/handler -run TestCreateWorkflowCreatesDefaultBoundaries -count=1`

Expected: FAIL because the response reports `node_count = 0` and no boundary rows exist.

- [ ] **Step 3: Implement the transactional ordinary-create path**

Add one focused helper for node parameters so test and handler use a stable definition:

```go
func defaultWorkflowBoundaryNodes(workflowID pgtype.UUID) []db.CreateWorkflowNodeParams {
	return []db.CreateWorkflowNodeParams{
		{
			WorkflowID: workflowID, Title: "Start", PositionX: 120, PositionY: 0,
			FormatSchema: []byte(`{"type":"start","shape":"pill","template_id":"workflow-start","template_category":"trigger"}`),
			WorkerType: "human", CriticType: "human", SortOrder: 0,
		},
		{
			WorkflowID: workflowID, Title: "End", PositionX: 600, PositionY: 0,
			FormatSchema: []byte(`{"type":"end","shape":"pill","template_id":"workflow-end","template_category":"trigger"}`),
			WorkerType: "human", CriticType: "human", SortOrder: 1,
		},
	}
}
```

In the non-template branch of `CreateWorkflow`, begin a transaction, create the workflow through `qtx`, insert both node parameter sets, commit, then build `workflowToResponse(wf, 2)`. Keep template cloning before this branch, keep `defer tx.Rollback`, and publish only after commit succeeds.

- [ ] **Step 4: Run success and existing boundary tests**

Run: `cd server && go test ./internal/handler -run 'Test(CreateWorkflowCreatesDefaultBoundaries|.*WorkflowBoundary)' -count=1`

Expected: PASS.

- [ ] **Step 5: Add the rollback integration test**

Add `TestCreateWorkflowDefaultBoundaryFailureRollsBack`. Install a temporary PostgreSQL trigger whose function raises only when inserting `End` for a workflow titled `Rollback boundaries test`:

```go
_, err := testPool.Exec(ctx, `
	CREATE OR REPLACE FUNCTION test_fail_default_workflow_end() RETURNS trigger AS $$
	BEGIN
		IF NEW.title = 'End' AND EXISTS (
			SELECT 1 FROM multica_workflow
			WHERE id = NEW.workflow_id AND title = 'Rollback boundaries test'
		) THEN
			RAISE EXCEPTION 'forced default End failure';
		END IF;
		RETURN NEW;
	END;
	$$ LANGUAGE plpgsql;
	CREATE TRIGGER test_fail_default_workflow_end_trigger
	BEFORE INSERT ON multica_workflow_node
	FOR EACH ROW EXECUTE FUNCTION test_fail_default_workflow_end();`)
if err != nil { t.Fatal(err) }
t.Cleanup(func() {
	_, _ = testPool.Exec(context.Background(), `DROP TRIGGER IF EXISTS test_fail_default_workflow_end_trigger ON multica_workflow_node`)
	_, _ = testPool.Exec(context.Background(), `DROP FUNCTION IF EXISTS test_fail_default_workflow_end()`)
})

w := httptest.NewRecorder()
req := newRequest("POST", "/api/workflows", map[string]any{"title": "Rollback boundaries test"})
testHandler.CreateWorkflow(w, req)
if w.Code != http.StatusInternalServerError { t.Fatalf("got %d: %s", w.Code, w.Body.String()) }

var count int
if err := testPool.QueryRow(ctx,
	`SELECT count(*) FROM multica_workflow WHERE title = 'Rollback boundaries test'`,
).Scan(&count); err != nil { t.Fatal(err) }
if count != 0 { t.Fatalf("rolled-back workflow count = %d, want 0", count) }
```

Do not mark this test `t.Parallel` because the trigger is schema-global. Template isolation is already covered by `server/internal/service/workflow_template_test.go::TestCloneWorkflowFromTemplate`, which asserts the clone has exactly the template's five nodes; include that test in Step 6.

```sql
- [ ] **Step 6: Run all workflow handler tests**

Run: `cd server && go test ./internal/handler -run 'Test.*Workflow' -count=1 && go test ./internal/service -run TestCloneWorkflowFromTemplate -count=1`

Expected: PASS with no leftover trigger or workflow rows.

- [ ] **Step 7: Commit the backend change**

```bash
git add server/internal/handler/workflow.go server/internal/handler/workflow_create_test.go
git commit -m "feat(workflow): create default boundary nodes atomically"
```

---

### Task 2: Build the Shared Identity-First Actor Slot

**Files:**
- Modify: `packages/views/common/workflow-actor-slots.tsx`
- Create: `packages/views/common/workflow-actor-slots.test.tsx`
- Modify: `packages/views/locales/en/workflows.json`
- Modify: `packages/views/locales/zh-Hans/workflows.json`

**Interfaces:**
- Consumes: `ActorAvatar` from `@multica/ui/components/common/actor-avatar` and lucide icons.
- Produces: `WorkflowActorIdentity` and an expanded `WorkflowActorSlot` prop contract for Tasks 3 and 4.

- [ ] **Step 1: Define failing component tests for identity rendering**

Cover agent avatar/type/online, agent offline, member initials, square squad fallback, role icon, API reviewer icon, missing, and optional. Use this public shape in the tests:

```ts
export type WorkflowActorEntityType = "agent" | "member" | "squad" | "role" | "api";
export type WorkflowActorAvailability = "online" | "offline" | "unstable";

export interface WorkflowActorIdentity {
  type: WorkflowActorEntityType;
  id: string | null;
  name: string;
  typeLabel: string;
  initials?: string;
  avatarUrl?: string | null;
  availability?: WorkflowActorAvailability | null;
  availabilityLabel?: string;
}
```

For the configured agent test, assert `data-workflow-actor-type="agent"`, an image with the agent name, “数智人”, and “在线”. Also assert there is no descendant matching `[data-workflow-actor-state]` so the old colored dot cannot regress.

```tsx
render(
  <WorkflowActorSlot
    slot="worker"
    label="执行者"
    identity={{
      type: "agent",
      id: "agent-1",
      name: "研发助手 Alpha",
      typeLabel: "数智人",
      initials: "RA",
      avatarUrl: "/alpha.png",
      availability: "online",
      availabilityLabel: "在线",
    }}
    fallback="未配置"
    state="configured"
  />,
);
const slot = screen.getByText("研发助手 Alpha").closest('[data-workflow-actor-slot="worker"]');
expect(slot).toHaveAttribute("data-workflow-actor-type", "agent");
expect(screen.getByRole("img", { name: "研发助手 Alpha" })).toBeInTheDocument();
expect(slot).toHaveTextContent("数智人");
expect(slot).toHaveTextContent("在线");
expect(slot?.querySelector("[data-workflow-actor-state]")).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the component test and verify it fails**

Run: `pnpm --filter @multica/views exec vitest run common/workflow-actor-slots.test.tsx`

Expected: FAIL because `identity` props and identity rendering do not exist.

- [ ] **Step 3: Implement the presentation-only actor slot**

Change the props to:

```ts
interface WorkflowActorSlotProps {
  slot: WorkflowActorSlotKind;
  label: string;
  identity?: WorkflowActorIdentity | null;
  fallback: string;
  state: WorkflowActorState;
  testId?: string;
  className?: string;
}
```

Render a fixed 24px identity visual. Use `ActorAvatar` for agent/member/squad with `isAgent` and `isSquad`; render `BadgeCheck` for roles, `Braces` for API reviewers, and `CircleDashed` for absent identities. Under the name render `identity.typeLabel`; for agents append `Wifi` plus the online label or `WifiOff` plus the offline label. Map `unstable` to the offline visual, but retain `data-workflow-actor-availability="unstable"` for testing and diagnostics.

Do not call hooks, queries, navigation, or i18n inside this component. Remove `stateClassName` and the colored state dot entirely. Keep names truncated with `title`, type labels non-shrinking, and the two-row subgrid contract.

- [ ] **Step 4: Add localized labels**

Under `panorama.card` in both locale files add:

```json
"actor_type_agent": "Digital human",
"actor_type_member": "Member",
"actor_type_squad": "Squad",
"actor_type_role": "Development role",
"actor_type_api": "API reviewer",
"actor_online": "Online",
"actor_offline": "Offline",
"actor_not_configured": "Not configured",
"actor_optional": "Optional"
```

Use these Chinese values in the corresponding file: `数智人`, `成员`, `小队`, `研发角色`, `API 审核者`, `在线`, `离线`, `未配置`, `可选`.

- [ ] **Step 5: Run the shared component tests**

Run: `pnpm --filter @multica/views exec vitest run common/workflow-actor-slots.test.tsx`

Expected: PASS for image, fallback, role, API reviewer, missing, optional, online, offline, and unstable cases.

- [ ] **Step 6: Commit the shared component**

```bash
git add packages/views/common/workflow-actor-slots.tsx packages/views/common/workflow-actor-slots.test.tsx packages/views/locales/en/workflows.json packages/views/locales/zh-Hans/workflows.json
git commit -m "feat(views): add identity-first workflow actor slots"
```

---

### Task 3: Wire Identity and Presence into the Workflow Editor

**Files:**
- Modify: `packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.tsx`
- Modify: `packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx`
- Modify: `packages/views/workflows/components/overview/workflow-panorama-page.tsx`
- Modify: `packages/views/workflows/components/overview/workflow-panorama-page.test.tsx`

**Interfaces:**
- Consumes: `WorkflowActorIdentity` from Task 2 and `useWorkspacePresenceMap(wsId)` from `@multica/core/agents`.
- Produces: `CompactWorkerNodeData.workerIdentity` and `.criticIdentity` for the editor canvas.

- [ ] **Step 1: Write failing compact-card tests**

Extend `CompactWorkerNodeData` fixtures with:

```ts
workerIdentity: {
  type: "agent",
  id: "agent-1",
  name: "Builder Agent",
  typeLabel: "Digital human",
  initials: "BA",
  avatarUrl: "/avatars/builder.png",
  availability: "online",
  availabilityLabel: "Online",
},
criticIdentity: {
  type: "member",
  id: "member-1",
  name: "Reviewer",
  typeLabel: "Member",
  initials: "R",
  avatarUrl: null,
},
```

Assert both slot roles, both type labels, the image/initial fallback, “Online”, no `[data-workflow-actor-state]`, and unchanged `h-[152px] w-[296px]` card dimensions.

- [ ] **Step 2: Run compact-card tests and verify failure**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx`

Expected: FAIL because the component still passes `name` instead of `identity`.

- [ ] **Step 3: Update `CompactWorkerNodeData` and slot calls**

Add:

```ts
workerIdentity?: WorkflowActorIdentity | null;
criticIdentity?: WorkflowActorIdentity | null;
```

Pass `identity={nodeData.workerIdentity}` and `identity={nodeData.criticIdentity}`. Use localized `actor_not_configured` and `actor_optional` fallbacks. Keep existing names only where they are used for ARIA subtitle or backwards-independent node metadata; do not reconstruct identities inside the node renderer.

- [ ] **Step 4: Write failing page-level identity data tests**

Expand the `useActorName` mock to expose `getActorInitials` and `getActorAvatarUrl`. Mock `useWorkspacePresenceMap` once at module level:

```ts
useWorkspacePresenceMap: () => ({
  byAgent: new Map([["agent-1", { availability: "online" }]]),
  loading: false,
}),
```

Provide one agent worker, one member critic, one squad worker, and one role worker across fixtures. Assert the React Flow node data contains the correct `workerIdentity`/`criticIdentity`, and that role identities have `id: null`, no avatar, and no availability.

```ts
const agentNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "agent-node");
expect(agentNode?.data.workerIdentity).toMatchObject({
  type: "agent",
  id: "agent-1",
  name: "Test Agent",
  avatarUrl: "/agent.png",
  availability: "online",
});
const roleNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "role-node");
expect(roleNode?.data.workerIdentity).toEqual({
  type: "role",
  id: null,
  name: "Developer",
  typeLabel: "Development role",
});
```

- [ ] **Step 5: Run the panorama page test and verify failure**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/overview/workflow-panorama-page.test.tsx`

Expected: FAIL because actor identities and the presence map are not assembled.

- [ ] **Step 6: Assemble editor identity data once at page level**

Import `useWorkspacePresenceMap` and destructure all three identity helpers from `useActorName`. Add a local pure builder with this signature:

```ts
function buildEditorActorIdentity(input: {
  type: WorkerType | CriticType;
  id: string | null;
  roleName?: string;
  getActorName: (type: string, id: string) => string;
  getActorInitials: (type: string, id: string) => string;
  getActorAvatarUrl: (type: string, id: string) => string | null;
  availability?: AgentAvailability;
  labels: Record<WorkflowActorEntityType, string>;
  availabilityLabels: { online: string; offline: string };
}): WorkflowActorIdentity | null
```

Map `human` to `member`; keep `agent`, `squad`, `role`, and `api`. For role nodes use the localized role name, `type: "role"`, `id: null`, and no availability. For an API critic use the existing “API review” name, `type: "api"`, `id: null`, and no availability. Call `useWorkspacePresenceMap(wsId)` once in `WorkflowPanoramaPage`, then attach identities in `makeNodeData` using `presenceByAgent.get(node.worker_id)?.availability` only for agents.

- [ ] **Step 7: Run editor tests**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx workflows/components/overview/workflow-panorama-page.test.tsx`

Expected: PASS, including existing boundary-template disable tests.

- [ ] **Step 8: Commit the editor wiring**

```bash
git add packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.tsx packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx packages/views/workflows/components/overview/workflow-panorama-page.tsx packages/views/workflows/components/overview/workflow-panorama-page.test.tsx
git commit -m "feat(workflow): show actor identity and presence on editor cards"
```

---

### Task 4: Wire Resolved Actor Identity into Runtime Cards

**Files:**
- Modify: `packages/views/issues/components/execution/runtime-node-card.tsx`
- Modify: `packages/views/issues/components/execution/runtime-node-card.test.tsx`
- Modify: `packages/views/issues/components/execution/runtime-canvas-node.tsx`
- Modify: `packages/views/issues/components/execution/runtime-canvas-node.test.tsx`
- Modify: `packages/views/issues/components/execution/execution-panorama-page.tsx`
- Modify: `packages/views/issues/components/execution/execution-panorama-page.test.tsx`

**Interfaces:**
- Consumes: `WorkflowActorIdentity` from Task 2 and the identity-builder conventions from Task 3.
- Produces: `RuntimeNodeCardProps.workerIdentity`, `.criticIdentity`, and matching `RuntimeCanvasNodeData` fields.

- [ ] **Step 1: Write failing runtime card and forwarding tests**

Add optional `workerIdentity` and `criticIdentity` fixtures to `RuntimeNodeCard` tests and assert names, type labels, avatar fallbacks, and agent online/offline text. In `runtime-canvas-node.test.tsx`, make the mocked `RuntimeNodeCard` capture both identity props and assert `RuntimeCanvasNode` forwards them unchanged.

```tsx
const workerIdentity: WorkflowActorIdentity = {
  type: "agent",
  id: "agent-1",
  name: "Runtime Agent",
  typeLabel: "Digital human",
  initials: "RA",
  avatarUrl: null,
  availability: "offline",
  availabilityLabel: "Offline",
};
render(
  <RuntimeNodeCard
    node={baseNode}
    nodeRun={completedRun}
    workerName="Runtime Agent"
    criticName={null}
    workerIdentity={workerIdentity}
    criticIdentity={null}
    onClick={vi.fn()}
  />,
);
expect(screen.getByText("Runtime Agent")).toBeInTheDocument();
expect(screen.getByText("Digital human")).toBeInTheDocument();
expect(screen.getByText("Offline")).toBeInTheDocument();
```

- [ ] **Step 2: Run the focused runtime component tests and verify failure**

Run: `pnpm --filter @multica/views exec vitest run issues/components/execution/runtime-node-card.test.tsx issues/components/execution/runtime-canvas-node.test.tsx`

Expected: FAIL because the new props are not declared or forwarded.

- [ ] **Step 3: Thread identities through runtime components**

Add to `RuntimeNodeCardProps` and `RuntimeCanvasNodeData`:

```ts
workerIdentity?: WorkflowActorIdentity | null;
criticIdentity?: WorkflowActorIdentity | null;
```

Replace every actor-slot `name` call in normal and split-card branches with `identity`. Preserve `workerName` and `criticName` temporarily for ARIA, detail panels, and split summaries; they are derived from the same identity and are not a second server-state store.

- [ ] **Step 4: Write failing execution-page resolution tests**

Cover these precedence cases in `execution-panorama-page.test.tsx`:

1. `nodeRun.worker_type = "human"` and `nodeRun.worker_id = "member-1"` overrides an unresolved node role and yields a member identity with avatar.
2. A node role with no concrete node-run actor yields a role identity and role icon data.
3. An explicit agent node-run actor yields an agent identity with availability from one mocked `useWorkspacePresenceMap`.
4. Member, squad, role, API reviewer, and missing actors have no availability.

Assert the identity objects on the React Flow node data, not only rendered text.

```ts
const roleResolvedNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "role-node");
expect(roleResolvedNode?.data.workerIdentity).toMatchObject({
  type: "member",
  id: "member-1",
  name: "Resolved Reviewer",
  avatarUrl: "/reviewer.png",
});
const unresolvedRoleNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "pending-role-node");
expect(unresolvedRoleNode?.data.workerIdentity).toMatchObject({
  type: "role",
  id: null,
  name: "Developer",
});
```

- [ ] **Step 5: Run execution-page tests and verify failure**

Run: `pnpm --filter @multica/views exec vitest run issues/components/execution/execution-panorama-page.test.tsx`

Expected: FAIL because runtime data currently resolves names only.

- [ ] **Step 6: Resolve concrete node-run actors before roles**

Add `useWorkspacePresenceMap(wsId)` once. Replace name-only resolution with a pure resolver:

```ts
function resolveRuntimeActorIdentity(
  slot: "worker" | "critic",
  node: WorkflowNode,
  nodeRun: WorkflowNodeRun | null,
): WorkflowActorIdentity | null
```

Resolution order:

1. If `nodeRun[slot + "_id"]` exists and its type is not `role`/`api`, build the concrete agent/member/squad identity from the existing lookups; map `human` to `member`.
2. Else if the node has an explicit actor ID, build that concrete identity.
3. Else if the node has a role ID/key, return a role identity using `renderRoleName`.
4. Else if the critic uses `critic_type: "api"` or has `critic_api_url`, return an API identity with the existing “API review” name.
5. Else return `null`.

Only attach availability for concrete agents. Derive `workerName` and `criticName` from `identity?.name ?? null` so existing detail-panel consumers stay consistent. Attach both identities in `makeNodeData`.

- [ ] **Step 7: Run all runtime canvas tests**

Run: `pnpm --filter @multica/views exec vitest run issues/components/execution/runtime-node-card.test.tsx issues/components/execution/runtime-canvas-node.test.tsx issues/components/execution/execution-panorama-page.test.tsx`

Expected: PASS for explicit actors, unresolved roles, resolved roles, avatar fallbacks, and agent availability.

- [ ] **Step 8: Commit the runtime wiring**

```bash
git add packages/views/issues/components/execution/runtime-node-card.tsx packages/views/issues/components/execution/runtime-node-card.test.tsx packages/views/issues/components/execution/runtime-canvas-node.tsx packages/views/issues/components/execution/runtime-canvas-node.test.tsx packages/views/issues/components/execution/execution-panorama-page.tsx packages/views/issues/components/execution/execution-panorama-page.test.tsx
git commit -m "feat(workflow): show resolved actor identity on runtime cards"
```

---

### Task 5: Cross-Surface Verification and Visual Check

**Files:**
- Modify only files from Tasks 1-4 if verification reveals a defect.

**Interfaces:**
- Consumes: all backend and frontend behavior from Tasks 1-4.
- Produces: verified feature with no unrelated changes.

- [ ] **Step 1: Run TypeScript type checking**

Run: `pnpm typecheck`

Expected: PASS across all workspace packages and both apps.

- [ ] **Step 2: Run focused frontend regression tests**

Run:

```bash
pnpm --filter @multica/views exec vitest run common/workflow-actor-slots.test.tsx workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx workflows/components/overview/workflow-panorama-page.test.tsx issues/components/execution/runtime-node-card.test.tsx issues/components/execution/runtime-canvas-node.test.tsx issues/components/execution/execution-panorama-page.test.tsx
```

Expected: all listed files pass.

- [ ] **Step 3: Run Go workflow regression tests**

Run: `cd server && go test ./internal/handler ./internal/service -run 'Test.*Workflow' -count=1`

Expected: PASS with no database trigger or fixture leakage.

- [ ] **Step 4: Run lint and diff checks**

Run: `pnpm lint`

Expected: PASS.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 5: Start the worktree development environment and inspect both surfaces**

Run: `make worktree-env`, then `make start-worktree`.

Verify in the browser at the URL printed by the worktree environment:

- Creating a blank workflow immediately shows Start and End.
- Start/End remain present but disabled in the template picker until deleted.
- Agent/member and squad/role combinations match approved visual option A at desktop and narrow widths.
- Agent online/offline uses icon plus text; no legacy colored configuration dot remains.
- Long names stay within the `296 x 152` editor card.
- Runtime role resolution switches the role icon to the concrete member identity.

- [ ] **Step 6: Stop the development environment**

Run: `make stop`

Expected: worktree services stop without affecting another checkout's configured ports.

- [ ] **Step 7: Commit only if verification required fixes**

```bash
git add server/internal/handler/workflow.go server/internal/handler/workflow_create_test.go packages/views/common/workflow-actor-slots.tsx packages/views/common/workflow-actor-slots.test.tsx packages/views/locales/en/workflows.json packages/views/locales/zh-Hans/workflows.json packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.tsx packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx packages/views/workflows/components/overview/workflow-panorama-page.tsx packages/views/workflows/components/overview/workflow-panorama-page.test.tsx packages/views/issues/components/execution/runtime-node-card.tsx packages/views/issues/components/execution/runtime-node-card.test.tsx packages/views/issues/components/execution/runtime-canvas-node.tsx packages/views/issues/components/execution/runtime-canvas-node.test.tsx packages/views/issues/components/execution/execution-panorama-page.tsx packages/views/issues/components/execution/execution-panorama-page.test.tsx
git commit -m "fix(workflow): address actor card verification findings"
```

If no fixes were needed, do not create an empty commit.

# Workflow Runtime Isolation MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从最新 `main` 重组一个最小可合并分支，使新 workflow run 的执行和详情展示都只使用启动时快照，同时保留现有编辑器 preflight 与 legacy 降级能力。

**Architecture:** 复用 `main` 已有的准备事务、运行快照、运行边、运行态交付物和 runtime repository。MVP 只补齐 Split runtime config、snapshot API、详情回放、删除保护与已知隔离缺口；legacy run 使用显式降级路径，任何新 run 都不得回查当前定义。

**Tech Stack:** Go 1.24、Chi、pgx/sqlc、PostgreSQL、TypeScript、React、TanStack Query、Zod、Vitest、pnpm/Turborepo。

## Global Constraints

- 执行前必须使用 `superpowers:using-git-worktrees` 从最新 `main` 创建隔离 worktree，建议分支名 `feat/workflow-run-isolation-mvp`。
- 当前完整分支 `feat/workflow-run-isolation` 只作为已验证补丁来源，不在其上 revert 或继续实现。
- 不改变编辑器 preflight、启用语义、相关文案或现有保存体验。
- 不引入 workflow 发布、版本管理、feature flag、长期双读或长期双写。
- 不修改 dispatch job、租约、幂等或崩溃恢复机制。
- 不引入 workspace 显式删除、历史 task 清理或新的 legacy backfill/down migration。
- `main` 已有 migration 和 legacy backfill 保持不变；MVP 不新增 schema migration。
- React Query 继续拥有服务端状态；不新增 Zustand server-state 写入。
- `packages/views/` 不导入 `next/*` 或 `react-router-dom`。
- SQL 修改后运行仓库固定版本 sqlc；生成文件不得手工编辑。
- 默认只运行本计划列出的相关模块测试，不运行全量 `make check`。
- 每个任务只提交列出的文件；不要提交设计完整方案或其他无关文件。

## File Structure

### Split runtime config

- `server/internal/service/workflow_split.go`：所有 Split phase、PATCH、恢复和子 workflow 启动读取 node run runtime config。
- `server/internal/handler/workflow_split_test.go`：Split API 与恢复路径回归。
- `server/pkg/db/queries/workflow_node_run.sql`：带版本条件更新 node run runtime config。
- `server/pkg/db/generated/workflow_node_run.sql.go`：sqlc 生成结果。

### API contract

- `server/internal/handler/workflow_run.go`：显式构造 workflow run/node run DTO 与结构化 422。
- `server/internal/handler/workflow_runtime_isolation_test.go`：handler contract 回归。
- `server/internal/service/workflow_run_prepare.go`：配置失败错误携带 failed run ID。
- `server/internal/service/workflow_run_prepare_integration_test.go`：失败 run 原子性。
- `packages/core/types/workflow.ts`：snapshot、run 和 node run 类型。
- `packages/core/api/schemas.ts`：兼容新旧响应和未知 snapshot schema。
- `packages/core/api/schema.test.ts`、`packages/core/api/schemas.test.ts`：schema contract。
- `packages/core/api/client.ts`：解析结构化启动错误。

### Run detail replay

- `packages/core/workflows/queries.ts`：`workflowRunOptions` 与 `workflowRunCanvasDefinition`。
- `packages/core/workflows/queries.test.ts`：native snapshot 和 legacy fallback 的纯函数测试。
- `packages/views/issues/components/execution/execution-panorama-page.tsx`：run 模式只查询 run/node runs，并从 snapshot model 渲染。
- `packages/views/issues/components/execution/execution-panorama-page.test.tsx`：禁止当前定义查询、snapshot 回放和名称快照测试。
- `packages/views/workflows/components/workflow-run-page.tsx`：legacy 不完整提示。
- `packages/views/workflows/components/workflow-run-page.test.tsx`：legacy 提示回归。
- `packages/views/locales/en/workflows.json`、`packages/views/locales/zh-Hans/workflows.json`：legacy 提示文案。

### Deletion protection

- `server/pkg/db/queries/workflow.sql`：workflow 历史检查与 node 活动引用检查。
- `server/pkg/db/queries/workflow_deliverable.sql`：deliverable 活动引用检查。
- `server/pkg/db/queries/workflow_role.sql`：role snapshot 活动引用检查。
- `server/pkg/db/generated/workflow.sql.go`、`workflow_deliverable.sql.go`、`workflow_role.sql.go`：sqlc 生成结果。
- `server/internal/service/workflow.go`：事务化 workflow 删除与共享错误。
- `server/internal/service/workflow_delete_integration_test.go`：历史保护和锁串行化。
- `server/internal/handler/workflow.go`：workflow、node、deliverable 删除 409 映射。
- `server/internal/handler/workflow_role.go`：role 删除活动引用保护。
- `server/internal/handler/workflow_delete_test.go`、`workflow_test.go`、`workflow_role_test.go`：HTTP contract。

### Isolation gap closure

- `server/internal/service/workflow_preflight.go`：运行节点分类、annotation 拓扑计数、Split 引用校验。
- `server/internal/service/workflow_preflight_test.go`：节点分类和无效 Split UUID。
- `server/internal/service/workflow_run_prepare.go`：事务内校验 Split 目标 workflow。
- `server/internal/service/workflow_run_prepare_integration_test.go`：annotation、Split 目标与 failed run 回归。
- `server/pkg/db/queries/workflow_snapshot.sql`：failed run 的 `completed_at`。
- `server/pkg/db/generated/workflow_snapshot.sql.go`：sqlc 生成结果。

---

### Task 1: 从 `main` 提取 Split Runtime Config 隔离

**Files:**
- Modify: `server/internal/handler/workflow_split_test.go`
- Modify: `server/internal/service/workflow_split.go`
- Modify: `server/pkg/db/queries/workflow_node_run.sql`
- Modify: `server/pkg/db/generated/workflow_node_run.sql.go`

**Interfaces:**
- Consumes: `WorkflowRuntimeRepository.GetRunNodeConfig(ctx, nodeRunID)` 与 `PrepareWorkflowRunSnapshot(workflowID, params)`，两者均来自 `main`。
- Produces: `PatchWorkflowNodeRunRuntimeConfig(ctx, params)` sqlc 查询；Split 的 PATCH、phase、retry 和 child run 启动不再读取或写入 `multica_workflow_node.format_schema`。

- [ ] **Step 1: 创建隔离 worktree 和 MVP 分支**

执行 `superpowers:using-git-worktrees`，以最新 `main` 为基线创建 `feat/workflow-run-isolation-mvp`。进入新 worktree 后确认：

```powershell
git branch --show-current
git merge-base --is-ancestor main HEAD
git status --short
```

Expected: 当前分支为 MVP 分支，`main` 是其祖先，工作区为空。

- [ ] **Step 2: 只应用已验证提交的 Split 测试补丁**

```powershell
git diff 9f053faf^ 9f053faf -- server/internal/handler/workflow_split_test.go | git apply
```

测试必须覆盖：

```go
// PATCH changes node_run.runtime_config and split_config_version.
// The source workflow_node.format_schema remains byte-for-byte unchanged.
// Retry/schedule paths derive SplitConfig from the node run snapshot.
// Child workflow runs are created through PrepareWorkflowRunSnapshot.
```

- [ ] **Step 3: 运行 Split 定向测试并确认红灯**

```powershell
Set-Location server
go test ./internal/handler -run 'Test(PatchSplitConfig|ScheduleReadyTasks|RetrySplitTask|AddSplitDraftTask)' -count=1
```

Expected: FAIL，失败原因指向仍写入定义配置、缺少 node run runtime config 查询或 child run 未经统一准备服务。

- [ ] **Step 4: 应用 Split 实现和 SQL 补丁**

```powershell
git diff 9f053faf^ 9f053faf -- server/internal/service/workflow_split.go server/pkg/db/queries/workflow_node_run.sql | git apply
```

关键实现必须保持以下边界：

```go
runtimeNode, err := (WorkflowRuntimeRepository{Queries: q}).GetRunNodeConfig(ctx, nodeRun.ID)
cfg, err := parseSplitConfig(runtimeNode.RuntimeConfig)
```

PATCH 使用 node run ID 和 `split_config_version` 做乐观并发更新，不调用 `UpdateWorkflowNode`。

- [ ] **Step 5: 生成 sqlc**

```powershell
Set-Location server
go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1 generate
```

Expected: `workflow_node_run.sql.go` 生成更新；其他生成文件没有语义 diff。

- [ ] **Step 6: 运行 Split 定向测试并确认转绿**

```powershell
Set-Location server
go test ./internal/handler -run 'Test(PatchSplitConfig|ScheduleReadyTasks|RetrySplitTask|AddSplitDraftTask)' -count=1
go test ./internal/service -run 'Test(ParseSplitConfig|Split|PrepareWorkflowRunSnapshot)' -count=1
```

Expected: PASS。

- [ ] **Step 7: 提交 Split 隔离**

```powershell
git add server/internal/handler/workflow_split_test.go server/internal/service/workflow_split.go server/pkg/db/queries/workflow_node_run.sql server/pkg/db/generated/workflow_node_run.sql.go
git commit -m "refactor(workflow): isolate split runtime configuration"
```

---

### Task 2: 暴露 Snapshot-Compatible API Contract

**Files:**
- Modify: `server/internal/handler/workflow_run.go`
- Modify: `server/internal/handler/workflow_runtime_isolation_test.go`
- Modify: `server/internal/service/workflow_run_prepare.go`
- Modify: `server/internal/service/workflow_run_prepare_integration_test.go`
- Modify: `packages/core/types/workflow.ts`
- Modify: `packages/core/api/schemas.ts`
- Modify: `packages/core/api/schema.test.ts`
- Modify: `packages/core/api/schemas.test.ts`
- Modify: `packages/core/api/client.ts`

**Interfaces:**
- Consumes: `WorkflowDefinitionSnapshot` 和 `WorkflowConfigInvalidError` 服务端类型。
- Produces: `WorkflowRunResponse`、`WorkflowNodeRunResponse`、`WorkflowDefinitionSnapshotSchema`、`WorkflowConfigInvalidErrorBodySchema` 和客户端 `WorkflowConfigInvalidError`。

- [ ] **Step 1: 应用服务端和客户端 contract 测试补丁**

```powershell
git diff 8b8e8d07^ 8b8e8d07 -- server/internal/handler/workflow_runtime_isolation_test.go server/internal/service/workflow_run_prepare_integration_test.go packages/core/api/schema.test.ts packages/core/api/schemas.test.ts | git apply
```

测试必须断言：

```json
{
  "code": "workflow_config_invalid",
  "run_id": "non-empty",
  "issues": [{ "code": "worker_missing", "detail": "..." }]
}
```

以及 node run 始终返回 `workflow_node_id`，新响应可额外返回 `source_workflow_node_id`。

- [ ] **Step 2: 运行 contract 测试并确认红灯**

```powershell
Set-Location server
go test ./internal/handler -run 'Test(StartWorkflowRunReturnsStructuredConfigError|WorkflowNodeRunResponseKeepsWorkflowNodeIDAlias)' -count=1
Set-Location ..
pnpm --filter @multica/core exec vitest run api/schema.test.ts api/schemas.test.ts
```

Expected: Go 或 Zod 测试因缺少 snapshot 字段、source ID alias 或结构化错误而 FAIL。

- [ ] **Step 3: 应用已验证的 API 实现补丁**

```powershell
git diff 8b8e8d07^ 8b8e8d07 -- server/internal/handler/workflow_run.go server/internal/service/workflow_run_prepare.go packages/core/types/workflow.ts packages/core/api/schemas.ts packages/core/api/client.ts | git apply
```

服务端 DTO 保持显式映射：

```go
type WorkflowRunResponse struct {
    SourceConfigRevision    int64           `json:"source_config_revision,omitempty"`
    DefinitionSchemaVersion int32           `json:"definition_schema_version,omitempty"`
    DefinitionSnapshot      json.RawMessage `json:"definition_snapshot,omitempty"`
}

type WorkflowNodeRunResponse struct {
    WorkflowNodeID       string `json:"workflow_node_id"`
    SourceWorkflowNodeID string `json:"source_workflow_node_id,omitempty"`
}
```

客户端映射使用：

```ts
const sourceNodeId = nodeRun.source_workflow_node_id ?? nodeRun.workflow_node_id;
```

`WorkflowDefinitionSnapshotSchema` 对未知 schema 返回 `null`，但不拒绝整个 run 响应。

- [ ] **Step 4: 运行 contract 测试并确认转绿**

```powershell
Set-Location server
go test ./internal/handler -run 'Test(StartWorkflowRunReturnsStructuredConfigError|WorkflowNodeRunResponseKeepsWorkflowNodeIDAlias)' -count=1
go test ./internal/service -run 'TestPrepareWorkflowRunSnapshot' -count=1
Set-Location ..
pnpm --filter @multica/core exec vitest run api/schema.test.ts api/schemas.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交 API contract**

```powershell
git add server/internal/handler/workflow_run.go server/internal/handler/workflow_runtime_isolation_test.go server/internal/service/workflow_run_prepare.go server/internal/service/workflow_run_prepare_integration_test.go packages/core/types/workflow.ts packages/core/api/schemas.ts packages/core/api/schema.test.ts packages/core/api/schemas.test.ts packages/core/api/client.ts
git commit -m "feat(workflow): expose snapshot run contracts"
```

---

### Task 3: 从 Snapshot 回放运行详情并保留 Editor Preflight

**Files:**
- Modify: `packages/core/workflows/queries.ts`
- Modify: `packages/core/workflows/queries.test.ts`
- Modify: `packages/views/issues/components/execution/execution-panorama-page.tsx`
- Modify: `packages/views/issues/components/execution/execution-panorama-page.test.tsx`
- Modify: `packages/views/workflows/components/workflow-run-page.tsx`
- Modify: `packages/views/workflows/components/workflow-run-page.test.tsx`
- Modify: `packages/views/locales/en/workflows.json`
- Modify: `packages/views/locales/zh-Hans/workflows.json`

**Interfaces:**
- Consumes: Task 2 的 `WorkflowRun`、`WorkflowNodeRun` 和 snapshot 类型。
- Produces: `workflowRunCanvasDefinition(run, nodeRuns, genericNodeTitle)`，返回 `{nodes, edges, stages}`；run 模式的 `ExecutionPanoramaPage` 不请求当前 definition。

- [ ] **Step 1: 为纯 snapshot model 写失败测试**

在 `packages/core/workflows/queries.test.ts` 增加：

```ts
it("builds a native run canvas only from its definition snapshot", () => {
  const canvas = workflowRunCanvasDefinition(runWithSnapshot, nodeRuns, "Workflow node");
  expect(canvas.nodes.map((node) => node.id)).toEqual(["snapshot-node"]);
  expect(canvas.edges[0]).toMatchObject({
    source_node_id: "snapshot-node",
    target_node_id: "snapshot-end",
  });
});

it("falls back to generic node-run cards for a legacy run without a snapshot", () => {
  const canvas = workflowRunCanvasDefinition(legacyRun, nodeRuns, "Workflow node");
  expect(canvas.nodes[0]).toMatchObject({ id: "source-node", title: "Captured title" });
  expect(canvas.edges).toEqual([]);
});
```

- [ ] **Step 2: 为执行全景页写失败测试**

在 `execution-panorama-page.test.tsx` 增加并保留以下断言：

```ts
expect(mocks.reactFlowProps?.nodes.map((node) => node.id)).toContain("snapshot-node");
expect(mocks.reactFlowProps?.nodes.map((node) => node.id)).not.toContain("current-node");
expect(mocks.workflowDetailOptions).not.toHaveBeenCalled();
expect(mocks.workflowNodesOptions).not.toHaveBeenCalled();
expect(mocks.workflowEdgesOptions).not.toHaveBeenCalled();
```

把三个 option factory mock 定义为 `vi.fn(...)`，否则上述“未请求当前定义”断言不能观测调用。

已验证的 run replay 测试骨架可通过文件级 patch 引入：

```powershell
git diff main...feat/workflow-run-isolation -- packages/views/issues/components/execution/execution-panorama-page.test.tsx | git apply
```

再增加 legacy 提示测试：

```ts
expect(screen.getByText("Historical configuration may be incomplete")).toBeInTheDocument();
```

- [ ] **Step 3: 运行前端测试并确认红灯**

```powershell
pnpm --filter @multica/core exec vitest run workflows/queries.test.ts
pnpm --filter @multica/views exec vitest run issues/components/execution/execution-panorama-page.test.tsx workflows/components/workflow-run-page.test.tsx
```

Expected: FAIL，原因是缺少 canvas helper、run 查询未启用或仍请求当前 definition。

- [ ] **Step 4: 实现纯 canvas model**

从已验证提交提取 query helper，不提取任何 editor 文件：

```powershell
git diff 23780e33^ 23780e33 -- packages/core/workflows/queries.ts | git apply
```

确保 fallback 只使用 node run 快照：

```ts
if (!run.definition_snapshot) {
  return {
    nodes: nodeRuns.map((nodeRun, index) => ({
      id: nodeRun.source_workflow_node_id ?? nodeRun.workflow_node_id,
      title: nodeRun.node_title || genericNodeTitle,
      description: nodeRun.node_description ?? "",
      format_schema: nodeRun.format_schema ?? null,
      position_x: index * 240,
      position_y: 0,
    })),
    edges: [],
    stages: [],
  };
}
```

- [ ] **Step 5: 实现执行全景页的 run-only 查询路径**

从完整分支只提取 execution 文件的已验证实现；若 patch 与最新 `main` 冲突，按以下明确结构手工应用，不触碰 overview/editor 文件：

```powershell
git diff main...feat/workflow-run-isolation -- packages/views/issues/components/execution/execution-panorama-page.tsx | git apply
```

```ts
const { data: run, isLoading: runLoading } = useQuery({
  ...workflowRunOptions(wsId, workflowId, runId ?? ""),
  enabled: Boolean(runId),
});

const runDefinition = useMemo(
  () => run ? workflowRunCanvasDefinition(run, nodeRuns, tWf(($) => $.run.generic_node)) : null,
  [nodeRuns, run, tWf],
);

const allNodes = runId ? runDefinition?.nodes ?? [] : nodes ?? [];
const allEdges = runId ? runDefinition?.edges ?? [] : edges ?? [];
const allStages = runId ? runDefinition?.stages ?? [] : stages ?? [];
```

`workflowDetailOptions`、`workflowNodesOptions`、`workflowEdgesOptions` 和 definition deliverable queries 必须设置 `enabled: !runId`。run 模式的 deliverable 标题来自运行态 submission/requirement 响应。

- [ ] **Step 6: 增加 legacy 状态提示**

在 `WorkflowRunPage` header 中使用紧凑 Badge，不创建新的说明卡片：

```tsx
const isLegacyRun = (run.definition_schema_version ?? 0) <= 0 || !run.definition_snapshot;

{isLegacyRun ? (
  <Badge variant="outline" className="text-[10px] px-1.5 h-4">
    {t(($) => $.run.historical_config_incomplete)}
  </Badge>
) : null}
```

locale 新增：

```json
// en
"historical_config_incomplete": "Historical configuration may be incomplete"

// zh-Hans
"historical_config_incomplete": "历史配置可能不完整"
```

- [ ] **Step 7: 确认 editor preflight 文件零 diff**

```powershell
git diff -- packages/views/workflows/components/overview/preflight-bar.tsx packages/views/workflows/components/overview/workflow-editor-toolbar.tsx packages/views/workflows/components/overview/workflow-panorama-page.tsx
```

Expected: 无输出。不要提取 `23780e33` 对上述文件或 preflight locale 的删除。

- [ ] **Step 8: 运行前端测试并确认转绿**

```powershell
pnpm --filter @multica/core exec vitest run workflows/queries.test.ts
pnpm --filter @multica/views exec vitest run issues/components/execution/execution-panorama-page.test.tsx workflows/components/workflow-run-page.test.tsx workflows/components/overview/preflight-bar.test.tsx workflows/components/overview/workflow-editor-toolbar.test.tsx
```

Expected: snapshot、legacy 和 preflight 回归全部 PASS。

- [ ] **Step 9: 提交详情回放**

```powershell
git add packages/core/workflows/queries.ts packages/core/workflows/queries.test.ts packages/views/issues/components/execution/execution-panorama-page.tsx packages/views/issues/components/execution/execution-panorama-page.test.tsx packages/views/workflows/components/workflow-run-page.tsx packages/views/workflows/components/workflow-run-page.test.tsx packages/views/locales/en/workflows.json packages/views/locales/zh-Hans/workflows.json
git commit -m "feat(workflow): replay run details from snapshots"
```

---

### Task 4: 保护 Workflow 历史与活动 Run 引用

**Files:**
- Modify: `server/pkg/db/queries/workflow.sql`
- Modify: `server/pkg/db/queries/workflow_deliverable.sql`
- Modify: `server/pkg/db/queries/workflow_role.sql`
- Modify: `server/pkg/db/generated/workflow.sql.go`
- Modify: `server/pkg/db/generated/workflow_deliverable.sql.go`
- Modify: `server/pkg/db/generated/workflow_role.sql.go`
- Modify: `server/internal/service/workflow.go`
- Create: `server/internal/service/workflow_delete_integration_test.go`
- Modify: `server/internal/handler/workflow.go`
- Modify: `server/internal/handler/workflow_role.go`
- Modify: `server/internal/handler/workflow_delete_test.go`
- Modify: `server/internal/handler/workflow_test.go`
- Modify: `server/internal/handler/workflow_role_test.go`

**Interfaces:**
- Produces: `ErrWorkflowHasRuns`、`ErrWorkflowDefinitionInUse`、`DeleteWorkflowDefinition(ctx, workflowID)`；sqlc 查询 `WorkflowHasRuns`、`WorkflowNodeHasActiveRunReferences`、`WorkflowDeliverableHasActiveRunReferences`、`WorkflowRoleHasActiveRunReferences`。
- Consumes: `RunDefinitionWrite` 和 `RunWorkspaceRoleWrite` 的既有锁顺序。

- [ ] **Step 1: 写 workflow 历史删除失败测试**

从提交 `6ac14c0c` 提取以下两个测试文件的相关测试：

```powershell
git diff 6ac14c0c^ 6ac14c0c -- server/internal/service/workflow_delete_integration_test.go server/internal/handler/workflow_delete_test.go | git apply
```

保留断言：

```go
if !errors.Is(err, ErrWorkflowHasRuns) { t.Fatalf(...) }
if response["code"] != "workflow_has_runs" { t.Fatalf(...) }
```

- [ ] **Step 2: 写活动 run 定义引用失败测试**

在 handler 测试中分别创建 running run 的 node run、deliverable requirement 和 role snapshot，然后调用删除接口。role case 必须在 run 创建后把当前 workflow node 的 `worker_role_id`/`critic_role_id` 清空，确保删除被阻止的原因是活动 run snapshot，而不是既有 definition reference 检查：

```go
tests := []struct {
    name string
    delete func() *httptest.ResponseRecorder
}{
    {name: "node", delete: deleteCapturedNode},
    {name: "deliverable", delete: deleteCapturedDeliverable},
    {name: "role", delete: deleteCapturedRole},
}
```

每个 case 断言 `409 workflow_definition_in_use`。把 run 更新为 `completed` 后重复删除，断言沿用各接口原有成功状态。

使用明确测试名：

```text
TestDeleteWorkflowNodeWithActiveRunReturnsConflict
TestDeleteWorkflowNodeDeliverableWithActiveRunReturnsConflict
TestDeleteWorkflowRoleWithActiveRunReturnsConflict
```

- [ ] **Step 3: 运行删除测试并确认红灯**

```powershell
Set-Location server
go test ./internal/service -run 'TestDeleteWorkflow' -count=1
go test ./internal/handler -run 'TestDeleteWorkflowWithRun|TestDeleteWorkflow(Node|NodeDeliverable|Role)WithActiveRunReturnsConflict' -count=1
```

Expected: FAIL，当前 workflow 删除未检查历史，定义对象删除未检查 active run snapshot。

- [ ] **Step 4: 添加只读引用查询**

在相应 query 文件加入：

```sql
-- name: WorkflowHasRuns :one
SELECT EXISTS (
    SELECT 1 FROM multica_workflow_run WHERE workflow_id = $1
);

-- name: WorkflowNodeHasActiveRunReferences :one
SELECT EXISTS (
    SELECT 1
    FROM multica_workflow_node_run node_run
    JOIN multica_workflow_run run ON run.id = node_run.workflow_run_id
    WHERE node_run.source_workflow_node_id = $1
      AND run.status NOT IN ('completed', 'failed', 'cancelled')
);

-- name: WorkflowDeliverableHasActiveRunReferences :one
SELECT EXISTS (
    SELECT 1
    FROM multica_workflow_node_run_deliverable requirement
    JOIN multica_workflow_node_run node_run ON node_run.id = requirement.workflow_node_run_id
    JOIN multica_workflow_run run ON run.id = node_run.workflow_run_id
    WHERE requirement.source_deliverable_id = $1
      AND run.status NOT IN ('completed', 'failed', 'cancelled')
);

-- name: WorkflowRoleHasActiveRunReferences :one
SELECT EXISTS (
    SELECT 1
    FROM multica_workflow_node_run node_run
    JOIN multica_workflow_run run ON run.id = node_run.workflow_run_id
    WHERE run.status NOT IN ('completed', 'failed', 'cancelled')
      AND (
        node_run.worker_role_snapshot ->> 'id' = $1::uuid::text
        OR node_run.critic_role_snapshot ->> 'id' = $1::uuid::text
      )
);
```

- [ ] **Step 5: 实现事务化 workflow 删除**

只提取 `6ac14c0c` 中 workflow 删除相关代码，不提取 `workspace_delete.go`、migration 145 或 workspace queries：

```go
var ErrWorkflowHasRuns = errors.New("workflow has runs")
var ErrWorkflowDefinitionInUse = errors.New("workflow definition is used by an active run")

func (s *WorkflowService) DeleteWorkflowDefinition(ctx context.Context, workflowID pgtype.UUID) error {
    return s.runInTx(ctx, func(qtx *db.Queries) error {
        workflow, err := qtx.LockWorkflowDefinitionForUpdate(ctx, workflowID)
        if err != nil { return fmt.Errorf("lock workflow definition: %w", err) }
        hasRuns, err := qtx.WorkflowHasRuns(ctx, workflow.ID)
        if err != nil { return fmt.Errorf("check workflow runs: %w", err) }
        if hasRuns { return ErrWorkflowHasRuns }
        return qtx.DeleteWorkflow(ctx, workflow.ID)
    })
}
```

handler 映射：

```go
if errors.Is(err, service.ErrWorkflowHasRuns) {
    writeCodeError(w, http.StatusConflict, "workflow_has_runs", "workflow has run history and cannot be deleted")
    return
}
```

- [ ] **Step 6: 在既有定义写事务中保护 node 和 deliverable 删除**

在取得 workflow 行锁并确认对象归属后调用查询：

```go
inUse, err := qtx.WorkflowNodeHasActiveRunReferences(ctx, nodeID)
if err != nil { return err }
if inUse { return service.ErrWorkflowDefinitionInUse }
```

deliverable 使用对应查询。handler 统一映射：

```go
if errors.Is(err, service.ErrWorkflowDefinitionInUse) {
    writeCodeError(w, http.StatusConflict, "workflow_definition_in_use", "workflow definition is used by an active run")
    return
}
```

- [ ] **Step 7: 在 workspace role 排他事务中保护 role 删除**

`RunWorkspaceRoleWrite` 已先取得 workspace role 排他 advisory lock。删除前增加：

```go
inUse, err := qtx.WorkflowRoleHasActiveRunReferences(ctx, roleID)
if err != nil { return err }
if inUse { return service.ErrWorkflowDefinitionInUse }
```

保留已有 builtin role 和当前 definition reference 检查；活动 run 检查不能替代它们。

- [ ] **Step 8: 生成 sqlc 并确认无 migration diff**

```powershell
Set-Location server
go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1 generate
Set-Location ..
git diff --name-only -- server/migrations
```

Expected: migration 无输出；仅三个目标 sqlc 文件有语义更新。

- [ ] **Step 9: 运行删除测试并确认转绿**

```powershell
Set-Location server
go test ./internal/service -run 'TestDeleteWorkflow' -count=1
go test ./internal/handler -run 'TestDeleteWorkflowWithRun|TestDeleteWorkflow(Node|NodeDeliverable|Role)WithActiveRunReturnsConflict' -count=1
```

Expected: PASS。

- [ ] **Step 10: 提交删除保护**

```powershell
git add server/pkg/db/queries/workflow.sql server/pkg/db/queries/workflow_deliverable.sql server/pkg/db/queries/workflow_role.sql server/pkg/db/generated/workflow.sql.go server/pkg/db/generated/workflow_deliverable.sql.go server/pkg/db/generated/workflow_role.sql.go server/internal/service/workflow.go server/internal/service/workflow_delete_integration_test.go server/internal/handler/workflow.go server/internal/handler/workflow_role.go server/internal/handler/workflow_delete_test.go server/internal/handler/workflow_test.go server/internal/handler/workflow_role_test.go
git commit -m "fix(workflow): protect workflows with run history"
```

---

### Task 5: 修复剩余 Snapshot Isolation 缺口

**Files:**
- Modify: `server/internal/service/workflow_preflight.go`
- Modify: `server/internal/service/workflow_preflight_test.go`
- Modify: `server/internal/service/workflow_run_prepare.go`
- Modify: `server/internal/service/workflow_run_prepare_integration_test.go`
- Modify: `server/pkg/db/queries/workflow_snapshot.sql`
- Modify: `server/pkg/db/generated/workflow_snapshot.sql.go`

**Interfaces:**
- Produces: `snapshotNodeCreatesRun(kind string) bool` 与 `validateWorkflowDefinitionForRun(ctx, qtx, workflow, snapshot)`。
- Consumes: Task 1 的 Split runtime config、Task 2 的结构化错误 contract。

- [ ] **Step 1: 应用后端回归测试补丁**

```powershell
git diff aeaa2a09^ aeaa2a09 -- server/internal/service/workflow_preflight_test.go server/internal/service/workflow_run_prepare_integration_test.go | git apply
```

保留四类断言：

```go
// annotation does not create a node run or runtime edge
// malformed Split workflow ID yields split_config_invalid
// missing Split target yields split_config_invalid and no runtime entities
// config-invalid run has completed_at
```

- [ ] **Step 2: 运行 prepare/preflight 测试并确认红灯**

```powershell
Set-Location server
go test ./internal/service -run 'TestSnapshotNodeCreatesRun|TestValidateWorkflowDefinition|TestPrepareWorkflowRunSnapshot' -count=1
```

Expected: FAIL，至少包含 annotation materialization、Split target 或 `completed_at` 失败。

- [ ] **Step 3: 实现运行节点分类和 annotation 拓扑计数**

```go
func snapshotNodeCreatesRun(kind string) bool {
    switch kind {
    case WorkflowSnapshotNodeKindStart, WorkflowSnapshotNodeKindEnd, WorkflowSnapshotNodeKindAnnotation:
        return false
    default:
        return true
    }
}
```

`validateSnapshotTopology` 的节点数量只统计非 annotation 节点；`persistPreparedWorkflowRun` 使用该 helper 构建 runtime node ID 集合。

- [ ] **Step 4: 实现 Split 纯校验和事务内目标校验**

纯校验增加 UUID 解析。事务校验执行：

```go
func validateWorkflowDefinitionForRun(
    ctx context.Context,
    qtx *db.Queries,
    workflow db.MulticaWorkflow,
    snapshot WorkflowDefinitionSnapshot,
) ([]WorkflowConfigIssue, error)
```

对每个 Split 目标依次验证：

```text
UUID 合法 -> 非父 workflow -> FOR SHARE 存在 -> 同 workspace -> active -> 不含 nested Split
```

配置问题统一使用 `split_config_invalid`，数据库故障返回 wrapped internal error；最终用 `compareWorkflowConfigIssue` 稳定排序。

- [ ] **Step 5: 为 failed run 写入完成时间**

修改 `CreateWorkflowRunSnapshot`：

```sql
validation_errors,
completed_at
) VALUES (
-- existing values
sqlc.narg('validation_errors'),
CASE WHEN $4 = 'failed' THEN now() ELSE NULL END
)
```

必须复用 `$4`，不要再次声明 `sqlc.arg('status')`，否则 sqlc 会生成重复 `Status` 字段。

- [ ] **Step 6: 生成 sqlc 并运行测试**

```powershell
Set-Location server
go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1 generate
go test ./internal/service -run 'TestSnapshotNodeCreatesRun|TestValidateWorkflowDefinition|TestPrepareWorkflowRunSnapshot' -count=1
```

Expected: PASS。

- [ ] **Step 7: 提交后端隔离修复**

```powershell
git add server/internal/service/workflow_preflight.go server/internal/service/workflow_preflight_test.go server/internal/service/workflow_run_prepare.go server/internal/service/workflow_run_prepare_integration_test.go server/pkg/db/queries/workflow_snapshot.sql server/pkg/db/generated/workflow_snapshot.sql.go
git commit -m "fix(workflow): close snapshot isolation gaps"
```

---

### Task 6: 验证名称快照、Legacy 降级与范围边界

**Files:**
- Modify: `packages/views/issues/components/execution/execution-panorama-page.tsx`
- Modify: `packages/views/issues/components/execution/execution-panorama-page.test.tsx`
- Verify only: editor preflight、workspace deletion、migration、dispatch files

**Interfaces:**
- Consumes: Task 2 的 node run snapshot 字段与 Task 3 的 run-only canvas。
- Produces: concrete actor 名称优先使用 `worker_name_snapshot`/`critic_name_snapshot`，未解析角色优先使用 role snapshot 的 `name`。

- [ ] **Step 1: 添加名称快照失败测试**

如果 Task 3 尚未从完整分支带入这两个测试，加入：

```ts
it("uses captured actor names instead of renamed current entities", () => {
  expect(node.data).toMatchObject({
    workerName: "Original Agent",
    criticName: "Original Reviewer",
  });
});

it("uses the captured role name after the current role is deleted", () => {
  expect(node.data).toMatchObject({
    workerName: "Historical Architect",
    workerIdentity: { type: "role", name: "Historical Architect" },
  });
});
```

- [ ] **Step 2: 运行执行全景测试并确认红灯**

```powershell
pnpm --filter @multica/views exec vitest run issues/components/execution/execution-panorama-page.test.tsx
```

Expected: 若 Task 3 尚未实现名称优先级则 FAIL；如果已随同一文件实现而 PASS，确认断言确实覆盖 renamed/deleted current entity，而不是 mock 恰好为空。

- [ ] **Step 3: 实现安全 snapshot 名称解析**

```ts
function snapshotRoleName(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("name" in value)) return null;
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}
```

`buildConcreteActorIdentity` 接收 `nameOverride?: string | null`；名称快照覆盖当前名称，当前实体只补 avatar 和 presence。unresolved role 使用 `snapshotRoleName(...) ?? renderRoleName(...)`。

- [ ] **Step 4: 运行前端相关测试和类型检查**

```powershell
pnpm --filter @multica/views exec vitest run issues/components/execution/execution-panorama-page.test.tsx workflows/components/workflow-run-page.test.tsx workflows/components/overview/preflight-bar.test.tsx
pnpm --filter @multica/core exec vitest run workflows/queries.test.ts api/schema.test.ts api/schemas.test.ts
pnpm typecheck
```

Expected: PASS。

- [ ] **Step 5: 执行范围静态检查**

```powershell
git diff --name-only main...HEAD
git diff --name-only main...HEAD -- server/internal/service/workspace_delete.go server/pkg/db/queries/workspace.sql server/migrations packages/views/workflows/components/overview/preflight-bar.tsx packages/views/workflows/components/overview/workflow-editor-toolbar.tsx packages/views/workflows/components/overview/workflow-panorama-page.tsx
git diff --check
```

Expected: 第二条命令无输出；diff check 无错误。

扫描新 run 运行路径：

```powershell
rg -n "GetWorkflowNode\(|ListWorkflowEdgesBy(Source|Target)\(|ListWorkflowNodeDeliverables\(" server/internal/service/workflow_split.go server/internal/service/workflow_deliverable_repo.go server/internal/service/task_cscloud_push.go server/internal/service/workflow_topo.go
```

Expected: 不存在以当前 definition 为执行 fallback 的调用；测试夹具或明确 legacy 展示代码不在这些运行服务文件中。

- [ ] **Step 6: 提交名称快照补充（仅在有新增 diff 时）**

```powershell
git add packages/views/issues/components/execution/execution-panorama-page.tsx packages/views/issues/components/execution/execution-panorama-page.test.tsx
git commit -m "fix(workflow): preserve captured actor names"
```

若 Task 3 已包含完全相同的实现且工作区无 diff，则跳过此提交，不创建空 commit。

- [ ] **Step 7: 输出 MVP 变更摘要**

```powershell
git log --oneline main..HEAD
git diff --shortstat main...HEAD
git status --short
```

Expected: 只包含本计划的 5-6 个提交，工作区干净，且实际 diff 不含 Global Constraints 中排除的模块。

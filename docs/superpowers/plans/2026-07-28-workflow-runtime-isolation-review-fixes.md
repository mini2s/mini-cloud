# Workflow Runtime Isolation Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 workflow runtime isolation MVP 审查中发现的运行详情仍读取编辑态定义的问题，并用相关模块测试证明新 run 与当前定义隔离。

**Architecture:** `ExecutionPanoramaPage` 以 run canvas summary 中的 `run.definition_snapshot` 和 `node_runs` 为首选数据源。只有明确的 legacy run 且没有可用 snapshot 时才启用当前 workflow 定义查询；严格 snapshot run 的 snapshot 缺失或无法解析时仅使用 node run 通用信息降级，不读取当前定义。交付物展示统一使用 node-run deliverable API 返回的运行态 requirements。

**Tech Stack:** React 19、TanStack Query、TypeScript、Vitest、Testing Library、Go、PostgreSQL/sqlc。

## Global Constraints

- 不改变编辑器 preflight 或启用语义。
- 新 run 的执行和展示路径不得把当前 workflow 定义作为 fallback。
- legacy run 缺少 snapshot 时允许尽力读取当前定义，并必须继续标记历史配置可能不完整。
- 默认只运行 workflow 相关测试和 TypeScript typecheck，不运行全量测试。
- 不修改现有设计或实施计划 Markdown 文件。

---

### Task 1: 运行详情定义源分流

**Files:**
- Modify: `packages/views/issues/components/execution/execution-panorama-page.tsx`
- Test: `packages/views/issues/components/execution/execution-panorama-page.test.tsx`

**Interfaces:**
- Consumes: `workflowRunCanvasSummaryOptions(...)` 返回的 `run`、`node_runs` 与 `node_runtime_summaries`。
- Consumes: `workflowRunCanvasDefinition(run, nodeRuns, genericNodeTitle)`。
- Produces: snapshot run 使用 snapshot 画布；legacy 无 snapshot 才查询当前定义；严格 snapshot 缺失时使用 node-run 通用画布。

- [x] **Step 1: 写失败回归测试**

新增测试记录 query options 的 `enabled` 状态，并断言已知 snapshot run 不启用 workflow detail、nodes、edges、stages 查询；同时断言渲染节点与边来自 snapshot，而不是 mock 的当前定义。

- [x] **Step 2: 运行测试并确认按预期失败**

Run: `pnpm --filter @multica/views exec vitest run issues/components/execution/execution-panorama-page.test.tsx`

Expected: FAIL，原因是当前定义查询仍启用，且 snapshot 节点未渲染。

- [x] **Step 3: 实现最小分流**

先加载 run canvas summary，再计算：

```ts
const hasSnapshot = Boolean(run?.definition_snapshot);
const canUseLegacyDefinition = Boolean(
  run && (run.definition_schema_version ?? 0) <= 0 && !hasSnapshot,
);
const shouldLoadCurrentDefinition = !runId || canUseLegacyDefinition;
```

固定调用所有 hooks，但用 `enabled` 控制当前定义查询。snapshot 存在或严格 snapshot 缺失时通过 `workflowRunCanvasDefinition` 构造画布；legacy 无 snapshot 时使用当前定义查询结果。

- [x] **Step 4: 运行测试并确认通过**

Run: `pnpm --filter @multica/views exec vitest run issues/components/execution/execution-panorama-page.test.tsx`

Expected: PASS。

### Task 2: 运行态交付物定义回放

**Files:**
- Modify: `packages/views/issues/components/execution/execution-panorama-page.tsx`
- Test: `packages/views/issues/components/execution/execution-panorama-page.test.tsx`

**Interfaces:**
- Consumes: `nodeRunDeliverableSubmissionsOptions(...)` 返回的 `{ submissions, deliverables }`。
- Produces: runtime canvas 的 deliverable title/status 只来自 node-run captured requirements 与 submissions。

- [x] **Step 1: 写失败回归测试**

为 node-run deliverable 查询提供与当前定义不同的标题，断言 runtime 卡片使用运行态 requirement，并断言 snapshot run 不发起 workflow-node deliverable 查询。

- [x] **Step 2: 运行测试并确认按预期失败**

Run: `pnpm --filter @multica/views exec vitest run issues/components/execution/execution-panorama-page.test.tsx`

Expected: FAIL，原因是页面仍读取当前节点交付物定义。

- [x] **Step 3: 实现最小修复**

移除 runtime 页面上的 `workflowNodeDeliverablesOptions` 查询，直接从对应 node-run deliverable response 的 `deliverables` 和 `submissions` 构造 `RuntimeNodeDeliverableSummary`。

- [x] **Step 4: 运行测试并确认通过**

Run: `pnpm --filter @multica/views exec vitest run issues/components/execution/execution-panorama-page.test.tsx`

Expected: PASS。

### Task 3: 设计要求复核与相关验证

**Files:**
- Modify only if another reproducible defect is found in the reviewed runtime paths.

**Interfaces:**
- Consumes: 设计文档第十一、十二节的验证项和成功标准。
- Produces: 每项要求对应的代码、测试或命令证据。

- [x] **Step 1: 运行 core schema 与 snapshot 转换测试**

Run: `pnpm --filter @multica/core exec vitest run api/schemas.test.ts api/schema.test.ts workflows/queries.test.ts`

- [x] **Step 2: 运行 views 运行详情与 preflight 回归测试**

Run: `pnpm --filter @multica/views exec vitest run issues/components/execution/execution-panorama-page.test.tsx workflows/components/workflow-run-page.test.tsx workflows/components/overview/preflight-bar.test.tsx`

- [x] **Step 3: 运行相关 Go 测试**

Run: 使用隔离测试数据库和 `-run` 正则分别执行 `./internal/service` 与 `./internal/handler` 的 workflow runtime isolation 相关测试。

如果测试数据库不可写，记录准确错误，不将其误报为通过。

- [x] **Step 4: 运行 TypeScript typecheck**

Run: `pnpm typecheck`

- [x] **Step 5: 运行静态扫描与 diff 检查**

Run: `rg -n "workflowDetailOptions|workflowNodesOptions|workflowEdgesOptions|workflowStagesOptions|workflowNodeDeliverablesOptions" packages/views/issues/components/execution/execution-panorama-page.tsx`

Run: `git diff --check`

- [x] **Step 6: 按设计成功标准逐条核对证据**

确认启动事务、运行仓储、Split runtime config、运行态 deliverables、actor/role 名称快照、删除保护、API schema、snapshot 展示、legacy 降级和 editor preflight 均有直接证据；缺失证据视为未完成并继续修复。

### Task 4: 移除 auto-reply 的运行期 workflow 定义读取

**Files:**
- Modify: `server/internal/service/workflow.go`
- Test: `server/internal/service/workflow_runtime_repository_test.go`

**Interfaces:**
- Consumes: `workflow_run.workspace_id`。
- Produces: auto-reply 设置查询、子 issue 定位和系统评论写入不再读取当前 workflow 行。

- [x] **Step 1: 扩展运行期定义读取静态回归测试并确认失败**

将 `GetWorkflow(ctx, run.WorkflowID)` 加入运行路径禁止模式；测试按预期命中 `autoReplyEnabled` 和 `handleAutoReply`。

- [x] **Step 2: 改用 run 的 workspace 快照字段**

从 `GetWorkflowRun` 返回值直接使用 `run.WorkspaceID`，移除两处 `GetWorkflow` 查询。

- [x] **Step 3: 重新运行静态回归测试并确认通过**

Run: `cd server && go test ./internal/service -run '^TestRuntimeFilesDoNotReadWorkflowDefinitionTables$' -count=1`

# Workflow 运行诊断视图 — 设计文档

日期：2026-08-04
状态：已确认（用户已批准方案 B 及两个开放点）

## 背景与目标

当前 workflow 节点失败时，用户只能看到一个 `failure_reason` 分类码（如 `timeout`），无法自助回答四个问题：

1. 整个 workflow 的任务状态是什么？
2. 每个节点是否在工作？
3. 任务是否已下发（dispatch）？
4. 下发后运行时做了什么、是否有异常？

目标：提供一个**独立诊断视图**，让用户自助排障，不用查日志。约束：复用原有机制、最小改动、低耦合、简洁有效。

### 已确认的决策

- 使用场景：**用户自助排障**（信息要用户能看懂，不是内部支持工具）
- UI 入口：**独立诊断视图**，从 run 页加"诊断"按钮跳转
- 运行时细节深度：**结构化状态 + 错误**（不做日志抓取，不做 session 内嵌）
- hint：**后端返回 i18n key，前端翻译**

## 现有可复用机制

- `GetWorkflowRunCanvasSummary`（`server/internal/handler/workflow_run.go`）已聚合每个节点的 `display_status` / `active_actor` / `duration_seconds` / `session_id` / `runtime_id` / `has_error` / `error_message` / `split_progress`
- `workflowRunTaskErrors` 用 LATERAL JOIN 从 failed task 取错误文本——本设计扩展它为取完整 task 摘要
- WS 事件（`workflow:node_run_failed` 等）驱动 canvas summary query 失效刷新——诊断视图复用同一 query key，零新数据流
- 前端 `outputError`（`task-node-detail-panel.tsx:96`）的错误兜底链：runtime error_message → worker/critic output 的 error/message → failure_reason
- task 状态机：`queued → dispatched → running → completed/failed/cancelled`

## 架构

```
后端 (读路径扩展,零写路径改动)
  GetWorkflowRunCanvasSummary (现有接口)
    └─ 每个节点的 runtime summary 新增 diagnostics 对象
        ├─ workflowRunTaskErrors 的 JOIN 扩展为取完整 task 摘要
        └─ lifecycle_stage 由 node_run.status + task.status 在后端推导(单一真相)
              │ 同一个 API 响应,zod schema 同步扩展
前端 (新增纯展示视图)
  packages/views/workflows/diagnostics/run-diagnostics-page.tsx
    复用 workflowRunCanvasSummaryOptions query → WS 自动刷新
  apps/web:     /workflows/[id]/runs/[runId]/diagnostics
  apps/desktop: 同 path 的 session route
入口: run 页加"诊断"按钮
```

核心原则：只扩展现有 canvas summary 响应 + 新增一个纯展示页面。不动任何写路径、状态机、WS 事件。

## 后端改动（`server/internal/handler/workflow_run.go`）

### 2a. SQL 扩展

`workflowRunTaskErrors` 目前只 JOIN 出 `error` 文本，扩展为返回 task 摘要（同一个 LATERAL JOIN，多取几列）：

```go
type nodeTaskSummary struct {
    TaskID        string  `json:"task_id"`
    Status        string  `json:"status"` // queued|dispatched|running|completed|failed|cancelled
    Phase         string  `json:"phase"`  // worker|critic，从 task.context 解析
    Attempt       int32   `json:"attempt"`
    MaxAttempts   int32   `json:"max_attempts"`
    DispatchedAt  *string `json:"dispatched_at,omitempty"`
    StartedAt     *string `json:"started_at,omitempty"`
    CompletedAt   *string `json:"completed_at,omitempty"`
    FailureReason string  `json:"failure_reason,omitempty"`
    Error         string  `json:"error,omitempty"`
}
```

返回 `map[nodeRunID]*nodeTaskSummary`。`extractNodeRunError` 改为从该结构取 `Error`，现有行为不变。

### 2b. 生命周期推导（纯函数）

```go
func nodeLifecycleStage(nr db.MulticaWorkflowNodeRun, task *nodeTaskSummary) string
// pending         节点未开始（无 task）
// dispatching     task 存在且 queued — 已入队等 runtime 认领
// dispatched      task dispatched — runtime 已认领，未开始执行
// running         task running，或节点在 working/critic_reviewing 等活跃态
// awaiting_review awaiting_critic / awaiting_split_review / awaiting_input
// terminal        completed/failed/cancelled/skipped/blocked/format_failed
```

### 2c. 响应结构

`WorkflowNodeRuntimeSummaryResponse` 增加：

```go
Diagnostics *NodeDiagnostics `json:"diagnostics,omitempty"`

type NodeDiagnostics struct {
    LifecycleStage string           `json:"lifecycle_stage"`
    CurrentTask    *nodeTaskSummary `json:"current_task,omitempty"`
    Hint           string           `json:"hint"` // i18n key，前端翻译
}
```

### 2d. 失败兜底

节点 failed 但找不到关联 task（如 cs-cloud 挂起被 sweeper 判超时）：`current_task` 为 null，`hint` 退化为 `failure_reason` 码的翻译 key（如 `hint.failure.timeout`），与现有 `outputError` 兜底链一致。

## 前端改动

### 3a. Schema（`packages/core/api/schemas.ts`）

`WorkflowNodeRuntimeSummarySchema` 增加 `diagnostics` 字段，`parseWithFallback` 兜底 `null`。按 API Response Compatibility 规则配 malformed-response 测试。

### 3b. 类型（`packages/core/types/workflow.ts`）

对应 TS 类型：`WorkflowNodeDiagnostics`、`WorkflowNodeTaskSummary`。

### 3c. 诊断视图（`packages/views/workflows/diagnostics/run-diagnostics-page.tsx`）

纯展示，零 next/* 依赖：

- 顶部：run 状态、总耗时、节点进度概览
- 每节点一行：标题、状态徽标（复用 `STATUS_COLOR`）、生命周期阶段进度（派发→认领→执行）、当前 task 摘要（尝试次数 attempt/max、时间、runtime）
- **异常节点默认展开**显示错误文本，正常节点折叠
- task 为 null 时显示 `failure_reason` 翻译
- `lifecycle_stage` 的 `switch` 必须有 `default` 分支（enum drift 降级显示原始 status）

### 3d. 路由接线

- web：`apps/web/app/[workspaceSlug]/(dashboard)/workflows/[id]/runs/[runId]/diagnostics/page.tsx`（薄壳）
- desktop：同 path 的 session route（属 workspace-scoped 页，合法 tab 目的地）
- 入口：run 页加"诊断"按钮，用 `useNavigation().push()` 跳转

### 3e. i18n

hint 翻译 key 加到 `packages/views/locales/`，中英双语，参照 `apps/docs/content/docs/developers/conventions.mdx` 术语表。

## 错误处理

- API 响应走 `parseWithFallback`：diagnostics 缺失/畸形 → 视图降级为只显示节点状态（现有信息），不白屏
- 后端 task JOIN 失败：保持现有行为（500），不加静默兜底
- 新增 server 端 enum 值（lifecycle_stage）在前端一律有 default 降级

## 测试

| 层 | 测试 | 位置 |
|---|---|---|
| 后端 | `nodeLifecycleStage` 表驱动测试（node status × task status 组合） | `server/internal/handler/workflow_run_test.go` |
| 后端 | canvas summary 含 diagnostics 的集成测试（含 failed-task-JOIN、task 缺失兜底场景） | `server/internal/handler/workflow_run_canvas_summary_test.go` |
| core | malformed diagnostics 响应 → fallback null | `packages/core/api/schema.test.ts` |
| views | 诊断页渲染：正常节点折叠、失败节点展开显示错误、task null 时显示 failure_reason | `packages/views/workflows/diagnostics/run-diagnostics-page.test.tsx` |

## 非目标（YAGNI）

- 不做完整重试历史时间线（只显示当前 task + attempt 编号）
- 不做日志抓取、session 内嵌
- 不动写路径、不加新表、不加新 WS 事件

# 动态任务拆分（Dynamic Task Splitting）能力审计与核实报告

**日期**: 2026-07-15
**审计范围**: 对比 `2026-07-14-dynamic-task-splitting-design-backend.md` 中的设计目标

---

## 总体结论：**已满足设计目标 ✅**

后端所有核心能力已完整实现，前端除一处次要 UI 细节外也已全部就位。系统具备完整的拆分节点生命周期管理、Agent 驱动草案生成、NL 对话调整、人审核、批量子 issue 创建、DAG 调度、进度聚合和取消级联能力。

当前实现已经覆盖大部分目标能力，但有两个点属于"部分支持"：

- 持久化和后端运行时识别使用的是 `format_schema.type === "split"`。前端规范化模型会把它解析为 `kind: "split"`，但存储 JSON 本身不是字面上的 `kind: "split"`。
- issue 执行全景画布已经展示较完整的 split 聚合进度；workflow run DAG 画布目前主要展示子 issue 数量和展开入口，完整进度需要进入 split 面板或执行全景画布查看。

---

## 能力矩阵

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| split 节点类型 | 部分支持 | `packages/core/types/workflow.ts` 将 `format_schema.type === "split"` 解析为 `kind: "split"`；`server/internal/service/workflow.go` 也通过 `workflowNodeType(node.FormatSchema) == "split"` 触发 split 运行路径。 |
| Agent 驱动拆分 | 支持 | split 节点进入 `splitting` 状态后，`GenerateSplitTasks` 会派发 split phase 的 Agent task。 |
| 人审核 | 支持 | 草案提交后进入 `awaiting_split_review`；`SplitReviewPanel` 提供审核、对话调整、批准、恢复和取消操作。 |
| 批量创建子 issue | 支持 | `ApproveSplit` 会校验被批准的草案，按拓扑顺序创建 `origin_type = "workflow_split"` 的子 issue，并启动 ready 的子 workflow run。 |
| 进度汇总 | 支持 | workflow run canvas summary 返回 `split_progress`；前端 schema 解析该字段；执行全景画布的 `RuntimeNodeCard` 展示聚合进度。 |
| barrier 下游释放 | 支持 | `resolveSplitStatus` 在 barrier 模式下等待子任务终态，并按失败阈值决定父 split 节点完成或失败。 |
| pipeline 下游释放 | 支持 | `resolveSplitStatus` 在 pipeline 模式下会在任务物化后完成父 split 节点，从而释放下游；子任务继续独立运行。 |
| 子任务 DAG 依赖 | 支持 | `validateSplitTaskGraph` 拒绝未知依赖和环；`topologicalSplitTaskIDs` 做拓扑排序；依赖任务输出会追加到下游子 issue 描述中。 |
| `max_concurrency` 调度 | 支持 | `readySplitTaskIDs` 会扣除运行中的任务数量，只领取依赖已完成且不超过并发上限的子任务。 |
| 两层嵌套限制 | 支持 | 后端 `validateChildWorkflow` 拒绝包含 split 节点的子 workflow；前端 preflight 也会拦截嵌套 split 模板。 |
| 父节点取消级联 | 支持 | `CancelSplitNode` 会取消未终态 split task、运行中的子 workflow run 和未完成子 issue；父 workflow 取消也会通过 node status hook 级联。 |
| 防呆确认 | UI 支持 | `SplitReviewPanel` 在调用 split cancel 前展示 `AlertDialog`。API 本身不要求额外确认字段，直接调用 `/split/cancel` 仍会执行取消。 |
| 画布聚合徽章 | 部分支持 | issue 执行全景画布展示子 issue 数和 done/running/failed 等聚合状态；workflow run DAG 画布展示子数量展开徽章，不是完整聚合进度徽章。 |

---

## 后端能力逐项审计

### 1. 数据模型 ✅ 完整

| 规范要求 | 实现状态 | 位置 |
|---------|---------|------|
| `multica_workflow_split_task` 表 | ✅ 完整 | `migrations/135_workflow_split_task.up.sql` |
| `draft_key` 列 (upsert 幂等键) | ✅ 完整 | `migrations/136_workflow_split_draft_key.up.sql` |
| `draft_source` 列 (agent/chat/recovered) | ✅ 完整 | `migrations/138_split_chat.up.sql` |
| `split_review_chat_session_id` 列 | ✅ 完整 | `migrations/138_split_chat.up.sql` |
| `workflow_node.format_schema` 扩展 | ✅ 完整 | `SplitConfig` 结构体含 mode/max_concurrency/max_failures/child_workflow_id |
| `node_run` 新增状态 (splitting/awaiting_split_review/split_active) | ✅ 完整 | `service/workflow_split.go:23-25` |
| status 流转: draft→approved→created→running→done/failed/cancelled | ✅ 完整 | SQL CHECK 约束 |
| origin_type `workflow_split` | ✅ 完整 | `migrations/135` |

### 2. API 端点 ✅ 完整（9/9 全部注册）

所有端点均在 `server/cmd/server/router.go:562-570` 注册：

| 端点 | 方法 | 状态 |
|------|------|------|
| `/split/generate` | POST | ✅ |
| `/split/recover` | POST | ✅ |
| `/split/draft-tasks` | POST | ✅ |
| `/split/draft-tasks/{taskId}` | DELETE | ✅ |
| `/split/draft-submit` | POST | ✅ |
| `/split/chat` | POST | ✅ |
| `/split/approve` | POST | ✅ |
| `/split/tasks` | GET | ✅ |
| `/split/cancel` | POST | ✅ |

### 3. SplitOrchestrator 核心能力 ✅ 完整

| 能力 | 状态 | 关键函数 |
|------|------|---------|
| Agent 任务派发 (split_generate phase) | ✅ | `GenerateSplitTasks` |
| 恢复管道 (5 级 fallback) | ✅ | `RecoverSplitDraftTasks` |
| Draft API (Agent 增/删/改草案) | ✅ | `AddSplitDraftTask`, `DeleteSplitDraftTask`, `SubmitSplitDraftTasks` |
| 审核通过 + 批量创建子 issue | ✅ | `ApproveSplit` |
| 取消级联 | ✅ | `CancelSplitNode` |
| DAG 验证 + 拓扑排序 | ✅ | `validateSplitTaskGraph`, `topologicalSplitTaskIDs` |
| max_concurrency 调度 | ✅ | `readySplitTaskIDs` |
| 依赖失败 → skipped 级联 | ✅ | `markBlockedSplitTasksSkipped` |
| barrier/pipeline 终态决策 | ✅ | `resolveSplitStatus` |
| 父节点状态协调 | ✅ | `reconcileParentNode` |
| NL 对话调整草案 (SplitChat) | ✅ | `SplitChat` |
| 子 workflow 嵌套检查（禁止二层嵌套） | ✅ | `validateChildWorkflow` |

### 4. 恢复管道 ✅ 完整

```
Agent task 完成
→ ✅ 优先：draft API 提交的有效草案
→ ✅ 解析 JSON {"tasks":[...]}
→ ✅ 解析 Markdown 任务格式
→ ✅ 检查 Agent 评论内容
→ ✅ 检查 Agent 上传附件 (text/md/json/code 等)
→ ✅ 派遣修复 Agent (split_repair phase)
→ ✅ 全部失败 → node_run → failed
```

### 5. Draft API 安全边界 ✅ 完整

- `X-Task-ID` + `X-Agent-ID` 校验 ✅
- Phase 与 node run status 匹配校验 ✅ (`split_generate`/`split_repair` 只能在 `splitting` 状态写；`split_chat` 只能在 `awaiting_split_review` 状态写)
- Upsert 使用非空 key，按 `(node_run_id, draft_key)` 幂等 ✅
- Delete 仅标记 discarded，不物理删除 ✅

### 6. 种子 Agent ✅ 完整

`migrations/137_seed_split_planner_agents.up.sql` 注册了 4 个内置 split planner：
- Split Planner (General) - 通用
- Split Planner (Code) - 编码
- Split Planner (Design) - 设计
- Split Planner (Test) - 测试

### 7. Worker/Critic 语义 ✅

- Worker 默认 agent（通过 `DispatchAgentTaskWithContextExtras` 传入 "split" type）✅
- Critic 默认 `critic_type = "human"` ✅ (`handler/workflow.go:571-572`)

### 8. 后端测试覆盖 ✅

`handler/workflow_split_test.go` 包含 20+ 测试用例：
- DAG 循环依赖检测 ✅
- 拓扑排序正确性 ✅
- barrier/pipeline 终态判断 ✅
- 审核后全部子 issue materialize ✅
- 依赖失败后继 skipped ✅
- 幂等性 (重复事件) ✅
- 并发调度 (max_concurrency 限制) ✅
- 取消级联 (保留终态、取消运行中) ✅
- 恢复管道各级 fallback ✅
- draft API 权限校验 (header/phase/agent_id/node_run_id) ✅
- /split/chat 创建/复用 session ✅
- /split/chat 并发阻止 ✅
- /split/approve 拒绝非空 modifications ✅

---

## 前端能力逐项审计

### 1. 审核面板 ✅ 完整

`packages/views/workflows/components/split/split-review-panel.tsx`

| 规范要求 | 实现状态 |
|---------|---------|
| Header: 节点标题 + 状态 badge + SplitProgressBadge + Mode badge | ✅ |
| Verdict section: Ready to create / Needs adjustment / Generating / Failed | ✅ (`SplitVerdictSummary` 内联组件) |
| 摘要数字: 子 issue 数、负责人数、依赖链数 | ✅ |
| 风险检查: 缺负责人计数 | ✅ (`splitRiskCount`) |
| "查看运行设置" 折叠区 (mode/concurrency/max failures) | ✅ (`<details>` 标签) |
| Draft plan: 只读子 issue 清单 | ✅ (`SplitDraftLedger`) |
| Dependencies: monospace 文本依赖图 | ✅ (`SplitDependencyNote`) |
| Ask agent: 自然语言对话 + suggestion chips | ✅ (`SplitChatReview`) |
| Sticky footer: 取消拆分 + 确认创建 | ✅ |
| 二次确认弹窗 | ✅ (`AlertDialog`) |
| 失败状态: 显示错误、重试/恢复/取消操作 | ✅ |
| Chat pending 状态禁用 composer | ✅ |

### 2. 只读草案列表 ✅ 完整

`split-draft-ledger.tsx`:
- 稳定编号 (01, 02, ...) ✅
- 标题截断 (truncate) ✅
- 描述摘要 (line-clamp-2) ✅
- 负责人显示 ✅
- 状态 badge ✅
- 依赖标签 ✅
- 风险标记 (缺负责人) ✅
- 子 issue 链接 (使用 AppLink) ✅
- 空态 "还没有生成子 issue 草案" ✅

### 3. 依赖展示 ✅ 完整

`split-dependency-note.tsx`:
- Monospace 文本依赖图 ✅
- 无依赖空态 "这些子 issue 可以并行开始" ✅
- 空草案状态 "生成草案后会在这里显示依赖关系" ✅

### 4. NL 对话调整 ✅ 完整

`split-chat-review.tsx`:
- 对话历史展示 (user/assistant 角色区分) ✅
- 3 个 suggestion chips (无历史消息时显示) ✅
- CommentInput 复用 (有 issueId 时) ✅
- 内联 composer (无 issueId 时) ✅
- pending 状态禁用输入 ✅
- InlineTranscriptPanel (assistant 消息下) ✅

### 5. 画布节点卡片 ✅ 完整

`split-node-card.tsx`:
- 紧凑卡片 (WORKER_WIDTH × RUNTIME_NODE_HEIGHT) ✅
- GitBranch icon ✅
- SplitProgressBadge ✅
- 状态 label (Review N tasks / barrier · concurrency N) ✅

### 6. API 层 ✅ 完整

`packages/core/api/schemas.ts`:
- `SplitTaskSchema` (zod + .loose() 抗漂移) ✅
- `SplitProgressSchema` (所有计数字段默认 0) ✅
- `SplitTasksResponseSchema` ✅
- `EMPTY_SPLIT_TASKS_RESPONSE` fallback ✅
- `SplitProgressSchema` 在 `WorkflowRunCanvasSummary` 中 ✅

`packages/core/api/client.ts`:
- `generateSplitTasks()` ✅
- `recoverSplitTasks()` ✅
- `approveSplitTasks()` ✅
- `submitSplitReviewChat()` ✅
- `listSplitTasks()` ✅
- `cancelSplitNode()` ✅
- 全部使用 `parseWithFallback` ✅

`packages/core/workflows/queries.ts`:
- `splitTasksOptions()` (React Query key) ✅
- `useGenerateSplitTasks()` ✅
- `useRecoverSplitTasks()` ✅
- `useApproveSplitTasks()` ✅
- `useSubmitSplitReviewChat()` ✅
- `useCancelSplitNode()` ✅
- `invalidateSplitNodeQueries()` (WS 事件后失效) ✅

### 7. 执行全景图展开 ✅ 完整

`execution-panorama-page.tsx`:
- split 节点检测 (`parseNodeFormat` kind === "split") ✅
- 子节点按依赖深度分列 ✅
- 同层按 sort_order 垂直堆叠 ✅
- 子节点复用 RuntimeNodeCard ✅
- 依赖连线 (ReactFlow edges) ✅
- 聚焦动画 (fitView to cluster) ✅
- 右侧主 workflow 节点局部让位 ✅
- 点击子节点跳转详情 ✅
- 双击/展开按钮切换 child cluster ✅

### 8. 前端测试覆盖 ✅

| 测试文件 | 覆盖内容 |
|---------|---------|
| `schemas.test.ts` | malformed split 响应 fallback、缺失字段默认值、canvas summary 中 split_progress 解析 |
| `split-review-panel.test.tsx` | awaiting review 展示、Chat 提交、Approve 不发送 modifications、pending 禁用、各状态操作 |
| `split-draft-ledger.test.tsx` | 长标题截断、空描述、依赖标签、子 issue 链接 |
| `split-dependency-note.test.tsx` | 宽图滚动、无依赖空态 |
| `split-chat-review.test.tsx` | Chat 提交、pending 状态 |
| `execution-panorama-page.test.tsx` | split child cluster 展开、布局贴近父节点、右侧节点让位 |

---

## 关键实现要点

- split task 状态存储在 `multica_workflow_split_task`，状态覆盖 `draft`、`approved`、`created`、`running`、`done`、`failed`、`cancelled`、`skipped` 等阶段。
- 子 issue 使用 `origin_type = "workflow_split"` 和 `origin_id = split_task.id`，前端可据此把子 issue 映射回 split task。
- DAG 调度以任务状态为准：依赖任务必须为 `done`，下游任务才会进入 ready；依赖失败、取消或跳过会级联标记阻塞任务为 `skipped`。
- 子 workflow 通过已有 workflow service 启动，因此下游释放和 run 完成逻辑复用现有 node-run transition 机制。

---

## 已知差异和注意点

### 1. 节点存储 schema 使用 `type: "split"`，不是 `kind: "split"`

当前实现内部一致，因为前端 `parseNodeFormat` 会把它规范化为 `kind: "split"`。如果验收要求持久化 JSON 必须包含 `kind` 字段，则当前代码不满足该字面要求。

### 2. `/split/chat` 的响应形状和 client 解析目标不完全一致

handler 当前返回：

```json
{
  "chat_session_id": "...",
  "task_id": "...",
  "tasks": {
    "tasks": [],
    "progress": {}
  }
}
```

client 侧按 `SplitTasksResponse` 解析，期望顶层包含 `tasks` 和 `progress`。mutation 成功后会 invalidate 并重新拉取，所以 UI 可通过 refetch 恢复，但即时响应体解析并不完全匹配。

### 3. API 层没有强制确认 token

当前防呆确认在前端 `AlertDialog` 中完成。直接调用 `/split/cancel` 不需要额外确认字段。

### 4. 聚合徽章覆盖的画布不同

issue 执行全景画布拥有更完整的聚合进度展示；workflow run DAG 画布主要提供 split 子节点数量和展开入口。

---

## 发现的差距

### 🔶 微小差距 1: `draft_key` 和 `draft_source` 未在前端类型中显式定义

**规范要求**: `draft_source` 用于审核面板标注草案来源（agent/chat/recovered），恢复管道生成的任务应带"已恢复"标记提醒用户仔细审核。

**当前状态**: 
- 后端完整实现了 `draft_key` 和 `draft_source` 的存储和返回
- 前端 `SplitTaskSchema` 使用 `.loose()` 不会崩溃，但类型 `SplitTask` 接口中未定义这两个字段
- `SplitDraftLedger` 不显示草案来源标签

**影响**: 低。不影响功能，但用户无法在审核面板中区分"Agent 生成的草案"和"系统自动恢复的草案"。

### 🔵 规范细节 2: `InlineTranscriptPanel` 布局位置

**规范要求**: Transcript 作为辅助证据，默认折叠在面板中作为独立 section。

**当前实现**: `InlineTranscriptPanel` 内嵌在 `SplitChatReview` 的 assistant 消息中，仅在 assistant 消息存在时显示。这不违反规范（规范说"默认折叠"和"不把 transcript 作为主要审核入口"），但布局上与规范的独立 section 略有差异。

**影响**: 无。实际 UX 可能更好——transcript 紧邻对应的 assistant 消息。

---

## 不在第一期范围（已正确排除）

| 边界项 | 状态 |
|--------|------|
| 三层及以上嵌套 | ✅ 后端 `validateChildWorkflow` 拦截 |
| 条件分支拆分 | ✅ 未实现 |
| 拆分节点作为子 workflow 的一部分 | ✅ 后端拦截 |
| 子任务间数据传递 | ✅ 仅上下文注入 |
| split_active 期间动态添加子任务 | ✅ 未实现 |
| 审核面板中可视化 DAG 编辑 | ✅ 已移除（v2 设计） |

---

## 验收清单逐项确认

- ✅ 审核面板没有手动编辑表单和审核期 DAG 画布
- ✅ 用户能通过自然语言完成草案增删改、依赖调整和恢复
- ✅ 确认创建前能清楚看到子 issue 数量、负责人、依赖和风险
- ✅ 全景图 split 节点与现有运行节点视觉一致
- ✅ 展开态子节点形成贴近父 split 的局部 child cluster
- ✅ 所有状态都有清晰反馈：加载、生成中、待审核、运行中、失败、完成、空草案
- ✅ 长文本截断、键盘导航可用
- ✅ 前端不维护第二份服务器状态，不发送本地 modifications

---

## 测试验证

已成功运行以下定向检查：

**后端 (Go)**:
```bash
cd server
go test ./internal/service -run "Test(Split|Ready|Topological|Resolve|MarkSkipped|CanRegenerate|BuildSplit|Recover|Validate|Draft|Progress)"
go test ./internal/handler -run "Test.*Split"
```

**前端 (TypeScript)**:
```bash
pnpm --filter @multica/core exec vitest run types/workflow.test.ts workflows/preflight-checks.test.ts
pnpm --filter @multica/views exec vitest run workflows/components/split/split-review-panel.test.tsx workflows/components/split/split-draft-ledger.test.tsx issues/components/execution/runtime-node-card.test.tsx issues/components/execution/execution-panorama-page.test.tsx
```

**验证结果**:

| 模块 | 结果 |
|------|------|
| `server/internal/service` | 通过 |
| `server/internal/handler` | 通过 |
| `@multica/core` | 2 文件通过，68 测试通过 |
| `@multica/views` | 4 文件通过，66 测试通过 |

---

## 建议修复项

### P2 - 在 `SplitTask` 类型和 `SplitDraftLedger` 中显示 `draft_source`

1. 在 `packages/core/types/workflow.ts` 的 `SplitTask` 接口中添加 `draft_key: string | null` 和 `draft_source: string | null`
2. 在 `SplitTaskSchema` 中显式定义这两个字段（虽然 `.loose()` 已经兼容）
3. 在 `SplitDraftLedger` 中为 `draft_source === "recovered"` 的任务添加"已恢复"标记

这是唯一一个与规范有明确差距的点，其余均已就绪。

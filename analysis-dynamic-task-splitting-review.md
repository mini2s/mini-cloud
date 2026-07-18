# 动态任务拆分代码检视报告

> 基于 `docs/superpowers/specs/dynamic-task-splitting-design.md` 对代码实现的系统性检视
>
> 检视日期：2026-07-18 | 分支：`feature/dynamic-task-splitting-design`

## 总体评估

**一致性评级：LOW（~55-60%）**

核心主流程（generate → review → approve → materialize → dispatch）已通路，数据表、API 端点、前端视图均已搭建。但存在 **10 个 Critical** 和 **22 个 Major** 偏差，当前**不具备生产就绪条件**。预计需 4-6 周修复所有 Critical 和 Major 问题。

### 汇总统计

| 指标 | 数量 |
|------|------|
| 🔴 Critical | **10** |
| 🟠 Major | **22** |
| 🟡 Minor | **12** |
| 🔵 Note | **3** |
| 完全未实现的 spec 章节 | **2** |

---

## 各维度汇总

| 维度 | 偏差数 | 整体状态 |
|------|--------|----------|
| 数据模型 | 10 | DB schema 基本完整，TS 类型有 4 个关键缺口 |
| API 设计 | 8 | 14 个端点均已注册，但事务完整性、错误码、级联逻辑有问题 |
| 业务逻辑 | 12 | 主流程通路正确，但可观测性、副作用控制、pipeline 语义未实现 |
| 前端组件 | 14 | UI 框架可用，但配置面板、审核面板、运行全景图均有功能缺口 |
| Preflight 检查 | 5 | 10 项中 2 项完全缺失、2 项 checkId 命名错误 |

---

## 🔴 Critical 偏差（10 项）

### 数据模型（4 项）

| # | 问题 | 文件 | 建议 |
|---|------|------|------|
| 1 | `suggested_assignee_type` 和 `suggested_assignee_id` 列不在 spec 中。Spec 明确声明第一期只支持 workflow 执行方式，这两个列属于超前设计 | `server/migrations/135_workflow_split_task.up.sql:7-8` | 移除这两个列，或移至未来的 migration 中 |
| 2 | `split_initial_dispatch_completed` 列未在 spec 数据模型中定义 | `server/migrations/139_split_task_workflow.up.sql:57-59` | 补充到 spec 的 NodeRun 新增列章节，或移除 |
| 3 | **`WorkflowNodeRun` TS 接口缺少 `split_config_version` 字段** — Go 生成模型有此字段，前端无法实现 PATCH /split/config 的乐观并发控制 | `packages/core/types/workflow.ts:275-304` | 添加 `split_config_version: number` |
| 4 | **`SplitTask` TS 接口缺少 `draft_key` 和 `draft_source`** — 审核面板无法显示 "recovered" 来源标识，upsert API 需要 draft_key | `packages/core/types/workflow.ts:317-332` | 添加 `draft_key: string \| null` 和 `draft_source: string` |

### 业务逻辑（4 项）

| # | 问题 | 文件 | 建议 |
|---|------|------|------|
| 5 | **全部 8 个可观测性事件零实现** — `events.Bus` 已注入 `SplitOrchestrator` 但从未调用 Emit/Publish | `server/internal/service/workflow_split.go` | 在对应生命周期节点调用 `s.Bus.Emit()`，定义事件常量和 payload 结构体 |
| 6 | **拆分阶段副作用控制完全缺失** — 无平台级 X-Task-ID 拦截。Agent 在 `split_generate`/`split_repair`/`split_chat` 阶段可自由修改 issue 状态、创建/更新/分配 issue | `server/internal/handler/agent.go` | 在 issue 更新/创建 handler 中检测 split phase，非 draft API 操作返回 403 |
| 7 | **pipeline 模式行为与 barrier 完全一致** — `resolveSplitStatus` 在 pipeline 模式下仍然等待所有子任务终态才返回 Completed，违反 spec "子 issue 创建后立即释放下游" 的语义 | `server/internal/service/workflow_split.go` | ApproveSplit 的 ScheduleReadyTasks 成功后立即将父节点置为 Completed（利用 `split_initial_dispatch_completed` 标记） |
| 8 | **Dispatch key 幂等机制未调用** — `UpdateSplitTaskRunIDWithDispatchKey` SQL 函数已定义但 Go 代码从未调用 | `server/internal/service/workflow_split.go` | 在 `startChildTaskRun` 中用此函数替代当前的两步更新，dispatch_key 格式为 `split-task:<id>:attempt:<N>` |

### Preflight 检查（2 项）

| # | 问题 | 文件 | 建议 |
|---|------|------|------|
| 9 | `split-default-issue-workflow-invalid` 检查完全缺失 — `PreflightCheckId` 类型联合中无此 ID，无对应函数。指向不存在 workflow 的 split 节点静默通过所有检查 | `packages/core/workflows/preflight-checks.ts:5-22` | 添加到 `PreflightCheckId`，实现检查逻辑，添加测试用例 |
| 10 | `split-max-concurrency-invalid` 检查完全缺失 — 无函数读取 `split_config.max_concurrency`，无效并发值静默通过 | `packages/core/workflows/preflight-checks.ts` | 添加新检查函数，验证值 > 0 且在合理范围内 |

---

## 🟠 Major 偏差（22 项）

### 数据模型（3 项）

| # | 问题 | 文件 | 建议 |
|---|------|------|------|
| 11 | 唯一索引增加了 `status <> 'discarded'` 排除条件，spec 未记录 | `server/migrations/140_workflow_split_draft_key_active_unique.up.sql` | 更新 spec 反映此设计决策 |
| 12 | `SplitTask.workflow_id` TS 类型声明为 `string \| null`，但 DB schema 是 `NOT NULL` | `packages/core/types/workflow.ts:322` | 改为 `workflow_id: string` |
| 13 | `dispatch_key` 和 `last_error` 列未在 spec 正式表 schema 中列出 | `server/migrations/139_split_task_workflow.up.sql:3-5` | 补充到 spec 数据模型定义 |

### API 设计（5 项）

| # | 问题 | 文件 | 建议 |
|---|------|------|------|
| 14 | 批量 draft 写入不原子 — 每个 task 在独立事务中执行，第 3 个失败时前 2 个已提交，违反 spec "整批回滚" 保证 | `server/internal/handler/workflow_split.go` | 将整批写入移入单一 DB 事务 |
| 15 | Approve 所有错误统一映射为 HTTP 400，未区分 spec 指定的 422/409 | `server/internal/handler/workflow_split.go:609` | 区分映射：limit/invalid workflow/invalid dep → 422，版本冲突 → 409 |
| 16 | Cancel 级联不区分 `discarded`（未物化草案）和 `cancelled`（已物化任务），全部设为 `cancelled` | `server/pkg/db/queries/workflow_split_task.sql` | `issue_id IS NULL` → `discarded`，`issue_id IS NOT NULL` → `cancelled`/`skipped` |
| 17 | 手动新增草案的 POST 端点要求 X-Task-ID/X-Agent-ID header，人类审核者无法使用 | `server/internal/handler/workflow_split.go:388-396` | 区分调用者：无 agent header 时走人类审核路径（验证 workspace 成员 + node_run 状态） |
| 18 | workflow-options 路由为 `GET /api/workflows/{id}/split/issue-workflow-options`，spec 为 `GET /api/workflows/split-issue-workflow-options?parent_workflow_id=` | `server/cmd/server/router.go` | 统一路由或更新 spec |

### 业务逻辑（6 项）

| # | 问题 | 文件 | 建议 |
|---|------|------|------|
| 19 | `validateDraftSplitTaskRows` 拒绝空草案（`len(plans) == 0` 返回错误），与 spec "允许 0 个草案" 矛盾 | `server/internal/service/workflow_split.go` | 允许空草案提交，在 approve 阶段用 `confirm_empty: true` 统一处理 |
| 20 | barrier 模式失败计数仅含 `failed`，不含 `cancelled`。用户取消的子任务不计入 `max_failures` | `server/internal/service/workflow_split.go` | 包含 `cancelled` 状态到失败计数，或确认此为有意的设计变更并更新 spec |
| 21 | `RetrySplitTask` 调用 `ResetSplitTaskForRetry` 清除 dispatch_key，但后续 `ClaimSplitTaskForRunStart` 不设置新值 | `server/internal/service/workflow_split.go` | 重试时生成新的 dispatch_key（attempt+1）并通过 `UpdateSplitTaskRunIDWithDispatchKey` 设置 |
| 22 | 父 issue 活跃 split 期间无硬删除保护 — 可直接删除处于 splitting/awaiting_split_review/split_active 的父 issue | `server/internal/handler/issue.go` | 添加检查：存在活跃 split node run 时拒绝删除，返回 409 |
| 23 | `ApproveSplit` 版本冲突错误通过字符串匹配检测（"split config version conflict"），脆弱 | `server/internal/handler/workflow_split.go` | 改用 sentinel error 或自定义错误类型 |
| 24 | pipeline 模式 initial dispatch 中单个 `startChildTaskRun` 失败时未立即置父节点为 failed | `server/internal/service/workflow_split.go` | 在 initial dispatch 中任一启动失败时直接 transition 父节点到 failed |

### 前端（7 项）

| # | 问题 | 文件 | 建议 |
|---|------|------|------|
| 25 | 配置面板缺少 Connection summary 区域，信息顺序（Split behavior 在 Worker/Critic 之前）与 spec 规定不符 | `packages/views/workflows/components/node-config-panel.tsx` | 添加 Connection summary section，调整顺序为 Readiness → Node intent → Worker/Critic → Split behavior → Connection summary → Actions |
| 26 | splitting 状态只有静态 "Generating draft" 文字，缺少 60 秒超时提示、elapsed time 计数器和 Planner agent 名称 | `packages/views/workflows/components/split/split-review-panel.tsx` | 添加实时 elapsed time、Planner 名称，60 秒后显示 "Planner is still generating drafts..." |
| 27 | 缺少"试跑"按钮 | `packages/views/workflows/components/node-config-panel.tsx` | 在 Actions 区域添加 Trial run 按钮 |
| 28 | 运行全景图 split 收起态无 mode badge（barrier/pipeline 标签） | `packages/views/issues/components/execution/runtime-node-card.tsx` | 添加 mode badge 到 split 节点的收起态 |
| 29 | 子 issue 依赖关系用原始 SVG path 渲染，未使用 ReactFlow edges | `packages/views/issues/components/execution/execution-panorama-page.tsx` | 添加 ReactFlow edges 或确认 SVG 方案可接受 |
| 30 | 取消确认弹窗未显示受影响子任务数量 | `packages/views/workflows/components/split/split-review-panel.tsx` | 显示 "{{count}} child tasks will be cancelled" |
| 31 | `SplitTask` TS 接口缺少 `draft_key` 和 `draft_source`（同 Critical #4，前端视角） | `packages/core/types/workflow.ts` | 同 Critical #4 |

### Preflight 检查（2 项）

| # | 问题 | 文件 | 建议 |
|---|------|------|------|
| 32 | `split-planner-missing` 实际 emit 的 checkId 是 `worker-missing` | `packages/core/workflows/preflight-checks.ts:231` | Emit `split-planner-missing` 当 node type 为 split |
| 33 | `split-planner-not-specialized` 实际 emit 的 checkId 是 `split-worker-non-specialized` | `packages/core/workflows/preflight-checks.ts:290` | 重命名为 `split-planner-not-specialized` |

---

## 🟡 Minor 偏差（12 项）

| # | 问题 | 文件 | 建议 |
|---|------|------|------|
| 34 | `SplitTaskResponse` 缺少 `DraftKey` 和 `DraftSource` 字段 | `server/internal/handler/workflow_split.go` | 添加并映射自 DB 模型 |
| 35 | 单条 draft 请求的 JSON tag 为 `key`，批量端点为 `draft_key`，不一致 | `server/internal/service/workflow_split.go` | 统一为 `draft_key` |
| 36 | Draft task PATCH 版本冲突错误消息为 "split draft task version conflict"，spec 要求 "draft_task_conflict" | `server/internal/handler/workflow_split.go` | 标准化错误码命名 |
| 37 | 3 个未在 spec 记录的端点：`POST /split/draft-submit`、`POST /split/reset-original`、`DELETE /split/draft-tasks/{taskId}` | `server/cmd/server/router.go` | 补充到 spec API 设计章节 |
| 38 | `workflow_run.dispatch_key` 未在 spec 中说明是否属于 split 系统数据模型 | `server/migrations/139_split_task_workflow.up.sql` | 补充文档或在 spec 中说明 |
| 39 | 额外 6 个操作性索引未在 spec 中列出 | `server/migrations/135_workflow_split_task.up.sql` 等 | 合理但应补充到 spec |
| 40 | `split_review_chat_session_id` TS 类型标记为 optional（`?`），Go 模型始终包含（nullable） | `packages/core/types/workflow.ts:299` | 统一语义 |
| 41 | 草案行不显示 version 字段 | `packages/views/workflows/components/split/split-draft-ledger.tsx` | 添加版本号显示 |
| 42 | 依赖文本图未使用 monospace 字体 | `packages/views/workflows/components/split/split-dependency-note.tsx` | 添加 `font-mono` |
| 43 | 配置面板 Readiness 区域只显示 3 个阻断检查，未集成 warning 级别检查 | `packages/views/workflows/components/node-config-panel.tsx` | 集成完整 preflight 输出 |
| 44 | 英文文案 "Failure tolerance" 应为 spec 规定的 "Failure policy" | `packages/views/locales/en/workflows.json` | 修改为 "Failure policy" |
| 45 | 审核面板 completed 状态缺少专门的汇总视图 | `packages/views/workflows/components/split/split-review-panel.tsx` | 考虑添加突出最终结果的汇总视图 |

---

## 完全未实现的 Spec 章节

### 1. 可观测性（Observability）

全部 8 个生命周期事件均为零实现。`SplitOrchestrator` 持有 `events.Bus` 但从未调用：

| 事件 | 触发时机 | 状态 |
|------|---------|------|
| `split_generation_dispatched` | Planner agent task 已派发 | ❌ 未实现 |
| `split_context_rendered` | 结构化上下文已注入 prompt | ❌ 未实现 |
| `split_draft_added` | 单条草案通过 draft API 写入 | ❌ 未实现 |
| `split_draft_submit_failed` | draft submit 失败 | ❌ 未实现 |
| `split_draft_submitted` | draft submit 成功，进入审核 | ❌ 未实现 |
| `split_review_ready` | 状态切换为 awaiting_split_review | ❌ 未实现 |
| `split_approved` | 审核确认，子 issue 已创建 | ❌ 未实现 |
| `split_child_issue_created` | 单个子 issue materialize 完成 | ❌ 未实现 |

### 2. 拆分阶段副作用控制（Split-Phase Side-Effect Control）

spec 规定的基于 X-Task-ID 的平台级拦截完全缺失：

| 操作类型 | Spec 策略 | 实际状态 |
|---------|----------|----------|
| 只读查询 | 允许 | ✅ 无拦截（正常） |
| Draft API 调用 | 允许 | ✅ 有访问验证 |
| Issue 状态变更 | **禁止** | ❌ 无拦截 |
| Issue 创建/更新/分配 | **禁止** | ❌ 无拦截 |
| 评论和附件 | 允许（仅恢复素材） | ✅ 无拦截（正常） |

---

## 修复优先级建议

### P0 — 本周（阻断上线）

1. **pipeline 模式语义修正** — 子 issue 创建后立即释放下游，而非等待全部完成
2. **拆分阶段副作用控制** — X-Task-ID 拦截，阻止 Agent 在 split 阶段修改 issue
3. **批量写入事务化** — draft tasks batch 写入改用单一事务
4. **TypeScript 类型补全** — `split_config_version`、`draft_key`、`draft_source`

### P1 — 2 周内（功能完整性）

5. **可观测性事件** — 全部 8 个生命周期事件
6. **空草案支持** — 允许 Planner 生成 0 个草案
7. **Dispatch key 幂等** — 调用 `UpdateSplitTaskRunIDWithDispatchKey`
8. **Preflight 缺失检查** — `split-default-issue-workflow-invalid` + `split-max-concurrency-invalid`
9. **Approve 错误码映射** — 422/409 区分
10. **Preflight checkId 命名修正** — `worker-missing` → `split-planner-missing` 等

### P2 — 4 周内（体验完善）

11. **前端审核面板完善** — 60s 提示、elapsed time、Planner 名称、mode badge
12. **配置面板对齐** — Connection summary、信息顺序、试跑按钮
13. **取消确认优化** — 显示受影响子任务数量
14. **父 issue 删除保护** — 活跃 split 期间拒绝硬删除
15. **文案修正** — "Failure policy"、monospace 依赖图、version 显示等

---

## 检视覆盖范围

| 维度 | 检视文件数 | Agent |
|------|-----------|-------|
| 文件映射 | 45 个源文件 | map-files-to-spec |
| 数据模型 | 12 个文件（migration SQL + Go models + TS types） | review-data-model |
| API 设计 | 3 个文件（handler + router + service） | review-api |
| 业务逻辑 | 3 个文件（service + handler + agent） | review-business-logic |
| 前端组件 | 12 个文件（views + types + preflight） | review-frontend |
| Preflight 检查 | 2 个文件（checks + tests） | review-preflight |
| 汇总综合 | 全部 5 维度的结果 | synthesize-report |

---

*检视由 Claude Code Workflow 自动执行，7 个 Agent 并行分析，共 172 次工具调用，消费 ~631K tokens。*

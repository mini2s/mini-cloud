# 动态任务拆分 — 业务流程审查报告

> 审查范围：「Issue 全景图 → 详情面板 → Agent 调整」链路中与任务拆分相关的后端业务逻辑 + 前端草案调整交互
> 审查日期：2026-07-16
> 审查依据：PRD `docs/workflows/dynamic-task-splitting.md` + 源码（前后端全链路）

---

## 一、严重缺陷（影响业务闭环正确性）

### 1.1 Pipeline 模式下子任务启动失败留下僵尸依赖任务（已修复）

**位置**：`workflow_split.go:ScheduleReadyTasks` (L1529-1604)

**问题描述**：当 `ScheduleReadyTasks` 中 `startChildTaskRun` 失败后，任务被标记为 `failed`，但 `markBlockedDependents` **已经在事务内执行过且不会再次调用**。依赖该失败任务的其他子任务永远处于 `created` 状态，成为僵尸任务。

**根因分析**：
```
ScheduleReadyTasks 事务内执行顺序：
1. ClaimSplitTaskForRunStart（任务 A → running）
2. markBlockedDependents（此时任务 A 是 running，所以 B 不会被 skip）
3. 事务提交
4. startChildTaskRun(A) → 失败！
5. UpdateSplitTaskStatus(A → failed)
6. 返回 error
```

此时 B（依赖于 A）仍为 `created`，但 A 已 `failed`。如果没有后续事件触发 `ScheduleReadyTasks`，B 永远停留在 `created`，既不会启动也不会被 skip。

**PRD 对照**：违反验收标准 "被依赖的子 issue 完成后，依赖它的子 issue 才开始执行；循环依赖在定义时被拒绝"。失败也是一种终态，依赖链应该继续传递。

**修复状态**：已修复。`startChildTaskRun` 失败并将任务标记为 `failed` 后，`ScheduleReadyTasks` 会再次调用 `markBlockedDependents` 传播级联 `skipped`，并调用 `reconcileParentNode` 让父 split node 根据失败阈值收敛到 `failed` 或 `completed`。新增 `TestScheduleReadyTasksSkipsDependentsAfterStartFailure` 覆盖该场景。

---

### 1.2 取消父节点时未按非终态语义处理子运行（已硬化）

**位置**：`workflow_split.go:CancelSplitNode` (L1482-1492)

```go
if task.RunID.Valid {
    run, err := s.Queries.GetWorkflowRun(ctx, task.RunID)
    ...
    if run.Status == RunStatusRunning {   // ← 只处理 running
        if err := s.WfService.CancelRun(ctx, task.RunID); err != nil {
            return nil, fmt.Errorf("cancel child run: %w", err)
        }
    }
}
```

**核实结论**：当前 `multica_workflow_run.status` 只允许 `running`、`completed`、`failed`、`cancelled`，不存在 `pending` 子工作流运行状态；原先“pending 子运行未取消”的描述不符合当前 schema。实际可改进点是取消逻辑不应写死 `RunStatusRunning`，否则未来增加新的非终态 run 状态时会再次遗漏。

**业务影响**：当前生产风险低；防御性硬化后，取消父任务会取消所有非终态子 workflow run，而不是只识别 `running`。

**修复状态**：已硬化。`CancelSplitNode` 使用非终态判断取消子运行：
```go
if run.Status != RunStatusCompleted && run.Status != RunStatusCancelled && run.Status != RunStatusFailed {
    if err := s.WfService.CancelRun(ctx, task.RunID); err != nil {...}
}
```

---

### 1.3 重复审批可将已实体化的子任务回退到 `approved`（已修复）

**位置**：`workflow_split.go:ApproveSplit` (L1347-1464) + `workflow_split_task.sql:MarkSplitTasksApproved` (L91-96)

```sql
UPDATE multica_workflow_split_task
SET status = 'approved',
    updated_at = now()
WHERE node_run_id = $1
  AND id = ANY($2::uuid[])
  AND status = 'draft';
```

**原问题链路**：
```
1. 审批请求 A 进入事务，锁定 node_run (status=awaiting_split_review)
2. 事务内：MarkSplitTasksApproved(任务 X → approved)
3. 事务内：创建 child issue，UpdateSplitTaskIssueID(任务 X → created)
4. 事务提交
5. ← 此时 node_run 仍为 awaiting_split_review！（TransitionNodeRun 在事务外）
6. 审批请求 B（重放或并发）进入，锁定 node_run（仍为 awaiting_split_review）
7. 事务内：MarkSplitTasksApproved(任务 X → approved)  ← 把 created 回退到 approved！
8. 任务 X 已创建的 child issue 变成了孤儿，任务 X 卡在 approved 不再被调度
```

**核实结论**：关键回退风险已修复。当前 `MarkSplitTasksApproved` 已增加 `AND status = 'draft'` 过滤，重复审批或重放请求不会再把 `created` / `running` 任务回退为 `approved`。已有 `TestApproveSplitTasksDoesNotRegressCreatedTaskOnReplay` 覆盖该场景。

**剩余风险**：`ApproveSplit` 中节点状态转换仍在实体化事务之后执行；当前状态过滤已经阻断“已实体化任务回退”这一 P0 后果，但审批流程仍可在后续架构整理时考虑把实体化和节点状态转换合并为更完整的幂等操作。

**修复状态**：已修复关键缺陷，保留“审批全流程原子化”作为后续稳健性增强项。

---

## 二、草案调整专项审查（人工编辑 + Chat 辅助）

> 「调整子 Issue 草案」有两个入口：**人工编辑**（PATCH 字段级增量更新，version 乐观锁）和 **Chat 辅助**（Agent CLI → `AddSplitDraftTask` API，或 Agent 输出 → markdown 解析 → `replaceSplitDraftTasksFromPayload` 全量替换）。三种路径共享同一份草案数据但调整机制完全不同，存在结构性矛盾。

### 2.1 功能概况

| 路径 | 触发方式 | 数据流 | 并发控制 |
|------|---------|--------|---------|
| **人工编辑** | 用户在 SplitReviewPanel 中直接编辑草案字段 | 前端 → `PATCH /split/draft-tasks/{id}` → DB | version 乐观锁 |
| **Agent API** | Agent 在 Chat 会话中调用 draft CLI | Agent → `POST /split/draft-tasks` → DB | 按 key upsert |
| **Chat 解析** | Agent 完成后输出 markdown，服务端解析 | Agent 输出 → `replaceSplitDraftTasksFromPayload` | 快照比对（静默丢弃） |

---

### 2.2 Chat 任务卡死导致审核永久阻塞（P0，已修复）

**位置**：`workflow_split.go:SplitChat:2196` → `handleTaskCompletion:1248` → `GetPendingChatTask` + `task.go:CompleteTask`

**修复状态**：已修复。当前 `HandleTaskCompletion` 在 split chat 完成处理失败时会调用 `TaskSvc.FailTask(..., "split_chat_adjustment_failed")` 将任务标记为 `failed`，避免任务长期停留在 `running` 并阻塞后续 Chat。已有 `TestSplitChatCompletionWithoutDraftUpdateReturnsError` 覆盖失败后可再次发起 split chat。

**问题链路**：
```
1. 用户发送 chat 消息 → SplitChat 创建 Agent 任务
2. Agent 完成了回复，但输出无法被解析为草案变更
3. OnTaskCompleting 钩子返回 error → CompleteTask 失败
4. Agent 任务停留在 running 状态
5. 用户再次尝试发送 chat → GetPendingChatTask 查到 running 的任务
6. 返回 "another split chat task is already in progress" (409)
7. 用户永远无法再发起 chat
```

**关键代码**：
```go
// SplitChat: 检测并发任务
pendingTask, err := s.Queries.GetPendingChatTask(ctx, nodeRun.SplitReviewChatSessionID)
if err == nil && pendingTask.ID.Valid {
    return nil, fmt.Errorf("another split chat task is already in progress")
}
// GetPendingChatTask 查询条件: WHERE status IN ('queued', 'dispatched', 'running')
```

**根因**：Chat 任务在 "Agent 正常回复但输出无法解析" 的场景下，`onTaskCompleting` 拒绝了完成请求，但没有退回机制将任务标记为终态。只要任务还是 `running`，`GetPendingChatTask` 就一直拦截后续请求。

**修复建议**：
- 方案 A：`onTaskCompleting` 拒绝时，将任务标记为 `failed`（而非保持 `running`），并在 chat 消息中展示失败原因
- 方案 B：`GetPendingChatTask` 增加超时判断，超过 N 分钟的 running 任务视为失效
- 推荐 A+B 组合：先防卡死，再加自愈

---

### 2.3 Chat 输出解析采用全量替换策略，丢失人工编辑（P2，暂不修复）

**位置**：`workflow_split.go:handleTaskCompletion` → `replaceSplitDraftTasksFromPayload` (L718-811)

**暂不修复理由**：修复此问题需要 Chat 调整支持增量更新语义而非全量替换，涉及 `replaceSplitDraftTasksFromPayload` 的核心语义变更和 fallback payload 协议扩展。当前阶段已有 reset-original 作为逃生舱（2.9 已修复），用户可通过 Chat 要求 Agent 重新生成，或在编辑被覆盖后回退到原始提案。建议在下一轮 NL 调整原子性架构升级时一并修复。

**问题链路**：
```
1. Agent 生成 3 个草案 → 用户审核中
2. 用户手动编辑了草案 B 的标题和 workflow
3. 用户发送 chat "把草案 A 的描述写详细些"
4. Agent 回复了 markdown 格式的新草案列表
5. replaceSplitDraftTasksFromPayload:
   a. 丢弃全部 3 个现有草案 → discarded
   b. 从 Agent 输出创建全新草案
6. 用户对草案 B 的人工编辑永久丢失
```

**关键代码**：
```go
// 第一步：无条件丢弃所有现有草案
for _, task := range existing {
    switch task.Status {
    case SplitTaskStatusDraft, SplitTaskStatusDiscarded:
        // → discarded（包括用户手动编辑过的草案！）
    }
}
// 第二步：从 payload 创建全新草案
for i, generated := range payload.Tasks {
    // CreateSplitTask with new IDs
}
```

**根因**：`replaceSplitDraftTasksFromPayload` 的设计语义是"Agent 输出 = 唯一真相源"。这在生成（generate）阶段合理，但在 Chat 调整阶段不符合用户预期——用户期望 Agent 只修改它被要求修改的部分，而非重写全部。对于"把任务 1 改名"这类局部调整，fallback 输出如果只包含一个任务，其余草案会被意外丢弃。

**修复建议**：
- Chat 调整应支持**增量更新**语义而非全量替换
- fallback 输出应声明意图：`replace_all` vs `patch`。未显式声明 `replace_all` 时，markdown 解析不应替换整个草案集
- 优先使用结构化 fallback payload 而非标题解析

---

### 2.4 Chat 完成时并发编辑检测「静默丢弃」（P3，暂不修复）

**位置**：`workflow_split.go:splitChatDraftsChanged` (L2403-2445) + `handleTaskCompletion` (L1207-1209)

**暂不修复理由**：该问题触发条件较严格（用户在 Agent 执行期间手动编辑草案），且现有设计已正确检测到冲突并保护了用户的手动编辑不被 Agent 覆盖。静默丢弃 Agent 结果是正确行为（保护用户编辑优先），缺少的只是对用户的提示反馈。可在后续 UX 优化中补充。

**问题链路**：
```
1. 用户发送 chat，context 包含当前草案快照 [A, B, C]
2. Agent 处理中... 用户手动将草案 C 标记为 discarded
3. Agent 完成，输出 markdown 草案调整
4. splitChatDraftsChanged 比对：current(2个活跃) ≠ payload(3个) → true
5. 返回 nil，任务正常完成，Agent 的草案变更被静默丢弃
6. 用户体验：Chat 面板显示 Agent 回复"我已调整任务..."，但草案列表没变化
```

**问题**：对用户来说 Agent 的回复与草案状态不一致，造成困惑；对 Agent 来说没有反馈告知其修改被拒绝，下轮对话可能基于错误假设。

**修复建议**：草案被并发修改导致变更被丢弃时，应自动创建一条 system 消息告知用户和 Agent："草案在你回复期间被修改，调整未应用"。同时保留 Agent 的提议结果供用户查看，并提供基于最新草案集的重试入口。

---

### 2.5 NL 调整整体非原子性：多步操作无回滚能力（P3，暂不修复）

**位置**：`workflow_split.go:AddSplitDraftTask` + `DeleteSplitDraftTask` + `SubmitSplitDraftTasks`

**暂不修复理由**：修复此问题需要引入暂存区架构或自动回滚机制，属于 NL 调整的底层架构升级。当前生产中分裂节点的草案调整以人工编辑和单步 CLI 操作为主，多步复合操作（如"合并两个任务"）触发概率较低。Agent 在执行多步操作时可通过前置校验（先检查所有依赖是否存在）降低风险。建议在下一轮 Chat 调整架构迭代时整体解决。

**问题描述**：NL 调整的正式路径是：用户提出修改请求 → Agent 通过 `cs-workflow workflow split draft delete/add/submit` CLI 执行。每个 CLI 操作独立持久化。如果 Agent 执行"删除草案 C → 新增合并草案 D → submit"三步操作，第三步（submit）因依赖校验失败时，前两步已提交，草案集处于半变更状态。

**典型场景**：
```
用户: "合并任务 2 和任务 3"
Agent:
  1. DeleteSplitDraftTask(任务 2) → 成功，已持久化
  2. DeleteSplitDraftTask(任务 3) → 成功，已持久化
  3. AddSplitDraftTask(任务 4, depends_on=[任务1]) → 失败！依赖 key 不存在
结果: 任务 2 和 3 已删除，但合并后的新任务未创建。草案集残缺。
```

**业务影响**：一次合理的 NL 调整请求可能导致草案集丢失内容，用户需要手动恢复。

**修复建议**：
- 为每个 Chat 调整会话引入暂存区：Agent 的变更先写入暂存，submit 时原子性应用全部变更
- 短期方案：submit 失败时自动回滚当前 Chat 任务所产生的所有变更（基于 `draft_source = 'chat'` 标记）

---

### 2.6 批量添加草案时的依赖解析顺序敏感（P2，暂不修复）

**位置**：`handler/workflow_split.go:BatchAddSplitDraftTasks` (L392-436) + `workflow_split.go:AddSplitDraftTask` (L881-894)

**暂不修复理由**：问题 A（非事务性）影响范围大但实际触发需要 Agent 批量添加且部分失败；问题 B（依赖顺序敏感）可以通过 Agent 输出拓扑序排列来规避。修复需要将 Batch 端点改造为单事务 + 内存 DAG 解析，改动量中等。当前 Agent 输出天然按拓扑序排列，所以 B 的实际触发概率较低。建议在下一轮 Chat 调整原子性升级时一并修复。

**双重问题**：

**问题 A — 非事务性**：`AddSplitDraftTask` 内部使用独立事务，批量请求中第 N 个失败时前 N-1 个已提交，DB 处于部分应用状态。

**问题 B — 依赖解析顺序敏感**：每个 `AddSplitDraftTask` 只基于**已持久化到 DB** 的草案解析依赖：
```go
for _, depKey := range req.DependsOnKeys {
    dep, ok := byKey[depKey]   // byKey 只包含已存在的草案
    if !ok || dep.Status == SplitTaskStatusDiscarded {
        return fmt.Errorf("unknown dependency key %s", depKey)
    }
}
```
如果 Agent 一次提交 3 个草案 [X→Y→Z]，其中 Y 依赖 X、Z 依赖 Y，必须按拓扑序排列请求。逆序提交会因依赖目标尚不存在而失败。一个合法的 DAG 因命令顺序而失败，留下部分编辑。

**修复建议**：
- 将整个 batch 包裹在同一个事务中
- Batch 端点应先读取全部提交的草案，在内存中解析依赖关系，最后统一写入并一次性校验完整 DAG

---

### 2.7 Upsert 自动复活 discarded 草案（P2，已修复）

**位置**：`workflow_split_task.sql:UpsertSplitDraftTaskByKey` (L18-30)

**修复状态**：已修复。`draft_key` 唯一索引已调整为只约束非 `discarded` 草案，`UpsertSplitDraftTaskByKey` 也只更新 `draft` 状态的冲突行；复用已丢弃草案的 key 时会创建新的 active draft，而不是把旧行从 `discarded` 复活。

```sql
ON CONFLICT (node_run_id, draft_key) WHERE draft_key IS NOT NULL AND draft_key <> ''
DO UPDATE SET ... status = 'draft' ...
WHERE multica_workflow_split_task.status IN ('draft', 'discarded')
```

**问题**：如果用户通过 UI 将某个草案标记为 `discarded`（删除），Agent 后续调用 `AddSplitDraftTask` 使用相同 `draft_key` 时，草案被悄然复活为 `draft` 状态。用户认为已删除的草案重新出现，且不知道是谁恢复的。

**修复建议**：upsert 时不复活 `discarded` 状态的草案，或至少在草案被复活时产生事件通知用户。

---

### 2.8 Chat 模式下的草案依赖关系引用断裂（P2，已修复）

**位置**：`workflow_split.go:AddSplitDraftTask` (L881-894) + `replaceSplitDraftTasksFromPayload` (L764-768)

**修复状态**：已修复。`splitGeneratedTask` 已支持 `draft_key`，markdown 恢复路径会从标题派生稳定 key，`replaceSplitDraftTasksFromPayload` 创建草案时会持久化 `draft_key`，后续 Agent API 可用 key 引用这些草案。

**问题**：依赖校验基于 `draft_key`，但 `draft_key` 只在 Agent API 路径中设置。Chat 解析路径创建草案时**不设 key**（L764-768），导致 Chat 解析创建的草案无法被后续的 API 调用引用为依赖。

**修复建议**：Chat 解析路径创建的草案也应该生成并持久化 `draft_key`（可从 Agent 输出中的标题派生）。

---

### 2.9 缺少「回退到 Agent 原始提案」功能（P2，已修复）

**修复状态**：已修复。当前已提供 `POST /api/node-runs/{nodeRunId}/split/reset-original`，后端通过 `ResetSplitDraftTasksToOriginal` 从原始 split generation 任务结果恢复草案；`packages/core` API client 和 `SplitReviewPanel` 也已接入“Reset to agent proposal”入口。已有 `TestResetSplitDraftTasksToOriginalRestoresAgentProposal` 覆盖手动编辑后回退到原始提案。

**问题**：用户通过 Chat 或手动编辑调整草案后，无法回退到 Agent 最初生成的草案版本。草案表没有版本历史，一旦修改即覆盖。唯一恢复方式是取消父运行重新触发。

**修复建议**：至少保留 `draft_source = 'agent'` 的第一版草案不被物理删除，提供 UI 层面的"重置为原始方案"按钮。

---

### 2.10 有效的解释性对话被误判为调整失败（P3，暂不修复）

**位置**：`workflow_split.go:handleTaskCompletion` (L1194-1246) + `task.go:CompleteTask`

**暂不修复理由**：此问题需要 split chat 引入意图分类机制（`adjust`/`explain`/`noop`），属于 Chat 交互模型的架构变更。当前工作中用户的核心需求是调整草案，解释性对话可通过"请先不要改，帮我分析一下"这类提示词回避。建议在 Chat 交互模型迭代时一并解决。

**问题描述**：当前 Chat 完成处理要求 Agent 回复必须能解析出草案变更（结构化 JSON 或可恢复的 markdown），否则 `onTaskCompleting` 返回 error。但以下对话是合法且有用的审核交互：

- "这个拆分方案合理吗？"（用户请求评估，不需要修改）
- "解释为什么任务 2 依赖任务 1，不要改任何东西"
- Agent 回复解释当前草案的合理性，未产生任何草案变更

这些场景下 Agent 正确完成了用户请求，但被系统判定为失败。

**业务影响**：审核对话被限制为只能做修改，不能做讨论。用户无法在审批前与 Agent 进行 "先理解、再决定是否改" 的自然交互。

**修复建议**：对 split chat 意图进行分类——`adjust`（需持久化草案变更）、`explain`（仅产生 chat 输出）、`noop`（无需操作）。仅 `adjust` 意图要求可解析的草案变更，其余意图正常完成并产生 assistant 消息即可。

---

## 三、设计缺陷（流程逻辑不够严谨）

### 3.1 Pipeline 模式不等待调度确认就放行下游

**位置**：`workflow_split.go:resolveSplitStatus` (L315-323)

```go
case SplitModePipeline:
    for _, task := range tasks {
        if task.Status == SplitTaskStatusDraft || task.Status == SplitTaskStatusApproved {
            return NodeRunStatusSplitActive
        }
    }
    return NodeRunStatusCompleted
```

**问题描述**：Pipeline 模式只检查没有 `draft`/`approved` 状态就判完成。但 `created` 状态（issue 已创建但工作流运行尚未启动）也通过了检查。PRD 描述的是"后台完成首次调度接管后"才放行。此外，初始调度失败被标记为 `failed` 的任务同样允许父节点完成，违背了 PRD 语义。

**业务影响**：如果调度系统短暂故障，子任务处于 `created` 但未实际接管，父节点已经放行下游。下游节点可能依赖子任务的输出，但由于子任务实际未运行，下游拿到的是空数据。

**修复建议**：引入持久的 `initial_dispatch_completed` 信号。Pipeline 模式应在首次调度轮次成功完成后才放行——初始调度失败应阻塞或标记父节点失败。

---

### 3.2 子任务重试时不清除旧运行关联

**位置**：`workflow_split.go:RetrySplitTask` (L1012-1083)

**问题描述**：`ResetSplitTaskForRetry` 重置任务状态到 `created` 并将 `run_id` 置为 NULL，但**旧运行没有被取消**。旧的工作流运行可能仍在执行中，产生双重运行的混乱状态。

**PRD 对照**：PRD 要求"重复回调或事件重放不会创建重复子 issue / 子 issue 运行"。重试场景下不清理旧运行属于同类问题。

**修复建议**：重试前应先取消旧运行（如果存在且非终态）。

---

### 3.3 子任务状态与关联 Issue 状态没有同步机制

**位置**：全局流程

**问题描述**：`multica_workflow_split_task.status` 和 `multica_issue.status` 是两套独立的状态机：
- Split task status: `draft → approved → created → running → done/failed/cancelled/skipped`
- Issue status: `todo → in_progress → done/cancelled`

两者之间除了子运行终态事件（`HandleChildRunTerminal`）外没有同步。可能出现：
- 拆分任务状态为 `running`，但用户手动将子 Issue 标记为 `done`，运行被提前结束但拆分数不知情
- 子 Issue 被其他 Agent 修改状态，拆分进度统计不准确

**PRD 对照**：PRD 要求 "pending / running / completed / failed / cancelled 的子 issue 状态在父 issue 和画布中的显示一致"

**修复建议**：监听子 Issue 状态变更事件，当 Issue 被手动 close/cancel 时同步更新对应的 split task 状态（或阻止不一致状态变化）。

---

### 3.4 父运行取消的 API 层缺少确认意图记录

**位置**：`workflow_run.go:CancelWorkflowRun` (L430-465) → `workflow.go:CancelRun` → `OnNodeStatusChanged` → `HandleNodeRunStatusChanged` → `CancelSplitNode`

**核实结论**：此项不应描述为"整体缺少二次确认"。前端 `WorkflowRunPage` 已在取消 workflow run 前展示确认弹窗，`SplitReviewPanel` 取消拆分节点也有确认弹窗。剩余问题在 API 层：`CancelWorkflowRun` 接口本身不要求确认意图字段，也不记录用户已确认过级联取消影响；绕过 UI 直接调用 API 时仍会直接取消。

**当前流程**：
1. 用户调用 `POST /workflows/{id}/runs/{runId}/cancel`
2. 直接执行 `CancelRun` → 取消所有节点运行 → split 节点的 `HandleNodeRunStatusChanged` 触发 → `CancelSplitNode` 取消所有子任务

**业务影响**：正常 UI 路径已有防呆，但 API 调用者或未来新增入口如果未复用确认弹窗，仍可能触发不可逆的级联取消。

**修复建议**：保留现有前端确认弹窗，同时在 API 层增加确认意图字段或审计记录，确保所有入口都能显式表达"已确认级联取消"。

---

### 3.5 拆分 Chat 会话与生成任务使用同一个 Agent

**位置**：`workflow_split.go:SplitChat` (L2183-2358)

**问题描述**：`SplitChat` 创建 Chat 会话时绑定到拆分节点的 Agent。如果该 Agent 是内置 Agent（每次选择不同 runtime），Chat 会话的 `agent_id` 可能绑定到一个后续不可用的 Agent。

**业务影响**：Chat 历史记录绑定到特定 Agent，如果 Agent 被删除或替换，审核对话历史不可访问。

---

### 3.6 子任务调度失败时缺少结构化错误上下文（P1）

**位置**：`workflow_split.go:ScheduleReadyTasks` (L1592-1601) + `workflow_split_task.last_error` 字段

```go
for _, task := range claimed {
    if err := s.startChildTaskRun(ctx, splitNodeRun, cfg, task); err != nil {
        slog.Warn("split: failed to start child run", "split_task_id", util.UUIDToString(task.ID), "error", err)
        if _, updateErr := s.Queries.UpdateSplitTaskStatus(ctx, db.UpdateSplitTaskStatusParams{
            ID:     task.ID,
            Status: SplitTaskStatusFailed,
        }); updateErr != nil {
```

**问题描述**：`multica_workflow_split_task` 表存在 `last_error` 字段（JSONB），在整个 `workflow_split.go` 中**从未被写入**。子任务启动失败时只更新状态为 `failed`、打印日志，不写入结构化错误。前端全景图 (`execution-panorama-page.tsx`) 在渲染子任务运行时也使用了空的 `error_message`。

**业务影响**：用户只能看到子任务"失败了"，但不知道是哪个 workflow、哪个 node、什么原因导致失败。排查需要翻 daemon 日志。

**修复建议**：为所有 split task 失败路径写入结构化 `last_error`（包含 node_run_id、workflow_id、错误原因），并在前端全景图和详情面板中展示。

---

### 3.7 Barrier 模式无超时机制，单个任务卡住导致整体永久阻塞（P1）

**位置**：`workflow_split.go:resolveSplitStatus` (L324-341)

**问题描述**：Barrier 模式要求**所有**子任务达到终态才判定父节点完成。如果某个子任务的 Agent 无限循环、runtime 离线且不恢复、或任务逻辑上无法完成，整个 barrier 将永久阻塞，所有已完成子任务的工作白白浪费。

**PRD 对照**：PRD 提到 `max_failures` 阈值控制失败容忍度，但没有定义超时/僵死检测机制。从业务角度看，应该有手段处理"既不成功也不失败"的卡住状态。

**修复建议**：
- 引入最大执行时间配置，超时后自动标记 `failed`
- 或者在运行中允许人手动将单个子任务标记为 `failed`/`cancelled`

---

### 3.8 审批后 `maxConcurrency` 变更不触发即时调度（P1）

**位置**：`workflow_split.go:PatchSplitConfig` (L950-1010) + `ScheduleReadyTasks`

**问题描述**：用户通过 `PATCH /split/config` 提高 `max_concurrency` 后，`ScheduleReadyTasks` 不会被调用。新的并发槽位要等到下一个子任务完成事件才生效。

**业务影响**：PRD 明确说"并发限制可在运行时调整"。用户调整后期望立即看到更多任务启动，但实际需要等待随机事件触发。

**修复建议**：`PatchSplitConfig` 成功后调用 `ScheduleReadyTasks(ctx, nodeRun.ID)`，并报告哪些任务被新启动或为何无法启动。

---

## 四、边界条件问题

### 4.1 未创建 Issue 的子任务在审批调用时缺少防御

**位置**：`workflow_split.go:ApproveSplit` (L1409-1446)

审批循环按拓扑序创建子 Issue，但 `topologicalSplitTaskIDs` 要求 `validateSplitTaskGraph` 通过。如果 `MarkSplitTasksApproved` 成功但随后某些任务被并发删除，`allowedByID[id]` 可能获取不到任务，导致 `task.IssueID.Valid` 检查的 `task` 为零值（跳过），表现正确但缺乏防御性。

---

### 4.2 恢复草稿时的并发安全问题

**位置**：`workflow_split.go:RecoverSplitDraftTasks` (L628-665)

**问题描述**：恢复操作 (`RecoverSplitDraftTasks`) 和审批操作 (`ApproveSplit`) 之间没有互斥锁。两者可以并发执行——恢复把 tasks 替换为新草稿、审批基于旧草稿创建 Issue。

**业务影响**：恢复和审批并发执行时，审批可能基于已废弃的草稿创建子 Issue。

**修复建议**：`RecoverSplitDraftTasks` 内部应检查节点状态是否允许操作，或使用行级锁防止并发修改。

---

### 4.3 拆分任务数量限制缺少配置化

**位置**：`workflow_split.go:ApproveSplit` (L1373-1375)

```go
if len(allowed) > 50 {
    return fmt.Errorf("split_task_limit_exceeded")
}
```

**问题描述**：审批时硬编码最大 50 个拆分任务。限制合理但缺少：生成阶段没有提前警告（Agent 可能生成超过 50 个任务，全部被拒）；限制值不可配置。

**修复建议**：将限制值配置化，并在生成阶段做预检查提前告知用户。

---

### 4.4 直接 API 调用 `confirm_empty` 时草案残留导致节点卡住（P3）

**位置**：`workflow_split.go:ApproveSplit` (L1367-1372)

```go
if len(allowed) == 0 {
    if req.ConfirmEmpty {
        return nil   // ← 什么都不做，节点卡在 awaiting_split_review 永久等待
    }
    return fmt.Errorf("split approval requires at least one task")
}
```

**问题描述**：UI 主流程中，只有当所有草案都已被丢弃时才会发送 `confirm_empty`，正常路径下 `resolveSplitStatus` 会将节点推进到 `completed`。但如果绕过 UI 直接调用 API，传入 `confirm_empty=true` 且 `approved_task_ids=[]`，但节点下仍存在 `draft` 草案，则函数会在丢弃草案前返回。外层状态推进后，节点可能进入 `split_active`，但仍保留 `draft` 任务，形成卡住状态。

**修复建议**：
- 后端在 `confirm_empty=true` 且无审批任务时，应显式将当前仍处于 `draft` 的草案标记为 `discarded`，或拒绝该请求并提示调用方先丢弃草案。
- 增加针对直接 API 调用的测试，覆盖"仍有 draft + confirm_empty"场景。

---

## 五、进度聚合的数据一致性风险

### 5.1 拆分进度摘要的状态分类不一致

**位置**：
- `handler/workflow_split.go:splitProgressResponse` (L85-107)
- `service/workflow_split.go:splitProgressSummary` (L2447-2483)

**问题描述**：两处进度计算逻辑独立维护——Handler 层统计 `created`, `running`, `done`, `failed`, `cancelled`, `skipped`（不含 `draft`/`approved`/`discarded`）；Service 层统计所有状态。两者返回的状态维度不同，修改时容易遗漏。

**修复建议**：统一使用 `splitProgressSummary`，或抽出公共函数。

---

### 5.2 进度摘要排除了 `discarded` 但包含了 `approved`

**位置**：`workflow_split.go:splitProgressSummary` (L2447-2483)

```go
if t.Status != SplitTaskStatusDiscarded {
    summary["total"]++
}
```

`total` 计数排除了 `discarded`，但 `approved` 状态的任务仍参与 `total` 计数。审批前 `approved` 任务还没有 Issue，审批后变为 `created`/`running`。审批后如果部分任务被 `discarded`，`total` 减少——用户看到的进度"总量"在审批前后不一致。

---

## 六、已有优势

以下现有设计是正确的，应保留并在此基础上增强：

- PRD 中"允许 NL 调整"的方向通过 split chat + draft CLI 有意实现，路径完整
- 草案 API 限制为正在运行的 split-generation 或 split-chat Agent 任务，减少了意外的外部变更
- split chat 路径阻止同一审核会话的并发活跃 chat 任务，防止冲突
- 后端在应用 chat 结果前检测草稿的并发变更（`splitChatDraftsChanged`），是冲突处理的正确基础
- 调度器对已实体化的子 Issue 执行有真正的 DAG/并发模型

---

## 七、总结与优先级建议

| 优先级 | 编号 | 所属模块 | 简述 | 影响 |
|--------|------|---------|------|------|
| **已修复** | 1.1 | 调度 | 启动失败留下僵尸依赖任务 | 启动失败后会级联 skip 依赖并收敛父节点 |
| **已硬化** | 1.2 | 取消 | 子运行取消逻辑只识别 running | 当前无 pending run，已改为按非终态取消 |
| **已修复** | 1.3 | 审批 | 重复审批回退已创建任务 | SQL 状态过滤已阻断 created/running 回退 |
| **已修复** | 2.2 | 草案调整 | Chat 任务卡死审核永久阻塞 | 失败路径已标记 chat task 为 failed，后续 Chat 可重试 |
| **暂不修复** | 2.3 | 草案调整 | Chat 全量替换丢失人工编辑 | 用户编辑静默丢失，但已有 reset-original 逃生舱 |
| **P1** | 3.7 | 调度 | Barrier 无超时机制 | 单任务卡死整体阻塞 |
| **P1** | 3.8 | 调度 | 并发调整不触发即时调度 | 违背 PRD 即时生效承诺 |
| **P1** | 3.1 | 调度 | Pipeline 不等待调度确认 | 下游可能拿到空数据 |
| **P1** | 3.2 | 重试 | 重试不清除旧运行 | 双重运行 |
| **P1** | 3.6 | 调度 | 子任务失败缺少结构化错误 | 用户无法定位失败原因 |
| **暂不修复** | 2.4 | 草案调整 | 并发编辑检测静默丢弃 | 用户困惑，Agent 无感知 |
| **暂不修复** | 2.5 | 草案调整 | NL 调整非原子性，无回滚 | 多步操作半途失败数据残缺 |
| **暂不修复** | 2.6 | 草案调整 | 批量添加非事务 + 依赖顺序敏感 | 合法 DAG 因命令顺序失败 |
| **P2** | 3.3 | 状态 | 子任务与 Issue 状态不同步 | 进度展示不一致 |
| **P2** | 3.4 | 取消 | API 层缺少确认意图记录 | 绕过 UI 时误操作不可逆 |
| **P2** | 4.3 | 审批 | 50 任务硬限制 | 大项目场景受限 |
| **已修复** | 2.7 | 草案调整 | Upsert 复活 discarded 草案 | draft_key 唯一性只约束非 discarded 草案，复用 key 创建新草案 |
| **已修复** | 2.8 | 草案调整 | Chat 草案无 draft_key | 生成/markdown 草案会持久化稳定 draft_key |
| **已修复** | 2.9 | 草案调整 | 无法回退到原始方案 | 已提供 reset-original 路由/API/UI 入口 |
| **暂不修复** | 2.10 | 草案调整 | 解释性对话误判为失败 | 审核只能改不能讨论 |
| **P3** | 4.4 | 审批 | 直接 API 空审批仍有 draft 时可能卡住 | 绕过 UI 的边界场景 |
| **P3** | 3.5 | 边界 | Chat 会话 Agent 绑定 | 边界场景 |
| **P3** | 4.2 | 边界 | 恢复/审批并发竞态 | 边界场景 |
| **P3** | 5.1 | 进度 | 进度逻辑重复 | 维护风险 |

---

## 审查结论

整体实现完成了"拆分生成 → 审核 → 创建子 Issue → 调度执行 → 进度汇总"闭环，状态机设计和 DAG 依赖检测逻辑完善。原审查列出的缺陷中，**1.1**、**1.3**、**2.2**、**2.7**、**2.8** 和 **2.9** 已修复，**1.2** 按当前 schema 核实为非当前缺陷并已做防御性硬化；剩余待处理项包含 **4 个 P1 级别设计不足**，另有 **5 项草案调整问题已标记暂不修复**（详见下方说明）。

草案调整模块暴露了一个**结构性矛盾**：人工编辑（增量、version 控制）、Agent CLI（单步持久化、无回滚）、Chat 输出解析（全量替换、快照比对）是三种不兼容的协作模型，却操作同一份数据。这导致了数据丢失和流程风险。考虑当前阶段：
- 已有 reset-original 作为编辑丢失的逃生舱（2.9 已修复）
- NL 调整原子性和增量语义修复涉及架构升级，与当前主线目标不冲突
- 实际生产中草案调整以人工编辑和单步操作为主，多步复合操作触发概率较低

因此将 **2.3**、**2.4**、**2.5**、**2.6**、**2.10** 标记为**暂不修复**，待下一轮 Chat 调整架构迭代时整体解决。

### 推荐修复顺序

1. **Pipeline 放行语义**：初始调度成功后才放行下游（修复 3.1）
2. **Barrier 超时机制**：引入最大执行时间配置或手动强制终态能力（修复 3.7[原 1.4]）
3. **并发调度即时生效**：`PatchSplitConfig` 成功后触发 `ScheduleReadyTasks`（修复 3.8[原 1.5]）
4. **结构化错误**：所有失败路径写入 `last_error`（修复 3.6）
5. **状态同步**：监听子 Issue 状态变更事件同步 split task 状态（修复 3.3）
6. **审批原子性增强**：后续可将审批、实体化、状态转换进一步合并为一个锁定的幂等操作，并补齐 4.4 的直接 API 边界

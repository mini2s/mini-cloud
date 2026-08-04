# Review 挂接点与拆分调度可复用清单 —— 调研 findings

> 对应 ticket: `docs/wayfinder/split-deliverable-flow/tickets/02-review-hooks-reuse-survey.md`
> 目标方向（既定，不在此评估）：approve 时刻 task.md 快照入库 → split task 行直接从 `created` 起步（无 draft 态）→ 服务端异步 job 逐条创建子 issue → 复用现有调度/聚合/取消；draft CLI / draft 编辑 API / split_chat / 结构化 review UI 退役；节点状态机新增 `materializing`。
> 所有锚点为 `文件:行号`，基于分支 `feat-task` 工作区现状。不确定处明确标注。

---

## 1. Deliverable review 挂接

### 1.1 现有两层 review API

**(a) 逐条 submission 的 approve/reject（deliverable 级）**

- 路由：`server/cmd/server/router.go:735` —— `POST /api/node-runs/{nodeRunId}/deliverables/{submissionId}/review`
- Handler：`server/internal/handler/workflow_run.go:1196` `ReviewNodeRunDeliverable`（注释块 1189 起）
  - 权限谓词：`server/internal/handler/deliverable_review_access.go:19` `canReviewDeliverable`（owner/admin、issue creator、issue assignee、节点指定 human critic 四类）
  - service 落库：直接调 sqlc 查询 `ReviewNodeRunDeliverableSubmission`（`server/pkg/db/queries/workflow_deliverable.sql:97`），仅 `UPDATE ... SET status/review_comment/reviewed_at` 单行
- **approved/rejected 之后触发什么：什么都没有。** Handler 内无事件发布、无节点状态迁移、无回调；只返回更新后的 submission JSON。前端即时性依赖客户端 mutation 后自行 invalidate（`packages/core/api/client.ts:2763` `reviewNodeRunDeliverable`）。
- 真正的下游消费发生在「节点级 critic review」时作为门槛：approve 节点前要求所有 required deliverable 已 approved（见下）。

**(b) 节点级 critic review（node run 级）**

- 路由：`server/cmd/server/router.go:717` —— `POST /api/node-runs/{nodeRunId}/review`
- Handler：`server/internal/handler/workflow_run.go:662` `ReviewNodeRun`
- Service：`server/internal/service/workflow.go:1203` `ReviewNodeRun`
  - approve 路径：先过 `requiredDeliverablesSatisfied` 门槛（`workflow.go:1216-1219`，不满足直接报错）；tx 内置 `critic_approved` 并存 critic output；tx 提交后 `mergeDeliverablePRs`（`workflow_deliverable_repo.go:962`，外部 Gitea 调用）→ `markDeliverableSubmissionsApproved`（`workflow.go:1322`，实现 `workflow_deliverable_repo.go:1058`，批量把带 PR URL 的 submission 置 approved）→ 置 `completed`/`blocked` → 触发 `OnNodeStatusChanged` + `OnNodeRunCompleted`（`workflow.go:1343-1357`）
  - reject 路径：`critic_rework` → 超 `MaxRetries` 置 `blocked`，否则回 `format_ok` 并 `EnqueueWorkflowDispatch` 重新派发 worker（`workflow.go:1242-1301`）
  - review comment 归档 Gitea：`s.ArchiveReviewComment`（`workflow.go:1305-1311` 附近，best-effort）
- 节点状态变化的 WS 事件统一由 `OnNodeStatusChanged` 回调发出：`server/internal/handler/handler.go:265` 装配，`handler.go:275` `h.publish("workflow:node_run_updated", ...)`；同一回调里还挂了 split 编排器钩子 `SplitOrchestrator.HandleNodeRunStatusChanged`（`handler.go:267-271`）。

### 1.2 拆分节点「approve task.md」接入点评估

**若复用 (a) submission review**：需要给 split 节点挂 deliverable requirement（submission 行由 requirement 派生，`workflow_deliverable.sql:80-95` 的 `UpsertNodeRunDeliverableSubmission ... FROM multica_workflow_node_run_deliverable requirement`），agent 把 task.md 作为 submission 提交，人调现有 review 端点。**缺口**：该端点 approve 后没有任何钩子——没有事件、没有节点状态迁移、没有回调；要驱动「snapshot 入库 → materializing → 物化 job」必须在 handler 里按节点类型特判或新增 service 层回调，等于在别人的端点上外挂 split 专有生命周期，且 submission status 只有 `missing/submitted/approved/rejected`（`server/migrations/133_workflow_deliverables.up.sql:29`），无「物化中」语义。

**若独立端点**：现状已存在 `POST /api/node-runs/{nodeRunId}/split/approve`（`router.go:737` → `handler/workflow_split.go:838` `ApproveSplitTasks` → `service/workflow_split.go:1818` `ApproveSplit`），自带 reviewer 鉴权（`resolveSplitReviewerWithQueries` `workflow_split.go:528`、`RequireSplitReviewer` 550）、行锁、图校验、指派人硬校验。新方向下保留该端点、把函数体换成「快照入库 + 行置 created + 节点转 materializing + enqueue 物化 job」是局部改造；权限模式可参照 `canReviewDeliverable` 的纯谓词写法。

**结论**：独立端点（改造现有 `/split/approve`）。理由：split approve 的本质是**节点状态机迁移 + 异步物化触发**，而 deliverable submission review 是**无生命周期的行级状态翻转**，两者抽象层级不同；复用后者要把 split 生命周期外挂进通用端点，接入成本高于改造现有端点。task.md 快照的存放位置（submission 表复用 vs split task 行/新列）本次未定论，属于设计待定项。

---

## 2. 节点状态机：新增 `materializing` 的改动面

### 2.1 DB CHECK 约束

- `multica_workflow_node_run.status` 的 CHECK 只在两个迁移中重建过：
  - `server/migrations/122_awaiting_input.up.sql:20`（旧）
  - `server/migrations/135_workflow_split_task.up.sql:37-64`（**当前生效**，19 个枚举值，含 `splitting/awaiting_split_review/split_active`；用 `DO $$ ... pg_constraint ... pg_get_constraintdef ILIKE '%status%'` 动态找约束名再 DROP/ADD 的模式）
- 其他含 CHECK 的 workflow 迁移（133/136/137/138/144）均作用于别的表/列，不涉及 node run status（逐一核对过）。
- 新增 `materializing`：需要一个新迁移照搬 135 的动态约束重建模式，把枚举扩到 20 个。

### 2.2 Go 状态机

- 状态常量：`server/internal/service/workflow.go:85-100`（通用）+ `workflow_split.go:27-29`（split 三个）；`materializing` 常量加在哪边均可（split 语义建议放 `workflow_split.go`）
- 迁移表：`workflow.go:111-136` `validTransitions`（split 相关边在 124-126）。需新增边，例如 `awaiting_split_review → materializing`、`materializing → split_active/failed/cancelled`（具体边集由设计定）
- `TransitionNodeRun`（`workflow.go:685`）本身是表驱动，无需改
- `isTerminalNodeRunStatus`（`workflow.go:152`）：materializing 非终态，不动
- split 侧按 status 分支的守卫函数（都要审视是否纳入 materializing）：
  - `canCancelSplitNodeStatus`（`workflow_split.go:638-656`）—— 物化中能否取消是设计决策；若要取消，物化 job 必须响应节点已 cancelled
  - `canRegenerateSplitNodeStatus`（`workflow_split.go:855`）
  - `shouldProcessSplitTaskCompletion`（`workflow_split.go:1637`）
  - `HandleNodeRunStatusChanged`（`workflow_split.go:713`）对 `splitting` 的特判
  - `resolveSplitStatus`（`workflow_split.go:429`）在物化期间会把节点算成 `split_active`（created 行走 default 分支），`reconcileParentNode`（2697）会尝试 `TransitionNodeRun(nodeRun, split_active)` —— 若物化期间节点停在 `materializing`，这里需要「物化未完成前不收敛」或 `materializing → split_active` 的合法边
  - 调度入口 `dispatchWorkerForJob` 中 split 节点直接转 `splitting`（`workflow.go:1371-1374`）；`dispatchSplitPhase`（`workflow_dispatch.go:323-353`）的 status 分支

### 2.3 前端状态展示映射

- `packages/core/types/workflow.ts:205-210` `NodeRunStatus` union 类型；`229-257` `toWorkflowRuntimeDisplayStatus`（splitting/split_active → in_progress，awaiting_split_review → reviewing）
- `packages/views/issues/components/execution/node-run-status-icon.tsx:23-25` 图标+颜色映射
- `packages/views/workflows/components/node-run-card.tsx:20`（进行中动画名单）、`35-37`（badge 颜色）、`102`（canSkip 排除名单）
- `packages/views/issues/components/execution/execution-panorama-page.tsx:286-314`（panel 状态文案 case、elapsed timer 条件）
- `packages/views/issues/components/execution/execution-panorama-page.tsx:158` `splitTaskDisplayStatus`（split task 级，不是 node run 级，但新模型下 task 状态集合不变）
- 文案：`packages/views/locales/en/workflows.json:508-510`、`packages/views/locales/zh-Hans/workflows.json:508-510`
- 测试锚点：`packages/core/types/workflow.test.ts:180-182`；`runtime-node-card.test.tsx`、`execution-panorama-page.test.tsx` 中大量 split 状态用例
- 注：`packages/core/api/schemas.ts:179` node run status 是 `z.string()` 无枚举，不用改

---

## 3. 调度/聚合/取消复用清单

| 函数 | 锚点 | 复用度 | 说明 |
|---|---|---|---|
| `validateSplitTaskGraph` | `service/workflow_split.go:259` | **原样复用** | 纯图校验（空 id/重复 id/未知依赖/环），与 status 无关 |
| `topologicalSplitTaskIDs` | `workflow_split.go:308` | **原样复用** | Kahn 拓扑排序，仅依赖 depends_on + sort_order |
| `readySplitTaskIDs` | `workflow_split.go:352` | **原样复用** | 已经只挑 `status == created`（377-379）且依赖全 `done` 的行；draft 态本就不参与调度。max_concurrency 扣减 running 数逻辑不变 |
| `SplitExecutionProgressSummary` / `AddStatus` | `workflow_split.go:3592` / `3569` | **原样复用** | 只统计 created/running/done/failed/cancelled/skipped，无 draft 分支 |
| `splitProgressSummary`（map 版） | `workflow_split.go:3600` | 小改 | 其中 `draft`/`approved` 计数在无 draft 态后恒 0，可删字段或保留兼容；`SplitTasksResponse.Progress` 结构在 `handler/workflow_split.go:36-52` |
| `MarkSplitTaskRunningIfCreated` | `pkg/db/queries/workflow_split_task.sql:119` | **原样复用** | `WHERE status='created'` 乐观锁，正好匹配「行从 created 起步」 |
| `CancelSplitNode` | `workflow_split.go:2072` | 基本原样 | 逐行加锁取消子 run/issue 的逻辑与 draft 无关。注意点：① `CancelOpenSplitTasksByNodeRun`（`workflow_split_task.sql:229-237`）的 CASE：`issue_id IS NULL → 'discarded'`——新模型下「已 approve 未物化」的行 issue_id 也是 NULL，若表 CHECK 删掉 `discarded` 枚举这里要改映射（135 迁移 11-20 行的 split task status CHECK 也要同步改）；② `canCancelSplitNodeStatus`（638）要决定是否纳入 `materializing`，纳入则物化 job 每步需检查节点是否已 cancelled |
| `resolveSplitStatus` / MaxFailures 判定 | `workflow_split.go:429` | 小改 | pipeline 分支 434-436 把 `draft/approved` 视为「未完结→split_active」；无 draft 态后该 case 失效（留着无害，清理更好）。`failures > maxFailures → failed` 主逻辑不变。`markBlockedSplitTasksSkipped`（401）、`resolveSettledSplitStatus`（464）、`reconcileParentNode`（2697）均可复用；但见 2.2 —— 物化期间 reconcile 会尝试把节点迁到 split_active/completed，需要 materializing 的合法边或抑制条件 |
| `ApproveSplit`（approve 时建子 issue 的事务逻辑） | `workflow_split.go:1818-2070` | **重写主体，保留外壳** | 可保留：reviewer 鉴权（1880-1889）、`GetWorkflowNodeRunForUpdate` 行锁（1874）、重复 id/版本检查（1827-1854）、图校验（1915-1921）、50 条上限（1912）、**指派人硬校验**（1931-1945：`missing assignee` 报错 + `Assignments.ValidateAssignee` 逐条校验）。需切除：`MarkSplitTasksApproved`（1948，draft→approved）、tx 内同步建子 issue 循环（1964-2011，含 `CreateIssueWithOrigin` 1973、`UpdateSplitTaskIssueID` 1993）、tx 内 ready 标记 running（2015-2035）。替换为：快照入库 → 行直接 created → 节点转 materializing → enqueue 物化 job。tx 后的 `AfterIssueAssigned` 副作用循环（2050-2058）、`publishSplitEvent`（2043-2044、2062）模式可照搬到物化 job。建子 issue 的可复用零件：`ensureWorkflowSubIssue`（2496）、`createWorkflowSubIssue`（2559，含 `CreateIssueWithOrigin` 2604）、`ensureSplitChildIssueAssignee`（1792）、子工作流启动 `startChildTaskRunLocked`（2402） |
| 调度循环跳过无指派人任务 | `workflow_split.go:2191`（`ScheduleReadyTasks` 内） | **保留，但角色变化** | 现状 `if task.RunID.Valid \|\| !task.IssueID.Valid \|\| !task.AssigneeType.Valid \|\| !task.AssigneeID.Valid { continue }`。新模型下 approve 已硬校验指派人，但：① `!task.IssueID.Valid` 的跳过**必须保留**——物化 job 尚未建 issue 的行不能被调度抢跑；② 指派人在 approve→dispatch 之间可能被停用，`ValidateAssignee` 复检 + 失败标记 `split_assignee_invalidated`（2195-2201、2234）仍是必要防线。建议保留 |

---

## 4. 退役清单与影响面

### 4.1 服务端 —— draft CLI

- `server/cmd/cs-workflow/cmd_workflow_split.go` **全文件退役**：`workflow split draft add/submit/delete` 三个子命令（声明 26-50，注册 52-60，实现 76-200）
- daemon prompt 中的 CLI 指引同步重写：`server/internal/daemon/prompt.go:112` `buildSplitPrompt`（draft add/submit 指引在 ~150-171）；`buildSplitChatPrompt` 整体退役（164，分派入口 18-19）

### 4.2 服务端 —— draft 编辑 API（handler + 路由）

路由全部在 `server/cmd/server/router.go`：

| 路由行 | 端点 | Handler（`handler/workflow_split.go`） | 处置 |
|---|---|---|---|
| 721 | POST split/recover | `RecoverSplitDraftTasks` (365) | 退役（draft 恢复） |
| 722 | POST split/reset-original | `ResetSplitDraftTasksToOriginal` (386) | 退役 |
| 723 | POST split/draft-tasks | `AddSplitDraftTask` (586) / `addManualSplitDraftTask` (627) | 退役 |
| 724 | POST split/draft-tasks/batch | `BatchAddSplitDraftTasks` (661) | 退役 |
| 725 | PATCH split/draft-tasks/batch | `BatchPatchSplitDraftTasks` (260) | 退役 |
| 726 | PATCH split/draft-tasks/assignees | `BatchPatchSplitTaskAssignees` (517) | 退役 |
| 727 | PATCH split/draft-tasks/{taskId} | `PatchSplitDraftTask` (180) | 退役 |
| 728 | PATCH split/draft-tasks/{taskId}/assignee | `PatchSplitTaskAssignee` (453) | 退役 |
| 729 | DELETE split/draft-tasks/{taskId} | `DeleteSplitDraftTask` (740) | 退役 |
| 731 | POST split/draft-submit | `SubmitSplitDraftTasks` (710) | 退役 |
| 736 | POST split/chat | `HandleSplitChat` (890) | 退役（split_chat） |
| 720 | POST split/generate | `GenerateSplitTasks` (344) | **保留/改造**（planner 仍要生成 task.md） |
| 730 | PATCH split/config | `PatchSplitConfig` (809) | 视设计保留（max_concurrency 配置） |
| 737 | POST split/approve | `ApproveSplitTasks` (838) | **保留/重写主体** |
| 738 | GET split/tasks | `ListSplitTasks` (167) | **保留**（进度查询） |
| 739 | POST split/cancel | `CancelSplitNode` (868) | **保留** |

service 侧随 draft 退役的函数（`service/workflow_split.go`）：`AddSplitDraftTask(s)`（1101/1105）、`upsertSplitDraftTask`（1159）、`AddManualSplitDraftTask`（1253）、`SubmitSplitDraftTasks`（1334）、`publishSplitSubmitFailed`（1355）、`DeleteSplitDraftTask`（1366）、`transitionSplitDraftsToReview`（1491）、`validateDraftSplitTaskRows`（1513）、`validateSplitDraftDeletionTarget`（1447）、`validateSplitDraftTaskAccess`（1462）、`RecoverSplitDraftTasks`（864）、`ResetSplitDraftTasksToOriginal`（899）、`loadSplitRecoveryTask`（930）、`loadOriginalSplitGenerationTask`（965）、`replaceSplitDraftTasksFromPayload`（1016）、`UpdateSplitDraftAssignees`（1702）、`DraftSourceAgent/Chat/Recovered` 常量（44-46）。recovery/markdown 解析整段（`recoverSplitGeneratedTaskPayloadFromTaskSources` 1000、`parseSplitGeneratedTaskPayload`/`recoverSplitGeneratedTaskPayload` 2792/2820、`recoverSplitGeneratedTaskPayloadFromComments` 2828、`...FromAttachments` 2865、`recoverSplitTasksFromMarkdown(Table)` 3000/3035 等 ~2792-3252 的恢复链）与 `dispatchSplitRepairTask`（1647）大概率随「agent 直接产出 task.md deliverable」退役——**未完全确定**，取决于新模型是否保留 markdown fallback 恢复。

### 4.3 split_chat 全链路

- Handler/route：见 4.2（`HandleSplitChat` 890，router.go:736）
- Service：`SplitChat`（`workflow_split.go:3287-3459`，含创建/绑定 chat session、`SetNodeRunSplitReviewChatSession`）、`splitTasksToSummary`（3460）、`splitChatDraftsChanged`（3503）、`splitChatAppliedDraftMutation`（3547）、`isSplitChatPhase`（2775）、`splitPhaseChat` 常量（84）
- Daemon prompt：`buildSplitChatPrompt`（`daemon/prompt.go:164`）、分派分支（`prompt.go:18-19`）
- DB：migration `138_split_chat.up.sql` —— `multica_workflow_split_task.draft_source` 列+CHECK、`multica_workflow_node_run.split_review_chat_session_id` 列+索引；退役需新迁移 drop（或保留列不再使用）
- 前端：`split-chat-review.tsx`（见 4.5）、`useSubmitSplitReviewChat`（`packages/core/workflows/queries.ts:575`）、`submitSplitReviewChat`（`packages/core/api/client.ts:2559`）、`SplitChatResponse`（`packages/core/types/workflow.ts:517`）、schemas 里的 `split_review_chat_session_id`（`packages/core/api/schemas.ts:1114`）

### 4.4 协议事件

`server/pkg/protocol/events.go:146-153`：`split_generation_dispatched`、`split_context_rendered`、`split_draft_added`、`split_draft_submit_failed`、`split_draft_submitted`、`split_review_ready` 随 draft 流程退役；`split_approved`（152）、`split_child_issue_created`（153）保留（物化 job 继续发）。

### 4.5 前端结构化 review UI 与 split 模块

`packages/views/workflows/components/split/` 目录：

| 文件 | 处置 |
|---|---|
| `split-review-panel.tsx`（+test） | **退役**（结构化 review 面板；引用处 `execution-panorama-page.tsx:93,305-314`；`canEditReview` 等逻辑 332 行附近） |
| `split-chat-review.tsx`（+test） | **退役** |
| `split-draft-ledger.tsx`（+test） | **退役**（draft 台账编辑 UI） |
| `split-dependency-note.tsx`（+test） | 大概率退役（依赖编辑展示） |
| `split-config-panel.tsx`（+test） | 视设计保留（max_concurrency 配置） |
| `split-node-card.tsx`（+test） | 改造（嵌入 review 面板的卡片） |
| `split-progress-badge.tsx` | **保留**（进度展示） |

packages/core：
- `api/client.ts`：退役 `recoverSplitTasks`（2447）、`resetSplitTasksToOriginal`（2456）、`createSplitDraftTask`（2475）、`patchSplitDraftTask`（2489）、`batchPatchSplitDraftTasks`（2502）、`patchSplitTaskAssignee`（2526）、`batchPatchSplitTaskAssignees`（2539）、`submitSplitReviewChat`（2559）；保留 `generateSplitTasks`（2438）、`approveSplitTasks`（2465，请求体要改）、`listSplitTasks`（2569）、`cancelSplitNode`（2576）；`listSplitIssueWorkflowOptions`（2549）保留
- `workflows/queries.ts`：退役 hooks `useRecoverSplitTasks`（475）、`useResetSplitTasksToOriginal`（483）、`useCreateSplitDraftTask`（500）、`usePatchSplitDraftTask`（509）、`useBatchPatchSplitDraftTasks`（522）、`usePatchSplitTaskAssignee`（540）、`useBatchPatchSplitTaskAssignees`（558）、`useSubmitSplitReviewChat`（575）；保留/改造 `useGenerateSplitTasks`（467）、`useApproveSplitTasks`（491）、`useCancelSplitNode`（617）、`splitTasksOptions`（251）；`invalidateSplitNodeQueries`（448）保留
- `types/workflow.ts`：`SplitTaskStatus`（456，去掉 draft/approved/discarded？注意 discarded 仍被 cancel CASE 使用）、`SplitTask`（470）、`SplitChatResponse`（517）、`PatchSplitTaskAssigneeRequest`（557）、`BatchPatchSplitTaskAssigneesRequest`（563）等
- `api/schemas.ts:1114-1115`：`split_review_chat_session_id`、`split_config_version` 字段去留随设计
- locales：`packages/views/locales/en/workflows.json` 中 split 相关 key 约 151 处（含 detail_panel.split_*、split_draft_*、chat 文案），review/chat/draft 部分退役

### 4.6 存量数据 / 种子 / e2e 依赖

- **e2e DB 级依赖**：`e2e/fixtures.ts:763-840` `seedSplitReviewDrafts` —— 直接 SQL 把 node run 强制置 `awaiting_split_review` 并 `INSERT ... status='draft', draft_source='agent'` 的 split task 行（814-830）。新模型下必须重写（created 行 + task.md 快照）
- **e2e UI 级依赖**：`e2e/issues.spec.ts:98-119`「dynamic split starts child issues with each draft workflow」走结构化 review UI（`runtime-node-card` → 等 `split_active`），需随新 UI 重写
- **种子模板**：`e2e/seed-data/coding-task-splitting.ts` 与 `scripts/import-coding-split-seed.mjs` —— 只定义 split 节点模板（`format_schema.type="split"` + `split_config`，见 seed 文件头部注释与 NODES 里 `task-splitting` 节点），**不调用 draft API**，数据本体可保留；文案提到「人工审核后批量创建子 issue」，流程文案需更新
- e2e 目录内**未发现**对 draft REST API（`split/draft-tasks`、`split/chat`）的直接调用（grep 无命中）——依赖集中在 fixtures.ts 的 SQL 与 issues.spec.ts 的 UI 流程
- **存量 draft 态数据**：未找到任何迁移/脚本会清理或转换 `multica_workflow_split_task` 中既有的 `draft`/`approved` 行；新迁移需要决定存量行的处置（discard/delete/转换）。生产库中存量规模未查（无访问手段）
- **server 测试**：`server/internal/handler/workflow_split_test.go`、`workflow_split_progress_test.go`、`server/internal/service/workflow_split_test.go` 中大量 draft/recover/chat 用例需重写（未逐文件统计）
- 相关 draft 迁移（会被新迁移反向）：`136_workflow_split_draft_key`（draft_key 列）、`140_workflow_split_draft_key_active_unique`（active 唯一索引）、`138_split_chat`（draft_source、split_review_chat_session_id）、`141_workflow_split_contract_cleanup`（已 drop suggested_assignee_*）、`135` 的 split task status CHECK（11-20 行）需重建去掉 `draft`（`approved`/`discarded` 去留由设计定）

---

## 5. 异步 job 机制

### 5.1 现有后台执行机制盘点

| 机制 | 锚点 | 说明 |
|---|---|---|
| **agent task queue 派发（daemon 执行）** | server 侧 `dispatchAgentTask`（split 生成入口 `workflow_split.go:837-845`）；daemon 侧 `internal/daemon/daemon.go:81`（"polls for and executes tasks"，认领互斥 116-130）；完成上报经 `taskSvc.OnTaskCompleting` → `SplitOrchestrator.HandleTaskCompletion`（装配 `handler/handler.go:181-186`，实现 `workflow_split.go:1544`） | 今天的 split 生成就是这条链：dispatch job → `GenerateSplitTasksForDispatch`（752）→ 往 `multica_agent_task_queue` 写 planner agent 任务 → daemon 执行 → CLI 交 draft → 上报驱动状态机。**物化 job 明确不走这条**（不经 agent） |
| **DB 任务队列 + 服务端轮询 worker（claim+lease）** | `multica_workflow_node_run_dispatch_job` 表 + `WorkflowDispatchWorker`：入队 `EnqueueWorkflowDispatch`（`workflow_dispatch.go:28`），Run 循环（172-196），`runOnce` 里 `ClaimWorkflowDispatchJob` 带租约（197-230），过期重入队 `RequeueExpiredWorkflowDispatchJobs`（174-177）；启动处 `cmd/server/main.go:487-496`（并发 2，`main.go:45`）。phase 分派：`process`（266-298）支持 `worker/critic/recovery/split` | 崩溃恢复、租约续约（renewLease 242-262）、失败重试（handleFailure）全有 |
| 同模式 worker ② | `WorkflowRoleResolutionWorker`（`workflow_role_resolution_worker.go:38-76`，job 表见 `136_workflow_role_resolution.up.sql`；启动 `main.go:468-486`） | **organization 路径纯 Go**（直接调 `w.Organization.ResolveMembers` HTTP，`workflow_role_resolution_worker.go:179` 附近）；resolver 路径**服务端直接调 OpenAI API**（`workflow_role_resolver.go:73,94` `OpenAIWorkflowRoleResolver`）——两种都不经 agent 会话 |
| 同模式 worker ③ | `WorkflowRoleNotificationWorker`（`workflow_role_notification.go:93-123`，启动 `main.go:497-501`） | claim+lease 轮询通知表发邮件，**纯服务端、无 agent** |
| 定时 sweeper | `runRuntimeSweeper`（`cmd/server/runtime_sweeper.go:77-93`，30s tick：runtime 离线判定、孤儿任务失败、queued TTL 清理、runtime GC）；启动 `main.go:516` | 纯服务端、无 agent |
| 其他定时器 | `BatchedHeartbeatScheduler`（`handler/heartbeat_scheduler.go:135`，启动 `main.go:516`）；autopilot scheduler（`cmd/server/autopilot_scheduler.go:17-31`，启动 `main.go:517`）与 failure monitor（`autopilot_failure_monitor.go:71`，启动 `main.go:518`） | 纯服务端 |
| 进程内事件总线 | `events.Bus` + 监听器注册 `registerAutopilotListeners`（`cmd/server/autopilot_listeners.go:15`，装配 `main.go:504`）；split 生命周期事件经 `publishSplitEvent`（`workflow_split.go:202`）→ bus → WS | 适合「状态变化触发下一步」的轻量联动，但无持久化、无重试，不适合做物化这种必须 durable 的 job |

### 5.2 服务端自驱（非 agent）后台任务先例

有，且不止一个：

1. **`completeGatewayDispatch`（`workflow_dispatch.go:355-390`）**——与物化 job 最同构的先例：在 dispatch job worker 里纯 Go 完成 gateway 节点（tx 内改状态 + `ActivateDownstreamAndEnqueue`），不派发任何 agent 会话。证明 `multica_workflow_node_run_dispatch_job` 队列可以承载纯 Go 的节点级后台步骤
2. `WorkflowRoleNotificationWorker` —— 独立 DB 队列 + 独立 worker 的纯服务端 job（发邮件）
3. `WorkflowRoleResolutionWorker` 的 organization/resolver 路径 —— 服务端直调外部 API
4. `runRuntimeSweeper` / autopilot scheduler —— ticker 驱动的纯 Go 循环

### 5.3 「物化 job」最贴合的挂法

**首选：复用 `multica_workflow_node_run_dispatch_job`，新增 phase（如 `materialize`）。** 理由：
- 零新基础设施：入队（`EnqueueWorkflowDispatch`）、claim+lease、过期重入队、崩溃恢复、并发 worker 全部现成
- 有完全同构先例（`completeGatewayDispatch` 在 worker 里跑纯 Go 节点逻辑）
- 物化是 split 节点生命周期的内聚步骤，dispatch job 本来就是节点级调度队列，语义贴合
- 实施面：`process`（266-298）加 case → 新 `dispatchMaterializePhase`（仿 `dispatchSplitPhase` 323-353 的 status 分支写法，支持从 `materializing` 断点续跑）；approve 端点在 tx 内 enqueue

**备选：照 `WorkflowRoleNotificationWorker` 模式新建独立队列表 + worker。** 隔离失败域、独立并发度/租约参数，但要新迁移 + 新 claim/requeue 查询，成本高，物化与节点生命周期强耦合时收益有限。

不适合：事件总线（无持久化/重试）、sweeper 定时扫描（轮询延迟 + 无逐条租约语义，只适合做兜底——可以考虑加一个「materializing 超时恢复」的兜底扫描，复用 dispatch job 的 requeue 机制则连这都不需要）。

---

## 附：本次未查清 / 不确定的点

1. deliverable submission review 后前端的即时刷新链路：handler 不 publish WS 事件，前端是仅靠 mutation invalidate 还是有其他订阅——未深究（对新设计影响小）
2. 存量生产库中 `status='draft'/'approved'` split task 行规模与迁移策略（无生产访问手段；代码内无现成清理迁移）
3. `split_config.default_issue_workflow_id`（`139_split_task_workflow.up.sql`）等新模型下字段去留——属设计待定，未评估
4. `ApproveSplit` 的 `expected_versions`/`draft_task_conflict` 乐观并发语义在「无 draft 编辑」后是否保留（大概率删，未定论）
5. recovery/markdown fallback 链（`workflow_split.go:2792-3252`、`dispatchSplitRepairTask` 1647）是否随 draft 一起退役——取决于新模型 planner 产出 task.md 的失败恢复策略，未定论
6. `materializing` 期间节点能否取消、reconcile 是否抑制的具体语义——属设计决策，本文只列出受影响代码点

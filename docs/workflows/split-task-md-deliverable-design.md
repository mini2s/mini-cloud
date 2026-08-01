# 拆分节点交付物化改造 · 设计 spec（初稿）

> 状态：初稿，待评审。本 spec 由 wayfinder map `docs/wayfinder/split-deliverable-flow/map.md` 的全部已锁定决策与 research findings 汇总而成。
> 决策依据：[Charting 决策记录](../wayfinder/split-deliverable-flow/tickets/00-charting-decisions.md) · [Gitea 流摸底](../wayfinder/split-deliverable-flow/assets/research-gitea-deliverable-flow.md) · [挂接点与复用清单](../wayfinder/split-deliverable-flow/assets/research-review-hooks-reuse.md) · [task.md 格式契约（定稿）](../wayfinder/split-deliverable-flow/assets/task-md-format-proposal.md)

## 0. 背景与目标

把拆分节点从「agent 走 CLI 逐条提交草稿 → DB 草稿表 → 结构化 review UI → 服务端同步建子 issue」改造为：

1. planner agent 像其他节点一样产出一份完整 **task.md**（全部子 issue 在文档中），经现有 Gitea deliverable 流（node 分支 + node→inst PR）提交为**节点交付物**；
2. 人点 PR 链接去 Gitea 评审/直接编辑，回 Multica **approve**；
3. approve 时刻服务端**拉取最新文档 + 解析校验 + 快照入库**（批准即快照），随后 **merge PR**；
4. 节点进入新状态 **materializing**，**服务端异步 job**（不经 agent）按快照确定性逐条创建子 issue，单条隔离 + 有限自动重试 + 人工单条重试兜底；
5. 物化完成后现有调度循环（DAG + max_concurrency + barrier/pipeline）原样接管。

非目标：子 issue 执行层改动；per-issue workflow 覆盖（统一绑默认 workflow）。

## 1. 新流程生命周期（总览）

```
splitting ──planner 生成 task.md + cs-cloud 提交 deliverable──► awaiting_split_review
awaiting_split_review ──approve（快照+校验通过）──► materializing ──全部子 issue 就位──► split_active ──► …（现有后续）
awaiting_split_review ──reject（带 review_comment）──► splitting（重新派发 planner，带反馈重生成）
materializing ──失败数 > max_failures／不可恢复──► failed ──人工 recover──► splitting
任意非终态 ──取消（二次确认）──► cancelled（级联停止子 issue，物化 job 每步响应取消）
```

角色分工：**agent 只负责生成文档**（splitting 阶段）；**物化是服务端确定性代码**（materializing 阶段）；**人只在 Gitea 评审/编辑文档 + 在 Multica 点 approve/reject**。

## 2. 节点状态机

### 2.1 新增状态与迁移边

新增 `materializing`。涉及改动（锚点见 research 02 §2）：

| 改动面 | 内容 |
|---|---|
| DB | 新迁移仿 `135` 的动态 CHECK 重建模式，`multica_workflow_node_run.status` 枚举加 `materializing` |
| Go 常量 | `workflow_split.go`（split 语义侧）加 `NodeRunStatusMaterializing` |
| `validTransitions`（`workflow.go:111-136`） | 新增边：`awaiting_split_review→materializing`、`materializing→split_active`、`materializing→failed`、`materializing→cancelled`、`awaiting_split_review→splitting`（reject 回退，现状已有 splitting→awaiting_split_review） |
| 守卫函数 | `canCancelSplitNodeStatus` 纳入 `materializing`（物化可取消）；`canRegenerateSplitNodeStatus` 不变；`resolveSplitStatus`/`reconcileParentNode` 在 `materializing` 期间**抑制收敛**（不得提前迁移 split_active/completed） |
| 前端 5 处 | `packages/core/types/workflow.ts`（union + display 映射→in_progress）、`node-run-status-icon.tsx`、`node-run-card.tsx`（动画/badge）、`execution-panorama-page.tsx`（文案/timer）、`locales/{en,zh-Hans}/workflows.json` |

### 2.2 取消语义

`materializing` 纳入可取消状态后，物化 job **每条子任务处理前检查节点状态**：节点已 cancelled/failed 则安全中止（已建 issue 由 `CancelSplitNode` 现有级联逻辑停止；未建行保持 created，节点已终态不再调度）。取消仍走现有二次确认防呆。

## 3. task.md 格式契约

以[定稿契约](../wayfinder/split-deliverable-flow/assets/task-md-format-proposal.md)为准，要点：

- 结构：每子任务一个 `## task: <标题>` 节（容忍 `任务/子任务`、全角冒号）；节首裸 `key: value` 元数据行，承认字段仅 `key`（必填）、`assignee`（必填）、`depends-on`（可选，逗号分隔 key）；其余到下一节为描述正文（必填非空）
- `key`：`^[a-z0-9][a-z0-9-]{0,62}$`，文档内唯一；兼作**物化幂等键**（写 split task 行 `draft_key` 列）
- `assignee`：显示名或邮箱，仅解析**人类成员**；无匹配/重名/非人类 → 报错指行
- 依赖：全文解析后统一校验（未知 key/自依赖/环，环检测复用 `validateSplitTaskGraph`）
- 护栏：未知字段名报错给拼写建议；坏 H2 标题报错；围栏代码块豁免；50 条上限（沿用现状）
- 报错：422 + `details: [{line, field, message}]`，一次返回全部问题

解析器落点：新建 `server/internal/service/split_task_md.go`（纯函数：parse → 结构化任务列表 + 行号错误集），与 DB 解耦便于单测。

## 4. Gitea 交付物流集成

### 4.1 deliverable 注册与提交（planner 侧）

- split 节点的 task.md 注册为节点 deliverable：**系统在 run 启动时为 split 类型节点自动注册**一条 required deliverable（标题固定 `task.md`），不需要模板作者手配。run 级快照（`multica_workflow_node_run_deliverable`）与 submission 行由现有机制派生。
- planner agent 提交路径完全复用现有 document deliverable 流：claim 响应/cs-cloud env 注入 `gitea_deliverables` 上下文（owner/repo/带 token clone URL/inst/node 分支/预算路径 `DeliverablePath(..., "task.md")` → `<NodeDir>/task.md`），agent 执行 `cs-cloud workflow deliverable submit --deliverable <id> --file task.md`（push node 分支 + 开 node→inst PR + 回注 PR URL）。
- **review 就绪触发点**：`SubmitNodeRunDeliverable`（`workflow_run.go:1125`）回注 PR URL 后，检测所属节点为 split 类型且处于 `splitting` → 迁移 `awaiting_split_review` + 发布 `split_review_ready` 事件（取代现状的 draft submit 触发）。

### 4.2 读取（approve 侧，新建）

- `server/internal/gitea/client.go` 新增 `ReadFile(ctx, owner, repo, path, ref) (content []byte, blobSHA string, err error)`：contents API `GET /repos/{o}/{r}/contents/{p}?ref=<node分支>`（仿现有私有 `getFileSHA`，取 content base64 + sha）。
- approve 时刻以 node 分支为 ref 读取——天然包含人在 PR 源分支上的网页编辑。

### 4.3 merge（approve 侧，复用）

- 复用 `mergeReviewURL`/`ParsePullRequestIndex`（`workflow_deliverable_repo.go:1004-1017`）对 submission 的 PR URL 执行 merge。
- 时序：**快照入库 + 物化入队先行，merge 在其后执行**（快照是物化唯一真相源，merge 只是归档动作）。merge 失败：发布告警事件、不影响 materializing；人可在 Gitea 自行 merge，或后续加补偿重试。

### 4.4 前端入口

- 复用 deliverable 面板现有 PR 链接渲染（`node-run-deliverables.tsx`）。文件级 `_edit` 直跳本期不做（fog）。

## 5. approve 即快照 + 异步物化

### 5.1 快照存储（新表）

```sql
CREATE TABLE multica_workflow_split_snapshot (
    node_run_id   UUID PRIMARY KEY REFERENCES multica_workflow_node_run(id) ON DELETE CASCADE,
    content       TEXT NOT NULL,            -- approve 时刻 task.md 全文
    source_branch TEXT NOT NULL,            -- node 分支 ref
    blob_sha      TEXT NOT NULL,            -- Gitea blob SHA
    pr_url        TEXT NOT NULL DEFAULT '', -- 评审 PR 链接（审计）
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

1:1 随 node run 生命周期；物化 job 只读本表，不再访问 Gitea。

### 5.2 approve 端点改造（`POST /api/node-runs/{id}/split/approve`）

保留外壳：`RequireSplitReviewer` 鉴权、`GetWorkflowNodeRunForUpdate` 行锁。请求体简化：`{ "review_comment": "" }`（可选，归档用）；删除 `approved_task_ids/modifications/expected_versions/confirm_empty`（无 draft 后无意义）。

执行序列：

1. 状态检查：非 `awaiting_split_review` → 409（**防重复/并发 approve**：行锁 + 状态机双重挡）
2. 定位 submission（split deliverable 的 live submission）→ ReadFile(node 分支) 取内容 + blob SHA；Gitea 失败 → 502 可重试
3. 解析 + 校验流水线（§3：结构 → 字段语义 → 依赖图 → 指派人硬校验查成员）→ 失败 422 `details`
4. tx 内：
   - 写 `multica_workflow_split_snapshot`（PK 冲突即重复 approve，二次挡）
   - 写 split task 行：`status='created'`、`draft_key=key`、title/description/sort_order、assignee 解析结果（`assignee_type='member'` + `assignee_id`）；两遍法写依赖（先插全部行拿 UUID，再回填 `depends_on`）
   - 节点 → `materializing`
   - `EnqueueWorkflowDispatch(phase='materialize', node_run)`
5. tx 后：merge PR（§4.3）→ 发布 `split_approved` 事件 → `OnNodeStatusChanged`

### 5.3 物化 job（dispatch job 新 phase `materialize`）

挂点：`WorkflowDispatchWorker.process` 新增 case（先例：`completeGatewayDispatch`，`workflow_dispatch.go:352`），claim+lease/过期重入队/崩溃恢复全部现成。

主循环（按 `sort_order` 逐条处理快照对应的 split task 行）：

```
for each 行 where status='created' and issue_id is null（按 sort_order）:
    1. 重读节点状态：非 materializing → 中止（取消/失败响应）
    2. 行锁（SELECT ... FOR UPDATE）内再次确认 issue_id is null（幂等闸门）
    3. 创建子 issue：复用 createWorkflowSubIssue/CreateIssueWithOrigin（origin_type='workflow_split', origin_id=行 id）
       + ensureSplitChildIssueAssignee（assignee_type='member' → startDefaultWorkflow 语义）
    4. 回写行 issue_id；发布 split_child_issue_created
    5. 失败 → 进入重试策略（§5.4），不阻塞后续行
全部行 issue_id 就位 → 节点 → split_active → 触发 ScheduleReadyTasks（现有调度循环接管）
```

断点续跑天然成立：job 任何时刻崩溃/重入队，已建行经闸门跳过，未建行继续。

### 5.4 失败与重试语义

| 场景 | 语义 |
|---|---|
| 单条创建失败（DB/Gitea 等瞬时错误） | 行记录 `last_error`；**有限自动重试**：退避 1min → 5min → 15min，最多 3 次（利用 dispatch job 的 attempts/handleFailure 机制，具体字段以实现时核对为准）；超限 → 行 `failed` |
| 单条 failed 的下游 | 保持 pending（依赖未 done 不调度，现有 `readySplitTaskIDs` 语义），**不自动 skip**——留待人工重试救回 |
| 失败行数 > `max_failures` | 节点 → `failed`（复用 resolveSplitStatus 的 MaxFailures 判定模式） |
| 人工单条重试 | 新端点 `POST /split/tasks/{taskId}/retry`（`materializing`/`failed` 态可用）：行重置 `created` + 清 `last_error` + re-enqueue 物化 job |
| 指派人在 approve→dispatch 间被停用 | 调度循环现有复检（`split_assignee_invalidated`）原样保留 |
| approve 前校验失败 | 不进入物化：422 `details`（行号），人在 Gitea 改后重新 approve |
| 重复 approve / 事件重放 / job 重复 enqueue | 行锁+状态机（5.2-1）、快照表 PK（5.2-4）、行 issue_id 闸门（5.3-2）三重防重 |
| server 崩溃于物化中途 | lease 过期 → `RequeueExpiredWorkflowDispatchJobs` → 断点续跑 |

补充硬化（可选）：`multica_issue(origin_type, origin_id)` 现仅普通索引（`042:77`），建议加部分唯一索引 `WHERE origin_type='workflow_split'` 作为子 issue 防重的 DB 兜底。

### 5.5 进度查询

`GET /split/tasks` 保留；`SplitTasksResponse.Progress` 增加 `materialized` 计数（`issue_id` 非空的行数），materializing 期间前端展示「物化中 n/m」。现有 `SplitExecutionProgressSummary` 原样复用（它本就只统计 created 及以后状态）。

## 6. API 与事件面

### 6.1 端点

| 端点 | 处置 |
|---|---|
| `POST /split/approve` | **改造**（§5.2；请求体简化为 review_comment） |
| `POST /split/reject` | **新增**：body `review_comment`（必填）；节点 → `splitting` + re-dispatch planner（上下文注入反馈，仿 `splitRepairContextExtras` 模式）+ `ArchiveReviewComment` 归档 Gitea |
| `POST /split/tasks/{taskId}/retry` | **新增**：人工单条重试（§5.4） |
| `GET /split/tasks` | 保留（§5.5） |
| `POST /split/generate`、`PATCH /split/config`、`POST /split/cancel` | 保留（generate 重新派发 planner） |
| 11 个 draft 端点 + `POST /split/chat` | **退役**（完整清单：research 02 §4.2 路由表；含 recover/reset-original/draft-tasks 增删改/draft-submit/chat） |

### 6.2 协议事件（`server/pkg/protocol/events.go:146-153`）

- 保留：`split_generation_dispatched`（planner 派发）、`split_review_ready`（task.md 提交回注触发，语义取代 draft 提交）、`split_approved`、`split_child_issue_created`
- 退役：`split_context_rendered`、`split_draft_added`、`split_draft_submit_failed`、`split_draft_submitted`
- 新增：无（materializing 状态迁移走现有 `workflow:node_run_updated`）

## 7. 退役清单与迁移处置

### 7.1 代码退役（完整锚点见 research 02 §4）

- CLI：`cmd_workflow_split.go` 全文件（draft add/submit/delete）
- daemon prompt：`buildSplitChatPrompt` 整体退役；`buildSplitPrompt` 重写（§8）
- service：`workflow_split.go` 中 draft CRUD/recover/reset/chat/recovery 解析链（§4.2 清单，约 1101-1513、2792-3252 行段）——**注意**：recovery/markdown fallback 链随 draft 退役（planner 失败恢复改走 reject→重生成 与 generate 重试，不再从输出救草稿）
- 前端：`packages/views/workflows/components/split/` 下 `split-review-panel`、`split-chat-review`、`split-draft-ledger`、`split-dependency-note`（+各自测试）退役；`split-progress-badge` 保留；`split-node-card` 改造为「deliverable 链接 + approve/reject + 物化进度」；`split-config-panel` 保留
- packages/core：退役 9 个 draft API client 方法 + 8 个 hooks（清单 research 02 §4.5）；`approveSplitTasks` 请求体改造
- locales：split_review/draft/chat 文案清理

### 7.2 数据迁移

| 迁移 | 内容 |
|---|---|
| M1 | node run status CHECK 加 `materializing`（仿 135） |
| M2 | 新建 `multica_workflow_split_snapshot`（§5.1） |
| M3 | 存量处置：`multica_workflow_split_task` 中 `status IN ('draft','approved')` 且 `issue_id IS NULL` 的行 → `status='discarded'` + `last_error` 标注「模型迁移废弃」；已物化行不动。split task status CHECK 去掉 `draft`/`approved`（保留 `discarded`——取消 CASE 仍在用） |
| 可选 M4 | `multica_issue` 加部分唯一索引 `(origin_type, origin_id) WHERE origin_type='workflow_split'` |
| 不动 | `draft_key`、`draft_source`、`split_review_chat_session_id` 列保留不 drop（代码停用；降回滚风险，后续版本再清理） |

### 7.3 e2e / 种子

- `e2e/fixtures.ts:763-840` `seedSplitReviewDrafts`：重写为「created 行 + 快照行」直插 SQL
- `e2e/issues.spec.ts:98-119`：走结构化 review UI 的流程重写为「deliverable 面板 → approve」
- `e2e/seed-data/coding-task-splitting.ts` / `scripts/import-coding-split-seed.mjs`：模板本体保留，流程文案更新
- server 侧 `workflow_split_test.go`（handler/service）draft 用例重写

## 8. buildSplitPrompt 改造（`server/internal/daemon/prompt.go`）

新 prompt 骨架：

```
You are running as a split-task planner for a Multica workflow.
Parent issue: <id/title/description 经 contextExtras 注入，现状已有>
Workspace members（显示名 <邮箱>，注入，供 assignee 引用；超上限截断）:
- 张三 <zhangsan@corp.com> …

1. 用 cs-workflow issue get <parent-id> 了解上下文
2. 将全部子任务写进 task.md，格式严格遵循 <格式契约要点内联>：
   - 每个子任务一个 ## task: 节；key（小写连字符、全局唯一）必填；
   - assignee 必须是上面名单里的人（显示名或邮箱）；
   - depends-on 仅在依赖真实存在时写
3. 提交：cs-cloud workflow deliverable submit --deliverable <id> --file task.md
   （env 与路径由平台注入，同其他节点的交付流）
Hard rules：不创建 issue、不改 issue 状态、不发评论、不改仓库代码；
交付物提交成功即停止，平台会路由给人审核。
```

- reject 重生成：同 phase 重新派发，contextExtras 注入 `review_comment` + 上一版 task.md 内容（从快照或 Gitea 读回），prompt 指示「按反馈修订后重新提交」
- 成员名单注入：`GenerateSplitTasksForDispatch` 的 contextExtras 增加 `workspace_members`（display_name + email，去重，超 ~200 截断）

## 9. 验收标准

对齐 `docs/workflows/dynamic-task-splitting.md` 口径，变化处加粗：

- [ ] 配置拆分节点的父 issue 运行后，planner 自动产出**task.md 交付物（PR 链接可见）**，人点链接在 Gitea 评审/**编辑**，回 Multica approve 后全部子 issue 跑起来
- [ ] **approve 时刻校验失败返回行号报错（格式/依赖环/指派人），人在 Gitea 修完重新 approve 即可**
- [ ] **reject 打回后 planner 带 review_comment 重生成，PR 上可见 diff**
- [ ] **approve 后再改 Gitea 文档不影响本次物化（快照语义）**
- [ ] **物化期单条失败自动重试（1m/5m/15m×3），超限标 failed 不拖死整批；人工可单条重试**
- [ ] **重复 approve / 重复入队 / 服务重启不产生重复子 issue**
- [ ] barrier 模式全部完成才放行下游，失败数超阈值父节点 failed（口径不变）
- [ ] pipeline 模式创建完成并进入调度后放行（口径不变）
- [ ] max_concurrency（默认 5）生效（口径不变）
- [ ] DAG 依赖生效、环依赖被拒绝（approve 时刻，口径不变）
- [ ] 父节点取消二次确认后级联停止（**含 materializing 中途取消**）
- [ ] 聚合徽章与父 issue 进度面板展示一致（**materializing 期间展示「物化中 n/m」**）

## 10. 风险与开放项

| 项 | 状态 |
|---|---|
| 成员在 Gitea org 的写权限（能否在 node 分支网页编辑） | **未验证**——ticket [06](../wayfinder/split-deliverable-flow/tickets/06-verify-member-gitea-write-access.md)，阻塞实现开工；不足则备选「Multica 内编辑 + 服务端代写 node 分支」（仿 `UploadMemberDeliverable`） |
| `cs-cloud` CLI 在仓库外 | submit 语义以本仓库注释推断；实现前对齐其更新/多文件行为 |
| 存量 draft 数据生产规模 | 未知；M3 选保守软处置（discarded），如量大再评估 |
| 物化重试的具体机制 | dispatch job attempts/backoff 字段以实现时核对为准；退避参数（1m/5m/15m×3）可在 review 中调整 |
| `missing` submission 状态枚举 | 疑似遗留（research 01）；本设计不依赖 |

# 拆分节点交付物化改造 · 设计 spec（第二稿）

> 状态：第二稿，已补齐实现阻塞项，待外部门禁验证。本 spec 仍以 wayfinder map `docs/wayfinder/split-deliverable-flow/map.md` 的全部已锁定决策与 research findings 为基线；本轮不改变原方案方向，只补版本归属、并发、重试、恢复和跨 runtime 契约。
> 决策依据：[Charting 决策记录](../wayfinder/split-deliverable-flow/tickets/00-charting-decisions.md) · [Gitea 流摸底](../wayfinder/split-deliverable-flow/assets/research-gitea-deliverable-flow.md) · [挂接点与复用清单](../wayfinder/split-deliverable-flow/assets/research-review-hooks-reuse.md) · [task.md 格式契约（定稿）](../wayfinder/split-deliverable-flow/assets/task-md-format-proposal.md)

## 0. 背景与目标

把拆分节点从「agent 走 CLI 逐条提交草稿 → DB 草稿表 → 结构化 review UI → 服务端同步建子 issue」改造为：

1. planner agent 像其他节点一样产出一份完整 **task.md**（全部子 issue 在文档中），经现有 Gitea deliverable 流（node 分支 + node→inst PR）提交为**节点交付物**；
2. 人点 PR 链接去 Gitea 评审/直接编辑，回 Multica **approve**；
3. approve 时刻服务端**拉取最新文档 + 解析校验 + 快照入库**（批准即快照），随后 **merge PR**；
4. 节点进入新状态 **materializing**，**服务端异步 job**（不经 agent）按快照确定性逐条创建子 issue，单条隔离 + 有限自动重试 + 人工单条重试兜底；
5. 物化完成后现有调度循环（DAG + max_concurrency + barrier/pipeline）原样接管。

非目标：子 issue 执行层改动；per-issue workflow 覆盖（统一绑默认 workflow）。

### 0.1 本轮补齐的实现决策

| 问题 | 锁定决策 | 原因 |
|---|---|---|
| reject、迟到提交、完整重生成会复用同一 node run | 增加独立的 `split_plan_generation`；它描述 task.md 评审轮次，**不复用** dispatch job 的 `generation` | dispatch generation 只保证某 phase 的 job 幂等，不能证明一份 PR/submission 属于哪轮评审 |
| dispatch job 只有 job 级 attempts | 物化重试下沉到 split task 行；dispatch attempts 只处理协调器自身的基础设施错误 | 单行失败不能重跑整批，也不能提前阻断后续行 |
| 部分 issue 已创建时能否启动 | **全量物化后一次性激活**：所有当前代 task 都有 `issue_id` 前，不启动任何 child workflow | 保留 DAG、barrier/pipeline 和 max_concurrency 的既有入口，避免半批运行后无法安全重生成 |
| cancel 与行物化并发 | 取消先写 node/generation 终态作为 fence；取消与物化统一采用 node row → task advisory lock → task row 的锁序 | 防止取消返回后又出现新 child issue，也避免反向锁序死锁 |
| approve 读取浮动分支 | 校验 PR 的 host/repo/head/base，并按 PR **head commit SHA** 读取 task.md；快照记录 commit/blob | 分支在读取、快照、merge 之间仍可变化，浮动 ref 不能作为批准证据 |
| local daemon 与 cs-cloud prompt 分叉 | 两条 runtime 路径共用一个纯 split prompt builder；`split_generate` 在 cs-cloud 中属于 deliverable producer phase | 当前 cs-cloud 走通用 issue prompt，且不会为 split phase 注入 document deliverable 上下文 |

## 1. 新流程生命周期（总览）

```
splitting(g) ──planner 生成 task.md + 提交当前代 deliverable──► awaiting_split_review(g)
awaiting_split_review(g) ──approve（固定 commit + 校验 + 快照）──► materializing(g)
materializing(g) ──当前代全部 issue_id 就位──► split_active(g) ──► …（现有后续）
awaiting_split_review(g) ──reject（带 review_comment）──► reject g ──► splitting(g+1)
materializing(g) ──可重试行等待 1m/5m/15m──► materializing(g)
materializing(g) ──耗尽行数 ≤ max_failures──► materializing(g)（不激活，等待人工单行重试）
materializing(g) ──耗尽行数 > max_failures／协调器不可恢复──► failed
failed（物化失败）──单行重试达到可恢复条件──► materializing(g)
failed（物化失败）──完整重生成──► supersede g ──► splitting(g+1)
任意可取消态 ──取消（二次确认）──► cancelled（先落 fence，再级联清理）
```

角色分工：**agent 只负责生成文档**（splitting 阶段）；**物化是服务端确定性代码**（materializing 阶段）；**人只在 Gitea 评审/编辑文档 + 在 Multica 点 approve/reject**。

上图中的 `g` 是 split plan generation。dispatch job 自己仍有按 phase 递增的 `generation`；两者必须分别存储和记录日志，不得混称。

## 2. 节点状态机

### 2.1 新增状态与迁移边

新增 `materializing`。涉及改动（锚点见 research 02 §2）：

| 改动面 | 内容 |
|---|---|
| DB | 新迁移仿 `135` 的动态 CHECK 重建模式，`multica_workflow_node_run.status` 枚举加 `materializing`；node run 增加当前 `split_plan_generation` 指针 |
| Go 常量 | `workflow_split.go`（split 语义侧）加 `NodeRunStatusMaterializing` |
| `validTransitions`（`workflow.go:111-136`） | 新增边：`awaiting_split_review→materializing`、`materializing→split_active`、`materializing→failed`、`materializing→cancelled`、`awaiting_split_review→splitting`（reject 回退，现状已有 splitting→awaiting_split_review） |
| split 专用恢复 | `failed→materializing` 只接受同代 materialization retry；`failed→splitting` 接受 planning generation failure 或 materialization failure 的完整重生成。两者都只在 split service 内校验 failure reason 并复活 workflow run/被级联取消的 sibling；**不加入通用 `validTransitions`** |
| 守卫函数 | `canCancelSplitNodeStatus` 纳入 `materializing`（物化可取消）；`canRegenerateSplitNodeStatus` 保留 failed 入口但改为新一代完整重生成；`resolveSplitStatus`/`reconcileParentNode` 在 `materializing` 期间**抑制收敛**（不得提前迁移 split_active/completed） |
| 前端 5 处 | `packages/core/types/workflow.ts`（union + display 映射→in_progress）、`node-run-status-icon.tsx`、`node-run-card.tsx`（动画/badge）、`execution-panorama-page.tsx`（文案/timer）、`locales/{en,zh-Hans}/workflows.json` |

通用 `RetryNodeRun` 当前会把失败节点重置到 `format_ok` 并派发 worker，不能直接用于 split 失败。对 `failure_reason='materialize_dispatch_failed'`，它必须路由到 split 专用的**同代物化恢复**；对 `materialize_failure_threshold` 或 planning generation failure，返回 409 并引导单行 retry/完整 generate，不能误派普通 worker。

`handleFailure` 对 `phase='split'` 耗尽也要专门写 generation/node/run 的 `failure_reason='split_dispatch_failed'`。若该代尚未创建 planner task，通用 retry 可复活同代并入队新的 split dispatch generation；已有终态 planner task 时按 planning failure 处理，要求完整 generate。

### 2.2 split plan generation 所有权

- node run 的 `split_plan_generation` 是当前评审轮次指针；首次进入 `splitting` 时从 0 增至 1。每次 reject 或完整重生成都先终结旧代，再原子递增并创建新 generation 行。
- 每代持有自己的 planner task、系统 deliverable、当前 submission、review feedback、PR URL 与状态。agent task context 必须带 `split_plan_generation`；只有与 node 当前指针及该代 `planner_task_id` 同时匹配的提交，才能成为该代的 current submission。
- “live submission”统一定义为：**当前 generation 行上绑定的 `submission_id`，且 generation 状态为 `awaiting_review`**。不得再通过“这个 node run 最新一条 submission”推断。
- reject 会把旧代标为 `rejected`、终止该代仍在运行的 planner task，再创建 `g+1`。旧 task 的迟到提交返回 409 `stale_split_generation`，不写 submission、不改变 node 状态。
- 新一代可以复用同一个 PR URL，也可以产生新 PR；generation 行是评审状态的事实来源，因此即使现有 submission upsert 复用了同一 DB 行，旧代也不会重新变为有效。
- dispatch job 的 `generation` 仍由 `NextWorkflowDispatchGeneration(node, phase)` 生成；`split` 与 `materialize` job 另带不可空的 `split_plan_generation`，运行时二者都要核对。
- 当前 planner task 在 live submission 产生前就 completed/failed 时，generation/node/run 以 `split_deliverable_missing` 或原 task failure reason 失败；不再解析 stdout 恢复 draft。submission 与 planner completion/failure 都按 node → generation → planner task 的锁序判定先后：提交先落库则后续 task 终态不改 review，task 终态先落库则迟到提交 409。任意旧代 task 的迟到终态只更新 task 审计。

首次启动、reject，以及尚未产生 child issue 的完整 generate，都通过同一个 `BeginSplitPlanGeneration` tx：锁 node，终结旧代及其非终态 planner task（如有），递增 current generation，插入 generation 行，node → `splitting`，再用独立 dispatch generation 入队 `phase='split'` job。root/下游激活 helper 识别 split node 后必须走该入口，不再先入普通 `worker` job；`dispatchSplitPhase` 只处理 job 绑定的当前 plan generation。

`split` dispatch job 也必须携带 `split_plan_generation`。旧代 pending/running job 到达 worker 时只标 stale 并退出，不能“读取 node 最新 generation 后继续”。若 planner dispatch 在创建 task 前耗尽基础设施重试，通用 node retry 走同 generation 的 split-dispatch revival；一旦该代 planner task 已终态失败，则只能完整 generate 新一代。

终结旧 planner task 的 DB 状态属于上述 tx；对 cs-cloud device 的 abort 放在 commit 后 best effort 执行，不得持 node lock 发网络请求。即使 abort 失败，generation/task stale gate 仍阻止旧进程提交。

### 2.3 取消语义

`materializing` 纳入可取消状态后，取消仍走现有二次确认防呆，但 `CancelSplitNode` 的顺序改为两阶段：

1. fence tx：`GetWorkflowNodeRunForUpdate`，再次检查可取消态，先把 node 与当前 generation 置为 `cancelled`，并把该 generation 未完成的 `materialize` dispatch jobs 标为失效，然后提交；
2. cleanup：逐 task 清理已创建的 child run/issue，并把未终态 task 置为 `cancelled`。每个 tx 都按 **node row → `LockIssueDuplicateKey(splitTaskDispatchLockKey(task.id))` → split task row** 加锁；
3. issue 状态事件只在对应 tx commit 后发布。cleanup 可重复执行，失败时允许后台/人工重试，但 fence 不回滚。

物化 job 每条处理前采用同一锁序并重读 node/generation。若取消先取得 node 锁，job 看到 cancelled 后退出；若 job 先提交一条，取消随后会在 cleanup 中覆盖它。由此保证取消成功返回后不会再新增漏清理的 child issue。

`ScheduleReadyTasks` 的 task claim/child-run start 也必须采用 node row → task advisory lock → task row，并在锁内复核 node 仍为 `split_active`、generation 仍当前、task/issue 仍可启动。这样 cancel 与 child workflow 启动的竞态也服从同一所有权规则；若 child run 已先提交，cancel cleanup 走现有 child-run cancellation 收口。

## 3. task.md 格式契约

以[定稿契约](../wayfinder/split-deliverable-flow/assets/task-md-format-proposal.md)为准，要点：

- 结构：每子任务一个 `## task: <标题>` 节（容忍 `任务/子任务`、全角冒号）；节首裸 `key: value` 元数据行，承认字段仅 `key`（必填）、`assignee`（必填）、`depends-on`（可选，逗号分隔 key）；其余到下一节为描述正文（必填非空）
- `key`：`^[a-z0-9][a-z0-9-]{0,62}$`，文档内唯一；兼作**物化幂等键**（写 split task 行 `draft_key` 列）
- `assignee`：显示名或邮箱，仅解析**人类成员**；无匹配/重名/非人类 → 报错指行
- 依赖：全文解析后统一校验（未知 key/自依赖/环，环检测复用 `validateSplitTaskGraph`）
- 护栏：文件必须是 UTF-8，解码后不超过 1 MiB；未知字段名报错给拼写建议；坏 H2 标题报错；围栏代码块豁免；50 条上限（沿用现状）
- 运行配置：approve 同时确认 run 快照中的 `default_issue_workflow_id` 仍可用于当前 workspace，且不形成禁止的嵌套 split；这里不接受 task.md 覆盖 workflow
- 报错：422 + `details: [{line, field, message}]`，一次返回全部问题；非行级错误使用 `line: 0`。现有 `SplitAPIError`/`writeSplitAPIError` 要增加结构化 `Details` 字段，不能只把错误拼进 `error` 字符串

解析器落点：新建 `server/internal/service/split_task_md.go`（纯函数：parse → 结构化任务列表 + 行号错误集），与 DB 解耦便于单测。成员解析、成员启用状态和默认 workflow 校验是 parser 之后的 service validation；快照及 split task 行保存解析后的 member UUID，物化时再复检一次成员仍有效。

## 4. Gitea 交付物流集成

### 4.1 deliverable 注册与提交（planner 侧）

- split 节点的 task.md 注册为节点 deliverable：**系统在 run 启动时为 split 类型节点自动注册**一条 required document deliverable，不需要模板作者手配。其内部标题固定为 `task`，因此现有 `DeliverablePath(..., title)` 恰好生成 `<NodeDir>/task.md`；若标题写成 `task.md`，现有函数会生成错误的 `task.md.md`。
- runtime deliverable 增加 `purpose`，此行固定为 `split_task_plan`；普通 deliverable 默认 `general`。只有该 purpose 能驱动 split review 生命周期，不能靠标题猜测。`source_deliverable_id` 使用项目固定 UUID namespace 对 `(workflow_node_id, "split_task_plan")` 做 UUIDv5，保证重复 prepare 不会再插一条。
- `<NodeDir>/task.md` 是 split node 的保留路径。run prepare 用实际 `DeliverablePath` 结果检查普通 document deliverable 冲突；命中时以可操作的配置错误拒绝启动并要求重命名普通 deliverable，不能给系统 task plan 加 suffix 或静默覆盖。
- planner dispatch 前必须成功准备 runtime deliverable、delivery repo、inst branch 与 node branch；split 流不能依赖 cs-cloud payload 中“best effort ensure repo”的兜底。任一步失败则 generation/node/run 以 `split_deliverable_unavailable` 失败，不创建一个拿不到 task.md 路径的 agent task。
- planner agent 提交路径复用现有 document deliverable 流：claim 响应与 cs-cloud payload 都注入 `gitea_deliverables` 上下文（owner/repo/带 token clone URL/inst/node 分支/精确路径），agent 执行 `cs-cloud workflow deliverable submit --deliverable <id> --file task.md`（push node 分支 + 开 node→inst PR + 回注 PR URL）。`split_generate`（含 reject/完整重生成产生的新 generation）必须在 cs-cloud 中按 deliverable producer phase 处理，而不是落入通用 issue prompt。
- **review 就绪触发点**：`SubmitNodeRunDeliverable`（`workflow_run.go:1125`）在 upsert 前校验 `purpose='split_task_plan'`、agent task ID、task 非终态和 task context 的 `split_plan_generation`。submission upsert、generation 绑定和 node → `awaiting_split_review` 必须按 node → generation → planner task 加锁并在同一 tx 提交，`split_review_ready` 只在 commit 后发布（取代现状的 draft submit 触发）。同一代重复提交同一 URL 幂等；旧代提交返回 409，不落库。
- 通用 `ReviewNodeRunDeliverable` 对 `purpose='split_task_plan'` 返回 409 `split_review_endpoint_required`，避免用户把 generic submission 标成 approved/rejected 却没有推进 split 状态。该 deliverable 只能走 generation-aware 的 split approve/reject。

### 4.2 读取（approve 侧，新建）

- `server/internal/gitea/client.go` 新增 PR metadata 读取和 `ReadFileAtCommit(ctx, owner, repo, path, commitSHA) (content []byte, blobSHA string, err error)`（contents API 的 `ref` 传 commit SHA，仿现有私有 `getFileSHA`）。
- approve 只接受当前 generation 绑定的 PR。服务端从平台 Gitea 配置和 run 拓扑计算 expected host/owner/repo、`NodeBranch` 与 `InstBranch`，并逐项校验 PR URL、head repo/ref、base repo/ref；不接受 fork、外部 host、其他 repo/branch 或 closed-unmerged PR。已由成员提前 merge 的 PR 可以批准，读取其固定 head，并直接记为 `archive_status='merged'`。
- 校验后固定 PR metadata 返回的 `head_commit_sha`，再从该 SHA 读取 `<NodeDir>/task.md`。快照同时记录 head commit SHA 与 blob SHA；不得以浮动 node branch 作为批准证据。
- Gitea 网络 I/O、文件解码和纯解析都在 DB transaction 外完成；进入批准 tx 后再锁 node/generation 并复核 current generation/submission，避免持锁等待外部服务。

### 4.3 merge（approve 侧，复用）

- 复用 `ParsePullRequestIndex` 和 `mergeReviewURL` 的鉴权/仓库定位逻辑，但 merge 目标必须是本次校验的 current generation PR，且请求携带/校验快照中的 `head_commit_sha`。
- PR 已经以该 head merge 时不再发 merge 请求，只把 snapshot 归档状态写成 `merged`。
- 时序仍为：**快照入库 + 物化入队先行，merge 在其后执行**（快照是物化唯一真相源，merge 只是归档动作）。merge 前若 PR head 已变化，不得把新 commit 一并 merge，记录 `archive_status='head_changed'` 并转人工处理。
- 若当前 Gitea 版本/API 无法做 conditional merge，则本期不自动 merge，直接记录 `archive_status='manual_required'` 并在 UI 暴露 PR 链接；不能退回无条件 merge。其他 merge 失败记录 `archive_status='failed'` + `archive_error` 并打结构化日志，不回滚 materializing。
- 归档状态由 `GET /split/tasks` 返回，不新增协议事件；`split_approved` 只表示快照和物化入队成功，不代表 PR 已归档。

### 4.4 前端入口

- 复用 deliverable 面板现有 PR 链接渲染（`node-run-deliverables.tsx`）。文件级 `_edit` 直跳本期不做（fog）。
- `awaiting_split_review` 只展示当前 generation 的 PR、代次和 approve/reject；提交期间禁用操作，409 后 refetch 并提示已有更新版本。
- 422 按文档顺序展示完整 line/field/message error summary；materializing 区分自动等待与 exhausted，只有当前代、无 `issue_id` 的 exhausted 行显示 retry。
- 对已预创建 issue 的完整 generate 必须二次确认，并显示将 supersede 的 generation 与会取消的 issue 数；archive 失败只显示带当前 PR 链接的非阻塞 warning。

## 5. approve 即快照 + 异步物化

### 5.1 generation、快照与行状态（新表/新列）

原稿的一份 node run 一份快照无法承载 reject、迟到提交和完整重生成。保留“批准即快照、物化只读快照”的决策，但把存储改为按 generation 版本化：

```sql
ALTER TABLE multica_workflow_node_run
    ADD COLUMN split_plan_generation INT NOT NULL DEFAULT 0;

CREATE TABLE multica_workflow_split_generation (
    node_run_id       UUID NOT NULL REFERENCES multica_workflow_node_run(id) ON DELETE CASCADE,
    generation        INT NOT NULL CHECK (generation > 0),
    status            TEXT NOT NULL CHECK (status IN (
        'splitting', 'awaiting_review', 'materializing', 'active',
        'rejected', 'superseded', 'failed', 'cancelled'
    )),
    planner_task_id   UUID REFERENCES multica_agent_task_queue(id) ON DELETE SET NULL,
    deliverable_id    UUID NOT NULL REFERENCES multica_workflow_node_run_deliverable(id),
    submission_id     UUID REFERENCES multica_workflow_node_deliverable_submission(id),
    review_comment    TEXT NOT NULL DEFAULT '',
    pr_url            TEXT NOT NULL DEFAULT '',
    reviewed_content  TEXT NOT NULL DEFAULT '',
    review_head_commit_sha TEXT NOT NULL DEFAULT '',
    review_blob_sha   TEXT NOT NULL DEFAULT '',
    review_archive_status TEXT NOT NULL DEFAULT 'not_started'
                          CHECK (review_archive_status IN (
                              'not_started', 'pending', 'archived', 'failed'
                          )),
    review_archive_error TEXT NOT NULL DEFAULT '',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (node_run_id, generation)
);

CREATE TABLE multica_workflow_split_snapshot (
    node_run_id       UUID NOT NULL,
    generation        INT NOT NULL,
    content           TEXT NOT NULL,             -- approve 时刻 task.md 全文
    task_path         TEXT NOT NULL,             -- <NodeDir>/task.md
    source_branch     TEXT NOT NULL,
    head_commit_sha   TEXT NOT NULL,
    blob_sha          TEXT NOT NULL,
    pr_url            TEXT NOT NULL,
    archive_status    TEXT NOT NULL DEFAULT 'pending'
                      CHECK (archive_status IN (
                          'pending', 'merged', 'manual_required', 'head_changed', 'failed'
                      )),
    archive_error     TEXT NOT NULL DEFAULT '',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (node_run_id, generation),
    FOREIGN KEY (node_run_id, generation)
        REFERENCES multica_workflow_split_generation(node_run_id, generation)
        ON DELETE CASCADE
);
```

`multica_workflow_split_task` 增加：

- `split_plan_generation INT`：新方案的非 discarded 行必填；旧 draft 软废弃后允许为 NULL；
- `materialize_retry_count INT NOT NULL DEFAULT 0`；
- `materialize_next_attempt_at TIMESTAMPTZ`；
- 唯一键改为 `(node_run_id, split_plan_generation, draft_key)`（generation 非空且 `draft_key` 非空）。

`last_error` 沿用现有 JSONB 列，物化阶段固定为 `{code, message, retryable, attempt, next_attempt_at}`；`message` 是可展示的净化文本，不带 SQL/credential。成功或人工 reset 时清空 `last_error` 与 `materialize_next_attempt_at`。

`multica_workflow_node_run_dispatch_job` 增加 nullable `split_plan_generation` 和复合 FK；CHECK 约束要求 `phase IN ('split','materialize')` 时非空、其他 phase 为空。job 的 `generation` 仍是 dispatch generation。planner/materializer 都只处理 job 绑定的 `(node_run_id, split_plan_generation)`，不能用 node 上的“最新数据”替代旧 job 的代际。

### 5.2 approve 端点改造（`POST /api/node-runs/{id}/split/approve`）

保留外壳：`RequireSplitReviewer` 鉴权。请求体改为：

```json
{
  "expected_split_generation": 2,
  "expected_submission_id": "<uuid>",
  "review_comment": ""
}
```

删除 `approved_task_ids/modifications/expected_versions/confirm_empty`（无 draft 后无意义）。执行序列拆成不持锁的外部读取与短 DB tx：

1. 读取 node 当前 generation 绑定；请求里的 generation/submission 不一致时返回 409 `stale_split_generation`，响应附当前值。若同 generation/submission 已有 snapshot，则直接返回现有状态/进度，不再访问 Gitea、发事件或 merge；否则要求该绑定满足 §2.2 的 live submission 定义。
2. transaction 外读取并校验 PR metadata（§4.2），固定 `head_commit_sha`，再按该 SHA 读取 task.md；Gitea 不可达返回 502，可安全重试。
3. 执行 §3 的 UTF-8/大小/格式/图校验与成员候选解析；失败返回 422 `invalid_task_md` + 完整 `details`。
4. tx 内依次：
   - `GetWorkflowNodeRunForUpdate`，再锁当前 generation；复核 workflow run 仍 running、generation/submission 仍与请求一致；node 应为 `awaiting_split_review`，或属于“同代 snapshot 已存在”的精确 replay；
   - 若锁内确认是精确 replay，记录 replay outcome 并立即结束 tx，不再执行成员复检、snapshot/task insert、入队和 post-commit side effects；
   - 复检每个 member 仍启用且有资格被指派，并校验 run 快照中的默认 workflow；
   - 插入本代 snapshot；按两遍法插入本代 split task（写入解析后的 member UUID 与 run 快照中的默认 `workflow_id`，先取得 task UUID，再把 key 依赖转换为本代 task UUID）；
   - 把当前 generic submission 状态写为 `approved`（表示 review verdict，不代表 merge 成功）；
   - generation 与 node → `materializing`；
   - 调用专用 `EnqueueSplitMaterialization(node_run_id, split_plan_generation)`；内部使用 `NextWorkflowDispatchGeneration(..., "materialize")` 创建 job。
5. commit 后发布 `split_approved`/node update，再按 §4.3 尝试 conditional merge 并单独更新 snapshot 的 archive 状态。

transaction 内任何冲突都不留下半份 snapshot/task/job。snapshot 主键提供第二重防重复；两个并发 approve 中，后取得锁的一方若发现同代 snapshot 已提交，按精确 replay 返回 200 当前状态，不再重建行。只有请求指向非当前 generation/submission 才返回 409。

### 5.3 物化协调器（dispatch job 新 phase `materialize`）

`EnqueueWorkflowDispatch` 的 phase allowlist、`WorkflowDispatchWorker.process` switch 与 SQL CHECK 同时加入 `materialize`。协调器 job 绑定 plan generation；处理时若 node 当前 generation 已改变、generation 已终态或 node 非 `materializing`，把 stale job 完成/失效后退出，不接触新一代。

每次 sweep 按 `sort_order, id` 处理本代“`issue_id IS NULL` 且初次到期/重试到期”的行。每一行使用独立 tx，锁序固定：

```text
1. GetWorkflowNodeRunForUpdate(node_run_id)
2. 校验 node.status=materializing 且 current generation=job.split_plan_generation
3. LockIssueDuplicateKey(splitTaskDispatchLockKey(task.id))
4. GetSplitTaskForUpdate(task.id)，复核 generation/status/issue_id/next_attempt_at
5. 复检 assignee 仍是启用的人类成员，且本代固定的默认 workflow 仍可启动
6. CreateOrGetWorkflowSplitIssue(origin_type='workflow_split', origin_id=task.id)
7. 同一 tx 回写 task.issue_id；commit
8. commit 后发布 issue created / split_child_issue_created
```

这里不得直接复用语义不同的 `createWorkflowSubIssue`。新增的 `CreateOrGetWorkflowSplitIssue` 先按 origin 查找，存在则校验 workspace、parent 和 origin 后补链；不存在则计数并 `CreateIssueWithOrigin`。issue 创建与 task 链接在同一 tx，DB 唯一索引作最终防重；origin 已被错误 issue 占用属于永久行错误。

创建出的 issue 可以带 assignee，但**不得在逐行 tx 后调用**会启动默认 workflow 的 `Assignments.AfterIssueAssigned`。只有协调器在终局 tx 中确认本代每一行都有 `issue_id` 后，才将 generation/node → `active/split_active`；commit 后调用现有 `ScheduleReadyTasks`，由它统一执行 DAG、max_concurrency、barrier/pipeline 和 assignment side effects。

一行失败先回滚该行 tx，再在短 tx 中按 §5.4 写该行重试状态，继续 sweep 后续行。阈值只在整个 due sweep 完成后评估，不能因前面一行失败而跳过后面的行。所有 issue/status 事件均在各自 commit 后发出。

### 5.4 失败、重试、恢复与 job 调度

| 场景 | 锁定语义 |
|---|---|
| 可重试的单行失败 | 首次执行失败后 `retry_count=1`，下一次为 +1min；再次失败后分别为 +5min、+15min；第 4 次执行仍失败才置 `status='failed'`。即“首次 + 3 次重试”，最多 4 次执行 |
| 等待中的行 | 保持 `status='created'`、`issue_id=NULL`，写 `materialize_next_attempt_at` 与结构化 `last_error`；不计入 exhausted failure |
| 永久行错误 | inactive member、origin 冲突、冻结数据不满足约束等不做自动重试，立即 `failed`；连接中断、deadlock 等协调器/DB 基础设施错误走 job 级失败 |
| sweep 后仍有未来重试 | 使用新 SQL `DeferWorkflowDispatchJob` 把**同一个** running job 调到最早 `next_attempt_at`，清 lease 并把协调器 `attempt_count` 复位；行等待不消耗通用 job attempts |
| 全部行已有 `issue_id` | 原子进入 `split_active`，随后才启动 ready child workflows |
| exhausted 行数 `1..max_failures` | node 保持 `materializing`，不启动任何 child workflow，也不再自动 dispatch；UI 明确显示“等待人工重试” |
| exhausted 行数 `> max_failures` | generation/node/run → `failed`，`failure_reason='materialize_failure_threshold'`，按现有 fail-fast 规则取消 sibling |
| 协调器基础设施重试耗尽 | job 使用现有 attempts/backoff；耗尽后 generation/node/run → `failed`，但 reason 写 `materialize_dispatch_failed`，不能用泛化的 `dispatch_failed` 隐去恢复路径 |
| 人工单行重试 | `POST /split/tasks/{taskId}/retry` 在 node → advisory → task lock 下只接受当前代、`issue_id IS NULL` 的 exhausted 行；清错误、重置 4 次执行预算。materializing 时唤醒/新建 job；两个并发 retry 中后者看到已 reset 状态只返回当前进度，不再次重置/入队 |
| failed 态单行重试 | 先重置选中行；若其余 exhausted 仍 `> max_failures`，run 保持 failed 且不入队。降到阈值内后，同一 tx 复活 workflow run、可恢复 sibling、node/generation → materializing，再 ensure job |
| 完整重生成 | `POST /split/generate` 接受 planning generation failure 或 materialization failure：旧 generation 标 `superseded`；若已预创建 child issue，则先取消这些尚未启动 workflow 的 issue；随后复活 run/sibling、递增 generation 并重新派发 planner。旧 snapshot/task 保留审计 |
| server 崩溃 | running job lease 过期后由 `RequeueExpiredWorkflowDispatchJobs` 接管；行锁、origin 唯一键和 `issue_id` 闸门保证断点续跑 |

`ensure materialize dispatch` 必须在 node/generation 锁内判断：已有 pending job则把 `scheduled_at` 提前到 now；已有 running job则由它的终局复查观察新行；没有可运行 job才用新的 dispatch generation 入队。这样人工 retry 不会制造两个并行协调器。

通用 `handleFailure` 仅处理协调器未吸收的基础设施错误。通用 `RetryNodeRun` 见 §2.1：`materialize_dispatch_failed` 走同 generation 恢复；阈值失败不允许重置到 `format_ok`。

materialization full generate 采用可恢复的三阶段，而不是跨整批持有一个 tx：先在 node lock 下把旧 generation 标 `superseded`、失效旧 dispatch jobs/planner task 形成 fence（split task 行暂不标终态）；再按 §2.3 的锁序幂等取消每个预创建 issue 并收口对应 task；最后一个 tx 确认旧代无可运行 child，复活 run/sibling，并按 `BeginSplitPlanGeneration` 的同一事务契约创建 `g+1`。中途失败时 node 保持 failed，重复 generate 从 cleanup 续跑，不会提前派新 planner。

### 5.5 进度查询

`GET /split/tasks` 保留，默认只返回 node 当前 generation 的 tasks；旧代通过 generation/snapshot 数据保留作审计，但不混入执行汇总。`SplitTasksResponse` 增加：

- 顶层：`split_plan_generation`、`submission_id`、`archive_status`、`archive_error`；
- progress：`materialized`（`issue_id` 非空）、`retry_waiting`、`exhausted`、`next_retry_at`；
- task：`materialize_retry_count`、`materialize_next_attempt_at` 和结构化 `last_error`。

`retry_waiting/exhausted` 只统计 `issue_id IS NULL` 的物化行，不能把 split_active 后 child workflow 的执行失败混进来。materializing 期间前端区分「物化中 n/m」「等待下次重试」「等待人工重试」。现有 `SplitExecutionProgressSummary` 在先过滤当前 generation 后继续复用。

## 6. API 与事件面

### 6.1 端点

| 端点 | 处置 |
|---|---|
| `POST /split/approve` | **改造**：body 为 `expected_split_generation`、`expected_submission_id`、可选 `review_comment`（§5.2） |
| `POST /split/reject` | **新增**：同样要求 expected generation/submission，`review_comment` 必填；固定读取当前 PR head 后，tx 内保存被拒内容、把 generic submission/旧代标 rejected、终止旧 planner task、创建 `g+1` 并派发 planner；commit 后 `ArchiveReviewComment`，归档失败只记录 generation warning |
| `POST /split/tasks/{taskId}/retry` | **新增**：body 必须带 `expected_split_generation`；只重试当前代行，语义见 §5.4 |
| `GET /split/tasks` | 保留，返回当前 generation、live submission、归档状态和 §5.5 进度 |
| `POST /split/generate` | 保留但请求必须带 `expected_split_generation`：splitting 中只 ensure 当前 planner；awaiting review、planning generation failure 或 materialization failure 时执行完整新一代重生成，不再从 agent output 恢复 draft |
| `PATCH /split/config`、`POST /split/cancel` | 保留；cancel 带 `expected_split_generation` 并改为 §2.3 fence 顺序 |
| draft CRUD/submit/recover/reset-original + `POST /split/chat` | **退役**（完整清单仍见 research 02 §4.2 路由表） |

reject/new-generation 的 DB 提交不依赖“必须复用原 PR”。planner 在同一 node branch 上修订时通常会复用 URL；若 cs-cloud 创建了新 PR，只要其 repo/head/base 校验通过并由当前 planner task 提交，也可成为 `g+1` 的 live submission。

reject 与 approve 使用同一套 PR 来源校验，并在 transaction 外按当前 head commit 读取最多 1 MiB 的原文；Gitea 不可达返回 502，current review 不变。tx 把原文/head/blob 和 feedback 写在被拒 generation 上，`g+1` prompt 从该固定输入生成，不能在稍后再读浮动 branch 猜“上一版”。

approve、reject、retry、generate 和 cancel 都保留 resolved split reviewer 权限门禁。所有 expected-generation 检查都必须在 node lock 内复核；它不是只在 handler 做一次的提示性校验。

### 6.2 错误响应契约

现有 `SplitAPIError` 增加 `Details []SplitValidationDetail` 和可选 current generation/submission；handler 统一输出：

```json
{
  "code": "invalid_task_md",
  "error": "task.md 解析失败（1 个问题）",
  "details": [
    {"line": 12, "field": "assignee", "message": "指派人「张三」匹配到多位成员，请改用邮箱"}
  ],
  "current_split_generation": 3,
  "current_submission_id": "<uuid>"
}
```

- 400：请求 JSON/字段本身无效；
- 409：状态、generation 或 submission 冲突，如 `stale_split_generation`；同代已批准请求属于 200 idempotent replay；
- 422：PR 来源或 task.md 业务校验失败；
- 502：平台 Gitea metadata/file 暂不可读。

`SplitErrorStatus` 同时增加映射到 502 的 upstream 枚举，避免 Gitea 故障被现有 writer 压成 500。`details` 对 422 始终存在（可以为空数组），并一次返回全部可定位问题。packages/core 的 API schema 必须按桌面端兼容规则 parse-with-fallback：新增字段缺失或类型漂移不能让旧/新客户端白屏。

### 6.3 协议事件（`server/pkg/protocol/events.go:146-153`）

- 保留：`split_generation_dispatched`（planner 派发）、`split_review_ready`（task.md 提交回注触发，语义取代 draft 提交）、`split_approved`、`split_child_issue_created`
- 退役：`split_context_rendered`、`split_draft_added`、`split_draft_submit_failed`、`split_draft_submitted`
- 新增：无（materializing 状态迁移走现有 `workflow:node_run_updated`；归档与 retry 进度通过 GET 回读）
- 行进入 retry waiting/exhausted 或被人工 reset 时，在同一 tx touch node `updated_at`，commit 后发布现有 `workflow:node_run_updated` 作为 TanStack Query invalidation 信号；前端不把进度写入 Zustand，也不为此增加轮询
- 所有保留的 split lifecycle payload 增加 `split_plan_generation`；consumer 收到非当前 generation 的迟到事件只做审计，不覆盖当前 UI

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
| M2 | runtime deliverable 加 `purpose`（默认 `general`）；node run 加 current generation；新建 `multica_workflow_split_generation`；dispatch job 的 split/materialize phase 绑定 plan generation。run prepare 用确定性 source ID 插入 `split_task_plan` deliverable，并为全部存量 split node runs 幂等回填该 runtime deliverable |
| M3 | 新建按 `(node_run_id, generation)` 主键的 `multica_workflow_split_snapshot`（§5.1） |
| M4 | split task 加 generation/retry 字段；唯一键改为 `(node_run_id, split_plan_generation, draft_key)`。旧 `draft/approved` 且未物化行 → `discarded` + `last_error` 标注「模型迁移废弃」；status CHECK 去掉 `draft/approved`，保留 `discarded` |
| M5（强制） | 对 issue origin 做重复预检后，创建部分唯一索引 `(origin_type, origin_id) WHERE origin_type='workflow_split'`；发现重复必须中止迁移并人工修复，不能降级为普通索引 |
| 不动 | `draft_key` 继续作为当前代幂等 key；`draft_source`、`split_review_chat_session_id` 暂不 drop（代码停用，降低回滚风险） |

存量状态处置也必须明确：

- 部署前 preflight 要求不存在 `splitting/awaiting_split_review` 的旧协议 node run；若存在则停止 rollout，先由 operator 取消对应 run。不能让不带 generation 的旧 planner 与新提交端点并行；
- 已经创建 child issue 的存量 split node 不回滚执行：为它们补 generation 1 和确定性 deliverable，把现有 task 归到该代；generation 状态按 node 的 active/failed/cancelled 结果回填。它们允许没有 task.md snapshot，因为物化已发生；
- M5 前先列出所有重复 `workflow_split` origin 及其 task/issue 关系。只有保留项明确、其余 issue 已修复或取消后才能建唯一索引；
- up/down migration 都要先重建相关 CHECK/FK，再 drop 新表/列；down 不尝试把已生成的 task.md 内容还原成旧 draft ledger。

### 7.3 e2e / 种子

- `e2e/fixtures.ts:763-840` `seedSplitReviewDrafts`：重写为「current generation + snapshot + 本代 created 行」直插 SQL
- `e2e/issues.spec.ts:98-119`：走结构化 review UI 的流程重写为「deliverable 面板 → approve」
- `e2e/seed-data/coding-task-splitting.ts` / `scripts/import-coding-split-seed.mjs`：模板本体保留，流程文案更新
- server 侧 `workflow_split_test.go`（handler/service）draft 用例重写

## 8. buildSplitPrompt 与跨运行时提交契约

新增纯包 `server/internal/splitprompt`，输入只包含 parent issue、workspace members、split config、generation、deliverable ID、review feedback 和运行时完成指令，不依赖 daemon/service DB 类型。local daemon 的 `BuildPrompt` 与 `TaskService.buildCSCloudPayload` 都先映射到同一个 builder；禁止各自维护第二份 task.md 格式说明。

新 prompt 骨架（两条运行时路径共有）：

```
You are running as a split-task planner for a Multica workflow.
Split plan generation: <g>
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
交付物提交成功后执行 <runtime finish instruction>，平台会路由给人审核。
```

- local daemon 的完成指令是“提交成功后退出，由 claim/complete 流收口”；cs-cloud 的完成指令是把 `cs-cloud workflow task complete --summary "..."` 作为最后一步。deliverable submit 负责进入 review，task complete 只终结 planner task，不能二次迁移 node。
- `workflowPhaseFromTask` 仍返回 context 中的 `split_generate`；新增 `isDeliverableProducerPhase`，至少包含 `worker` 和 `split_generate`。cs-cloud 对 split phase 注入 delivery repo env、repos、deliverable refs，但不追加通用 worker 编码说明。
- task context 增加 `split_plan_generation` 与 `split_deliverable_id`；submission handler 用 task ID + 这两个字段做 stale gate。当前 planner task 在提交前终态按 §2.2 失败本代，之后由 generation-aware generate 新起一代；提交后的迟到 complete/fail 不改变 `awaiting_split_review`。
- reject 重生成：创建新 generation 后同 phase 重新派发，contextExtras 注入被拒 generation 已持久化的 `review_comment`、固定 head SHA/path 和 task.md 内容，prompt 指示“按反馈修订后重新提交”。正文受 runtime prompt budget 截断时，必须同时给出 `git show <head_sha>:<task_path>` 精确读取指令；node branch 可作为工作副本，但不能替代固定 rework 输入。
- 成员名单注入：`GenerateSplitTasksForDispatch` 的 contextExtras 增加 `workspace_members`（仅 active human，按 member ID 去重，display_name + email，稳定排序，超 ~200 条时带明确截断提示）。
- 单测对同一个 `SplitPromptInput` 比较 local 与 cs-cloud 的共享主体必须一致，并分别断言完成指令和 deliverable env；这项测试防止以后再次分叉。

## 9. 验收标准

对齐 `docs/workflows/dynamic-task-splitting.md` 口径，变化处加粗：

- [ ] 配置拆分节点的父 issue 运行后，planner 自动产出**task.md 交付物（PR 链接可见）**，人点链接在 Gitea 评审/**编辑**，回 Multica approve 后全部子 issue 跑起来
- [ ] **approve 时刻校验失败返回 422 + 全量行号 `details`（格式/依赖环/指派人），人在 Gitea 修完重新 approve 即可**
- [ ] **reject 打回后 planner 带 review_comment 进入新 generation，PR 上可见 diff；旧 planner 的迟到提交返回 stale，不会把节点带回旧版**
- [ ] **approve 固定并快照 PR head commit；之后再改 Gitea 文档不影响本次物化，自动 merge 也不会吞入新 commit**
- [ ] **物化期单条失败按 +1m/+5m/+15m 自动重试（首次 + 3 次，最多 4 次执行），且不阻断同 sweep 的后续行**
- [ ] **有 exhausted 行但数量 ≤ max_failures 时保持 materializing、所有 child workflow 均未启动并提示人工重试；超过阈值才 fail-fast**
- [ ] **人工单行 retry 能从 materializing 恢复；failed 降到可恢复阈值后能复活 run/sibling 并续跑同代**
- [ ] **完整 generate（旧 draft recover 语义已退役）会保留旧快照审计、取消旧代预创建 issue、进入新 generation，且不会复用旧 task 作为当前数据**
- [ ] **同 generation/submission 的重复 approve 返回 200 现有进度；重复入队 / 服务重启不产生重复子 issue 或重复 merge**
- [ ] **cancel 与物化并发压测下，取消返回后不再出现新 issue；所有已创建 issue 最终 cancelled，且无锁序死锁**
- [ ] barrier 模式全部完成才放行下游，失败数超阈值父节点 failed（口径不变）
- [ ] pipeline 模式创建完成并进入调度后放行（口径不变）
- [ ] max_concurrency（默认 5）生效（口径不变）
- [ ] DAG 依赖生效、环依赖被拒绝（approve 时刻，口径不变）
- [ ] 父节点取消二次确认后级联停止（**含 materializing 中途取消**）
- [ ] 聚合徽章与父 issue 进度面板展示一致（**materializing 期间展示「物化中 n/m」**）
- [ ] local daemon 与 cs-cloud 都收到同一 task.md 契约、成员列表、generation 和正确 deliverable 路径；cs-cloud 能显式完成 planner task
- [ ] Gitea 不支持 conditional merge 时批准/物化仍成功，UI 明确显示 manual_required；不会无条件 merge

### 9.1 必须具备的测试 seam

| 层 | 最低覆盖 |
|---|---|
| parser 单测 | UTF-8/1 MiB 边界、围栏代码块、坏 H2、未知字段建议、重复/非法 key、成员歧义、未知依赖、自依赖、环、50 条边界、一次返回多错误 |
| handler/service 集成 | 初始激活只派 split job、stale split job、generation/submission CAS、同 URL 新 generation、旧 task 迟到提交、PR repo/branch/head 校验、固定 commit 快照、approve/reject 并发 |
| materializer DB 集成 | 每行独立提交、后续行不被前行失败阻断、四次执行时间表、defer 不消耗 job attempts、阈值两侧、同代 revival、完整重生成 |
| 并发/幂等 | 两个 worker、lease 过期、issue 创建后进程中断、人工 retry 与 running job、cancel fence；断言 origin 唯一且无 orphan issue |
| prompt/客户端 | local/cs-cloud 共享主体、`task` 标题生成 `task.md`、普通 deliverable 路径冲突被拒、split phase 注入 repo env、结构化错误 malformed-response fallback、当前代进度渲染 |

## 10. 风险与开放项

| 项 | 状态 |
|---|---|
| 成员在 Gitea org 的写权限（能否在 node 分支网页编辑） | **review surface 集成/上线门禁，非 parser/materializer 开工门禁**——继续执行 ticket [06](../wayfinder/split-deliverable-flow/tickets/06-verify-member-gitea-write-access.md)。若失败，回到原备选「Multica 内编辑 + 服务端代写 node branch」（仿 `UploadMemberDeliverable`）单独评审；本期不悄悄扩入 hosted editor |
| `cs-cloud` CLI 在仓库外 | integration gate：核对 `deliverable submit --file`、同 PR 更新/新 PR、task complete 和请求头。设计同时接受同/新 PR；共享 prompt、generation gate 与服务端测试可先开工 |
| 存量 draft 数据生产规模 | 未知；M4 保守软处置为 discarded。rollout 前输出计数与 active node 清单，命中 §7.2 STOP 条件就不迁移 |
| 物化重试的具体机制 | **已锁定**为行级 +1m/+5m/+15m、dispatch attempts 仅管协调器；实现不得复用现有 job-level `handleFailure` 代替 |
| conditional merge 支持 | 实现时探测当前 Gitea client/API；不支持则固定走 `manual_required`，因此不阻塞批准和物化 |
| 重复 workflow_split origin | M5 硬门禁；先报告并人工修复，禁止跳过唯一索引上线 |
| 已安装桌面端 API 漂移 | **上线 STOP**：响应新增字段必须 schema parse-with-fallback；approve/reject 请求契约和 draft 端点退役只有在最低支持桌面版本理解 generation/结构化错误后才能启用 |
| `missing` submission 状态枚举 | 疑似遗留（research 01）；本设计不依赖 |

至此，核心数据模型、事务边界和失败恢复已可开工。仍需完成的外部门禁是 Gitea 网页编辑权限、cs-cloud CLI 契约和桌面端最低版本；它们决定启用/集成方式，不允许实现阶段自行改写本文的核心语义。

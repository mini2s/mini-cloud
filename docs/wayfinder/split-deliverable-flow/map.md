---
wayfinder: map
title: 拆分节点交付物化改造（task.md → Gitea review → 服务端物化）
tracker: local-markdown
created: 2026-01-27
---

## Destination

一份**可交付实现的设计 spec**：把拆分节点从「agent 走 CLI 逐条提交草稿 → DB 草稿表 → 结构化 review UI → 服务端建子 issue」改造为「agent 产出完整 task.md（全部子 issue 在文档中）→ 以交付物形式展示、人去 Gitea review/编辑 → Multica 内 approve 即快照 → 服务端确定性物化」。spec 必须覆盖：节点状态机、task.md 格式契约、review/驳回流程、物化执行模型、重试/失败/幂等语义。

## Notes

- 领域：Multica workflow 拆分节点（split node）。现状实现锚点：
  - 编排：`server/internal/service/workflow_split.go`（SplitOrchestrator）
  - HTTP：`server/internal/handler/workflow_split.go`
  - 提示词：`server/internal/daemon/prompt.go`（buildSplitPrompt / buildSplitChatPrompt）
  - CLI：`server/cmd/cs-workflow/cmd_workflow_split.go`
  - PRD：`docs/workflows/dynamic-task-splitting.md`
  - 交付物体系：`server/migrations/133_workflow_deliverables.up.sql`、`server/internal/service/workflow_deliverable_repo.go`（含 Gitea document 归档流）
- 本会话应 consult 的技能：grilling（HITL 决策）、research（AFK 摸底）、prototype（格式样例）
- 站立偏好（charting 已确认）：
  - 物化优先服务端确定性代码，不引入 LLM 会话
  - 保表换皮：`multica_workflow_split_task` 表保留作物化/调度载体，草稿期交互（draft CLI、draft 编辑 API、结构化 review UI、split_chat）退役
  - task.md 是唯一真相源；approve 即快照，物化只读快照

## Decisions so far

- [Charting 决策记录：拆分节点交付物化改造](tickets/00-charting-decisions.md) — destination = 可交付实现的设计 spec
- [Charting 决策记录：拆分节点交付物化改造](tickets/00-charting-decisions.md) — 物化 = 服务端确定性代码，agent 只负责生成文档
- [Charting 决策记录：拆分节点交付物化改造](tickets/00-charting-decisions.md) — 无独立 review 视图：人去 Gitea 编辑，回 Multica approve/reject
- [Charting 决策记录：拆分节点交付物化改造](tickets/00-charting-decisions.md) — task.md 字段 = 标题 + 描述 + 依赖 + 建议指派人（仅人类成员）；workflow 不进文档
- [Charting 决策记录：拆分节点交付物化改造](tickets/00-charting-decisions.md) — approve 时指派人硬校验：每条子任务必须有可解析的人类指派人
- [Charting 决策记录：拆分节点交付物化改造](tickets/00-charting-decisions.md) — 批准即快照：approve 时刻拉 Gitea 最新内容（含人改）→ 校验 → 快照入库，物化只读快照
- [Charting 决策记录：拆分节点交付物化改造](tickets/00-charting-decisions.md) — 异步物化：节点新增「物化中」状态，后台逐条执行
- [Charting 决策记录：拆分节点交付物化改造](tickets/00-charting-decisions.md) — 失败策略：单条隔离 + 有限自动重试 + 人工单条重试兜底
- [Charting 决策记录：拆分节点交付物化改造](tickets/00-charting-decisions.md) — reject = 打回 agent 带反馈重做；人自改后直接 approve（快照自然取最新）
- [Gitea 文档交付物流现状摸底](tickets/01-gitea-deliverable-flow.md) — 拓扑 org/repo/inst/node 分支 + PR 评审门已明；写路有两条（agent cs-cloud / 人服务端代写）；读内容/记 SHA 无现成 API 需新建；前端无文件级跳转链接
- [Review 挂接点与拆分调度可复用清单](tickets/02-review-hooks-reuse-survey.md) — approve 走独立端点（改造现有 /split/approve）；调度/聚合/取消几乎原样复用；materializing = 1 迁移 + validTransitions + 前端 5 处；物化 job 挂 dispatch_job 新 phase（有纯 Go 先例）；退役清单已完整盘点
- [task.md 交付物接入路径与快照读取](tickets/05-task-md-intake-path.md) — 正式 deliverable PR 流（node 分支=staging、inst=approved archive）；approve = 服务端 contents read 快照 + merge；编辑入口复用 PR 链接，_edit 直跳后置
- [task.md 格式契约样例与解析校验规则](tickets/03-task-md-format-contract.md) — 标题节语法定稿：`## task:` 节 + 裸 key:value 元数据（key/assignee/depends-on）；key 必填兼作幂等键；指派人双写法三类歧义报错；报错 = 行号建议列表 + 422 details
- [撰写拆分节点交付物化设计 spec 初稿](tickets/04-draft-design-spec.md) — destination 产出：[split-task-md-deliverable-design.md](../../workflows/split-task-md-deliverable-design.md)；状态机/Gitea 集成/快照+物化 job/重试幂等/API 事件/退役迁移/验收全覆盖，待人审

## Not yet specified

- 前端「去 Gitea 编辑」的文件级 `_edit` 直跳链接——本期不做（05 已定复用 PR 链接），作为后续打磨项
- 前端形态：拆分节点上交付物入口、approve/reject 按钮、物化进度展示的具体 UI——等 spec 初稿出来后细化成 ticket
- 老 draft 态数据的处置：事实已齐（无现成清理迁移、e2e fixtures 有 SQL 级依赖需重写、生产规模未知），处置决策（delete/discard/转换）并入「撰写拆分节点交付物化设计 spec 初稿」

## Out of scope

- 子 issue 执行层（各子 issue 自己的 workflow 执行路径）的改动——本 effort 只到「子 issue 被创建并进入调度」为止
- per-issue workflow 覆盖——已明确不进 task.md；未来需要时作为独立演进另起 effort

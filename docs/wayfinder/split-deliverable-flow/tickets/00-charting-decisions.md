---
wayfinder: ticket
title: Charting 决策记录：拆分节点交付物化改造
type: grilling
status: closed
assignee: charting-session
blocked_by: []
resolved: 2026-01-27
---

## Question

拆分节点交付物化改造的 charting 阶段：命名 destination，并 breadth-first 锁定塑造架构的核心决策。

## Resolution

本 ticket 汇总 charting 会话（grilling）中与用户逐题锁定的全部决策，作为后续 ticket 的前置事实。

1. **Destination** — 一份可交付实现的设计 spec，覆盖：节点状态机、task.md 格式契约、review/驳回流程、物化执行模型、重试/失败/幂等语义。
2. **物化执行者** — 物化（按 task.md 创建子 issue）由**服务端确定性代码**完成：解析 markdown、调 issue 创建路径、逐条记录状态。agent 只负责生成文档。用户原始表述中的「新建会话调用 worker 提交 issue」经探讨后让位于确定性方案——重试/幂等/断点续全部退化为确定性代码问题。
3. **Review 交互** — 不做独立 review 视图。task.md 以交付物形式展示，人跳转到交付物平台（Gitea）查看/编辑，回 Multica 确认 approve 后才创建 issue。
4. **task.md 字段集** — 每条子 issue 携带：**标题 + 描述 + 依赖关系 + 建议指派人**。workflow 不进文档（全部子 issue 统一绑默认 workflow；per-issue 覆盖属未来演进，见 map 的 Out of scope）。
5. **指派人约束** — task.md 里指派人**只允许是人类成员**（不能指派 agent/squad）。影响面：
   - 解析器只按工作区人类成员解析（display name / email）
   - `IssueAssignmentService.ValidateAssignee` 无需改动（member 分支已存在），新链路只传 `type=member`
   - member 指派走 `startDefaultWorkflow`（`issue_assignment.go:172`）：workflow 照跑，人是责任人而非执行者
   - 现状调度循环跳过无指派人任务（`workflow_split.go:2191`）→ 引出决策 6
6. **指派人硬校验** — approve 时解析全部指派人：任何一条为空/无法解析/解析为非人类 → 整体拒绝 approve，报错指明行号与原因，人在 Gitea 改完重新批准。
7. **批准即快照** — approve 时刻：拉取 Gitea 当前文件内容（含人的最新编辑）→ 解析 + 校验（格式/DAG 无环/指派人硬校验）→ 内容快照（连带 commit SHA）存入 Multica → 物化只读快照。批准后 Gitea 上的修改不影响本次执行。
8. **老实现处置（保表换皮）** — `multica_workflow_split_task` 表保留作为物化记录 + 调度载体：approve 后从快照解析直接写入，status 从 created 起步（不再有 draft 态）；退役：draft CLI（`cmd_workflow_split.go` 的 draft 子命令）、draft 编辑 API、结构化 review UI、split_chat。调度/进度聚合/级联取消全部复用。
9. **异步物化** — approve 立即返回，节点进入新状态（materializing），后台 job 逐条创建子 issue 并实时回写 split task 行状态；全部完成 → split_active；UI 可展示物化进度（n/m 已创建）。
10. **失败/重试策略** — 单条隔离：单条失败标 failed + last_error，不阻塞整批（依赖失败者的下游保持 pending）；每条有限自动重试（指数退避）；超限标 failed 并计入 MaxFailures 判定；人工可对失败单条触发重试（复用现有节点 failed→recover 入口模式）。
11. **驳回语义** — reject = 打回重做：节点回 splitting，重新派发 agent 会话，携带 review_comment 作为反馈重新生成 task.md（新版本上传 Gitea）。人在 Gitea 的自行编辑不属于 reject——改完直接点 approve，快照自然取到最新内容。

---
wayfinder: ticket
title: 撰写拆分节点交付物化设计 spec 初稿
type: task
status: closed
assignee: wayfinder-session
blocked_by:
  - 01-gitea-deliverable-flow.md
  - 02-review-hooks-reuse-survey.md
  - 03-task-md-format-contract.md
  - 05-task-md-intake-path.md
resolved: 2026-01-27
---

## Question

汇总全部已锁定决策与前三张 ticket 的产出，撰写 destination 产物：**拆分节点交付物化设计 spec 初稿**（`docs/workflows/` 下新增，命名遵循现有惯例）。

spec 必须覆盖：

1. 节点状态机全图：splitting → awaiting_split_review → materializing → split_active / failed，含驳回回退、取消级联、recover 入口
2. task.md 格式契约（引「task.md 格式契约样例与解析校验规则」定稿）
3. Gitea 交付物流集成（引「Gitea 文档交付物流现状摸底」）
4. approve 即快照 + 异步物化 job 设计（执行机制引「Review 挂接点与拆分调度可复用清单」）
5. 重试/失败/幂等语义：单条隔离、有限自动重试（退避参数）、人工单条重试、防重（重复 approve/事件重放/并发批准）、崩溃恢复
6. API 与事件面：approve/reject/重试单条/物化进度查询端点，WS 事件
7. 退役清单与迁移处置（老 draft 数据、退役端点/UI）
8. buildSplitPrompt 改造（指示 agent 按格式契约生成 task.md 并经 cs-cloud 提交 deliverable；格式已定稿，直接具体化）
9. 验收标准（对齐 `docs/workflows/dynamic-task-splitting.md` 的口径，标注有变化之处）

产出即 destination；人审阅 spec 初稿后本 map 关闭。

## Resolution

Spec 初稿已完成：[docs/workflows/split-task-md-deliverable-design.md](../../../workflows/split-task-md-deliverable-design.md)。

覆盖：① 状态机（新增 materializing，含迁移边/守卫/前端 5 处/取消语义）；② task.md 格式契约（引定稿 + 解析器落点 split_task_md.go）；③ Gitea 集成（deliverable 自动注册、review 就绪触发点、ReadFile 新建、merge 时序=快照先行）；④ approve 端点改造序列（三重防重）+ 快照新表 multica_workflow_split_snapshot；⑤ 物化 job（dispatch job 新 phase，断点续跑，退避 1m/5m/15m×3，MaxFailures，人工单条重试端点）；⑥ API/事件面（approve 改造 + reject/retry 新增 + 11 端点退役；事件留 4 退役 4）；⑦ 退役清单与 4 个迁移（含存量 draft 软处置）；⑧ buildSplitPrompt 改造骨架（含成员名单注入、reject 反馈重生成）；⑨ 验收标准对齐 PRD；⑩ 风险登记（当时由 06 跟踪的成员写权限门禁，现已验证关闭）。

等待人审阅 spec 初稿。

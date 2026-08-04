---
wayfinder: ticket
title: Review 挂接点与拆分调度可复用清单
type: research
status: closed
assignee: charting-session
blocked_by: []
resolved: 2026-01-27
---

## Question

为「approve 即快照 → 异步物化」的设计摸清现有代码的挂接点与可复用清单：

1. **deliverable review 挂接**：现有 deliverable submission 的 approve/reject API 在哪（handler/service），approved 后触发什么（事件？节点状态迁移？）？拆分节点的「approve task.md」应复用 deliverable review 还是独立端点？各自的接入成本。
2. **节点状态机迁移点**：`multica_workflow_node_run` 的 status CHECK 约束现状（migration 135 已列出 splitting/awaiting_split_review/split_active 等），新增「materializing」状态涉及哪些迁移与代码点（TransitionNodeRun、前端状态展示映射）？
3. **调度/聚合/取消可复用清单**：`workflow_split.go` 中调度循环（readySplitTaskIDs、MarkSplitTaskRunningIfCreated）、进度聚合（SplitExecutionProgressSummary）、级联取消（CancelSplitNode）、MaxFailures 判定——哪些是「保表换皮」后原样复用的，哪些因「行从 created 起步、无 draft 态」需要调整？
4. **退役清单与影响面**：draft CLI 子命令、draft 编辑 API（PatchSplitDraftTask 等）、split_chat、结构化 review UI 涉及的前端包（packages/views、packages/core 里的 split 相关模块）——完整列出待退役文件/端点，以及存量 draft 态数据的现状（是否有迁移/种子数据依赖，如 `e2e/seed-data/coding-task-splitting.ts`、`scripts/import-coding-split-seed.mjs`）。
5. **异步 job 机制**：现状 daemon/后台 job 的执行机制（agent task queue? sweeper?）中，「服务端物化 job」最适合挂在哪种机制上？现有有无服务端自驱（非 agent）后台任务的先例？

产出：findings 写入 `docs/wayfinder/split-deliverable-flow/assets/research-review-hooks-reuse.md`，每条结论标注源码锚点（文件:行号）。

## Resolution

Findings：[research-review-hooks-reuse.md](../assets/research-review-hooks-reuse.md)（含完整锚点表）。关键结论：

1. **approve 接入点**：deliverable submission review（`workflow_run.go:1196`）approve 后无任何钩子（无事件/状态迁移/回调）→ 拆分 approve 走**独立端点**：改造现有 `POST /split/approve`（`service/workflow_split.go:1818`），保留 reviewer 鉴权/行锁/图校验/指派人硬校验外壳，重写「建子 issue」主体为「快照入库 + 行置 created + 转 materializing + enqueue 物化 job」。
2. **复用度**（已抽验）：调度/聚合/取消几乎原样复用——`readySplitTaskIDs` 已只挑 created 行、`MarkSplitTaskRunningIfCreated` 语义正好、`validateSplitTaskGraph`/`topologicalSplitTaskIDs` 与状态无关；`ApproveSplit` 重写主体、`resolveSplitStatus` 小改、调度循环跳过无 issue 行的守卫必须保留（防物化 job 未建完被抢跑）。
3. **materializing 状态**：1 个新迁移（仿 135 动态重建 CHECK）+ `validTransitions` 加边 + 前端 5 处映射（types/icon/card/panorama/locales）；`canCancelSplitNodeStatus` 与 reconcile 抑制是设计待定项。
4. **物化 job 挂点**：复用 `multica_workflow_node_run_dispatch_job` 加新 phase——有纯 Go 非 agent 先例 `completeGatewayDispatch`（`workflow_dispatch.go:352`，已核实）；claim+lease/过期重入队/崩溃恢复全现成。
5. **退役清单完整盘点**：draft CLI 全文件、11 个 draft API 端点、split_chat 全链路（含 migration 138 列）、前端 `packages/views/workflows/components/split/` 目录分文件处置、e2e fixtures SQL 依赖（`e2e/fixtures.ts:763-840`）需重写、协议事件 6 个退役 2 个保留。存量 draft 行无现成清理迁移，处置决策并入「撰写设计 spec 初稿」。

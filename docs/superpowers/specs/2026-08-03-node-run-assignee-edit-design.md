# 工作流节点卡片编辑执行者/审核者 — 设计

日期：2026-08-03
分支：feat/settings-repo-integration

## 背景与问题

Issue 详情页·工作流执行视图（`ExecutionPanorama` → `RuntimeNodeCard`）的节点卡片，当节点 run 已存在但**未开始执行**（status=pending 等）时，无法编辑执行者(worker)/审核者(critic)。

现状（运行时层）：
- `RuntimeNodeCard` 的内联 `AssigneePicker` 仅在 `!nodeRun && !runId && shouldUseDefaultWorkflow` 时启用（`runtime-node-card.tsx:524-525`）。
- 它改的是 **issue.assignee / responsible_user_id**（`onPendingWorkerUpdate → handleUpdateField → useUpdateIssue`），**不是 node_run 的 worker/critic**。
- `shouldUseDefaultWorkflow` 还显式排除 `issue.status === "backlog"`（`issue-detail.tsx:851-852`），即 backlog 任务连默认工作流预览都不显示。
- `UpdateWorkflowNodeRunAssignees`（`workflow_node_run.sql:55-67`）是死代码——SQL/generated 都在，但无任何 service/handler 调用方。

目标场景：node_run 已存在、处于 pending（未开始执行）时，在卡片上直接改 worker/critic，且**不受 issue 状态限制**。

## 目标

1. node_run 未开始执行时，`RuntimeNodeCard` 支持编辑 worker/critic，改动落到 `multica_workflow_node_run` 的 `worker_type/worker_id/critic_type/critic_id`。
2. 放宽预览条件：`shouldUseDefaultWorkflow` 去掉 `status !== "backlog"` 限制（无论 issue 状态）。
3. 复用现有死代码 `UpdateWorkflowNodeRunAssignees`（不新增 SQL）。

## 设计

### 后端

#### 新端点：`PUT /api/node-runs/{nodeRunId}/assignees`

- Handler：`UpdateNodeRunAssignees`（新增，`server/internal/handler/workflow_node_run.go` 或 `workflow.go`）
- 路由注册：`server/cmd/server/main.go` 路由表
- 请求体 `UpdateNodeRunAssigneesRequest`：
  ```
  worker_type, worker_id, worker_role_id  (可选，三选一/互斥)
  critic_type, critic_id, critic_role_id  (可选，互斥)
  ```
  （对齐 `UpdateNodeRequest` 的 worker/critic 字段语义；只传需要改的部分，未传字段保持原值——但 `UpdateWorkflowNodeRunAssignees` 是全量覆盖，handler 层需先 load 现有 node_run 合并未传字段）
- 调 `qtx.UpdateWorkflowNodeRunAssignees`（激活死代码，全量覆盖 worker_type/worker_id/critic_type/critic_id）
- **status 约束**（与现有 `SetWorkflowNodeRunResolvedWorker/Critic` 的 SQL WHERE 一致，保证不破坏状态机）：
  - 改 worker：`node_run.status ∈ {blocked, pending, format_checking, format_ok}`（worker_assigned 之前）
  - 改 critic：`node_run.status ∈ {blocked, pending, format_checking, format_ok, worker_assigned, working, awaiting_input, awaiting_critic}`（critic_reviewing 之前）
  - 不满足 → 409/400 「node run has progressed past the editable window for this role」
- 校验：workspace member 资格（worker_type/critic_type=member 时）、role_id 与 id 互斥（对齐 `UpdateWorkflowNode` 的校验 `workflow.go:970-977`）
- **UUID 解析**：nodeRunId 走 `loadWorkflowNodeRunForUser` 或等价 loader（遵守 handler UUID 约定），写库用 entity.ID。
- **事件**：成功后 publish `workflow:node_run_updated`（payload `{node_run_id, run_id, status}`），让监听器/WS 通知前端刷新。不发 `workflow_executor_assigned`/`workflow_reviewer_assigned`（status 没变，assigned 通知靠 status 流转，见 [workflow_node_notification_listeners.go](server/cmd/server/workflow_node_notification_listeners.go)）。

#### 不新增 SQL

`UpdateWorkflowNodeRunAssignees` 已存在（`workflow_node_run.sql:55-67` + generated），直接激活。

### 前端

#### `RuntimeNodeCard` 扩展可编辑条件

文件：`packages/views/issues/components/execution/runtime-node-card.tsx`

- 新增 `canEditWorker` / `canEditCritic`：当 `nodeRun` 存在且 `isNodeRunAssigneeEditable(nodeRun.status, role)` 为真时启用（role=worker/critic 分别用对应 status 集合）。
- `nodeRun` 存在时：`AssigneePicker` 的 `onSelect` 调新 mutation `useUpdateNodeRunAssignees`（传 nodeRunId + worker/critic 字段）。
- `nodeRun` 不存在（预览）：保持现有 `onPendingWorkerUpdate`（改 issue.assignee）。
- 新 helper `packages/core/workflows/node-run-status.ts`：`isNodeRunAssigneeEditable(status, "worker"|"critic")`，复用与后端一致的 status 集合。

#### 新 mutation / API

- `packages/core/api/client.ts`：`updateNodeRunAssignees(nodeRunId, req)` → `PUT /api/node-runs/{id}/assignees`
- `packages/core/workflows/queries.ts`：`useUpdateNodeRunAssignees()` mutation，成功后 invalidate workflow run query

#### `shouldUseDefaultWorkflow` 放宽

文件：`packages/views/issues/components/issue-detail.tsx:850-857`

- 去掉 `issue.status !== "backlog"` 条件（backlog issue 也显示默认工作流预览 + 可编辑）。
- 保留其余条件（issue 存在、assignee_type !== workflow、已分配、无 workflow_id/run_id）。

### 数据流

**node_run pending 改 worker**：
1. 用户在 `RuntimeNodeCard` 选新 worker → `useUpdateNodeRunAssignees`
2. `PUT /api/node-runs/{id}/assignees` `{worker_type:"member", worker_id:X}`
3. handler load 现有 node_run → 合并 → 校验 status（pending ✓）+ member → `UpdateWorkflowNodeRunAssignees` → publish `workflow:node_run_updated`
4. 前端 invalidate → 卡片刷新显示新 worker

## 边界与错误

- worker 已 `worker_assigned`/`working` → 改 worker 返回 409（status 已过 editable window）。
- critic 已 `critic_reviewing` → 改 critic 返回 409。
- member_id 非本 workspace 成员 → 400。

## 生效机制（为什么改完会生效，不只是改字段）

关键：本端点改的是 **`multica_workflow_node_run`（运行时表）的 `worker_id/critic_id`**，不是 `workflow_node`（定义表）。工作流引擎的 dispatch 读的是 node_run 运行时值，所以改完会真正生效：

1. **卡片立即刷新**：handler publish `workflow:node_run_updated` → 前端 WS → `RuntimeNodeCard` 立刻显示新执行者/审核者（用户改完立刻看到）。
2. **新执行者会被真正派发**：dispatch 链路（`workflow_dispatch.go` → `transitionHumanRolePhase`）读 `nodeRun.WorkerID`。节点 status 流转到 `worker_assigned` 时，dispatch 用的是**改后的新 worker** → 给新 worker 派发任务 + 触发 `workflow_executor_assigned` 通知（现有 listener 逻辑，无需新增）。
3. **新审核者同理**：status 流转到 `awaiting_critic`/`critic_reviewing` 时，dispatch 读新 critic_id → 派发 + `workflow_reviewer_assigned` 通知。

也就是说：在「节点未开始执行」窗口（pending/format_ok 等）改 worker/critic，**改的是运行时的 worker_id/critic_id，dispatch 读的就是这两个字段**，所以节点后续推进时，新执行者/审核者会被实际派活和通知——不是改了个没人读的字段。

**为什么这一刻不发 assigned 通知**：改 worker/critic 时 status 还是 pending（未到 `worker_assigned`/`awaiting_critic`），此刻新 worker 还没被派活，发 assigned 通知会误导（通知来了但没活干）。等 status 流转到派发那一刻，现有 listener 会发 `workflow_executor_assigned`/`workflow_reviewer_assigned`——这才是新 worker 真正该收到通知的时机。

**避免被 role resolution 覆盖**：`UpdateWorkflowNodeRunAssignees` 全量覆盖 worker_id/critic_id（直接指派人，覆盖 role 解析结果）。只要节点已过 role resolution 阶段（pending 之后不会再自动重解析），手动改的值不会被覆盖。若节点配置的是 role 且 status 还在解析窗口，role resolution 重试可能覆盖——这是既有的 role 解析语义，本次不改。

## 测试

### 后端
- `TestUpdateNodeRunAssignees_Pending_UpdatesWorker`
- `TestUpdateNodeRunAssignees_Working_RejectsWorkerChange`（409）
- `TestUpdateNodeRunAssignees_InvalidMember`（400）
- `TestUpdateNodeRunAssignees_PreservesUntouchedFields`（只传 worker，critic 保持）

### 前端
- `RuntimeNodeCard`：node_run pending 显示 AssigneePicker；working 隐藏（worker）
- `useUpdateNodeRunAssignees`：调正确端点 + invalidate

## 不在范围

- 定义层（Workflow 编辑器 `NodeConfigPanel`）节点编辑——已支持。
- role resolution 路径（`AssignWorkflowRoles`）——不改。
- 改 worker/critic 后发 assigned 通知——本次不发（status 未变）。

## 决策记录

- **选 Approach A（含后端端点）而非 B（仅前端放宽）**：B 不能改 node_run 已存在的 worker/critic，不满足"节点未开始执行可编辑"的核心诉求。A 激活死代码 `UpdateWorkflowNodeRunAssignees`，复用现有 SQL，改动可控。
- **status 约束对齐 `SetWorkflowNodeRunResolvedWorker/Critic`**：保证不破坏工作流状态机（worker 一旦 worker_assigned 就锁定，critic 同理），与现有角色解析路径一致。
- **不发 assigned 通知**：改 worker/critic 不改 node_run.status，而 assigned 通知靠 status 流转（`worker_assigned`/`awaiting_critic`）。直接编辑是"预指派"，等 status 流转时才正式通知，避免重复。

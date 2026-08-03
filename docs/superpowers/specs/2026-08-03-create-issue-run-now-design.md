# 创建任务「立即运行」修复与统一 — 设计

日期：2026-08-03
分支：feat/multi-platform-token-dispatch

## 背景与问题

创建任务弹窗（`packages/views/modals/create-issue.tsx`）里有一个「立即运行」按钮（`handleSubmitRun`），设计意图是：把任务直接创建为 `in_progress`，并在派发前让用户选运行时。但这条链路目前**没有接通**，点了等于没点。

证据链（均已直接读码确认）：

1. `handleSubmitRun` 把 payload 的 `status` 设为 `"in_progress"`（`create-issue.tsx:388`），但服务端 `CreateIssue` 用 `issueCreateStatusForAssignee` **按 assignee 重新算状态、丢弃请求里的 status**（`server/internal/handler/issue.go:1834`）——有处理人一律 `todo`。于是任务落在 `todo`，不是进行中。
2. 创建后调用 `AfterIssueAssigned`，它第一行 `if !IssueStatusStartsWork(issue.Status) { return nil }`（`server/internal/service/issue_assignment.go:133`）——`todo` 不算 starts work，**直接返回，不派发数智人、不启动工作流**。
3. 运行时弹窗选出的 `runtime_id` / `runtime_selection_policy` 虽然被解析并传进了 `AfterIssueAssigned`（`issue.go:2112` 的 `service.RuntimeSelection`），但因为第 2 步提前返回，**等于也被丢弃**。

结论：点「立即运行」= 任务停在 todo，啥也没跑；运行时弹窗是装饰。

附带问题：弹窗里还有一个 backlog 提示（`BacklogAgentHintContent`），本意是提醒「分给数智人的任务在待规划时不会自动跑」，但它读的是创建表单里**根本不生效**的 StatusPicker 状态（`create-issue.tsx:270` 的 `shouldShowBacklogHint`），所以一个实际落在 todo 的任务也可能被提示成「在 backlog」——既过时又有 bug。

## 目标

1. 「立即运行」对所有处理人类型可用，点击后任务**直接创建为 `in_progress`** 并立刻派发/启动。
2. 处理人是 **数智人 / 工作流 / 小队** 时，点「立即运行」弹出运行时选择弹窗（复用 `WorkflowRuntimeStrategyDialog`），三档策略全部生效：
   - 人工指定优先（`specified_runtime_first`）
   - 空闲运行时优先（`idle_first`）
   - 任务负责人运行时（`issue_creator_first`）
3. 处理人是 **member** 时，不弹窗，直接创建为 `in_progress`（走既有默认交付工作流逻辑，受 `DefaultWorkflowEnabled` 约束）。
4. 移除创建弹窗里无效的 StatusPicker。
5. 移除 backlog 提示弹窗（含组件、状态、localStorage dismissed key）。

## 现状关键事实

- `IssueStatus`：`backlog | todo | in_progress | in_review | done | blocked | cancelled`（`packages/core/types/issue.ts:3-10`）。`IssueStatusStartsWork` 仅认 `in_progress`（`issue_assignment.go:47`）。
- `IssueAssigneeType`：`member | agent | squad | workflow`（`packages/core/types/issue.ts:14`）。
- issue 表**没有** `runtime_id` / `runtime_selection_policy` 列（只有 `workflow_run_id`）。这两个字段是请求里带的、经 `validateWorkflowRuntimeSelectionOverride` 解析后**只在派发时用**（传给 `AfterIssueAssigned` 的 `RuntimeSelection`），不落库。**本次不需要加列或迁移。**
- `WorkflowRuntimeStrategyDialog`（`packages/views/workflows/components/workflow-runtime-strategy-dialog.tsx`）：三档策略单选 + 「人工指定」时下方出运行时下拉。已用于工作流的「立即运行」与详情页改处理人。
- `RuntimeSelectDialog`（`packages/views/agents/components/runtime-select-dialog.tsx`）：在线运行时单选 + 「自动」。当前用于 builtin 数智人。本次在 run-now 路径不再使用它（它在 assignee-picker 详情页别处仍用，保留）。
- 工作流的策略解析实现：`server/internal/service/workflow_runtime_selection.go`（`chooseWorkflowRuntime` 等），候选集 + 三档策略已实现，可提炼共享。
- `EnqueueTaskForIssue` 已有 `runtimeID` 参数；`EnqueueTaskForSquadLeader` **没有** runtime 参数，需补。

## 设计

### 后端（Go）

#### B1. `CreateIssue` 尊重显式 `status: in_progress`

文件：`server/internal/handler/issue.go`（约 1834 行）。

把 `status := issueCreateStatusForAssignee(assigneeType, assigneeID)` 换成新 helper：

```go
// resolveCreateStatus keeps the existing assignee-derived default for normal
// creates, and additionally honors an explicit in_progress (run-now) when an
// assignee is present. Any other requested status falls back to derived.
func resolveCreateStatus(reqStatus string, assigneeType pgtype.Text, assigneeID pgtype.UUID) (string, error) {
    hasAssignee := issueHasAssignee(assigneeType, assigneeID)
    if reqStatus == "in_progress" {
        if !hasAssignee {
            return "", errors.New("cannot start an issue without an assignee")
        }
        return "in_progress", nil
    }
    if hasAssignee {
        return "todo", nil
    }
    return "backlog", nil
}
```

- 普通创建（status 为空 / todo / backlog / 任何其它值）行为**完全不变**：有处理人 todo，无 backlog。
- 只有 `in_progress` 被新纳入，且必须有处理人（否则 400）。
- `req.Status` 在 Go `CreateIssueRequest` 里是非指针 `string`，判 `== "in_progress"` 即可，**无需改结构体**。
- 400 时走既有 `writeError(w, http.StatusBadRequest, ...)`。

`AfterIssueAssigned` 不用改判断逻辑：它已经按 `IssueStatusStartsWork(issue.Status)` 分流；现在 issue 创建即 `in_progress`，会自然进入派发分支。

#### B2. agent / squad 接入运行时策略解析

文件：`server/internal/service/issue_assignment.go`（`AfterIssueAssigned` 的 agent / squad 分支，约 140-166 行）；可能新增 `server/internal/service/runtime_selection.go`（或复用 `workflow_runtime_selection.go`）。

`AfterIssueAssigned` 已经收到 `runtimeSelection RuntimeSelection{Policy, RuntimeID}`（create 在 `issue.go:2112` 传入，update 在 `issue.go:2503` 传入）。当前：

- workflow 分支：`StartRunForIssueWithRuntimeSelection(... policy, runtimeID)` —— 全策略已生效。
- agent 分支：`EnqueueTaskForIssue(ctx, issue, pgtype.UUID{}, runtimeSelection.RuntimeID)` —— 只用 RuntimeID，忽略 Policy。
- squad 分支：`EnqueueTaskForSquadLeader(ctx, issue, squad.LeaderID, pgtype.UUID{})` —— runtime/policy 都忽略。

改为：

1. 从 `workflow_runtime_selection.go` 的 `chooseWorkflowRuntime` 提炼一个共享的 `resolveRuntimeByPolicy(ctx, q, workspaceID, candidates, policy, specifiedID, creatorUserID)`，返回具体 `runtimeID`：
   - `specified_runtime_first` → 用 specifiedID，校验其在线且可用，否则报错。
   - `idle_first` → 候选集中活跃任务最少的运行时。
   - `issue_creator_first` → 创建人绑定的运行时。
2. agent 分支：候选集 = 工作区内在线、可执行 agent 的运行时（provider ∈ `{csc, cs-cloud}`，复用现有候选查询）；解析出 runtimeID 后传给 `EnqueueTaskForIssue`。
3. squad 分支：用同样方式为 **小队 leader** 解析 runtimeID；给 `EnqueueTaskForSquadLeader` 增加一个 `runtimeID` 参数并传入。
4. 解析失败（如指定 runtime 离线、空闲优先但无候选）：抛 error，由调用方决定处理（见「边界与错误」）。

### 前端（TS）

#### F1. 移除 StatusPicker

文件：`packages/views/modals/create-issue.tsx`（约 540 行渲染、200-208 状态默认）。

删掉 StatusPicker 渲染与相关 `status` 状态。`handleSubmit` 维持按 assignee 推导（todo/backlog）。如果 `status` 状态仅服务于 picker 与 backlog 提示（F2 一并删除），则整体移除。

#### F2. 移除 backlog 提示

文件：`packages/views/modals/create-issue.tsx`（`shouldShowBacklogHint` 约 270、`BacklogAgentHintContent` 渲染约 397、`backlogHintIssueId` 状态）。

删除提示渲染、状态、`multica:backlog-agent-hint-dismissed` localStorage key。若 `BacklogAgentHintContent` 组件别处无人用，删其文件与 i18n；否则仅移除引用。

#### F3. 统一运行时弹窗（`useRuntimeStartDialogs`）

文件：`packages/views/issues/hooks/use-runtime-start-dialogs.tsx`。

`maybeSelectRuntimeThen` 改为：**workflow / agent / squad 三类都弹 `WorkflowRuntimeStrategyDialog`**：

- 去掉 agent 那套「0 在线跳过 / 1 在线自动选 / >1 才弹」的特殊分支，改为与 workflow 一致（直接 `setPending` 弹窗）。
- agent：`initialValue.policy` 取数智人默认（无则 `idle_first`），`runtimeId` 取其绑定 runtime（无则 null）。
- squad：`initialValue` 默认 `{ policy: "idle_first", runtimeId: null }`。
- member / 非 builtin agent：维持现状，直接 commit（member 走默认工作流；非 builtin agent 已有绑定 runtime）。
- `WorkflowRuntimeStrategyDialog` 的 `onConfirm` 已产出 `{ policy, runtimeId }`，合并进 payload 的 `runtime_selection_policy` / `runtime_id`。
- `RuntimeSelectDialog` 在本钩子不再被引用（保留组件本身，assignee-picker 详情页仍用）。

#### F4. `handleSubmitRun` 基本不动

`handleSubmitRun`（`create-issue.tsx:386`）仍 `buildCreatePayload("in_progress")` + `maybeSelectRuntimeThen`。payload 已含 `runtime_id` / `runtime_selection_policy` 字段（`CreateIssueRequest`，`packages/core/types/api.ts`），服务端已解析（`issue.go:1796` 的 `validateWorkflowRuntimeSelectionOverride`）。B1 生效后整条链路打通，无需改 handler 本身。

### 数据流（run-now，处理人为数智人）

1. 填表 → 选 agent → 点「立即运行」。
2. `buildCreatePayload("in_progress")` → `maybeSelectRuntimeThen("agent", id, payload, commit)`。
3. 弹 `WorkflowRuntimeStrategyDialog` → 用户选策略（+ 指定 runtime）→ `commit({ ...payload, status:"in_progress", runtime_id, runtime_selection_policy })`。
4. `performCreate` → `POST /api/issues`。
5. 服务端 `resolveCreateStatus` → `in_progress`（有处理人）→ 创建 issue。
6. `AfterIssueAssigned`：`IssueStatusStartsWork(in_progress)` 为真 → agent 分支 → 按策略解析 runtime → `EnqueueTaskForIssue` → 数智人开跑。

## 边界与错误

- 创建 `in_progress` 但无处理人 → 400「cannot start an issue without an assignee」。
- 策略解析失败（指定 runtime 离线 / 空闲优先无候选）：issue 已在事务内创建为 `in_progress`，`AfterIssueAssigned` 的 error 目前在 `issue.go:2114` 仅 `slog.Warn` 不回传。**增强项**：run-now 下把派发失败回传给前端，弹警告 toast（任务仍在进行中，但没跑起来）。是否纳入本次由实现计划决定；不纳入则维持现状（仅日志）。
- member run-now → `in_progress`；是否自动起默认交付工作流取决于 `DefaultWorkflowEnabled`（既有行为，不在本次范围）。
- 单一在线 runtime 时仍弹弹窗（与 workflow 一致）；用户可选非「人工指定」策略。

## 测试

### Go（`server/`）

- `CreateIssue` 尊重显式 `in_progress`（有/无处理人两种：有→in_progress；无→400）。
- 普通创建（不带 status / 带 todo / backlog）状态不变量不变。
- agent / squad 三档策略解析：分别断言解析到的 runtimeID 正确；`EnqueueTaskForSquadLeader` 收到 runtime 参数。
- workflow 路径回归（不受影响）。

### TS（`packages/views/`）

- `useRuntimeStartDialogs`：workflow/agent/squad 三类都弹 `WorkflowRuntimeStrategyDialog`；member/非 builtin agent 直接 commit。
- 创建弹窗：StatusPicker 已移除；backlog 提示不再出现。
- `handleSubmitRun` 产出 payload 带 `status:"in_progress"` + runtime 字段。

## 不在范围

- 详情页 assignee-picker 的运行时弹窗统一（可后续对齐，当前 agent 用 `RuntimeSelectDialog`、workflow 用 `WorkflowRuntimeStrategyDialog`）。
- 默认交付工作流的启停逻辑。
- issue 表新增 runtime 列（确认不需要）。

## 决策记录

- **核心机制选「服务端尊重 create-time status（方案 A）」而非客户端两步（方案 B）**：一次请求、原子，与客户端既有 `buildCreatePayload("in_progress")` 意图一致，无 todo→in_progress 瞬时跳变与额外 WS 事件。代价是动了「创建状态由 assignee 决定」这条不变量，但改动面极小（仅新增 in_progress 一条路 + 守卫），普通创建零影响。
- **agent/squad 三档策略全生效**：用户明确要求复用工作流那个弹窗（即 `WorkflowRuntimeStrategyDialog`，含三档策略）；若只让「人工指定」生效而另两档失灵，UX 会误导。三档语义对 agent/squad 同样成立（指定机器 / 找空闲 / 用创建人机器），故接入既有策略解析，保持 UX 一致。

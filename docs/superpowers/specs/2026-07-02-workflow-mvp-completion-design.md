# Workflow MVP 补齐设计

**日期**: 2026-07-02
**状态**: 待评审
**关联 PRD**: `docs/workflow-prd.md`

## 背景

`docs/workflow-prd.md` 描述了 Multica Workflow 的完整产品设计。经代码库分析，当前仓库已经具备 Workflow 的主要基础设施：DB 表、Go 后端 CRUD 与状态机、DAG 环检测、模板克隆、运行时绑定、TypeScript 类型/Zod Schema/API Client、React Query hooks、ReactFlow 编辑器、Stage 全景图、Issue 详情页运行时全景图、节点操作（审核/接手/交还/finalize/跳过）和 E2E 覆盖。

本设计补齐 PRD 中尚未实现、但对 MVP 验收（"先悦己再悦人"两关）必需的功能，并新增运行时快照机制，解决"编辑活跃 Workflow 破坏运行中 Run"的数据竞争。

## 范围

### 纳入 MVP（7 个功能模块 + 1 个横切基础设施）

| # | 模块 | 类型 | 归属切片 |
|---|------|------|---------|
| 1 | 运行时快照 | 横切基础设施 | 切片一 |
| 2 | 静态预检查 | 功能模块 | 切片一 |
| 3 | 发布并测试 | 功能模块 | 切片一 |
| 4 | 模板中心 | 功能模块 | 切片一 |
| 5 | AI 辅助创建（含 `workflow-architect` builtin agent） | 功能模块 | 切片一 |
| 6 | 全局提示栏 | 功能模块 | 切片二 |
| 7 | 节点详情面板三 Tab | 功能模块 | 切片二 |

### 降为后续规划

- 端口拖出创建节点（Coze 交互）：面板拖入 + API 创建已满足核心需求。
- 变量可视化选择、工作区自定义模板、节点级重试策略、定时/Webhook 触发、版本快照（带版本号/diff/回滚）、并行节点分支、条件分支、运行统计仪表盘：沿用 PRD「后续规划」。

### 切片间依赖

切片一是切片二的基础设施：快照（§1）是 Run 触发时生成不可变副本的前提；发布并测试（§3）和 AI 辅助创建（§5）最终都会通过 assign Workflow 触发 Run，从而依赖快照；静态预检查（§2）是发布（`UpdateWorkflow(status="active")`）和发布并测试（§3）的统一后端校验。

依赖顺序：**快照 → 静态预检查 → 发布并测试 / AI 辅助创建 / 模板中心**。模板中心可与快照并行，但使用模板后的发布仍依赖静态预检查。

## 切片一：搭建者闭环

### §1 运行时快照

**目标**：发布后的 Workflow 可被搭建者继续编辑，但已有 Run 不受影响。每个 Run 持有一份不可变的定义副本，执行路径只读这份副本。

#### 数据模型

`multica_workflow_run` 新增列：

```sql
workflow_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
```

`multica_workflow_node_run` 新增列：

```sql
runtime_config_override jsonb
taken_over_by uuid
```

`runtime_config_override` 用于"仅本次生效"的临时配置覆盖。`taken_over_by` 记录接手 blocked 节点的用户 ID，供全局提示栏识别"当前用户接手的 blocked 节点"。

快照结构：

```typescript
interface WorkflowSnapshot {
  snapshot_version: 1;
  workflow_id: string;
  title: string;
  description: string;
  max_retries: number;
  nodes: Array<{
    id: string;
    title: string;
    description: string;
    position_x: number;
    position_y: number;
    format_schema: unknown;
    worker_type: WorkerType;
    worker_id: string | null;
    critic_type: CriticType;
    critic_id: string | null;
    critic_api_url: string | null;
    sort_order: number;
    stage_id: string | null;
  }>;
  edges: Array<{
    id: string;
    source_node_id: string;
    target_node_id: string;
    condition: unknown;
  }>;
  stages: Array<{
    id: string;
    name: string;
    description: string;
    sort_order: number;
  }>;
}
```

#### 写入时机

唯一写入点是 `WorkflowService.StartRun`。Run 创建事务内按同一数据库快照读取 workflow 元信息、nodes、edges、stages，序列化为 `workflow_snapshot`，并写入 `CreateWorkflowRun`。

不在发布时预生成快照。发布是定义层事件，Run 触发才是执行层事件。搭建者发布后继续编辑 active Workflow 时，仅影响未来 Run。

#### 执行路径改造

仅新增字段不够。当前代码中多处会回查 live 定义表，必须改为从 `workflow_snapshot` 派生执行视图：

| 当前路径 | 现状 | 改造 |
|---|---|---|
| `StartRun` root 识别 | `ListWorkflowEdges(workflow.ID)` | 使用 snapshot edges |
| `DispatchRootNodeRuns` | 读 node_runs，但后续 dispatch 查 live node | dispatch 前通过 snapshot node 补齐配置 |
| `OnNodeRunCompleted` | `ListWorkflowEdgesBySource/Target` 查 live edges | 使用 snapshot edges 计算下游和上游完成条件 |
| `dispatchWorker` / `dispatchCritic` | `GetWorkflowNode(nodeRun.WorkflowNodeID)` | 使用 snapshot node + `runtime_config_override` 合并结果 |
| `DispatchAgentTask` | `GetWorkflowNode` + `GetWorkflow` | 使用 snapshot node/workflow title；只在解析 agent/squad/runtime 时查 live actor |
| `executeFormatChecker` | `GetWorkflowNode` 读取 `format_schema` | 使用 snapshot node 的 `format_schema` |
| `ListCompletedUpstreamNodeRuns` / daemon upstream context | join live node/stage | 基于 snapshot stage/node 排序，或新增 service helper 返回上游上下文 |
| `ExecutionPanoramaPage` | 查询 live nodes/edges/stages | 优先使用 run snapshot 渲染；没有 runId 时才读 live 定义 |

实现上在 `WorkflowService` 内新增 helper：

```go
type RuntimeWorkflowDefinition struct {
  WorkflowID string
  Title string
  MaxRetries int32
  NodesByID map[string]RuntimeNode
  Edges []RuntimeEdge
  Stages []RuntimeStage
}

func runtimeDefinitionForRun(ctx context.Context, q *db.Queries, run db.MulticaWorkflowRun) (RuntimeWorkflowDefinition, error)
func runtimeNodeForRun(ctx context.Context, q *db.Queries, nodeRun db.MulticaWorkflowNodeRun) (RuntimeNode, error)
```

`runtimeDefinitionForRun` 解析 `run.workflow_snapshot`。若解析失败或旧数据为 `{}`，只允许 fallback 到 live 序列化并记录 warning，用于兼容历史 Run；新 Run 必须写入非空 snapshot。

#### NodeRun 冗余字段

`multica_workflow_node_run` 继续保留 `worker_type/worker_id/critic_type/critic_id/node_title`。这些字段是 Run 创建时的常用索引和列表展示冗余，不再作为执行真相。执行真相是：

1. snapshot node；
2. merge `runtime_config_override`；
3. 必要时用 nodeRun 冗余字段作为旧数据兼容 fallback。

#### 失败恢复的两种配置生效范围

- **仅本次生效**：新增 endpoint `PATCH /api/node-runs/{nodeRunId}/runtime-config`，写入 `runtime_config_override`。重新执行当前 node run 时，后端将 override merge 到 snapshot node 上。不影响 Workflow 定义，不影响未来 Run。
- **更新 Workflow 配置**：调用现有 `UpdateWorkflowNode`，修改 live 定义。仅影响未来 Run，当前 Run 不受影响。

merge 规则为 shallow merge：`worker_type/worker_id/critic_type/critic_id/critic_api_url/format_schema` 等顶层配置字段以 override 为准；不允许 override `id`、`workflow_id`、`stage_id`。

#### API 兼容性

按 CLAUDE.md 的 API Response Compatibility 规则：

- `WorkflowRun` response 新增 `workflow_snapshot?: WorkflowSnapshot | null`，Zod schema `.loose()` 并提供 `null` fallback。
- `WorkflowNodeRun` response 新增 `runtime_config_override?: unknown | null`、`taken_over_by?: string | null`。
- 旧 desktop 客户端忽略新字段；新客户端必须 optional-chain。

#### 测试

- 后端：`StartRun` 后，Run 的 snapshot 与触发时定义一致。
- 后端：触发 Run 后修改 nodes/edges/stages，后续调度仍使用旧 snapshot。
- 后端：删除 live edge 后，运行中 Run 的下游推进仍按 snapshot edge 生效。
- 后端：`runtime_config_override` merge 后重新执行当前 node run。
- 前端：Issue 全景图在 live 定义被修改后仍按 run snapshot 渲染。

---

### §2 静态预检查

**目标**：发布时校验 Workflow 结构完整性，问题在画布上可视化标注，并确保所有发布入口共享同一后端校验。

#### 检查项

| # | 检查项 | 错误提示 | 画布标注 |
|---|--------|---------|---------|
| 1 | DAG 存在环路 | "检测到循环依赖：A → B → A" | 环路连线红色高亮 |
| 2 | agent/squad worker 未配置 ID | "节点「X」缺少执行者" | 节点橙色高亮 + 图标 |
| 3 | agent/squad critic 未配置 ID | "节点「X」缺少审核者" | 节点橙色高亮 + 图标 |
| 4 | API critic 缺少 URL | "节点「X」缺少审核 API URL" | 节点橙色高亮 + 图标 |
| 5 | 当前用户无发布权限 | "你无权发布 workflow" | 按钮灰显 |
| 6 | 存在孤立节点 | "节点「X」未连接到流程" | 节点灰色虚线边框 |

human worker/critic 允许 `worker_id`/`critic_id=null`，表示任意成员可领取；因此不能按空 ID 统一判定缺失。

#### 后端契约

新增 service helper：

```go
type WorkflowValidationError struct {
  Code string
  Message string
  NodeIDs []string
  EdgeIDs []string
}

func (s *WorkflowService) ValidateForPublish(ctx context.Context, workflowID pgtype.UUID, actorUserID pgtype.UUID) ([]WorkflowValidationError, error)
```

`ValidateForPublish` 是唯一发布校验实现，供以下入口复用：

1. `POST /api/workflows/{id}/validate`
2. `UpdateWorkflow(status="active")`
3. `POST /api/workflows/{id}/publish-and-test`
4. `StartWorkflowRun` 的防御性校验（至少保留 DAG 检查，避免旧客户端绕过）

API response：

```typescript
interface ValidationResult {
  valid: boolean;
  errors: Array<{
    code:
      | "cycle"
      | "missing_worker"
      | "missing_critic"
      | "missing_critic_api_url"
      | "isolated_node"
      | "forbidden";
    message: string;
    node_ids?: string[];
    edge_ids?: string[];
  }>;
}
```

#### 前端画布标注

预检查失败状态保存在 `useWorkflowEditorStore.validationErrors`。发布失败时：

- 环路连线：自定义 edge type 根据 `edge_ids` 渲染 error 状态。
- 缺配置节点：节点卡片右上角警告图标 + 边框。
- 孤立节点：灰色虚线边框。
- 底部提示栏：固定在画布底部，列出所有错误；点击错误项居中到对应节点。

发布成功或用户编辑相关节点/边后清空已修复的 validation error。

#### 测试

- 后端：validate endpoint 对所有错误返回稳定 `code` 和 `node_ids`/`edge_ids`。
- 后端：`UpdateWorkflow(status="active")` 复用同一 validator，旧客户端无法绕过。
- 前端：预检查失败时画布高亮对应节点/连线，底部提示栏列出问题。

---

### §3 发布并测试

**目标**：搭建者一键从编辑器跳转到真实 Issue，观察 Workflow 执行。

#### 语义边界

`publish-and-test` 不是“所有副作用都在同一个事务内”的绝对原子操作。它采用明确的两阶段边界：

1. **事务内**：validate → 发布 workflow → 创建测试 Issue → assign workflow → 创建 workflow_run → 创建 node_runs → 创建 workflow sub-issues → 写 parent issue 的 `workflow_id/workflow_run_id`。
2. **事务外**：dispatch root node runs，创建 agent tasks，唤醒 daemon。

这样保证数据库可见状态一致；事务外 dispatch 失败时，Run/NodeRuns/SubIssues 已存在，可重试 dispatch，不会出现 active workflow 但没有 Issue 或 Issue 没有 run 的半成品。

#### 后端 endpoint

新增：

```http
POST /api/workflows/{id}/publish-and-test
```

返回：

```typescript
interface PublishAndTestResponse {
  issue_id: string;
  run_id: string;
  dispatch_started: boolean;
  dispatch_error?: string;
}
```

请求执行步骤：

1. `ValidateForPublish`。
2. `UpdateWorkflow(status="active")`。
3. `CreateIssue`，标题 `"[Workflow Test] {workflow.title}"`，`origin_type="workflow_test"`，`origin_id=workflow.id`。
4. 调用事务化 helper `StartRunForIssueTx` 创建 run/node_runs/sub-issues 并更新 parent issue。
5. 事务提交后调用 `DispatchRootNodeRuns(run.ID)`。

#### 异常处理

| 失败点 | 行为 |
|--------|------|
| validate 失败 | 返回 400 + `ValidationResult`，不发布、不创建 Issue |
| 事务内任一步失败 | 整体回滚，返回错误，workflow 不变 active |
| 事务提交成功但 dispatch 失败 | 返回 200，`dispatch_started=false`，前端跳转 Issue 并显示可重试提示 |

#### 测试 Issue 清理

测试 Issue 使用 `origin_type="workflow_test"`、`origin_id=workflow.id` 标记。清理能力不纳入本切片的主流程，避免新增 destructive API 扩大范围；运行记录页后续可新增：

```http
DELETE /api/workflows/{id}/test-issues
```

当前 MVP 只要求测试 Issue 可识别。

#### 测试

- 后端：成功返回 `issue_id/run_id`，Issue 标记 `workflow_test`，parent issue 写入 `workflow_run_id`。
- 后端：事务内创建 Issue 或 run 失败时 workflow 不变为 active。
- 后端：模拟 dispatch 失败时仍返回可跳转的 `issue_id/run_id` 和 `dispatch_started=false`。
- E2E：编辑器点击「发布并测试」→ 跳转到 Issue 全景图，节点开始执行或显示 dispatch 可恢复提示。

---

### §4 模板中心

**目标**：非技术用户通过预置模板一键创建 Workflow，少量调整后发布。

#### 模型选择

沿用现有**全局模板**模型，不引入工作区懒播种副本。原因：

- 当前 `ListTemplates` 已全局列出 `is_template=true` 的模板。
- `loadWorkflowInWorkspace` 已允许跨工作区访问 template。
- `CloneWorkflowFromTemplate` 已支持从全局模板克隆到当前工作区。
- 当前模板发布规则要求模板内 agent/squad 必须引用 builtin agent，跨工作区可解析。

因此本设计只新增预置模板 seed，不改变模板作用域。

#### 数据模型

`multica_workflow` 新增：

```sql
template_key text
```

约束：

```sql
CREATE UNIQUE INDEX idx_workflow_builtin_template_key
ON multica_workflow(template_key)
WHERE is_template = TRUE AND template_key IS NOT NULL;
```

`template_key` 仅用于 builtin 模板去重。用户手动设为模板的 workflow 保持 `template_key=null`。

`multica_agent` 新增：

```sql
key text
```

约束：

```sql
CREATE UNIQUE INDEX idx_agent_builtin_key
ON multica_agent(key)
WHERE is_builtin = TRUE AND key IS NOT NULL;
```

`AgentResponse`、`Agent` TS 类型和 Zod schema 新增 optional `key?: string | null`，用于模板/AI proposal 的语义化引用。

#### 5 个预置模板

Go 代码内嵌 JSON 常量位于 `server/internal/service/workflow_templates.go`。启动/迁移后由 seed helper 插入全局模板：

1. Bug 修复流程（分析 → 修复 → 审核 → 验证）
2. 需求评审流程（提出 → 方案 → 评审 → 排期）
3. 内容发布审核（撰写 → 审核 → 发布 → 监控）
4. 客户支持工单（分类 → 处理 → 确认 → 关闭）
5. 代码 PR 审核（自动检查 → 人工审核 → 合并 → 部署）

模板内 Worker/Critic 只允许引用 builtin agent key。seed 时后端按 key 解析为固定 UUID，写入 workflow node。

#### 模板中心 UI

`workflows-page.tsx` 列表页新增「从模板创建」按钮，打开 Dialog：

- 展示 `workflowTemplateListOptions(wsId)` 返回的全局模板。
- 预览模板节点结构 + Stage 分组，只读 mini DAG，复用 `stage-node-dag.tsx` / overview 组件。
- 点击「使用」调用 `createWorkflowFromTemplate(templateId, title, description)`，进入编辑器，标题默认为 `"{模板名} (副本)"`。

#### Agent 缺失处理

对于 builtin 模板，正常情况下不会缺失 agent。缺失检测仍保留，用于数据损坏或历史模板：

- 前端检查 node 的 `worker_id/critic_id` 是否能在 `agentListOptions(wsId)` 中找到。
- 缺失时节点卡片标注「Agent 缺失」。
- 发布时由 §2 的预检查阻断。

#### 测试

- 后端：seed 后存在 5 个 `is_template=true` 且 `template_key` 唯一的模板。
- 后端：重复 seed 不重复插入。
- 后端：模板 clone 后 stage/node/edge 完整复制，builtin agent 引用有效。
- 前端：模板中心 Dialog 展示 5 个模板，预览展开结构，使用后进入编辑器。
- E2E：非技术用户从模板创建 → 调整人选 → 发布。

---

### §5 AI 辅助创建

**目标**：搭建者用自然语言描述流程，AI 生成 Workflow 草稿，人审核编辑后发布。

#### 后端任务契约

现有 quick-create task 以"创建 Issue"为目标，不适合直接复用。新增 workflow proposal 专用 endpoint：

```http
POST /api/workflows/{id}/proposal-tasks
GET /api/workflows/{id}/proposal-tasks/{taskId}
```

创建请求：

```typescript
interface CreateWorkflowProposalTaskRequest {
  description: string;
}
```

创建响应：

```typescript
interface CreateWorkflowProposalTaskResponse {
  task_id: string;
}
```

查询响应：

```typescript
interface WorkflowProposalTaskResponse {
  task_id: string;
  status: "queued" | "dispatched" | "running" | "completed" | "failed" | "cancelled";
  proposal: WorkflowProposal | null;
  error: string | null;
}
```

任务存入 `multica_agent_task_queue`，`context.type="workflow_proposal"`，不绑定 issue/chat/autopilot/workflow_node_run。为了让 workspace 级事件和权限可解析，context 必须包含：

```json
{
  "type": "workflow_proposal",
  "workflow_id": "...",
  "workspace_id": "...",
  "requester_id": "...",
  "description": "...",
  "available_agents": [...]
}
```

TaskService 的 workspace 解析需支持 `context.type="workflow_proposal"`，否则 daemon wakeup / WS broadcast 无法稳定归属 workspace。

#### Proposal 输出契约

```typescript
interface WorkflowProposal {
  summary: string;
  nodes: Array<{
    key: string;
    title: string;
    description: string;
    worker_type: "human" | "agent" | "squad";
    worker_agent_key?: string;
    critic_type: "human" | "agent" | "squad" | "api";
    critic_agent_key?: string;
    stage: string;
  }>;
  edges: Array<{ from: string; to: string }>;
  stages: string[];
}
```

后端在 `GET /api/workflows/{id}/proposal-tasks/{taskId}` 中解析 task result，使用与前端 Zod schema 等价的 Go 校验（结构、重复 node key、edge 引用存在、无环）。解析失败返回 `status="failed"` 与 `error`，不把坏 JSON 交给 UI。

#### `workflow-architect` builtin agent

新增 `is_builtin=true` agent，`key="workflow-architect"`。同一 migration 同时回填现有 migration 124 的 7 个 builtin agent key。

`workflow-architect` 的 instructions 必须要求只输出符合 `WorkflowProposal` schema 的 JSON，不输出 Markdown 包裹文本。

#### 前端流程

编辑器顶部新增 AI 输入栏：

1. 空画布时显眼展示；已有节点时折叠为按钮。
2. 提交描述后调用 `POST /api/workflows/{id}/proposal-tasks`。
3. 轮询 `GET /api/workflows/{id}/proposal-tasks/{taskId}`，直到 completed/failed。
4. completed 后展示 Proposal Dialog：节点摘要、Stage、连线。
5. 用户确认后按拓扑顺序调用现有 `createNode/createEdge`，流式渲染到画布。
6. 用户取消时不创建任何节点。

#### agent key 解析

前端从 `agentListOptions(wsId)` 获取 builtin agents，按 `agent.key` 建立映射。解析失败时：

- `worker_type="agent"` 且找不到 `worker_agent_key` → 创建 node 时 `worker_id=null`；
- `critic_type="agent"` 且找不到 `critic_agent_key` → `critic_id=null`；
- 发布时由 §2 预检查阻断。

#### 异常处理

| 失败点 | 行为 |
|--------|------|
| Task 创建失败 | Toast 报错，输入栏恢复可输入 |
| Task 超时/失败 | 提示"AI 生成失败，可手动搭建或重试" |
| Proposal 解析失败 | 展示后端 error，允许重试 |
| 流式创建中某个 createNode 失败 | 停止后续创建，已创建节点保留，提示用户可手动修复或撤销 |
| createEdge 失败 | 节点保留，失败连线提示，发布预检查会发现孤立/断连 |

#### 测试

- 后端：`workflow-architect` seed 存在且 `is_builtin=true/key=workflow-architect`。
- 后端：proposal task result 解析 malformed JSON 时返回 failed，不崩 UI。
- 前端：AI 输入栏在空画布展示，生成中显示加载态。
- 前端：Proposal 取消不产生节点。
- 前端：Proposal 确认后创建节点和连线，agent key 正确解析为 UUID。
- E2E：用户输入"Bug 修复流程"→ AI 生成 → 确认 → 微调 → 发布。

---

## 切片二：使用者体验

### §6 全局提示栏

**目标**：使用者在 Issue 全景图一眼知道"我需要做什么"，并快速定位。

#### 位置与触发

固定在 Issue 全景图（`ExecutionPanoramaPage`）顶部，画布区域之上。常驻显示；有待操作节点时高亮，否则收起为细提示栏。

#### 待操作节点识别

当前仓库中 human worker/critic 的 ID 使用用户 ID（`multica_user.id`），不是 `multica_member.id`。前端匹配时必须使用 `useAuthStore().user.id` 与 nodeRun 的 `worker_id/critic_id` 比较。

优先级：

| 优先级 | 状态 | 触发条件 |
|--------|------|---------|
| P0 | `awaiting_critic` / `critic_reviewing` | `critic_type="human"` 且 (`critic_id=null` 或 `critic_id=currentUser.id`) |
| P1 | `worker_assigned` / `awaiting_input` | `worker_type="human"` 且 (`worker_id=null` 或 `worker_id=currentUser.id`) |
| P2 | `failed` / `format_failed` | 任意失败节点，所有成员可见 |
| P3 | `blocked` | `taken_over_by=currentUser.id` |

`blocked` 若没有 `taken_over_by`，只作为 P2 类似的可见异常展示，不标记为"我需要操作"。

#### 定位实现

复用 `ExecutionPanoramaPage` 的 `nodeElementMap`。点击「定位」后：

1. 按 P0→P3 找到第一个匹配 nodeRun。
2. `scrollIntoView({ behavior: "smooth", block: "center" })`。
3. 给对应节点卡片临时加 `ring-2 ring-orange-400 animate-pulse`，2 秒后移除。

#### 数据来源

无需新 API。依赖：

- `workflowNodeRunsOptions`
- `useAuthStore`
- `WorkflowNodeRun.taken_over_by`

不需要额外查 members/agents 来判断当前用户是否匹配；成员/agent 查询仅用于显示名称。

#### 测试

- 前端：当前用户是 human critic 时 P0 高亮。
- 前端：`critic_id=null` 时任意成员可审核。
- 前端：当前用户是 `taken_over_by` 时 blocked 归入 P3。
- 前端：点击「定位」滚动到正确节点并高亮。

---

### §7 节点详情面板三 Tab

**目标**：节点详情按信息类型分 Tab，避免长内容滚动；新增配置 Tab 让审核者看到 Run 实际使用的配置。

#### 数据来源

Issue 全景图必须基于 run snapshot 渲染：

- 节点、边、Stage 来自 `WorkflowRun.workflow_snapshot`。
- NodeRun 状态来自 `workflowNodeRunsOptions`。
- 配置 Tab 展示 snapshot node merge `runtime_config_override` 后的 effective config。

如果 `workflow_snapshot=null` 或 `{}`，前端可 fallback 到 live nodes/edges/stages，但必须显示轻量提示："此运行缺少快照，正在显示当前 workflow 定义"。该 fallback 仅用于历史 Run。

#### 三个 Tab

- **概览**：Worker 名称 + 产出预览、Critic 名称 + 审核意见、状态路径（Format → Worker → Critic）、时间线、重试次数 / 最大重试次数。
- **产物**：迁移现有 `ArtifactList`，展示 Worker/Critic 输出、关联子 Issue 链接、Agent Task 执行日志入口。
- **配置**：仅 `can_manage_workflows` 用户可见，展示只读 effective config，包括 Worker/Critic、`format_schema`、`critic_api_url`。若存在 `runtime_config_override`，显示"当前 Run 已应用临时配置覆盖"。

#### 临时配置覆盖入口

为了满足 PRD 验收"不离开全景图配置重试并恢复"，配置 Tab 需要一个受控编辑入口：

- 默认展示只读配置。
- failed/blocked/format_failed 节点上，对 `can_manage_workflows` 用户显示「仅本次调整并重试」。
- 点击后打开轻量 Dialog，只允许修改 worker/critic/format_schema 等 runtime-safe 字段。
- 保存调用 `PATCH /api/node-runs/{nodeRunId}/runtime-config`。
- 保存成功后调用现有重试/handback/finalize 前的恢复动作，重新执行当前 node run。

「编辑 workflow 定义」仍保留，跳转到 Workflow 编辑器并定位到该节点，只影响未来 Run。

#### Tab 状态

Tab 选择保存在组件本地 `useState`，默认「概览」。选中节点切换时保持当前 Tab。

#### 测试

- 前端：三 Tab 切换正确，内容独立滚动。
- 前端：配置 Tab 仅对 `can_manage_workflows` 用户可见。
- 前端：配置 Tab 显示 snapshot 配置而非 live 定义。
- 前端：存在 `runtime_config_override` 时显示覆盖标注。
- 前端：「仅本次调整并重试」写入 override 并触发重试。
- 前端：「编辑 workflow 定义」跳转到 Workflow 编辑器。

---

## 数据库迁移汇总

| 迁移 | 内容 |
|------|------|
| `129_workflow_run_snapshot` | `multica_workflow_run.workflow_snapshot jsonb NOT NULL DEFAULT '{}'` |
| `130_workflow_node_run_runtime_config` | `multica_workflow_node_run.runtime_config_override jsonb`, `taken_over_by uuid` |
| `131_workflow_template_key` | `multica_workflow.template_key text` + builtin template unique index |
| `132_builtin_agent_key_and_architect` | `multica_agent.key text` + builtin key unique index + 回填 migration 124 的 7 个 builtin agent key + seed `workflow-architect` |
| `133_seed_builtin_workflow_templates` | seed 5 个 `is_template=true/template_key!=null` 的全局 workflow templates |

每个迁移提供 `.up.sql` + `.down.sql`。涉及 sqlc 查询参数/返回字段的迁移必须同步运行 `make sqlc`。

## API 新增汇总

| Method | Path | 用途 |
|--------|------|------|
| POST | `/api/workflows/{id}/validate` | 静态预检查 |
| POST | `/api/workflows/{id}/publish-and-test` | 发布并测试 |
| POST | `/api/workflows/{id}/proposal-tasks` | 创建 AI workflow proposal task |
| GET | `/api/workflows/{id}/proposal-tasks/{taskId}` | 查询 AI proposal task 状态和结果 |
| PATCH | `/api/node-runs/{nodeRunId}/runtime-config` | 写入当前 Run 的节点临时配置覆盖 |

现有 API 扩展：

- `GET /api/workflows/{id}/runs/{runId}` 返回 `workflow_snapshot`。
- `GET /api/workflows/{id}/runs/{runId}/node-runs` 返回 `runtime_config_override`、`taken_over_by`。
- `GET /api/agents` 返回 builtin `key`。

## i18n

按 `apps/docs/content/docs/developers/conventions.mdx`：

- 新增 `packages/views/locales/{en,zh-Hans}/workflows.json` 的 AI 辅助创建、模板中心、预检查、发布并测试相关 key。
- 新增 `packages/views/locales/{en,zh-Hans}/issues.json` 的全局提示栏、详情面板三 Tab、临时配置覆盖相关 key。
- UI 字符串中的实体词使用 mixed rule：`workflow`、`node`、`stage`、`run` 保持小写英文；长文档可中文解释。

## 验收对照

### 第一关（悦己）

1. **10 分钟创建 5 节点 Workflow**：§5 AI 辅助创建从一句话到草稿，§4 模板中心从模板起步。
2. **3 秒判断执行到哪了**：§6 全局提示栏 + 已有全景图节点卡片状态。
3. **不离开全景图配置重试并恢复**：§1 runtime snapshot + `runtime_config_override`，§7 配置 Tab 的「仅本次调整并重试」。
4. **Critic 在全景图直接审核**：已有节点卡片内嵌「通过/打回」按钮 + §6 定位。

### 第二关（悦人）

非技术用户 3 分钟通过模板创建并发布：§4 模板中心 + 5 个预置模板，只需调整节点名称、负责人、审核人。

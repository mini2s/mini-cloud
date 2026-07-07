# Workflow Editor Gateway Node Design

## 背景

Workflow 编辑模式和运行模式共享同一套画布基础设施：

- Workflow 编辑器：单视图 DAG 画布 + Stage 泳道，用于搭建 Workflow 定义。
- Issue 全景图：复用编辑器画布基础设施，叠加运行时状态，作为 Issue 详情页内的只读执行视图。

本设计扩展四类能力：

- 连线删除产品化：在画布上提供可发现的悬浮删除按钮。
- 显式并发语义：新增 Fork / Join 网关节点，而不是只依赖隐式多出边 / 多入边。
- 节点类型样式多样化：采用语义形状 + 统一信息区，category 优先，shape 可覆盖。
- 详情面板统一化：编辑器和 Issue 全景图共享同一套详情面板骨架，按 `mode` 分流内容，减少 tab 依赖，采用固定分区栈布局。

## 目标

- 让用户显式表达并行分发与汇聚等待。
- 让编辑视图和 Issue 执行全景图使用同一套节点视觉语言。
- 让编辑器和 Issue 全景图共享同一套详情面板骨架，内容按 `mode` 分流——编辑模式维护定义，运行模式查看执行状态和操作入口。
- 节点只展示核心信息，配置完整性由 Preflight 或详情面板字段级校验提示。
- 不新增数据库表，尽量复用现有 `workflow_node.format_schema` 和 DAG 调度。
- 第一批不实现条件分支、失败分支、any-of join、用户自定义样式面板。

## 总体架构

采用语义网关节点方案。

Fork / Join 仍然是 `workflow_node`，通过 `format_schema` 标记：

```json
{
  "type": "gateway",
  "gateway_kind": "fork",
  "shape": "diamond",
  "template_id": "fork-gateway",
  "template_category": "logic"
}
```

运行时仍为每个 node 创建 `workflow_node_run`。普通节点继续走 Worker / Critic 流程；gateway 节点被激活后自动完成，不执行 format checker，不派发 worker，不进入 critic。

下游激活复用现有 DAG 规则：目标节点的所有上游都进入终态后，目标节点才会启动。

## 数据模型

不新增迁移。

普通节点示例：

```json
{
  "shape": "rectangle",
  "template_id": "ai-agent-task",
  "template_category": "ai"
}
```

Fork gateway：

```json
{
  "type": "gateway",
  "gateway_kind": "fork",
  "shape": "diamond",
  "template_id": "fork-gateway",
  "template_category": "logic"
}
```

Join gateway：

```json
{
  "type": "gateway",
  "gateway_kind": "join",
  "shape": "diamond",
  "template_id": "join-gateway",
  "template_category": "logic"
}
```

Annotation 保持现有结构：

```json
{
  "type": "annotation",
  "template_id": "sticky-note",
  "template_category": "annotation"
}
```

在 `packages/core/types/workflow.ts` 增加解析函数，而不是让 UI 直接信任 API JSON：

- `WorkflowNodeFormatKind = "task" | "gateway" | "annotation"`
- `GatewayKind = "fork" | "join"`
- `parseNodeFormat(format_schema)` 返回稳定 fallback。

Fallback 规则：

- 非对象或未知类型：普通 task。
- shape 不合法：`rectangle`。
- `type = "gateway"` 但 `gateway_kind` 非法：返回 invalid gateway，供 Preflight 阻断。
- 旧节点缺少 `template_category`：按 `action` 处理（语义为"当普通 task 对待"，与 agent-task 模板的默认 category 一致）。

## API 兼容

API request 不新增字段，继续通过 `format_schema` 传入。

桌面端可能连接更新后的后端或旧后端，因此前端消费 API 时必须继续 parse，不做裸 cast。未知 enum 值降级展示，不能白屏。

**附带修复 `CreateWorkflowEdge` condition 丢失 bug**：handler（`server/internal/handler/workflow.go:721`）已解析 `req.Condition`，但创建时没有传给 sqlc（`CreateWorkflowEdgeParams` 已包含 `Condition []byte` 字段，只是 handler 没填）。本批次附带修复：在 handler 中将 `req.Condition` marshal 后传入 `CreateWorkflowEdgeParams.Condition`。第一批功能不依赖 edge condition，但修复后可为后续语义边复用。

## 节点视觉系统

共享节点组件服务两种模式：

- `edit`：Workflow 定义编辑。
- `run`：Issue 全景执行视图。

节点视觉拆成三层：

1. 语义基础层，两个模式共享。
2. 编辑态覆盖层，只承载编辑操作。
3. 运行态覆盖层，只承载执行状态。

### 语义基础层

形状表达节点类型：

- Trigger：pill。
- Task / Agent：rectangle。
- Fork / Join / Decision：diamond。
- Human Review：hexagon。
- Annotation：note（非 `NodeShape` 枚举值，由独立的 annotation 渲染路径处理，不使用 shape 驱动）。

图标表达能力类别：trigger、agent、human、gateway、note。

信息区保持统一结构：标题、类型标签、处理者或摘要。

### 编辑模式节点信息

编辑模式只展示定义层核心信息：

- 标题：节点名称。
- 类型：Trigger / Task / Agent / Review / Fork / Join / Note。
- 处理者：显示 `WorkerType`（人 / 智能体 / 小队 / 研发角色）+ 具体执行者名称。若为 role 类型则显示角色名 + "运行时解析"提示。
- 交付物摘要：显示是否定义了交付物，以及 Doc / PR 类型图标。

不展示：

- 缺 worker / 缺 critic / 缺 stage。
- schema 或配置错误。
- 复杂描述全文。

Stage 归属由泳道表达，不进入节点内部。

### 运行模式节点信息

运行模式严格对齐用户旅程中 Issue 全景图的节点信息：

- 标题。
- 处理者：审核中显示评审者，其他状态显示执行者。
- 运行状态：待规划 / 待办 / 进行中 / 审核中 / 已完成 / 已阻塞 / 已取消。
- 交付物情况：红黄绿灯提交状态。
- 执行信息：耗时。
- 智能体操作入口：进入会话、重试。

Gateway 在运行模式中不显示处理者、交付物、会话或重试。Gateway 的 `display_status` 映射规则（`WorkflowRuntimeDisplayStatus` 不新增枚举值，在 UI 层按 `gateway_kind` + `node_run.status` 覆盖 label）：

- Fork + completed：显示"已分发"。
- Join + completed：显示"已汇聚"。
- Join + pending / todo：显示"等待上游"。
- Fork / Join + cancelled：显示"已取消"。

### 视觉编码规则

- 形状表达节点语义。
- Stage 由泳道、泳道标题和必要的泳道背景表达，不进入节点卡片色带。
- 运行状态由节点右上角动态 icon 表达，不使用节点顶部状态细条，也不使用卡片左侧色带。
- 红黄绿灯只表达交付物情况。
- 底部 actor 区只表达当前处理者。
- 操作按钮只在运行模式 hover / selected 时出现。

避免让颜色同时表达 stage、状态和交付物三种含义。

运行状态必须使用实际运行摘要数据，而不是从底层 `node_run.status` 在 UI 内临时推断。优先消费 `WorkflowNodeRuntimeSummary.display_status`。

**底层 `NodeRunStatus`（16 值）到 `WorkflowRuntimeDisplayStatus`（7 值）的映射：**

| `NodeRunStatus` | `WorkflowRuntimeDisplayStatus` |
|---|---|
| `pending` | `pending` |
| `format_checking`, `format_ok`, `worker_assigned`, `working`, `awaiting_input` | `todo` |
| `awaiting_critic`, `critic_reviewing` | `reviewing` |
| `critic_approved`, `completed` | `completed` |
| `failed`, `format_failed`, `blocked` | `blocked` |
| `cancelled` | `cancelled` |
| `skipped` | `completed` |

**各 `WorkflowRuntimeDisplayStatus` 的 icon 映射：**

- `pending`：待规划，使用空心圆或灰色等待 icon。
- `todo`：待办，使用时钟或队列 icon。
- `in_progress`：进行中，使用可旋转 loader icon。
- `reviewing`：审核中，使用审查 / 用户确认 icon。
- `completed`：已完成，使用完成 icon。
- `blocked`：已阻塞，使用告警 icon。
- `cancelled`：已取消，使用取消 icon。

`WorkflowNodeRuntimeSummary.deliverable_signal` 只驱动交付物红黄绿灯。`has_error` / `error_message` 只用于错误说明和异常展开，不再额外改变节点外形。

## 详情面板

详情面板是画布节点的深层信息承载区。节点本体只展示全景图必须一眼看到的核心信息；配置、运行数据、交付物明细和操作入口进入详情面板。

同一套画布基础设施应支持两类详情面板：

- Workflow 编辑器详情面板：用于维护 workflow 定义。
- Issue 全景图详情面板：用于只读查看执行情况，并提供少量运行操作。

两者可以共享节点选择、面板开关、标题区和基础布局，但内容区域按 `mode` 分流，避免在编辑器里混入运行操作，也避免在 Issue 全景图里暴露定义编辑表单。

### 编辑模式详情面板

编辑模式面板回答“这个节点在定义上是什么、由谁处理、产出什么”。

普通任务节点内容：

- 标题和描述。
- 所属 Stage：可调整，仍以泳道作为主表达。
- 执行者：两段式选择。第一段 `TypeSegmentedControl` 切换类型（human / agent / squad / role）；第二段按类型展示不同选择器——human / agent / squad 走 `AssigneePicker` 搜索选择具体执行者，role 走 `<select>` 下拉选择研发角色，下方 `ActorSummary` 显示当前选择摘要。切换类型时清空已选具体执行者。
- 评审者：两段式选择。第一段 `TypeSegmentedControl` 切换类型（human / agent / squad / role / api）；第二段：human / agent / squad 走 `AssigneePicker`，role 走角色下拉，api 走 URL 输入框。切换类型时清空已选具体执行者。
- 交付物定义：文档 / PR，以及交付要求。
- 节点类型只读摘要：Trigger / Task / Agent / Review 等。

编辑模式面板不把配置完整性作为节点本体信息，但可以在面板内保留字段级校验。全局是否可发布仍由 PreflightBar 或其他组件提示。

**Worker / Critic 选择器实现要点：**
- `TypeSegmentedControl` 切换类型时，同步清空 `workerId` / `criticId`（现有 `node-config-panel.tsx` 已实现此行为，保持）。
- `role` 类型的 `ActorSummary` 显示 "Resolved when the workflow runs"，与其他类型（"Pick a concrete assignee for predictable execution"）不同——保留此差异化提示。
- `AssigneePicker` 的 `toAssigneeType` / `fromAssigneeType` 映射函数（`human ↔ member`、`agent ↔ agent`、`squad ↔ squad`）保持不变，不新增 role 映射（role 不走 AssigneePicker）。
- `workerTypeToActorType`（`packages/core/types/workflow.ts`）已有 `role → "agent"` fallback，用于 actor-name 查找。

Gateway 节点内容：

- 标题和描述。
- Gateway 类型：Fork / Join，只读或通过明确控件切换。
- 连接摘要：
  - Fork：显示下游数量。
  - Join：显示上游数量。
- 简短语义说明：
  - Fork：激活后自动完成并分发到所有下游。
  - Join：等待所有上游完成后自动完成并继续下游。

Gateway 不展示 Worker / Critic / 交付物配置，因为这些字段对 gateway 无运行意义。

Annotation 节点内容：

- 标题、说明内容。
- 可选绑定目标节点。
- 不展示执行者、评审者或交付物。

### 运行模式详情面板

运行模式面板回答“这个节点执行到哪了、谁在处理、交付物怎样、我能做什么”。

普通任务节点内容：

- 节点标题和描述。
- 当前处理者：
  - 审核中显示评审者。
  - 其他状态显示执行者。
- 运行状态：待规划 / 待办 / 进行中 / 审核中 / 已完成 / 已阻塞。
- 交付物明细：
  - 文档 / PR 列表。
  - required 标记。
  - 提交状态和评审状态。
  - PR URL 或附件入口。
- 执行信息：
  - 开始时间、完成时间、耗时。
  - 重试次数。
  - 错误信息或阻塞原因。
- 输出摘要：
  - Worker output。
  - Critic output。
  - Critic comment。
- 智能体相关操作：
  - 进入会话。
  - 重试。
  - 人工介入 / 托管交还在后续控制设计中接入。

运行模式面板只读展示 workflow 定义字段，不允许直接修改执行者、评审者、Stage 或交付物定义。

Gateway 节点内容：

- Gateway 类型和语义说明。
- 上游 / 下游列表。
- 当前状态：
  - Fork：未触发、已分发、已取消。
  - Join：等待上游、已汇聚、已取消。
- Join 等待时显示未完成上游数量。

Gateway 不展示交付物、会话、重试或处理者。

### 面板布局

建议采用固定的信息分区，而不是过多 tab：

- Header：节点标题、类型、当前状态或定义摘要。
- Primary section：编辑模式为定义表单，运行模式为执行状态和处理者。
- Deliverables section：普通节点展示交付物定义或交付物运行状态。
- Runtime section：运行模式展示耗时、输出、错误、会话入口。
- Connections section：Gateway 或需要理解拓扑的节点展示入边 / 出边摘要。
- Actions section：编辑模式放保存、删除等定义操作；运行模式放进入会话、重试、解除阻塞等运行操作。

在窄面板中，优先显示 Header、当前处理者、状态、交付物红绿灯和主操作；长内容进入折叠区，避免面板成为日志堆叠区。

详情面板采用同一骨架、按 `mode` 切内容。固定分区的顺序保持一致，避免用户从编辑模式切到 Issue 全景图时重新学习布局：

1. Header。
2. Primary。
3. Deliverables。
4. Runtime。
5. Connections。
6. Actions。

视觉上不使用卡片左侧色带，也不使用顶部状态条。Header 右侧复用节点卡片同一套动态状态 icon，编辑模式显示最近运行摘要时也使用这个 icon。Primary / Deliverables / Runtime / Connections 左侧使用一条轻量 `handoff spine` 串联——一条垂直细线（`border-l border-muted-foreground/20`），从 Primary 顶部延伸到 Actions 顶部，表达”定义、产出、执行、拓扑”是同一个节点的上下文链路，而不是彼此独立的卡片堆叠。`handoff spine` 是分区之间的结构辅助，不承载状态颜色。

编辑模式仍显示最近运行摘要，但默认折叠。以下情况自动高亮并展开 Runtime summary：

- 最近运行状态为 `blocked`。
- `WorkflowNodeRuntimeSummary.has_error = true`。
- `deliverable_signal = "red"`。

运行模式的 Runtime section 默认展开，因为它是 Issue 全景图的主要任务。编辑模式的 Runtime section 只提供最近一次运行的上下文，不提供运行操作。

### 可复用实现边界

第一批实现应优先复用现有组件，而不是重写整套 inspector：

- `packages/views/issues/components/execution/runtime-node-card.tsx`：作为运行态节点卡片的现有基础，后续改造为消费 `WorkflowNodeRuntimeSummary.display_status` 和 `deliverable_signal`。
- `packages/views/issues/components/execution/node-run-status-icon.tsx`：保留 icon 映射思路，但新增面向 `WorkflowRuntimeDisplayStatus` 的共享 status icon 映射；旧 `NodeRunStatus` icon 可作为底层状态 fallback。
- `packages/views/issues/components/execution/execution-detail-panel.tsx`：作为运行模式详情面板基础，迁移到固定分区栈和 Header 状态 icon。
- `packages/views/workflows/components/node-config-panel.tsx`：作为编辑模式详情面板基础，保留定义编辑能力，减少 tab 依赖，逐步迁移到固定分区栈。
- `packages/views/workflows/components/node-data-preview.tsx`：继续承载输出、评审和最近运行数据预览。
- `packages/views/workflows/components/node-deliverables-editor.tsx`：继续承载编辑模式交付物定义。

建议新增小型共享组件，而不是把运行态和编辑态逻辑揉进同一个大文件：

- `WorkflowNodeDetailPanelShell`：统一 Header、关闭行为、滚动容器、固定分区容器。
- `NodeDetailSection`：统一分区标题、辅助说明、折叠态和 `handoff spine` 对齐。
- `RuntimeDisplayStatusIcon`：只接收 `WorkflowRuntimeDisplayStatus`，输出动态 icon 和可访问 label。
- `DeliverableSignalIndicator`：只接收 `WorkflowDeliverableSignal`，输出红黄绿灯。

这些组件放在 `packages/views`，不引入 `next/*` 或 `react-router-dom`。状态映射函数若不依赖 UI，放在 `packages/core`；如果返回 Lucide icon 或 className，则留在 `packages/views`。

## 编辑器交互

### 节点模板

在 `node-template-catalog.ts` 增加：

- `fork-gateway`
  - category: `logic`
  - title: `Fork`
  - description: `Run multiple downstream branches in parallel.`
  - shape: `diamond`
  - `format_schema.type = "gateway"`
  - `format_schema.gateway_kind = "fork"`
- `join-gateway`
  - category: `logic`
  - title: `Join`
  - description: `Wait for multiple upstream branches before continuing.`
  - shape: `diamond`
  - `format_schema.type = "gateway"`
  - `format_schema.gateway_kind = "join"`

Gateway 创建时仍传默认 `worker_type` / `critic_type` 以满足当前后端非空约束，但 UI 和运行时忽略这些字段。Gateway 的面板行为按“详情面板”章节处理。

### 连线删除

第一批只做悬浮删除按钮（编辑模式专属，运行模式不渲染删除按钮）：

- hover 或 selected 到普通 workflow edge 时，在边中点显示 icon button。
- 点击直接删除，调用现有 `useDeleteEdge`。
- 删除成功后 invalidate edges。
- 删除失败 toast。
- 保留 Delete / Backspace 键盘删除能力。
- critic 内部虚线边不显示删除按钮。

实现建议：

- 在 `packages/views/workflows/components/overview/reactflow-edges/panorama-edge.tsx` 使用 `EdgeLabelRenderer` 渲染删除按钮。在 `PanoramaEdgeData` 上新增 `onDeleteEdge?: (edgeId: string) => void` 回调字段。
- 通过 edge `data.onDeleteEdge(edgeId)` 注入删除回调。

## 后端运行时

### Gateway 识别

后端增加一个小解析函数：

```go
type workflowNodeFormat struct {
	Type        string `json:"type"`
	GatewayKind string `json:"gateway_kind"`
}
```

只接受：

- `type = "gateway"`
- `gateway_kind = "fork" | "join"`

未知 gateway 不自动执行，前端 Preflight 阻断。

### StartRun 与 dispatch

创建 node_run 的规则保持不变：

- root 节点：`format_checking`
- 非 root 节点：`pending`

当 gateway node_run 进入 `format_checking`：

- 直接更新为 `completed`。
- 不执行 JSON Schema 校验。
- 不创建 agent task。
- 不进入 worker / critic。
- 调用现有 `OnNodeRunCompleted` 激活下游。

### Fork 语义

Fork 不需要特殊算法。Fork 自动完成后，现有 `OnNodeRunCompleted` 会遍历所有 outgoing edges 并激活可运行下游。

Preflight 约束：

- Fork 至少 2 个下游。
- Root fork 允许作为入口。

### Join 语义

Join 也复用现有上游等待逻辑。所有上游终态后，Join 被激活；激活后自动完成；完成后激活下游。

Preflight 约束：

- Join 至少 2 个上游。
- Join 多下游第一批给 warning，不 blocking。

### 失败和取消

取消 run 时，gateway 与普通 node_run 一样取消。

当前 `isTerminalNodeRunStatus` 会把 failed / format_failed 视为终态，因此 Join 可能在上游失败后继续。这是现有语义，第一批不改变。失败传播、错误分支和失败阻断 Join 后续单独设计。

## Preflight

### 现有检查修改

Gateway 节点与 annotation 一样不参与 Worker / Critic / Stage 校验。在 `packages/core/workflows/preflight-checks.ts` 中增加 `isGateway()` 辅助函数（解析 `format_schema.type === "gateway"`），并修改以下现有检查使其同时跳过 gateway：

- `checkWorkerMissing`：过滤条件从 `!isAnnotation(n)` 改为 `!isAnnotation(n) && !isGateway(n)`。
- `checkStageMissing`：同上。
- `checkInvalidCriticRef`：同上。

### 新增检查

`PreflightCheckId` 联合类型新增：
- `"gateway-fork-outgoing"`
- `"gateway-join-incoming"`
- `"gateway-kind-invalid"`
- `"gateway-join-multiple-outgoing"`

检查逻辑：

- `gateway-fork-outgoing`
  - Fork 出边数 `< 2`：error，blocking。
- `gateway-join-incoming`
  - Join 入边数 `< 2`：error，blocking。
- `gateway-kind-invalid`
  - `type = "gateway"` 但 `gateway_kind` 非法：error，blocking。
- `gateway-join-multiple-outgoing`
  - Join 出边数 `> 1`：warning，不 blocking。

不新增配置完整性提示。Gateway 的 worker / critic 字段被忽略，不提示用户。

## 测试策略

只跑相关模块测试（`pnpm --filter <package> exec vitest run <file>`），不做全量 `pnpm test`。

### 前端测试

- `node-template-catalog.test.ts`
  - 覆盖 `fork-gateway` / `join-gateway`。
  - 创建 payload 带 `type: gateway` 和 `gateway_kind`。
- 节点组件测试
  - Trigger / Task / Gateway / Review / Annotation 的基础样式与核心信息。
  - 运行模式展示标题、处理者、状态、交付灯、耗时。
  - Gateway 不显示处理者、交付物、会话、重试。
- 详情面板测试
  - 编辑模式普通节点展示定义字段，不展示运行操作。
  - 编辑模式 Gateway 不展示 Worker / Critic / 交付物配置。
  - 运行模式普通节点展示处理者、状态、交付物明细、耗时和智能体操作入口。
  - 运行模式 Gateway 展示等待 / 分发 / 汇聚状态，不展示交付物和会话操作。
- `panorama-edge.test.tsx`（位于 `packages/views/workflows/components/overview/reactflow-edges/`）
  - hover / selected 时显示删除按钮。
  - 点击删除回调 edge id。
  - critic 内部边不显示删除按钮。
- `preflight-checks.test.ts`
  - Fork 少于两个下游 blocking。
  - Join 少于两个上游 blocking。
  - invalid gateway kind blocking。
  - 合法 Fork / Join 通过。

### 后端测试

在 workflow service 测试中覆盖：

- root Fork 自动完成并激活多个下游。
- Join 等待两个上游全部完成后自动完成。
- Gateway 不创建 agent task。
- Gateway 不进入 worker / critic。
- cancel run 能取消 gateway node_run。

`CreateWorkflowEdge` condition 修复测试：

- handler 测试覆盖 condition 被保存并返回。

### 手工验证

- 编辑器创建 Fork / Join。
- Fork 连两个下游，运行后两个分支同时进入可执行状态。
- Join 连接两个上游，一个上游完成时不启动，两个完成后自动通过。
- Issue 全景图复用同一节点视觉基础，叠加运行状态。
- hover / selected 连线时出现删除按钮，点击删除后预检刷新。

## 后续方向

- 条件分支与 true / false 输出端口。
- 失败分支与错误传播。
- any-of join / all-of join 策略。
- 隐式多出边 / 多入边迁移：现有 workflow 可能已有节点通过多出边实现隐式并行（不经 Fork）。引入显式 Fork / Join 后，两种语义共存。后续考虑 Preflight warning 提示隐式 Fork，以及一键迁移工具。
- 用户自定义节点 icon / color / style。
- 语义边：data、condition、error、rework。
- 发布版本模型与历史执行回放。

## 自检

- 本设计聚焦第一批功能：悬浮删边、显式 Fork / Join、共享节点视觉系统。
- 未新增数据库表，避免扩大实现范围。
- 节点信息层级已按用户旅程收敛，不展示配置完整性。
- 编辑模式和运行模式共享基础视觉系统，通过 mode 叠加差异层。
- 运行状态改为右上动态 icon，使用 `WorkflowNodeRuntimeSummary.display_status` 的实际状态数据。
- 已排除节点顶部状态条和卡片左侧色带，Stage 继续由泳道层表达。
- 详情面板采用同一骨架、固定分区栈，并明确复用现有运行态和编辑态实现。
- 已明确失败传播不在第一批，避免隐式改变现有运行语义。
- Worker / Critic 两段式选择交互（TypeSegmentedControl → AssigneePicker / role dropdown）完整保留，不降级为扁平枚举。
- `NodeRunStatus`（16 值）→ `WorkflowRuntimeDisplayStatus`（7 值）映射表已定义，前后端均按此映射。
- Preflight 现有检查（worker-missing / stage-missing / invalid-critic-ref）已增加 `isGateway()` 跳过逻辑。
- `CreateWorkflowEdge` condition 丢失 bug 附带修复，不阻塞也不扩大本批次范围。
- 连线删除限定编辑模式，运行模式不误触。
- Gateway 的 `display_status` label 覆盖规则已明确（UI 层按 `gateway_kind` + `node_run.status` 覆盖）。

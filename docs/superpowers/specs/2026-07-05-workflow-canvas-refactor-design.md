# Workflow 画布重构设计

**Status:** Pending review  
**Date:** 2026-07-05  
**Scope:** 前端画布基础设施重构  
**Primary references:** `docs/workflow-mvp.md`, `docs/workflow-prd.md`, `report/n8n_workflow_canvas_uiux_report.html`

## 1. Context

Workflow MVP 要求编辑模式和运行模式共享同一套画布基础设施：

- Workflow 编辑器：单视图 DAG 画布 + Stage 泳道，用于搭建 Workflow 定义。
- Issue 全景图：复用编辑器画布基础设施，叠加运行时状态，作为 Issue 详情页内的只读执行视图。

当前实现已经有两个方向：

- `packages/views/workflows/components/dag-canvas.tsx` 基于 `@xyflow/react`，承担编辑器画布、节点状态叠加、注释、删除、拖拽、尺寸调整、对齐辅助等职责。
- `packages/views/workflows/components/overview/workflow-panorama-page.tsx` 使用 HTML Stage Lane + SVG overlay，提供 Workflow 侧 panorama/architecture 视图。

这导致编辑态和运行态存在继续分叉的风险。重构目标不是重写整个 Workflow 产品，而是先把前端画布基础设施拆清楚，让编辑器先稳定，再让 Issue 全景图复用同一份模型、布局规则和节点渲染协议。

## 2. Goals

- 以 Workflow 编辑器为第一优先级，重构手动搭建画布体验。
- 抽出共享画布模型，统一定义 Stage、Node、Edge、Selection、Runtime overlay 的前端表示。
- 拆分 `DAGCanvas` 的职责，使 ReactFlow surface 专注编辑交互。
- 让 Issue 全景图复用画布模型、节点卡片协议、连线语义和详情面板框架。
- 明确编辑态和运行态边界：编辑器修改 Workflow 定义；Issue 全景图只操作 WorkflowRun / WorkflowNodeRun。
- 保持现有包边界：core 放纯逻辑和 Zustand store，views 放共享 UI，apps 只做平台路由和壳。

## 3. Non-goals

- 不做 AI 创建 Workflow。
- 不做 AI Proposal 流程。
- 不做 AI 生成 JSON Schema。
- 不做运行时调试回放、Pin Data、单步执行。
- 不重构后端运行时调度。
- 不把 Workflow 列表/编辑器变成实时 Run 全景图入口。MVP 中 Run 全景图只属于 Issue 详情页。
- 不在 Issue 全景图中编辑 Workflow 定义。

## 4. Chosen Approach

采用“分层画布内核”路线。

共享的不是一个万能页面，而是同一份画布数据模型、布局规则、节点卡片协议、连线语义、选择接口和详情面板框架。

编辑器使用 ReactFlow 作为主 surface，负责拖拽、连线、缩放、MiniMap、选择、删除、对齐吸附。Issue 全景图可以使用更适合阅读和嵌入的 Stage Lane + SVG overlay surface，但必须消费同一份 `CanvasModel`，使用同一套节点/连线语义。

未选择的方案：

- 保守拆分现有实现：风险低，但编辑态和运行态会继续分叉。
- 全部统一到 ReactFlow：复用最大，但会强迫 Issue 全景图接受 ReactFlow 的布局约束，降低运行态信息密度和嵌入灵活性。

## 5. Architecture

### 5.1 Core layer

新增 `packages/core/workflows/canvas/`：

| File | Responsibility |
|------|----------------|
| `types.ts` | `CanvasNode`, `CanvasEdge`, `CanvasStage`, `CanvasMode`, `CanvasSelection`, `RuntimeNodeOverlay` |
| `build-canvas-model.ts` | 把 Workflow / Stage / Node / Edge / 可选 NodeRun 转换为统一画布模型 |
| `layout.ts` | 自动布局、Stage 内排序、端口方向、连线 handle 选择等纯函数 |
| `preflight.ts` | 前端预检查纯函数，输出可定位的问题列表 |
| `runtime-overlay.ts` | 将 NodeRun 状态映射为卡片状态、颜色、按钮可见性 |

Core 层不得引入 ReactDOM、浏览器 API、UI 组件、localStorage 或 process.env。服务端数据仍由 React Query 持有；Zustand 只保存客户端编辑草稿、选择和视图偏好。

### 5.2 Views canvas layer

新增 `packages/views/workflows/canvas/`：

| Component | Responsibility |
|-----------|----------------|
| `WorkflowCanvasShell` | 公共容器，接收 mode、model、selection、callbacks、slots |
| `ReactFlowSurface` | 编辑器主画布，处理拖拽、连线、缩放、MiniMap、对齐辅助 |
| `StageLaneSurface` | 运行态/预览态的 Stage 泳道 + SVG overlay surface |
| `WorkflowNodeCard` | 定义态和运行态共用节点卡片协议，通过 variant 控制信息密度 |
| `WorkflowEdgeLayer` | 基于统一 edge 语义绘制定义态/运行态连线 |
| `CanvasInspector` | 右侧面板框架，编辑器挂配置面板，Issue 挂运行详情面板 |
| `PreflightBar` | 发布前检查结果、错误聚合和定位入口 |

现有 `DAGCanvas` 先保留为 thin wrapper，内部调用 `ReactFlowSurface`。现有 overview 中的 `StageLane`、`CompactNodeCard`、`PanoramaSvgOverlay` 逐步迁入 `canvas/`，并保留兼容导出直到调用方完成迁移。

## 6. Editor Design

编辑器是本次重构的第一消费者，范围专注手动画布：

- 顶部：Workflow 标题、draft/active 状态、dirty indicator、自动布局、保存草稿、发布。
- 左侧：节点面板，按 Agent Worker、Human Worker、Squad、Annotation 分组，支持搜索。
- 中央：ReactFlow DAG 画布，Stage 以泳道/背景带呈现。
- 右侧：节点配置抽屉，配置标题、描述、Worker、Critic、JSON Schema、Stage 归属。
- 底部：预检查栏，展示发布阻断问题并支持点击定位。

编辑器画布能力：

- 面板拖入创建节点。
- 节点端口拖出到空白处，弹出节点类型选择，确认后创建节点并自动连线。
- 节点拖拽、对齐吸附、批量选择、删除、撤销/重做。
- 连线创建、选中、删除。
- Stage 泳道展示、节点归属展示和 Stage 内布局。
- 自动布局基于 Workflow DAG 和 Stage 顺序。

发布前预检查包括：

- DAG 环检测。
- 孤立节点和不可达节点。
- 必填字段缺失。
- Worker / Critic 引用缺失。
- Stage 引用缺失或节点无归属时的提示。

## 7. Issue Runtime Panorama

Issue 全景图是第二消费者，属于 Issue 详情页的一部分。

它复用同一份 `CanvasModel` 和节点卡片协议，但运行在只读模式：

- 禁止移动节点。
- 禁止创建/删除节点。
- 禁止创建/删除连线。
- 禁止编辑 Worker/Critic/Schema/Stage。
- 点击节点只打开运行详情。

运行态叠加包括：

- NodeRun 状态：pending、format_checking、working、awaiting_input、awaiting_critic、critic_reviewing、blocked、failed、completed、skipped、cancelled。
- 节点卡片状态视觉：灰、蓝、橙、红、紫、绿等语义状态。
- 卡片内嵌操作：通过/打回、重试、跳过、手动完成、接手/交还。
- 顶部全局提示栏：按 awaiting_critic > blocked/failed > awaiting_input 的优先级提示并定位。
- 右侧详情面板：概览、产物、时间线、只读快照配置、运行态操作。
- 嵌入/全屏切换：仅改变 Issue 页面内展示密度，不新增独立 Run 页面。

## 8. Data Flow

React Query 继续拥有服务端状态：

- Workflow
- WorkflowStage
- WorkflowNode
- WorkflowEdge
- WorkflowRun
- WorkflowNodeRun

Zustand 只保存客户端状态：

- 当前编辑模式。
- 选中节点/连线。
- 本地节点编辑 overlay。
- 已标记删除的节点。
- undo/redo 栈。
- 画布视图偏好。

渲染链路：

```text
React Query data
  + optional Zustand draft overlay
  + optional RuntimeNodeRun overlay
  -> buildCanvasModel()
  -> WorkflowCanvasShell
  -> ReactFlowSurface | StageLaneSurface
```

画布事件通过 callbacks 输出：

- `onNodeMove`
- `onNodeCreate`
- `onNodeDelete`
- `onEdgeCreate`
- `onEdgeDelete`
- `onSelectionChange`
- `onOpenInspector`
- `onPreflightIssueClick`
- `onRuntimeAction`

编辑器消费者把事件映射到定义态 mutations；Issue 全景图消费者把事件映射到运行态 mutations。

## 9. Error Handling

| Scenario | Handling |
|----------|----------|
| API 响应缺字段或枚举漂移 | 继续使用 core API schema fallback，UI 降级显示 |
| 节点引用的 Worker/Critic 不存在 | 卡片和配置面板显示 muted placeholder，预检查阻断发布 |
| Stage 不存在或节点未归属 | 显示 Unassigned 区域或提示，编辑器允许修复 |
| 创建连线失败 | 回滚本地连线状态，Toast 报错 |
| 保存节点位置失败 | 保留本地 dirty 状态，提示重试 |
| 发布预检查失败 | 阻断发布，底部栏列出问题，点击定位 |
| Issue 全景图运行态操作失败 | 保持原 NodeRun 状态，Toast 报错，invalidate 对应 query |
| 大图渲染 | 编辑器使用 fitView、MiniMap、缩放和滚动；Stage surface 使用横向滚动和 SVG 重测量 |

## 10. Migration Plan

1. 新增 core canvas 类型和纯函数，不改 UI。
2. 从 `dag-canvas.tsx` 提取 ReactFlow 数据映射、handle 选择、布局辅助到 core/views canvas。
3. 新建 `ReactFlowSurface`，让 `DAGCanvas` 成为 thin wrapper。
4. 改造 `WorkflowDetailPage` 使用 `WorkflowCanvasShell + ReactFlowSurface`。
5. 迁移 `NodeConfigPanel` 到 `CanvasInspector` slot，保留现有配置行为。
6. 迁移 overview 的 Stage Lane、Compact Node Card、SVG overlay 到 shared canvas。
7. 新建或改造 Issue 全景图消费者，使用 `StageLaneSurface` 和 runtime overlay。
8. 删除旧的重复画布逻辑和 deprecated wrapper。

每一步都应保持可运行，并用 targeted tests 保护迁移边界。

## 11. Testing Plan

### Core tests

- `buildCanvasModel()` 正确合并 Workflow 定义、Stage、Node、Edge。
- draft overlay 能覆盖节点位置、标题、配置显示。
- runtime overlay 能映射 NodeRun 状态到卡片语义。
- preflight 能检测环、孤立节点、缺失 Worker/Critic、缺失引用。
- layout 能按 Stage 顺序生成稳定位置。

### Views component tests

- `WorkflowCanvasShell` 能在 edit/read-only/runtime 模式下传递正确能力开关。
- `ReactFlowSurface` 在 edit 模式允许拖拽/连线，在 read-only 模式禁用写操作。
- `WorkflowNodeCard` 能根据 definition/runtime variant 显示不同信息密度。
- `PreflightBar` 能展示问题并触发定位 callback。
- `CanvasInspector` 能挂载编辑配置面板和运行详情面板。

### Editor tests

- 面板拖入创建节点。
- 端口拖出空白处创建节点并自动连线。
- 节点移动写入 draft overlay。
- 删除节点/连线进入正确 mutation 或 draft 状态。
- 发布前预检查失败时阻断发布。

### Issue panorama tests

- 运行态画布不可拖拽、不可连线、不可删除。
- awaiting_critic 节点显示审核操作。
- blocked/failed 节点显示恢复操作。
- 全局提示栏定位优先级正确。
- 右侧详情面板展示运行态和只读快照配置。

### E2E smoke tests

- 创建 Workflow，手动添加节点，连线，配置 Worker/Critic，保存。
- 发布前缺配置时出现预检查错误。
- 配置完成后发布成功。
- Issue assign Workflow 后显示全景图。
- 在 Issue 全景图中完成一次审核或重试操作。

## 12. Risks

- `DAGCanvas` 当前职责较多，一次性替换风险高。用 thin wrapper 和逐步迁移降低风险。
- ReactFlow surface 与 StageLane surface 共享模型但不共享布局 DOM，可能出现视觉差异。需要把布局规则和节点卡片协议抽成明确接口。
- Issue 全景图如果直接读取最新 Workflow 定义，会受定义漂移影响。前端方案只规定消费 snapshot model；后端运行时快照落地属于独立依赖。
- `.superpowers/brainstorm/` 是本次 brainstorming 的临时可视化产物，不属于设计交付物。

## 13. Acceptance Criteria

- 编辑器画布代码不再把数据映射、ReactFlow 交互、运行态状态、节点渲染和预检查全部混在一个组件里。
- `DAGCanvas` 可以作为兼容 wrapper 过渡，但新调用应优先使用 `WorkflowCanvasShell`。
- Issue 全景图消费共享 `CanvasModel`，而不是重新组装一套 Workflow 图结构。
- 编辑态和运行态在 UI 能力上可明确配置：edit、readonly-definition、readonly-runtime。
- 不引入 AI 创建或 AI Schema 功能。
- 不违反包边界：core 无 UI，views 无 Next/router API，ui 无 core import。

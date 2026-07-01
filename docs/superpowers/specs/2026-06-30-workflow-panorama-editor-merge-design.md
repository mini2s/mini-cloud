# Workflow 全景图合并编辑器设计

> 关联文档：本设计建立在 `2026-06-25-workflow-stage-panorama-design.md` 的 Stage/全景图概念之上，将其从只读展示升级为展示+编辑的统一视图。

## 1. 概述

`2026-06-25-workflow-stage-panorama-design.md` 定义了 Stage 数据模型和以泳道卡片风格展示 Workflow 的全景图。当前架构中：

- **全景图**（`WorkflowPanoramaPage`）：div lane + SVG overlay，只读展示
- **编辑器**（`WorkflowDetailPage`）：ReactFlow DAG 画布，全部编辑能力

本设计将编辑器能力合并入全景图，使其成为 `workflows/[id]` 的唯一视图——展示 + 编辑一体化。核心技术路线：**全景图底层切换为 ReactFlow**，在 ReactFlow 内实现泳道布局。

### 关键决策

| 维度 | 决策 |
|------|------|
| 最终形态 | 全景图完全取代编辑器，移除独立编辑器视图和视图切换 |
| 渲染引擎 | ReactFlow 一体化 |
| 坐标模型 | `position_x` 自由拖动（DB 存储），y 坐标由 `stage_id` 推导（不存 DB） |
| 节点排列 | lane 内自由水平拖动；跨 lane 自动切换 stage |
| 连线创建 | 从节点 Handle 拖拽连线 |
| 节点创建 | 从顶部工具栏 Popover 拖拽/点击形状图标到画布 |
| 属性编辑 | 右侧滑出 NodeConfigPanel，属性修改 500ms debounce 自动保存 |
| 保存策略 | 属性编辑（标题/描述/format_schema/指派）通过 store 缓存 + 500ms debounce 自动 `updateNode`；位置/连线/stage assignment 即时提交 |
| 撤销策略 | 当前 store 只支持本地编辑快照和 create-edge/delete-edge server action；即时提交操作必须补齐 server-backed undo，否则不承诺撤销 |
| 连线约束 | 跨 stage 边已由后端支持，本设计只在前端开放创建 |
| 实现策略 | 全部新建 ReactFlow 组件（`reactflow-nodes/`、`reactflow-edges/`），完成后只删除无剩余引用的旧文件 |

## 2. 数据模型调整

基础模型沿用 `2026-06-25` 文档的 Stage 定义，以下为调整项：

### 2.1 跨 stage 边约束放宽

后端当前已经允许跨 stage 边：`CreateWorkflowEdge` 只校验节点存在、不能自连，现有测试 `TestCrossStageEdge_Allowed` 覆盖该行为。本文档不再把后端放宽校验列为待实现项；实现时只需要保留该测试并在前端允许跨 lane 连线。

### 2.2 坐标模型

```
position_x   →  DB 存储，自由拖动（lane 内水平定位）
stage_id     →  唯一的 y 坐标来源（lane 位置由 stage.sort_order 决定）
position_y   →  不存储到 DB，运行时根据 stage_id 计算
```

**运行时 y 坐标计算：**

```
node.y = stage.sort_order * LANE_STEP + LANE_PADDING_TOP
LANE_STEP = LANE_HEIGHT + GRADIENT_HEIGHT = 160px + 16px = 176px
LANE_HEIGHT = 160px
GRADIENT_HEIGHT = 16px
LANE_PADDING_TOP = 12px
```

未分组节点（`stage_id = NULL`）的 y = `UNASSIGNED_LANE_Y = stages.length * LANE_STEP + 16px`（所有 stage lane 之后）。

| 操作 | `position_x` 行为 | `stage_id` 行为 |
|------|-------------------|----------------|
| 水平拖动节点 | 更新并立即持久化 | 不变 |
| 垂直拖动到相邻 lane | 保持 | 自动切换为新 stage，调 `assignNodeToStage` |
| 拖拽 stage 排序 | 所有节点 x 不变 | 不变（y 由 stage 新 sort_order 重算） |
| 属性面板切换 stage 下拉 | 不变 | 更新 stage_id，y 自动归位 |
| Auto-layout（dagre） | 仅重算 lane 内等距分布 | 不变 |

## 3. 路由简化

`/workflows/[id]` 是唯一主视图，移除编辑器/全景图的视图切换。Web 现有 `/workflows/[id]/overview` redirect 默认保留为兼容入口；除非确认没有外部链接依赖，否则不要删除该 redirect。Desktop 当前只有 `workflows/:id`，只需要更新该入口指向新合并视图。

| 路由 | 说明 |
|------|------|
| `/workflows/[id]` | 全景图（唯一视图，展示+编辑） |
| `/workflows/[id]/runs` | 运行历史（不变） |
| `/workflows/[id]/runs/[runId]` | 运行详情（不变） |

## 4. 文件结构

### 4.1 新增文件

```
packages/views/workflows/components/overview/
├── reactflow-nodes/
│   ├── index.ts                                ← 新增：自定义节点统一导出
│   ├── compact-worker-node.tsx                 ← 新增：CompactWorker ReactFlow 节点
│   ├── critic-badge-node.tsx                   ← 新增：CriticBadge ReactFlow 节点
│   ├── lane-bg-node.tsx                        ← 新增：Lane 半透明背景节点
│   └── gradient-bg-node.tsx                    ← 新增：渐变过渡带节点
│
├── reactflow-edges/
│   ├── index.ts                                ← 新增：自定义边统一导出
│   └── panorama-edge.tsx                       ← 新增：ReactFlow SmoothStep/Straight Edge

├── canvas-stage-labels.tsx                     ← 新增：画布左侧固定 stage 标签（卡片式 + 2×2 操作按钮 + 拖拽手柄）
├── constants.ts                                ← 重写：统一色系常量与布局参数（含 computeLaneY）
├── workflow-panorama-page.tsx                  ← 重写：ReactFlow 泳道画布主页面（含内联 PageHeader 工具栏）

└── *.test.tsx                                  ← 新增：各组件测试
```

### 4.2 复用文件（不修改或微调）

| 文件 | 使用方式 |
|------|---------|
| `node-config-panel.tsx` | 适配复用：新增 `onDeleteNode`、`onStageChange`、`nodes`、`stages` props，属性编辑通过 store 缓存 + autosave 而非手动保存 |
| `stage-create-dialog.tsx` | 适配复用（新增内联创建 stage 表单，通过 "Create new" 选项触发） |
| `alignment-snap.ts` | 直接复用，不修改 |
| `layout.ts` | 适配：新增 `computeLaneAutoLayout`（lane 内 dagre 水平排列）和 `computeStageTransferPositionX`（跨 stage 转移时选择空位） |
| `packages/core/workflows/store.ts` | 复用基础选择/编辑缓存；若即时提交操作需要撤销，必须扩展 server action 类型 |
| `packages/core/workflows/queries.ts` | 直接复用 |

### 4.3 完成后清理的文件

```
# 编辑器（新合并视图替代后移除）
packages/views/workflows/components/workflow-detail-page.tsx
packages/views/workflows/components/workflow-detail-shell.tsx
packages/views/workflows/components/dag-canvas.tsx
packages/views/workflows/components/reactflow-nodes.tsx

# 旧 Workflow-only 全景图（确认无引用后移除）
packages/views/workflows/components/overview/workflow-overview-page.tsx
packages/views/workflows/components/overview/stage-canvas.tsx
packages/views/workflows/components/overview/stage-card.tsx
packages/views/workflows/components/overview/stage-node-dag.tsx
packages/views/workflows/components/overview/compact-node-card.tsx
packages/views/workflows/components/overview/critic-badge.tsx
packages/views/workflows/components/overview/node-detail-panel.tsx
packages/views/workflows/components/overview/architecture-detail-panel.tsx

# NodePalette（形状选择移至工具栏 Popover）
packages/views/workflows/components/node-palette.tsx

# PanoramaToolbar（工具栏内联到 PageHeader）
packages/views/workflows/components/overview/panorama-toolbar.tsx

# Store（视图切换移除后确认无引用再删）
packages/core/workflows/stores/view-store.ts
```

`stage-lane.tsx` 和 `panorama-svg-overlay.tsx` 当前仍被 `packages/views/issues/components/execution/execution-panorama-page.tsx` 复用，不能在本次 Workflow 编辑器合并中直接删除。只有先迁移 issue execution panorama 到新组件或确认保留旧 runtime 展示组件后，才能清理这些文件。

## 5. 组件架构

### 5.1 泳道布局方案

泳道通过 ReactFlow 内的「背景层节点 + 节点 y 约束」实现，不使用多个 ReactFlow 实例。

```
┌─ ReactFlow Viewport ────────────────────────────────────────────┐
│                                                                  │
│  LaneBgNode (stage=0, 色带循环[0])    ← z-index: -2             │
│  ┌──────────────────────────────────────┐   不可拖、不可选        │
│  │                                      │                        │
│  │  CompactWorkerNode  CompactWorkerNode ← z-index: 0            │
│  │  (stage_id=0)        (stage_id=0)     可拖、可选              │
│  │       │                   │                                  │
│  │       ▼ CriticBadgeNode   ▼ CriticBadgeNode                  │
│  │                                      │                        │
│  └──────────────────────────────────────┘                        │
│                                                                  │
│  GradientBgNode (16px 渐变条)              ← z-index: -2           │
│  ───────────────────────────────                                │
│                                                                  │
│  LaneBgNode (stage=1, 色带循环[1])                               │
│  ┌──────────────────────────────────────┐                        │
│  │  CompactWorkerNode  ...               │                        │
│  └──────────────────────────────────────┘                        │
│  ...                                                             │
│                                                                  │
│  LaneBgNode ("未分组", 灰色调)            ← 画布最底部             │
└──────────────────────────────────────────────────────────────────┘
```

**画布固定宽度** `PANORAMA_WIDTH = 2400px`。

### 5.2 组件树

```
WorkflowPanoramaPage                              ← 新入口
│
├── PageHeader (inline toolbar, border-b)         ← 工具栏直接内联在页面头部
│   ├── ← Back to Workflows
│   ├── Workflow icon + 可点击编辑标题 + 状态 Badge
│   ├── UndoButton (Ctrl+Z) / RedoButton (Ctrl+Shift+Z)
│   ├── Separator
│   ├── AutoLayoutButton (dagre lane 内排列)
│   ├── Separator
│   ├── AddNodeButton (+ Add node)                 ← 工具栏形状创建 Popover
│   │   └── ShapePalettePopover (5 shape icons, draggable + clickable)
│   ├── Spacer
│   ├── Activate/Deactivate workflow toggle
│   ├── ColorModeToggle (system/light/dark)
│   └── DeleteWorkflowButton (AlertDialog 确认)
│
├── canvas-container (flex, flex-1, relative)     ← 主内容区
│   │
│   ├── CanvasStageLabels (absolute, left-0, w-40)← 固定左侧标签
│   │   └── StageLabel[]                           ← translateY(viewportY) 同步滚动
│   │       ├── 统一卡片 + 左侧 3px 色条
│   │       ├── "Stage N"（text-[10px]）+ stage 名称 + 描述
│   │       ├── 2×2 操作按钮网格（hover 显示）     ← ✏️ 🗑️ ↑ ↓
│   │       └── GripVertical 拖拽手柄（hover 显示）
│   │
│   ├── ReactFlow (flex-1, pl-40)                 ← 核心画布
│   │   ├── <Background />
│   │   ├── <Controls />
│   │   ├── <MiniMap pannable zoomable />
│   │   ├── LaneBgNode[]                          ← nodeTypes.laneBg
│   │   ├── GradientBgNode[]                      ← nodeTypes.gradientBg
│   │   ├── CompactWorkerNode[]                    ← nodeTypes.compactWorker
│   │   ├── CriticBadgeNode[]                     ← nodeTypes.criticBadge
│   │   └── PanoramaEdge[]                        ← edgeTypes.panorama
│   │
│   └── NodeConfigPanel (右侧滑出, w-96)           ← 适配复用 node-config-panel.tsx
│       ├── 标题 / 描述编辑（store 缓存 + autosave）
│       ├── Stage 下拉选择器（即时提交 + "Create new" 内联表单）
│       ├── Worker 指派 (AssigneePicker)
│       ├── Critic 指派 (AssigneePicker + API URL)
│       ├── Format Schema JSON 编辑器
│       ├── Annotation 绑定目标节点
│       └── 删除按钮
│
└── StageCreateDialog (模态框)                     ← 复用 stage-create-dialog.tsx
```

### 5.3 编辑交互

画布**始终可编辑**，无浏览/编辑模式切换：

| 操作 | 触发 | 防误触 |
|------|------|--------|
| 移动节点 | 直接拖拽 | 超过 3px 才生效（ReactFlow 默认），松手即时持久化 position_x |
| 创建连线 | 从 Handle 拖出 | Handle hover 才显示（`opacity-0` → `opacity-100`），拖拽松手即时 createEdge |
| 删除节点/边 | `Backspace` / `Delete` | 需先选中；节点即时 deleteNode，边即时 deleteEdge 并 record server action |
| 多选/框选 | 空白区域拖拽 | ReactFlow `selectionOnDrag`，`multiSelectionKeyCode="Shift"` |
| 打开属性面板 | 单击节点 | 单击 CriticBadge 则选中关联的 Worker 节点 |
| 取消选中 | 点击空白 / `Esc` | 关闭属性面板 |
| 属性编辑 | NodeConfigPanel 输入 | 写入 store `nodeEdits`，500ms debounce 后自动 `updateNode` |
| 标题编辑 | 点击 workflow 标题 | 内联 `<input>`，Enter/Blur 提交，Escape 取消 |

## 6. 核心组件规范

### 6.1 CompactWorkerNode

**（来自 `reactflow-nodes/compact-worker-node.tsx`）**

- 尺寸：224×64px（`h-16 w-56`），圆角卡片（`rounded-lg`），白色背景 + `border border-slate-300/90`
- 阴影：`shadow-[0_1px_2px_rgba(15,23,42,0.08)]`，内边距 `p-2.5`
- 内容：插件名（`text-xs font-semibold`，truncated）+ Agent 状态点 + Agent 名称（`text-[11px] text-muted-foreground`）
- hover：`-translate-y-0.5` + 边框变 `border-primary/45` + 加深阴影
- 选中态：`border-primary/55` + 内阴影
- `data-testid="compact-worker-{id}"`

**Handle 配置：**

| 位置 | 用途 | 默认可见 |
|------|------|---------|
| 右侧 (Position.Right) | 同 lane 连线出口 | `opacity-0`，hover 节点 → `opacity-100` |
| 左侧 (Position.Left) | 同 lane 连线入口 | `opacity-0`，hover 节点 → `opacity-100` |
| 底部 (Position.Bottom) | Worker → Critic 连线出口 | `opacity-0`，hover 节点 → `opacity-100` |

Handle 颜色继承所属 stage 色系。缩放 <0.4x 时所有 Handle 隐藏。

### 6.2 CriticBadgeNode

**（来自 `reactflow-nodes/critic-badge-node.tsx`）**

- 尺寸：144×48px（`h-12 w-36`），虚线边框（`border border-dashed border-border/70`），半透明背景（`bg-muted/30`）
- 内边距 `p-1.5`，圆角 `rounded-md`
- 内容：`ShieldAlert` 图标 + "Critic"（`text-[10px] font-medium uppercase`）+ 名称（`text-xs font-semibold`，truncated）
- Handle：仅顶部 (Position.Top) target，接收 Worker → Critic 连线
- `data-testid="critic-badge-{id}"`

间距：Worker 节点底部到 Critic 顶部 = 20px。

### 6.3 LaneBgNode

**（来自 `reactflow-nodes/lane-bg-node.tsx`）**

- 半透明色带矩形，宽 = `PANORAMA_WIDTH`，高 = `LANE_HEIGHT`
- 6 色循环：前两个 `/70`，后四个 `/45`（沿用 `STAGE_BG_COLORS`）
- `draggable: false`, `selectable: false`, `deletable: false`
- 无圆角、无阴影、无边框，`z-index: -2`

### 6.4 GradientBgNode

**（来自 `reactflow-nodes/gradient-bg-node.tsx`）**

- 16px 高渐变矩形条，宽 = `PANORAMA_WIDTH`
- 从上一 stage 色到下一 stage 色（沿用 `STAGE_TRANSITION_GRADIENTS`）
- `draggable: false`, `selectable: false`, `deletable: false`，`z-index: -2`

### 6.5 PanoramaEdge

**（来自 `reactflow-edges/panorama-edge.tsx`）**

自定义 ReactFlow Edge，根据连线方向自动切换 path 策略：

| 连线类型 | 画法 |
|----------|------|
| 水平连线（Right↔Left） | ReactFlow `getSmoothStepPath` 平滑阶梯路径 |
| 垂直连线（Bottom↔Top，Worker→Critic） | ReactFlow `getStraightPath` 直线路径 |
| 跨 lane edge | 同样使用 `getSmoothStepPath`，ReactFlow 自动路由 |

Edge 根据源节点 stage_id 确定颜色（`getStageColor(laneIndex).lineClass`），来自 `data.stageColorIndex`，fallback 从 `sourceY` 推导。

**视觉参数：** `strokeWidth={1.5}`, `opacity="0.35"`, 颜色继承所属 stage 色系，选中态 `drop-shadow` 高亮，critic 分支 `strokeDasharray="4 3"`，通过 `markerEnd` 配置箭头。

### 6.6 CanvasStageLabels

**（来自 `canvas-stage-labels.tsx`）**

- `absolute left-0 top-0 z-10 w-40 pointer-events-none`，在 ReactFlow 外侧
- 通过 `style={{ transform: 'translateY(viewportY)' }}` 与画布滚动同步
- 每行是一个统一卡片：`rounded-lg border border-border/70 bg-background/95 shadow-sm backdrop-blur`，左侧 3px 色条（`border-l-[3px]`）
- 内容：`Stage {sort_order+1}`（`text-[10px] font-semibold text-muted-foreground`）+ stage 名称（`text-xs font-semibold truncate`）+ stage 描述（可选，`text-[10px] text-muted-foreground truncate`）
- 操作按钮：右上角 2×2 网格（`opacity-0 group-hover:opacity-100`）：✏️ 编辑、🗑️ 删除、↑ 上移、↓ 下移
- 底部左侧 GripVertical 拖拽手柄（仅视觉提示，当前排序通过上下按钮）
- 点击卡片整体 → 打开 StageCreateDialog 编辑
- 首/末 stage 的 ↑/↓ 按钮自动 disabled
- 未分组 lane 不显示标签

### 6.7 顶部工具栏（内联在 PageHeader）

工具栏直接内联在 `WorkflowPanoramaPage` 的 `<PageHeader>` 中，**不独立为单独组件**（原计划 `panorama-toolbar.tsx` 已删除）：

| 元素 | 行为 | 快捷键/备注 |
|------|------|--------|
| ← Back 按钮 | `navigation.push(wsPaths.workflows())` | — |
| Workflow 标题 | 点击进入内联编辑 `<input>`，Enter/Blur 保存，Escape 取消 | — |
| Status Badge | 显示 `active`/`paused`/`draft` 状态 | — |
| ↩ Undo | `store.undo()` | `Ctrl+Z`，`canUndo` 控制 disabled |
| ↪ Redo | `store.redo()` | `Ctrl+Shift+Z`，`canRedo` 控制 disabled |
| 📐 Auto Layout | `computeLaneAutoLayout` → 批量 `updateNode(position_x)` | — |
| ➕ Add node | Popover 展示 5 个形状图标，可拖拽到画布或点击放置在视口中心 | 拖拽结束/点击后 Popover 关闭 |
| Activate/Deactivate | `updateWorkflow({ status })`，toggle `active` ↔ `paused` | toast 通知 |
| 🎨 Color Mode | 切换 `canvasColorMode`: system → light → dark | — |
| 🗑 Delete Workflow | AlertDialog 确认 → `deleteWorkflow` → 导航到 workflows 列表 | — |

**注：没有独立 Save 按钮。** 属性编辑通过 store `nodeEdits` + 500ms debounce 自动保存。

## 7. 数据流与状态管理

### 7.1 查询层

```typescript
const { data: workflow } = useQuery(workflowDetailOptions(wsId, workflowId));
const { data: stages } = useQuery(workflowStagesOptions(wsId, workflowId));
const { data: nodes } = useQuery(workflowNodesOptions(wsId, workflowId));
const { data: edges } = useQuery(workflowEdgesOptions(wsId, workflowId));
const { data: agents } = useQuery(agentListOptions(wsId));
const { data: plugins } = useQuery(builtinPluginListOptions());
```

Mutations 复用现有（`useCreateNode`, `useUpdateNode`, `useDeleteNode`, `useCreateEdge`, `useDeleteEdge`, `useCreateStage`, `useUpdateStage`, `useDeleteStage`, `useReorderStages`, `useAssignNodeToStage`）。

### 7.2 Zustand Store

复用 `useWorkflowEditorStore`（`packages/core/workflows/store.ts`）的选择状态、编辑缓存、annotation 开关和颜色模式：

```typescript
store.selectedNodeId        // 当前选中 → 驱动属性面板
store.selectedNodeIds       // 多选列表
store.nodeEdits             // 编辑缓存 → 属性面板修改暂存
store.deletedNodeIds        // 删除缓存
store.undoStack / redoStack // 撤销/重做
store.showAnnotations       // 便签开关
store.canvasColorMode       // 画布颜色模式
```

以下字段保留在 store 中但不被全景图使用：`mode`（不再有 view/edit/connect 模式）、`pendingEdgeSource`（连线从 Handle 拖拽，不需先点源再点目标）。

当前 store 的 undo/redo 只可靠覆盖本地 `nodeEdits` / `deletedNodeIds` 快照，以及已有的 `create-node`、`create-edge`、`delete-edge` server action。新全景图如果让位置、stage assignment、节点删除、stage CRUD 即时提交，就必须同步扩展 `TrackedAction` 和反向 mutation；否则这些操作不展示可撤销承诺。

### 7.3 保存语义

| 操作 | 提交时机 | 原因 |
|------|---------|------|
| 节点拖拽松手 | 即时 `updateNode(position_x)` | 位置已是精确意图；若支持撤销，记录旧 `position_x` |
| 跨 lane 拖拽松手 | 即时 `assignNodeToStage(stage_id)` | 明确的结构变更；若支持撤销，记录旧 `stage_id` |
| 连线创建 | 即时 `createEdge(source, target)` | 拖拽松手已是确认；记录 create-edge server action |
| 连线删除 | 即时 `deleteEdge(edgeId)` | 选中+Delete 已是确认；记录 delete-edge server action |
| 节点删除 | 即时 `deleteNode(nodeId)` | 直接调用 mutation，关闭属性面板 |
| 属性编辑 | 输入写入 `store.nodeEdits`，**500ms debounce 后自动 `updateNode`** | 文本编辑渐进式，无需手动保存按钮 |
| Stage CRUD | 即时，有确认弹窗；如展示撤销必须记录反向 mutation | 明确的结构变更 |
| 标题编辑 | Enter/Blur 即时 `updateWorkflow({ title })` | 简单文本，无批量需求 |
| Workflow 状态切换 | 即时 `updateWorkflow({ status })` | toggle 操作 |

属性编辑通过 `useEffect` 监听 `nodeEdits` 变化：当 `nodeEdits` 非空时，启动 500ms debounce timer，超时后批量调用 `updateNodeMutation.mutateAsync` 并 `clearNodeEdits`。新编辑重置 timer。autosave 失败时保留缓存编辑以便下次渲染重试。

### 7.4 节点数据转换（API → ReactFlow）

```typescript
function apiNodesToReactFlowNodes(
  nodes: WorkflowNode[],
  stages: WorkflowStage[],
  agentLookup: Map<string, Agent | null>,
  pluginLookup: Map<string, BuiltinPlugin | null>,
  getActorName: (type: string, id: string) => string | null,
): Node[] {
  const stageMap = new Map(stages.map((s) => [s.id, s]));

  return nodes.flatMap((node) => {
    const stage = node.stage_id ? stageMap.get(node.stage_id) : undefined;
    const sortOrder = stage?.sort_order ?? stages.length;
    const laneY = stage ? computeLaneY(stage.sort_order) : UNASSIGNED_LANE_Y(stages.length);
    const x = node.position_x ?? 100;
    const stageColorIndex = getStageColorIndex(sortOrder);

    const workerNode: Node = {
      id: node.id,
      type: "compactWorker",
      position: { x, y: laneY },
      width: WORKER_WIDTH, height: WORKER_HEIGHT,
      data: { node, stage_id: node.stage_id, stageColorIndex, pluginName, workerName },
    };

    if (!node.critic_id && !node.critic_api_url) return [workerNode];

    // Critic badge centered below worker
    const criticNode: Node = {
      id: `${node.id}:critic`,
      type: "criticBadge",
      position: {
        x: x + (WORKER_WIDTH - CRITIC_WIDTH) / 2,
        y: laneY + WORKER_HEIGHT + WORKER_CRITIC_GAP,
      },
      width: CRITIC_WIDTH, height: CRITIC_HEIGHT,
      data: { node, parentNodeId: node.id, criticName },
    };

    return [workerNode, criticNode];
  });
}
```

**背景节点构建**（`buildBackgroundNodes`）：遍历排序后的 stages，为每个 stage 生成 `laneBg` 节点（`zIndex: -2`）和 `gradientBg` 节点（末 stage 后不生成）。

**Edge 数据转换**（`apiEdgesToReactFlowEdges`）：
- 工作流边 → `type: "panorama"`，根据源/目标位置自动选择 `sourceHandle`/`targetHandle`（dx > dy → Right→Left，否则 Bottom→Left）
- Critic 边 → `source: node.id → target: ${node.id}:critic`，`selectable: false, deletable: false`
- markerEnd 颜色继承源节点 stage 色系

## 8. 间距与视觉常量

| 常量 | 值 | 说明 |
|------|-----|------|
| `LANE_HEIGHT` | 160px | 单条 lane 背景高度 |
| `GRADIENT_HEIGHT` | 16px | lane 间渐变过渡带 |
| `LANE_STEP` | 176px | lane 间距 = LANE_HEIGHT + GRADIENT_HEIGHT |
| `LANE_PADDING_TOP` | 12px | 节点在 lane 内上边距 |
| `PANORAMA_WIDTH` | 2400px | 画布固定宽度 |
| `UNASSIGNED_LANE_Y` | `stages.length * LANE_STEP + 16` | 未分组 lane y 起点（函数） |
| `computeLaneY(sortOrder)` | `sortOrder * LANE_STEP + LANE_PADDING_TOP` | 节点在 lane 内的实际 y 偏移（函数） |
| `WORKER_WIDTH` | 224px | Worker 节点宽度 |
| `WORKER_HEIGHT` | 64px | Worker 节点高度 |
| `CRITIC_WIDTH` | 144px | Critic 节点宽度 |
| `CRITIC_HEIGHT` | 48px | Critic 节点高度 |
| `WORKER_CRITIC_GAP` | 20px | Worker 底部到 Critic 顶部的间距 |

色系常量从新的 `STAGE_COLOR_PALETTE` 统一导出：

```typescript
export const STAGE_COLOR_PALETTE = [
  { bgClass, lineClass, barClass, markerColor }, // 6 色：slate, stone, blue, rose, violet, amber
];
export function getStageColor(index): palette entry;  // 循环取色
export function getStageColorIndex(index): number;     // 取色索引
export const STAGE_BG_COLORS = palette.map(c => c.bgClass);
export const STAGE_LINE_COLORS = palette.map(c => c.lineClass);
export const STAGE_TRANSITION_GRADIENTS = [/* 6 个渐变 */];
```

## 9. 拖拽约束与跨 lane 交互

### 9.1 节点拖拽

```typescript
function handleNodeDrag(event, node) {
  const stage = stages.find(s => s.id === node.data.stage_id);
  const laneTop = stage ? stage.sort_order * LANE_STEP : UNASSIGNED_LANE_Y;
  const laneBottom = laneTop + LANE_HEIGHT;

  // y 约束到所属 stage lane 范围
  node.position.y = clamp(node.position.y, laneTop + 4, laneBottom - 4);

  // 越界进入相邻 lane → 切换 stage
  const newStage = findStageAtY(node.position.y);
  if (newStage && newStage.id !== node.data.stage_id) {
    node.data.stage_id = newStage.id;
  }
}
```

视觉反馈：目标 lane 背景短暂高亮（`bg-primary/10`），松手后节点归位到目标 lane 标准 y。

### 9.2 连线创建

- 同 lane 节点 → 允许
- 跨 lane 节点 → 允许（后端已放宽）
- Worker → Critic → 仅允许同节点内

### 9.3 工具栏形状创建

形状创建入口为顶部工具栏的 "+ Add node" Popover 按钮：

- 点击按钮展开 Popover，显示 5 个形状图标（Rectangle / Diamond / Pill / Hexagon / Critic）
- **拖拽**：从 Popover 拖拽图标到 lane 上方 → 高亮目标 lane → 松手创建在该 stage 内
- **点击**：点击形状图标（不拖拽）→ 在视口中心位置创建节点
- `onDrop` 从 y 坐标反查 lane，调用 `createNode` mutation
- 拖拽结束后 Popover 自动关闭
- Critic 拖入：需先选中 Worker 节点，拖入的 Critic 关联到该 Worker 下方；未选中时创建独立 Critic 节点（置于未分组 lane）

## 10. 节点拖动与 stage 联动

| 行为 | 结果 |
|------|------|
| 修改 stage（属性面板下拉） | 调 `computeStageTransferPositionX` 找目标 lane 空位 → 即时 `updateNode(position_x)` + `assignNodeToStage(stage_id)` |
| 移动节点到其他 lane | 拖拽松手通过 `findStageAtY` 检测新 stage → 即时 `assignNodeToStage` |
| 拖拽 stage 排序 | 该 stage 下所有节点 y 整体移动（通过 `sort_order` 变化自动反映） |
| Stage 删除 | 所有节点归入未分组 lane（`ON DELETE SET NULL`） |

**`computeStageTransferPositionX`**（`layout.ts`）：将节点移到目标 stage 时，从 `LANE_START_X = 120` 开始按 `LANE_SLOT_STEP = WORKER_WIDTH + 96 = 320` 步进，跳过已被占用的 x 位置，选第一个空槽。

## 11. 边界情况

| 场景 | 处理 |
|------|------|
| Workflow 无 stage | 画布居中显示"尚未定义阶段" + 创建引导按钮 |
| Stage 无节点 | 空 lane 背景 + 淡色文字 "No plugins in this stage" |
| 旧节点（stage_id = NULL） | 置于画布最底部"未分组"虚拟 lane（灰色调） |
| Stage 内 >6 节点 | canvas `overflow-x: auto` |
| >8 stage | canvas `overflow-y: auto` |
| 拖到 lane 间隙松手 | 归属到最近的 lane |
| 从 Popover 拖到 lane 间隙 | 归属到最近的 lane |
| 缩放过小（<0.4x） | Handle 隐藏 |
| Autosave 失败 | 编辑保留在 store `nodeEdits` 中，下次渲染重试 |
| 跨 stage 无 edge | 不画隐含连线 |
| 删除含节点的 stage | 确认弹窗 window.confirm → deleteStage mutation（DB ON DELETE SET NULL） |

## 12. i18n

关键新增/使用 key（命名空间 `workflows`，在 `2026-06-25` 基础上扩展）：

```json
{
  "panorama": {
    "empty_all": "Create your first stage to get started",
    "unassigned": "Unassigned",
    "toolbar": {
      "undo": "Undo",
      "redo": "Redo",
      "auto_layout": "Auto layout"
    }
  },
  "detail": {
    "back_to_workflows": "Back to Workflows",
    "click_to_rename": "Click to rename",
    "activate": "Activate",
    "deactivate": "Deactivate",
    "canvas_theme_system": "System theme",
    "canvas_theme_light": "Light theme",
    "canvas_theme_dark": "Dark theme",
    "delete": "Delete",
    "delete_dialog": {
      "title": "Delete Workflow",
      "description": "Are you sure you want to delete \"{title}\"?",
      "cancel": "Cancel",
      "confirm": "Delete"
    },
    "toast_activated": "Workflow activated",
    "toast_deactivated": "Workflow deactivated",
    "toast_deleted": "Workflow deleted",
    "toast_delete_failed": "Failed to delete workflow",
    "toast_activate_failed": "Failed to update workflow status"
  },
  "status": {
    "active": "Active",
    "paused": "Paused",
    "draft": "Draft"
  },
  "node": {
    "stage_label": "Stage",
    "stage_create_option": "Create new stage...",
    "stage_create_name_placeholder": "Stage name",
    "stage_create_description_placeholder": "Description (optional)",
    "toast_deleted": "Node deleted",
    "toast_delete_failed": "Failed to delete node"
  }
}
```

不再使用 `panorama.toolbar.save` / `panorama.toolbar.unsaved` / `panorama.toolbar.annotations`（无独立 Save 按钮和便签开关）。

## 13. 测试

### Go 后端

- 保留并运行现有 `TestCrossStageEdge_Allowed`，验证跨 stage 边可以成功创建。
- 不新增 `UpdateWorkflowEdge` 测试；当前后端没有该 handler。

### 前端

**新组件测试（`packages/views/workflows/components/overview/`）：**

- `workflow-panorama-page.test.tsx`：ReactFlow 渲染、lane 背景、stage labels、节点列表、工具栏按钮、工作流管理操作（activate/deactivate/delete）、autosave 行为、Shape popover 拖拽/点击创建、Stage CRUD 交互
- `compact-worker-node.test.tsx`：渲染、尺寸、handle 显隐、点击
- `critic-badge-node.test.tsx`：渲染、虚线边框、handle
- `lane-bg-node.test.tsx`：背景渲染、色系循环、不可交互
- `gradient-bg-node.test.tsx`：渐变渲染、不可交互
- `panorama-edge.test.tsx`：SmoothStep 路径、Straight 路径（垂直连线）、视觉参数、选中态、stageColorIndex 优先级
- `canvas-stage-labels.test.tsx`：卡片渲染、操作按钮（编辑/删除/上下移）、拖拽手柄
- `node-config-panel` 适配测试：stage 下拉即时提交、内联创建 stage、"Create new" 选项、删除确认

**布局测试（`packages/views/workflows/components/`）：**

- `layout.test.ts`：`computeLaneAutoLayout`（lane 内节点水平分布）、`computeStageTransferPositionX`（跨 stage 空位选择）
- `dag-canvas.test.tsx`：保留旧编辑器 DAG 测试（编辑器组件仍被其他 flow 使用）

**路由入口测试：** Web `/workflows/[id]` 和 Desktop `workflows/:id` 渲染新合并视图。

**移除的测试：**
- `panorama-toolbar.test.tsx` — 对应组件已删除（工具栏内联到 PageHeader）
- `node-palette.tsx` 相关测试 — 对应组件已删除

## 14. 实现次序（4 Phase）

### Phase 1 — 新建 ReactFlow 节点 & 边（无破坏性）✅

1. `reactflow-nodes/lane-bg-node.tsx` + 测试
2. `reactflow-nodes/gradient-bg-node.tsx` + 测试
3. `reactflow-nodes/compact-worker-node.tsx` + 测试
4. `reactflow-nodes/critic-badge-node.tsx` + 测试
5. `reactflow-edges/panorama-edge.tsx` + 测试
6. `constants.ts` 统一色系常量和布局参数

### Phase 2 — 布局、保存/撤销语义 & 外围 ✅

7. `canvas-stage-labels.tsx` + 测试（卡片式 + 2×2 操作按钮）
8. 适配 `layout.ts`：新增 `computeLaneAutoLayout`、`computeStageTransferPositionX`
9. 适配 `node-config-panel.tsx`：新增 `onDeleteNode`、`onStageChange` props，stage assignment 即时提交，内联 "Create new" 表单
10. Autosave 机制：`useEffect` 监听 `nodeEdits` → 500ms debounce → 批量 `updateNode`
11. 工具栏功能内联到 PageHeader（不含独立 `panorama-toolbar.tsx`）

### Phase 3 — 路由 & 清理 ✅

12. 重写 `workflow-panorama-page.tsx`（ReactFlow 整合 + 数据转换 + 交互约束 + autosave + 内联 PageHeader 工具栏 + ReactFlowProvider 包装 + PanoramaContent 内部组件）
13. Web 路由：`/workflows/[id]` 指向新全景图，默认保留 `/overview` redirect
14. Desktop 路由 `workflows/:id` 同步更新
15. 删除 `node-palette.tsx`、`panorama-toolbar.tsx` 及其测试
16. 更新 `overview/index.ts` 导出新组件和常量

### Phase 4 — 依赖迁移 & 验证

17. 用 `rg` 确认旧文件引用；只删除无剩余引用文件
18. `stage-lane.tsx` / `panorama-svg-overlay.tsx` 若仍被 issue execution panorama 使用，则保留并标注为 runtime panorama 组件
19. 运行前端组件测试、现有 Go 跨 stage edge 测试，并更新 E2E 覆盖新入口

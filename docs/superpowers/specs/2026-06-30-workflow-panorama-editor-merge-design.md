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
| 节点创建 | 从 NodePalette 拖拽到画布 |
| 属性编辑 | 右侧滑出 NodeConfigPanel |
| 保存策略 | 位置/连线/stage assignment 即时提交；文本属性手动批量保存 |
| 撤销策略 | 当前 store 只支持本地编辑快照和少量 server action；即时提交操作必须补齐 server-backed undo，否则不承诺撤销 |
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
LANE_STEP = LANE_HEIGHT + GRADIENT_HEIGHT = 128px + 8px = 136px
LANE_HEIGHT = 128px
GRADIENT_HEIGHT = 8px
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
│   └── panorama-edge.tsx                       ← 新增：正交连线 Edge（含 path 策略）
│
├── panorama-toolbar.tsx                        ← 新增：顶部工具栏
├── canvas-stage-labels.tsx                     ← 新增：画布左侧固定 stage 标签
├── workflow-panorama-page.tsx                  ← 重写：ReactFlow 泳道画布主页面
│
└── *.test.tsx                                  ← 新增：各组件测试
```

### 4.2 复用文件（不修改或微调）

| 文件 | 使用方式 |
|------|---------|
| `node-config-panel.tsx` | 适配复用：拆出或新增 props 控制 stage assignment、delete、save 行为，避免绕过统一保存/撤销语义 |
| `node-palette.tsx` | 适配复用（增加 Critic 拖拽项和 lane drop 语义） |
| `stage-create-dialog.tsx` | 直接复用，不修改 |
| `alignment-snap.ts` | 直接复用，不修改 |
| `layout.ts` | 适配（dagre 改为 lane 内水平排列） |
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
│  GradientBgNode (8px 渐变条)              ← z-index: -2           │
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
├── PanoramaToolbar                                ← 顶部工具栏
│   ├── UndoButton (Ctrl+Z) / RedoButton (Ctrl+Shift+Z)
│   ├── Separator
│   ├── AutoLayoutButton (dagre lane 内排列)
│   ├── AnnotationToggle (便签开关)
│   ├── Spacer
│   ├── ZoomOutButton / ZoomPercentage / ZoomInButton
│   └── SaveButton (带未保存标记)
│
├── canvas-container (flex, flex-1, relative)     ← 主内容区
│   │
│   ├── NodePalette (侧边栏, 可折叠)               ← 复用 node-palette.tsx
│   │   └── DraggableShapeItem[] (Rectangle / Diamond / Pill / Hexagon / Critic)
│   │
│   ├── CanvasStageLabels (absolute, left-0)      ← 新增：固定左侧标签
│   │   └── StageLabel[]                           ← useOnViewportChange 同步 y
│   │       ├── "Stage N" / "阶段名称"             ← text-[10px] + text-xs
│   │       ├── [✏️] [🗑️] [↑] [↓]  行内操作
│   │       └── 拖拽手柄 (调整 stage 排序)
│   │
│   ├── ReactFlow (flex-1)                        ← 核心画布
│   │   ├── <Background />
│   │   ├── <Controls />
│   │   ├── <MiniMap />
│   │   ├── LaneBgNode[]                          ← nodeTypes.laneBg
│   │   ├── GradientBgNode[]                      ← nodeTypes.gradientBg
│   │   ├── CompactWorkerNode[]                    ← nodeTypes.compactWorker
│   │   ├── CriticBadgeNode[]                     ← nodeTypes.criticBadge
│   │   ├── PanoramaEdge[]                        ← edgeTypes.panorama
│   │   └── AlignmentGuides (吸附引导线 SVG)
│   │
│   └── NodeConfigPanel (右侧滑出, w-96)           ← 适配复用 node-config-panel.tsx
│       ├── 标题 / 描述编辑
│       ├── Stage 下拉选择器
│       ├── Worker 指派 (AssigneePicker)
│       ├── Critic 指派 (AssigneePicker + API URL)
│       ├── Format Schema JSON 编辑器
│       └── 删除按钮
│
└── StageCreateDialog (模态框)                     ← 复用 stage-create-dialog.tsx
```

### 5.3 编辑交互

画布**始终可编辑**，无浏览/编辑模式切换：

| 操作 | 触发 | 防误触 |
|------|------|--------|
| 移动节点 | 直接拖拽 | 超过 3px 才生效（ReactFlow 默认） |
| 创建连线 | 从 Handle 拖出 | Handle hover 才显示（`opacity-0` → `opacity-100`） |
| 删除节点/边 | `Backspace` / `Delete` | 需先选中；仅在补齐 server-backed undo 后显示撤销入口 |
| 多选/框选 | 空白区域拖拽 | ReactFlow `selectionOnDrag` |
| 打开属性面板 | 单击节点 | — |
| 取消选中 | 点击空白 / `Esc` | — |

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

- 8px 高渐变矩形条，宽 = `PANORAMA_WIDTH`
- 从上一 stage 色到下一 stage 色（沿用 `STAGE_TRANSITION_GRADIENTS`）
- `draggable: false`, `selectable: false`, `deletable: false`，`z-index: -2`

### 6.5 PanoramaEdge

**（来自 `reactflow-edges/panorama-edge.tsx`）**

自定义 ReactFlow Edge，根据源/目标是否同 stage 选择 path 策略：

| 连线类型 | 画法 |
|----------|------|
| 同 stage 内相邻节点 | 正交水平线：`M x1 y1 L midX y1 L midX y2 L x2 y2` |
| 同 stage 内非相邻（arc） | 上方绕行正交线：源右边缘 → 上方通道 → 目标左边缘 |
| 跨 stage edge | 正交通道线，多线自动错开（±18px） |
| Worker → Critic | 短直线：`M x1 y1 L x2 y2` |

**视觉参数：** `strokeWidth={1.5}`, `opacity="0.35"`, 颜色继承所属 stage 色系，critic 分支 `strokeDasharray="4 3"`，全部正交直线段（无贝塞尔）。

### 6.6 CanvasStageLabels

**（来自 `canvas-stage-labels.tsx`）**

- `absolute left-0`，在 ReactFlow 外侧
- 通过 `useOnViewportChange` 同步 y 偏移，与 lane 背景对齐
- 每行：`Stage {sort_order+1}`（`text-[10px]`）+ stage 名称（`text-xs font-semibold`）
- 行内操作：✏️ 编辑、🗑️ 删除（确认弹窗）、↑↓ 排序
- 拖拽手柄调整 stage 排序
- 未分组标签：画布底部灰色特殊标签

### 6.7 PanoramaToolbar

**（来自 `panorama-toolbar.tsx`）**

| 按钮 | 行为 | 快捷键 |
|------|------|--------|
| ↩ Undo | `store.undo()` | `Ctrl+Z` |
| ↪ Redo | `store.redo()` | `Ctrl+Shift+Z` |
| 📐 Auto Layout | dagre 重算 lane 内节点 `position_x` | — |
| 💬 便签开关 | 切换 `store.showAnnotations` | — |
| 🔍−/+ 缩放 | ReactFlow zoomIn/zoomOut | — |
| 百分比 | `useOnViewportChange` 实时显示 | — |
| 💾 保存 | 批量提交 `nodeEdits` + `deletedNodeIds` | — |

未保存更改时保存按钮显示蓝点标记，切换页面弹出确认。

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
| 连线创建 | 即时 `createEdge(source, target)` | 拖拽松手已是确认；沿用已有 create-edge server action |
| 连线删除 | 即时 `deleteEdge(edgeId)` | 选中+Delete 已是确认；沿用已有 delete-edge server action |
| 节点删除 | 两种策略择一：批量保存删除，或即时删除并实现 restore server action | 当前 store 不能恢复已从服务端删除的节点 |
| 属性编辑 | 点击「保存」批量提交 | 文本编辑渐进式 |
| Stage CRUD | 即时，有确认弹窗；如展示撤销必须记录反向 mutation | 明确的结构变更 |

默认实现建议：先只为已有 server action 显示 undo/redo；位置、stage assignment、节点删除、Stage CRUD 在未补齐反向 mutation 前不宣称可撤销。

### 7.4 节点数据转换（API → ReactFlow）

```typescript
function apiNodesToReactFlowNodes(
  nodes: WorkflowNode[],
  stages: WorkflowStage[]
): Node[] {
  return nodes.flatMap(node => {
    const stage = stages.find(s => s.id === node.stage_id);
    const laneY = stage
      ? stage.sort_order * LANE_STEP
      : UNASSIGNED_LANE_Y;
    const x = node.position_x ?? computeDefaultX(node, stage, nodes);
    const workerNode = {
      id: node.id,
      type: "compactWorker",
      position: { x, y: laneY + LANE_PADDING_TOP },
      data: { node, stage_id: node.stage_id },
    };

    if (!node.critic_id && !node.critic_api_url) return [workerNode];

    return [
      workerNode,
      {
        id: `${node.id}:critic`,
        type: "criticBadge",
        position: { x, y: laneY + LANE_PADDING_TOP + WORKER_HEIGHT + WORKER_CRITIC_GAP },
        data: { node, stage_id: node.stage_id, parent_node_id: node.id },
      },
    ];
  });
}
```

## 8. 间距与视觉常量

| 常量 | 值 | 说明 |
|------|-----|------|
| `LANE_HEIGHT` | 128px | 单条 lane 背景高度 |
| `GRADIENT_HEIGHT` | 8px | lane 间渐变过渡带 |
| `LANE_STEP` | 136px | lane 间距 = LANE_HEIGHT + GRADIENT_HEIGHT |
| `LANE_PADDING_TOP` | 12px | 节点在 lane 内上边距 |
| `PANORAMA_WIDTH` | 2400px | 画布固定宽度 |
| `UNASSIGNED_LANE_Y` | `stages.length * 136 + 16` | 未分组 lane y 起点 |
| Worker 节点 | 224×64px（`h-16 w-56`） | |
| Critic 节点 | 144×48px（`h-12 w-36`） | |
| Worker-Critic 间距 | 20px（`gap-5`） | |

色系常量沿用 `STAGE_BG_COLORS`、`STAGE_TRANSITION_GRADIENTS`、`STAGE_LINE_COLORS`（与 `2026-06-25` 文档一致）。

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

### 9.3 NodePalette 拖入

- 拖到 lane 上方 → 高亮目标 lane → 松手创建在该 stage 内
- `onDrop` 从 y 坐标反查 lane，调用 `createNode` mutation
- Critic 拖入：需先选中 Worker 节点，拖入的 Critic 关联到该 Worker 下方；未选中时创建独立 Critic 节点（置于未分组 lane）

## 10. 节点拖动与 stage 联动

| 行为 | 结果 |
|------|------|
| 修改 stage（属性面板下拉） | 节点位置自动变更到新 lane |
| 移动节点到其他 lane | `stage_id` 自动更新为新 stage |
| 拖拽 stage 排序 | 该 stage 下所有节点 y 整体移动 |
| Stage 删除 | 所有节点归入未分组 lane |

## 11. 边界情况

| 场景 | 处理 |
|------|------|
| Workflow 无 stage | 画布居中显示"尚未定义阶段" + 创建引导按钮 |
| Stage 无节点 | 空 lane 背景 + 淡色文字 "No plugins in this stage" |
| 旧节点（stage_id = NULL） | 置于画布最底部"未分组"虚拟 lane（灰色调） |
| Stage 内 >6 节点 | canvas `overflow-x: auto` |
| >8 stage | canvas `overflow-y: auto` |
| 拖到 lane 间隙松手 | 归属到最近的 lane |
| 从 palatte 拖到 lane 间隙 | 归属到最近的 lane |
| 缩放过小（<0.4x） | Handle 隐藏 |
| 未保存编辑离开 | 确认对话框 |
| 跨 stage 无 edge | 不画隐含连线 |
| 删除含节点的 stage | 确认弹窗 → 节点移入未分组（`ON DELETE SET NULL`） |

## 12. i18n

关键新增 key（命名空间 `workflows`，在 `2026-06-25` 基础上扩展）：

```json
{
  "panorama": {
    "empty_all": "Create your first stage to get started",
    "unassigned": "Unassigned",
    "toolbar": {
      "undo": "Undo",
      "redo": "Redo",
      "auto_layout": "Auto layout",
      "annotations": "Toggle annotations",
      "save": "Save changes",
      "unsaved": "Unsaved changes"
    }
  }
}
```

## 13. 测试

### Go 后端

- 保留并运行现有 `TestCrossStageEdge_Allowed`，验证跨 stage 边可以成功创建。
- 不新增 `UpdateWorkflowEdge` 测试；当前后端没有该 handler。

### 前端

**新组件测试（`packages/views/workflows/components/overview/`）：**

- `workflow-panorama-page.test.tsx`：ReactFlow 渲染、lane 背景、stage labels、节点列表
- `compact-worker-node.test.tsx`：渲染、尺寸、handle 显隐、点击
- `critic-badge-node.test.tsx`：渲染、虚线边框、handle
- `lane-bg-node.test.tsx`：背景渲染、色系循环、不可交互
- `panorama-edge.test.tsx`：同 lane 路径、跨 lane 路径、critic 路径、视觉参数
- `panorama-toolbar.test.tsx`：按钮功能、快捷键
- `canvas-stage-labels.test.tsx`：labels、行内操作、拖拽排序
- `node-config-panel` 适配测试：stage 下拉、删除、保存行为不会绕过新全景图的保存/撤销策略
- 路由入口测试：Web `/workflows/[id]` 和 Desktop `workflows/:id` 渲染新合并视图；Web `/overview` redirect 如保留则继续测试 redirect

**移除的旧测试：** 仅删除对应组件已经无引用、且不再服务 issue execution panorama 的测试。`stage-lane.test.tsx`、`panorama-svg-overlay.test.tsx` 在 issue execution panorama 迁移前必须保留或改名为 runtime panorama 测试。

## 14. 实现次序（4 Phase）

### Phase 1 — 新建 ReactFlow 节点 & 边（无破坏性）

1. `reactflow-nodes/lane-bg-node.tsx` + 测试
2. `reactflow-nodes/gradient-bg-node.tsx` + 测试
3. `reactflow-nodes/compact-worker-node.tsx` + 测试
4. `reactflow-nodes/critic-badge-node.tsx` + 测试
5. `reactflow-edges/panorama-edge.tsx` + 测试

### Phase 2 — 保存/撤销语义 & 外围

6. `panorama-toolbar.tsx` + 测试
7. `canvas-stage-labels.tsx` + 测试
8. 适配 `node-config-panel.tsx`，明确 stage assignment、delete、save 由新全景图统一控制
9. 如需即时操作可撤销，扩展 `packages/core/workflows/store.ts` 的 `TrackedAction` 并实现反向 mutations；否则 UI 不显示这些操作的撤销承诺
10. 适配 `layout.ts`（dagre 改为 lane 内水平排列）

### Phase 3 — 路由 & 清理

11. 重写 `workflow-panorama-page.tsx`（ReactFlow 整合 + 数据转换 + 交互约束 + 保存逻辑）
12. Web 路由：`/workflows/[id]` 指向新全景图，默认保留 `/overview` redirect
13. Desktop 路由 `workflows/:id` 同步更新
14. 移除视图切换 store 和独立编辑器入口，清理导出

### Phase 4 — 依赖迁移 & 验证

15. 用 `rg` 确认旧文件引用；只删除无剩余引用文件
16. `stage-lane.tsx` / `panorama-svg-overlay.tsx` 若仍被 issue execution panorama 使用，则保留并标注为 runtime panorama 组件
17. 运行前端组件测试、现有 Go 跨 stage edge 测试，并更新 E2E 覆盖新入口

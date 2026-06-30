# Workflow 阶段全景图设计（v2 — 全景图合并编辑器）

## 1. 概述

Multica Workflow 系统具备底层编排能力：节点（`workflow_node`）、边（`workflow_edge`）、阶段（`workflow_stage`）、执行（`workflow_run`）。

本设计将「编辑器视图」的全部编辑能力合并入「全景图」，使全景图成为 **展示 + 编辑** 的统一视图。合并后移除独立的编辑器视图，`/workflows/[id]` 只有一个视图。

核心技术路线：**全景图底层切换为 ReactFlow**，在 ReactFlow 内实现泳道布局，直接继承 ReactFlow 全部编辑能力（拖拽、连线、删除、多选、缩放、吸附对齐等），不再维护独立的 div+SVG overlay 渲染路径。

### 关键决策汇总

| 维度 | 决策 |
|------|------|
| 最终形态 | 全景图完全取代编辑器，移除独立编辑器视图和视图切换 |
| 渲染引擎 | ReactFlow 一体化（方案 A） |
| 坐标模型 | x 自由 + y 由 stage 推导（方案 C） |
| 节点排列 | lane 内自由水平拖动 |
| 连线创建 | 从节点 Handle 拖拽连线 |
| 节点创建 | 从面板拖拽到画布 |
| 属性编辑 | 右侧滑出 NodeConfigPanel |
| 保存机制 | 拖拽/连线即时提交，属性编辑手动批量保存 |
| 连线约束 | 放开跨 stage 边限制（后端同步放宽） |
| 实现策略 | 新建组件，完成后移除旧组件 |

## 2. 数据模型

### 2.1 `multica_workflow_stage` 表（不变）

```sql
CREATE TABLE multica_workflow_stage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES multica_workflow(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflow_stage_workflow_id ON multica_workflow_stage(workflow_id);
CREATE INDEX idx_workflow_stage_sort_order ON multica_workflow_stage(workflow_id, sort_order);
```

### 2.2 `multica_workflow_node` 扩展（不变）

```sql
ALTER TABLE multica_workflow_node
ADD COLUMN stage_id UUID REFERENCES multica_workflow_stage(id) ON DELETE SET NULL;

CREATE INDEX idx_workflow_node_stage_id ON multica_workflow_node(stage_id);
```

### 2.3 约束规则（调整）

- ~~边只在阶段内部连接节点（intra-stage DAG）~~ → **跨 stage 边允许**。后端 `CreateWorkflowEdge` / `UpdateWorkflowEdge` 校验移除 stage 一致性检查。
- `stage.sort_order` 决定阶段的宏观顺序（lane 从上到下的排列）。
- 一个 stage 包含零到多个 node；一个 node 属于零或一个 stage。
- 阶段间数据流是隐式的：前一阶段所有终点节点的输出自动成为下一阶段起点节点的输入。

### 2.4 坐标模型

```
position_x   →  DB 存储，自由拖动（lane 内水平定位）
stage_id     →  唯一的 y 坐标来源（lane 位置由 stage.sort_order 决定）
position_y   →  不存储到 DB，运行时根据 stage_id 计算
```

**运行时 y 坐标计算：**

```
node.y = stage.sort_order * LANE_STEP + LANE_PADDING_TOP
LANE_STEP = LANE_HEIGHT + GRADIENT_HEIGHT
LANE_HEIGHT = 128px
GRADIENT_HEIGHT = 8px
LANE_PADDING_TOP = 12px
```

| 操作 | 效果 |
|------|------|
| 水平拖动节点 | `position_x` 更新并立即持久化 |
| 垂直拖动到相邻 lane | `stage_id` 自动切换为新 stage，立即调 `assignNodeToStage` |
| 拖拽 stage 排序 | 该 stage 下所有节点 y 整体移动，`position_x` 不变 |
| 属性面板切换 stage 下拉 | 节点 y 自动归位到新 lane |
| Auto-layout | 仅重算 `position_x`（lane 内等距分布） |

### 2.5 TypeScript 类型（不变）

```typescript
// packages/core/types/workflow.ts
export interface WorkflowStage {
  id: string;
  workflowId: string;
  name: string;
  description: string;
  sortOrder: number;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
}

// WorkflowNode 新增可选字段:
// stageId?: string | null;
```

## 3. API 设计（不变，除边校验放宽）

### 3.1 Stage CRUD

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/workflows/{id}/stages` | 创建 stage |
| `PUT` | `/api/workflows/{id}/stages/{stageId}` | 更新 stage（name, description） |
| `DELETE` | `/api/workflows/{id}/stages/{stageId}` | 删除 stage（节点 → NULL） |
| `PUT` | `/api/workflows/{id}/stages/reorder` | 批量更新 `sort_order` |
| `PUT` | `/api/workflows/{id}/nodes/{nodeId}/stage` | 将节点分配到 stage（或移除） |

### 3.2 边校验（调整）

`CreateWorkflowEdge` / `UpdateWorkflowEdge` 移除 `source_node_id` 和 `target_node_id` 必须属于同一 `stage_id` 的校验。跨 stage 边直接允许。

## 4. 路由与文件结构

### 4.1 路由（简化）

`/workflows/[id]` 是唯一视图，不再有 `/editor` 或 `/overview` 子路由。

| 路由 | 说明 |
|------|------|
| `/workflows/[id]` | 全景图（唯一视图，展示+编辑） |
| `/workflows/[id]/runs` | 运行历史（不变） |
| `/workflows/[id]/runs/[runId]` | 运行详情（不变） |

### 4.2 文件结构

```
packages/views/workflows/components/overview/
├── index.ts                                    ← 统一导出
├── workflow-panorama-page.tsx                  ← 重写：ReactFlow 泳道画布主页面
├── panorama-toolbar.tsx                        ← 新增：顶部工具栏
├── canvas-stage-labels.tsx                     ← 新增：画布左侧固定 stage 标签
│
├── reactflow-nodes/
│   ├── index.ts                                ← 新增：自定义节点导出
│   ├── compact-worker-node.tsx                 ← 新增：紧凑 Worker ReactFlow 节点
│   ├── critic-badge-node.tsx                   ← 新增：Critic ReactFlow 节点
│   ├── lane-bg-node.tsx                        ← 新增：Lane 背景 ReactFlow 节点
│   └── gradient-bg-node.tsx                    ← 新增：渐变过渡带背景节点
│
├── reactflow-edges/
│   ├── index.ts                                ← 新增：自定义边导出
│   └── panorama-edge.tsx                       ← 新增：全景图自定义 Edge（含 path 策略）
│
├── *.test.tsx                                  ← 各组件测试

# 以下文件在实现完成后移除：
#   workflow-overview-page.tsx, stage-canvas.tsx, stage-card.tsx,
#   stage-node-dag.tsx, node-detail-panel.tsx, compact-node-card.tsx,
#   critic-badge.tsx, panorama-svg-overlay.tsx, architecture-detail-panel.tsx,
#   stage-lane.tsx

packages/views/workflows/components/
├── workflow-detail-page.tsx                    ← 移除（编辑器页面）
├── workflow-detail-shell.tsx                   ← 移除（视图切换外壳）
├── dag-canvas.tsx                              ← 移除（ReactFlow 逻辑整合进 panorama page）
├── reactflow-nodes.tsx                         ← 移除（被 reactflow-nodes/ 取代）
│
├── node-config-panel.tsx                       ← 复用（不修改）
├── node-palette.tsx                            ← 适配后复用
├── stage-create-dialog.tsx                     ← 复用（不修改）
├── alignment-snap.ts                           ← 复用（不修改）
├── layout.ts                                   ← 适配（dagre 改为 lane 内水平排列）
│
├── node-run-card.tsx                           ← 保留（运行视图用）
├── node-run-control-actions.tsx                ← 保留（运行视图用）
│
├── workflows-page.tsx                          ← 保留（列表页）
├── workflow-runs-page.tsx                      ← 保留
└── workflow-run-page.tsx                       ← 保留

packages/core/workflows/
├── store.ts                                    ← 复用（不修改）
├── queries.ts                                  ← 复用（不修改）
├── stores/
│   └── view-store.ts                           ← 移除（不再有视图切换）
```

## 5. 组件架构（ReactFlow 泳道布局）

### 5.1 泳道布局方案

泳道通过「背景层节点 + 节点 y 约束」实现，不引入多个 ReactFlow 实例。

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
└──────────────────────────────────────────────────────────────────┘
```

**画布固定宽度** `PANORAMA_WIDTH = 2400px`，避免 lane 背景不足。

### 5.2 组件树

```
WorkflowPanoramaPage                              ← 新入口
│
├── PanoramaToolbar                                ← 顶部工具栏
│   ├── UndoButton (Ctrl+Z)
│   ├── RedoButton (Ctrl+Shift+Z)
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
│   │   └── DraggableShapeItem[] (Rectangle/Diamond/Pill/Hexagon/Critic)
│   │
│   ├── CanvasStageLabels (absolute, left-0)      ← 新增：固定左侧标签
│   │   └── StageLabel[]                           ← 与画布 y 同步
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
│   │   └── AlignmentGuides (吸附引导线 SVG)       ← 复用 alignment-snap.ts
│   │
│   └── NodeConfigPanel (右侧滑出, w-96)           ← 复用 node-config-panel.tsx
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

画布**始终处于可编辑状态**，无浏览/编辑模式切换：

| 操作 | 触发方式 | 防误触 |
|------|---------|--------|
| 移动节点 | 直接拖拽 | 拖拽需超过 3px 才生效 |
| 创建连线 | 从 Handle 拖出 | Handle hover 才显示 |
| 删除节点/边 | `Backspace` / `Delete` | 需先选中 |
| 多选/框选 | 空白区域拖拽 | ReactFlow `selectionOnDrag` |
| 打开属性面板 | 单击节点 | 自然交互 |
| 取消选中 | 点击画布空白 / `Esc` | — |

## 6. 核心组件规范

### 6.1 ReactFlow 自定义节点类型

#### 6.1.1 CompactWorkerNode

**视觉（来自 `compact-worker-node.tsx`）：**
- 尺寸：224×64px（`h-16 w-56`）
- 圆角卡片（`rounded-lg`），白色背景，带边框（`border border-slate-300/90`）
- 阴影：`shadow-[0_1px_2px_rgba(15,23,42,0.08)]`
- 内边距：`p-2.5`，内容垂直排列（`flex flex-col gap-1.5`）
- 显示：插件名（truncated, `text-xs font-semibold`）、Agent 状态点（`h-1.5 w-1.5 rounded-full`）+ Agent 名称/类型（`text-[11px] text-muted-foreground`）
- hover：`-translate-y-0.5` 上移 + 边框变 `border-primary/45` + 加深阴影
- `data-testid="compact-worker-{id}"`

**Handle 配置：**
- 右侧（source）：同 lane 连线出口
- 左侧（target）：同 lane 连线入口
- 底部（critic source）：Worker → Critic 连线出口
- 所有 Handle 默认隐藏（`opacity-0`），hover 节点时显示（`opacity-100`）
- Handle 颜色继承所属 stage 色系

**选中态：**
```css
border-primary/55
bg-background
shadow-[inset_0_0_0_1px_rgba(59,130,246,0.08),0_2px_12px_rgba(15,23,42,0.06)]
```

#### 6.1.2 CriticBadgeNode

**视觉（来自 `critic-badge-node.tsx`）：**
- 尺寸：144×48px（`h-12 w-36`）
- 虚线边框（`border border-dashed border-border/70`），半透明背景（`bg-muted/30`）
- 内边距：`p-1.5`，圆角 `rounded-md`
- 顶部标签行：`ShieldAlert` 图标 + "Critic" 文字（`text-[10px] font-medium uppercase`）
- 底部名称行：truncated `text-xs font-semibold`
- `data-testid="critic-badge-{id}"`

**Handle 配置：**
- 顶部（target）：唯一 Handle，接收 Worker → Critic 连线

**间距：** Worker 节点底部到 Critic 顶部 = 20px（`gap-5`）

#### 6.1.3 LaneBgNode

**视觉（来自 `lane-bg-node.tsx`）：**
- 渲染为半透明色带矩形，宽 = `PANORAMA_WIDTH`，高 = `LANE_HEIGHT`
- 6 色循环：前两个 `/70` 不透明度，后四个 `/45`（来自现有 `STAGE_BG_COLORS`）
- `draggable: false`, `selectable: false`, `deletable: false`
- 无圆角、无阴影、无边框
- `z-index: -2`

#### 6.1.4 GradientBgNode

**视觉（来自 `gradient-bg-node.tsx`）：**
- 渲染为 8px 高的渐变矩形条
- 渐变从上一 stage 色到下一 stage 色（来自现有 `STAGE_TRANSITION_GRADIENTS`）
- `draggable: false`, `selectable: false`, `deletable: false`
- `z-index: -2`

### 6.2 PanoramaEdge（自定义 Edge）

**（来自 `panorama-edge.tsx`）**

根据源/目标是否同 stage，选择不同的 path 策略：

| 连线类型 | 画法 |
|----------|------|
| 同 stage 内相邻节点 | 正交水平线：`M x1 y1 L midX y1 L midX y2 L x2 y2` |
| 同 stage 内非相邻（arc） | 上方绕行正交线：从源右边缘 → 上方通道 → 目标左边缘 |
| 跨 stage edge | 正交通道线：`M x1 y1 L x1 channelY L channelX channelY L x2 channelY L x2 y2`，多线自动错开（±18px） |
| Worker → Critic | 短直线：`M x1 y1 L x2 y2` |

**视觉参数：**
- 线宽 `strokeWidth={1.5}`
- 颜色 `stroke="currentColor"`，透明度 `opacity="0.35"`，继承所属 stage 色系
- critic 分支线 `strokeDasharray="4 3"`
- 所有路径均为正交直线段（`L` 命令），无贝塞尔曲线

### 6.3 CanvasStageLabels

**（来自 `canvas-stage-labels.tsx`）**
- 绝对定位 `absolute left-0 top-0 bottom-0`，在 ReactFlow 外侧
- 通过 `useOnViewportChange` 同步 y 偏移，保持与 lane 背景对齐
- 每行两行垂直堆叠：上行 `Stage {sort_order+1}` 用 `text-[10px] font-medium uppercase`，下行 stage 名称用 `text-xs font-semibold`
- 行内操作按钮：✏️（编辑名称/描述）、🗑️（删除，含确认）、↑↓（排序调整）
- 拖拽手柄：可通过拖拽 label 调整 stage 排序
- 未分组节点标签：画布底部渲染特殊灰色标签，位于所有 lane 之后

### 6.4 PanoramaToolbar

**（来自 `panorama-toolbar.tsx`）**

| 按钮 | 行为 | 快捷键 |
|------|------|--------|
| ↩ Undo | `store.undo()` | `Ctrl+Z` |
| ↪ Redo | `store.redo()` | `Ctrl+Shift+Z` |
| 📐 Auto Layout | dagre 重算 lane 内节点 `position_x` | — |
| 💬 便签开关 | 切换 `store.showAnnotations` | — |
| 🔍−/+ 缩放 | ReactFlow zoomIn/zoomOut | — |
| 百分比 | 显示当前缩放比例（`useOnViewportChange`） | — |
| 💾 保存 | 批量提交 `nodeEdits` + `deletedNodeIds` | — |

### 6.5 NodeConfigPanel（复用不修改）

右侧滑出面板（`w-96`）：
- 标题 / 描述文本编辑
- Stage 下拉选择器（切换 stage → 节点 y 自动归位到新 lane）
- Worker 指派（`AssigneePicker`）
- Critic 指派（`AssigneePicker` + API URL 输入）
- Format Schema JSON 编辑器（textarea）
- 删除按钮（底部）

所有编辑通过 `cacheNodeEdits` 写入 Zustand `nodeEdits`，批量保存时提交。

### 6.6 NodePalette（适配复用）

- 固定左侧或顶部，可折叠
- 拖拽项：Rectangle, Diamond, Pill, Hexagon, Critic
- `dataTransfer` 携带 shape 类型
- `onDrop` 中计算目标 stage（从 y 坐标反查 lane），调用 `createNode` mutation
- Critic 拖入时：需先选中一个 Worker 节点，然后拖入 Critic 到该节点附近自动关联放置在其下方；若未选中 Worker 则创建独立 Critic 节点（置于"未分组" lane）

## 7. 数据流与状态管理

### 7.1 查询层

```typescript
// 全景图页面使用的查询
const { data: workflow } = useQuery(workflowDetailOptions(wsId, workflowId));
const { data: stages } = useQuery(workflowStagesOptions(wsId, workflowId));
const { data: nodes } = useQuery(workflowNodesOptions(wsId, workflowId));
const { data: edges } = useQuery(workflowEdgesOptions(wsId, workflowId));
const { data: agents } = useQuery(agentListOptions(wsId));
const { data: plugins } = useQuery(builtinPluginListOptions(wsId));

// Mutations（复用现有）
useCreateNode(), useUpdateNode(), useDeleteNode()
useCreateEdge(), useDeleteEdge()
useCreateStage(), useUpdateStage(), useDeleteStage(), useReorderStages()
useAssignNodeToStage()
```

### 7.2 Zustand Store

直接复用 `useWorkflowEditorStore`（`packages/core/workflows/store.ts`）：

```typescript
// 全景图使用的能力：
store.selectedNodeId        // 当前选中节点 → 驱动属性面板
store.selectedNodeIds       // 多选列表 → 框选/批量操作
store.nodeEdits             // 编辑缓存 → 属性面板修改暂存
store.deletedNodeIds        // 删除缓存
store.undoStack / redoStack // 撤销/重做
store.showAnnotations       // 便签开关
store.canvasColorMode       // 画布颜色模式

// 不再使用的字段（保留但全景图不调用）：
store.mode                  // 不再有 view/edit/connect 模式
store.pendingEdgeSource     // 连线从 Handle 拖拽，不需要先点源
```

### 7.3 保存机制

| 操作类型 | 提交时机 | 原因 |
|---------|---------|------|
| 节点移动（松手） | 即时 → `updateNode(position_x)` | 位置已是精确意图 |
| 跨 lane 移动 | 即时 → `assignNodeToStage(stageId)` | 明确的结构变更 |
| 连线创建 | 即时 → `createEdge(source, target)` | 拖拽松手已是确认 |
| 连线删除 | 即时 → `deleteEdge(edgeId)` | 选中+Delete 已是确认 |
| 节点删除 | 即时，有撤销兜底 | 明确操作 |
| 属性编辑 | 点「保存」批量提交 | 文本编辑渐进式，允许中途改主意 |
| Stage CRUD | 即时，有确认弹窗 | 明确的结构变更 |

### 7.4 节点数据转换

```typescript
function apiNodesToReactFlowNodes(
  nodes: WorkflowNode[],
  stages: WorkflowStage[]
): Node[] {
  return nodes.map(node => {
    const stage = stages.find(s => s.id === node.stageId);
    const laneY = stage
      ? stage.sortOrder * LANE_STEP
      : UNASSIGNED_LANE_Y;

    return {
      id: node.id,
      type: "compactWorker",
      position: {
        x: node.positionX ?? computeDefaultX(node, stage, allNodes),
        y: laneY + LANE_PADDING_TOP,
      },
      data: {
        node,
        stageId: node.stageId,
      },
    };
  });
}
```

## 8. 间距与尺寸规范

| 变量 | 值 | 说明 |
|------|-----|------|
| `LANE_HEIGHT` | 128px | 单条 lane 背景高度 |
| `GRADIENT_HEIGHT` | 8px | lane 间渐变过渡带高度 |
| `LANE_STEP` | 136px | lane 间隔 = LANE_HEIGHT + GRADIENT_HEIGHT |
| `LANE_PADDING_TOP` | 12px | 节点在 lane 内的上边距 |
| `PANORAMA_WIDTH` | 2400px | 画布固定宽度 |
| `UNASSIGNED_LANE_Y` | `stages.length * LANE_STEP + 16px` | 未分组 lane 在所有 stage lane 之后 |
| Worker 节点尺寸 | 224×64px（`h-16 w-56`） | |
| Critic 节点尺寸 | 144×48px（`h-12 w-36`） | |
| Worker-Critic 间距 | 20px（`gap-5`） | |
| 节点行内间距 | 32px（`gap-8`, `justify-evenly`） | |
| 画布外 padding | 12px（`p-3`） | |

## 9. 视觉规范

### 9.1 Stage 色系（来自 `STAGE_BG_COLORS`）

```typescript
const STAGE_BG_COLORS = [
  "bg-slate-50/70",
  "bg-stone-50/70",
  "bg-blue-50/45",
  "bg-rose-50/45",
  "bg-violet-50/45",
  "bg-amber-50/45",
] as const;
```

### 9.2 渐变过渡带（来自 `STAGE_TRANSITION_GRADIENTS`）

```typescript
const STAGE_TRANSITION_GRADIENTS = [
  "bg-gradient-to-b from-slate-50/40 to-stone-50/40",
  "bg-gradient-to-b from-stone-50/40 to-blue-50/35",
  "bg-gradient-to-b from-blue-50/35 to-rose-50/35",
  "bg-gradient-to-b from-rose-50/35 to-violet-50/35",
  "bg-gradient-to-b from-violet-50/35 to-amber-50/35",
  "bg-gradient-to-b from-amber-50/35 to-slate-50/40",
] as const;
```

### 9.3 连线色系（来自 `STAGE_LINE_COLORS`）

```typescript
const STAGE_LINE_COLORS = [
  "text-slate-300",
  "text-stone-300",
  "text-blue-300",
  "text-rose-300",
  "text-violet-300",
  "text-amber-300",
] as const;
```

## 10. 边界情况

| 场景 | 处理 |
|------|------|
| Workflow 无 stage | 画布居中显示"尚未定义阶段" + 引导按钮（创建第一个 stage） |
| Stage 无节点 | 空 lane 背景 + 中央淡色文字 "No plugins in this stage"（`text-[11px] text-muted-foreground/40`） |
| 旧节点（stage_id = NULL） | 全部置于"未分组"虚拟 lane（画布最底部，灰色调） |
| 大量节点（stage 内 >6） | canvas `overflow-x: auto`，画布宽度扩展 |
| 大量 stage（>8） | canvas `overflow-y: auto`，画布高度扩展 |
| 跨 stage 无 edge | 不画隐含连线 |
| resize | ReactFlow 自身处理 viewport 变化 |
| 删除含节点的 stage | 确认弹窗后节点移入"未分组"（`ON DELETE SET NULL`） |
| Workflow 不存在 | 标准 404 |
| 无 workspace 访问 | 标准 `NoAccessPage` |
| 拖到相邻 lane 松手 | 节点动画归位到新 lane 标准 y + 乐观更新 `stage_id` |
| 从 palatte 拖入落在 lane 间隙 | 归属到最近的 lane |
| Handle hover 未显示 | 缩放过小时不显示 Handle（`minZoom: 0.4`以下隐藏） |
| 未保存编辑离开 | 弹出确认对话框 |

## 11. i18n

关键 key（命名空间 `workflows`）：

```json
{
  "panorama": {
    "stage_n_of_m": "Stage {{n}}/{{m}}",
    "nodes_count": "{{count}} node",
    "nodes_count_plural": "{{count}} nodes",
    "empty_stage": "No plugins in this stage",
    "empty_all": "Create your first stage to get started",
    "unassigned": "Unassigned",
    "toolbar": {
      "undo": "Undo",
      "redo": "Redo",
      "auto_layout": "Auto layout",
      "annotations": "Toggle annotations",
      "save": "Save changes",
      "unsaved": "Unsaved changes"
    },
    "stage_dialog": {
      "create_title": "Create Stage",
      "edit_title": "Edit Stage",
      "delete_confirm": "Deleting this stage will move its {{count}} node(s) to \"Unassigned\"."
    },
    "detail_panel": {
      "title": "Node Details",
      "worker": "Worker",
      "critic": "Critic",
      "format_schema": "Format Schema",
      "not_configured": "Not configured"
    }
  }
}
```

## 12. 测试

### Go 后端测试

- Stage CRUD（create, update, delete, reorder）
- 节点分配到 stage / 取消分配
- `GET /workflows/{id}` 响应包含 `stages` 数组
- `ON DELETE SET NULL`：删除 stage 后节点 stage_id 为 NULL
- 权限校验
- ~~跨 stage edge 校验~~ → 改为验证跨 stage 边**可以**创建

### 前端组件测试（`packages/views/workflows/components/overview/`）

**新组件测试：**

- `workflow-panorama-page.test.tsx`：ReactFlow 渲染、lane 背景存在、stage labels 渲染、节点列表渲染
- `compact-worker-node.test.tsx`：节点渲染、尺寸、handle 显示/隐藏、点击交互
- `critic-badge-node.test.tsx`：节点渲染、虚线边框、handle 行为
- `lane-bg-node.test.tsx`：背景渲染、色系循环、不可交互验证
- `panorama-edge.test.tsx`：同 lane 路径、跨 lane 路径、critic 路径、视觉参数
- `panorama-toolbar.test.tsx`：各按钮功能、快捷键触发
- `canvas-stage-labels.test.tsx`：labels 渲染、行内操作按钮、拖拽排序

**旧测试迁移/更新：**

- `panorama-page.test.tsx`：重写，覆盖新 ReactFlow 全景图
- 移除 `overview-page.test.tsx`、`stage-lane.test.tsx`、`compact-node-card.test.tsx`、`critic-badge.test.tsx`、`panorama-svg-overlay.test.tsx`、`architecture-detail-panel.test.tsx` 的旧测试

## 13. 实现次序

全部使用新建组件策略，不修改原组件：

### Phase 1 — 新的 ReactFlow 节点 & 边（无破坏性）

1. 新建 `reactflow-nodes/lane-bg-node.tsx`
2. 新建 `reactflow-nodes/gradient-bg-node.tsx`
3. 新建 `reactflow-nodes/compact-worker-node.tsx`
4. 新建 `reactflow-nodes/critic-badge-node.tsx`
5. 新建 `reactflow-edges/panorama-edge.tsx`
6. 新建各组件测试

### Phase 2 — 画布 & 外围

7. 新建 `panorama-toolbar.tsx`
8. 新建 `canvas-stage-labels.tsx`
9. 重写 `workflow-panorama-page.tsx`（ReactFlow 整合 + 节点数据转换 + 交互约束 + 保存逻辑）
10. 适配 `layout.ts`（dagre 改为 lane 内水平排列）
11. 新建全景图页面测试

### Phase 3 — 路由 & 清理

12. 更新路由：`/workflows/[id]` 指向新全景图
13. 更新 desktop 路由
14. 移除 `workflow-detail-page.tsx`, `workflow-detail-shell.tsx`, `dag-canvas.tsx`
15. 移除旧 overview 组件文件
16. 移除 `reactflow-nodes.tsx`
17. 移除 `packages/core/workflows/stores/view-store.ts`
18. 更新 E2E 测试

## 14. 复用项

| 复用项 | 来源 | 用途 |
|--------|------|------|
| `useWorkflowEditorStore` | `packages/core/workflows/store.ts` | 选中/编辑缓存/撤销重做/便签/颜色模式 |
| Query options + mutations | `packages/core/workflows/queries.ts` | 全部数据读写 |
| `NodeConfigPanel` | `views/workflows/components/node-config-panel.tsx` | 节点属性编辑（不修改） |
| `NodePalette` | `views/workflows/components/node-palette.tsx` | 拖拽创建节点（适配复用） |
| `StageCreateDialog` | `views/workflows/components/overview/stage-create-dialog.tsx` | Stage 创建/编辑（不修改） |
| `alignment-snap.ts` | `views/workflows/components/alignment-snap.ts` | 吸附对齐（不修改） |
| `layout.ts` | `views/workflows/components/layout.ts` | dagre 布局（适配为 lane 内排列） |
| `AgentListOptions` | `packages/core/agents/queries.ts` | agent + plugin 信息 |
| `AssigneePicker` | `packages/views/assignee-picker/` | Worker/Critic 指派 |
| `NavigationAdapter` | `packages/views/navigation/` | 路由跳转 |
| ReactFlow (`@xyflow/react`) | 项目已有依赖 | 画布核心 |

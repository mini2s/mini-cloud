# Workflow 画布重构

**日期:** 2026-07-06
**范围:** 仅 UI/UX 相关内容（视觉设计、交互模式、布局、组件行为）

---

## 1. 核心 UX 理念

Workflow 编辑模式和运行模式**共享同一套画布基础设施**——不是共享一个万能页面，而是共享画布数据模型、布局规则、节点卡片协议、连线语义、选择接口和详情面板框架。

### Surface 选择矩阵

| 场景 | Surface | 原因 |
|------|---------|------|
| Workflow 编辑器 | `ReactFlowSurface` | 需要完整拖拽/连线/框选交互 |
| Issue 全景图（嵌入） | `StageLaneSurface` | 信息密度高、嵌入友好、横向滚动自然 |
| Issue 全景图（全屏） | `StageLaneSurface`（全屏模式） | 同一 surface，仅改变容器尺寸 |
| Workflow 架构预览 | `StageLaneSurface` | 只读概览，侧重 Stage 结构和节点关系 |

---

## 2. n8n 借鉴 — 11 条设计原则

基于 n8n 工作流画布的场景分析，提炼以下 UX 原则：

| # | 原则 | n8n 实践 | 对 Multica 的意义 |
|---|------|---------|-----------------|
| P1 | **新建流程先收敛入口** | 空白画布展示 "Add first step" 强引导，优先选择 Trigger | 借鉴"先收敛第一步"的模式；Multica 适配为先创建 Stage，再在 Stage 内添加第一个任务节点 |
| P2 | **节点面板是能力市场** | 按 Trigger/Action/Core 分类 + 搜索 + 推荐 | 节点面板按 Agent Worker / Human Worker / Squad / Annotation 分组，支持搜索和最近使用 |
| P3 | **连线必须有语义** | 连线承载数据流、条件分支（true/false）、数据量标注 | 区分数据流、控制流、异常流；Stage 泳道内连线 vs 跨 Stage 连线视觉不同 |
| P4 | **节点详情是调试工作台** | 参数配置、Input 数据、Output 结果和表达式编辑处于相邻上下文 | 配置面板需展示上游输出 Schema 预览，支持字段引用拖拽 |
| P5 | **数据映射低门槛高上限** | 拖拽字段生成表达式 + 手写表达式 + 实时预览 | Worker/Critic 人选 + Schema 配置支持从上游节点输出中引用字段 |
| P6 | **调试能力前置** | Pin Data + Execute step + 禁用节点 + 执行回放 | MVP 不做 Pin Data/单步执行，但架构预留 runtime overlay 扩展点 |
| P7 | **数据新鲜度显性化** | Dirty Node（黄色边框）提示参数变更后旧数据不可靠 | 编辑器 dirty indicator；运行态优先读取 WorkflowRun 快照 |
| P8 | **大流程可收纳** | Sticky Notes + Canvas Groups 折叠 + 自动布局 | Stage 泳道覆盖阶段分组；节点数 > 20 时提供自动布局和导航辅助 |
| P9 | **Worker 能力可视化** | Agent 节点下挂 LLM/Memory/Tools 子能力 | Worker 节点的能力标签（模型、权限、Critic 配置）展示在卡片上 |
| P10 | **发布态工程化** | Editor/Executions、Inactive、Save 等状态区分编辑态和运行态 | draft/active 状态分离；发布前预检查阻断 |
| P11 | **画布操作符合费茨定律** | 连接点放大和悬停工具栏 | 节点端口 hover 放大 + 快速操作入口，降低连线瞄准难度 |

---

## 3. 编辑器整体布局

```
┌─────────────────────────────────────────────────────────┐
│  Top Bar: 标题 | draft/active | dirty indicator | 自动布局 | 保存 | 发布  │
├────────┬───────────────────────────────────┬──────────────┤
│ Node   │                                   │  Inspector   │
│ Panel  │   ReactFlow DAG Canvas            │  (右侧抽屉)   │
│        │   ┌── Stage A ──────────────┐    │              │
│ (分组)  │   │ [Node1] → [Node2]       │    │  节点配置     │
│        │   └─────────────────────────┘    │  - Worker    │
│ Agent  │   ┌── Stage B ──────────────┐    │  - Critic    │
│ Worker │   │ [Node3] → [Node4]       │    │  - Schema    │
│ Human  │   │              ↘ [Node5]  │    │  - Stage     │
│ Worker │   └─────────────────────────┘    │              │
│ Squad  │                                   │              │
│ Annot. │                                   │              │
├────────┴───────────────────────────────────┴──────────────┤
│  Preflight Bar: ⚠ DAG 环检测 | ⚠ 缺失 Worker | ...        │
└─────────────────────────────────────────────────────────┘
```

---

## 4. 视觉设计语言

遵循"扁平化、高对比、状态可见"原则，借鉴 n8n 实图中低噪声节点、清晰连接点、状态边框和网格画布的表达方式。实现层必须使用语义 token，不直接硬编码 hex 颜色。

### 4.1 配色系统

| 用途 | Token 意图 | 说明 |
|------|-----------|------|
| 主操作 / 选中态 | `workflow-accent` 或映射到现有 primary token | 主要操作按钮、选中态边框 |
| AI / 智能体标识 | `workflow-agent` | 智能体相关节点标识 |
| 执行中 / 数据流 | `workflow-info` | Worker 执行中状态、数据流连线 |
| 成功 / true 分支 | `workflow-success` | 已完成状态、true 分支连线 |
| 等待 / dirty | `workflow-warning` | Dirty Node、等待人工输入 |
| 失败 / false 分支 | `workflow-danger` | 失败/阻断状态、false 分支连线 |
| 画布背景 | `workflow-canvas-bg` | 白色基调轻微偏冷，叠加低对比网格点 |
| 节点背景 | `card` / `background` | 节点卡片背景，使用语义边框 token |
| 泳道背景 | `workflow-stage-bg` | Stage 泳道浅色背景 |
| 文本主色 | `foreground` | 标题和正文 |
| 文本次要 | `muted-foreground` | 描述文本、元数据 |

### 4.2 节点形状

- **圆角半径：** 默认 14px，紧凑模式 8px。
- **边框：** 1px 语义边框 token，无立体阴影；选中态 2px accent/info token。
- **宽度：** 160px（标准）/ 120px（紧凑），高度随内容自适应。
- **节点图标：** 左侧 28px 圆形图标区，背景色按节点类型区分：
  - Trigger：trigger token
  - Agent Worker：agent token
  - Human Worker：human token
  - Squad：squad token
  - Critic：critic token
- **连接点（Handle）：** 5px 圆点，默认 muted token，hover 脉冲放大至 10px + 发光。
- **节点状态发光：** 运行态通过边框颜色 + 外发光表示状态，方便远距离识别。

### 4.3 连线样式

| 连线类型 | 视觉 | 含义 | 示例 |
|----------|------|------|------|
| `data` | 实线 + 箭头，默认色 | 数据从一个节点流向另一个 | Webhook → Transform → Send |
| `control` | 实线 + 标签（true/false），绿/红色 | 条件分支 | IF 节点的 true/false 分支 |
| `error` | 虚线 + 红色 | 异常处理路径 | 节点失败后的错误处理分支 |

- 默认：平滑贝塞尔曲线，2px 宽度。
- Stage 泳道内连线使用标准线型；跨 Stage 连线加粗至 3px，标注 Stage 名称。

### 4.4 画布背景

- 浅色低对比网格点背景，提供空间参考。
- 支持暗色主题切换。

---

## 5. 编辑器交互设计

### 5.1 画布启动引导（P1）

新建 Workflow 时不展示空白画布：

1. **"创建第一个 Stage"** 引导卡，居中展示，点击后创建默认 Stage。
2. Stage 创建后，泳道内展示 **"Add first step"** 引导——从节点面板拖入或点击添加节点。

引导流程：`空白画布 → 创建 Stage → 添加节点 → 配置 Worker → 连线 → 保存/发布`

### 5.2 节点面板（P2）— "能力市场"

左侧节点面板设计：

- **分组展示：** Agent Worker / Human Worker / Squad / Annotation，每组有独立色标和图标。
- **搜索：** 顶部搜索框，支持按名称、标签、能力关键词过滤。
- **最近使用：** 面板顶部展示最近 5 个使用过的节点类型。
- **拖入创建：** 从面板拖拽节点类型到画布 Stage 泳道内，自动归属该 Stage。
- **快捷键：** `N` 打开节点面板，`Esc` 关闭。

每个节点类型关联**研发阶段**（需求分析、方案设计、编码、测试、验证等），并定义若干**交付物**（Document / PR + 交付要求）。

### 5.3 节点创建路径

| 路径 | 操作 | 适用场景 |
|------|------|---------|
| 面板拖入 | 从左侧面板拖拽节点类型到画布 | 浏览和选择节点类型 |
| 端口拖出 | 从已有节点输出端口拖出到空白处，弹出节点类型选择 | 快速扩展流程链 |

端口拖出流程：拖拽 → 松手弹出 mini 节点选择面板（定位在松手位置）→ 选择类型后自动创建节点 + 连线 → 新节点归属当前 Stage 或提示选择 Stage。

### 5.4 节点交互（P11）

**悬停工具栏：** 鼠标悬停节点时，节点上方浮现操作工具栏：
- 执行此节点（单步调试，后期）
- 禁用/启用
- 删除
- 更多（复制、查看详情）

**端口交互：** 悬停输入/输出端口时，端口脉冲放大 + 发光，降低连线瞄准难度（费茨定律）。

**选中态：** 单击选中节点显示蓝色边框 + 右侧 Inspector 切换至该节点配置。

**多选：** 框选或 Shift+点击多选，支持批量删除、批量移动。

### 5.5 节点配置面板（P4/P5）

右侧 Inspector 抽屉，按标签页组织：

```
Inspector 标签页：
├── Worker      — 执行者选择（人 / 智能体 / 小队 / 研发角色）
├── Critic      — 评审者选择（人 / 智能体 / 小队 / 研发角色）
├── Capabilities（智能体节点时展示）
│   ├── Plugin / Skill 关联
│   ├── 运行时选择
│   └── 模型选择
├── Instructions（智能体节点时展示）
│   └── 指令正文
├── Visibility（智能体节点时展示）
│   └── 公开 / 私有 切换
├── Squad（小队节点时展示）
│   └── Leader Agent + 成员管理
├── Deliverables — 交付物定义
├── Parameters  — JSON Schema / 参数配置
└── Stage       — 所属 Stage
```

#### Worker / Critic 选择

- **Worker：** 下拉搜索 + 能力标签展示（模型、权限、可用性）
- **Critic：** 可选，下拉搜索 + 审核类型标签

#### 智能体能力配置（Capabilities）

- **Plugin / Skill 关联：** 从知识中心选择，提供跳转链接
- **运行时选择：** 下拉选择可用运行时，展示在线/离线/占用状态；可勾选「路由至其他可用运行时」
- **模型选择：** 下拉选择可用模型，展示可用/下线状态；可勾选「路由至其他可用模型」

#### 指令配置（Instructions）

- 文本/Markdown 编辑器，支持指令模板和变量引用（如 `{node.deliverable}`、`{stage.name}`）

#### 可见性

- **公开：** 智能体可被工作区其他成员搜索和复用
- **私有：** 仅创建者可见和使用

#### 小队配置

- 名称、描述
- **Leader Agent：** 从智能体列表中选择
- **成员管理：** 从智能体列表 + 团队成员列表中添加，展示名称、类型标识和角色标签

#### 交付物定义

- **类型：** 文档（Document）/ PR（Pull Request）
- **交付要求：** 文本描述
- **UI 表现：** 列表 + 添加按钮，每项显示类型图标 + 名称 + 要求摘要

#### 其他配置项

- **JSON Schema / Parameters：** 代码编辑器，左侧展示上游节点输出 Schema 供字段引用（P5）
- **Stage 归属：** 下拉选择
- **描述：** 文本输入，展示在节点卡片副标题
- **研发阶段：** 下拉选择（需求分析、方案设计、编码、测试、验证等），支持自定义

### 5.6 Stage 泳道

- 每个 Stage 一个水平区域，Stage 名称在左侧标签栏。
- 节点自动归属到对应 Stage 泳道内。
- Stage 之间垂直排列，节点水平流向。
- Stage 顺序可拖拽调整（上下拖动 Stage 标签）。
- 未归属节点放置在 "Unassigned" 区域顶部。

### 5.7 MiniMap 小地图导航

- **位置：** 默认右下角
- **内容：** 缩略展示全部 Stage 泳道和节点位置，视口框标示当前可视区域
- **交互：** 拖拽视口框平移视图 / 点击跳转 / 节点状态颜色同步反映
- **显示策略：** 节点数 ≤ 20 自动隐藏，> 20 自动显示，用户可手动开关
- **实现：** 使用 ReactFlow 内置 `MiniMap` 组件

### 5.8 发布前预检查栏（P10）

底部 `PreflightBar` 聚合所有问题，点击问题项定位到对应节点：

| 检查项 | 阻断？ | 说明 |
|--------|--------|------|
| DAG 环检测 | 阻断 | 存在循环依赖无法发布 |
| 孤立节点 | 警告 | 有节点未连接到主流程 |
| 不可达节点 | 警告 | 节点无入边且非起始节点 |
| Worker 缺失 | 阻断 | 节点未分配 Worker |
| Critic 引用不存在 | 阻断 | 配置的 Critic ID 无效 |
| Stage 缺失 | 警告 | 节点未归属任何 Stage |
| Schema 必填字段缺失 | 阻断 | Worker 要求的关键字段未填写 |

---

## 6. Issue 运行时全景图 UI

Issue 全景图复用编辑器画布的 `CanvasModel` 和节点卡片协议，但运行在只读模式。

### 6.1 两种展示模式

| 模式 | 触发 | 行为 |
|------|------|------|
| **嵌入模式**（默认） | Issue 分配 Workflow 后自动展示 | 在 Issue 详情页内以紧凑形式渲染，Stage 泳道横向滚动 |
| **全屏模式** | 点击展开按钮 | 同一 Surface 撑满视口，Stage 泳道间距加大，节点卡片信息更详细 |

两种模式使用同一 `StageLaneSurface`，仅通过 `density`（compact / full）参数控制渲染密度。**不新增独立 Run 页面。**

### 6.2 运行时状态叠加 — 节点卡片视觉

| NodeRun 状态 | 卡片视觉 | 含义 |
|-------------|---------|------|
| `pending` | 灰色虚线边框 | 等待上游完成 |
| `format_checking` | 蓝色脉冲边框 | 格式校验中 |
| `format_ok` | 绿色细边框 + 校验图标 | 格式校验通过 |
| `format_failed` | 红色边框 + 格式错误图标 | 格式校验失败 |
| `worker_assigned` | 蓝色细边框 + 分配图标 | Worker 已分配，等待执行 |
| `working` | 蓝色实线边框 + 进度动画 | Worker 执行中 |
| `awaiting_input` | 橙色边框 + 问号图标 | 等待人工输入 |
| `awaiting_critic` | 紫色边框 + 审核图标 | 等待 Critic 审核 |
| `critic_reviewing` | 紫色脉冲边框 | Critic 审核中 |
| `critic_approved` | 绿色细边框 + 审核通过图标 | Critic 已通过 |
| `critic_rework` | 橙色边框 + 返工图标 | Critic 驳回并要求返工 |
| `blocked` | 红色边框 + 锁图标 | 被阻断 |
| `failed` | 红色实心边框 + 错误图标 | 执行失败 |
| `completed` | 绿色边框 + 勾选图标 | 执行成功 |
| `skipped` | 灰色边框 + 跳过图标 | 已跳过 |
| `cancelled` | 灰色删除线 | 已取消 |

连线也反映运行时状态：已完成节点间的连线为绿色，失败/阻断路径为红色虚线。

### 6.3 节点卡片展示信息

- **处理者显示规则：** 评审相关状态优先显示评审者，其他状态显示执行者
- **交付物情况：** 红绿灯提交状态（绿=已提交/黄=部分提交/红=未提交），点击可查看详情
- **执行耗时：** 节点从 `working` 到当前状态的耗时统计（如"3 分 24 秒"）
- **阶段信息：** 节点所属研发阶段标签

### 6.4 节点卡片内嵌操作

根据 NodeRun 状态显示不同操作按钮：

| 状态 | 可用操作 |
|------|---------|
| `awaiting_critic` | **通过** / **打回**（审核者操作） |
| `awaiting_input` | **提交输入** / **交还执行方** |
| `blocked` | **重试** / **跳过** / **手动完成** |
| `failed` | **重试** / **跳过** / **手动完成**；修改配置后重试可选「仅本次生效」或「更新 Workflow 配置」 |
| `working` | 无操作（等待中） |

操作入口在 Issue 全景图的节点卡片上，无需离开 Issue 页面。

### 6.5 全局提示栏

全景图顶部 `GlobalNotificationBar`，按优先级聚合待处理事项：

1. **`awaiting_critic`** — 最高优先级，提示「有节点等待审核」
2. **`blocked` / `failed`** — 提示「有节点需要处理」
3. **`awaiting_input`** — 提示「有节点等待输入」

点击提示栏中的条目自动定位并高亮对应节点卡片。

### 6.6 右侧详情面板（运行态）

点击节点卡片打开右侧 `CanvasInspector`：

- **概览标签页：** 节点名称、Worker/Critic 信息、当前状态、耗时
- **评审标签页（评审阶段可见）：** 评审者信息、评审结论、评审意见、评审时间线
- **产出标签页：** NodeRun 输出数据（JSON 只读展示）
- **交付物标签页：** 交付物列表、提交状态（红绿灯）、交付物内容预览
- **时间线标签页：** 状态变更时间线（pending → working → completed）
- **配置标签页：** 只读当前定义配置
- **操作区：** 根据当前状态显示对应操作按钮

### 6.7 运行态只读约束

- 禁止移动节点
- 禁止创建/删除节点
- 禁止创建/删除连线
- 禁止编辑 Worker/Critic/Schema/Stage
- 点击节点仅打开运行详情面板

---

## 7. 组件清单汇总

| 组件 | 职责 |
|------|------|
| `WorkflowCanvasShell` | 公共容器，接收 mode、model、selection、callbacks、slots（topBar / leftPanel / inspector / bottomBar） |
| `ReactFlowSurface` | 编辑器主画布，处理拖拽、连线、缩放、MiniMap、对齐辅助 |
| `StageLaneSurface` | 运行态/预览态的 Stage 泳道 + SVG overlay surface |
| `WorkflowNodeCard` | 共用节点卡片协议，通过 variant（definition / runtime）控制信息密度 |
| `WorkflowEdgeLayer` | 基于统一 edge 语义绘制连线，区分 data/control/error 线型 |
| `CanvasInspector` | 右侧面板框架，编辑器挂配置面板，Issue 挂运行详情面板 |
| `PreflightBar` | 发布前检查结果、错误聚合和定位入口 |
| `NodePanel` | 左侧节点面板，"能力市场"式分组展示 + 搜索 + 最近使用 |
| `CanvasHoverToolbar` | 节点悬停时的快速操作工具栏 |
| `GlobalNotificationBar` | Issue 全景图顶部全局提示栏，按优先级展示待处理事项 |

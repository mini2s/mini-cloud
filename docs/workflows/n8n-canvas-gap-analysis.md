# n8n Workflow Canvas UI/UX 对照分析报告

> 基于 `docs/workflows/n8n_workflow_canvas_uiux_report.html`，对照 Multica 工作流画布代码实现，逐项检视差距。
>
> 分析日期：2026-07-07

---

## 总体评估

Multica 的工作流画布已具备**可用的基础框架**，但在"调试闭环"、"数据映射"、"节点状态可视化"、"大流程收纳"、"AI Agent 子能力展示"等方面与 n8n 存在显著差距。

**对比维度总览：**

| 维度 | n8n | Multica | 差距 |
|------|-----|---------|------|
| 画布基础设施 | 成熟 | 基本具备 | 小 |
| 空白画布引导 | 强引导 → 触发器 | 有引导但无方向性 | 中 |
| 节点库 | 能力市场（搜索+分类+推荐+最近） | 搜索+分类 | 中 |
| 连线语义 | 数据流/控制流/错误流区分 | 单一连线类型 | 大 |
| 节点配置面板 | 配置+I/O+日志同屏 | 配置+数据分开 | 中 |
| 数据映射 | 拖拽字段+表达式+预览 | 无 | 大 |
| 调试能力 | 单步/Pin/Mock/禁用/回放 | 无 | 大 |
| 节点状态 | 空闲/运行中/成功/错误/Dirty | 仅基础选择态 | 大 |
| AI Agent | 子能力可视化连接 | 仅配置表单 | 大 |
| 大流程收纳 | 分组+折叠+注释 | 注释(便签)已实现 | 中 |
| 发布协作 | 草稿/发布/锁/回滚 | 激活/暂停+保存 | 中 |

---

## 一、场景对照分析

### 场景 1：空白画布与"Add first step"引导

**n8n 体验：**
- 新建 workflow 后，画布中央只有一个主 CTA："Add first step"
- 明确引导用户先选择 **Trigger**（触发器），而不是自由添加节点
- 推荐起点：Manual / Webhook / Schedule 等常见触发器
- 顶部展示 workflow 名称与状态

**Multica 现状：**
- ✅ 有 "Add first step" 引导文案（`workflow-panorama-page.tsx:696-717`）
- ✅ 有 "Add first step…" 弹窗卡片，包含 + 按钮触发 NodeTemplatePicker
- ✅ 顶部显示 workflow 名称（可编辑）和状态 Badge
- ❌ **引导无方向性**：没有强调"先从触发器开始"，所有 6 类模板（Trigger/Action/Logic/AI/Human/Annotation）平级展示
- ❌ **没有推荐起点**：n8n 会根据场景推荐 Webhook、定时、表单、聊天、人工触发等入口，Multica 没有
- ❌ 空画布引导卡片文案为 "Add your first step to start building the workflow"，但没有说明为什么需要先选触发器

**差距：中** | 核心问题不是缺 UI，而是缺**引导逻辑**——应该根据业务场景推荐触发器类型。

---

### 场景 2：节点库搜索与添加

**n8n 体验：**
- 右侧节点面板作为"能力市场"
- 分类：Trigger nodes → App actions → Core logic → AI / LangChain
- 支持搜索、分类浏览、推荐节点、最近使用
- 快捷键 `N` 打开节点面板
- 节点右侧加号 `+` 同时完成"添加节点"和"自动连线"

**Multica 现状：**
- ✅ NodeTemplatePicker 支持搜索 + 按分类浏览（`node-template-picker.tsx`）
- ✅ 六大分类：Trigger / Action / Logic / AI / Human / Annotation
- ✅ 分类有标签和描述
- ✅ 空状态时有搜索提示
- ❌ **没有"最近使用"**：每次添加节点都需要重新搜索或浏览
- ❌ **没有键盘快捷键**打开节点面板（n8n 按 `N`）
- ❌ 节点模板只有 6 个（Manual trigger, Task, Decision, Agent task, Human review, Note），远少于 n8n 的丰富生态
- ❌ 添加节点后不自动连线到前序节点

**差距：中** | 分类体系合理但模板池太小，缺少"最近使用"和快捷键。

---

### 场景 3：节点连接与数据流

**n8n 体验：**
- 每条连线表达明确的数据传输路径
- 连线上显示数据量（如 "32 items"）
- 贝塞尔曲线 + 方向箭头
- 输入点/输出点清晰
- 连线类型区分：数据流、条件流、错误流、AI 子能力连接

**Multica 现状：**
- ✅ ReactFlow Bezier/Straight 连线（`reactflow-nodes.tsx`）
- ✅ 连线有方向箭头（`MarkerType.ArrowClosed`）
- ✅ 支持拖拽创建连线（`ConnectionMode.Loose`）
- ✅ 支持删除连线（`Delete`/`Backspace` 键）
- ✅ 不同 Stage 之间的连线有正交通道路由（`panorama-svg-overlay.tsx`）
- ❌ **连线上不显示数据量/数据类型**
- ❌ **连线无语义区分**：所有连线外观相同（除了 critic 连线为虚线），无法区分数据流/控制流/错误流
- ❌ 条件分支节点（Decision）没有 true/false 标签
- ❌ 没有连线上的数据预览

**差距：大** | 连线只是"连接存在"，不表达"连接含义"。n8n 的核心设计理念是**每条线都可被解释**。

---

### 场景 4：条件分支与失败路径

**n8n 体验：**
- IF 节点有多个输出点（true/false）
- 分支线上显示条件标签
- 成功/失败路径在空间上分开
- Switch 节点支持 3+ 输出端口
- 分支支持折叠、命名、备注

**Multica 现状：**
- ✅ Decision 节点模板存在（钻石形 `diamond` shape）
- ✅ 节点支持多种形状（rectangle/diamond/pill/hexagon）
- ❌ **Decision 节点没有多输出端口**：目前所有节点只有 top/bottom/left/right 四个 Handle，且没有业务语义（true/false/A/B/C）
- ❌ **连线无条件标签**
- ❌ 没有 Switch 多路路由节点
- ❌ 没有 Merge 合并节点
- ❌ 分支不支持折叠

**差距：大** | 条件分支是工作流编排的核心能力之一，当前实现只有基本的"连线"能力，不支持分支语义。

---

### 场景 5：节点详情、参数配置与输入/输出数据

**n8n 体验：**
- 节点详情 = 配置 + 输入数据 + 输出结果，同一上下文
- Execute step 按钮支持节点级别验证
- 左侧参数区、中间 Input（上游数据）、右侧 Output（执行结果）
- JSON / Table 视图切换

**Multica 现状：**
- ✅ NodeConfigPanel 右侧滑出面板（`node-config-panel.tsx`）
- ✅ 三个 Tab：Config / Data / Runs
- ✅ Config Tab 有：title、description、format_schema、stage 选择、worker/critic 分配
- ✅ Data Tab 使用 NodeDataPreview 展示 worker_output / critic_output / critic_comment
- ❌ **没有"Execute step"（单步执行）按钮**
- ❌ **Input 面板缺失**：看不到上游节点传入了什么数据
- ❌ Config 和 Data 是分开的 Tab，不是同屏展示
- ❌ NodeDataPreview 只展示最近一次运行的 JSON 数据，没有格式化表格视图
- ❌ Data 和 Runs Tab 内容相同（都渲染 NodeDataPreview）

**差距：中** | 配置表单基本可用，但缺少"调试闭环"——没有单步执行，输入/输出不能与配置同屏对照。

---

### 场景 6：数据映射与表达式

**n8n 体验：**
- 从 Input panel 拖拽字段到参数区，自动生成 `{{$json.field}}` 表达式
- 支持手写表达式（条件、计算、格式化）
- 实时预览

**Multica 现状：**
- ❌ **完全没有数据映射功能**
- ❌ 没有表达式编辑器
- ❌ 没有字段拖拽
- ❌ 没有实时预览
- 参数配置目前仅靠 `format_schema` JSON 文本域，用户需要手动写 JSON

**差距：大** | 这是 n8n 降低使用门槛的核心设计——让业务用户不用写 JSON 就能引用上游数据。Multica 当前完全缺失。

---

### 场景 7：手动执行、局部执行与 Pin Data

**n8n 体验：**
- 单步执行（Execute step）：只运行当前节点 + 必要上游
- Pin Data：固定某个节点的输出，不再真实请求外部服务
- 禁用节点：调试时临时跳过副作用节点
- 局部执行：拆成可重复验证的小单元

**Multica 现状：**
- ❌ **完全没有单步执行**
- ❌ **没有 Pin Data / Mock 数据**
- ❌ **没有禁用节点**
- ✅ 有 workflow 级别的 activate/deactivate（启动/暂停整个工作流）

**差距：大** | n8n 报告的 insight 明确指出："Workflow 产品必须内置单步运行、局部运行、Mock/Pin 数据、禁用节点四件套，否则复杂流程维护成本会很高。" Multica 目前四件套全部缺失。

---

### 场景 8：Dirty Node 与历史执行回放

**n8n 体验：**
- Dirty Node：黄色边框 + 三角形警告，参数变更后提示"输出可能过期"
- 失败节点：红色边框，与 Dirty 含义不同
- 执行回放：将历史执行数据加载回编辑器
- 节点状态分层：未运行 / 成功 / 失败 / 旧数据 / 禁用 / 跳过 / Mock / 生产执行

**Multica 现状：**
- ❌ **没有 Dirty Node 概念**：修改参数后不会提示数据过期
- ❌ **没有执行回放**
- ❌ **节点状态系统不完善**：CompactWorkerNode（`compact-worker-node.tsx`）可能有一些状态显示，但远不如 n8n 的分层体系
- ✅ 有 `NodeDataPreview` 可以看到最近一次运行的 worker_output / critic_output
- ✅ 有 PreflightBar 显示全工作流级别的问题（循环依赖、孤立节点、缺少 worker 等）

**差距：大** | 节点状态可视化是画布信任度的基础。当前无法从画布上直接判断一个节点的数据是否可信。

---

### 场景 9：AI Agent 编排

**n8n 体验：**
- AI Agent 作为节点，子能力（Chat Model、Memory、Tools）用虚线/子连接挂在 Agent 下方
- Chat Trigger 是聊天入口
- Agent 后续可连接传统节点（AI 只是流程中的一步）
- 区分"主数据流"和"AI 子能力连接"

**Multica 现状：**
- ✅ "Agent task" 节点模板存在（`node-template-catalog.ts`）
- ✅ 节点可分配 Agent 作为 worker（通过 AssigneePicker）
- ✅ 节点有 critic 配置（审查者）
- ❌ **不展示 AI Agent 的子能力**：看不到用什么模型、有没有记忆、能调什么工具
- ❌ 没有 Chat Trigger 类型
- ❌ 没有子能力连接线（虚线区分）
- ❌ Agent 的能力被藏在配置表单里，画布上只是一个普通节点

**差距：大** | Multica 把 Agent 当作一个普通任务节点，而 n8n 把 Agent 的"能力边界"显性化在画布上。这是 AI-native 工作流产品最重要的差异化设计。

---

### 场景 10：Sticky Notes 与 Canvas Groups 管理复杂流程

**n8n 体验：**
- Canvas Group：把相关节点圈成模块，可命名、可折叠
- Sticky Note：便签注释，支持 Markdown、7 种颜色、自由缩放
- 超过 20 个节点时系统主动提示分组
- 快捷键 `Shift+S` 快速添加便签

**Multica 现状：**
- ✅ **Sticky Note（便签）已实现**：`AnnotationNodeRenderer`（`reactflow-nodes.tsx:239-286`）
  - 黄色便签风格，略微旋转
  - 可选中（蓝色 ring）
  - 可绑定到其他节点（annotation_target_node_id）
- ✅ "Note" 模板存在于 NodeTemplatePicker 中（annotation 分类）
- ❌ **没有 Canvas Group（分组）**：无法将多个节点圈成可折叠模块
- ❌ 没有分组折叠/展开
- ❌ 没有超过 N 个节点时的自动提示
- ❌ Sticky Note 不支持多种颜色选择（只有默认黄色）
- ❌ 没有 `Shift+S` 快捷键

**差距：中** | Sticky Note 已实现但功能有限；Canvas Group 完全缺失——这对 20+ 节点的工作流至关重要。

---

### 场景 11：保存、发布与协作

**n8n 体验：**
- 保存 ≠ 上线：Draft（自动保存 1-5s）→ Publish → Production
- 生产执行绑定到已发布状态
- 编辑锁：其他人编辑时显示 read-only mode
- 状态清晰：草稿 / 已发布 / 未发布变更 / 错误

**Multica 现状：**
- ✅ 有 Save 按钮（保存 nodeEdits 到服务器）
- ✅ 有 Activate/Deactivate 切换（`workflow.status: "active" | "paused"`）
- ✅ PreflightBar 在发布前检查问题（`preflight-bar.tsx`）
- ✅ 有撤销/重做（undo/redo stack，最多 50 步）
- ❌ **没有"保存 ≠ 上线"的概念**：Save 直接写数据库，Activate 直接切换状态，没有草稿/发布的版本分离
- ❌ **没有编辑锁/协作锁**：没有"其他人正在编辑"的提示
- ❌ 没有回滚到历史版本
- ❌ 没有审计日志
- ❌ 状态只有 active/paused 两种，不如 n8n 的状态丰富

**差距：中** | 基础保存和状态切换可用，但缺少生产级发布流程（草稿→发布→回滚）。

---

## 二、通用 UI 设计对照

### 画布布局与导航

| 特性 | n8n | Multica | 状态 |
|------|-----|---------|------|
| 三区域布局（左导航+顶栏+画布） | ✅ | ✅ 左Stage标签+顶PageHeader+中画布 | ✅ |
| 画布缩放控制（Controls） | ✅ | ✅ ReactFlow Controls | ✅ |
| MiniMap 小地图 | ✅ | ✅ ReactFlow MiniMap | ✅ |
| 自动整理布局 | ✅ | ✅ dagre 自动布局 | ✅ |
| 节点扁平化设计 | ✅ | ✅ 扁平卡片风格 | ✅ |
| 节点悬停工具栏（运行/禁用/删除） | ✅ | ❌ | ❌ |
| 连接点脉冲动效 | ✅ | ❌ | ❌ |
| 贝塞尔曲线连线 | ✅ | ✅ Bezier + Straight | ✅ |

### 节点状态系统

| 状态 | n8n | Multica | 
|------|-----|---------|
| 空闲 | ✅ 灰色边框 | ✅ 默认样式 |
| 运行中 | ✅ 红色发光外框 | ❌ |
| 成功 | ✅ 绿色边框+✓ | ❌ |
| 错误 | ✅ 红色边框+⚠ | ❌ |
| Dirty（数据过期） | ✅ 黄色边框+三角警告 | ❌ |
| 禁用 | ✅ 降低透明度 | ❌ |
| 等待中 | ✅ 虚线边框 | ❌ |

**差距：大** | Multica 的节点目前没有运行时状态可视化。n8n 的"发光外框替代内部加载圈，远距离也能识别状态"是一个精妙的设计决策。

### 执行进度可视化

| 特性 | n8n | Multica |
|------|-----|---------|
| 节点依次点亮 | ✅ | ❌ |
| 连线显示数据量 | ✅ | ❌ |
| 执行历史列表 | ✅ | ❌（仅有 NodeRun 数据） |
| 错误详情面板 | ✅ | ❌（仅有 JSON 输出） |
| 时间旅行调试 | ✅ | ❌ |

---

## 三、关键文件索引

### 已实现的核心文件

| 文件 | 职责 |
|------|------|
| `packages/views/workflows/components/overview/workflow-panorama-page.tsx` | 画布主页面，ReactFlow 容器，数据获取与状态管理 |
| `packages/views/workflows/components/overview/canvas-stage-labels.tsx` | 左侧 Stage 标签栏，Lane 颜色背景 |
| `packages/views/workflows/components/overview/constants.ts` | 布局常量（LANE_HEIGHT、颜色调色板等） |
| `packages/views/workflows/components/overview/node-template-catalog.ts` | 节点模板定义和搜索过滤 |
| `packages/views/workflows/components/overview/node-template-picker.tsx` | 节点选择器 Popover UI |
| `packages/views/workflows/components/overview/preflight-bar.tsx` | 底部发布前检查栏 |
| `packages/views/workflows/components/overview/reactflow-nodes/index.ts` | Panorama 用自定义 ReactFlow 节点类型 |
| `packages/views/workflows/components/overview/reactflow-edges/index.ts` | Panorama 用自定义连线类型 |
| `packages/views/workflows/components/overview/panorama-svg-overlay.tsx` | SVG 连线 Overlay（跨 Stage 正交路由） |
| `packages/views/workflows/components/overview/compact-node-card.tsx` | 紧凑节点卡片 |
| `packages/views/workflows/components/overview/critic-badge.tsx` | Critic 标记节点 |
| `packages/views/workflows/components/node-config-panel.tsx` | 右侧节点配置面板（Config/Data/Runs Tabs） |
| `packages/views/workflows/components/node-data-preview.tsx` | 节点运行数据预览 |
| `packages/views/workflows/components/reactflow-nodes.tsx` | 通用 ReactFlow 节点渲染器（多形状+AnnotationNode） |
| `packages/views/workflows/components/layout.ts` | dagre 自动布局算法 |
| `packages/core/workflows/preflight-checks.ts` | 发布前检查（DAG 环/孤立节点/Worker 缺失等） |
| `packages/core/workflows/store.ts` | Zustand 编辑器状态管理（undo/redo/nodeEdits） |

---

## 四、设计建议优先级

基于 n8n 报告的 9 条设计建议，结合 Multica 当前实现状况：

### P0 — 阻塞性缺失（影响核心工作流可用性）

1. **数据映射**（建议 5）：拖拽字段 + 表达式 + 实时预览。当前只能手写 JSON，门槛极高。
2. **调试能力**（建议 6）：单步执行、Pin/Mock、禁用节点。无调试闭环意味复杂流程无法可靠维护。

### P1 — 高优先级（显著影响用户体验）

3. **节点状态可视化**（建议 6 延伸）：空闲/运行中/成功/失败/Dirty。用户无法从画布判断流程健康度。
4. **连线语义化**（建议 3）：区分数据流/条件流/错误流/AI 子能力连接，连线显示标签和数据量。
5. **条件分支完善**（建议 3 延伸）：IF 节点多输出 + true/false 标签 + Switch 节点 + Merge 节点。
6. **AI Agent 能力可视化**（建议 8）：模型、工具、记忆以子能力连接展示，而不是藏在配置表单里。

### P2 — 中优先级（提升产品完整度）

7. **空白画布引导优化**（建议 1）：按场景推荐触发器入口。
8. **节点库增强**（建议 2）：最近使用、快捷键、推荐节点。
9. **大流程收纳**（建议 7）：Canvas Group（可折叠分组），增强 Sticky Note（多颜色、Markdown）。
10. **发布流程工程化**（建议 9）：草稿/发布分离、编辑锁、回滚。

### P3 — 低优先级（锦上添花）

11. 节点悬停工具栏（运行/禁用/删除/更多）
12. 连接点脉冲动效
13. 执行历史列表视图
14. 时间旅行调试（历史执行回放到画布）
15. 节点配置面板 Input/Output 同屏展示

---

## 五、总结

Multica 的工作流画布在**基础设施层面**投入扎实——ReactFlow 集成、Stage Lane 布局、自定义节点渲染、dagre 自动布局、undo/redo、预发布检查——这些都是正确且必要的。

但与 n8n 的核心差距不在"有没有画布"，而在**画布上传递了多少信息**：

- n8n 的画布让用户**看懂**流程（连线即数据流、颜色即状态、分组即结构）
- n8n 的画布让用户**调试**流程（单步执行、Pin Data、执行回放）
- n8n 的画布让用户**信任**流程（Dirty Node 提示、执行状态可视化）
- n8n 的画布让用户**理解 AI**（Agent 子能力显性化）

Multica 当前画布更接近"节点编辑器"而非"可执行流程编排工作台"。建议按 P0→P1→P2→P3 优先级逐步补齐。

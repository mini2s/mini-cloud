# Workflow UI/UX 差距报告

> 参考资料：`docs/n8n_workflow_canvas_uiux_report.html`  
> 检视对象：当前 Multica Workflow 编辑器、运行页和列表页  
> 检视日期：2026-07-07

## 总体判断

当前 Workflow 已经具备可视化编排的基础能力：ReactFlow 画布、MiniMap、缩放控件、阶段泳道、节点拖拽、右侧配置面板、Preflight 检查、运行详情页和节点运行状态。

与 n8n 报告中的成熟 Workflow 工作台相比，主要差距不在画布组件本身，而在产品心智：现在更像“流程图编辑器”，还没有完全成为“配置、调试、发布、回放一体化的编排工作台”。

第一批最值得做的是：节点能力选择器、空态引导、节点详情数据化、发布前检查常驻、键盘/可访问性补齐。运行回放、Dirty Data、语义边和发布版本模型需要后端模型配合，建议作为第二批单独设计。

## 已具备能力

1. **画布基础设施完整**
   - `packages/views/workflows/components/overview/workflow-panorama-page.tsx`
   - 已使用 ReactFlow、Controls、MiniMap、Background。
   - 支持节点拖拽、连线、删除边、自动布局、主题切换。

2. **阶段化组织已经存在**
   - `packages/views/workflows/components/overview/canvas-stage-labels.tsx`
   - `packages/views/workflows/components/overview/stage-lane.tsx`
   - Workflow 不是纯自由画布，而是通过 Stage 提供业务阶段心智。

3. **右侧配置面板已有雏形**
   - `packages/views/workflows/components/node-config-panel.tsx`
   - 已支持标题、描述、阶段、Format Schema、Worker、Critic 配置。

4. **发布前检查已有基础**
   - `packages/core/workflows/preflight-checks.ts`
   - `packages/views/workflows/components/overview/preflight-bar.tsx`
   - 已覆盖循环、孤立节点、不可达节点、未分配 worker、无效 critic、缺少 stage、schema required 错误。

5. **运行页已有节点状态可视化**
   - `packages/views/workflows/components/workflow-run-page.tsx`
   - `packages/views/workflows/components/node-run-card.tsx`
   - 运行详情页可以看到 DAG 和 Node Run 列表。

## 主要差距

### 1. Add node 入口仍是“形状选择”，不是“能力市场”

当前 `Add node` 提供 Rectangle、Diamond、Pill、Hexagon、Critic 等形状，位置在：

- `packages/views/workflows/components/overview/workflow-panorama-page.tsx`

这会让用户先思考“画什么形状”，而不是“我要添加什么工作能力”。n8n 的核心优势是节点库心智：Trigger、Action、Logic、AI、数据源、通知、最近使用、搜索。

**影响：**

- 新用户不知道第一步该选什么。
- 节点形状暴露过早，业务语义不足。
- 后续扩展插件、Agent、人工审批、条件分支时入口会越来越混乱。

**建议：**

- 将 Add node 改为节点能力选择器。
- 分类至少包含 Trigger、Action、Logic、AI、Human、Annotation。
- 搜索命中 title、description、tag。
- 形状作为模板的默认样式，而不是主入口。

### 2. 空态引导存在，但第一步语义不够收敛

当前空态会提示创建 stage 或添加 node，但有时会直接创建默认矩形节点。

**影响：**

- 用户没有建立“触发器/起点/场景模板”的心智。
- 第一个节点缺少业务语义，后续还要重新命名和配置。

**建议：**

- 空态第一步引导改为“选择起点”。
- 有 Stage 后，点击 Add first step 应打开节点能力选择器。
- 真正空 Workflow 应优先引导创建 Stage 或从模板开始。

### 3. 节点详情面板偏配置表单，缺少调试工作台能力

当前 `NodeConfigPanel` 主要是配置表单。n8n 的节点详情更像工作台：配置、输入、输出、错误、日志在同一上下文。

**影响：**

- 用户无法在编辑页判断节点最近一次运行结果。
- 需要在编辑页和运行页之间来回切换。
- 调试链路长，尤其是 AI Agent 节点失败时。

**建议：**

- 右侧面板拆为 `Config / Data / Runs` tabs。
- `Data` tab 显示该节点最近一次 `WorkflowNodeRun` 的状态、worker output、critic output、critic comment。
- `Runs` tab 第一批可复用 Data preview；后续再扩展为节点历史运行列表。

### 4. 运行数据和编辑画布割裂

运行详情页可以看 DAG 和 NodeRun，但编辑页不能加载某次历史运行作为调试上下文。

**影响：**

- 生产失败无法直接带回编辑器定位。
- 无法区分“当前配置生成的数据”和“旧配置留下的数据”。
- Dirty Node、Pin Data、Mock Data 无从表达。

**建议：**

- 第一批先在编辑面板显示最近运行数据。
- 第二批设计 `Open run in editor`、Dirty/Stale 标记、Pin/Mock 数据存储。
- Dirty 判断建议基于 `node.updated_at` 与 `nodeRun.completed_at`。

### 5. Save、Publish、Activate 心智混在一起

当前顶部按钮更接近 Activate/Deactivate，Preflight 只在有问题时出现。n8n 报告强调保存、发布、启用、回滚、协作锁应分层。

**影响：**

- 用户不清楚保存是否等于上线。
- 有未保存改动时，发布语义不明显。
- Preflight 通过时反而没有持续的“可发布”反馈。

**建议：**

- 第一批让 Preflight bar 常驻，只要 Workflow 非空就显示。
- 明确文案：
  - 有阻断：显示问题并禁用发布。
  - 有未保存：显示“发布前请先保存更改”。
  - 无问题且已保存：显示“已保存，可以发布”。
  - Active：显示“工作流已发布并启用”。
- 第二批再做真正的 draft/published revision 模型。

### 6. 连线缺少业务语义

当前边主要通过 stage 颜色和 critic 虚线表达关系。n8n 报告建议区分数据流、条件流、错误流、AI 子能力连接。

**影响：**

- 复杂流程中用户看不出分支条件。
- 失败路径、返工路径、审批路径容易混在一起。
- 画布可读性随节点数量增长快速下降。

**建议：**

- 第一批不改边模型，只保留现状。
- 第二批为 `WorkflowEdge.condition` 设计结构化约定，例如 `{ kind, label, severity }`。
- 渲染层根据 kind 展示 label、颜色、虚线或错误路径样式。

### 7. 节点状态表达偏弱

编辑页节点主要显示名称和 worker 状态。运行页有状态色，但编辑页缺少未运行、成功、失败、等待输入、旧数据、Mock、Pinned 等状态。

**影响：**

- 用户无法从编辑画布快速判断哪个节点需要处理。
- “未配置”和“运行失败”容易被分散到不同页面。

**建议：**

- 第一批先在右侧 Data tab 呈现最近运行状态。
- 第二批建立统一节点状态层，并回填到画布节点。

### 8. 键盘和可访问性需要补齐

当前 ReactFlow 节点主体是 `div`，主要依赖鼠标点击。对于工作流编辑器，键盘选择、Enter 打开详情、Delete 删除、Esc 关闭面板都是基础体验。

**影响：**

- 可访问性不足。
- 高频用户操作效率低。
- 测试上也难覆盖关键交互语义。

**建议：**

- Compact worker node 增加 `role="button"`、`tabIndex=0`、`aria-label`。
- Enter/Space 打开右侧面板。
- 后续再补快捷键提示和命令面板。

## 推荐优先级

### P0：第一批立即实施

1. Add node 能力选择器。
2. 空态 Add first step 打开选择器。
3. Node panel 拆为 Config/Data/Runs。
4. Preflight bar 常驻，明确保存/发布状态。
5. Compact worker node 键盘与 ARIA。

这些只需要前端改动，不需要 API 和数据库变更。

### P1：需要前后端协同

1. 语义边：condition/error/rework/critic/data。
2. Run replay：从历史运行打开编辑器上下文。
3. Dirty/Stale 数据：标记旧输出是否可信。
4. Pin/Mock 数据：局部调试和重复执行。

### P2：生产级发布模型

1. 草稿版本与已发布版本分离。
2. 回滚和审计日志。
3. 协作锁或多人编辑提示。
4. 发布权限和审批流。

## 结论

当前 Workflow UI 的基础设施已经可用，下一步不应继续堆画布功能，而应把入口、详情、调试和发布心智打通。第一批优化完成后，用户会更容易理解“我该添加什么节点”“这个节点配置是否完整”“最近一次运行发生了什么”“现在能不能发布”。这会显著提升 Workflow 从 demo 画布到真实工作台的可用性。

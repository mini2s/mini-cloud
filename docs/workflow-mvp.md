### 6.1 MVP 范围

#### 6.1.1 Workflow（独立模块）

| 模块 | 内容 | 说明 |
|------|------|------|
| Workflow 编辑器 | 单视图 DAG 画布 + Stage 泳道；编辑模式与运行模式共享同一画布基础设施 | Workflow 的可视化搭建入口，独立于 Issue 存在 |
| 节点创建 | AI 辅助创建 + 面板拖入 + 端口拖出连线创建 | 三种创建路径均在编辑器画布中完成 |
| 节点配置面板 | 右侧抽屉，选择 Worker/Critic 人选 + 填写 JSON Schema；AI 辅助生成 Schema 内容 | 配置的是 Workflow 定义中的节点模板，非运行时实例 |
| 静态预检查 | DAG 环检测 + 必填字段校验 + Worker/Critic 引用存在性校验 | 发布前阻断，确保 Workflow 定义合法 |
| 发布流程 | draft/active 状态分离 + 「发布并测试」一键链路 | Workflow 自身的生命周期管理 |
| 模板中心 | 5 个官方预置模板 + 从模板克隆到工作区 | 降低 Workflow 创建门槛，模板是 Workflow 定义级别的概念 |
| 运行记录 | Workflow 维度的历史 Run 列表（触发 Issue、时间、状态、节点完成数） | Workflow 列表页/详情页中查看，非 Issue 视角 |
| 权限控制 | `can_manage_workflows` 权限 + Workflow 级操作鉴权（创建/编辑/发布/归档/删除） | Workflow 作为独立资源的访问控制 |

#### 6.1.2 Issue × Workflow 集成

| 模块 | 内容 | 说明 |
|------|------|------|
| Issue 分配 Workflow | Issue 详情页 Assignee 选择器中切换至 Workflow Tab，选择后触发 WorkflowRun | Issue 是 Workflow 的唯一触发入口（MVP 范围内） |
| Issue 全景图 | 复用编辑器画布基础设施 + 运行时状态叠加 + 自适应节点卡片 + 全局提示栏 + 右侧详情面板 | Issue 详情页中的只读 Workflow 执行视图，属于 Issue 页面的一部分 |
| 运行时快照 | WorkflowRun 创建时序列化完整 Workflow 定义至 `workflow_snapshot` 字段，后续执行以快照为准 | 防止定义漂移，保证 Issue 上的 Run 不受 Workflow 编辑影响 |
| 失败恢复（在 Issue 上操作） | 重试 + 跳过 + 手动完成；修改配置后重试，可选「仅本次生效」或「更新 Workflow 配置」 | 操作入口在 Issue 全景图的节点卡片上 |
| 人工介入（在 Issue 上操作） | 内嵌操作按钮 + 接手/交还/完成流程 | 操作入口在 Issue 全景图的 blocked 节点卡片上 |
| Critic 审核（在 Issue 上操作） | 通过/打回按钮内嵌在 awaiting_critic 节点卡片上 | 审核者无需离开 Issue 页面即可完成审核 |
| 全屏/详情切换 | Issue 详情页中全景图的全屏/嵌入两种展示模式 Toggle | Issue 页面内的视图切换，非独立页面 |

### 6.2 两个层面的职责边界

| 维度 | Workflow（独立模块） | Issue × Workflow（集成层） |
|------|---------------------|--------------------------|
| **核心用户** | 搭建者（创建和维护 Workflow） | 使用者、审核者（在 Issue 上下文中与 Workflow 交互） |
| **核心入口** | 左侧导航 → Workflows → 列表/编辑器 | Issue 详情页（分配 Workflow 后自动展示全景图） |
| **数据所有权** | Workflow 定义、Stage、Node、Edge、模板 | WorkflowRun、WorkflowNodeRun（运行时实例，归属 Issue） |
| **操作对象** | Workflow 定义（节点模板、连线、配置） | Workflow 运行时实例（节点状态、产出、审核决策） |
| **状态管理** | draft / active / paused / archived（Workflow 生命周期） | pending → … → completed / failed / skipped / cancelled（NodeRun 状态机） |
| **画布行为** | 可编辑（拖拽、连线、配置） | 只读渲染（不可移动节点，可点击查看详情、执行操作） |

### 6.3 MVP 不做什么（明确排除）

以下需求在 MVP 中明确不做，避免范围蔓延：

| 不在 MVP 的诉求 | 说明 |
|------|------|
| 在 Workflow 列表/编辑器中直接查看某个 Run 的实时全景图 | 全景图仅在 Issue 详情页中展示，Workflow 侧只提供运行记录列表（触发 Issue、时间、状态摘要） |
| 在 Issue 详情页中编辑 Workflow 定义 | 全景图是只读的，编辑 Workflow 定义需回到 Workflow 编辑器 |
| Workflow 独立于 Issue 触发（定时/Webhook/手动） | MVP 中 Workflow 的唯一触发方式是被 Issue assign |
| 一个 Issue 同时运行多个 Workflow | MVP 中一个 Issue 同一时间只能关联一个 WorkflowRun |
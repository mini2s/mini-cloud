# Workflow 默认边界与执行身份卡片设计

## 背景与目标

新建空白 workflow 当前只有主记录，用户进入画布后还要手动添加 Start 和 End。节点卡片虽然已经分成执行者与审核者两个槽位，但只显示名称和配置状态圆点，数智人、成员、研发角色和小队难以快速区分，也没有利用已有头像与数智人在线状态。

本次改动实现两个目标：

- 今后新建的空白 workflow 原子地包含 Start 和 End。
- 编辑画布与运行画布中的执行者、审核者采用“身份优先”布局，明确展示头像、名称、实体类型，并仅为数智人展示在线状态。

## 已确认范围

包含：

- 非模板方式创建 workflow 时，后端同时创建一个 Start 和一个 End。
- Start 和 End 继续保留在节点模板目录中；已有同类节点时沿用当前禁用规则。
- 数智人、成员、小队优先展示个性化头像，并提供类型对应的降级外观。
- 未解析的研发角色展示固定角色图标；运行时解析到具体执行者后展示实际身份与头像。
- 数智人展示带文字的在线状态；其他实体不展示在线状态。
- 移除执行者、审核者槽位现有的绿色、蓝色、黄色配置状态圆点。

不包含：

- 不迁移或自动修复既有 workflow。
- 不自动连接 Start 和 End，也不改变边界节点当前的运行语义。
- 不为成员、小队或研发角色引入新的 presence 数据。
- 不新增头像上传能力；复用实体已有的 `avatar_url`。
- 不移除 Start/End 手动节点模板。

## 方案选择

### 默认边界节点

采用后端事务创建。`CreateWorkflow` 在一个数据库事务中创建 workflow、Start 和 End，任一步失败则整体回滚。相比前端串行调用，这避免用户导航或网络失败留下半成品；相比数据库触发器，业务规则继续显式位于 workflow 写入路径中，便于测试和维护。

仅无 `template_id` 的普通创建路径增加默认节点。模板克隆继续完整复制模板自己的节点和边，避免重复边界节点。历史 workflow 的读取路径不补节点。

### 卡片布局

采用视觉确认的 A“身份优先”方案。每个槽位保持以下层级：

```text
执行者 / 审核者
[头像或类型图标] 名称
                 实体类型  [数智人在线状态]
```

头像是第一视觉锚点，槽位职责是结构标签，实体类型和在线状态是辅助元数据。状态必须同时包含图标与文字，颜色只作增强，不作为唯一信息载体。

## 后端设计

### 原子创建

普通 `CreateWorkflow` 路径通过 `TxStarter.Begin` 开启事务，并使用 `Queries.WithTx(tx)`：

1. 创建 draft workflow。
2. 创建 Start 节点。
3. 创建 End 节点。
4. 提交事务。
5. 提交成功后发布 `workflow:created` 事件并返回响应。

节点使用现有 `CreateWorkflowNode` 查询，不增加表或迁移。字段约定：

| 字段 | Start | End |
| --- | --- | --- |
| `title` | `Start` | `End` |
| `format_schema.type` | `start` | `end` |
| `format_schema.shape` | `pill` | `pill` |
| `format_schema.template_id` | `workflow-start` | `workflow-end` |
| `format_schema.template_category` | `trigger` | `trigger` |
| `position_x` | `120` | `600` |
| `position_y` | `0` | `0` |
| `stage_id` | `NULL` | `NULL` |
| actor 字段 | 空 | 空 |

`worker_type` 与 `critic_type` 使用边界节点现有占位值 `human`，worker、critic、role ID 以及 critic API URL 均为空。Start 的 `sort_order` 为 0，End 为 1。两个节点不创建边。

创建响应的 `node_count` 返回 2，而不是当前的 0。事件载荷使用同一响应，客户端列表无需额外乐观修补。事务开始、节点创建或提交失败时返回 500，并依赖 defer rollback 清理未提交数据；提交前不发布事件。

### 既有约束

数据库的边界类型唯一索引继续作为并发兜底。手动创建 API、类型不可变校验、边方向校验和运行时过滤逻辑不变。新 workflow 已有边界节点时，前端会通过现有 `disabledBoundaryTemplateIds` 禁用对应模板；删除任一边界后，该模板重新可用。

## 前端身份模型

### 槽位数据

扩展共享 `WorkflowActorSlot` 的输入，使展示信息显式传入，而不是由组件猜测：

- 槽位：`worker` 或 `critic`。
- 名称。
- 实体类型：`agent`、`member`、`squad`、`role`、既有 API 审核者或未配置。
- 实体 ID，可为空。
- 头像 URL 与姓名缩写。
- 数智人 availability，可为空。
- 状态：已配置、可选、缺失或解析中。

编辑画布在 `workflow-panorama-page` 的数据组装层通过 `useActorName` 取得名称、缩写和头像 URL。页面使用 `useWorkspacePresenceMap(wsId)` 一次性取得全部数智人状态，再按 ID 写入节点 data；不允许每个卡片分别订阅 agent、runtime 和 task snapshot 查询。

运行画布沿用实际 node run 的 worker/critic 类型和 ID。研发角色尚未解析时显示 role；解析完成且 node run 已有具体 actor 后，显示具体实体类型、头像和数智人状态。

### 类型与降级外观

- 数智人：圆形个性头像；无头像时使用 `Bot` 图标。
- 成员：圆形个人头像；无头像时使用姓名缩写。
- 小队：圆角方形小队头像；无头像时使用 `Users` 图标。
- 研发角色：中性圆角方形底的角色图标，不伪造个人头像。
- API 审核者：中性圆角方形底的 API 图标，保留现有 `critic_type: "api"` 展示能力。
- 未配置：中性虚线占位图标，并显示“未配置”或“可选”。

复用 `@multica/ui` 的基础 `ActorAvatar`，避免在业务组件重新实现图片加载失败和类型降级。画布卡片内头像不启用 profile link 或 hover card，防止在 React Flow 节点按钮中嵌套交互控件。

### 在线状态

只有实体类型为 `agent` 且存在具体 agent ID 时显示状态：

- availability 为 `online`：显示在线图标和“在线”。
- availability 为 `offline`：显示离线图标和“离线”。
- availability 为 `unstable`：按不可可靠接单处理，显示离线图标和“离线”，详细健康原因仍留在现有数智人详情界面。
- presence 数据加载中：暂不显示状态，避免抖动的占位文案。

成员、小队、研发角色、API 审核者以及未配置槽位不显示在线状态。状态文案加入 `workflows` 中英文 locale，并遵守现有“数智人”术语。

### 尺寸与排版

普通节点继续使用稳定的 `296 x 152` 尺寸。执行者和审核者保持两列，每列包含 24px 身份图形、最多两行的名称/元数据。名称溢出时截断并保留 `title`；类型标签不可压缩。Start/End 边界节点外观与尺寸不变。

现有 `WorkflowActorSlot` 的彩色状态圆点全部移除。配置是否缺失由占位图形和明确文字表达，数智人在线状态由图标加文字表达。

## 数据流

```text
CreateWorkflow request
  -> workflow + Start + End transaction
  -> response(node_count = 2)
  -> React Query invalidates workflow list
  -> detail queries load the persisted boundary nodes

workspace actors + presence map + workflow node/run
  -> page-level display data assembly
  -> WorkflowActorSlot
  -> avatar/type fallback + optional agent availability
```

## 错误与兼容处理

- 默认节点创建失败时不返回已创建 workflow ID，也不发布 WebSocket 事件。
- API 响应结构不变，仅 `node_count` 的值从 0 变为 2，因此无需客户端 schema 变更。
- 旧服务端创建出的空 workflow 仍可被新前端正常打开，并可通过保留的模板手动添加边界节点。
- 旧桌面客户端接收带默认节点的新 workflow 时仍使用既有节点响应结构。
- 头像 URL 加载失败由基础头像组件降级；presence 查询失败按现有 map 语义降级为离线或无状态，不阻断卡片渲染。

## 测试策略

### Go

- 普通创建成功后持久化恰好一个 Start 和一个 End，字段、顺序和坐标正确。
- 创建响应及发布事件的 `node_count` 为 2。
- 第二个节点创建失败时 workflow 与第一个节点均回滚，且不发布事件。
- 模板创建路径不额外插入 Start/End。
- 既有唯一性、边方向与运行过滤测试继续通过。

### TypeScript / React

- 节点模板仍包含 Start/End，已有对应节点时禁用，删除后恢复可用。
- 数智人显示头像、类型和在线/离线文字；状态加载中不显示错误状态。
- 成员、小队、研发角色和 API 审核者使用各自头像或图标降级，且不显示在线状态。
- 研发角色解析后切换为实际执行者身份。
- 未配置与可选槽位不再渲染彩色状态圆点。
- 长名称在固定卡片尺寸内不撑开布局。
- 编辑画布只建立一次 workspace presence map 订阅。

## 成功标准

- 每个今后新建的空白 workflow 首次打开时已经包含可移动、可删除的 Start 和 End。
- Start/End 仍可从节点模板手动添加，且唯一性禁用行为保持正确。
- 创建过程不会留下只有 workflow 或只有一个边界节点的半成品。
- 用户无需依赖颜色即可区分执行者/审核者职责、四类实体和数智人的在线状态。
- 有头像时优先显示个性化头像，无头像或角色未解析时稳定降级。
- 编辑与运行卡片保持统一视觉，并不引入逐卡片的重复 presence 查询。

## 与既有设计的关系

本设计前向修订 `2026-07-22-workflow-boundary-nodes-design.md` 中“始末节点均为可选、仅手动添加”的产品默认值：历史数据和运行语义仍保持可选，但今后通过普通创建入口产生的 workflow 默认带有两个边界节点。其他边界节点约束与交互继续以原设计为准。

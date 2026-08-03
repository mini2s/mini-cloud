# 工作流运行详情新画布设计

## 目标

将工作流运行历史中的单次运行详情从旧 `DAGCanvas` 切换到当前 issue 执行详情使用的 `ExecutionPanoramaPage`，使编辑态与运行态使用统一的新画布视觉和交互，同时保留运行状态、运行策略、取消运行和角色分配能力。

## 范围

- 修改 `packages/views/workflows/components/workflow-run-page.tsx`。
- 更新该页面现有单元测试，覆盖新画布接入和旧视图移除。
- 不修改 API、React Query 缓存结构、运行状态机或路由。
- 不重构 `ExecutionPanoramaPage`，本次直接复用其公开接口。

## 页面结构

页面继续保留现有顶部区域：

- 工作流标题。
- 运行状态与运行策略。
- 可取消状态下的取消按钮及确认弹窗。
- 角色解析提示条。

顶部区域下方改为横向布局：

- 主区域渲染 `ExecutionPanoramaPage`，传入 `workflowId`、`runId`、`wsId`、从运行输入解析出的可选 `issueId`，并启用 `fillAvailableHeight`。
- 存在角色解析记录时，右侧保留角色分配面板；没有角色解析记录时不占用侧栏宽度，画布铺满剩余空间。
- 删除旧 `DAGCanvas`、旧节点运行卡片列表和页面自身维护的拆分节点详情面板。节点详情、重试、会话入口和拆分评审统一由新画布管理。

## 数据流

`WorkflowRunPage` 继续查询运行记录、节点运行记录、角色解析记录和成员列表，用于顶部状态和角色分配。`ExecutionPanoramaPage` 使用现有 workflow 查询选项获取阶段、节点、边、节点运行状态及画布摘要。

两者对节点运行记录的查询键一致，由 React Query 合并并复用缓存；不将服务端数据复制到 Zustand，也不增加新的状态源。WebSocket 仍通过既有查询失效机制刷新画布。

## 交互与异常

- 新画布保持只读，允许缩放、平移、小地图导航和节点选择。
- 节点单击打开新详情面板；拆分节点沿用新画布的展开和评审流程。
- 角色分配提交、冲突刷新、失败提示和重试行为保持不变。
- 取消运行行为和确认弹窗保持不变。
- 运行不存在、查询加载和无节点状态分别沿用现有页面或新画布的既有处理。

## 测试

- 页面渲染时断言 `ExecutionPanoramaPage` 收到正确的 `workflowId`、`runId`、`wsId`、`issueId` 和 `fillAvailableHeight`。
- 断言旧 `DAGCanvas` 和旧节点运行列表不再渲染。
- 保留并运行角色分配、角色解析提示、运行状态及取消运行测试。
- 运行 `workflow-run-page.test.tsx`、`workflow-run-page.roles.test.tsx` 和 `@multica/views` TypeScript 检查。

## 非目标

- 不改变运行历史列表页。
- 不为新画布增加新的视觉样式或运行能力。
- 不抽取新的跨领域画布抽象。
- 不修改 issue 执行详情中的新画布行为。

# 动态任务拆分 UI/UX E2E 测试报告

> 测试日期：2026-07-13  
> 测试环境：localhost:3000 / workspace: demo111  
> 测试账号：kdemo648@gmail.com  
> 测试工具：playwright-cli  
> 测试依据：`docs/superpowers/specs/2026-07-13-dynamic-task-splitting-uiux-e2e-test-plan.md`

## 测试结论

本次按 UI/UX 专项测试方案检查动态任务拆分相关界面。Split 节点、运行状态、任务列表、DAG、取消确认和父 Issue 执行全景均可访问，核心信息没有白屏或阻断级错误。

主要问题集中在 Split 审核/执行面板的信息密度与可扫描性：任务卡过高、DAG 位置过深、终态仍保留大量编辑控件，导致用户难以快速理解子任务和依赖关系。另有 API schema warning、部分图标按钮缺少可访问名称、看板工作流标识截断等问题。

## 测试范围

| 场景 | 状态 | 说明 |
| --- | --- | --- |
| 编辑器配置体验 | 已测试 | `playwright split parent` 工作流，Split 节点配置面板 |
| 待审核状态可发现 | 部分测试 | 未获得 `awaiting_split_review` live fixture，使用 split run 入口验证可发现性 |
| 审核/执行面板易用性 | 已测试 | `split_active`、`cancelled`、`pipeline/completed` 三类 run |
| 依赖 DAG 可理解 | 已测试 | Split review 面板中的 Task graph |
| 运行中聚合进度 | 已测试 | `split_active` run，2 running / 1 ready |
| 父 Issue 进度面板 | 已测试 | DEM-36 执行全景与顶部聚合信号 |
| 取消与危险操作 | 已测试 | Split 面板内 `Cancel split` 二次确认；未执行最终确认 |
| 空态、错误态和重试 | 未充分覆盖 | 未模拟 Agent 生成失败、提交失败、创建失败 |

## 关键发现

### 1. Split 面板信息密度过高

- 严重程度：中
- 位置：Split review 侧栏，`split_active` / `cancelled` / `pipeline` 场景
- 现象：520px 侧栏内每个任务卡包含标题、描述、依赖复选框等完整编辑字段。3 个任务时第三个任务和 DAG 均落到首屏外。
- 影响：用户无法在首屏快速理解子任务、依赖和整体状态，不符合测试方案中“审核面板能快速理解子任务、依赖、负责人和创建结果”的目标。

### 2. DAG 可理解但发现性弱

- 严重程度：中
- 位置：Split review 面板 `Task graph`
- 现象：DAG 节点编号和任务列表能对应，连线方向可读；但 DAG 位于任务列表之后，active 场景中需要滚动很久才能看到。
- 影响：依赖关系不是第一眼可见，用户需要在列表和图之间来回滚动。

### 3. 缺少固定底部主操作区

- 严重程度：中
- 位置：Split review 面板
- 现象：操作区位于顶部，长列表滚动时没有固定可见的确认/取消/主操作区域。
- 影响：审核态下如果出现“确认创建”主操作，长列表场景会降低可达性。

### 4. 终态仍以编辑表单呈现

- 严重程度：低到中
- 位置：`cancelled`、`pipeline/completed` Split 面板
- 现象：终态任务仍展示可编辑式的 Title / Description / Dependencies 控件。
- 影响：阅读成本偏高；终态更适合只读摘要布局，突出状态、产物、子 issue 和异常。

### 5. 工作流 Issue 卡片标识截断

- 严重程度：低
- 位置：Issue 看板中的工作流卡片
- 现象：工作流标识显示为类似 `全(`，语义不完整。
- 影响：用户难以识别具体工作流。

### 6. API schema warning

- 严重程度：低到中
- 位置：控制台
- 现象：`GET /api/workflows/:id/runs/:runId` 出现 schema validation warning，提示响应有 3 个 schema issues。
- 影响：未造成白屏，但属于 API 兼容层风险，应跟进 schema 与实际响应是否漂移。

### 7. 部分图标按钮缺少可访问名称

- 严重程度：低
- 位置：顶部工具栏、聊天面板部分图标按钮
- 现象：Playwright 快照中若干 button 无文本、无 aria-label。
- 影响：键盘和屏幕阅读器用户难以理解按钮用途。

## 通过项

- 登录 `demo111` 后按要求关闭右侧聊天面板，主内容区域未被遮挡。
- Split 节点在编辑画布上有独立图标、标题和 `barrier · concurrency 5` 摘要。
- Split 配置项顺序基本符合任务心智：子模板、执行模式、最大并发、最大失败数。
- `barrier` / `pipeline` 切换时，`max_failures` 会按模式隐藏或显示，未见明显布局跳动。
- Split run 页面中，画布节点和右侧 Node Runs 均能展示 `拆分执行中`、`已取消`、`已完成` 等文本状态。
- `Open split details` 入口可见，不依赖隐藏 hover。
- Split 面板摘要能展示 `2 running · 1 ready`、`2 cancelled`、`1 running · 1 ready`。
- 取消确认框文案明确说明会停止未完成子任务和子 issue，默认焦点在 `Keep running`，误操作回退路径清晰。
- 状态表达有文本和图标，不只依赖颜色。
- 核心接口最终请求返回 200；中途 `ERR_ABORTED` 主要由快速页面跳转造成。

## 未覆盖或需复测

- 未获得 live `awaiting_split_review` fixture，因此未完整验证审核态的新增、删除、勾选/取消勾选、`确认创建 (N)`。
- 未模拟 Agent 生成中、生成失败、审核提交失败、创建子 issue 失败等错误态。
- 未执行最终 `Confirm cancel`，避免污染运行中测试数据。
- 顶部 Issue 执行全景筛选按钮曾出现自动化定位异常并跳到 `/agents`，需人工或稳定 locator 复测。
- 未做移动端或小屏覆盖；本次重点为 1920x1080 桌面视口。

## 建议

1. 将 Split 面板拆成“摘要 + 紧凑任务列表 + DAG”优先布局，编辑字段改为展开式。
2. 将 DAG 提升到首屏，或提供列表/DAG 分栏、tabs、迷你 DAG 固定预览。
3. 审核态和终态使用不同布局：审核态强调选择与确认，终态强调状态与结果。
4. 为 Split 面板补固定底部操作区，保证长列表中主操作始终可达。
5. 跟进 `GET /api/workflows/:id/runs/:runId` schema warning。
6. 补齐图标按钮 `aria-label` 或可见 tooltip 名称。

## 证据记录

- Active run：`/demo111/workflows/7ad0874a-7159-4fc6-9789-3b1cd5f8f4c1/runs/d2a55aee-7c5b-404c-b8a0-52294af2ce1d`
- Cancelled run：`/demo111/workflows/d4b7618e-f17a-4f2b-ac62-01140d087dcc/runs/58c5eb19-2d18-4761-bbd4-f6121b5b4a62`
- Pipeline run：`/demo111/workflows/29464a80-205c-46b0-aaeb-bb5a4b82c2a2/runs/9fbb07d1-8fe5-457b-860d-691e5793e110`
- 父 Issue：`/demo111/issues/b27c98ed-93d8-4ae4-881c-0ddcdb9b7003`


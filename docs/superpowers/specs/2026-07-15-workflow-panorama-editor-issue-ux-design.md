# Workflow 编辑器与 Issue 全景图 UX 优化 Spec

## 背景

当前 workflow 编辑器和 issue 运行全景图已经具备画布、节点卡片、运行详情和 split 子 issue 展开能力，但用户在使用时仍会遇到几类认知负担：

- 连线颜色偏浅，依赖关系需要仔细辨认。
- Worker 与 Critic 在部分视图中容易被理解成两个流程节点，弱化了“一个业务步骤内两个角色”的语义。
- 运行态主要依赖局部图标表达状态，用户不能一眼判断流程走到哪里、哪些节点已完成、哪些被阻塞。
- 运行详情面板既要简洁，又不能丢掉 split 审核/进度工作台的既有能力。
- 编辑态与运行态画布的节点语言不完全一致，增加了从配置到执行的切换成本。
- Split 节点产生的子 issue 需要在父 issue 中持续展示进度，并能跳转到子 issue 详情。

本 spec 综合以下输入：

- 原始优化清单：连线可见性、Worker/Critic 合并、全局进度、详情面板、编辑/运行一致性、子 issue 进度。
- `docs/workflows/dynamic-task-splitting.md`：作为 split 子任务语义参考。
- `docs/superpowers/specs/2026-07-14-dynamic-task-splitting-design-frontend.md`：作为 split 审核/进度面板能力约束。
- 竞品参考：n8n 的执行态画布反馈、Dify 的运行证据与 human input 心智、Coze/FlowGram 的局部展开隐喻。竞品只作为体验参考，不改变 Multica 的 issue/workflow 模型。

## 目标

1. 提升 workflow 依赖关系的可见性，让用户不用放大画布也能看清主流程。
2. 将 Worker 与 Critic 合并表达在同一节点内，避免流程图语义误导。
3. 在运行态画布直接展示全局进度、当前路径、完成节点、阻塞节点和等待节点。
4. 重新定义运行详情面板的信息层级：普通节点保持简洁，Split 节点保留审核/进度工作台能力，子 issue 节点提供清晰跳转。
5. 保持编辑态与运行态画布风格一致，允许运行态因状态信息略大或更密。
6. 在父 issue 的运行全景中展示 split 子 issue 的聚合进度、展开态状态和子 issue 详情跳转。
7. 将 workflow 编辑器配置面板纳入同一套 UX 设计，使配置态和运行态从用户任务上清晰分工。

## 非目标

- 不做节点 ID 编号，如 `#1-1`。
- 不把普通 workflow node 映射成 issue。只有 Split Node 产生的才是子 issue。
- 不新增无限嵌套或三层以上子任务展示。
- 不做完整单节点重跑/debug mode。
- 不做全局 Dify Variable Inspector；证据、Transcript、Session 作为二级入口。
- 不重写 split 审核流程为手动表单编辑、DAG 编辑器或拖拽排序。
- 不引入新的视觉体系、字体、重投影卡片或大面积装饰效果。

## 用户任务模型

### 编辑态：配置工作台

用户在 workflow 编辑器中要完成的任务是：

1. 看懂流程结构和节点依赖。
2. 选中节点后判断配置是否完整。
3. 配置节点目标、Worker、Critic、Split 行为和上下游关系。
4. 保存变更并可选试跑。

编辑态不应该强调运行证据，也不应该让用户误以为 Critic 是独立执行路径。配置面板应按用户决策顺序组织，而不是按后端字段顺序堆叠。

### 运行态：执行全景与诊断

用户在 issue 运行全景图中要完成的任务是：

1. 一眼看出流程走到哪里。
2. 找到已完成、运行中、阻塞、等待输入的节点。
3. 选中节点后理解当前状态、交付物、阻塞原因和下一步动作。
4. 对 Split 节点查看子 issue 聚合进度，必要时展开子 issue 并跳转详情。

运行态应优先服务“判断与推进”，技术细节默认收起。

## 视觉与交互原则

### 统一画布语法

编辑态和运行态都使用同一套节点卡片语义：

- 节点标题在顶部，单行截断。
- 节点类型或运行状态在右上角 badge。
- Worker 与 Critic 在卡片内部以双栏角色区展示。
- 节点底部展示当前视图最重要的 meta：编辑态为配置完整度，运行态为产物、运行状态、子 issue 摘要或操作入口。
- Split 节点和普通节点保持同一容器语言，Split 可在内部展示 progress summary。

运行态可以增加状态色、耗时、子 issue summary 等信息，但不能改变“这是同一个节点”的基本识别。

### 状态色

- Completed：绿色边框、绿色连线、低饱和背景。
- Running/current：蓝色边框、蓝色连线，可有轻微光晕，但不做持续动画。
- Blocked/failed：红色边框、红色虚线或高对比连线。
- Waiting/pending：slate/灰色连线，透明度高于现状，不能淡到不可见。
- Awaiting human input/review：amber，表示需要人决策，不等同于失败。

颜色必须配合文字/badge，不只依赖颜色表达状态。

## 画布连线

### 编辑态连线

编辑态连线默认要比当前更清晰：

- 默认 stroke 提升到约 `2.5-3px` 的视觉强度。
- 默认 opacity 不低于约 `0.7`。
- 箭头颜色与线色一致。
- selected/hover edge 使用 primary 蓝色，stroke 进一步加粗。
- stage、背景网格和节点阴影不得抢过连线优先级。

编辑态边标签保持克制。只在有明确选择、错误、关键依赖或调试信息时显示，不默认给所有边加 label。

### 运行态连线

运行态连线承担状态表达：

- 已完成路径：绿色实线。
- 当前运行路径：蓝色实线，可轻微强调。
- 阻塞路径：红色虚线。
- 等待路径：灰色实线，仍需清晰。

运行态边标签用于解释业务进度，不展示技术字段名：

- `2 artifacts`
- `4 child issues`
- `blocked`
- `waiting for child issues`
- `ready`

边标签只在关键连线上显示，避免画布噪音。

## Worker 与 Critic 合并

Worker 与 Critic 在流程图上必须合并到同一节点卡片内部。

### 编辑态

编辑态节点内部展示：

- Worker：当前执行角色、配置状态。
- Critic：当前验收/审阅角色、配置状态或 optional。
- 缺失项直接在节点 meta 或配置面板 readiness 中体现。

不得再把 Critic 渲染成独立的流程节点或 badge node，从而避免用户误以为 Critic 是下游步骤。

### 运行态

运行态节点内部展示：

- Worker：运行中的 actor 或最终执行者。
- Critic：审阅者、审核者或未配置状态。
- 当前状态仍由节点右上角 badge 和外边框表达。

对于 Split Node，Critic 语义可表现为 reviewer/critic，但仍是节点内部角色，不是单独节点。

## Workflow 配置面板

配置面板是“配置工作台”，服务于配完整、配正确、能保存试跑。

### 信息顺序

1. **Readiness**
   - 配置完成度。
   - 缺失项。
   - 最近试跑状态。
   - 保存前风险。

2. **Node intent**
   - 标题。
   - 描述。
   - Stage。
   - 节点类型说明。
   - 对 Split Node，明确说明“此节点会从父 issue 生成 child issues”。

3. **Worker and Critic**
   - Who does the work?
   - Who confirms the result?
   - Worker/Critic 作为同一节点内两个角色。
   - 缺失项直接提示，不让用户到保存时才发现。

4. **Split behavior**，仅 Split Node 展示
   - Child workflow。
   - Downstream release mode：
     - `After child issues finish`，对应 barrier。
     - `After child issues are created`，对应 pipeline。
   - Concurrency：例如 `Up to 5 child issues at once`。
   - Failure tolerance：例如 `Stop parent after 1 failed child issue`。

5. **Connection summary**
   - 上游节点摘要。
   - 下游节点摘要。
   - 只做确认，不替代画布。

6. **Actions**
   - Save changes。
   - Test run。
   - Delete node。

### 文案原则

配置文案应从用户任务出发：

- 使用 `Who does the work?` 而不是 `worker_id`。
- 使用 `Who confirms the result?` 而不是 `critic_id`。
- 使用 `When can downstream continue?` 而不是只显示 `mode`。
- 使用 `How much work can start at once?` 而不是只显示 `max_concurrency`。

技术字段可以作为开发者调试信息存在，但不进入默认配置主路径。

## 运行全景图

运行态画布必须让用户不打开详情面板也能理解整体状态。

### 顶部全局进度

运行态画布顶部增加或强化全局进度条/摘要区：

- completed count。
- running/current count。
- blocked/failed count。
- waiting/pending count。
- elapsed time。
- current node/path。

摘要区不替代画布状态，而是提供全局扫描入口。

### 节点状态

每个节点以边框、badge、role 区和底部 meta 表达状态：

- Completed：显示产物入口或 latest run。
- Running：显示当前 actor、session 入口。
- Blocked：显示 blocker 简述或打开 blocker。
- Awaiting input/review：显示需要人处理。
- Pending/waiting：显示等待上游或等待 child issues。

状态文字必须短，长说明进入详情面板。

### Split 子 issue 展开

Split 节点收起态展示聚合进度：

- `4 child issues`
- `1 done · 2 running · 1 blocked`
- `waiting for review`

点击 child summary control 或双击 split 节点切换展开态。点击 split 节点本身仍打开 split 详情/审核面板。

展开态：

- 子 issue 节点在父 split 附近展开，形成局部 cluster。
- 子 issue 节点使用运行节点卡片语言。
- 子 issue 状态包括 pending/running/completed/failed/blocked/cancelled。
- 子 issue 可显示依赖连线，但不进入编辑模式。
- 点击子 issue 节点在当前全景图内打开右侧子 issue 详情面板。
- 子 issue 面板内提供显式 `Open child issue` / `View full issue` 跳转。

普通节点不显示 issue 跳转，避免混淆。

## 运行详情面板模式

“简洁”指默认信息层级清楚，不是删除必要功能。详情面板按选中对象分三种模式。

### A. 普通运行节点：运行收据

适用于普通 Agent/Human/Gateway 节点。

信息顺序：

1. **Status and next step**
   - 当前状态。
   - 下一步动作。
   - 阻塞原因，如有。

2. **Deliverables and links**
   - Artifact。
   - Agent session。
   - Latest run。
   - Transcript/Evidence 二级入口。

3. **Worker and Critic**
   - Worker actor。
   - Critic/reviewer。
   - 未配置时显示 `Not configured`。

4. **Runtime facts**
   - Elapsed。
   - Started/completed。
   - Retry count。
   - Updated time。

5. **Evidence preview**
   - 自然语言摘要。
   - 原始 JSON、完整输出、日志默认隐藏。

普通节点详情不展示 split 草案、不展示 child issue 列表、不默认展开 JSON。

### B. Split 节点：审核/进度工作台

适用于 Split Node，尤其是 awaiting review、split active、failed、completed 状态。

必须保留 `2026-07-14-dynamic-task-splitting-design-frontend.md` 中定义的核心能力：

1. **Header**
   - Split review/progress/failed。
   - 节点标题。
   - nodeRun status。
   - SplitProgressBadge。
   - Mode badge。

2. **Verdict**
   - 是否 ready。
   - 将创建或已创建多少 child issues。
   - 风险摘要。
   - 关键数字：child issue count、actor count、dependency chain、blocked count。
   - 运行设置入口：mode、concurrency、max failures。

3. **Draft plan**
   - 只读子 issue 草案列表。
   - 稳定编号。
   - 标题、摘要、负责人、依赖、风险、状态。
   - 创建后显示 issue identifier 和跳转入口。

4. **Dependencies**
   - 轻量文本图或标签摘要。
   - 只解释，不编辑。

5. **Ask agent**
   - 自然语言修正入口。
   - 所有增删改、合并、拆分、依赖调整通过 agent/chat 完成。
   - 不出现手动字段编辑、checkbox 删除、DAG 编辑器。

6. **Agent transcript**
   - 默认折叠。
   - chat 运行中或失败时可自动展开。

7. **Sticky footer**
   - Cancel split。
   - Confirm create。
   - 状态不允许时禁用并说明原因。

Split active/completed 时，面板转为进度视图：

- Verdict 展示整体进度。
- Draft plan 替换为真实 child issue 列表。
- 每行展示 child issue 状态、失败原因摘要和跳转。
- 不再展示 confirm create。

### C. 子 issue 节点：局部详情与显式跳转

适用于运行态展开的 child issue 节点。

信息顺序：

1. **Status and next step**
   - child issue 当前状态。
   - 阻塞原因。
   - 主动作：Open child issue、Retry、Cancel 等按状态展示。

2. **Child progress**
   - Parent split。
   - Child workflow。
   - 当前 child workflow node。
   - 失败定位路径。

3. **Deliverables and links**
   - Issue。
   - Agent session。
   - Artifact。
   - Parent split。

4. **Runtime facts**
   - Elapsed。
   - Retry count。
   - Updated time。

子 issue 点击不应直接离开全景图。只有点击显式跳转入口时才进入完整 issue 详情。

## 竞品启发的取舍

- n8n 启发：运行结果应直接映射到画布上的节点和连线，而不是藏在日志中。
- Dify 启发：Last run、human input、evidence 需要有入口，但 Multica 默认应使用 issue/agent 语境。
- Coze/FlowGram 启发：子任务可局部展开，但 Multica 保持父到子的两层限制。

本 spec 的取舍：

- 保留画布状态、边标签、child cluster、evidence 二级入口。
- 不做全局 variable inspector。
- 不做无限嵌套容器。
- 不做通用数据管道式 item count；只显示 artifacts、child issues、blocked 等业务语义。

## 可访问性与响应式

- 所有 icon button 必须有 `aria-label`。
- 状态不能只依赖颜色，必须有文本或 badge。
- 长标题必须 truncate 或 line-clamp，不撑破卡片和面板。
- 面板内容区滚动；Split 工作台底部操作 sticky。
- 子 issue 行的点击目标和内部链接不能嵌套冲突。
- 键盘顺序：
  - 关闭按钮。
  - 主要链接和状态动作。
  - child summary control。
  - composer，若是 split 审核态。
  - footer 操作。
- 展开 child cluster 后，应保持父 split 可见，并将视口轻微聚焦到父 split + child cluster 区域。
- 窄屏下配置面板和详情面板采用单列布局，避免横向溢出。

## 状态与错误处理

- 加载中：保留画布结构，节点使用 skeleton 或 pending badge，不整体闪烁。
- 无运行数据：普通节点显示 No run data；Split 节点显示无 child issue 或未生成草案的明确空态。
- Blocked：在顶部全局进度、节点卡、连线、详情面板中保持一致。
- Split chat running：保留上一版草案，标记正在更新，composer 禁用。
- Split failed：显示失败原因、可恢复草案或重试入口，避免笼统“split failed”。
- 子 issue failed/blocked：必须展示具体定位路径，至少包括 child issue、child workflow node、错误摘要。
- Raw JSON 或完整日志只在 Evidence/Transcript/Session 二级入口展示。

## 测试策略

默认只做相关模块测试，不要求全量测试。

### 单元与组件测试

- Workflow 编辑画布：
  - 连线默认样式可见性提升。
  - selected/hover edge 样式正确。
  - Worker/Critic 不再作为独立流程节点渲染。
  - 编辑态节点内部展示 Worker/Critic 两个角色。

- NodeConfigPanel：
  - Readiness 区展示缺失项。
  - Worker/Critic 配置顺序正确。
  - Split behavior 显示 child workflow、release mode、concurrency、failure tolerance。
  - 保存、试跑、删除动作仍可达。

- Runtime panorama：
  - 顶部全局进度显示 completed/running/blocked/waiting/elapsed/current。
  - 节点状态映射到边框、badge、连线。
  - 运行态边标签只在关键边显示。
  - Split child summary 可展开/收起。
  - 子 issue 节点点击打开右侧详情面板，不直接导航。

- ExecutionDetailPanel / SplitReviewPanel：
  - 普通节点使用运行收据模式。
  - Split awaiting review 展示 Verdict、Draft plan、Dependencies、Ask agent、Transcript、Sticky footer。
  - Split active/completed 展示真实 child issue 进度。
  - 子 issue 节点详情展示 Open child issue 显式入口。
  - JSON/metadata 不在默认主视图中直接展开。

### 视觉回归/手动检查

- 桌面宽屏：编辑态与运行态节点风格一致。
- 520px 面板：长标题不重叠，footer 可见。
- 窄屏：面板单列可读。
- 8+ child issues：cluster 不遮挡主流程关键节点，必要时滚动或聚焦。
- Blocked 状态：顶部、节点、边、详情面板语义一致。

## 验收标准

- 连线在默认缩放下清晰可辨，selected/current/blocked 路径更醒目。
- Worker 与 Critic 在编辑态和运行态都作为一个节点内的两个角色展示。
- 运行态无需打开详情面板即可判断流程整体进度和阻塞位置。
- 普通运行详情面板默认聚焦状态、交付物、阻塞、耗时和二级证据入口。
- Split 详情面板保留完整审核/进度工作台能力，不因“简洁”被削弱。
- 编辑态配置面板能先暴露缺失项，再引导完成配置。
- Split 子 issue 在运行态能展示聚合进度、展开状态、单个子 issue 状态，并能显式跳转详情。
- 普通节点不会被误认为 issue；只有 Split Node 产生的 child issues 提供 issue 跳转。
- 编辑态与运行态画布视觉语言一致，用户能从配置自然过渡到运行诊断。

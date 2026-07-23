# 工作流节点运行时选择策略

## 状态

- 状态：已确认，调整中
- 适用范围：工作流中的内置智能体节点
- 不适用：普通智能体、人工节点、gateway 节点

## 背景

当前工作流运行时选择存在以下问题：

- 普通智能体与内置智能体的回退规则不一致；普通智能体任务会优先在线运行时，工作流内置智能体会直接选择工作区最早创建的运行时。
- `workflow_run.runtime_id` 被当作整次运行的固定运行时，无法按节点实时利用不同设备的空闲容量。
- 只有部分 issue 改派入口能够传递指定运行时；创建 issue、测试运行和直接启动没有统一契约。
- UI 仅在工作流包含内置智能体且存在多个在线运行时时显示选择器，但弹窗又会混入离线运行时。
- 选择与任务入队不是一个原子操作，并行节点可能同时认为同一运行时空闲。
- 运行时不可用时，派发错误可能只被记录日志，留下无法继续的 `running` 工作流。

产品约束是每台设备只注册一个运行时，一个工作区可以连接多台设备。因此运行时选择等价于选择执行设备。

## 目标

1. 对每个需要内置智能体执行的 Worker/Critic 阶段独立选择运行时。
2. 允许用户在工作流编辑页保存默认运行时策略，并在每次交互式启动时覆盖本次策略。
3. 并行节点在空闲优先策略下分散到不同空闲设备。
4. 所有工作流启动入口使用一致的默认策略、单次覆盖和旧客户端兼容契约。
5. 服务端负责资格校验、并发控制、最终选择和失败收敛。
6. 记录实际运行时与选择原因，支持审计和排障。

## 非目标

- 不允许工作流策略覆盖普通智能体的 `agent.runtime_id`。
- 不在工作流编辑器中增加节点级运行时配置；默认策略属于整个工作流。
- 不保证同一次工作流的所有节点运行在同一设备。
- 不在没有可用运行时时无限等待设备恢复。
- 不使用工作流触发人代替所属 issue 创建人。

## 术语

- **默认策略**：保存在工作流上的策略和可选指定运行时，只影响之后创建的运行。
- **运行策略快照**：创建 `workflow_run` 时从工作流默认值或本次覆盖解析出的不可变策略。
- **指定运行时偏好**：`specified_runtime_first` 策略下优先尝试的运行时。它属于工作流默认值或运行快照，不是节点配置。
- **实际运行时**：某个 Worker/Critic 阶段派发 task 时最终选择的运行时，写入 `workflow_node_run.runtime_id` 和 task 的 `runtime_id`。
- **活动任务数**：运行时上状态为 `queued`、`dispatched` 或 `running` 的 task 数量之和。
- **空闲运行时**：合格且活动任务数为 0 的运行时。
- **Issue 创建人**：工作流所属 issue 的创建人；issue 由智能体创建时，解析为该智能体的 `owner_id`。

## 适用范围

### 普通智能体

普通智能体始终使用自身绑定的 `agent.runtime_id`，不进入动态选择算法。原因是普通智能体可能依赖绑定设备上的凭据、本地 skill、工作目录和 CLI 配置。

实际选择原因记录为 `agent_binding`。

### 内置智能体

`is_builtin = true` 且没有固定 `agent.runtime_id` 的智能体进入节点级动态选择算法。

### Squad

Worker 或 Critic 是 Squad 时，先解析为 Squad Leader，再根据 Leader 是否为普通智能体或内置智能体执行对应策略。

### Human 与 Gateway

Human 和 gateway 阶段不创建智能体 task，因此不选择运行时，也不写选择原因。

工作流角色占位符必须先解析成具体 Worker/Critic；运行时选择永远发生在角色解析之后。

## 选择时机与作用域

运行策略在启动工作流时确定一次，但实际运行时在每个 Worker/Critic 阶段派发前重新选择。

这意味着：

- 指定运行时持续合格时，每个内置智能体阶段都会优先使用它。
- 选择空闲优先、issue 创建人优先或指定运行时失效时，不同节点可以选择不同设备。
- Worker 与 Critic 是两次独立选择。
- 节点重试和重新运行必须重新执行资格检查和选择算法，不能盲目复用已经失效的 task 运行时。

## 候选资格

运行时进入任何选择分支前，必须同时满足：

1. 属于当前工作区。
2. 数据库状态为 `online`，且心跳仍在健康窗口内。
3. 运行时仍存在，没有处于注销或删除流程。
4. 支持当前内置智能体所需能力。首期可以将所有已注册且受支持的 provider 视为兼容，但资格判断必须保留独立入口，不能散落在选择分支中。
5. 满足运行时可见性与执行权限：公开运行时可参与自动选择；私有运行时只有 owner、拥有显式运行时权限的成员或工作区管理员可以使用。

UI 过滤只用于减少无效选项，服务端资格校验是最终权威。指定运行时不能绕过资格校验。

## Issue 创建人解析

工作流由 issue 触发时，在创建 `workflow_run` 时解析并快照 Issue 创建人：

```text
issue.creator_type = member
  -> responsible_user_id = issue.creator_id

issue.creator_type = agent
  -> responsible_user_id = creator_agent.owner_id

issue.creator_type = system，或 owner 无法解析
  -> responsible_user_id = NULL
```

测试运行和直接 API/CLI 启动没有所属 issue，因此：

- `source_issue_id = NULL`
- `responsible_user_id = NULL`
- 自动策略没有空闲运行时后，跳过 Issue 创建人分支并失败

不使用触发人代替 Issue 创建人。创建人在运行创建时快照，后续成员或智能体归属变化不改变已经开始的运行。

## 节点级选择算法

### 策略枚举

| 策略 | 选择顺序 |
| --- | --- |
| `specified_runtime_first` | 指定运行时 → 空闲运行时 → issue 创建人的运行时 → 失败 |
| `idle_first` | 空闲运行时 → issue 创建人的运行时 → 失败 |
| `issue_creator_first` | issue 创建人的运行时 → 空闲运行时 → 失败 |

`specified_runtime_first` 是强偏好而不是严格绑定：指定运行时合格但繁忙时仍然选择；
离线、已删除、无权限或不兼容时继续安全回退。UI 使用“指定运行时优先”，不能使用
“固定运行时”或“锁定运行时”等容易产生严格绑定预期的文案。

`issue_creator_first` 会优先选择 issue 创建人负载最低的合格运行时，即使工作区中存在
其他成员的空闲运行时。直接测试运行没有所属 issue，跳过创建人分支并继续空闲分支。

普通智能体仍直接使用 `agent.runtime_id`，原因记录为 `agent_binding`，不读取运行策略。

### 空闲运行时排序

空闲候选的活动任务数都为 0，按以下顺序稳定排序：

1. `last_seen_at DESC`
2. `created_at ASC`
3. `id ASC`

空闲选择面向整个工作区的合格候选，不优先 Issue 创建人。`idle_first` 中只要存在任意空闲
候选，就不会进入 Issue 创建人分支。

### Issue 创建人运行时排序

创建人分支只考虑 `runtime.owner_id = responsible_user_id` 的合格运行时。允许选择繁忙运行时并排队，排序为：

1. 活动任务数 `ASC`
2. `last_seen_at DESC`
3. `created_at ASC`
4. `id ASC`

如果 Issue 创建人没有合格运行时，即使其他成员仍有繁忙运行时，也不再跨成员回退。

## 并发与原子性

动态选择必须保证“统计负载、选择运行时、创建 task”是一个原子操作。

推荐实现：

1. 开启数据库事务。
2. 对工作区获取事务级 advisory lock。
3. 在事务内重新加载运行、节点、智能体、候选运行时及活动任务计数。
4. 执行选择算法。
5. 创建 `multica_agent_task_queue` 行。
6. 将实际 `runtime_id` 和选择原因写入 `multica_workflow_node_run`。
7. 提交事务后发布事件和 daemon wakeup。

为保证 fail-fast 与并行派发互斥，工作区锁覆盖所有工作流智能体 task 的派发状态检查；动态策略分支会读取负载并参与分散，普通智能体固定绑定和指定运行时偏好也必须在锁内确认运行仍为 `running`。

通过工作区级串行化，并行节点的行为为：

1. 节点 A 选择运行时 R1 并插入 `queued` task。
2. 节点 B 获取锁后重新统计，R1 的活动任务数已经为 1。
3. 如果存在 R2，节点 B 会选择 R2。

禁止先在事务外选择、再单独创建 task；该方式会产生检查与使用之间的竞争窗口。

## 数据模型

### `multica_workflow`

新增：

- `default_runtime_selection_policy TEXT NOT NULL DEFAULT 'idle_first'`
- `default_runtime_id UUID NULL REFERENCES multica_agent_runtime(id) ON DELETE SET NULL`

默认策略为 `specified_runtime_first` 时必须同时存在 `default_runtime_id`。运行时被删除后默认
运行时置空；编辑页保留策略并提示用户重新选择，启动请求不能生成无效的指定优先快照。

### `multica_workflow_run`

保留现有 nullable `runtime_id`，明确其语义为“本次运行的指定运行时偏好”，不是整次运行已经解析完成的唯一运行时。

新增：

- `runtime_selection_policy TEXT NOT NULL DEFAULT 'idle_first'`
- `source_issue_id UUID NULL REFERENCES multica_issue(id) ON DELETE SET NULL`
- `responsible_user_id UUID NULL REFERENCES multica_user(id) ON DELETE SET NULL`
- `runtime_authorizer_id UUID NULL REFERENCES multica_user(id) ON DELETE SET NULL`

### `multica_workflow_node_run`

保留现有 `runtime_id` 作为节点实际运行时，新增：

- `runtime_selection_reason TEXT NULL`

允许值：

- `manual`
- `idle`
- `issue_creator`
- `agent_binding`

数据库使用 CHECK constraint 限制非空值，并为迁移提供对应的 down migration。

### Task 队列

`multica_agent_task_queue.runtime_id` 继续保存实际运行时，必须与对应 `workflow_node_run.runtime_id` 一致。

## API 契约

### 启动请求

所有能够启动工作流的请求统一接受：

```json
{
  "input": {},
  "runtime_selection_policy": "idle_first",
  "runtime_id": "optional-runtime-uuid"
}
```

- 两个字段都缺失时使用工作流默认策略和默认指定运行时。
- 旧客户端只传 `runtime_id` 时解释为 `specified_runtime_first`。
- 显式传 `specified_runtime_first` 时必须同时提供有效 `runtime_id`。
- 显式传其他策略时不得同时提供 `runtime_id`，含义冲突返回 400。
- Handler 必须使用请求边界 UUID 校验，非法 UUID 返回 400，不能通过 panic 版解析器处理。
- 服务端校验运行时工作区归属和调用者权限。

覆盖入口：

- 创建 issue 时直接分配工作流
- 将已有 issue 改派给工作流
- 工作流编辑器测试运行
- API/CLI 手动启动

节点 task 的自动重试与人工重跑不创建新的 `workflow_run`，因此不接受新的
`runtime_selection_policy` 或 `runtime_id`；它们沿用当前运行的策略快照，但必须重新校验候选并重新执行节点级
选择算法。

### 响应

`workflow_run.runtime_id` 继续返回指定运行时偏好，并新增 `runtime_selection_policy`。节点运行响应保留实际结果字段：

```json
{
  "runtime_id": "actual-runtime-uuid",
  "runtime_selection_reason": "idle"
}
```

新增字段必须是可选的；前端使用 schema 解析并对未知选择原因降级为通用文案。

## UI 行为

工作流编辑页工具栏提供“运行设置”，保存工作流级默认策略。选择“指定运行时优先”时
必须同时选择默认运行时；已保存运行时离线后仍显示并标记离线，不能静默清空。

所有交互式工作流启动入口都展示策略选择器，不再根据以下条件隐藏：

- 工作流是否包含内置智能体
- 在线运行时数量是 0、1 还是多个

选择器行为：

1. 默认选中工作流默认策略，并标记“工作流默认”。
2. 用户可以覆盖本次运行；覆盖只写入 `workflow_run`，不修改工作流默认值。
3. 策略选项为“指定运行时优先”“空闲运行时优先”“issue 创建人运行时优先”。
4. 选择指定优先时展示工作区内在线运行时；服务端在确认时校验工作区归属与执行权限，并在节点
   派发时再次校验健康状态。
5. 每台设备只有一个运行时，选项同时展示设备名、运行时名称和在线状态。
6. 即使只有一个候选也保留选择器。
7. 测试运行选择创建人优先时提示“测试运行没有关联 issue，将直接选择空闲运行时”。
8. 明确提示：策略只影响内置智能体；普通智能体仍使用自身绑定的运行时。
后续节点执行时不再次弹窗。

自动触发的工作流不显示 UI，直接快照工作流默认策略。修改默认策略不影响已有运行；
同一次运行中的后续节点、重试和 task 重跑继续使用原快照。用户发起全新的重新运行时，
重新读取当前默认策略并允许本次覆盖。

## 失败语义

内置智能体节点完整执行所有分支后仍没有候选时：

1. 当前节点进入 `failed`。
2. 记录结构化失败原因 `runtime_unavailable`。
3. 记录诊断信息，但不得包含敏感凭据：指定运行时失效原因、合格候选数量、空闲候选数量、Issue 创建人候选数量。
4. 当前 `workflow_run` 进入 `failed`。
5. 取消尚未派发的节点。
6. 向已经运行的并行 task 发出取消请求。
7. 发布节点和工作流状态事件。

不自动无限等待运行时上线。设备恢复后，用户可以重新运行节点或整次工作流；重新运行必须重新执行选择算法。

普通智能体固定运行时失效时继续使用现有普通智能体失败语义，不悄悄切换到其他设备。

## 可观测性

每次选择至少记录：

- `workflow_run_id`
- `workflow_node_run_id`
- `agent_id`
- `runtime_id`
- `runtime_selection_reason`
- `active_task_count_at_selection`
- 是否发生指定运行时回退

建议增加计数指标：

- 按选择原因统计的节点派发数
- `runtime_unavailable` 失败数
- 指定运行时回退数
- 动态选择锁等待时长

日志只记录 ID 和原因，不记录运行时环境变量、CLI 参数或设备敏感信息。

## 测试要求

完整的环境、数据矩阵、端到端用例、证据与发布标准见
[工作流运行时选择策略端到端测试计划](./workflow-runtime-selection-e2e-test-plan.md)。

### 服务层

- 普通智能体始终使用绑定运行时。
- 三种策略分别按照已定义顺序选择。
- 有效指定运行时优先，即使它已有活动任务。
- 无效指定运行时按照策略回退。
- 空闲定义包含 `queued`、`dispatched` 和 `running`。
- 多个空闲运行时按稳定顺序选择。
- 没有空闲运行时时选择 Issue 创建人负载最低的运行时。
- issue 由智能体创建时解析智能体 Owner。
- 没有所属 issue 时跳过 Issue 创建人分支。
- 私有且无权限、跨工作区、离线、不兼容运行时被排除。
- 并行派发在两个空闲运行时之间分散。
- 没有候选时节点和工作流快速失败，并取消其他节点/task。
- Worker 和 Critic 分别重新选择。
- 节点重试重新校验运行时。

### Handler/API

- 所有启动入口接受 `runtime_selection_policy` 和条件必需的 `runtime_id`。
- 两个字段缺失时使用工作流默认值；旧客户端只传 `runtime_id` 时解释为指定运行时优先。
- 非法 UUID 返回 400。
- 跨工作区或无权限人工选择返回明确错误，或按产品契约记录为不可用偏好后自动回退；所有入口必须采用同一行为。
- malformed API 响应不会导致旧桌面客户端白屏。

### 前端

- 工作流编辑页可保存默认策略和默认指定运行时。
- 工作流没有内置智能体时仍展示启动策略选择器。
- 0、1、多个在线候选都展示策略选择器。
- 启动弹窗默认使用工作流策略，并允许仅本次覆盖。
- 离线运行时不作为人工选项；服务端拒绝无权限的人工选择。
- 创建 issue、改派和测试运行都传递一致的策略覆盖；节点重试/重跑沿用运行快照并
  重新选择实际运行时。
- 文案说明人工选择不覆盖普通智能体绑定。

## 实施顺序

1. 增加数据库迁移、sqlc 查询和生成模型。
2. 抽取服务层候选资格、Issue 创建人解析和节点级选择器。
3. 将选择与 task 创建合并到同一事务，并实现并发测试。
4. 接入 Worker、Critic、重试和重新运行路径。
5. 收敛无候选时的节点/工作流快速失败逻辑。
6. 统一所有 Handler/API 启动请求。
7. 更新 core 类型、schema、query mutation 和共享 UI。
8. 补充后端、前端与 API 兼容性测试。
9. 运行 sqlc、格式化、类型检查和相关测试。

## 验收标准

- `idle_first` 下，两个同时启动的内置智能体节点在存在两台空闲设备时不会选择同一运行时。
- `specified_runtime_first` 下，合格的繁忙指定运行时仍然胜过空闲运行时。
- `idle_first` 下，全工作区空闲运行时胜过 Issue 创建人的繁忙运行时。
- `issue_creator_first` 下，Issue 创建人的合格繁忙运行时胜过其他成员的空闲运行时。
- 工作流默认策略、本次覆盖和运行快照互不串改。
- 任何节点都不能被派发到跨工作区、离线或无权使用的运行时。
- 普通智能体从不被动态策略迁移到其他设备。
- 所有交互式启动入口都能选择三种策略；自动触发使用工作流默认策略，且只有服务端决定最终实际运行时。
- 没有候选时不会留下永久 `running` 的工作流。

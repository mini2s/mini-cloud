# Workflow 编辑与运行隔离设计

| 项目 | 内容 |
| --- | --- |
| 日期 | 2026-07-25 |
| 状态 | 设计已确认，待实施计划 |
| 目标 | Workflow 编辑定义与运行数据完全隔离，编辑无法改变已经创建的运行 |

## 一、背景

当前 workflow 定义与 workflow run 分表存储，但运行过程仍通过 `workflow_node_id` 回查可编辑的节点、边和交付物配置。`workflow_node_run` 只保存节点标题和部分执行人信息，尚未形成完整运行快照。

因此，运行期间修改 workflow 可能产生以下问题：

- 修改节点类型或 Split 配置会改变尚未执行节点的行为。
- 修改或删除边会改变运行中的依赖关系。
- 修改交付物要求会改变运行中的提交与审核条件。
- 删除节点会通过现有外键级联删除关联的 node run。
- 运行详情读取当前定义，无法还原启动时的画布和配置。

本设计建立一条硬边界：workflow 表只保存可编辑定义；每次启动运行时生成该次运行独占的完整快照；运行创建后只读取和修改自己的数据。

## 二、核心原则

1. 编辑定义与运行数据是两个独立数据域。
2. Workflow 可以在运行期间继续编辑，已有运行不受影响。
3. 编辑器不负责判断完整 workflow 是否可运行。
4. 每次启动运行时统一校验，并在执行前快速失败。
5. 运行成功创建后，不再回查任何可编辑节点、边、阶段、角色槽或交付物定义。
6. 新运行读取一个事务一致的已保存定义，不读取本地未保存内容，也不会拼接多个编辑代次。
7. 不引入 workflow revision、发布、应用更新或历史版本管理。

## 三、用户体验

### 3.1 编辑器

编辑器只反馈保存状态：

- `保存中...`
- `已保存`
- `无法保存修改`

不展示以下概念：

- 有更新待应用
- 应用更新
- 配置版本
- 当前配置不可运行
- 正在运行的任务是否使用最新配置

编辑接口仍执行请求级和结构级约束，例如字段类型、节点归属、重复边和非法边方向。完整 DAG、执行人、角色、Split 和交付物检查延迟到启动运行时执行。

### 3.2 启用状态

Workflow 继续保留现有 `draft`、`active`、`paused` 和 `archived` 运营状态：

- `draft`：不能创建运行。
- `active`：允许创建运行。
- `paused`：暂停创建新运行，不影响已有运行。
- `archived`：不再创建新运行，历史运行仍可查看。

"启用"只把 workflow 从 `draft` 切换为 `active`，不生成版本，也不执行完整运行校验。现有启用 handler 中的完整预检迁移到统一启动服务，真正启动运行时才验证当时已保存的定义。

### 3.3 启动失败

手动启动失败时显示：

> 无法启动工作流，请检查配置。

操作：`查看问题`

自动化、Issue 分配、API 或 Split 子 workflow 启动失败时，创建可追踪的失败记录，并通过现有通知机制告知责任人：

> 工作流启动失败：配置不完整。

错误详情展示具体节点和原因。编辑页面不提前展示该错误。

## 四、数据边界

### 4.1 编辑定义

以下现有表只属于编辑域：

- `multica_workflow`
- `multica_workflow_node`
- `multica_workflow_edge`
- `multica_workflow_stage`
- `multica_workflow_node_deliverable`

`multica_workflow_role` 是 workspace 级共享定义，不归属于单个 workflow，但角色名称和描述会进入运行快照，因此属于快照依赖域。

`multica_workflow` 新增内部字段：

```text
config_revision BIGINT NOT NULL DEFAULT 0
```

所有会改变运行快照或运行详情的写操作都必须在同一事务中锁定 workflow 行、修改定义并递增 `config_revision`，包括：

- workflow 标题、描述、重试与默认运行时策略
- 节点新增、更新、移动和删除
- 边新增和删除
- 阶段新增、更新、排序和删除
- 节点角色槽与执行人配置
- 被 workflow 引用的共享角色名称和描述
- Split 配置
- 交付物要求

`config_revision` 仅用于并发控制和诊断，不作为用户可见版本。

共享角色 CRUD 和节点角色槽变更必须先取得同一个 workspace 级排他事务 advisory lock，再取得 workflow 行锁；运行快照准备取得对应的共享 advisory lock，再取得 workflow 行锁。所有路径遵循这一固定顺序，多个启动事务可以并发，共享角色或引用关系变更会与启动互斥。共享角色更新在持有排他 advisory lock 后查询所有引用该角色的 workflow，按 workflow ID 排序逐行取得排他锁，更新角色，并递增所有受影响 workflow 的 `config_revision`。启动事务在持有共享 advisory lock 和 workflow `FOR SHARE` 锁后读取角色槽，再按角色 ID 排序以 `FOR SHARE` 锁定角色并读取名称和描述。该 advisory lock 防止角色更新查询引用集合后又有节点新增该角色引用。角色创建尚未被任何 workflow 引用时不递增 revision；角色仍被引用时继续禁止删除。

### 4.2 运行快照

`multica_workflow_run` 新增：

```text
source_config_revision BIGINT NOT NULL
definition_schema_version INT NOT NULL
definition_snapshot JSONB NOT NULL
max_retries INT NOT NULL
failure_reason TEXT NULL
validation_errors JSONB NULL
```

`definition_snapshot` 使用明确的 Go 结构体序列化，包含启动时的完整 workflow 展示定义：

- workflow 标题、描述及执行级配置
- 所有节点及画布坐标
- 所有边和条件
- 所有阶段及顺序
- 节点角色槽及角色名称、描述快照
- Split 配置
- 交付物要求

JSON 顶层包含 `schema_version` 和 `snapshot_origin`；原生快照使用 `snapshot_origin='native'`，迁移回填使用 `snapshot_origin='legacy_backfill'`。禁止使用无约束的 `map[string]any` 构造快照。该 JSON 用于审计、运行详情回放和失败诊断，不作为运行期间的主要拓扑查询方式。`max_retries` 等运行服务需要频繁读取的 workflow 级参数同时写入 workflow run 的强类型列；现有 `runtime_selection_policy` 和 `runtime_id` 继续作为启动时快照，运行期间不得回查 workflow 默认值。

Definition snapshot 创建后不可更新。运行状态、输出、失败详情和完成时间通过各自字段更新，不修改启动配置快照。

### 4.3 运行拓扑

新增 `multica_workflow_run_edge`：

```text
id                  UUID PRIMARY KEY
workflow_run_id     UUID NOT NULL
source_node_run_id  UUID NOT NULL
target_node_run_id  UUID NOT NULL
condition           JSONB NULL
created_at          TIMESTAMPTZ NOT NULL
```

运行边直接连接同一 workflow run 下的 node run。组合外键或数据库约束必须禁止跨 run 连接。

运行调度只查询 `multica_workflow_run_edge`，不再查询 `multica_workflow_edge`。开始、结束和 annotation 等不创建 node run 的展示节点保留在 `definition_snapshot` 中；构建运行拓扑时继续使用现有可执行图规则过滤。

### 4.4 Node Run 快照

`multica_workflow_node_run` 保存执行所需的完整节点快照。除现有状态、输出和执行人字段外，至少增加：

```text
source_workflow_node_id UUID NOT NULL
node_description        TEXT NOT NULL
format_schema           JSONB NULL
critic_api_url          TEXT NULL
stage_snapshot          JSONB NULL
worker_role_snapshot    JSONB NULL
critic_role_snapshot    JSONB NULL
runtime_config          JSONB NOT NULL
worker_name_snapshot    TEXT NOT NULL
critic_name_snapshot    TEXT NOT NULL
```

现有 `workflow_node_id` 外键不能继续作为运行数据依赖。迁移后改为不带外键的 `source_workflow_node_id`，仅用于把 node run 映射到 `definition_snapshot` 中的源节点 ID。

worker、critic 的最终类型和 ID 继续快照到 node run。角色解析使用 node run 的角色名称、描述和约束快照创建 resolution；候选成员和 agent 根据启动时的实际可用对象解析。

`worker_name_snapshot` 和 `critic_name_snapshot` 保存启动时具体 member、agent 或 squad 的显示名称。角色槽尚未解析为具体人员时先保存空字符串，解析成功后在同一角色分配事务中写入最终人员名称；后续人员改名或删除不改变该快照。

对于 `snapshot_origin='native'` 的 run，已经绑定具体 actor 时对应名称快照必须非空。对于迁移回填的 legacy run，若 actor 已被删除或无法解析，名称快照允许使用空字符串表示“历史名称未知”，UI 降级显示通用 actor 类型，不得用当前其他对象的名称猜测或伪造历史。

### 4.5 交付物快照

新增运行态交付物要求表 `multica_workflow_node_run_deliverable`：

```text
id                    UUID PRIMARY KEY
workflow_node_run_id  UUID NOT NULL
source_deliverable_id UUID NOT NULL
kind                  TEXT NOT NULL
title                 TEXT NOT NULL
description           TEXT NOT NULL
required              BOOLEAN NOT NULL
sort_order             INT NOT NULL
```

`multica_workflow_node_deliverable_submission.deliverable_id` 改为引用运行态交付物要求，而不是可编辑的 definition deliverable。编辑或删除交付物定义不会改变已有运行的提交和审核条件。

### 4.6 稳定 Workflow 关联

`workflow_run.workflow_id` 继续以 `NOT NULL` 外键关联稳定的 workflow 身份，用于权限、列表和导航，但运行服务不得通过该 ID 读取执行配置。

删除语义确定如下：

- workflow 没有任何 run 时允许硬删除。
- workflow 存在任意历史或进行中 run 时禁止硬删除，返回 `409 workflow_has_runs`，用户必须改用 `archived`。
- 删除服务在事务中以 `FOR UPDATE` 锁定 workflow 行，检查 run 是否存在后再删除；该锁与启动事务冲突，禁止“检查后又创建 run”的竞态。
- `workflow_run.workflow_id` 外键改为 `ON DELETE RESTRICT`，由数据库兜底禁止任何绕过删除服务的历史 run 级联删除。

在此删除策略下，node run、运行边和运行态交付物都不得通过编辑表外键级联变化。

删除整个 workspace 是独立的显式破坏性操作，不走 workflow 删除限制。workspace 删除事务必须先取得同一个 workspace 级排他 advisory lock，再锁定 workspace 行，取消仍在执行的任务，并按“workflow run 及其运行实体 → workflow 定义 → 共享角色 → workspace”顺序显式删除。禁止依赖 workspace 对 workflow 和 run 的多路径级联顺序。这样既满足 `workflow_run.workflow_id ON DELETE RESTRICT`，也避免 workspace 删除与角色更新采用相反锁顺序。

### 4.7 可靠派发队列

新增持久化派发表 `multica_workflow_node_run_dispatch_job`：

```text
id               UUID PRIMARY KEY
workflow_run_id      UUID NOT NULL
workflow_node_run_id UUID NOT NULL
phase                TEXT NOT NULL
generation           INT NOT NULL
status               TEXT NOT NULL  -- pending/running/succeeded/failed
attempt_count        INT NOT NULL
max_attempts         INT NOT NULL
scheduled_at         TIMESTAMPTZ NOT NULL
locked_by            TEXT NULL
lease_expires_at     TIMESTAMPTZ NULL
last_error           TEXT NOT NULL
created_at           TIMESTAMPTZ NOT NULL
updated_at           TIMESTAMPTZ NOT NULL
```

同一 `(workflow_node_run_id, phase, generation)` 只能有一条派发 job。worker 使用 `FOR UPDATE SKIP LOCKED` 和租约领取，进程崩溃后过期 job 可重新领取。节点派发必须幂等：状态转换使用条件更新；agent task 使用相同的 `(workflow_node_run_id, phase, generation)` 作为唯一派发键，重复执行不得创建第二个有效 task。

`multica_agent_task_queue` 新增：

```text
workflow_dispatch_job_id UUID NULL
```

该列以 `ON DELETE SET NULL` 引用 `multica_workflow_node_run_dispatch_job.id`，并建立 `WHERE workflow_dispatch_job_id IS NOT NULL` 的唯一索引。派发 worker 创建 agent task 时必须写入 job ID；若插入发生唯一冲突，则读取该 job 已有的 task，将 job 标记为 `succeeded`，不得再创建 task。派发 job 作为审计和幂等记录不做成功后即时删除；workspace 显式删除运行数据时，历史 task 的引用自动置空，不得反向阻止 job 和 run 删除。

## 五、启动事务

所有启动入口统一调用一个运行准备服务，不允许各入口自行读取定义或创建 node run：

```text
PrepareWorkflowRunSnapshot(workflow_id, trigger_context)
```

该服务在单个数据库事务中执行：

1. 取得 workspace 级角色定义共享 advisory lock，再使用 `FOR SHARE` 锁定 workflow 行；所有相关编辑写操作遵循相同锁顺序并使用冲突的 workflow 行锁。
2. 校验 workflow 运营状态允许启动。
3. 读取 `config_revision`。
4. 读取完整节点、边、阶段、角色和交付物定义。
5. 构造强类型 definition snapshot。
6. 执行完整运行预检。
7. 创建 workflow run，并写入 revision、schema version、workflow 级运行参数和 definition snapshot。
8. 为所有可执行节点创建 node run 快照。
9. 以 node run ID 创建运行边。
10. 创建运行态交付物要求和角色 resolution。
11. 若 run 已可执行，在同一事务中为每个可执行根 node run 创建 `pending` 派发 job；需要角色解析的 run 暂不创建。
12. 提交事务，由派发 worker 异步领取各 node job 并幂等派发。

行锁保证运行读取到一次完整提交后的定义。并发编辑只能发生在快照事务之前或之后，不能让一次运行混合两个 `config_revision`。

### 5.1 校验失败

预检失败时不得创建 node run、运行边、交付物提交槽、派发 job 或 agent task。为保证自动触发可追踪，事务只创建一个 `status='failed'` 的 workflow run，保存 definition snapshot、`failure_reason='config_invalid'`、结构化 `validation_errors` 和 `completed_at=now()`。

手动启动接口返回 `422 Unprocessable Entity`，同时携带失败 run ID 和结构化问题列表。自动触发入口通过失败 run 生成通知。失败记录不进入重试或调度队列。

### 5.2 派发失败

配置校验通过但运行时选择或角色解析失败时，沿用现有失败状态与原因模型。失败只更新 run/node run，不得回写 workflow 定义。

### 5.3 派发恢复

派发 worker 对瞬时错误递增 `attempt_count` 并重新调度。达到最大次数后将 job、对应 node run 和 workflow run 标记为失败，记录 `failure_reason='dispatch_failed'`。进程在启动事务提交后、领取 job 后或创建 agent task 后崩溃，均由租约超时和幂等键恢复，不允许留下只能人工发现的 `format_ok` 卡死 run。

角色解析完成或人工角色分配完成后，将 run 提升为 `running` 的事务必须同时为每个解除阻塞的根 node run 创建派发 job。上游完成并激活下游节点的事务、节点重试以及同一 run 内的重新派发，也必须为具体 node run 和 phase 创建下一 generation 的 job，不允许在 HTTP handler 或后台回调中只做 best-effort 直接调用。

## 六、运行期间读取规则

运行服务必须使用集中式运行仓储读取快照：

- 按 node run 读取节点执行配置。
- 按 workflow run 读取运行边。
- 按 node run 读取运行态交付物要求。
- 按 workflow run 读取 definition snapshot 供 UI 回放。

以下运行路径必须停止调用编辑态查询：

- 下游节点激活与上游完成检查
- Gateway、边界节点和 Split 类型判断
- Worker/Critic 派发及恢复
- 角色解析
- 任务上下文构造
- 交付物创建、提交、审核与仓库路径处理
- 运行详情画布

应提供语义明确的查询方法，例如 `GetRunNodeConfig`、`ListRunEdgesBySource` 和 `ListNodeRunDeliverableRequirements`，而不是让调用方传入 workflow ID 自行选择数据源。

### 6.1 Split 运行配置

当前 Split 流程存在运行期间更新 `workflow_node.format_schema` 的路径，必须移除。运行时调整的 `max_concurrency` 等参数只写入 node run 的 `runtime_config`，并继续使用 `split_config_version` 做乐观并发控制。

Split 子 workflow 在子 run 启动时读取该子 workflow 当时已保存的定义并生成独立快照。父 run 和子 run 之间只保留稳定业务关联，不共享可编辑配置。

## 七、特殊入口

以下入口必须统一经过运行准备服务：

- Workflow 页面手动运行
- Issue 分配给 workflow
- 默认 workflow
- 自动化触发
- API 触发
- Split 子 workflow

模板克隆仍复制可编辑定义，与运行快照无关。默认 workflow 可以由系统直接创建为 `active`，但第一次实际运行仍在启动事务中校验和快照。

节点重试、接管、交还、评论恢复和同一 run 内的重新派发复用原 node run 快照，不经过运行准备服务，不重新读取 workflow 定义，也不创建新的配置快照。只有明确创建新 workflow run 的"重新运行"操作才重新读取当时的编辑定义。

## 八、API 与前端

### 8.1 API

现有编辑 API 路径和请求结构保持不变。服务端负责锁定 workflow 并递增 `config_revision`。

启动失败响应增加结构化问题：

```json
{
  "code": "workflow_config_invalid",
  "message": "Workflow configuration is incomplete",
  "run_id": "...",
  "issues": []
}
```

运行响应增加可选的 `source_config_revision`、`definition_schema_version` 和 `definition_snapshot`。前端必须通过 Zod schema 解析并提供 fallback，兼容旧桌面客户端和新旧服务端组合。

Node run 数据库列改为 `source_workflow_node_id`，但 API 必须继续返回原有必填字段 `workflow_node_id`，其值来自 `source_workflow_node_id`。新客户端可同时接收可选的 `source_workflow_node_id`；在旧客户端兼容期内不得删除或改为可选 `workflow_node_id`。客户端统一以 `source_workflow_node_id ?? workflow_node_id` 作为画布映射 ID。相关 Zod schema 必须分别覆盖旧响应缺少新字段、新响应包含未知 snapshot schema，以及字段类型错误三种情况。

旧客户端继续使用原编辑与启动接口，不需要理解 snapshot 或 revision。新错误字段缺失时仍显示通用启动失败提示。

### 8.2 编辑器

编辑器不新增版本、待应用或预检状态。现有本地保存交互保持不变，只有写请求失败时显示错误。

### 8.3 运行详情

运行详情从 run endpoint 获取 definition snapshot 和 node run 状态，不再请求当前 workflow 的节点、边和阶段。画布节点使用 snapshot 中的源节点 ID，node run 通过 `source_workflow_node_id ?? workflow_node_id` 映射状态。

遇到未知 snapshot schema 或缺失字段时降级展示通用节点信息，不能导致页面白屏。成员、agent 或 squad 后续被删除时，优先使用 run 内的名称和角色快照。

## 九、迁移

1. 进入维护窗口并停止旧服务写入。
2. 检查所有旧 workflow run 均为终态；若存在 `running`、`resolving_roles` 或 `waiting_role_assignment`，迁移立即失败。运维必须先等待其完成，或通过现有取消服务显式取消并留下审计记录。
3. 为 workflow 增加 `config_revision`。
4. 为 workflow run 增加 definition snapshot、schema version、source revision 和失败详情。
5. 创建运行边、运行态交付物要求和 node run 可靠派发 job 表。
6. 扩充 node run 的节点执行配置和 actor 名称快照，并为 agent task 增加派发 job 外键及唯一索引。
7. 对每个旧 run 按部署时定义物化完整 `definition_snapshot`、node run 配置、运行边和运行态交付物要求，并将已有 submission 重映射到对应运行态交付物。
8. 校验每个旧 run 的 node run、运行边、交付物要求和 submission 数量及引用完整性；任一映射失败则整个迁移回滚。
9. 将运行数据对编辑节点和交付物的外键改为无外键 source ID。
10. 将所有编辑写查询及共享角色更新纳入锁与 revision 事务。
11. 将启动入口切换到统一运行准备服务，将派发入口切换到持久化 job worker。
12. 将运行期查询全部切换到 run 数据。
13. 最后移除不再使用的编辑态运行查询，并部署新服务后恢复流量。

已有运行缺少真实启动快照，迁移只能使用部署时的当前 workflow 定义回填，并标记 `definition_schema_version=0` 和 `snapshot_origin='legacy_backfill'`。旧 run 在迁移前必须已经终止，因此该近似数据只用于兼容展示、审计和历史交付物读取，不会参与后续调度，也不能声称是历史真实配置。

迁移提供 `.up.sql` 和带保护条件的 `.down.sql`。down 只支持在新服务恢复流量之前回滚：若存在 `definition_schema_version > 0` 的新 run、任何 source 节点或交付物已不存在，或 submission 无法完整映射回定义交付物，down 必须主动报错并保持数据库不变，禁止静默删除运行数据或制造悬空引用。上线恢复流量后采用只前滚修复，不承诺回退到旧运行模型。

由于新旧服务对运行数据的读取方式不同，部署全程使用维护窗口，不设计长期双写或双读。

## 十、错误与并发

- 编辑写入失败：事务回滚，`config_revision` 不递增。
- 并发编辑：通过 workflow 行锁串行化，每次成功写入对应一个完整 revision。
- 编辑与启动并发：运行快照完整位于编辑提交之前或之后。
- 共享角色更新与启动并发：角色行锁和引用 workflow 锁保证角色快照与 `source_config_revision` 一致。
- 启动校验失败：只创建失败 run，不创建任何执行实体。
- 快照序列化失败：启动事务回滚并返回内部错误，不创建部分 run。
- 派发瞬时失败或进程崩溃：持久化 job 自动重试；耗尽重试后更新 run/node run 的失败状态，不修改 workflow。
- workflow 删除：存在任何 run 时返回冲突，不删除 workflow 或历史运行。
- 删除编辑节点或交付物：不影响任何已有 run。
- Split 运行时调整：只修改 node run，并使用乐观锁防止并发覆盖。

## 十一、测试策略

### 11.1 服务与数据库

- 每类编辑写入正确锁定 workflow 并递增 `config_revision`。
- 启动读取单一 revision，不混合并发编辑。
- 校验失败只创建失败 run，不创建 node run、边、交付物槽、派发 job 或 task。
- 成功启动完整快照 workflow、节点、边、阶段、角色和交付物。
- 编辑或删除源节点后，已有运行继续派发下游节点。
- 编辑或删除源边后，已有运行继续使用运行边。
- 编辑交付物要求后，已有运行继续使用原要求。
- 修改角色名称或描述后，已有运行继续使用角色快照。
- 角色更新与启动并发时，快照 revision、角色名称和描述来自同一锁定边界。
- Split 运行时配置不回写 workflow node。
- 默认 workflow、自动化、Issue 和 Split 子 workflow 均经过统一准备服务。
- node run 重试、接管和恢复不回查编辑定义。
- 启动事务提交后模拟进程退出，派发 job 被另一 worker 领取且只创建一个有效 task。
- 派发 worker 在创建 task 后、更新 job 前退出，重试不重复创建 task。
- 旧 run 迁移完整物化运行边、节点配置和交付物映射；存在非终态旧 run 时迁移拒绝执行。
- workflow 存在 run 时硬删除返回 `409 workflow_has_runs`，归档后历史详情仍可访问。
- 含历史 run 的 workspace 删除按显式顺序完成，并与并发角色更新和运行启动保持统一锁顺序。
- workspace 存在关联 succeeded、failed 或 cancelled agent task 时仍可删除，task 到派发 job 的外键按 `ON DELETE SET NULL` 解除。
- down migration 在存在新格式 run 或缺失 source 定义时拒绝执行且不修改数据。

### 11.2 API 与前端

- 手动启动配置错误返回 `422`、失败 run ID 和结构化问题。
- 自动触发配置错误生成可见通知。
- 编辑器不展示运行预检或版本状态。
- 运行详情在编辑、删除源节点后仍按 snapshot 正确显示。
- snapshot 缺字段、字段类型错误或未知 schema 时安全降级。
- 旧 API 响应缺少新增字段时前端正常渲染。
- 旧客户端要求的 `workflow_node_id` 在新服务响应中继续存在并可映射 node run 状态。
- 新客户端读取不含 `source_workflow_node_id` 的旧服务响应时，使用 `workflow_node_id` 正确映射状态。
- concrete member、agent 或 squad 删除后，运行详情使用 actor 名称快照。
- legacy actor 已删除且无法回填名称时，迁移成功并在 UI 中降级为通用 actor 类型。

## 十二、非目标

- 不提供 workflow 历史版本列表、回滚或版本比较。
- 不在编辑期间持续运行完整 DAG 预检。
- 不保证编辑到一半时发起的新运行一定成功。
- 不让运行中的修改回写 workflow 定义。
- 不改变 agent、member、squad 实体自身的版本语义。

## 十三、成功标准

- Workflow 编辑不会改变、删除或阻塞任何已创建运行的数据。
- 运行启动后不再读取任何可编辑 workflow 配置。
- 每次运行使用一个事务一致的定义快照。
- 每个已提交且可执行的 run 都有可恢复、幂等的持久化派发记录。
- 配置错误在执行前快速失败，并且手动与自动触发均可追踪。
- 用户无需理解版本、发布、待应用或运行快照。
- 现有编辑体验和旧客户端基本保持不变。

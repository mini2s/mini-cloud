# Workflow 草稿、启用版本与运行隔离设计

| 项目 | 内容 |
| --- | --- |
| 日期 | 2026-07-25 |
| 状态 | 设计已确认，待实施计划 |
| 目标 | 分离编辑态与运行态，确保工作流修改只影响之后启用的新运行 |

## 一、背景

当前 workflow 定义与 workflow run 虽然分别存储，但运行过程仍通过 `workflow_node_id` 回查可编辑的节点、边和交付物配置。`workflow_node_run` 只快照了节点标题及 worker/critic 的类型和 ID，无法覆盖完整执行语义。

因此，在一个 workflow 已经运行后继续编辑，会产生以下风险：

- 修改节点类型或 Split 配置会改变尚未执行节点的行为。
- 修改或删除边会改变运行中的依赖关系。
- 修改交付物要求会改变运行中的提交和审核条件。
- 删除节点会通过现有外键级联删除关联的 node run。
- 运行详情读取当前定义，无法准确还原启动时的画布与配置。

目标不是禁止用户在运行期间编辑，而是让编辑与运行互不干扰，同时让用户容易理解修改何时生效。

## 二、设计原则

1. 用户只需要理解“草稿”和“已启用”，不直接管理版本。
2. 保存仅保存编辑内容；“启用”或“应用更新”才影响之后的新运行。
3. 每次运行固定绑定启动时的不可变配置，运行期间不再回查可编辑草稿。
4. 已经开始的运行不受后续编辑、应用更新、暂停或归档影响。
5. 沿用关系型节点、边、阶段和交付物模型，保留数据库约束及现有查询能力。
6. 不引入内部双写、运行时 fallback 或 JSON 图解析作为长期架构；API 边界只保留必要的客户端兼容保护。

## 三、用户模型

### 3.1 主状态

用户看到的配置状态只有两种：

- **草稿**：尚无可运行配置。
- **已启用**：存在可供新运行使用的配置。

已启用 workflow 被修改后，仍显示为“已启用”，并增加辅助标识“有更新待应用”。该标识不是第三种状态，只说明编辑副本与当前启用配置不同。

### 3.2 操作文案

| 场景 | 文案 |
| --- | --- |
| 尚未启用 | `草稿` |
| 当前可运行 | `已启用` |
| 存在编辑副本 | `已启用 · 有更新待应用` |
| 首次生成可运行配置 | `启用工作流` |
| 让修改影响新运行 | `应用更新` |
| 丢弃编辑副本 | `放弃待应用的更新` |
| 历史运行使用的版本 | `配置版本 v{{version}}` |

本地尚未提交到服务端的表单内容继续使用“未保存”；已经保存到服务端但尚未应用的内容使用“待应用”。两者不得混用。

### 3.3 关键提示

首次启用：

> 启用后，这套配置将用于新运行。后续修改需要再次应用才会生效。

应用更新：

> 应用后，新运行将使用最新配置。正在运行的任务不会受到影响。

存在待应用更新时手动运行：

> 当前修改尚未应用。你可以应用更新后运行，也可以继续使用当前启用的配置。

对应操作为：

- 主操作：`应用更新并运行`
- 次操作：`按已启用配置运行`
- 取消操作：`取消`

放弃更新：

> 放弃后，工作流将恢复为当前启用的配置，此操作无法撤销。

运行详情显示：

> 配置版本 v{{version}}  
> 本次运行始终使用启动时的配置。

### 3.4 暂停与归档

草稿/已启用描述的是配置能否被运行。现有暂停与归档属于运营管理能力，不参与 revision 状态机：

- 暂停：阻止创建新运行，但不停止已有运行，也不删除已启用配置。
- 归档：从默认列表隐藏并阻止新运行，历史运行仍可查看。

服务端可继续保留现有 `draft`、`active`、`paused`、`archived` 状态以降低迁移风险；前端在编辑与启用主流程中只突出“草稿/已启用”，将暂停和归档作为独立操作呈现。

## 四、数据模型

### 4.1 Workflow 与 Revision

`multica_workflow` 继续作为稳定身份、工作区归属、权限和运营状态的容器，新增：

```text
active_revision_id  UUID NULL
draft_revision_id   UUID NOT NULL
```

新增 `multica_workflow_revision`：

```text
id            UUID PRIMARY KEY
workflow_id   UUID NOT NULL
version       INT NULL
enabled_at    TIMESTAMPTZ NULL
created_at    TIMESTAMPTZ NOT NULL
```

约束：

- `(workflow_id, version)` 在 `version IS NOT NULL` 时唯一。
- `active_revision_id` 必须指向同一 workflow 下已经启用的 revision。
- `draft_revision_id` 必须指向同一 workflow 下的 revision。
- `active_revision_id IS NULL` 表示 workflow 仍是草稿。
- `active_revision_id = draft_revision_id` 表示没有待应用更新。
- 已赋予 `version` 的 revision 不允许再修改。

为保证两个 revision 指针不能跨 workflow，revision 建立 `(workflow_id, id)` 唯一约束，workflow 通过 `(id, active_revision_id)` 和 `(id, draft_revision_id)` 使用组合外键引用。创建 workflow 时预生成两侧 UUID，并使用 `DEFERRABLE INITIALLY DEFERRED` 外键在同一事务内完成循环引用写入。

可编辑的 workflow 配置归属 revision，包括标题、描述、`max_retries` 以及默认运行时选择策略。`multica_workflow` 不再作为这些字段的运行时数据源。列表和编辑器展示 draft revision 的标题，运行列表继续使用 `workflow_run.workflow_title` 快照，运行详情使用其绑定 revision。

### 4.2 Revision 图数据

以下定义数据改为归属 `workflow_revision_id`：

- `multica_workflow_node`
- `multica_workflow_edge`
- `multica_workflow_stage`
- `multica_workflow_node_deliverable`

workspace 级 `multica_workflow_role` 仍是可编辑实体，不能由 revision 直接作为运行时数据源。新增 `multica_workflow_revision_role`，包含 `id`、`workflow_revision_id`、`source_role_id`、`name`、`description` 和 `needs_description`，并以 `(workflow_revision_id, source_role_id)` 唯一。revision 节点的 worker/critic 角色槽引用 revision role ID，不直接引用 workspace role。应用更新时从当前 workspace role 刷新 draft 中被引用的角色快照；角色已删除时预检失败并要求重新选择。启用后快照冻结，删除源角色也不级联删除快照。运行时从 revision role 创建 role resolution，候选成员和 agent 仍按运行时实际可用对象动态解析。

API 路由仍使用稳定的 workflow ID。编辑接口在服务端解析 `draft_revision_id`，运行和历史查看接口解析指定 revision，不把 revision ID 暴露为主要导航参数。

节点与边继续使用关系表，而不是保存为单个 JSONB 快照。这样可保留外键、唯一索引、DAG 查询、sqlc 类型和现有服务结构。边的 source/target、节点的 stage 及交付物的 node 关联均使用包含 `workflow_revision_id` 的组合外键，禁止跨 revision 连接。

### 4.3 Run 绑定

`multica_workflow_run` 新增：

```text
workflow_revision_id UUID NOT NULL
workflow_version     INT NOT NULL
```

`workflow_node_run.workflow_node_id` 指向该 revision 中的不可变节点。外键删除行为由 `ON DELETE CASCADE` 改为延迟检查的 `ON DELETE NO ACTION`；历史 revision 只能按明确的数据保留策略清理，不能由编辑操作删除。显式删除整个 workflow 时，在同一事务内先清理 run，再清理 revision 图，避免立即约束阻断合法的整体删除。

`multica_workflow_node_deliverable_submission` 仍是 node run 下的运行数据，不归属 revision。其 `deliverable_id` 指向不可变 revision deliverable，并采用与 node run 相同的延迟保护约束；删除整个 workflow 时先删除 submission 和 run 数据，再删除 revision 定义。

运行详情根据 `workflow_revision_id` 读取节点、边、阶段和画布坐标，因此能够准确回放启动时的配置。

## 五、编辑与启用流程

### 5.1 新建 Workflow

1. 创建 workflow 和第一个未编号 revision。
2. `draft_revision_id` 指向该 revision，`active_revision_id` 为空。
3. 所有节点、边、阶段和交付物编辑均写入 draft revision。
4. workflow 不能被自动触发或分配运行，直到首次启用成功。

### 5.2 编辑已启用 Workflow

采用 copy-on-write：

1. 编辑接口锁定 workflow 行。
2. 若 `draft_revision_id = active_revision_id`，在同一事务中复制当前 revision 的工作流级配置、revision role、阶段、节点、边和交付物。
3. 更新 `draft_revision_id` 指向复制结果。
4. 在新的 draft revision 上执行本次编辑。
5. 若已存在独立 draft，直接更新该 draft。

workflow 行锁保证多个并发编辑请求只创建一个 draft。复制过程需要维护 revision role、阶段和节点三组旧 ID 到新 ID 的映射：先复制 revision role 和阶段，再用新 role/stage ID 复制节点，最后用新 node ID 复制边和交付物。节点的 worker/critic 角色槽不得继续引用源 revision role。

现有细粒度接口和前端交互可以保留：节点表单仍显式保存，新增/删除节点、边和阶段仍可立即保存到服务端 draft。它们不会影响当前启用配置。

### 5.3 启用与应用更新

首次“启用工作流”和后续“应用更新”调用同一个服务方法：

1. 锁定 workflow 及其 draft revision。
2. 对完整 draft 执行节点配置、角色、交付物和 DAG 预检。
3. 预检失败时不切换 active revision，并返回现有结构化错误。
4. 计算下一个单调递增版本号。
5. 为 draft 写入 `version` 和 `enabled_at`，使其成为不可变 revision。
6. 原子更新 `active_revision_id = draft_revision_id`。
7. 首次启用时将 workflow 运营状态从 `draft` 更新为 `active`；后续应用更新不改变 `active`、`paused` 或 `archived` 状态。
8. 提交后发布 workflow 更新事件并失效相关查询。

切换必须在单个数据库事务中完成。并发启动运行只能观察到旧 revision 或新 revision，不会读取半启用状态。

### 5.4 放弃待应用更新

仅当 `draft_revision_id != active_revision_id` 时允许执行：

1. 锁定 workflow。
2. 将 `draft_revision_id` 重置为 `active_revision_id`。
3. 删除不再被引用的未启用 draft revision 及其图数据。

该操作不修改当前启用配置，也不影响任何运行。

## 六、运行时读取规则

### 6.1 启动运行

启动入口只接受已启用且未暂停、未归档的 workflow：

1. 读取 `active_revision_id`。
2. 在事务内基于该 revision 创建 workflow run 和全部 node run。
3. 把 `workflow_revision_id` 和版本号写入 workflow run。
4. 从同一 revision 读取节点、边、角色槽和交付物要求。

手动运行遇到待应用更新时，由用户选择“应用更新并运行”或“按已启用配置运行”。Issue 分配、自动化和 API 等非交互入口始终使用 `active_revision_id`。

### 6.2 运行过程

所有执行语义必须来自 run 绑定的 revision 或 node run 自身，禁止通过稳定 workflow ID 读取 draft：

- 下游激活读取 revision 内的边。
- 节点类型和 Split 初始配置读取 revision 节点。
- worker、critic 和角色解析基于 revision 节点创建的 node run/resolution 快照。
- 交付物要求读取 revision 节点下的交付物。
- 运行详情读取 run 绑定 revision 的画布。

运行服务必须通过集中式查询入口读取配置，例如按 node run 加载其 revision node、按 run 加载 revision graph。运行路径不得直接调用按稳定 workflow ID 查询当前节点或边的方法，避免调用方误选编辑态数据源。

### 6.3 Split 运行时配置

当前 Split 流程存在运行期间更新 `workflow_node.format_schema` 的路径，必须移除。运行期间允许调整的 `max_concurrency` 等参数写入 `workflow_node_run` 的运行配置覆盖字段，并继续使用现有 `split_config_version` 做乐观并发控制。

Split 运行配置仅影响当前 node run，不回写 draft 或已启用 revision，也不影响其他运行。

### 6.4 特殊创建与复制入口

- 系统默认 workflow：在一个事务中直接创建 workflow、不可变 `v1`、revision 图及 active/draft 指针。后续仍允许按现有逻辑在 node run 上覆盖具体 worker/critic，不修改 `v1`。
- 从模板创建：只复制模板的 `active_revision_id` 到新 workflow 的 draft。模板存在待应用更新时不复制这些更新，并在模板预览中明确仍以已启用配置创建。没有 active revision 的模板不能用于创建。
- 模板自身编辑：与普通 workflow 一样写入 draft，并通过“应用更新”生成新版本。
- Split 子 workflow：Split 配置保存稳定 workflow ID；创建每个子 workflow run 时解析该 workflow 当时的 `active_revision_id`，并把 revision 固定到子 run。没有已启用配置、已暂停或已归档时返回明确错误，不回退到 draft。
- 克隆与系统种子：所有绕过普通 CRUD 的入口必须显式选择源 revision，并通过统一 revision clone 服务复制完整的 workflow 配置、revision role、阶段、节点、边和交付物及其 ID 映射，不得继续按 workflow ID 无条件读取全部节点。

## 七、API 与前端

### 7.1 API

现有 workflow、node、edge、stage 和 deliverable 路由保持不变，服务端将编辑写入 draft revision。新增：

- `POST /api/workflows/{id}/apply`：首次启用或应用更新。
- `POST /api/workflows/{id}/discard-draft`：放弃待应用更新。
- workflow 响应增加 `has_active_revision`、`has_pending_changes` 和 `active_version`。
- workflow run 响应增加可选的 `workflow_version`。

新增响应字段必须通过 Zod schema 解析并提供 fallback，避免旧桌面客户端或新旧服务端组合导致白屏。

### 7.2 编辑器

编辑器默认展示 draft revision；没有独立 draft 时展示当前启用 revision。第一次修改由服务端透明执行 copy-on-write，前端无需先创建草稿。

工具栏需要区分：

- 本地未保存：`未保存`
- 服务端 draft 与 active 不同：`有更新待应用`
- draft 已应用：`所有更新已应用`

启用或应用更新前，必须先提交本地未保存字段。保存失败时不得继续应用。

### 7.3 运行详情

运行详情显示只读的 revision 图和“配置版本 vN”。不得复用编辑器当前 draft 的节点、边或阶段查询。

历史 revision 中引用的成员、agent 或 squad 被删除时，运行详情使用 node run、角色解析和已有展示快照降级显示，不阻止页面渲染。

### 7.4 旧客户端兼容

支持 revision 编辑的新客户端在写请求中发送 workflow revision capability。缺少该 capability 的旧客户端仍可读取 workflow、查看运行并编辑尚未启用的草稿；对已启用 workflow 的 node、edge、stage、deliverable 或执行配置写请求，服务端返回带稳定错误码和可读升级说明的 `409 Conflict`，不得返回保存成功。

旧客户端现有“暂停/激活”操作只改变运营状态，不隐式应用 draft。这样虽然限制了旧客户端编辑已启用 workflow，但不会让用户误以为保存已经影响运行，也不会用每次细粒度保存自动生成版本。新客户端解析该错误并显示升级提示；旧客户端至少显示服务端返回的可读错误。该保护仅位于 API 边界，不进入内部运行服务。

## 八、迁移

该模型会改变现有节点查询的作用域，不支持新旧服务同时写入，因此采用维护窗口内的原子迁移：停止旧服务写入，执行迁移并回填，部署新服务，再恢复流量。不保留按 `workflow_id` 读取多 revision 的过渡查询或双写路径。

迁移按以下顺序执行：

1. 创建 revision 表并为现有 workflow 生成 revision。
2. 将现有节点、边、阶段和交付物关联到对应 revision。
3. 为已有 `active`、`paused`、`archived` workflow 生成版本 `v1`，同时设置 active/draft 指针。
4. `draft` workflow 只设置 draft 指针，不分配版本号。
5. 为已有 workflow run 绑定迁移时生成的 revision，并回填版本号。
6. 调整外键和唯一索引，使约束以 revision 为作用域。
7. 将运行态查询切换为 revision 作用域，并移除依赖旧 workflow ID 的图查询后再恢复服务流量。

历史运行在迁移前没有完整快照，无法恢复其真正的启动配置。迁移只能绑定部署时的现有定义；该限制需要记录，但不应伪造更早版本。

每个数据库迁移必须同时提供 `.up.sql` 和 `.down.sql`。由于降级会丢失 revision 历史，down migration 只保证结构可回退，不承诺保留新版本数据。

## 九、错误处理与并发

- 应用预检失败：保留 draft，返回具体问题，active revision 不变。
- copy-on-write 失败：整个编辑请求回滚，active revision 不变。
- 并发首次编辑：通过 workflow 行锁只创建一个 draft。
- 并发应用更新：通过 workflow 行锁串行化，重复请求返回当前已应用版本，不生成空版本。
- 启用与启动并发：运行绑定完整的旧 revision 或新 revision。
- 放弃与编辑并发：通过同一 workflow 行锁串行化。
- 删除 workflow：显式删除 workflow 时才允许级联清理 revisions；普通节点编辑不得触及历史 revision。

应用、放弃和启动接口应支持现有请求重试模式；若调用方提供幂等键，不得因网络重试创建重复版本或重复运行。

## 十、测试策略

### 10.1 数据库与服务

- 新建 workflow 只有 draft，没有 active revision。
- 首次启用生成 `v1`，后续应用生成递增版本。
- 第一次编辑 active revision 只创建一个 draft。
- 并发编辑不会创建多个有效 draft。
- 编辑节点、边、阶段和交付物不会改变 active revision。
- 放弃更新恢复 active revision。
- 运行固定绑定启动时 revision。
- 更新或删除 draft 节点不会影响进行中的 node run。
- 更新 DAG 后，旧运行继续按旧边调度，新运行按新边调度。
- 更新 Split 配置和交付物后，旧运行继续使用旧配置。
- 修改 workspace role 的名称或描述不会改变已启用 revision；应用更新后，新运行使用新的角色快照。
- Split 运行时调整只更新 node run。
- 暂停和归档阻止新运行，但不影响已有运行。
- 默认 workflow 原子创建已启用 `v1`，node run 覆盖执行人时不修改 revision。
- 模板克隆只复制 active revision，不复制待应用更新。
- Split 子 workflow 在子 run 启动时绑定其 active revision。
- 迁移正确回填现有 workflow、图数据和 run。

### 10.2 API 与兼容性

- apply/discard 的权限、预检错误和幂等行为。
- workflow 响应正确返回 active、pending 和 version 信息。
- workflow run 响应缺失或携带错误类型的新字段时，前端 schema 使用 fallback。
- 缺少 revision capability 的旧客户端无法修改已启用 workflow，并收到稳定的升级错误。

### 10.3 前端

- 草稿、已启用和“有更新待应用”展示正确。
- 本地未保存与服务端待应用状态不混淆。
- 启用、应用更新、放弃更新的确认文案和按钮正确。
- 有待应用更新时，手动运行提供两个明确选择。
- 运行详情使用历史 revision，而不是当前编辑数据。

## 十一、非目标

- 不提供用户手动创建、命名、删除或切换任意历史版本的版本管理页面。
- 不支持从历史版本直接回滚；后续可将历史 revision 复制为新 draft 实现。
- 不让运行中修改回写 workflow 定义。
- 不改变 agent、member、squad 实体自身的版本语义。
- 不在本期自动清理历史 revision。

## 十二、成功标准

- 用户可以在 workflow 运行期间继续编辑，不中断或改变现有运行。
- 保存和应用更新的语义明确，用户知道修改何时影响新运行。
- 任一 workflow run 都能确定并展示唯一配置版本。
- 运行引擎不再读取或修改 workflow draft。
- 节点、边、阶段、角色槽、Split 配置和交付物均具备一致的运行隔离。
- 现有关系型查询、数据库约束和 sqlc 类型得到保留，不引入长期双写或 JSON 图解析。

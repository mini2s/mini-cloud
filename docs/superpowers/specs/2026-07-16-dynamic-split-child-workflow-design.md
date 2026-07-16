# Dynamic Split Child Workflow Design

## 背景

Dynamic split 的既有设计把 `child_workflow_id` 放在 split 节点配置里，实际实现也按这个字段为所有动态生成的子 issue 统一启动同一个 workflow。这会造成产品心智偏差：用户真正审核的是一批将要创建的子 issue，而不是在给 split 节点本身绑定 workflow。

为了降低实现复杂度，第一期只支持一种子 issue 执行方式：**workflow**。关键纠偏点保留：workflow 绑定在每条子 issue 草案上；split 节点只提供默认 issue workflow。用户可以在审核面板中逐条修改子 issue 将要使用的 workflow。

本设计替代旧的 `child_workflow_id` 语义，不做旧字段兼容。

## 用户视角

用户不需要理解内部的 node run 和 split task 表结构。用户流程应是：

1. 在 workflow 编辑器中放置"任务拆分"节点。
2. 配置 Planner agent、默认 issue workflow、并发和失败策略。
3. 父 issue 运行到 split 节点后，Agent 动态生成子 issue 草案。
4. 审核者在审核面板中逐条检查标题、描述、执行 workflow 和依赖。
5. 审核者可以用下拉选择器精确修改某条草案的执行 workflow。
6. 点击"确认创建"后，系统创建子 issue，并按每条子 issue 自己的 workflow 启动对应 WorkflowRun。
7. 父 issue 和父 workflow 聚合展示所有子 issue 的状态。

核心产品表达：

- split 节点上配置的是 **默认 issue workflow**。
- 审核面板每条草案展示的是 **执行 workflow**。
- 真实绑定点是子 issue 草案的 `workflow_id`。
- 确认创建后，草案 `workflow_id` 写入真实子 issue，并用于启动 WorkflowRun。
- split 节点自身不绑定子 workflow，也不代表所有子 issue 必须使用同一个 workflow。

## 术语

| 术语 | 含义 |
| --- | --- |
| Planner worker | split 节点自己的 worker，负责生成和调整子 issue 草案的非 workflow 内容 |
| 默认 issue workflow | split 节点配置的默认 workflow，后端用于填充动态生成的草案 |
| 草案 workflow | 每条 split task 上的最终 `workflow_id`，审核面板可修改 |
| 子 issue workflow | 子 issue 创建后绑定并启动的 workflow，来自草案 workflow |
| split group | 一个 split node run 下的全部草案、子 issue、WorkflowRun 和聚合状态 |

这些概念必须分开。尤其不能把 Planner worker 和子 issue workflow 混成一个字段或一个 UI label。

## 目标

- 将 workflow 绑定粒度从 split 节点下沉到每条动态生成的子 issue 草案。
- 第一阶段只支持 workflow，不支持 agent、member、squad 或 role 作为子 issue 执行方式。
- 审核面板逐条展示和修改执行 workflow。
- 保留 split 节点的默认配置能力，但文案必须明确它只是默认值。
- 确认创建时按每条草案的 `workflow_id` materialize 子 issue 并启动对应 WorkflowRun。
- 明确定义 `barrier` 和 `pipeline` 两种模式的父节点释放语义。
- 不保留 `child_workflow_id` 旧字段兼容路径。

## 非目标

- 不让 split 节点直接代表子 workflow。
- 不支持非 workflow 执行方式。
- 不让 Planner agent 绕过审核直接创建真实子 issue。
- 不允许自然语言批量修改 workflow；workflow 修改必须走确定性的逐条选择。
- 不在 `split_active` 期间动态新增子 issue。
- 不在第一期支持三层及以上拆分嵌套。
- 不在第一期实现 workspace 或 daemon 级全局并发上限；第一期只实现单个 split group 内的 `max_concurrency`。
- 不回滚已完成子 workflow 的外部副作用；失败清理只取消未完成运行并跳过未启动任务。

## 核心模型

```text
split node:
  split_config.default_issue_workflow_id

split task draft:
  workflow_id
  version

child issue:
  assignee_type = "workflow"
  assignee_id = workflow_id
  workflow_id
  workflow_run_id   only after dispatch succeeds
```

设计取舍：

- workflow 不再是 split 节点的固定子配置，而是每条 split task 的字段。
- Planner agent 不制定 `workflow_id`；动态生成草案时，后端在写入前统一填充 split 节点默认 workflow。
- Planner agent 的草案写入请求如果包含 `workflow_id`，后端直接忽略该字段，仍按 split 节点默认 workflow 填充。
- 审核面板修改执行 workflow，本质上就是修改草案的 `workflow_id`。
- 创建真实子 issue 时，草案 `workflow_id` 写入 issue 的 `assignee_id` 和 `workflow_id`。
- SplitOrchestrator 仍然是 split 子任务的唯一调度器，负责按依赖和并发启动 WorkflowRun。

## 数据模型

### `workflow_node.format_schema`

旧字段 `child_workflow_id` 移除。split 节点配置改为：

```json
{
  "type": "split",
  "split_config": {
    "default_issue_workflow_id": "<workflow_uuid>",
    "mode": "barrier",
    "max_concurrency": 5,
    "max_failures": 0
  }
}
```

规则：

- `default_issue_workflow_id` 必须指向同 workspace 下 active workflow。
- `default_issue_workflow_id` 不能是当前 workflow。
- `default_issue_workflow_id` 指向的 workflow 不能包含 split 节点。
- `default_issue_workflow_id` 是必填项。否则 split 节点不能激活。
- 被选中的 issue workflow 内部可以包含任意合法的非 split 节点；第一期只禁止其包含 split 节点。

### `multica_workflow_split_task`

草案行直接保存未来子 issue 的 workflow：

```sql
ALTER TABLE multica_workflow_split_task
  ADD COLUMN workflow_id UUID NOT NULL REFERENCES multica_workflow(id),
  ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
```

约束：

- `workflow_id` 必须属于同 workspace。
- `workflow_id` 必须 active。
- `workflow_id` 不能是当前 workflow。
- `workflow_id` 指向的 workflow 不能包含 split 节点。
- 每条非 discarded 草案在 approve 前必须有有效 `workflow_id`。
- `workflow_id` 在 INSERT 前由后端完成填充和校验，保证 `NOT NULL` 约束不会依赖 approve 阶段补救。

移除或不再新增 `suggested_assignee_type` / `suggested_assignee_id` 的产品语义。第一期子 issue 的执行方式固定是 workflow。

### Issue assignee 规则

workflow_split 子 issue 创建后固定为：

```text
assignee_type = "workflow"
assignee_id = workflow_id
```

规则：

- `origin_type = "workflow_split"` 且 split task 未进入终态时，不允许把 `assignee_type` 改为非 `workflow`。
- 若普通 issue 更新链路收到这类变更，返回 `409 conflict`，提示必须通过 split 审核或 retry 流程修改执行 workflow。
- workflow_split 子 issue 的启动、取消、重试只由 SplitOrchestrator 处理，普通 issue reassign 不得自动启动 WorkflowRun。
- Issue 列表可以展示 workflow assignee；第一期不要求新增复杂筛选能力，但不能把 `workflow` assignee 当作 member 或 agent 解析。

## Agent 草案生成

Planner agent 只生成子 issue 草案内容，不生成、不建议、不选择 `workflow_id`。草案的执行 workflow 来自用户在 workflow 编辑器中配置的 `split_config.default_issue_workflow_id`，或后续审核面板的确定性修改。

```json
{
  "key": "migrate-user-service",
  "title": "迁移 user-service",
  "description": "迁移 API 与 schema",
  "depends_on": []
}
```

后端接收 Planner agent 的草案后，用 `split_config.default_issue_workflow_id` 填充到 split task。填充后写入草案行，而不是在 approve 时临时回退。

如果 Planner agent 的草案请求包含 `workflow_id`，后端直接忽略该字段，不校验、不报错、不写入。最终落库的草案 `workflow_id` 始终来自 `split_config.default_issue_workflow_id`。这能避免模型输出影响执行 workflow，同时不因为多余字段导致整批草案生成失败。

Planner agent 不获取可选 workflow 列表：

- 后端不向 Planner agent 提供 `list_available_issue_workflows` tool。
- prompt 不注入可选 workflow id、name、description 或完整 workflow 定义。
- prompt 只说明系统会按默认 issue workflow 填充草案，workflow 调整必须由审核者在审核面板中完成。

生成上下文必须明确区分：

- Planner worker：谁在生成草案。
- 默认 issue workflow：后端为动态草案填充的 workflow。
- 审核 workflow 选项：只提供给审核面板和确定性 API，不提供给 Planner agent。

Prompt 应避免使用 "split node workflow" 和 "task workflow_id" 这类表达，改用 "default issue workflow" 和 "execution workflow"。

## 审核面板

审核面板必须让用户看到每条子 issue 草案的最终执行 workflow。

每条草案行展示：

- 标题和描述摘要。
- 执行 workflow。
- 依赖。
- 草案状态：`draft`、`discarded`、`approved`、`created`、`running`、`done`、`failed`、`cancelled`、`skipped`。
- 审核期风险：执行 workflow 失效、依赖指向已 discard 草案、依赖成环、标题为空、草案版本冲突。
- 当前 `version`；最后修改时间只作展示，不作为冲突检测依据。

示例：

```text
01 迁移 user-service
执行 workflow：代码实现 workflow [下拉修改]
依赖：无

02 补充回归测试
执行 workflow：测试 workflow [下拉修改]
依赖：01
```

交互规则：

- 行内下拉可以精确修改单条草案的执行 workflow。
- 审核面板提供确定性的批量操作，例如"选中多条后改为..."和"全部失效 workflow 改为..."；该能力走批量 PATCH API，不走自然语言。
- 下拉修改是确定性 API 更新，不需要经过 Agent。
- 审核面板提供确定性的新增草案、丢弃草案、恢复草案入口；这些操作走草案 CRUD/PATCH API，不依赖自然语言。
- `max_concurrency` 可在审核期和 `split_active` 期间修改；修改后只影响后续调度，不抢占或取消已经 running 的子任务。
- 自然语言交互不得修改 `workflow_id`；涉及 workflow 调整的自然语言请求应提示用户使用每行下拉选择。
- `/split/chat` 如保留，只能调整标题、描述、拆分粒度或依赖等非 workflow 字段，并且必须使用草案版本号做并发控制。
- 任一保留草案缺少有效 workflow 时，确认创建按钮禁用，并在结论区显示具体阻塞项。
- 审核面板长时间打开后，保存和确认创建都以后端最新校验为准；失败时刷新 workflow 选项并保留用户当前草案。

编辑器中的 split 节点配置文案：

- `Planner agent`
- `默认 issue workflow`
- `Mode`
- `Max concurrency`
- `Failure policy`

帮助文案：

```text
动态生成的子 issue 默认使用该 workflow。每个子 issue 可在审核面板中单独修改。
```

## API 设计

### Batch Draft API

Planner agent 初始写入草案必须使用批量 API，保证原子性：

```http
POST /api/node-runs/{nodeRunID}/split/draft-tasks/batch
```

请求：

```json
{
  "tasks": [
    {
      "draft_key": "migrate-user-service",
      "title": "迁移 user-service",
      "description": "迁移 API 与 schema",
      "depends_on": []
    }
  ]
}
```

规则：

- 整批请求在一个 DB transaction 中完成。
- 每条 task 必须带稳定 `draft_key`；旧请求中的 `key` 仅可作为兼容输入别名进入服务层，落库字段统一为 `draft_key`。
- 后端使用 `(node_run_id, draft_key)` 幂等 upsert；Planner agent 调用超时后重试不会产生重复草案。
- 同一批请求内 `draft_key` 重复时返回 `422 duplicate_split_draft_key`。
- 默认 workflow 失效、依赖非法或 title 为空时，整批失败，不产生部分草案。
- Planner agent 批量草案请求中的 `workflow_id` 会被忽略；后端在 INSERT 前用 split 节点默认 issue workflow 填充。
- 若 Planner agent 显式传入 `workflow_id`，不校验该值，也不写入该值。
- 创建成功后返回完整 split tasks response，包含每条草案填充后的 `workflow_id` 和 `version`。

### 审核期确定性修改 API

新增或扩展现有草案更新 API：

```http
PATCH /api/node-runs/{nodeRunID}/split/draft-tasks/{taskID}
```

请求：

```json
{
  "workflow_id": "<workflow_uuid>",
  "title": "迁移 user-service",
  "description": "迁移 API 与 schema",
  "depends_on": ["uuid-0"],
  "discarded": false,
  "expected_version": 3
}
```

规则：

- 只允许 `awaiting_split_review` 状态修改。
- 只能修改同一个 node run 下的 draft task。
- 允许修改字段为：`title`、`description`、`depends_on`、`discarded`、`workflow_id`。
- 必须提供 `expected_version`；版本不一致返回 `409 draft_task_conflict`，前端刷新草案并提示用户重新确认。
- 修改后立即校验 title、依赖 DAG 和 workflow 合法性。
- workflow 不存在、inactive、跨 workspace、指向当前 workflow 或包含 split 节点时，返回 `422 invalid_split_task_workflow`。
- `depends_on` 只能引用同一 node run 下未 discarded 的草案；成环或非法引用返回 `422 invalid_split_task_dependency`。
- 前端在下拉旁显示内联错误，并重新请求 workflow 选项列表。
- 修改成功后 `version += 1`，返回完整 split tasks response。

### 审核期新增草案 API

审核者手动新增子任务必须走确定性 API：

```http
POST /api/node-runs/{nodeRunID}/split/draft-tasks
```

请求：

```json
{
  "title": "补充回归测试",
  "description": "覆盖迁移后的关键路径",
  "workflow_id": "<workflow_uuid>",
  "depends_on": ["uuid-1"]
}
```

规则：

- 只允许 `awaiting_split_review` 状态新增。
- 后端生成稳定 `draft_key`，格式可为 `manual-<uuid>`；不得与 Agent 生成的 `draft_key` 冲突。
- `workflow_id` 可缺省；缺省时使用当前 split config 快照中的 `default_issue_workflow_id` 填充。
- 新增前校验 title、依赖 DAG 和 workflow 合法性；失败时不写入。
- 成功后返回完整 split tasks response，新增草案 `version = 1`。
- 手动新增草案与 Agent 草案在 approve、discard、调度和聚合中语义一致。

### 批量 workflow 修改 API

审核面板的批量 workflow 修改走确定性 API：

```http
PATCH /api/node-runs/{nodeRunID}/split/draft-tasks/batch
```

请求：

```json
{
  "updates": [
    {
      "task_id": "uuid-1",
      "workflow_id": "<workflow_uuid>",
      "expected_version": 3
    }
  ]
}
```

规则：

- 只允许修改 `awaiting_split_review` 状态下的 draft task。
- 整批请求在一个 DB transaction 中完成。
- 任一 task 版本冲突返回 `409 draft_task_conflict`，整批不写入。
- 任一 workflow 校验失败返回 `422 invalid_split_task_workflow`，整批不写入。
- 成功后所有被修改 task 的 `version += 1`，返回完整 split tasks response。
- 前端可在 409 后保留用户本地选择，并在刷新最新草案后对未冲突字段重新应用；后端不做自动 merge。

### `/split/chat`

`/split/chat` 只用于自然语言调整非 workflow 草案内容，例如标题、描述、拆分粒度或依赖。它不得写入或覆盖 `workflow_id`。

规则：

- 允许写入字段白名单为：`title`、`description`、`depends_on`、`sort_order`、`discarded`。
- `depends_on` 写入后必须重新做 DAG 无环校验，并且只能引用同一 node run 下未 discarded 的草案。
- 不允许修改 `draft_key`、`workflow_id`、`issue_id`、`run_id`、`status`、`version`。
- 后端不向 `/split/chat` 注入可选 workflow 列表。
- Agent 返回的 patch 如果包含 `workflow_id`，后端必须拒绝该字段并返回明确错误。
- `/split/chat` 写回草案时必须携带每条草案的 `expected_version`。
- 版本冲突返回 `409 draft_task_conflict`，前端刷新草案并提示用户重新发起自然语言调整。

### Split group 调度参数 API

审核期和运行期修改并发参数走确定性 API：

```http
PATCH /api/node-runs/{nodeRunID}/split/config
```

请求：

```json
{
  "max_concurrency": 8,
  "expected_config_version": 2
}
```

规则：

- 只允许修改 `max_concurrency`；第一期不允许运行期修改 `mode`。
- `awaiting_split_review` 和 `split_active` 状态可修改；终态 node run 不可修改。
- `max_concurrency` 必须大于 0，否则返回 `422 split_max_concurrency_invalid`。
- 运行期调大后，SplitOrchestrator 在下一次调度 tick 尽量启动更多 ready task。
- 运行期调小后，不取消已 running task；只有 running 数低于新上限后才继续启动 pending/created task。
- 必须携带 `expected_config_version`；冲突返回 `409 split_config_conflict`。
- 成功后 `config_version += 1`，返回 split group 聚合状态和最新配置。

### `/split/approve`

请求保持简化：

```json
{
  "approved_task_ids": ["uuid-1", "uuid-3"]
}
```

approve 前校验所有 approved task：

- title 非空。
- description 可为空。
- `workflow_id` 有效。
- depends_on 无环且只引用同 node run 下的 approved task。
- 草案版本未被并发写入破坏。

不再接受 `modifications`。逐条 workflow 修改只走 draft patch API。

approve materialize 必须在一个 DB transaction 中完成：

- 创建所有 approved 子 issue。
- 回写所有 split task 的 `issue_id` 和 materialized 状态。
- 标记 discarded task。
- 初始化 split group 调度状态。

任一步失败时事务回滚，不允许出现部分子 issue 已创建、部分未创建的状态。

幂等要求：

- `multica_workflow_split_task.issue_id` 与子 issue 的 `origin_type = "workflow_split"` / `origin_id = split_task.id` 必须形成唯一映射。
- approve 事务内创建子 issue 时使用 `split_task.id` 作为幂等来源；并发 approve 只能有一个成功，另一个返回冲突或已 materialized 状态。
- 如果 approve 请求在响应前超时，客户端重试不得创建重复子 issue；后端应返回当前 split tasks response 或明确的状态冲突。

性能约束：

- approve 前在事务外完成可重复的只读预校验；事务内只做最终校验和最小写入。
- 第一阶段单次 approve 的非 discarded task 上限为 50，超过时返回 `422 split_task_limit_exceeded`。
- 事务内应优先使用批量 INSERT/UPDATE，避免逐条长事务持锁。

#### Discard 语义

草案可以通过审核面板或 `/split/chat` 标记为 `discarded`，也会在 approve 时将未选中的草案自动标记为 `discarded`。

规则：

- `discarded` 草案不 materialize 子 issue，不参与调度，不计入 `max_failures`。
- `discarded` 草案在 `awaiting_split_review` 期间可以恢复为 `draft`，恢复时 `version += 1`。
- approve 校验时，如果 approved task 的 `depends_on` 引用了 discarded task，请求返回 `422 invalid_split_task_dependency`；系统不自动解除依赖。
- approve 后进入 `split_active` 后，discard 状态不再可变。

#### 空草案

Planner agent 可以生成 0 个草案。此时 split node run 保持 `awaiting_split_review`，审核面板展示空状态。

空草案完成必须显式确认：

```json
{
  "approved_task_ids": [],
  "confirm_empty": true
}
```

规则：

- 仅当当前 node run 下没有任何非 discarded 草案时允许 `confirm_empty = true`。
- 成功后 split node 直接完成，不创建子 issue，也不启动 WorkflowRun。
- 缺少 `confirm_empty` 的空 approve 返回 `422 empty_split_approval_requires_confirmation`。
- 空草案确认完成后不自动重新生成；如果父 issue 后续 reopen，第一阶段要求用户重新运行父 workflow 或新建一次拆分，不支持把已完成 split node 回退到审核态。

### Workflow 选项 API

审核面板和 split 配置面板需要同一套可选 workflow 列表：

```http
GET /api/workflows/split-issue-workflow-options?parent_workflow_id=<workflow_uuid>
```

返回同 workspace 下满足以下条件的 workflow：

- active。
- 不是当前 workflow。
- 不包含 split 节点。

缓存与失效规则：

- 前端可以在打开审核面板时缓存一次选项列表。
- 下拉和批量修改入口应支持搜索；默认返回最近更新的前 50 个可选 workflow。
- 每次 PATCH 和 approve 都以后端实时校验为准。
- 后端返回 `422 invalid_split_task_workflow` 时，前端重新获取选项列表，并在对应草案行显示"执行 workflow 已失效，请重新选择"。
- 第一阶段不要求前端定时刷新，但下拉打开时可以按需重新请求。

## Materialize 与调度

approve 后按拓扑顺序创建子 issue。所有子 issue 可以先 materialize，让用户看到完整子任务列表；但 WorkflowRun 启动必须由 SplitOrchestrator 按依赖和并发统一释放，不能走普通 issue 创建时的自动 workflow 派发路径。

创建子 issue：

- `assignee_type = "workflow"`
- `assignee_id = split_task.workflow_id`
- `workflow_id = split_task.workflow_id`
- `workflow_run_id = NULL`
- `origin_type = "workflow_split"`
- `origin_id = split_task.id`

调度时：

- 当依赖满足且并发允许，加载 `split_task.workflow_id` 指向的 workflow。
- 调用 `StartRunForIssue`。
- 创建子 WorkflowRun 内部 NodeRun 和 agent task；普通 workflow 节点不 materialize 为 issue。
- 回写 `issue.workflow_run_id` 和 `split_task.run_id`。
- split task 状态进入 `running`。

普通 issue 创建/更新链路必须识别 `origin_type = "workflow_split"`：

- 创建 workflow_split 子 issue 时不自动启动 workflow run。
- 重新分配 workflow_split 子 issue 时不绕过 SplitOrchestrator 自动启动 workflow run。
- 所有启动、取消、重试都由 SplitOrchestrator 处理。

WorkflowRun 启动幂等要求：

- SplitOrchestrator 调用 `StartRunForIssue` 时必须传入可重复的 dispatch key，例如 `split-task:<split_task_id>:attempt:<attempt>`。
- `StartRunForIssue` 对同一 dispatch key 必须幂等返回同一个 WorkflowRun，避免启动成功但回写失败后重试创建重复 run。
- 回写 `issue.workflow_run_id` 和 `split_task.run_id` 前必须重新检查 task 仍处于可启动状态。
- SplitOrchestrator 重启恢复时，如果发现 dispatch key 对应 run 已存在但 task 未回写，应补写关联，而不是创建新 run。

## 进度聚合

第一期只支持 workflow，因此 split task 的运行事实来源仍是 child WorkflowRun。

聚合错误模型：

- split task response 必须包含可选 `last_error`，字段包括 `code`、`message`、`child_issue_id`、`workflow_run_id`、`node_run_id`、`occurred_at`。
- 子 WorkflowRun 或 NodeRun 失败时，聚合层应保留最近一次失败定位路径，便于父 issue 和画布展示“哪个子任务、哪个节点、什么错误”。
- pipeline 已释放后发生的失败同样写入 split group 聚合状态和事件流，不回写父 split node 的终态。

状态规则：

- WorkflowRun `completed` -> split task `done`。
- WorkflowRun `failed` -> split task `failed`。
- WorkflowRun `cancelled` -> split task `cancelled`。
- 子 issue 被手动置为 `done` 时，split task 可同步为 `done`，但第一期不要求支持手动绕过 run。
- 依赖任务进入 `failed`、`cancelled` 或 `skipped` 时，依赖它的未启动任务进入 `skipped`。

并发规则：

- `max_concurrency` 只统计同一个 split group 内 `status = running` 的 split task，即已启动但未终态的 WorkflowRun。
- `created` 但未启动的 split task 不占并发槽位。
- `done`、`failed`、`cancelled`、`skipped` 不占并发槽位。
- 第一阶段没有 workspace 或 daemon 级全局并发上限；该风险通过运维监控和后续队列限流能力处理。

### `barrier` 模式

`barrier` 是同步屏障模式。父 split node 只有在所有非 discarded 子任务进入终态后才释放下游。

规则：

- 所有子任务终态后，若失败数 `<= max_failures`，父 split node 标记 `completed`。
- 一旦失败数 `> max_failures`，split group 进入失败清理。
- 失败清理会取消 `running` task 的 WorkflowRun，跳过 `created` 或依赖已不可能满足的 task，保留已经 `done` 的 task。
- 清理完成后，父 split node 标记 `failed`，下游节点不释放。
- 已完成子 workflow 的副作用不回滚。

### `pipeline` 模式

`pipeline` 是异步释放模式。它的产品语义不是"所有子任务已完成"，而是"子 issue 已创建，split group 已由 SplitOrchestrator 接管，父 workflow 可以继续下游"。

初始释放条件：

- approve materialize 已在事务中成功创建所有 approved 子 issue。
- SplitOrchestrator 完成一次 initial dispatch loop。
- initial dispatch loop 的定义是：按依赖和拓扑顺序寻找当前 ready task，在 `max_concurrency` 允许范围内尽可能启动；当没有 ready task 或并发槽位已满时结束。
- 如果存在 ready task 但首个 WorkflowRun 启动失败，父 split node 标记 `failed`，不释放下游。
- 如果 DAG 合法但没有任何无依赖 ready task，说明依赖图校验有缺口，应返回 `422 invalid_split_task_dependency`，不释放下游。

实现状态机：

- approve 成功后，父 split node 进入 `split_active`，但不能立即按旧 `resolveSplitStatus(pipeline)` 规则标记 `completed`。
- SplitOrchestrator 需要记录或推导 initial dispatch 是否完成；只有 initial dispatch loop 成功后才能把父 split node 转为 `completed`。
- 现有实现中"所有 task materialized 即 completed"的 pipeline 判断必须移除，否则会绕过 initial dispatch 失败处理。
- SplitOrchestrator 重启后，应能从 split task 状态恢复：如果已有 task `running` 或 `done`，视为 initial dispatch 已接管；如果全部仍为 `created`，重新执行 initial dispatch loop。

父节点释放：

- initial dispatch loop 成功后，父 split node 标记 `completed` 并释放下游。
- 子任务继续由 SplitOrchestrator 在后台按依赖和并发调度。
- 父 split node 已完成后，后续子任务失败不会把该 node run 从 `completed` 改回 `failed`。
- 后续失败会更新 split group 聚合状态，并在父 issue 上显示 `split children failed after pipeline release` 类状态或事件。
- 父 workflow 的最终完成事件必须附带 split group 摘要；如果仍有 pipeline 子任务未终态，显示为"父流程已完成，拆分任务仍在执行"。

失败策略：

- `max_failures` 仍然约束 pipeline split group。
- 若后续失败数 `> max_failures`，SplitOrchestrator 停止启动新的 pending task，取消 running task，跳过未启动 task，保留 done task。
- 该失败不回滚已释放的父 workflow 下游节点；它通过父 issue 聚合状态、事件流和通知暴露给用户。
- 依赖失败仍会导致后继未启动任务进入 `skipped`。
- pipeline 后续失败必须有 E2E 覆盖：父 split node 保持 completed，父 issue 显示 split group failed/warning 状态。

## 生命周期与恢复

### 审核超时和引用失效

第一阶段不自动删除长期未审核的草案。所有引用在 PATCH 和 approve 时重新校验。

规则：

- 默认 issue workflow 或草案 workflow 失效时，approve 返回 `422 invalid_split_task_workflow`。
- 前端刷新 workflow 选项并在对应行提示用户重新选择。
- 如果父 workflow 已被修改，已存在的 node run 继续按创建时的 split config 快照执行；workflow 选项校验仍使用当前 workspace 的 active workflow 状态。
- 如果 workspace 或父 issue 已不可用，请求返回 `404` 或 `409`，审核面板进入只读错误状态。

### 父 issue 取消或删除

父 issue 在 `awaiting_split_review` 或 `split_active` 期间被取消时：

- SplitOrchestrator 取消 running task。
- created/pending task 标记 `cancelled` 或 `skipped`。
- 未 materialize 的 draft 标记 `discarded`。
- 已创建的 workflow_split 子 issue 标记 `cancelled`。
- 父 split node 或 split group 标记 `cancelled`。

实现要求：

- 前端触发父 run/父 issue 取消前必须展示二次确认，确认文案包含将被影响的 running、created/pending、未 materialize 草案和已创建子 issue 数量。
- 用户确认后才调用取消接口；未确认不得触发 `CancelSplitNode()`。
- issue 状态变更为 `cancelled` 的链路必须检测活跃 split node run，并调用 `SplitOrchestrator.CancelSplitNode()`。
- 不能只取消 agent task；workflow_split 子 WorkflowRun 必须通过 SplitOrchestrator 级联取消。
- 批量取消 issue 时也要复用同一逻辑。

父 issue 在 split group 活跃期间不允许硬删除。删除请求应先转为取消流程；取消完成后再执行已有的软删除或归档语义。

## 取消与重试

取消 split 节点：

- 对 `running` split task 调用 `CancelRun(task.run_id)`。
- 对 `created` 未启动 split task 标记 `cancelled`。
- 对对应子 issue 标记 `cancelled`。
- 父 split node 标记 `cancelled`。

重试单个子任务：

- 仅支持 `failed` 且已有 `issue_id` 的 split task。
- 清空或替换旧 `run_id`，按当前 `workflow_id` 重新启动 WorkflowRun。
- 重试前重新校验 workflow 仍 active 且不含 split 节点。
- 重试时如需改变 workflow，必须通过明确的 retry/update API 选择新的 workflow，不允许普通 issue assignee 修改绕过 SplitOrchestrator。

Retry API：

```http
POST /api/node-runs/{nodeRunID}/split/tasks/{taskID}/retry
```

请求：

```json
{
  "workflow_id": "<optional_workflow_uuid>"
}
```

规则：

- `workflow_id` 可选；缺省时使用当前 task 的 `workflow_id`。
- 传入新 `workflow_id` 时必须实时校验同 workspace、active、不是当前 workflow、且不包含 split 节点。
- retry 只允许 SplitOrchestrator 更新 split task、issue.workflow_id、issue.assignee_id 和新的 WorkflowRun 关联。
- 普通 issue assignee 修改不能触发 workflow_split retry。

## Preflight

新增或调整检查项：

| 检查项 | 严重级别 | 阻断 | 描述 |
| --- | --- | --- | --- |
| `split-default-issue-workflow-missing` | error | yes | split 节点缺少默认 issue workflow |
| `split-default-issue-workflow-invalid` | error | yes | 默认 issue workflow 无效或不属于当前 workspace |
| `split-default-issue-workflow-self` | error | yes | 默认 issue workflow 指向当前 workflow |
| `split-default-issue-workflow-inactive` | error | yes | 默认 issue workflow 不是 active |
| `split-default-issue-workflow-nested` | error | yes | 默认 issue workflow 包含 split 节点 |
| `split-max-concurrency-invalid` | error | yes | `max_concurrency` 必须大于 0 |
| `split-planner-missing` | error | yes | split 节点缺少 Planner agent |

移除旧检查：

- `split-child-workflow-missing`
- `split-child-workflow-self`
- `split-child-workflow-inactive`
- `split-child-workflow-nested`

旧检查名称会继续强化"split 节点绑定 child workflow"的错误心智，应删除而不是兼容。

## 文案规范

禁止把 split 节点配置说成 `child workflow`。建议文案：

- `默认 issue workflow`
- `执行 workflow`
- `Planner agent`
- `确认创建 {{count}} 个子 issue`
- `将创建 {{count}} 个子 issue，并按各自 workflow 启动。`

错误文案示例：

- `第 2 个子 issue 缺少执行 workflow。`
- `默认 issue workflow 无效，请重新选择。`
- `执行 workflow 不能包含任务拆分节点。`
- `执行 workflow 已失效，请重新选择。`
- `草案已被更新，请刷新后重试。`

## 迁移策略

不做旧字段兼容。实施时应通过迁移和代码更新一次性切换：

1. 数据库先为 `multica_workflow_split_task` 新增 nullable `workflow_id` 和非空默认 `version`。
2. 若环境允许清理旧 split task 数据，先清理旧 draft/created/running 数据；否则用旧 split config 的 `child_workflow_id` 对历史 task backfill。
3. backfill 或清理完成后，再 `ALTER COLUMN workflow_id SET NOT NULL` 并添加必要索引。
4. 删除 `split_config.child_workflow_id` 的读取路径。
5. `parseNodeFormat` 只接受 `default_issue_workflow_id`；`default_child_workflow_id` 不是历史字段，也不应作为过渡字段引入。
6. 前端保存 split 节点时只写新字段。
7. 后端 `parseSplitConfig` 缺少默认 issue workflow 时直接报错。
8. 更新 seed 数据、测试 fixture、preflight check label、CLI/daemon prompt 中的 split config 字段。
9. 现有测试和 fixture 全量迁移到新字段。

如果本地开发数据中已有旧 split 节点，激活时会被 preflight 拦截，用户需要重新选择默认 issue workflow 后保存。

工程影响清单：

- Go `SplitConfig.ChildWorkflowID` 改为 `DefaultIssueWorkflowID`。
- TypeScript `SplitConfig.child_workflow_id` 改为 `default_issue_workflow_id`。
- `suggested_assignee_type` / `suggested_assignee_id` 在 split draft API response 中移除或忽略，替换为 `workflow_id`。
- `startChildTaskRun` 从 split task 读取 `workflow_id`，不能再从 split config 读取统一 workflow。
- 普通 issue 创建/更新链路对 `origin_type = "workflow_split"` 的 workflow assignee 自动启动必须短路。
- Preflight 新 checkId 需要在 `preflight-bar` 和 locale 中提供友好文案。
- e2e seed 中的 `child_workflow_id: null` 必须迁移为有效 `default_issue_workflow_id`。

## 测试策略

后端：

- `parseSplitConfig` 接受 `default_issue_workflow_id`，拒绝旧 `child_workflow_id`，并确认不会引入 `default_child_workflow_id`。
- migration 分 nullable/backfill/set not null 执行，已有 `multica_workflow_split_task` 数据不会导致迁移失败。
- Batch Draft API 忽略 Planner agent 传入的 `workflow_id`，由后端填充默认 issue workflow，并在 INSERT 前完成校验。
- Batch Draft API 使用 `draft_key` 做幂等 upsert，重试不产生重复草案。
- Batch Draft API 在默认 issue workflow 无效时整批失败且不产生部分写入。
- Planner agent 显式传入 `workflow_id` 时直接忽略该字段，不校验该值，也不写入该值。
- 手动新增草案 API 缺少 `workflow_id` 时填充默认 issue workflow，返回 `version = 1`。
- PATCH draft task 必须携带 `expected_version`，版本冲突返回 `409 draft_task_conflict`。
- PATCH draft task 可修改 title、description、depends_on、discarded、workflow_id，并对依赖和 workflow 做实时校验。
- PATCH draft task workflow 失效时返回 `422 invalid_split_task_workflow`。
- 批量 workflow PATCH 在任一冲突或失效时整批回滚。
- `/split/chat` 只能修改白名单字段，不能修改 `workflow_id`、`draft_key`、`status`，且写回非 workflow 字段时使用版本校验。
- `/split/chat` 修改 `depends_on` 后执行 DAG 无环和 discarded 引用校验。
- Split config PATCH 在审核期和运行期可修改 `max_concurrency`，并发调小不取消 running task。
- approve 拒绝缺少或失效 `workflow_id` 的 task。
- approve 并发调用时只有一个成功，另一个返回冲突或状态错误。
- approve 超时后重试不会创建重复子 issue。
- approve materialize 在单个事务中创建所有子 issue 并写入各自 `workflow_id`。
- approve 超过单次 task 上限时返回 `422 split_task_limit_exceeded`。
- 空 approve 缺少 `confirm_empty` 时返回 `422`；显式确认空草案时父 split node 完成。
- approved task 依赖 discarded task 时返回 `422 invalid_split_task_dependency`。
- workflow_split 子 issue 创建后不会通过普通 issue 创建链路自动启动 WorkflowRun。
- workflow_split 子 issue 活跃期间拒绝改成非 workflow assignee。
- SplitOrchestrator 按依赖和并发启动对应 WorkflowRun，并回写 `workflow_run_id` 和 `run_id`。
- SplitOrchestrator 使用 dispatch key 幂等启动 WorkflowRun，启动成功但回写失败后恢复不会创建重复 run。
- SplitOrchestrator 重启后能恢复 pipeline split group 的调度状态。
- barrier 模式等待所有子任务终态后再释放下游。
- barrier 失败超限时取消 running、skip pending、保留 done，并将父 split node 标记 failed。
- pipeline 模式 initial dispatch loop 成功后释放父 split node。
- pipeline initial dispatch 中首个 ready WorkflowRun 启动失败时父 split node failed，不释放下游。
- pipeline 后续失败超限时不回滚父 split node，但更新 split group 聚合状态并停止后续调度。
- 父 issue 取消会级联取消 split group、子 WorkflowRun 和 workflow_split 子 issue。
- 父 issue/父 run 取消前端必须二次确认，并展示受影响子任务数量。
- 依赖失败后继任务进入 `skipped`。
- split task 失败 response 包含 child issue、workflow run、node run 和错误信息定位路径。
- 子 workflow 在执行中被修改时，已有 WorkflowRun 使用启动时快照或当前系统既有 workflow run 语义，不能影响 split task 关联。

前端：

- split 节点配置面板展示 `默认 issue workflow`，不展示旧 `child workflow`。
- 审核面板每条草案展示执行 workflow。
- 审核面板支持确定性新增、丢弃和恢复草案。
- 行内下拉修改 workflow 调用 draft patch API，并携带 `expected_version`。
- 批量"改为 workflow"操作调用批量 PATCH API，并处理 409/422。
- 审核期和运行期修改 `max_concurrency` 调用 split config PATCH，并处理 409/422。
- PATCH 返回 `422` 时刷新 workflow 选项并显示行内错误。
- PATCH 返回 `409` 时刷新草案并提示用户重新确认。
- `/split/chat` 不提供 workflow 批量调整入口。
- `/split/chat` 只暴露非 workflow 字段调整能力，且不发送 `workflow_id`。
- 确认创建按钮在任一保留草案缺少 workflow 时禁用。
- 空草案需要显式确认无需拆分。
- 子 issue 已创建但 WorkflowRun 尚未启动时，issue 列表和详情显示"等待调度"，不要误报为运行中。
- pipeline 父 workflow 已完成但子任务仍运行时，父 issue 展示拆分任务仍在执行的聚合状态。
- pipeline 后续失败时，父 issue 展示醒目的 split group warning/failed 状态。
- 子任务失败时，父 issue 和画布能展示具体子任务、失败节点和错误消息。
- 父 run/父 issue 取消前展示二次确认和受影响子任务数量。
- 确认弹窗说明会按各自 workflow 启动。
- 旧 `child_workflow_id` fixture 全部迁移或删除；不得新增 `default_child_workflow_id` fixture。
- 新 preflight checkId 在 preflight bar 中显示友好标签，而不是裸 ID。
- workflow 选项接口在大量 workflow 下支持搜索/分页或前 50 个默认结果。

E2E：

- Agent 动态生成 3 个子 issue 草案，默认使用同一个 workflow。
- 审核者把其中 1 个改成测试 workflow。
- 确认创建后，三个子 issue 分别按自己的 workflow 启动 WorkflowRun。
- 父 split 进度能聚合多个 child WorkflowRun 状态。
- barrier 模式等待三条子任务都终态后再释放下游。
- pipeline 模式 initial dispatch loop 成功后释放父 split node，下游继续执行，子任务在后台继续聚合。
- pipeline 后续子任务失败时，父 split node 不回退，但父 issue 显示 split group 失败状态。
- pipeline initial dispatch 启动失败时父 split node 失败且下游不执行。
- 默认 workflow 在草案创建后被删除，approve 返回可恢复错误。
- Batch Draft API 超时重试不会产生重复草案。
- approve 和 dispatch 重试不会产生重复子 issue 或重复 WorkflowRun。
- 父 issue 取消必须经过二次确认，确认后级联取消非终态子任务。
- 100 条草案被拒绝或分页处理；50 条以内 approve 不超时。

## 验收标准

- 用户能在 split 节点上明确配置"默认 issue workflow"。
- 用户能在审核面板看到每个动态生成子 issue 的执行 workflow。
- 用户能通过下拉精确修改某个子 issue 的执行 workflow。
- 自然语言入口不能批量修改执行 workflow。
- 确认创建后，每个子 issue 按自己的 workflow 启动，而不是统一使用 split 节点配置。
- barrier 模式下，父 workflow 等待子任务终态后再继续。
- pipeline 模式下，父 workflow 在 split group 被接管后继续，下游与子任务异步并行。
- workflow 失效、草案并发冲突、部分 materialize 失败都有明确错误和恢复路径。
- UI 中不再出现会造成歧义的旧 `child workflow` 主文案。
- 旧 `child_workflow_id` 语义不再被读取或兼容；`default_child_workflow_id` 不作为过渡字段引入。

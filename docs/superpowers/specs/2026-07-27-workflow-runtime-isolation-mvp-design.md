# Workflow 编辑与运行隔离 MVP 设计

| 项目 | 内容 |
| --- | --- |
| 日期 | 2026-07-27 |
| 状态 | 设计已确认，待实施计划 |
| 基线 | 最新 `main` |
| 目标 | 对上线后新创建的 workflow run，后续编辑不能改变其执行行为或运行详情展示 |

## 一、背景

完整的 Workflow 编辑与运行隔离方案同时覆盖快照隔离、可靠派发、legacy 全量回填、删除治理和编辑器体验调整，形成了较大的跨模块改造面。

当前 `main` 已具备运行快照、统一准备事务、运行边、运行态交付物要求和集中式运行仓储等基础能力。MVP 不重建这些基础设施，而是从最新 `main` 新建独立分支，补齐新 run 的执行与展示隔离闭环。

## 二、MVP 承诺

对上线后新创建的 run，系统提供以下保证：

1. run 在单个事务中读取一次已保存定义并生成运行快照。
2. run 创建后，定义的新增和修改不改变其执行行为。
3. 运行详情始终展示该 run 启动时的画布、配置和名称。
4. Split 运行参数只属于 node run，不回写 workflow node。
5. workflow 存在任意 run 时不能硬删除，只能归档。

MVP 不承诺还原 legacy run 的真实启动定义。旧 run 缺少真实快照时进入只读降级路径。

## 三、范围

### 3.1 包含

- 补齐 Split runtime config 隔离。
- 暴露 snapshot-compatible workflow run 和 node run API contract。
- 从 run snapshot 回放运行详情画布。
- 保留 actor 和 role 的启动时名称。
- 保留启动事务的最终配置校验和结构化错误。
- workflow 存在任意 run 时禁止硬删除。
- 活动 run 引用的节点、角色或交付物禁止删除。
- 修复 annotation、Split 引用预检、failed run 完成时间和名称快照缺口。

### 3.2 不包含

- 改变编辑器 preflight 或启用语义。
- workflow revision、发布、应用更新或历史版本管理。
- 新增或扩展 legacy run 定义回填；`main` 已有迁移行为保持不变。
- dispatch job、租约、幂等或崩溃恢复机制设计。
- workspace 删除顺序和历史 task 清理。
- 复杂 down migration 的数据反向映射。
- feature flag、长期双读或长期双写。

## 四、现有能力基线

MVP 直接复用 `main` 已有能力：

- `PrepareWorkflowRunSnapshot`
- workflow definition snapshot
- node run 执行配置快照
- node run ID 之间的运行边
- 运行态交付物要求
- `WorkflowRuntimeRepository`

上述能力是实现前置条件，但不作为本次 MVP 的新增设计内容。

`main` 已有的 legacy backfill 和 schema migration 同样作为基线保留。MVP 不回退它们，也不新增更精确的历史恢复或反向映射。

## 五、架构与数据流

### 5.1 启动

所有创建新 run 的入口继续经过统一准备服务：

```text
当前已保存定义
    |
    | PrepareWorkflowRunSnapshot（单事务）
    v
workflow run
    |- definition_snapshot
    |- node run config
    |- runtime edges
    |- role / actor snapshots
    |- split runtime_config
    `- deliverable requirements
```

准备事务执行最终运行校验。配置无效时只创建可追踪的 failed run，不创建 node run、运行边或运行态交付物要求。

### 5.2 运行

- 普通节点、Gateway 和上下游激活读取 node run 与运行边。
- Split 读取和更新 `node_run.runtime_config`。
- 交付物提交和审核读取运行态 requirement。
- actor 或 role 当前已改名或删除时，显示 run 内的名称快照。
- 新 run 的执行路径不得把当前 workflow 定义作为 fallback。

### 5.3 展示

运行详情 API 返回 definition snapshot 和 node run 状态。前端从 snapshot 构造只读画布，再通过稳定的 source node ID 关联运行状态。

新 run 的详情页不得请求当前 workflow 节点、边或阶段来补全画布。

## 六、编辑与删除约束

- 新增和修改定义允许与运行并行，已有 run 使用自己的快照。
- 删除被活动 run 引用的节点、角色或交付物时返回 `409`。
- run 进入终态后允许删除这些定义对象，历史 run 继续使用运行数据展示。
- workflow 只要存在任意 run，硬删除就返回 `409 workflow_has_runs`。
- 有历史 run 的 workflow 通过归档退出日常使用。
- workspace 整体删除不在 MVP 中调整，沿用基线行为。

删除检查和定义写入必须位于同一事务边界，避免检查后出现新的活动 run 或引用变化。

## 七、API 与兼容

现有 API 路径和请求结构保持不变。

Workflow run 响应增加或保留以下可选字段：

- `source_config_revision`
- `definition_schema_version`
- `definition_snapshot`

Node run 继续返回必填 `workflow_node_id`，兼容旧客户端。新客户端使用：

```text
source_workflow_node_id ?? workflow_node_id
```

作为画布映射 ID。

客户端 schema 必须兼容：

- 旧响应缺少新增字段。
- 新响应包含已知 snapshot schema。
- snapshot schema 版本未知或内容不完整。
- 新增字段类型错误时给出受控解析错误，而不是页面白屏。

## 八、legacy run 降级

`definition_schema_version > 0` 的新 run 使用严格 snapshot 路径。

legacy run 只用于历史查看，不参与后续执行：

- 有可用 snapshot 时优先使用 snapshot。
- 缺少 snapshot 时可以使用仍存在的当前定义进行尽力回放。
- 无法构造画布时展示节点执行记录和通用信息。
- UI 标记“历史配置可能不完整”。
- 不得把当前定义伪装成真实启动配置。

当前定义查询只允许出现在明确的 legacy 展示路径中，不能成为新 run 的兜底。

## 九、错误处理

- 编辑器保留现有 preflight 和启用行为。
- 启动事务始终执行最终校验，覆盖 API、自动化和 Split 等非编辑器入口。
- 手动启动配置错误返回 `422 workflow_config_invalid`、failed run ID 和结构化问题列表。
- 自动入口配置错误创建 failed run，并沿用现有通知机制。
- 配置失败 run 写入 `failure_reason='config_invalid'` 和 `completed_at`。
- snapshot 缺字段或版本未知时安全降级，不猜测历史配置。
- snapshot 名称非空时优先于当前 actor 或 role 名称。

## 十、交付拆分

从最新 `main` 新建 MVP 分支。当前完整方案分支继续保留，不在其上回退功能。

建议按以下顺序形成可独立审查的提交：

1. `refactor(workflow): isolate split runtime configuration`
2. `feat(workflow): expose snapshot run contracts`
3. `feat(workflow): replay run details from snapshots`
4. `fix(workflow): protect workflows with run history`
5. `fix(workflow): close snapshot isolation gaps`

现有提交若同时包含 MVP 和非 MVP 内容，应按行为重新提取，不机械 cherry-pick。运行详情提交必须保留编辑器 preflight；删除保护提交不得带入 workspace 显式删除治理。

## 十一、验证策略

默认只执行相关模块验证：

- snapshot、preflight、prepare、Split 和删除 service 测试
- workflow run handler contract 测试
- core API schema 测试
- 运行详情 snapshot 回放测试
- 编辑器 preflight 保持不变的回归测试
- TypeScript typecheck
- 新 run 路径禁止读取编辑态配置的静态扫描
- `git diff --check`

关键场景：

1. 创建新 run 后修改节点配置，执行和详情保持原值。
2. 创建新 run 后修改或删除边，运行依赖关系保持不变。
3. 修改 Split 并发参数只影响 node run，不修改 workflow node。
4. 修改交付物要求后，已有 run 继续使用原要求。
5. actor 改名或删除，以及 run 终态后删除 role，详情显示名称快照。
6. annotation 不创建 node run 或派发实体。
7. 配置错误只创建带完成时间的 failed run。
8. legacy run 缺少 snapshot 时安全降级。
9. workflow 有任意 run 时硬删除返回冲突。
10. 编辑器现有 preflight 和启用行为保持不变。

## 十二、成功标准

- 新 run 创建后，修改定义不改变执行行为。
- 新 run 详情始终展示启动时画布和名称。
- 新 run 的执行和展示路径不读取当前 workflow 定义。
- legacy run 可以安全降级且不会被描述为真实快照。
- Split 运行参数不回写 workflow node。
- workflow 有历史 run 时不能硬删除。
- 编辑器现有 preflight 行为不变。
- 所有相关模块测试和类型检查通过。

## 十三、后续阶段

以下内容在 MVP 稳定后分别设计和交付：

- legacy run 更精确的迁移和审计策略
- workspace 删除及历史 task 清理
- 编辑器 preflight 与 active 状态体验调整
- down migration 和只前滚发布策略
- 其他运行可靠性与运维治理

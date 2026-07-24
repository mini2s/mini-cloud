# 工作流运行时选择策略端到端测试计划

## 1. 文档状态

- 状态：自动化已生成，执行结果见 `artifacts/e2e/workflow-runtime-selection-20260722/report.md`
- 对应方案：[工作流节点运行时选择策略](./workflow-runtime-selection-strategy.md)
- 适用分支：`workflow-runtime-selection`
- 目标提交：`1dc8e222` 及其后续修订
- 测试对象：Web、API、Workflow Service、PostgreSQL、任务队列、daemon

## 2. 测试目标

本计划验证工作流内置智能体在真实系统链路中的节点级运行时选择行为：

```text
specified_runtime_first: 指定运行时 -> 空闲运行时 -> issue 创建人的运行时 -> 失败
idle_first: 空闲运行时 -> issue 创建人的运行时 -> 失败
issue_creator_first: issue 创建人的运行时 -> 空闲运行时 -> 失败
```

必须证明以下结果：

1. 选择发生在每个 Worker/Critic 阶段派发时，而不是整次工作流只选择一次。
2. 工作流编辑页可以保存默认策略和默认指定运行时。
3. 交互式启动可以只覆盖本次运行，自动触发使用工作流默认策略。
4. 三种策略分别按照已确认顺序选择，并保存不可变运行快照。
5. Issue 由 Agent 创建时，Issue 创建人正确解析为该 Agent 的 Owner。
6. 普通 Agent 始终保留自身绑定运行时，不进入动态选择。
7. 两个并行节点不会在存在两台空闲设备时同时选中同一运行时。
8. 自动重试、人工重跑、Worker 到 Critic 切换都会重新执行选择。
9. 无候选时节点和工作流快速失败，其他节点与活动 task 被取消。
10. 所有交互式工作流启动入口始终显示策略选择器，默认选中工作流策略。

## 3. 测试范围

### 3.1 范围内

- 创建 Issue 时分配工作流。
- 已有 Issue 改派工作流。
- 工作流编辑器“测试运行”。
- 直接调用启动工作流 API。
- 内置 Agent Worker、内置 Agent Critic、Squad Leader。
- 普通 Agent 固定绑定运行时。
- 指定运行时优先、空闲优先、issue 创建人优先和失败分支。
- 工作区隔离、运行时可见性、显式权限、在线状态和心跳健康窗口。
- 并行节点竞争、任务负载统计、事务级选择互斥。
- 自动重试和人工 task 重跑。
- 节点、运行、task、事件和日志的一致性。
- 数据库迁移的 up/down/up 验证。
- Web 与已安装桌面客户端所依赖的 API schema 兼容性。

### 3.2 范围外

- Provider 本身的模型输出质量。
- Agent prompt 内容正确性。
- Human、Gateway 节点的业务逻辑。
- 单设备上注册多个运行时的场景；产品约束是一台设备一个运行时。
- 大规模性能压测。本文只验证并发选择正确性和基本时延。

## 4. 测试方法

采用两层端到端环境。

### 4.1 确定性 E2E 环境（PR 必跑）

在当前项目的专用 E2E 工作区中启动完整 Web、API 和 PostgreSQL。测试夹具按用例保存并恢复既有运行时状态，使用带 `e2e_suite=workflow_runtime_selection` 标记的测试运行时构造心跳和负载；工作流与 task 仍通过产品 HTTP 入口创建。

测试驱动不得绕过 API 创建 task；允许在专用测试数据库中调整以下外部状态，以构造确定性前置条件：

- 运行时 `last_seen_at`、`status`、`visibility`、`owner_id`。
- 预置占位 task，使某个运行时处于繁忙状态。
- 控制两个 daemon 何时 claim/complete task。

该层用于验证所有选择分支、权限、并发竞争、重试和失败收敛。

### 4.2 两台真实设备验收环境（发布前必跑）

使用同一工作区中的两台设备 D1、D2，每台设备仅注册一个运行时。两个 daemon 必须真实保持心跳并执行最小无副作用 Agent 任务。

该层用于验证：

- 一台设备与一个运行时的一对一关系。
- 两台设备能够接收并行节点的不同 task。
- Web 显示、daemon claim、执行状态和节点结果形成完整闭环。
- 设备离线后能够在 90 秒健康窗口外被排除。

## 5. 环境准备

### 5.1 软件与服务

- Node.js 22。
- pnpm 10.28.2。
- Go 1.26.1。
- PostgreSQL 17 + pgvector。
- Chromium Playwright 浏览器。
- 两个独立 daemon 进程；真实设备验收时必须运行在两台设备上。

### 5.2 启动命令

在当前项目中执行：

```bash
make setup
make start
pnpm exec playwright install chromium
```

确认 `.env.worktree` 中的 `DATABASE_URL`、后端端口和前端端口均指向当前 worktree，不得使用开发者主工作区数据库。

建议的自动化执行命令：

```bash
pnpm exec playwright test e2e/workflow-runtime-selection.spec.ts \
  --project=chromium \
  --trace=retain-on-failure
```

真实设备验收使用相同 Web/API，但通过环境变量提供 D1、D2 的 daemon 地址或注册令牌：

```bash
E2E_REAL_RUNTIME_1=<runtime-id> \
E2E_REAL_RUNTIME_2=<runtime-id> \
pnpm exec playwright test e2e/workflow-runtime-selection-real-devices.spec.ts
```

## 6. 测试角色与数据

### 6.1 用户

| 标识 | 身份 | 用途 |
| --- | --- | --- |
| U-CREATOR | 普通成员 | 创建所属 Issue，并拥有 Issue 创建人运行时 |
| U-OPERATOR | 普通成员 | 启动或改派工作流，验证触发人不替代 Issue 创建人 |
| U-ADMIN | 工作区管理员 | 验证管理员运行时权限 |
| U-OTHER | 普通成员 | 拥有非 Issue 创建人的繁忙运行时 |

### 6.2 工作区

| 标识 | 用途 |
| --- | --- |
| W-MAIN | 所有主要场景 |
| W-OTHER | 验证跨工作区运行时不能被选择 |

### 6.3 运行时

所有运行时分别代表一台设备。

| 标识 | 工作区 | Owner | 初始状态 | 可见性 | 用途 |
| --- | --- | --- | --- | --- | --- |
| R-MANUAL | W-MAIN | U-OPERATOR | online/healthy | public | 指定运行时优先 |
| R-IDLE-1 | W-MAIN | U-OTHER | online/healthy | public | 第一空闲候选 |
| R-IDLE-2 | W-MAIN | U-ADMIN | online/healthy | public | 第二空闲候选、并发分散 |
| R-CREATOR-1 | W-MAIN | U-CREATOR | online/healthy | private | Issue 创建人回退 |
| R-CREATOR-2 | W-MAIN | U-CREATOR | online/healthy | private | 验证 Issue 创建人最小负载排序 |
| R-OTHER-BUSY | W-MAIN | U-OTHER | online/healthy | public | 验证不跨成员回退繁忙运行时 |
| R-PRIVATE | W-MAIN | U-OTHER | online/healthy | private | 无权限人工选择 |
| R-OFFLINE | W-MAIN | U-CREATOR | offline | public | 离线排除 |
| R-STALE | W-MAIN | U-CREATOR | online/stale | public | 心跳过期排除 |
| R-CROSS | W-OTHER | U-OPERATOR | online/healthy | public | 跨工作区排除 |
| R-BOUND | W-MAIN | U-OTHER | online/healthy | private | 普通 Agent 固定绑定 |

候选排序相关用例必须显式设置 `last_seen_at`、`created_at`，不能依赖测试创建速度决定顺序。

### 6.4 Agent 与 Squad

| 标识 | 类型 | runtime_id | 用途 |
| --- | --- | --- | --- |
| A-BUILTIN-W | 内置 Agent | NULL | 动态 Worker |
| A-BUILTIN-C | 内置 Agent | NULL | 动态 Critic |
| A-BOUND | 普通 Agent | R-BOUND | 固定绑定 |
| A-CREATOR | 普通 Agent | 任意有效绑定 | Owner 为 U-CREATOR，用于 Agent 创建 Issue |
| S-BUILTIN | Squad | Leader=A-BUILTIN-W | Squad Leader 解析 |

### 6.5 工作流

| 标识 | 结构 | 用途 |
| --- | --- | --- |
| WF-WORKER | 一个内置 Worker + Human Critic | 单阶段选择 |
| WF-WORKER-CRITIC | 内置 Worker + 内置 Critic | Worker/Critic 分别选择 |
| WF-PARALLEL | 两个无前置依赖的内置 Worker | 并发分散 |
| WF-BOUND | 普通 Agent Worker | 固定绑定 |
| WF-SQUAD | Squad Worker | Leader 解析 |
| WF-NO-BUILTIN | Human 或普通 Agent 节点 | UI 不再隐藏选择器 |

## 7. 通用断言

每个成功派发场景都必须同时验证 API、数据库和 daemon 三侧结果。

### 7.1 数据一致性

```sql
SELECT
    wr.id AS run_id,
    wr.runtime_selection_policy,
    wr.runtime_id AS specified_runtime_preference,
    wr.source_issue_id,
    wr.responsible_user_id,
    wr.runtime_authorizer_id,
    wnr.id AS node_run_id,
    wnr.runtime_id AS actual_runtime_id,
    wnr.runtime_selection_reason,
    wnr.failure_reason,
    task.id AS task_id,
    task.runtime_id AS task_runtime_id,
    task.status AS task_status
FROM multica_workflow_run wr
JOIN multica_workflow_node_run wnr ON wnr.workflow_run_id = wr.id
LEFT JOIN multica_agent_task_queue task
  ON task.id IN (wnr.worker_agent_task_id, wnr.critic_agent_task_id)
WHERE wr.id = $1
ORDER BY wnr.created_at, task.created_at;
```

成功派发必须满足：

- `workflow_run.runtime_selection_policy` 是本次运行的不可变策略快照。
- `workflow_run.runtime_id` 只表示指定运行时偏好，可以为 NULL。
- `workflow_node_run.runtime_id = task.runtime_id`。
- `runtime_selection_reason` 与预期分支一致。
- task 只能被实际选中运行时对应的 daemon claim。
- 同一阶段只能存在一个当前有效的 Worker 或 Critic task 关联。

### 7.2 活动负载定义

运行时活动任务数必须只统计：

```text
queued + dispatched + running
```

`completed`、`failed`、`cancelled` 不得导致运行时被判断为繁忙。

### 7.3 失败一致性

`runtime_unavailable` 场景必须满足：

- 当前节点最终为 `failed`，`failure_reason = runtime_unavailable`。
- `workflow_run.status = failed`。
- 尚未执行的兄弟节点为 `cancelled`。
- 已处于 `queued`、`dispatched`、`running` 的同一 workflow task 为 `cancelled`。
- 不存在失败后又被并发状态更新恢复为 `working` 或 `critic_reviewing` 的节点。

## 8. 端到端用例

### 8.1 UI 与请求契约

| ID | 场景与步骤 | 预期结果 |
| --- | --- | --- |
| UI-01 | 工作流编辑页打开“运行设置” | 显示三种默认策略；默认 `idle_first` |
| UI-02 | 默认策略选择指定运行时优先但未选择运行时 | 不能保存并显示明确校验信息 |
| UI-03 | 已保存的默认运行时离线后重新打开设置 | 保留并标记离线，不静默清空 |
| UI-04 | 选择不含内置 Agent 的 WF-NO-BUILTIN | 仍显示选择器 |
| UI-05 | 在工作流编辑器点击“保存并测试” | 先完成保存，再显示选择器；确认前不发送启动请求 |
| UI-06 | 工作流默认创建人优先，启动弹窗不修改并确认 | run 快照为 `issue_creator_first`；工作流默认值不变 |
| UI-07 | 本次覆盖为指定运行时优先并选择 R-MANUAL | 请求携带策略与 `runtime_id`；不修改工作流默认值 |
| UI-08 | R-OFFLINE 可由当前用户使用 | 人工选项保留该运行时并标记离线；派发时仍重新校验并回退 |
| UI-09 | 关闭选择器 | 不创建/改派 Issue，不启动测试运行 |
| UI-10 | WF-BOUND 覆盖为指定优先后运行 | 选择器说明普通智能体保持自身绑定；实际 task 使用 R-BOUND |
| UI-11 | 测试运行选择创建人优先 | 提示没有关联 issue，将直接选择空闲运行时 |

UI-01、UI-02、UI-03 必须分别独立执行，禁止只通过组件 mock 证明。

### 8.2 请求边界与权限

| ID | 请求 | 预期结果 |
| --- | --- | --- |
| API-01 | `runtime_id` 为非法 UUID | HTTP 400，不创建 run/task |
| API-02 | 指定 R-CROSS | HTTP 400，不创建 run/task |
| API-03 | U-OPERATOR 指定无权限的 R-PRIVATE | HTTP 403，不创建 run/task |
| API-04 | U-ADMIN 指定 R-PRIVATE | 请求通过，节点派发时仍重新校验在线与健康状态 |
| API-05 | U-OPERATOR 获得 R-PRIVATE 的 operator 权限后指定它 | 请求通过，reason=`manual` |
| API-06 | 两个策略字段都缺失 | 使用工作流默认策略和默认运行时 |
| API-07 | 旧客户端只传有效 `runtime_id` | 解释为 `specified_runtime_first` |
| API-08 | 显式指定优先但缺少 `runtime_id` | HTTP 400，不创建 run/task |
| API-09 | 空闲优先或创建人优先同时传 `runtime_id` | HTTP 400，不创建 run/task |
| API-10 | 非法策略枚举 | HTTP 400，不创建 run/task |

上述用例分别覆盖创建 Issue、更新 Issue 和 `POST /api/workflows/{id}/runs` 三类入口。

### 8.3 选择优先级

| ID | 前置条件与步骤 | 预期实际运行时 | reason |
| --- | --- | --- | --- |
| SEL-01 | `specified_runtime_first`；R-MANUAL 有 3 个活动 task，R-IDLE-1 空闲 | R-MANUAL | manual |
| SEL-02 | 指定偏好 R-OFFLINE，R-IDLE-1 空闲；在快照保存后使其离线再派发 | R-IDLE-1 | idle |
| SEL-03 | 指定偏好 R-STALE，R-IDLE-1 空闲 | R-IDLE-1 | idle |
| SEL-04 | `idle_first`；R-IDLE-1、R-IDLE-2 均空闲，R-IDLE-1 心跳更新 | R-IDLE-1 | idle |
| SEL-05 | `idle_first`；所有非创建人运行时繁忙；R-CREATOR-1 负载 2，R-CREATOR-2 负载 1 | R-CREATOR-2 | issue_creator |
| SEL-06 | `idle_first`；R-CREATOR-1 繁忙，但 R-IDLE-1 空闲 | R-IDLE-1 | idle |
| SEL-07 | 没有空闲运行时；只有 R-OTHER-BUSY 合格且繁忙，Issue 创建人没有运行时 | 无 | runtime_unavailable |
| SEL-08 | 直接测试运行，没有所属 Issue；所有运行时繁忙 | 无 | runtime_unavailable |
| SEL-09 | Issue 由 A-CREATOR 创建；无空闲运行时 | U-CREATOR 负载最低运行时 | issue_creator |
| SEL-10 | WF-BOUND；R-BOUND 繁忙、R-IDLE-1 空闲 | R-BOUND | agent_binding |
| SEL-11 | WF-SQUAD；Leader 为 A-BUILTIN-W | 按内置 Agent 策略选择 | 对应动态分支 |
| SEL-12 | `status=online` 但 `last_seen_at < now()-90s` | 不得选择 R-STALE | 非 stale runtime 的分支 |
| SEL-13 | R-IDLE-1 已有 completed/failed/cancelled task，无活动 task | R-IDLE-1 | idle |
| SEL-14 | `issue_creator_first`；R-CREATOR-1 繁忙，R-IDLE-1 空闲 | R-CREATOR-1 | issue_creator |
| SEL-15 | `issue_creator_first`；创建人没有合格运行时，R-IDLE-1 空闲 | R-IDLE-1 | idle |
| SEL-16 | 直接测试运行使用 `issue_creator_first`，R-IDLE-1 空闲 | R-IDLE-1 | idle |

### 8.4 并发与节点级选择

| ID | 场景与步骤 | 预期结果 |
| --- | --- | --- |
| CON-01 | WF-PARALLEL 同时派发两个根节点；R-IDLE-1、R-IDLE-2 空闲 | 两个 task 分别使用不同运行时 |
| CON-02 | 同时启动 10 次 WF-WORKER；提供 3 个空闲运行时 | 前 3 个选择不会重复判断同一运行时为空闲；后续结果遵循 Issue 创建人/失败规则 |
| CON-03 | 节点 A 选中 R-IDLE-1 后尚未被 daemon claim，节点 B 开始选择 | B 将 A 的 queued task 计入负载，不把 R-IDLE-1 当作空闲 |
| CON-04 | 一个并行节点触发 fail-fast，另一个节点刚完成 task 创建但尚未更新状态 | run 最终为 failed；任何节点都不能恢复为 working/critic_reviewing |
| CON-05 | 两个 API 请求同时对同一终态 task 发起人工重跑 | 只允许产生符合现有幂等/终态校验语义的有效重跑，不产生两个当前关联 task |

CON-01 至 CON-04 必须至少重复 20 次，以发现 advisory lock 或状态竞争问题。每次运行使用独立 run ID。

### 8.5 Worker、Critic、重试与重跑

| ID | 场景与步骤 | 预期结果 |
| --- | --- | --- |
| PHASE-01 | WF-WORKER-CRITIC 的 Worker 选中 R-IDLE-1；Worker 完成前使 R-IDLE-1 繁忙并释放 R-IDLE-2 | Critic 重新选择 R-IDLE-2，不盲目继承 Worker runtime |
| PHASE-02 | 指定 R-MANUAL，依次执行 Worker/Critic | 两个阶段都重新校验，但偏好持续合格时都使用 R-MANUAL，reason=`manual` |
| RETRY-01 | Workflow task 因 `runtime_offline` 失败并触发自动重试；原运行时已离线，另一运行时空闲 | retry child 使用新运行时；节点关联更新；parent_task_id 正确 |
| RETRY-02 | 自动重试时指定偏好仍有效但繁忙 | retry child 仍使用指定偏好，reason=`manual` |
| RETRY-03 | 自动重试选择时无任何候选 | 不创建 retry child；节点/run fail-fast |
| RERUN-01 | 对失败 Worker task 执行人工重跑；另一运行时变为空闲 | 新 task 重新选择空闲运行时，phase 仍为 worker |
| RERUN-02 | 对失败 Critic task 执行人工重跑 | 新 task 关联 `critic_agent_task_id`，不得误写 Worker 关联 |
| RERUN-03 | 人工重跑 task | `force_fresh_session=true`，不复用失败 task 的会话 |
| RERUN-04 | 人工重跑时 run 已不再 running | 不创建新 task，不恢复终态 run |

### 8.6 失败收敛

| ID | 前置条件与步骤 | 预期结果 |
| --- | --- | --- |
| FAIL-01 | `idle_first`、无所属 issue、无空闲运行时 | 当前节点 failed，run failed，reason=`runtime_unavailable` |
| FAIL-02 | WF-PARALLEL 中一个节点已 running，另一个节点选择失败 | running task 收到取消并变为 cancelled；兄弟节点 cancelled |
| FAIL-03 | 指定偏好失效、无空闲、issue 创建人没有合格运行时 | 完整回退后 fail-fast，不无限等待 |
| FAIL-04 | 仅有跨工作区、离线、stale、无权限私有运行时 | 全部被排除并 fail-fast |
| FAIL-05 | 普通 Agent 的 R-BOUND 离线 | 继续走普通 Agent 既有失败语义，不动态迁移到 R-IDLE-1 |

FAIL-02 需要监听 task 与 workflow WebSocket 事件，验证至少包含 task cancelled、node failed、run failed，并确认页面无需刷新即可显示终态。

### 8.7 数据快照与 Issue 创建人

| ID | 场景 | 预期结果 |
| --- | --- | --- |
| SNAP-01 | U-CREATOR 创建 Issue，U-OPERATOR 后续改派工作流 | `responsible_user_id=U-CREATOR`，`runtime_authorizer_id=U-OPERATOR` |
| SNAP-02 | A-CREATOR 创建 Issue | `responsible_user_id=A-CREATOR.owner_id` |
| SNAP-03 | run 创建后变更 A-CREATOR.owner_id | 既有 run 的 Issue 创建人快照不变 |
| SNAP-04 | 直接测试运行 | `source_issue_id`、`responsible_user_id` 为 NULL |
| SNAP-05 | Issue 删除后检查历史 run | `source_issue_id` 依外键规则置 NULL；run 与审计字段仍可读取 |
| SNAP-06 | 修改工作流默认策略后检查已创建 run | 已有 run 策略快照不变 |
| SNAP-07 | 自动触发工作流 | 使用触发时的工作流默认策略，不需要 UI 参数 |
| SNAP-08 | 新建一次全新重新运行 | 重新读取当前工作流默认策略，并允许本次覆盖 |

### 8.8 迁移与兼容性

| ID | 步骤 | 预期结果 |
| --- | --- | --- |
| MIG-01 | 在包含历史 workflow run/node run 的数据库执行 migration 138 up | 迁移成功；历史行新增字段为 NULL；旧 API 查询可用 |
| MIG-02 | 执行 migration 138 down | 新索引、约束和列被安全移除 |
| MIG-03 | 再次执行 migration 138 up | 成功且 schema 与首次 up 一致 |
| MIG-04 | 写入非法 `runtime_selection_reason` | CHECK constraint 拒绝写入 |
| MIG-05 | 执行策略 UI migration up | 历史工作流和 run 均回填 `idle_first`；约束与外键有效 |
| MIG-06 | 执行策略 UI migration down/up | 新增默认策略、运行快照字段可安全移除并重新创建 |
| COMP-01 | 前端解析缺少新增字段的旧版 workflow run/node run 响应 | 使用 schema 默认值，不白屏 |
| COMP-02 | 前端解析未知 `runtime_selection_reason` | 保留 nullable/字符串兼容性，不抛出异常 |
| COMP-03 | 新后端接收不带策略和 `runtime_id` 的旧客户端请求 | 使用工作流默认策略正常启动 |
| COMP-04 | 新后端接收旧客户端只传 `runtime_id` | 兼容为指定运行时优先 |

## 9. 自动化文件建议

建议将自动化拆分为：

```text
e2e/
  workflow-runtime-selection.spec.ts
  workflow-runtime-selection-real-devices.spec.ts
  fixtures/
    workflow-runtime-selection.ts
    workflow-runtime-driver.ts
```

职责：

- `workflow-runtime-selection.ts`：创建用户、工作区、运行时、Agent、Squad、工作流和 Issue，并提供精确清理。
- `workflow-runtime-driver.ts`：模拟 daemon 心跳和 task 生命周期，支持暂停 claim、注入失败、等待取消。
- `workflow-runtime-selection.spec.ts`：PR 必跑的确定性测试，不依赖真实模型调用。
- `workflow-runtime-selection-real-devices.spec.ts`：发布前真实双设备 smoke，不在普通 PR 中运行。

Playwright 用例应使用现有 `e2e/fixtures.ts` 和 `e2e/helpers.ts` 的认证、worktree 环境加载方式，不复制登录逻辑。

## 10. 证据采集

每个失败用例必须保留：

- Playwright trace。
- 失败页面截图。
- 启动请求与响应 JSON，敏感 token 必须脱敏。
- 第 7.1 节一致性 SQL 的结果。
- 相关 run ID、node run ID、task ID、runtime ID。
- 后端选择日志和 daemon claim/cancel 日志。
- WebSocket 事件顺序。

并发用例额外记录：

- 每个选择事务开始和结束时间。
- 每次选择时的活动任务数。
- 最终 runtime/task 分配表。

禁止记录运行时环境变量、访问令牌、Provider 凭据或用户私密目录。

## 11. 清理与隔离

1. 每个用例使用唯一标题前缀和 run ID，禁止复用上一个用例的活动 task。
2. `afterEach` 先停止测试驱动，再取消活动 task，然后删除 Issue、Workflow、Agent、Runtime。
3. 如果 API 清理失败，允许在专用 E2E 数据库按测试前缀清理；禁止对共享开发或生产数据库执行该操作。
4. 真实设备测试结束后恢复运行时可见性和权限，并确认 daemon 正常心跳。
5. 并发用例结束后确认不存在 `queued`、`dispatched`、`running` 的测试 task。

建议的残留检查：

```sql
SELECT id, status, runtime_id
FROM multica_agent_task_queue
WHERE context->>'e2e_suite' = 'workflow_runtime_selection'
  AND status IN ('queued', 'dispatched', 'running');
```

结果必须为 0 行。

## 12. CI 分层

### PR 必跑

- UI-01 至 UI-10。
- API-01 至 API-07。
- SEL-01 至 SEL-13。
- CON-01、CON-03、CON-04。
- PHASE-01、PHASE-02。
- RETRY-01 至 RETRY-03。
- RERUN-01 至 RERUN-04。
- FAIL-01 至 FAIL-05。
- SNAP-01 至 SNAP-04。
- COMP-01 至 COMP-03。

目标时长：15 分钟以内。

### Nightly

- CON-01 至 CON-04 各重复 100 次。
- migration up/down/up。
- WebSocket 事件顺序和残留 task 扫描。
- 不同 Chromium viewport 下的选择器测试。

### 发布前

- 两台真实设备完整执行 UI-03、SEL-01、CON-01、PHASE-01、RETRY-01、FAIL-02。
- Web 与 Desktop 各执行一次默认策略启动、单次策略覆盖和指定运行时 smoke。

## 13. 通过标准

满足以下全部条件才可通过：

1. PR 必跑用例全部通过，无重试后偶发成功的 flaky 用例。
2. CON-01 重复 100 次，存在两台空闲设备时分配冲突为 0。
3. 所有成功场景中 node run 与 task 的实际 runtime 完全一致。
4. 所有失败场景在 5 秒内进入终态；不得留下永久 running 的 run。
5. 普通 Agent 动态迁移次数为 0。
6. 跨工作区、离线、stale、无权限运行时被选择次数为 0。
7. 自动重试和人工重跑均通过新的选择结果更新节点关联。
8. migration up/down/up 无数据损坏。
9. E2E 数据清理后无活动测试 task 残留。
10. 两台真实设备验收中，每台设备只对应一个 runtime，且并行节点分散成功。

## 14. 失败分级

| 级别 | 示例 | 发布判断 |
| --- | --- | --- |
| P0 | 跨工作区选择、权限绕过、task 被错误 daemon claim | 立即阻断 |
| P1 | 优先级错误、并发节点落到同一空闲运行时、run 永久 running | 阻断 |
| P1 | 普通 Agent 被动态迁移、重试/重跑复用失效运行时 | 阻断 |
| P2 | UI 在 0/1 个运行时时隐藏选择器、默认值错误 | 阻断功能发布 |
| P2 | 选择原因或失败原因未正确记录，但执行结果正确 | 修复后发布 |
| P3 | 非阻塞文案、日志字段或测试证据缺失 | 可评估后续修复 |

## 15. 测试报告模板

```text
版本/Commit：
环境：确定性 E2E / 两台真实设备
执行时间：
执行人：

总用例数：
通过：
失败：
跳过：

失败用例 ID：
关联 run/node/task/runtime ID：
实际结果：
预期结果：
证据链接：
缺陷级别：

残留活动 task：0 / 非 0
是否满足发布标准：是 / 否
```

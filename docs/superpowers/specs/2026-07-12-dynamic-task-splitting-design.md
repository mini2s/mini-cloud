# Dynamic Task Splitting Design

## 背景

Multica 当前 workflow 每个节点只能产出 0~1 个子 issue。当遇到"一个父任务需要拆分为 N 个子任务协同完成"的场景，用户只能手动逐个创建、逐个指派 workflow，无法在父任务中持续追踪整体进度。

本设计为 workflow 新增"任务拆分节点"（Split Node），由 Agent 根据上下文智能生成子任务列表，经人审核后批量创建子 issue，各自绑定独立 workflow 并行执行；父 workflow 能聚合展示所有子任务的实时进展。

**实际运行中发现**：Agent 拆分任务的 JSON 输出不可靠 — Agent 可能不返回结构化 `{"tasks":[...]}`，而是发评论、上传文档、修改子 issue 状态、返回自然语言摘要。这导致 split 节点标记为 `failed`，即使 Agent 已经产出了有用的任务分解内容。本设计采用 **success-first** 策略：不惩罚非标准输出，而是尽可能从各种输出中恢复可用的拆分草案，把风险控制在人工审核环节。

## 目标

- 新增 `kind: "split"` 节点类型，Agent 驱动拆分 + 人审核 + 批量创建子 issue + 进度汇总
- 支持 barrier（等所有子任务完成）和 pipeline（创建即完成）两种下游释放模式
- 子任务间支持 DAG 依赖关系（串行/并行），按拓扑顺序 + max_concurrency 调度
- 子任务嵌套限制为两层（父→子），子的 workflow 内不再包含拆分节点
- 父节点取消时级联停止所有子任务，带防呆确认
- 拆分节点在画布上以聚合徽章展示整体进度

## 设计原则

本设计采用 **success-first** 策略：最大化到达 `awaiting_split_review` 的概率，让用户总能在审核面板看到可编辑的拆分草案。

核心原则：

- **Worker = 拆分草案生成者，Critic = 拆分草案审核者**。沿用现有 Worker/Critic 模型，但语义专化为拆分场景。
- **不依赖最终 assistant 文本作为唯一数据源**。Agent 可以通过专用 draft API/CLI 主动提交结构化草案，也可以从输出、评论、附件中恢复。
- **人工审核是子 issue 创建前的安全闸门**。无论草案来自结构化提交还是自动恢复，都必须经过人工审核才能创建子 issue。
- **拆分阶段严格控制副作用**。拆分 Agent 不能修改 issue 状态或创建子 issue，但其产生的评论和附件可作为恢复素材。
- **Critic 必填**。拆分节点的 Critic 默认 human（工作流创建者），缺失则阻断激活。Agent/API Critic 仅作为高级选项，展示风险警告。
- **默认 Worker 使用内置拆分专用 Agent**。按模板类型自动选择（coding→split-planner-code, design→split-planner-design, test→split-planner-test, fallback→split-planner-general）。用户可覆盖，但非专用 agent 触发预检警告。

## 总体架构

### 分层

```
┌─────────────────────────────────────────────────┐
│  画布 (ReactFlow Canvas)                         │
│  ├─ 拆分节点卡片 (kind=split)                    │
│  │  ├─ 聚合徽章: "3 done · 1 failed · 2 running" │
│  │  └─ 点击 → 详情面板 (审核/进度视图)            │
│  └─ 子 DAG 浮层 (子任务依赖关系可视化)            │
├─────────────────────────────────────────────────┤
│  API 层                                          │
│  ├─ POST /api/node-runs/:id/split/generate       │
│  ├─ POST /api/node-runs/:id/split/approve        │
│  ├─ GET  /api/node-runs/:id/split/tasks          │
│  └─ POST /api/node-runs/:id/split/cancel         │
├─────────────────────────────────────────────────┤
│  SplitOrchestrator                               │
│  (server/internal/service/workflow_split.go)     │
│  ├─ HandleSplitNode (状态转换入口)                │
│  ├─ GenerateSplitTasks (Agent 派发)              │
│  ├─ ApproveSplit (审核通过 → 批量创建子 issue)    │
│  ├─ ScheduleReadyTasks (DAG + 并发调度)           │
│  ├─ HandleChildRunStatusChanged (进度聚合)        │
│  └─ ResolveSplit (barrier/pipeline 决断)         │
├─────────────────────────────────────────────────┤
│  Workflow Engine (现有)                           │
│  ├─ StartRun (为每个子 issue 创建 WorkflowRun)    │
│  ├─ NodeRun 状态机 (子任务走标准 Worker-Critic)    │
│  └─ WS 事件广播 (子 NodeRun 状态变更)             │
├─────────────────────────────────────────────────┤
│  数据层                                          │
│  ├─ multica_workflow_node_run (新增 split 状态)   │
│  ├─ multica_workflow_split_task (新表)            │
│  └─ issues + workflow_runs (子 issue 及运行实例)   │
└─────────────────────────────────────────────────┘
```

### Worker/Critic 语义

Split 节点复用现有 Workflow 的 Worker/Critic 字段，语义专化为：

```
Worker = 拆分草案生成者
Critic = 拆分草案审核者
```

- **Worker**：默认使用内置 split 专用 agent（`split-planner-general/code/design/test`），按模板类型自动选择。用户可覆盖，但非专用 agent 触发预检警告。
- **Critic**：必填，默认 `critic_type = human`，默认审核人为工作流创建者。缺失或无效 Critic 阻断工作流激活。Agent/API Critic 仅作为高级选项，展示风险警告。

### 生命周期

```
模板编辑:
  画布上放置 Split 节点
  → 配置 child_workflow_id (子任务执行 workflow)
  → 配置 mode (barrier | pipeline)
  → 配置 max_concurrency (默认 5)
  → 配置 max_failures (barrier 模式, 默认 0)

运行时:
  上游节点完成
  → Split NodeRun 激活, 状态 = splitting
  → SplitOrchestrator 派发 Agent task
  → Agent 根据父 issue 上下文生成拆分方案
  → Agent 返回子任务列表 JSON
  → 状态 = awaiting_split_review
  → 人在画布详情面板审核 (增删改、调依赖、部分通过)
  → 人点击"确认创建"
  → SplitOrchestrator.ApproveSplit()
     ├─ multica_workflow_split_task 中标记已审批的行
     ├─ 丢弃未选中的行 (discarded)
     ├─ 逐个创建子 issue (materialize all approved tasks)
     ├─ 将子 issue_id 回写到 multica_workflow_split_task
     ├─ ready 子任务按 DAG + max_concurrency 启动子 WorkflowRun
     ├─ 将子 run_id 回写到 multica_workflow_split_task
  → 状态 = split_active
  → SplitOrchestrator.ScheduleReadyTasks() 按后端回调/DB 状态持续调度
  → [barrier] 等待所有子任务终态 → completed | failed
  → [pipeline] 已批准子 issue 全部创建成功 → completed
  → 下游节点激活
```

## 数据模型

### 新表: `multica_workflow_split_task`

```sql
CREATE TABLE multica_workflow_split_task (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_run_id   UUID NOT NULL REFERENCES multica_workflow_node_run(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES multica_workspace(id) ON DELETE CASCADE,

  -- 拆分方案内容 (Agent 生成或人工编辑)
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  suggested_assignee_type TEXT,  -- 'member' | 'agent' | 'squad'
  suggested_assignee_id   UUID,
  depends_on    JSONB NOT NULL DEFAULT '[]',  -- ["<split_task_id>", ...]
  sort_order    INT NOT NULL DEFAULT 0,

  -- 生命周期状态
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',
    'approved',
    'discarded',
    'created',
    'running',
    'done',
    'failed',
    'cancelled',
    'skipped'
  )),

  -- 创建后回写
  issue_id      UUID REFERENCES multica_issue(id) ON DELETE SET NULL,
  run_id        UUID REFERENCES multica_workflow_run(id) ON DELETE SET NULL, -- 子 WorkflowRun ID

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflow_split_task_node_run ON multica_workflow_split_task(node_run_id);
CREATE INDEX idx_workflow_split_task_issue ON multica_workflow_split_task(issue_id);
CREATE INDEX idx_workflow_split_task_run ON multica_workflow_split_task(run_id);
```

**status 流转**:
```
draft → approved → created → running → done | failed | cancelled
created → skipped
draft → discarded
```

状态含义：
- `approved`: 人审核通过，尚未创建子 issue。
- `created`: 子 issue 已创建，`issue_id` 已回写；子 workflow run 尚未启动，或正在等待依赖 / 并发配额。
- `running`: 子 workflow run 已启动，`run_id` 已回写。
- `skipped`: 上游依赖失败、取消或跳过后，当前任务被自动跳过，第一期不自动恢复。

**depends_on 校验规则**:
- 审核阶段校验循环依赖（DFS 检测，复用现有 DAG 算法）
- 引用必须指向同一个 node_run_id 下的其他 split_task
- 空数组 = 无依赖，可立即启动

### `workflow_node.format_schema` 扩展

```json
{
  "type": "split",
  "template_id": "task-splitter",
  "template_category": "logic",
  "split_config": {
    "child_workflow_id": "<workflow_uuid>",
    "mode": "barrier",
    "max_concurrency": 5,
    "max_failures": 0
  }
}
```

### `multica_workflow_node_run` 新增状态

在当前 NodeRunStatus 基础上新增 3 个，并通过迁移更新 `multica_workflow_node_run.status` CHECK 约束：

| 状态 | 含义 |
|------|------|
| `splitting` | Agent 正在生成拆分方案 |
| `awaiting_split_review` | 方案已生成，等待人审核 |
| `split_active` | 审核通过，子任务执行中 |

**Split 节点完整状态流转**:
```
pending → splitting → awaiting_split_review → split_active → completed
              ↘              ↘                    ↘
             failed        cancelled            failed
```

`split_active → completed` 的触发条件：
- **barrier**: 所有非 discarded 子任务到达终态，且失败数 ≤ max_failures
- **pipeline**: 所有 approved 子任务对应的子 issue 创建完成后立即完成（不等待子 workflow run 启动或执行结果）

`split_active → failed`: barrier 模式下失败数 > max_failures

**pipeline 模式下的子任务失败**: 父 split 节点已完成，子任务独立失败不影响父节点。失败信息通过父 issue 进度面板内的子任务列表展示（带错误详情），用户可手动重试单个子任务。

**子任务依赖失败处理**: 第一阶段采用保守跳过策略。若任务的任一依赖进入 `failed`、`cancelled` 或 `skipped`，该任务进入 `skipped`，不自动启动。后续版本可增加人工恢复 / 单任务重试后重新激活后继任务。

与现有状态机的集成：`pending`、`completed`、`failed`、`cancelled` 是共享终态/入口状态。workflow service 在 `OnNodeRunTransition` 中检测 kind=split 时委托给 SplitOrchestrator，非 split 节点行为完全不变。

## SplitOrchestrator 核心逻辑

### 文件

`server/internal/service/workflow_split.go` — 独立编排服务，不修改 workflow.go 的主状态机逻辑。

### 接口

```go
type SplitOrchestrator struct {
    queries    *db.Queries
    agentTask  AgentTaskDispatcher
    wsHub      WSBroadcaster
}

func (s *SplitOrchestrator) HandleSplitNode(
    ctx context.Context,
    nodeRun *WorkflowNodeRun,
    transition string,
) error
```

### 流程一: pending → splitting（节点激活）

1. 读取 `node.format_schema.split_config`
2. 校验 `child_workflow_id` 存在、属于同 workspace、状态为 active，且不是当前 workflow
3. **嵌套防护**: 校验子 workflow 的所有 node 中不含 `kind=split`
4. 构建 Agent prompt — 包含父 issue 标题、描述、已有节点输出摘要，以及 draft API/CLI 使用说明
5. 派发 Agent task，task context 设为 `{"type":"workflow","phase":"split"}`
6. Agent 可通过以下方式提交拆分草案：
   - **主路径**：调用 draft API/CLI 逐条提交结构化任务（`POST /split/draft-tasks`，完成后 `POST /split/draft-submit`）
   - **兜底路径**：在最终响应中返回 `{"tasks":[...]}` JSON
7. Draft API 校验规则：
   - `X-Task-ID` 必须匹配当前 split 节点的运行中 task
   - title 和 description 必填
   - assignee_type 必须是 `agent` 或 `member`，ID 必须属于当前 workspace
   - 依赖 key 必须指向已提交的 draft task
   - 依赖图必须无环
   - `submit` 要求至少一个有效 task

### 流程二: splitting → awaiting_split_review（Agent 完成生成 / 恢复管道）

Agent task 完成回调 → `HandleAgentTaskCompletion`：

1. 优先检查是否已有通过 draft API 提交的有效 draft rows → 有则直接转换状态
2. **无 draft rows 时，运行恢复管道**（优先级递减）：
   1. 解析最终 task result 中的 `{"tasks":[...]}` JSON
   2. 解析 Markdown 任务分解格式（如 `## 任务 1：...`、编号列表、表格）
   3. 检查 Agent 在拆分阶段创建的评论内容
   4. 检查 Agent 上传的附件（如 `task-breakdown.md`）
   5. 派遣修复 Agent（接收原始输出、评论、附件、父 issue 上下文），修复 Agent 通过 draft API 提交
3. 恢复的任务标记为 draft，路由到 `awaiting_split_review`（**不直接创建子 issue**）
4. **所有恢复手段均失败** → node_run 标记 `failed`
5. 对恢复出的草案执行常规校验（≥1 个 task、DAG 循环检测）
6. WS 推送：画布节点刷新为"待审核"徽章

### 流程三: awaiting_split_review → split_active（人审核通过）

API: `POST /api/node-runs/:nodeRunID/split/approve`

在一个数据库事务中执行：

1. 标记 approved task: `status = "approved"`
2. 标记未选中的 task: `status = "discarded"`
3. 应用修改（增删 task、改字段、调依赖）
4. 再次 DFS 校验循环依赖
5. 按拓扑排序确定创建顺序
6. 逐个创建子 issue:
   - `title = split_task.title`
   - `description = split_task.description`
   - `assignee = split_task.suggested_assignee`
   - `origin_type = "workflow_split", origin_id = split_task.id`
   - 继承父 issue 的 project_id
7. 回写 `issue_id`, `status = "created"`
8. 事务提交后调用 `ScheduleReadyTasks(nodeRunID)`
9. **pipeline 模式**: 所有 approved 子 issue 创建成功后，父 split node_run → `completed`
10. **barrier 模式**: 父 split node_run 保持 `split_active`，等待子任务终态聚合

子 workflow 启动规则：
- `ScheduleReadyTasks` 只启动 `status = "created"` 且所有依赖均为 `done` 的子任务。
- 启动时使用 `split_config.child_workflow_id` 指向的普通 active workflow，并复用现有 workflow-for-issue 链路：`StartRunForIssue`、为子 workflow 的每个 node_run 创建 sub-issue、再 `DispatchRootNodeRuns`。
- 启动前将已完成依赖任务的输出摘要追加到子 issue 描述，作为该子 workflow 的输入上下文；审核阶段不注入前置输出，因为依赖任务尚未执行。
- 启动成功后回写 `run_id`, `status = "running"`。
- 启动失败时 `status = "failed"`，barrier 模式计入失败数。

### 流程四: split_active → completed | failed（子任务监控）

`HandleChildRunStatusChanged(nodeRun)`:
- 由 `WorkflowService.OnNodeStatusChanged` / `OnRunTerminal` 回调触发，并以数据库查询作为事实来源
- 每次子 workflow run 状态变更:
  - 更新 `multica_workflow_split_task.status`（`created` → `running` → `done|failed`）
  - 对依赖失败的后继任务标记 `skipped`
  - 检查可启动的后继任务: `CanStart(task) = all(dep.status = done) AND runningCount < maxConcurrency`
  - 对满足条件的: 如果 `status=created` → 启动子 workflow run
  - 聚合统计并 WS 推送到父画布
  - 检查终态条件:
    - barrier: 所有非 discarded 终态 → `completed`; `failed > max_failures` → `failed`
    - pipeline: 已在上一步完成

### 取消路径

API: `POST /api/node-runs/:nodeRunID/split/cancel`

- 前端触发二级确认对话框
- 确认后级联操作:
  - `multica_workflow_split_task`: 所有非终态行 → `cancelled`
  - 子 WorkflowRun: 逐个调用 `CancelRun`
  - 子 issue: 状态 → `cancelled`
- 父 node_run → `cancelled`
- 父 WorkflowRun 检查所有 node run 终态 → 决定 Run 终态

## API 设计

Split API 采用扁平 `node-runs` 路径，和现有 `/api/node-runs/{nodeRunId}/submit|review|skip` 保持一致。Handler 必须先通过 `nodeRunID` 加载 `multica_workflow_node_run`，再反查 `workflow_run → workflow → workspace` 做权限校验；禁止只用 `runID` 定位 split。

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/node-runs/{nodeRunID}/split/generate` | Agent 重新生成拆分方案（审核拒绝后重试） |
| POST | `/api/node-runs/{nodeRunID}/split/approve` | 审核通过，批量创建子 issue |
| GET | `/api/node-runs/{nodeRunID}/split/tasks` | 获取拆分任务列表（含状态） |
| POST | `/api/node-runs/{nodeRunID}/split/cancel` | 取消拆分节点（级联停止子任务） |
| POST | `/api/node-runs/{nodeRunID}/split/draft-tasks` | Agent 添加/更新拆分草案（upsert by key） |
| POST | `/api/node-runs/{nodeRunID}/split/draft-submit` | Agent 提交拆分草案（幂等，无已创建子 issue 时可重复调用） |
| DELETE | `/api/node-runs/{nodeRunID}/split/draft-tasks/{taskID}` | Agent 删除单条草案 |

`POST /approve` 请求体:

```json
{
  "approved_task_ids": ["uuid-1", "uuid-3"],
  "modifications": [
    {
      "id": "uuid-1",
      "title": "修改后的标题",
      "description": "修改后的描述",
      "depends_on": ["uuid-3"]
    },
    {
      "action": "add",
      "title": "新子任务",
      "description": "...",
      "suggested_assignee_type": "agent",
      "suggested_assignee_id": "uuid",
      "depends_on": ["uuid-1"]
    },
    {
      "action": "delete",
      "id": "uuid-4"
    }
  ]
}
```

## 拆分阶段副作用策略

仅靠 prompt 指令不足以防止 Agent 在拆分阶段执行破坏性操作。平台基于 `X-Task-ID` 识别拆分阶段请求并控制副作用：

| 操作类型 | 策略 |
|---------|------|
| 只读查询（issue、comment、member、agent、workspace） | 允许 |
| Draft API 调用（draft-tasks、draft-submit） | 允许 |
| Issue 状态变更 | 禁止 |
| Issue 创建/更新/分配 | 禁止 |
| 评论和附件上传 | 允许（作为恢复素材，不作为权威输出） |

误操作产生的评论和附件不视为任务完成，不被直接消费为子 issue。它们仅作为恢复管道的输入素材。

## 前端组件

### 文件结构

```
packages/views/workflows/components/
├── split/
│   ├── split-node-card.tsx          — 画布上的拆分节点卡片
│   ├── split-review-panel.tsx       — 审核面板 (详情面板内容区)
│   ├── split-task-list.tsx          — 子任务列表 (拖拽排序、增删改)
│   ├── split-task-dag.tsx           — 子任务 DAG 可视化 (迷你 ReactFlow)
│   ├── split-progress-badge.tsx     — 聚合徽章 "3 done · 1 failed"
│   └── split-config-panel.tsx       — 编辑器配置面板
```

### 四个核心界面

#### 1. 画布上的拆分节点卡片

**编辑模式**:
```
┌──────────────────────┐
│ ⚡ 任务拆分           │
│ 子 workflow: 代码审查流程 │
│ 模式: barrier · 并发5  │
└──────────────────────┘
```

**运行时 — awaiting_split_review**:
```
┌──────────────────────────┐
│ ⚡ 任务拆分              │
│ ⚠ 待审核 (5 个子任务)    │
│ [点击审核]               │
└──────────────────────────┘
```

**运行时 — split_active**:
```
┌──────────────────────────┐
│ ⚡ 任务拆分              │
│ 3 done · 1 failed · 2 running │
│ [点击查看详情]           │
└──────────────────────────┘
```

#### 2. 审核面板（复用 `workflow-node-detail-panel-shell`）

```
┌─────────────────────────────────┐
│ 任务拆分审核                     │
│ ─────────────────────────────── │
│ 模式: barrier · 并发上限: 5      │
│ ─────────────────────────────── │
│                                 │
│ [子任务列表]                     │
│ ┌─────────────────────────┐    │
│ │ 1. 迁移 user-service    │ ✕  │
│ │    负责人: agent-3       │    │
│ │    依赖: 无              │    │
│ ├─────────────────────────┤    │
│ │ 2. 迁移 payment-service │ ✕  │
│ │    负责人: agent-5       │    │
│ │    依赖: 1               │    │
│ └─────────────────────────┘    │
│ [+ 添加子任务]                   │
│ ─────────────────────────────── │
│ [子任务依赖关系]                  │
│ ┌─ mini DAG (ReactFlow) ──────┐ │
│ │  ① ──→ ② ──→ ④              │ │
│ │  ① ──→ ③                     │ │
│ └─────────────────────────────┘ │
│ ─────────────────────────────── │
│ [✕ 取消]  [确认创建 (3个)]       │
└─────────────────────────────────┘
```

#### 3. 编辑器配置面板

选中拆分节点时详情面板显示：

- **Worker 选择器**（标签："拆分草案生成者"）— 默认按模板类型自动选择内置 split-planner agent
- **Critic 选择器**（标签："拆分草案审核者"）— 必填，默认 human（工作流创建者）
- 子任务执行 workflow 选择器（下拉，列出 workspace 下所有 active workflow，排除当前 workflow）
- mode 切换（barrier / pipeline，带 tooltip）
- max_concurrency 数字输入（默认 5，范围 1-20）
- max_failures 数字输入（仅 barrier 模式显示，默认 0）

**详情面板生命周期覆盖**：

| 节点状态 | 面板展示内容 |
|---------|------------|
| `splitting` | 活跃 task、生成进度、transcript 入口 |
| `awaiting_split_review` | 草案任务列表、编辑控件、通过/拒绝操作 |
| `split_active` | 拆分任务进度、子 issue 链接 |
| `failed` | 失败原因 + 恢复操作：重新生成、从输出/评论/附件恢复、手动添加草案 |

#### 4. 父 issue 详情页进度面板

```
┌──────────────────────────────┐
│ ⚡ 任务拆分          [展开▼] │
│ 3/4 completed · 1 failed     │
│ ──────────────────────────── │
│ ✓ 迁移 user-service    done  │
│ ✓ 迁移 payment-service done  │
│ ✗ 迁移 inventory-svc   failed│
│   → 错误: API key 未配置     │
│ ◐ 迁移 gateway         running│
└──────────────────────────────┘
```

### 复用清单

| 组件 | 来源 | 用途 |
|------|------|------|
| `workflow-node-detail-panel-shell` | 现有 | 审核面板骨架 |
| `DAGCanvas` / ReactFlow | 现有 | 子任务 DAG 迷你画布 |
| `preflight-checks` 框架 | 现有 | 新增 split 预检项 |
| `reactflow-nodes.tsx` | 现有 | 新增 shape 渲染分支 |
| `split-progress-badge` | 新增 | 可被其他聚合场景复用 |
| `split-task-list` | 新增 | 可编辑列表 + 拖拽排序 |

### 预检新增项

| 检查项 | 严重级别 | 阻断 | 描述 |
|--------|---------|------|------|
| `split-child-workflow-missing` | error | yes | split 节点未配置 child_workflow_id |
| `split-child-workflow-nested` | error | yes | 子 workflow 中包含 kind=split 节点（超过 2 层） |
| `split-child-workflow-inactive` | error | yes | 子 workflow 状态不是 active |
| `split-child-workflow-self` | error | yes | 子 workflow 指向当前 workflow 自身 |
| `split-worker-missing` | error | yes | split 节点未配置 Worker |
| `split-critic-missing` | error | yes | split 节点未配置 Critic |
| `split-worker-not-specialized` | warning | no | Worker 不是内置 split-planner agent |
| `split-critic-automated` | warning | no | Critic 为 agent/API 类型，可能自动通过审核 |

## TypeScript 类型扩展

```typescript
// 新增 format kind
export type WorkflowNodeFormatKind = "task" | "gateway" | "annotation" | "split";

// 新增 NodeRunStatus
export type NodeRunStatus =
  | "pending" | "format_checking" | "format_ok" | "format_failed"
  | "worker_assigned" | "working" | "awaiting_input" | "awaiting_critic"
  | "critic_reviewing" | "critic_approved" | "critic_rework"
  | "completed" | "failed" | "blocked" | "skipped" | "cancelled"
  | "splitting" | "awaiting_split_review" | "split_active";

// 新增接口
export interface SplitTask {
  id: string;
  node_run_id: string;
  title: string;
  description: string;
  suggested_assignee_type: "member" | "agent" | "squad" | null;
  suggested_assignee_id: string | null;
  depends_on: string[];
  sort_order: number;
  status: SplitTaskStatus;
  issue_id: string | null;
  run_id: string | null;
  created_at: string;
  updated_at: string;
}

export type SplitTaskStatus =
  | "draft" | "approved" | "discarded"
  | "created" | "running" | "done" | "failed" | "cancelled" | "skipped";

export interface SplitConfig {
  child_workflow_id: string;
  mode: "barrier" | "pipeline";
  max_concurrency: number;
  max_failures: number;
}

export interface ApproveSplitRequest {
  approved_task_ids: string[];
  modifications: SplitTaskModification[];
}

export type SplitTaskModification =
  | { id: string; title?: string; description?: string; depends_on?: string[]; suggested_assignee_type?: string; suggested_assignee_id?: string }
  | { action: "add"; title: string; description: string; depends_on?: string[]; suggested_assignee_type?: string; suggested_assignee_id?: string }
  | { action: "delete"; id: string };

export interface SplitProgress {
  total: number;
  created: number;
  running: number;
  done: number;
  failed: number;
  cancelled: number;
  skipped: number;
}

// toWorkflowRuntimeDisplayStatus 新增映射:
// "splitting" → "in_progress"
// "awaiting_split_review" → "reviewing"
// "split_active" → "in_progress"
```

## 错误处理

### 幂等性

- Split 节点激活时检查是否已有 `multica_workflow_split_task` 行（status=draft/approved/created/running），如有则跳过 Agent 生成，直接返回已有方案
- `ApproveSplit` 检查已创建的 issue 不重复创建（按 `split_task.id` 和 `issue_id` 去重）
- `ScheduleReadyTasks` 检查已启动的 run 不重复创建（按 `split_task.run_id` 去重）
- 后端状态回调重放通过 DB 当前状态判断是否需要推进，不依赖 WS 去重

### 失败恢复

- Agent 生成拆分方案失败 → node_run 标记 `failed`，支持手动重试（`POST /split/generate`）
- 子 issue 创建失败 → 事务回滚，node_run 保持 `awaiting_split_review`，提示用户
- 子 WorkflowRun 启动失败 → 标记对应 split_task 为 `failed`，barrier 模式下计入失败数
- 子任务依赖失败 / 取消 / 跳过 → 依赖它的 `created` 后继任务标记为 `skipped`
- 子任务 DAG 循环依赖 → 审核阶段拒绝，显示具体环路

### 并发安全

- `ApproveSplit` 使用 `SELECT ... FOR UPDATE` 锁定 `multica_workflow_node_run` 行
- `ScheduleReadyTasks` 使用同一把 `multica_workflow_node_run` 行锁串行处理同一 split node_run
- 子 workflow run 状态回调只记录事实并触发调度；最终决策以 `multica_workflow_split_task` 和子 `multica_workflow_run` 当前 DB 状态为准

### 数据约束同步

- `multica_issue.origin_type` CHECK 约束必须新增 `workflow_split`
- 默认 issue 列表若继续隐藏 workflow 派生 issue，应同时排除 `origin_type IN ('workflow', 'workflow_split')`
- `origin_type = "workflow_split"` 的一级子 issue 使用 `origin_id = split_task.id`
- 子 workflow 内部 node 对应的 sub-issue 继续使用现有 `origin_type = "workflow"`、`origin_id = workflow_node_run.id`
- 新增 API response schema 必须在 `packages/core/api/schemas.ts` 使用 zod + `parseWithFallback`，不允许裸 `as` cast 消费响应

### 级联保护

- 父 Run 取消时，SplitOrchestrator 遍历所有子 WorkflowRun 调用 `CancelRun`
- 子 Run 独立取消不影响其他子任务（除非有依赖关系 — DAG 调度时自动跳过被取消任务的后续）
- 防呆机制：父节点取消操作前端必须经过二次确认对话框

## 测试策略

### Go 测试 (`server/internal/service/workflow_split_test.go`)

- DAG 循环依赖检测
- 拓扑排序正确性
- barrier/pipeline 终态判断
- pipeline 模式在子 issue 全部创建后释放父下游，但后台调度仍继续
- max_failures 边界条件（恰好等于、超出）
- 审核后全部子 issue materialize，只有 ready 子任务启动 workflow run
- 依赖失败后继任务进入 `skipped`
- 事务回滚（子 issue 创建失败）
- 幂等性（重复事件）
- 并发调度逻辑（max_concurrency 限制生效）
- 取消级联
- API 以 `nodeRunID` 定位多个 split 节点，不串数据
- 恢复管道各级 fallback（JSON → Markdown → 评论 → 附件 → 修复 Agent）
- draft API 校验（X-Task-ID 匹配、依赖合法性、assignee 校验）
- 拆分阶段副作用拦截（issue 状态变更、创建、分配被拒绝）
- 有 draft rows 时跳过恢复管道直接进入 `awaiting_split_review`

### TypeScript 测试

- `packages/core/types/workflow.test.ts`: `parseNodeFormat` 对 `type: "split"` 的解析、fallback
- `packages/core/api/schemas.test.ts`: split API response malformed fallback
- `packages/core/workflows/preflight-checks.test.ts`: split 预检项
- `packages/views/`: Split 节点卡片渲染、审核面板交互、进度徽章

### E2E 测试

- 完整流程: 创建父 issue → Split 节点激活 → Agent 生成拆分 → 人审核通过 → 子任务创建并执行 → barrier 完成
- pipeline 模式: 子任务创建即释放下游
- 审核修改: 增删子任务、调依赖、部分通过
- DAG 调度: 子 issue 全部可见，但依赖未满足的子 workflow run 不启动
- 取消级联: 父节点取消 → 子任务全部停止
- 嵌套防护: 子 workflow 含 split 节点时编辑器拒绝激活

## 上线计划

1. 修复 `workflow_phase` 传播和 split 专用 daemon 上下文
2. 添加内置 split-planner agent 和默认 Worker 自动选择
3. 前端预检 + 后端运行校验强制要求 split 节点配置 Critic
4. 添加 split draft API/CLI
5. 更新 split 完成逻辑：优先消费 draft rows 再解析最终输出
6. 添加本地恢复管道（输出 → Markdown → 评论 → 附件）
7. 添加修复 Agent 兜底
8. 完善详情面板：展示状态、进度、审核和恢复操作

## 成功标准

- 产出有用 Markdown 分解的拆分任务能到达 `awaiting_split_review`
- 使用 draft CLI 的拆分任务不依赖最终输出解析即可到达 `awaiting_split_review`
- 拆分 Agent 无法在审核通过前修改 issue 状态或创建子 issue
- 用户可在详情面板中检查、编辑、通过、重新生成或手动恢复拆分草案

## 待解决问题

- 拆分阶段的评论是应完全阻止还是允许作为恢复素材？v1 建议：允许评论作为恢复素材，但阻止状态变更和 issue 创建。
- v1 是否允许自动化 Critic？v1 建议：仅作为高级选项并展示明确警告。
- 恢复的任务是否应带有"已恢复"标记？建议：是，便于审核者了解可信度。

## 边界

**不在第一期范围**:
- 三层及以上嵌套（已被 preflight 阻断）
- 条件分支拆分（根据上游输出动态决定拆分数量）
- 拆分节点作为子 workflow 的一部分
- 子任务间的数据传递（除上下文注入外）
- split_active 期间动态添加子任务（审核通过后列表不可变）
- 子任务的子任务（孙子层）

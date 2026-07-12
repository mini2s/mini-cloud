# Dynamic Task Splitting Design

## 背景

Multica 当前 workflow 每个节点只能产出 0~1 个子 issue。当遇到"一个父任务需要拆分为 N 个子任务协同完成"的场景，用户只能手动逐个创建、逐个指派 workflow，无法在父任务中持续追踪整体进度。

本设计为 workflow 新增"任务拆分节点"（Split Node），由 Agent 根据上下文智能生成子任务列表，经人审核后批量创建子 issue，各自绑定独立 workflow 并行执行；父 workflow 能聚合展示所有子任务的实时进展。

## 目标

- 新增 `kind: "split"` 节点类型，Agent 驱动拆分 + 人审核 + 批量创建子 issue + 进度汇总
- 支持 barrier（等所有子任务完成）和 pipeline（创建即完成）两种下游释放模式
- 子任务间支持 DAG 依赖关系（串行/并行），按拓扑顺序 + max_concurrency 调度
- 子任务嵌套限制为两层（父→子），子的 workflow 内不再包含拆分节点
- 父节点取消时级联停止所有子任务，带防呆确认
- 拆分节点在画布上以聚合徽章展示整体进度

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
│  ├─ POST /api/workflow-runs/:id/split/generate   │
│  ├─ POST /api/workflow-runs/:id/split/approve    │
│  ├─ GET  /api/workflow-runs/:id/split/tasks      │
│  └─ POST /api/workflow-runs/:id/split/cancel     │
├─────────────────────────────────────────────────┤
│  SplitOrchestrator                               │
│  (server/internal/service/workflow_split.go)     │
│  ├─ HandleSplitNode (状态转换入口)                │
│  ├─ GenerateSplitTasks (Agent 派发)              │
│  ├─ ApproveSplit (审核通过 → 批量创建子 issue)    │
│  ├─ WatchSubTasks (WS 事件订阅 → 进度聚合)        │
│  └─ ResolveSplit (barrier/pipeline 决断)         │
├─────────────────────────────────────────────────┤
│  Workflow Engine (现有)                           │
│  ├─ StartRun (为每个子 issue 创建 WorkflowRun)    │
│  ├─ NodeRun 状态机 (子任务走标准 Worker-Critic)    │
│  └─ WS 事件广播 (子 NodeRun 状态变更)             │
├─────────────────────────────────────────────────┤
│  数据层                                          │
│  ├─ workflow_node_run (新增 split 状态)           │
│  ├─ workflow_split_tasks (新表)                   │
│  └─ issues + workflow_runs (子 issue 及运行实例)   │
└─────────────────────────────────────────────────┘
```

### 生命周期

```
模板编辑:
  画布上放置 Split 节点
  → 配置 sub_template_id (子 workflow 模板)
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
     ├─ workflow_split_tasks 中标记已审批的行
     ├─ 丢弃未选中的行 (discarded)
     ├─ 逐个创建子 issue (CreateIssue)
     ├─ 逐个绑定子 WorkflowRun (StartRun with sub_template_id)
     ├─ 将子 issue_id/run_id 回写到 workflow_split_tasks
  → 状态 = split_active
  → SplitOrchestrator.WatchSubTasks() 订阅 WS 事件
  → [barrier] 等待所有子任务终态 → completed | failed
  → [pipeline] 子任务创建完成 → completed
  → 下游节点激活
```

## 数据模型

### 新表: `workflow_split_tasks`

```sql
CREATE TABLE workflow_split_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_run_id   UUID NOT NULL REFERENCES workflow_node_run(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL,

  -- 拆分方案内容 (Agent 生成或人工编辑)
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  suggested_assignee_type TEXT,  -- 'member' | 'agent' | 'squad'
  suggested_assignee_id   UUID,
  depends_on    JSONB NOT NULL DEFAULT '[]',  -- ["<split_task_id>", ...]
  sort_order    INT NOT NULL DEFAULT 0,

  -- 生命周期状态
  status        TEXT NOT NULL DEFAULT 'draft',

  -- 创建后回写
  issue_id      UUID,
  run_id        UUID,       -- 子 WorkflowRun ID

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_split_tasks_node_run ON workflow_split_tasks(node_run_id);
CREATE INDEX idx_split_tasks_issue ON workflow_split_tasks(issue_id);
```

**status 流转**:
```
draft → approved → created → running → done | failed | cancelled
draft → discarded
```

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
    "sub_template_id": "<workflow_template_uuid>",
    "mode": "barrier",
    "max_concurrency": 5,
    "max_failures": 0
  }
}
```

### `workflow_node_run` 新增状态

在现有 16 个 NodeRunStatus 基础上新增 3 个：

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
- **pipeline**: 所有 approved 子任务创建完成后立即完成（不等待执行结果）

`split_active → failed`: barrier 模式下失败数 > max_failures

**pipeline 模式下的子任务失败**: 父 split 节点已完成，子任务独立失败不影响父节点。失败信息通过父 issue 进度面板内的子任务列表展示（带错误详情），用户可手动重试单个子任务。

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
2. 校验 `sub_template_id` 存在且为 active
3. **嵌套防护**: 校验子模板的所有 node 中不含 `kind=split`
4. 构建 Agent prompt — 包含父 issue 标题、描述、已有节点输出摘要
5. 派发 Agent task，期望产出 JSON:

```json
{
  "tasks": [
    {
      "title": "迁移 user-service 到新 CI",
      "description": "...",
      "assignee_type": "agent",
      "assignee_id": "uuid",
      "depends_on_indices": []
    }
  ]
}
```

### 流程二: splitting → awaiting_split_review（Agent 完成生成）

1. Agent task 完成回调 → `HandleAgentTaskCompletion`
2. 解析产出 JSON，校验至少 1 个 task
3. 批量 INSERT `workflow_split_tasks`（status=draft）
4. 将 `depends_on_indices` 翻译为 `depends_on` UUID 数组
5. DFS 检测循环依赖 — 如有则触发 Agent 重试（带错误提示）
6. WS 推送：画布节点刷新为"待审核"徽章

### 流程三: awaiting_split_review → split_active（人审核通过）

API: `POST /api/workflow-runs/:runID/split/approve`

在一个数据库事务中执行：

1. 标记 approved task: `status = "approved"`
2. 标记未选中的 task: `status = "discarded"`
3. 应用修改（增删 task、改字段、调依赖）
4. 再次 DFS 校验循环依赖
5. 按拓扑排序确定创建顺序
6. 逐个创建子 issue + 绑定 WorkflowRun:
   - `title = split_task.title`
   - `description = split_task.description + 前置任务输出上下文注入`
   - `assignee = split_task.suggested_assignee`
   - `origin_type = "workflow_split", origin_id = nodeRunID`
   - 继承父 issue 的 project_id
   - `StartRun` 使用 `split_config.sub_template_id`
7. 回写 `issue_id`, `run_id`, `status = "created"`
8. **pipeline 模式**: 事务提交后立即 → `completed`
9. **barrier 模式**: 启动 `WatchSubTasks`

### 流程四: split_active → completed | failed（子任务监控）

`WatchSubTasks(nodeRun)`:
- 订阅子 WorkflowRun 的 WS 事件
- 每次子 NodeRun 状态变更:
  - 更新 `workflow_split_tasks.status`（`created` → `running` → `done|failed`）
  - 检查可启动的后继任务: `CanStart(task) = all(dep.status in {done, skipped}) AND runningCount < maxConcurrency`
  - 对满足条件的: 如果 `status=approved`（尚未创建）→ 创建 issue + StartRun
  - 聚合统计并 WS 推送到父画布
  - 检查终态条件:
    - barrier: 所有非 discarded 终态 → `completed`; `failed > max_failures` → `failed`
    - pipeline: 已在上一步完成

### 取消路径

API: `POST /api/workflow-runs/:runID/split/cancel`

- 前端触发二级确认对话框
- 确认后级联操作:
  - `workflow_split_tasks`: 所有非终态行 → `cancelled`
  - 子 WorkflowRun: 逐个调用 `CancelRun`
  - 子 issue: 状态 → `cancelled`
- 父 node_run → `cancelled`
- 父 WorkflowRun 检查所有 node run 终态 → 决定 Run 终态

## API 设计

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/workflow-runs/{runID}/split/generate` | Agent 重新生成拆分方案（审核拒绝后重试） |
| POST | `/api/workflow-runs/{runID}/split/approve` | 审核通过，批量创建子 issue |
| GET | `/api/workflow-runs/{runID}/split/tasks` | 获取拆分任务列表（含状态） |
| POST | `/api/workflow-runs/{runID}/split/cancel` | 取消拆分节点（级联停止子任务） |

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
│ 子模板: 代码审查流程   │
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
- 子模板选择器（下拉，列出 workspace 下所有 active workflow template）
- mode 切换（barrier / pipeline，带 tooltip）
- max_concurrency 数字输入（默认 5，范围 1-20）
- max_failures 数字输入（仅 barrier 模式显示，默认 0）

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
| `split-template-missing` | error | yes | split 节点未配置 sub_template_id |
| `split-template-nested` | error | yes | 子模板中包含 kind=split 节点（超过 2 层） |
| `split-template-inactive` | error | yes | 子模板状态不是 active |

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
  | "created" | "running" | "done" | "failed" | "cancelled";

export interface SplitConfig {
  sub_template_id: string;
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
  pending: number;
  running: number;
  done: number;
  failed: number;
  cancelled: number;
}

// toWorkflowRuntimeDisplayStatus 新增映射:
// "splitting" → "in_progress"
// "awaiting_split_review" → "reviewing"
// "split_active" → "in_progress"
```

## 错误处理

### 幂等性

- Split 节点激活时检查是否已有 `workflow_split_tasks` 行（status=draft/approved/created），如有则跳过 Agent 生成，直接返回已有方案
- `ApproveSplit` 检查已创建的 issue/run 不重复创建（按 `issue_id` 去重）
- WS 事件重放通过 `node_run_id + status` 去重

### 失败恢复

- Agent 生成拆分方案失败 → node_run 标记 `failed`，支持手动重试（`POST /split/generate`）
- 子 issue 创建失败 → 事务回滚，node_run 保持 `awaiting_split_review`，提示用户
- 子 WorkflowRun 启动失败 → 标记对应 split_task 为 `failed`，barrier 模式下计入失败数
- 子任务 DAG 循环依赖 → 审核阶段拒绝，显示具体环路

### 并发安全

- `ApproveSplit` 使用 `SELECT ... FOR UPDATE` 锁定 `workflow_node_run` 行
- `WatchSubTasks` 中对同一 node_run 的并发事件做串行处理（Go channel + goroutine）

### 级联保护

- 父 Run 取消时，SplitOrchestrator 遍历所有子 WorkflowRun 调用 `CancelRun`
- 子 Run 独立取消不影响其他子任务（除非有依赖关系 — DAG 调度时自动跳过被取消任务的后续）
- 防呆机制：父节点取消操作前端必须经过二次确认对话框

## 测试策略

### Go 测试 (`server/internal/service/workflow_split_test.go`)

- DAG 循环依赖检测
- 拓扑排序正确性
- barrier/pipeline 终态判断
- max_failures 边界条件（恰好等于、超出）
- 事务回滚（子 issue 创建失败）
- 幂等性（重复事件）
- 并发调度逻辑（max_concurrency 限制生效）
- 取消级联

### TypeScript 测试

- `packages/core/types/workflow.test.ts`: `parseNodeFormat` 对 `type: "split"` 的解析、fallback
- `packages/core/workflows/preflight-checks.test.ts`: split 预检项
- `packages/views/`: Split 节点卡片渲染、审核面板交互、进度徽章

### E2E 测试

- 完整流程: 创建父 issue → Split 节点激活 → Agent 生成拆分 → 人审核通过 → 子任务创建并执行 → barrier 完成
- pipeline 模式: 子任务创建即释放下游
- 审核修改: 增删子任务、调依赖、部分通过
- 取消级联: 父节点取消 → 子任务全部停止
- 嵌套防护: 子模板含 split 节点时编辑器拒绝激活

## 边界

**不在第一期范围**:
- 三层及以上嵌套（已被 preflight 阻断）
- 条件分支拆分（根据上游输出动态决定拆分数量）
- 拆分节点作为子模板的一部分
- 子任务间的数据传递（除上下文注入外）
- split_active 期间动态添加子任务（审核通过后列表不可变）
- 子任务的子任务（孙子层）

# Dynamic Task Splitting Design (v2)

## 背景

Multica 当前 workflow 每个节点只能产出 0~1 个子 issue。当遇到"一个父任务需要拆分为 N 个子任务协同完成"的场景，用户只能手动逐个创建、逐个指派 workflow，无法在父任务中持续追踪整体进度。

本设计为 workflow 新增"任务拆分节点"（Split Node），由 Agent 根据上下文智能生成子任务列表，经人审核后批量创建子 issue，各自绑定独立 workflow 并行执行；父 workflow 能聚合展示所有子任务的实时进展。

**v2 修订要点**（相比 2026-07-12 版设计）：
- 审核面板简化为"预览列表 + NL 对话"，去掉手动编辑 UI 和 DAG 画布
- 全景图支持点击展开子节点，复用现有 runtime-node-card 样式
- 新增 `/split/chat` API，复用现有 agent dispatch 机制处理审核阶段的 NL 调整
- `/split/approve` 简化为仅传 `approved_task_ids`

**本文定位**：v2 是目标设计，覆盖当前已实现的手动编辑版 Split Review。实现 v2 时应移除审核面板中的手动增删改控件、`/split/approve` 的 `modifications` 执行路径，以及审核阶段 DAG 编辑画布；所有草案增删改统一通过 `/split/chat` + Agent draft API 完成。

## 目标

- 新增 `kind: "split"` 节点类型，Agent 驱动拆分 + 人审核 + 批量创建子 issue + 进度汇总
- 支持 barrier（等所有子任务完成）和 pipeline（创建即完成）两种下游释放模式
- 子任务间支持 DAG 依赖关系（串行/并行），按拓扑顺序 + max_concurrency 调度
- 子任务嵌套限制为两层（父→子），子的 workflow 内不再包含拆分节点
- 父节点取消时级联停止所有子任务，带防呆确认
- 拆分节点在画布上以聚合徽章展示整体进度；点击展开为子节点群
- 审核面板复用现有 issue 详情的评论驱动任务模式，NL 指令 + Agent 响应

## 设计原则

本设计采用 **success-first** 策略：最大化到达 `awaiting_split_review` 的概率，让用户总能在审核面板看到可通过 NL 调整的拆分草案。

核心原则：

- **Worker = 拆分草案生成者，Critic = 拆分草案审核者**。沿用现有 Worker/Critic 模型。
- **不依赖最终 assistant 文本作为唯一数据源**。Agent 可通过专用 draft API/CLI 主动提交结构化草案，也可从输出、评论、附件中恢复。
- **人工审核是子 issue 创建前的安全闸门**。无论草案来自结构化提交还是自动恢复，都须经人工审核。
- **拆分阶段严格控制副作用**。拆分 Agent 不能修改 issue 状态或创建子 issue。
- **Critic 必填**。拆分节点的 Critic 默认 human（工作流创建者），缺失则阻断激活。
- **默认 Worker 使用内置拆分专用 Agent**。按模板类型自动选择（coding→split-planner-code, design→split-planner-design, test→split-planner-test, fallback→split-planner-general）。

## 总体架构

### 分层

```
┌─────────────────────────────────────────────────┐
│  画布 (ReactFlow Canvas)                         │
│  ├─ 拆分节点卡片 (kind=split)                    │
│  │  ├─ 收起态: 聚合徽章 "3 done · 1 failed"      │
│  │  └─ 展开态: 子节点群 + 依赖连线               │
│  └─ 子节点复用 runtime-node-card 样式             │
├─────────────────────────────────────────────────┤
│  审核面板（详见"审核面板设计"一节）               │
│  ├─ 子任务预览列表（只读卡片）                    │
│  ├─ NL 对话区（复用 chat session 基础设施）       │
│  └─ Agent 转录（InlineTranscriptPanel）           │
├─────────────────────────────────────────────────┤
│  API 层                                          │
│  ├─ POST /api/node-runs/:id/split/generate       │
│  ├─ POST /api/node-runs/:id/split/recover        │
│  ├─ POST /api/node-runs/:id/split/chat           │  ← 新增
│  ├─ POST /api/node-runs/:id/split/approve        │  ← 简化
│  ├─ GET  /api/node-runs/:id/split/tasks          │
│  ├─ POST /api/node-runs/:id/split/cancel         │
│  └─ draft API（Agent 侧）                        │
├─────────────────────────────────────────────────┤
│  SplitOrchestrator                               │
└─────────────────────────────────────────────────┘
```

### Worker/Critic 语义

- **Worker**：默认使用内置 split 专用 agent，按模板类型自动选择。用户可覆盖。
- **Critic**：必填，默认 `critic_type = human`，默认审核人为工作流创建者。

### 生命周期

```
上游节点完成
→ Split NodeRun 激活, 状态 = splitting
→ SplitOrchestrator 派发 Agent task
→ Agent 根据父 issue 上下文生成拆分方案
→ 状态 = awaiting_split_review
→ 人在审核面板审核（NL 对话调整草案）
→ 人点击"确认创建"
→ SplitOrchestrator.ApproveSplit()
   ├─ 标记已审批的行
   ├─ 丢弃未选中的行 (discarded)
   ├─ 逐个创建子 issue
   ├─ 将子 issue_id 回写
   ├─ ready 子任务按 DAG + max_concurrency 启动子 WorkflowRun
→ 状态 = split_active
→ [barrier] 等待所有子任务终态 → completed | failed
→ [pipeline] 已批准子 issue 全部创建成功且首批 ready 子 WorkflowRun 调度成功 → completed
→ 下游节点激活
```

## 数据模型

### 新表: `multica_workflow_split_task`

```sql
CREATE TABLE multica_workflow_split_task (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_run_id   UUID NOT NULL REFERENCES multica_workflow_node_run(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES multica_workspace(id) ON DELETE CASCADE,
  draft_key     TEXT,

  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  suggested_assignee_type TEXT,  -- 'member' | 'agent' | 'squad'
  suggested_assignee_id   UUID,
  depends_on    JSONB NOT NULL DEFAULT '[]',
  sort_order    INT NOT NULL DEFAULT 0,
  draft_source  TEXT NOT NULL DEFAULT 'agent' CHECK (draft_source IN (
    'agent', 'chat', 'recovered'
  )),

  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'approved', 'discarded',
    'created', 'running', 'done', 'failed', 'cancelled', 'skipped'
  )),

  issue_id      UUID REFERENCES multica_issue(id) ON DELETE SET NULL,
  run_id        UUID REFERENCES multica_workflow_run(id) ON DELETE SET NULL,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflow_split_task_node_run
  ON multica_workflow_split_task(node_run_id);

CREATE UNIQUE INDEX idx_workflow_split_task_node_run_draft_key
  ON multica_workflow_split_task(node_run_id, draft_key)
  WHERE draft_key IS NOT NULL AND draft_key <> '';
```

`draft_key` 是 Agent upsert 草案的稳定业务键，例如 `migrate-user-service`。同一 `node_run_id` 下 key 唯一；空 key 只允许用于系统恢复或一次性导入，不参与 upsert。`draft_source` 用于审核面板标注草案来源，恢复管道生成的任务必须写为 `recovered`。

**status 流转**:
```
draft → approved → created → running → done | failed | cancelled
         ↘ discarded    ↘ skipped
```

### `workflow_node.format_schema` 扩展

```json
{
  "type": "split",
  "split_config": {
    "sub_template_id": "<uuid>",
    "mode": "barrier",
    "max_concurrency": 5,
    "max_failures": 0
  }
}
```

### `multica_workflow_node_run` 新增状态

| 状态 | 含义 |
|------|------|
| `splitting` | Agent 正在生成拆分方案 |
| `awaiting_split_review` | 方案已生成，等待人审核 |
| `split_active` | 审核通过，子任务执行中 |

### `multica_workflow_node_run` 新增列

```sql
ALTER TABLE multica_workflow_node_run
  ADD COLUMN split_review_chat_session_id UUID
  REFERENCES multica_chat_session(id) ON DELETE SET NULL;
```

每个 split node run 最多绑定一个审核 chat session。首次调用 `/split/chat` 时后端创建 session 并回写；后续调用复用同一 session，使用户 NL 指令、Agent 回复、失败消息和附件都保存在现有 chat session / chat message 体系中。

**完整状态流转**:
```
pending → splitting → awaiting_split_review → split_active → completed
              ↘              ↘                    ↘
             failed        cancelled            failed
```

## API 设计

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/node-runs/{nodeRunID}/split/generate` | Agent 重新生成拆分方案 |
| POST | `/api/node-runs/{nodeRunID}/split/recover` | 从已有输出/评论/附件恢复草案 |
| **POST** | `/api/node-runs/{nodeRunID}/split/chat` | **新增：用户发 NL 指令，Agent 调整草案** |
| POST | `/api/node-runs/{nodeRunID}/split/approve` | 审核通过，批量创建子 issue |
| GET | `/api/node-runs/{nodeRunID}/split/tasks` | 获取拆分任务列表（含状态） |
| POST | `/api/node-runs/{nodeRunID}/split/cancel` | 取消拆分节点（级联停止） |
| POST | `/api/node-runs/{nodeRunID}/split/draft-tasks` | Agent 添加/更新拆分草案 |
| POST | `/api/node-runs/{nodeRunID}/split/draft-submit` | Agent 提交拆分草案 |
| DELETE | `/api/node-runs/{nodeRunID}/split/draft-tasks/{taskID}` | Agent 删除单条草案 |

### `/split/chat` — NL 调整草案

**请求**:
```json
{
  "message": "把安全审计拆成独立任务，合并任务 2 和 3",
  "attachment_ids": []
}
```

**响应**:
```json
{
  "chat_session_id": "uuid",
  "task_id": "uuid",
  "tasks": [],
  "progress": {
    "total": 0,
    "created": 0,
    "running": 0,
    "done": 0,
    "failed": 0,
    "cancelled": 0,
    "skipped": 0
  }
}
```

**流程**:
1. 后端校验 `nodeRunID` 属于当前 workspace，且节点状态为 `awaiting_split_review`。
2. 后端获取或创建 `split_review_chat_session_id`，将用户 NL 指令写入 `multica_chat_message(role=user)`，附件绑定到该 session。
3. 后端派发 agent task，任务同时绑定 `workflow_node_run_id` 和 `chat_session_id`，context 使用 `phase: "split_chat"`，并注入当前草案完整内容、父 issue 上下文、用户消息和附件引用。
4. Agent 只能通过 draft API（upsert/delete/submit）修改草案；不能直接创建 issue、改 issue 状态或推进 workflow。
5. Agent 完成后，后端写入 `multica_chat_message(role=assistant)`，WS 推送 chat message、task 状态和 split tasks 查询失效事件，前端刷新预览列表。

**关键设计点**:
- 每次调用自动带上当前草案的完整内容作为 Agent 上下文
- Agent 使用稳定 key 做 upsert（由 Agent 定义，如 `migrate-user-service`）
- 审核对话是持久化 chat session，不是临时面板状态；刷新页面后仍可看到历史 NL 指令和 Agent 回复
- 同一 split node run 同时只允许一个 active split chat task，避免两个 Agent 并发覆盖同一草案
- "恢复到原始草案"操作用户可用（重新调用 `/split/generate`）
- `/split/chat` 失败不能破坏当前草案；失败消息进入 chat session，用户可重试或继续发新指令

### `/split/approve` — 简化

**请求**（去掉 modifications 数组）:
```json
{
  "approved_task_ids": ["uuid-1", "uuid-3"]
}
```

所有的增删改在审核阶段通过 `/split/chat` 完成，确认创建时只需声明哪些通过。

`/split/approve` 不再执行 `modifications`。如果旧客户端发送非空 `modifications`，服务端必须拒绝并返回明确错误（例如 `400 split modifications must be submitted through /split/chat`），不能静默忽略，也不能继续应用旧编辑逻辑。

### Agent draft API 契约

draft API 只允许被当前 split 相关 agent task 调用：

- 请求必须携带 `X-Task-ID` 和 `X-Agent-ID`
- `X-Task-ID` 必须指向当前 `node_run_id` 绑定的 active split task，且 task context `phase` 为 `split_generate`、`split_repair` 或 `split_chat`
- `X-Agent-ID` 必须等于该 task 的 `agent_id`
- `split_generate` / `split_repair` 只允许在 `splitting` 状态写草案
- `split_chat` 只允许在 `awaiting_split_review` 状态写草案
- upsert 必须使用非空 `key`，后端按 `(node_run_id, draft_key)` 幂等更新
- delete 只能把 draft 行标记为 `discarded`，不能物理删除已存在记录
- submit 后不会自动创建子 issue；只刷新草案并保持/返回 `awaiting_split_review`

这条契约是拆分阶段的安全边界：Agent 能改草案，但不能绕过人工审核，也不能直接触发子 issue materialize。

## 审核面板设计

审核面板是本次设计的核心变化。不走"复杂编辑 UI"路线，而是复用现有 issue 详情的评论驱动任务模式。

**触发方式**：在全景图中点击 split 节点（复用现有 `ExecutionDetailPanel` 抽屉打开机制），面板内容根据节点状态展示审核视图或进度视图。

### 布局

```
┌─────────────────────────────────┐
│ 任务拆分审核                     │
│ 模式: barrier · 并发: 5          │
│ ─────────────────────────────── │
│                                 │
│ [子任务预览列表 — 只读]          │
│ ┌─────────────────────────┐    │
│ │ ☑ 1. 迁移 user-service  │    │
│ │    负责人: agent-3       │    │
│ │    依赖: 1               │    │
│ ├─────────────────────────┤    │
│ │ ☑ 2. 迁移 payment-svc   │    │
│ │    负责人: agent-5       │    │
│ │    依赖: 1               │    │
│ └─────────────────────────┘    │
│                                 │
│ [对话框]                        │
│ ┌─────────────────────────┐    │
│ │ > 把安全审计拆成独立任务  │    │
│ │ AI: 已拆分，列表已更新   │    │
│ └─────────────────────────┘    │
│ ─────────────────────────────── │
│ [✕ 取消]  [确认创建 (3个)]       │
└─────────────────────────────────┘
```

### 功能覆盖（复用 issue 详情已有能力）

| 现有能力 | 复用方式 |
|---------|---------|
| 评论驱动任务 | `CommentInput` 发 NL 指令 → `/split/chat` → agent dispatch |
| 任务状态实时更新 | `task:*` WS 事件 → `setQueryData` 驱动面板头部状态 |
| 执行转录 | `InlineTranscriptPanel` + `TaskTranscriptTimeline` 展示 agent thinking |
| 产物预览 | agent 输出 = 更新后的草案列表，预览区实时刷新 |
| 对话流 | NL 指令和 agent 回复形成多轮对话历史 |
| Agent 活动指示 | 面板头部状态条 "正在调整草案...""草案已更新" |
| 重试/取消 task | agent 处理中可取消（恢复上轮），失败后可重试 |
| 附件上传 | NL 指令可附带参考文件 |
| 确认防呆 | "确认创建"带二次确认对话框 |

### 编辑能力

通过 NL 指令覆盖以下场景：
- **增**: "为安全审计添加一个独立任务"
- **删**: "删除任务 3"
- **改**: "把任务 1 的标题改为『迁移核心数据库』""所有任务改成 agent-7 负责"
- **合**: "合并任务 2 和 3"
- **拆**: "把支付模块拆成前端和后端两个独立任务"
- **依赖**: "任务 4 依赖任务 2 和 3 完成后再开始"
- **恢复**: "恢复到 Agent 最初生成的草案"

### 依赖关系展示

依赖关系以 **ASCII 字符图**展示，内嵌在预览区域顶部（渲染为 Markdown 代码块 / monospace），无需引入额外绘图库：

```
任务 1 ──┬── 任务 3 ── 任务 4
         │
         └── 任务 2
```

每个子任务卡片中也以文字标签标注依赖（"依赖：任务 1、2"），ASCII 图和文字标签互补。依赖调整通过 NL 指令完成。

### 删除的前端组件

原设计中以下组件不再需要：
- `split-task-list.tsx` — 手动编辑控件
- `split-task-dag.tsx` — DAG 可视化画布

v2 迁移时需要删除或降级这些组件的审核期编辑入口。审核面板只能展示只读预览列表、依赖 ASCII 图、对话区和确认操作；任何增删改都必须经 `/split/chat` 完成。

### 保留/修改的前端组件

- `split-review-panel.tsx` → 改为预览列表 + 对话区
- `split-node-card.tsx` → 不变
- `split-progress-badge.tsx` → 不变
- `split-config-panel.tsx` → 不变

## 全景图设计

### 收起态

split 节点默认显示紧凑卡片 + 聚合徽章：
```
┌──────────────────────────┐
│ ⚡ 任务拆分              │
│ 3 done · 1 failed · 2 running │
│ [点击展开 ▼]             │
└──────────────────────────┘
```

### 展开态

点击展开后，子 issue 节点以**二级节点**形式出现在 split 节点周围：
- 子节点复用现有 `runtime-node-card` 样式和设计 token
- 依赖关系以连线展示（全景图天然是画布视图，连线是自然表达）
- 子节点状态通过 WS 实时更新（复用现有 `workflow:node_run_updated` 链路）

**子节点交互**（复用现有 `RuntimeNodeCard` 的操作模型）：
- 点击跳转到子 issue 详情页
- 悬停看摘要（标题、状态、负责人）
- 失败节点可直接重试
- 运行中节点可直接取消

**收起逻辑**：
- 点击 split 节点 / 画布空白 → 收起
- 切换页面再回来 → 默认收起
- 状态变更时保持当前展开/收起状态

## 错误处理与恢复管道

### 恢复管道（success-first）

```
Agent task 完成
  → 优先：有 draft API 提交的有效草案 → 直接进入 awaiting_split_review
  → 无：解析最终输出中的 {"tasks":[...]} JSON
  → 仍无：解析 Markdown 任务分解格式
  → 仍无：检查 Agent 评论内容
  → 仍无：检查 Agent 上传的附件
  → 仍无：派遣修复 Agent（接收全部素材，通过 draft API 提交）
  → 全部失败：node_run → failed
```

恢复出的 draft 任务带"已恢复"标记，审核面板展示提醒——"以下草案由 AI 自动恢复，请仔细审核"。

### 幂等性

- Split 节点激活时检查是否已有 draft 行，有则跳过 Agent 生成
- `ApproveSplit` 按 `split_task.id` + `issue_id` 去重
- `ScheduleReadyTasks` 按 `split_task.run_id` 去重
- 后端回调通过 DB 当前状态判断，不依赖 WS 去重

### 子任务依赖失败处理

若任务的任一依赖进入 `failed`、`cancelled` 或 `skipped`，该任务进入 `skipped`。

### barrier / pipeline 终态决策

- `pipeline` 模式：所有 approved 子 issue materialize 成功、首批 ready 子 workflow run 调度成功后，父 split node 进入 `completed` 并释放下游；后续子任务失败只影响子 issue / 子 workflow，不回滚父 workflow。
- `barrier` 模式：父 split node 等所有非 discarded 子任务进入终态后再决策。
- `failed` 计入 `max_failures`。
- 用户直接取消单个子任务视为失败计数；父节点整体取消时父节点直接进入 `cancelled`，不走 `max_failures`。
- `skipped` 不额外计入失败数，因为它是依赖失败/取消的派生结果，避免同一个根因被重复计数。
- 当 `failed + user_cancelled > max_failures` 时父节点 `failed`；否则父节点 `completed`，但进度徽章保留 skipped/cancelled 计数供用户追踪。

默认 `max_failures = 0`，即任一实际失败或用户取消都会让 barrier 父节点失败；只有显式配置容错时，失败范围内的 split 才能继续释放下游。

### 撤回/重试

- 审核阶段可随时重新生成草案（`/split/generate`）
- NL 调整不满意可恢复原始草案
- 子任务失败后可在父面板重试单个任务
- 父节点取消级联停止所有子任务，防呆二次确认

## 边界（不在第一期范围）

- 三层及以上嵌套
- 条件分支拆分（根据上游输出动态决定拆分数量）
- 拆分节点作为子模板的一部分
- 子任务间的数据传递（除上下文注入外）
- split_active 期间动态添加子任务
- 子任务的子任务（孙子层）

## 测试策略

### Go 测试

- DAG 循环依赖检测
- 拓扑排序正确性
- barrier/pipeline 终态判断
- max_failures 边界条件
- barrier 下 failed / cancelled / skipped 计数语义
- 审核后全部子 issue materialize
- 依赖失败后继任务进入 `skipped`
- 事务回滚
- 幂等性（重复事件）
- 并发调度逻辑（max_concurrency 限制生效）
- 取消级联
- 恢复管道各级 fallback
- draft API header、phase、agent_id、node_run_id、状态校验
- `/split/chat` 创建/复用 chat session，并持久化 user/assistant message
- `/split/approve` 拒绝非空 `modifications`
- 拆分阶段副作用拦截

### TypeScript 测试

- `packages/core/types/workflow.test.ts`: `parseNodeFormat` split 类型解析
- `packages/core/api/schemas.test.ts`: split API 响应 malformed fallback 测试
- `packages/views/`: 审核面板只读预览、NL 对话提交、split 节点卡片、展开/收起子节点
- 确认创建请求只发送 `approved_task_ids`，不发送 `modifications`

### E2E 测试

- 完整流程: 创建父 issue → Split 节点激活 → Agent 生成拆分 → NL 调整 → 确认创建 → barrier 完成
- pipeline 模式: 子任务创建即释放下游
- 审核 NL 调整: 增删合并子任务、调依赖、恢复原始草案，刷新页面后 chat 历史仍存在
- 全景图展开: 子节点可见、依赖连线、操作入口
- 取消级联: 父节点取消 → 子任务全部停止

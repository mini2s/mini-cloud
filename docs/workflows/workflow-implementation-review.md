# 工作流代码实现 vs 用户旅程文档 — 对照分析报告

> 基于 `docs/企业编程协作平台-用户旅程-工作流.md`，对当前代码实现进行系统性对照检视。

## 总体评估

当前代码实现了一个**相当完整的工作流引擎**，涵盖了用户旅程文档中的大部分核心功能，但在一些关键领域仍有差距。

---

## 一、数据模型总览

### 1.1 核心表结构（5 张表 + 1 张 Stage 表）

| 表名 | 用途 | Migration |
|------|------|-----------|
| `multica_workflow` | 工作流定义（标题、描述、状态、模板标记） | 108 |
| `multica_workflow_node` | 节点定义（Worker/Critic 配置、format_schema、stage_id） | 108 |
| `multica_workflow_edge` | 连线定义（source→target，防自环、防重复） | 108 |
| `multica_workflow_run` | 运行实例（输入/输出 JSON、运行时绑定） | 108 |
| `multica_workflow_node_run` | 节点运行实例（17 状态 FSM、三阶段流水线） | 108 |
| `multica_workflow_stage` | 研发阶段（名称、描述、sort_order） | 125 |

### 1.2 相关 Migration 时间线

| 编号 | 内容 |
|------|------|
| 108 | 核心建表（workflow、node、edge、run、node_run） |
| 109 | Issue 关联工作流（`workflow_id`、`workflow_run_id`） |
| 110 | Issue 来源类型扩展 `workflow` |
| 111 | NodeRun 增加 `worker_agent_task_id`、`critic_agent_task_id` |
| 114 | 全局表重命名加 `multica_` 前缀 |
| 117 | User 增加 `can_manage_workflows` |
| 121 | WorkflowRun 增加 `runtime_id` |
| 125 | 新增 `multica_workflow_stage` 表 |
| 126 | Issue 增加 `stage_id` |
| 127 | NodeRun 增加 `runtime_id`、`device_id`、`session_id`（CSC 会话绑定） |

---

## 二、API 端点总览

### 2.1 工作流 CRUD

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/workflows` | 列出工作流（支持 `?template=true/false`） |
| POST | `/api/workflows` | 创建工作流（支持 `template_id` 从模板克隆） |
| GET | `/api/workflows/{id}` | 获取详情（节点 + 边 + 阶段） |
| PUT | `/api/workflows/{id}` | 更新（含激活前校验） |
| DELETE | `/api/workflows/{id}` | 删除（模板有保护检查） |
| PUT | `/api/workflows/{id}/template` | 切换模板标记 |

### 2.2 节点/边/阶段 CRUD

| 方法 | 路径 | 功能 |
|------|------|------|
| GET/POST | `/api/workflows/{id}/nodes` | 节点列表/创建 |
| PUT/DELETE | `/api/workflows/{id}/nodes/{nodeId}` | 节点更新/删除 |
| GET/POST | `/api/workflows/{id}/edges` | 边列表/创建 |
| DELETE | `/api/workflows/{id}/edges/{edgeId}` | 边删除 |
| POST/GET | `/api/workflows/{id}/stages` | 阶段创建/列表 |
| PUT/DELETE | `/api/workflows/{id}/stages/{stageId}` | 阶段更新/删除 |
| PUT | `/api/workflows/{id}/stages/reorder` | 阶段排序 |
| PUT | `/api/workflows/{id}/nodes/{nodeId}/stage` | 节点分配阶段 |

### 2.3 运行生命周期

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/workflows/{id}/runs` | 运行历史 |
| POST | `/api/workflows/{id}/runs` | 启动运行 |
| GET | `/api/workflows/{id}/runs/{runId}` | 运行详情（含 node_runs） |
| GET | `/api/workflows/{id}/runs/{runId}/node-runs` | 节点运行列表 |
| POST | `/api/workflows/{id}/runs/{runId}/cancel` | 取消运行 |

### 2.4 节点运行操作

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/node-runs/{nodeRunId}/submit` | 提交 Worker 输出 |
| POST | `/api/node-runs/{nodeRunId}/review` | Critic 评审 |
| POST | `/api/node-runs/{nodeRunId}/skip` | 跳过节点 |
| POST | `/api/node-runs/{nodeRunId}/blocked` | 人工接管（Takeover） |
| POST | `/api/node-runs/{nodeRunId}/working` | 交还 Agent（Handback） |
| POST | `/api/node-runs/{nodeRunId}/finalize` | 直接完成/失败 |

### 2.5 其他

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/my-tasks` | 我的工作流任务 |
| GET | `/api/sessions/{sessionId}/permission` | CSC 会话权限 |
| GET/PUT/POST | `/api/workflow-admins` | 管理员 CRUD + 邀请 |

---

## 三、状态机详解

### 3.1 节点运行状态（17 种）

```
pending → format_checking → format_ok → worker_assigned → working
              ↓                                 ↓              ↓  ↘
         format_failed                    cancelled      awaiting_input  awaiting_critic
         (terminal)                       (terminal)          ↓                 ↓
                                                      working (resume)  critic_reviewing
                                                                           ↙        ↘
                                                                  critic_approved  critic_rework
                                                                        ↓               ↓
                                                                   completed      format_ok (retry)
                                                                   (terminal)     /  blocked (exhausted)
```

### 3.2 合法状态转移矩阵

| 状态 | 可转移到 |
|------|----------|
| `pending` | format_checking, skipped, cancelled |
| `format_checking` | format_ok, format_failed, cancelled |
| `format_ok` | worker_assigned, working, cancelled, skipped |
| `format_failed` | (终端) |
| `worker_assigned` | working, cancelled, skipped |
| `working` | awaiting_input, awaiting_critic, failed, cancelled, blocked |
| `awaiting_input` | working, cancelled, skipped |
| `awaiting_critic` | critic_reviewing, cancelled, skipped |
| `critic_reviewing` | critic_approved, critic_rework, cancelled |
| `critic_approved` | completed |
| `critic_rework` | format_ok, blocked |
| `completed` | (终端) |
| `failed` | (终端) |
| `blocked` | format_ok, skipped, working, completed, failed, cancelled |
| `skipped` | (终端) |
| `cancelled` | (终端) |

### 3.3 Worker-Critic 三阶段流水线

1. **Format 阶段**：JSON Schema 格式校验 → `format_ok` 或 `format_failed`
2. **Worker 阶段**：任务执行（人/Agent/Squad）→ 输出交付物
3. **Critic 阶段**：评审交付物 → 通过（`completed`）或返工（`critic_rework`）

### 3.4 `blocked` 状态的两种语义

通过 `completed_at` 字段区分：

| 语义 | `completed_at` | 触发方式 |
|------|---------------|----------|
| 重试超限卡死 | 已设置 | `UpdateWorkflowNodeRunStatus` 自动设置 |
| 人工接管暂停 | NULL | `TakeoverWorkflowNodeRun` 专用查询 |

---

## 四、前端实现总览

### 4.1 组件架构

```
apps/web (页面路由)
  /workflows → WorkflowsPage (列表)
  /workflows/[id] → WorkflowDetailShell → WorkflowPanoramaPage (编辑器)
  /workflows/[id]/runs → WorkflowRunsPage (运行历史)
  /workflows/[id]/runs/[runId] → WorkflowRunPage (运行详情)
  /workflows/[id]/overview → redirect

packages/views (UI 组件层)
  workflows/components/
    workflows-page.tsx                    -- 列表页（含模板卡片）
    workflow-detail-shell.tsx             -- 详情壳
    overview/workflow-panorama-page.tsx   -- 统一全景编辑器 ★核心
      ReactFlow 画布 + 4 种自定义节点
      CanvasStageLabels (泳道标签)
      PreflightBar (预检通知条)
      NodeConfigPanel (右侧配置面板)
      StageCreateDialog (阶段管理)
    workflow-run-page.tsx                 -- 运行可视化
    workflow-runs-page.tsx                -- 运行历史
    dag-canvas.tsx                        -- DAG 画布
    reactflow-nodes.tsx                   -- 4 种形状节点 + 注释节点
    node-config-panel.tsx                 -- 节点配置面板
    node-run-card.tsx                     -- 运行卡片
    node-run-control-actions.tsx          -- 接管/交还/最终化
    layout.ts                             -- Dagre 自动布局
    alignment-snap.ts                     -- 拖拽对齐吸附
  issues/components/
    workflow-dag-viewer.tsx              -- Issue 详情页 DAG 查看器
  settings/components/
    workflow-admins-tab.tsx              -- 管理员设置

packages/core (数据与逻辑层)
  types/workflow.ts                       -- 19 种类型/接口
  api/client.ts                           -- ~50 个 API 方法
  workflows/queries.ts                    -- 30+ React Query hooks
  workflows/store.ts                      -- Zustand 编辑器状态 (undo/redo)
  workflows/preflight-checks.ts           -- 7 项预检
  paths/paths.ts                          -- 4 个路径定义
```

### 4.2 Preflight 检查（7 项）

| 检查项 | 级别 | 阻塞 |
|--------|------|------|
| DAG 有向环检测 | error | 是 |
| 缺少执行者 | error | 是 |
| 无效评审引用 | error | 是 |
| Schema 必填字段缺失 | error | 是 |
| 孤立节点 | warning | 否 |
| 不可达节点 | warning | 否 |
| 未分配阶段 | warning | 否 |

### 4.3 WebSocket 事件（13 种）

`workflow:created` / `workflow:updated` / `workflow:deleted`
`workflow:run_started` / `workflow:run_completed` / `workflow:run_failed` / `workflow:run_cancelled`
`workflow:node_run_started` / `workflow:node_run_completed` / `workflow:node_run_failed`
`workflow:node_run_blocked` / `workflow:node_run_reviewed` / `workflow:node_run_resumed`

---

## 五、逐项对照：用户旅程文档

### 5.1 创建工作流 ✅ (基本完成, 有差距)

| 功能 | 状态 | 说明 |
|------|------|------|
| 录入工作流元数据（标题、描述） | ✅ | `POST /api/workflows` |
| 添加节点（标题、描述、位置、格式Schema） | ✅ | `POST /api/workflows/{id}/nodes` |
| 配置执行者（人/智能体/小队） | ✅ | `worker_type` + `worker_id` |
| 配置评审者（人/智能体/小队/API） | ✅ | `critic_type` + `critic_id` + `critic_api_url` |
| 连线节点（串行/并行） | ✅ | `POST /api/workflows/{id}/edges` |
| 不支持回路（DAG校验） | ✅ | DFS 三色标记法 O(V+E) |
| 研发阶段定义（Stage CRUD） | ✅ | 完整的 CRUD + 排序 + 节点关联 |
| 从模板创建 | ✅ | `template_id` 字段克隆模板 |
| 模板开关 | ✅ | `PUT /api/workflows/{id}/template` |
| **交付物定义** | ❌ 未实现 | 文档明确要求"定义交付物：文档/PR，以及交付要求"。当前只有 `format_schema`(JSON Schema)，无独立交付物模型 |
| **研发角色定义** | ❌ 未实现 | 文档要求"内置若干研发角色定义，动态映射关联研发岗位"。当前 `worker_type` 仅为 `human/agent/squad`，无角色概念 |
| 创建智能体（关联Plugin/Skill） | ⚠️ 部分 | 智能体创建在其他模块，工作流节点中可选已有智能体 |
| 创建小队（Leader Agent协调） | ⚠️ 部分 | Squad 模型存在，但仅"取 Leader Agent"的最简模式 |

### 5.2 编辑工作流 ✅ (基本完成)

所有编辑功能均已实现。前端 Panorama 编辑器功能丰富：ReactFlow 可视化、拖拽添加、阶段泳道、配置面板、undo/redo、自动布局、暗色/亮色主题、预检校验。

### 5.3 查看工作流执行情况 ⚠️ (部分实现)

| 功能 | 状态 | 说明 |
|------|------|------|
| 工作流 Run 列表/详情 | ✅ | 完整的 API + 前端页面 |
| 节点运行状态（16种） | ✅ | 状态机 + 图标映射 + 5秒轮询 |
| 我的任务列表 | ✅ | `GET /api/my-tasks` |
| Issue关联（子Issue生成） | ✅ | `OriginType: "workflow"` + `OriginID` |
| **工作流全局总览视图**（Issue详情中） | ⚠️ 仅后端 | 后端支持，前端 `workflow-dag-viewer.tsx` 需确认完整度 |
| **交付物红绿灯状态** | ❌ 未实现 | 文档要求"交付物情况：红绿灯提交状态" |
| **进入会话（跳转会话空间）** | ⚠️ 部分 | 有 `session_id`/`runtime_id` 绑定，前端实时查看需确认 |
| 重试操作 | ✅ | `max_retries` 机制完整 |

### 5.4 执行者交互

#### 5.4.1 人（执行者） ✅

| 功能 | 状态 |
|------|------|
| `worker_type=human` → `worker_assigned` | ✅ |
| SubmitNodeRun（提交交付物） | ✅ `POST /api/node-runs/{id}/submit` |
| ReviewNodeRun（评审） | ✅ `POST /api/node-runs/{id}/review` |
| 邮件/企微/CSC状态栏通知 | ❌ 未实现 |

#### 5.4.2 智能体（执行者）

**5.4.2.1 任务正常执行** ✅

| 功能 | 状态 |
|------|------|
| 状态机驱动 | ✅ 完整 17 状态 FSM |
| Agent Task 下发至运行时 | ✅ `DispatchAgentTask()` → `CreateWorkflowAgentTask` |
| Worker-Critic 循环 | ✅ `dispatchWorker` → `dispatchCritic` |
| 格式检查（JSON Schema 校验） | ✅ `executeFormatChecker` |
| 基于 Worktree 创建工作目录 | ❌ 未实现 |
| 下载 Plugin/Skill | ❌ 未实现 |

**5.4.2.2 任务失败** ✅

| 功能 | 状态 |
|------|------|
| 超限阻塞（blocked） | ✅ |
| 通知用户 | ❌ 未实现（仅 WS 事件） |

**5.4.2.3 任务纠偏** ✅ (Design Two)

| 功能 | 状态 |
|------|------|
| Takeover（人工介入） | ✅ `POST /api/node-runs/{id}/blocked` |
| Handback（托管交还） | ✅ `POST /api/node-runs/{id}/working` |
| Finalize（直接完成） | ✅ `POST /api/node-runs/{id}/finalize` |
| CSC 会话绑定 | ✅ `BindWorkflowNodeRunSession` |

**5.4.2.4 头脑风暴** ✅

| 功能 | 状态 |
|------|------|
| `awaiting_input` 暂停 | ✅ Agent 返回 `{"status":"awaiting_input"}` |
| 自动回复 | ✅ `workflow_auto_reply_enabled` |
| 手动恢复 | ✅ `ResumeNodeRunFromComment` |

**5.4.2.5 任务分配** ❌

| 功能 | 状态 |
|------|------|
| 智能体拆解任务 | ❌ 无对应结构 |
| 动态分配（岗位/责任田/用户画像） | ❌ 无相关数据模型 |
| 通知用户确认 | ❌ 未实现 |

**5.4.2.6 代码提交** ❌

| 功能 | 状态 |
|------|------|
| 关联代码仓库 | ❌ 无 `repository` 关联 |
| PR 作为交付物 | ❌ 交付物模型缺失 |
| 代码整合节点 | ❌ 无汇总节点概念 |
| 冲突解决记录 | ❌ 未实现 |

#### 5.4.3 小队（执行者） ⚠️

| 功能 | 状态 |
|------|------|
| Squad 模型 | ✅ |
| Leader Agent 协调 | ✅ `dispatchWorker` 中自动取 leader |
| 小队内动态分配 | ❌ 未实现 |
| 成员分配（岗位/责任田） | ❌ 未实现 |

### 5.5 评审者交互

#### 5.5.1 人（评审者） ✅

| 功能 | 状态 |
|------|------|
| `critic_type=human` → `awaiting_critic` | ✅ |
| 通过（附意见） | ✅ |
| 驳回（附意见） | ✅ |
| 驳回后状态重置 | ✅ `critic_rework` → `format_ok` |
| 执行者是智能体时保留会话 | ⚠️ 会话绑定存在，需确认上下文传递 |

#### 5.5.2 智能体（评审者） ✅

| 功能 | 状态 |
|------|------|
| `critic_type=agent` → 分发 Critic Agent Task | ✅ |
| 自动评审（解析 approve/reject） | ✅ `HandleWorkflowTaskCompletion` |
| 通过/驳回逻辑 | ✅ 与人相同路径 |

#### 5.5.3 小队（评审者） ⚠️

与 5.4.3 类似，仅框架存在（`critic_type=squad` → 取 Squad Leader Agent）。

---

## 六、差距总结（按优先级）

### 🔴 缺失重要功能

1. **交付物模型** — 需要独立的 `deliverable` 表（类型：文档/PR），关联到节点，包含交付要求和红绿灯状态
2. **研发角色定义** — 需要"角色"概念，映射到岗位，支持节点配置执行者/评审者为"角色"
3. **智能体任务拆解和动态分配**（用户旅程 4.1.2.5）— 子任务分配机制
4. **代码提交/整合工作流**（用户旅程 4.1.2.6）— 代码仓库关联、PR 交付物、整合节点
5. **通知系统** — 邮件/企微/CSC 状态栏通知全部未实现
6. **Worktree 工作目录** — 智能体执行时创建隔离环境
7. **Plugin/Skill 动态加载** — 智能体从知识中心加载能力

### 🟡 部分实现需完善

1. **Issue 详情中的工作流全景视图** — 后端数据齐全，前端可视化需确认完整性
2. **小队管理界面** — Squad 模型存在但编辑界面不完整
3. **会话跳转/实时查看/介入** — Design Two 实现了控制权切换，前端实时查看需确认
4. **驳回后智能体上下文保持** — 会话绑定存在，需确认评审驳回后正确传递上下文

### 🟢 已完善

1. Workflow CRUD（含 Stage 管理）
2. Node/Edge CRUD + DAG 可视化编辑器
3. 完整的 Worker-Critic 状态机（17 状态 + FSM 白名单）
4. 模板系统（创建/克隆/权限控制/builtin-agent 校验）
5. 人工介入/托管交还（Takeover/Handback/Finalize）
6. `awaiting_input` 头脑风暴模式 + 自动回复
7. Workflow Admin 管理
8. Sub-issue 自动生成
9. WebSocket 实时事件通知
10. Preflight 检查（7 项激活前校验）
11. 前端 Panorama 编辑器（ReactFlow + 泳道 + undo/redo）
12. 中英文国际化完整覆盖

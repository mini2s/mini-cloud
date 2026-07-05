# AI-First 设计蓝图

> 状态：设计阶段 | 日期：2026-07-05

## 核心理念

**AI-first = 每个主要操作都有 NL 入口，但 UI 仍是权威的编辑和确认界面。**

NL 生成的是 draft，UI 是精修工具。不搞纯 NL 对话式操作——那会丢失精确性和可撤销性。

## 架构全景

```
┌─────────────────────────────────────────────────────────┐
│                    前端                                  │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │Workflow  │ │  Issue   │ │  Inbox   │ │  Agent   │  │
│  │AiPanel   │ │ AiBar    │ │ AiPanel  │ │ AiPanel  │  │
│  │(wrapper) │ │(wrapper) │ │(wrapper) │ │(wrapper) │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘  │
│       │            │            │            │          │
│       └────────────┴────────────┴────────────┘          │
│                        │                                │
│              ┌─────────┴─────────┐                      │
│              │   AiInputCore     │  (pure UI)           │
│              │ mode: chat|command│                      │
│              └───────────────────┘                      │
└──────────────────────┬──────────────────────────────────┘
                       │ POST /api/commands
                       │ { context_type, context_id, user_input, mode }
┌──────────────────────┴──────────────────────────────────┐
│                    后端                                  │
│                                                         │
│  CommandHandler → dispatch by context_type              │
│    ├─ IssuePromptBuilder                                │
│    ├─ WorkflowPromptBuilder                             │
│    ├─ InboxPromptBuilder                                │
│    └─ AgentPromptBuilder                                │
│           │                                             │
│           ▼                                             │
│    创建 agent_task_queue → daemon 认领 → agent CLI 执行  │
│           │                                             │
│           ▼                                             │
│    WS 事件 → 前端刷新                                    │
└─────────────────────────────────────────────────────────┘
```

## 关键决策清单

| # | 决策 | 结论 |
|---|------|------|
| 1 | AI-first 边界 | NL 生成草案，UI 精修确认 |
| 2 | Workflow NL 入口 | 编辑器底部 prompt bar（n8n 模式） |
| 3 | LLM 上下文 | 智能体列表 + 小队列表 + 成员列表 + workflow 模板 |
| 4 | 执行路径 | Agent 任务管线 |
| 5 | Agent 结果落地 | Agent 直写 DB → WS 事件 → 画布实时刷新 |
| 6 | Workflow NL panel | 底部对话条 |
| 7 | Issue 指令 vs Chat | 新建独立 UI，不复用 Chat |
| 8 | Issue 后端 | Agent 管线 + 乐观更新 |
| 9 | 指令执行 agent | Workspace 默认 agent + 可选切换 |
| 10 | 组件复用 | AiInputCore（共享底层）+ 各场景 wrapper |
| 11 | AiInputCore 契约 | 纯 UI：mode + placeholder + agent selector + onSubmit |
| 12 | 首版范围 | Workflow + Issue + Inbox + Agent 创建 |
| 13 | NL 指令解析 | 规则引擎（正则 + 关键词）→ 单意图优先 |
| 14 | Prompt 构造 | 后端集中（统一 API + 内部分发） |
| 15 | API 设计 | `POST /api/commands` 统一入口 |

---

## 场景设计

### 场景 1：Workflow NL 生成

- **触发入口：** 编辑器底部 prompt bar — "描述你想要的 workflow…"
- **交互模式：** `chat`（多轮迭代）
- **流程：** 用户输入 → `POST /api/commands { context_type: "workflow" }` → agent 调用 `cs-workflow` CLI 创建 draft → WS 通知前端 → 画布实时刷新
- **增量精修：** agent 操作已有 workflow，字段级别 `workflow:updated` 事件
- **Agent 选择器：** 显示，默认 workspace 默认 agent
- **对话历史：** 本地 session 状态，不持久化
- **参考：** n8n AI Workflow Builder — 增量可视构建 + 对话式迭代

### 场景 2：Issue NL 指令

- **触发入口：** Issue 详情页底部紧凑指令栏 — "输入指令…"
- **交互模式：** `command`（单次指令）
- **首版支持操作：**
  - 分配：`分配给 @张三` / `assign 给 智能体名` / `交给 小队名`
  - 状态：`状态改为 in_review` / `标记为 done` / `移到 backlog`
  - 优先级：`优先级 P0` / `设为 urgent`
  - 标签：`加 bug 标签` / `去掉 enhancement`
- **解析策略：** 正则 + 关键词规则匹配，单意图优先
- **执行 agent：** Workspace 默认 agent（可切换）
- **UX：** 即时乐观更新（assignee/status 立刻变化）→ agent 确认/回滚

### 场景 3：Inbox NL 分诊

- **触发入口：** Inbox 页面底部指令栏
- **交互模式：** `command`（单次指令）
- **首版支持操作：**
  - `归档所有已完成的`
  - `标记全部已读`
  - `总结今天的智能体活动`
- **执行 agent：** Workspace 默认 agent（可切换）

### 场景 4：Agent NL 创建

- **触发入口：** Agents 页面底部指令栏
- **交互模式：** `command`（单次指令）
- **示例：** "创建一个叫 Code Reviewer 的智能体，用 Claude Opus，擅长 PR review"
- **Agent 选择器：** 显示

---

## 组件设计

### AiInputCore（纯 UI）

```
packages/views/ai/ai-input-core.tsx
```

```typescript
interface AiInputCoreProps {
  mode: "chat" | "command";
  placeholder: string;
  showAgentSelector: boolean;
  defaultAgentId?: string;
  onSubmit: (input: string, agentId: string) => Promise<void>;
  disabled?: boolean;
}
```

职责：
- 输入框 + 提交按钮
- Agent 选择器（可选显示）
- 提交后的 loading/error/done 状态
- 不感知任何场景差异

### 场景 Wrapper（四个）

```
packages/views/ai/workflow-ai-panel.tsx   → 多轮对话 + 历史 + context 注入
packages/views/ai/issue-ai-bar.tsx        → 单次指令 + 乐观更新 + issue context
packages/views/ai/inbox-ai-panel.tsx      → 单次指令 + 乐观更新 + inbox context
packages/views/ai/agent-ai-panel.tsx      → 单次指令 + agent 列表 context
```

每个 wrapper 负责：
1. 构造 prompt context（注入 entity 上下文）
2. 调用 `POST /api/commands`
3. 处理结果（乐观更新 / WS 事件监听 / 错误处理）
4. 对话历史管理（仅 workflow chat 模式）

---

## API 设计

### POST /api/commands

统一指令入口。

```json
// Request
{
  "workspace_id": "...",
  "context_type": "workflow" | "issue" | "inbox" | "agent",
  "context_id": "...",
  "user_input": "分配给 @张三",
  "mode": "chat" | "command"
}

// Response
{
  "task_id": "...",
  "agent_id": "..."
}
```

后端处理：
1. `CommandHandler` 根据 `context_type` dispatch
2. 对应的 `PromptBuilder` 构造 agent prompt：
   - `IssuePromptBuilder(user_input, issue)`
   - `WorkflowPromptBuilder(user_input, workflow)`
   - `InboxPromptBuilder(user_input, workspace)`
   - `AgentPromptBuilder(user_input, workspace)`
3. 创建 `agent_task_queue` 行（高优先级）
4. 返回 `task_id`，前端通过 WS 监听 `task:completed` 或 `task:failed`

---

## 传给 LLM 的上下文

首版必须传入：

- 工作区内的可用智能体列表（名称、描述、技能）
- 工作区内的可用小队列表
- 工作区内的可用成员列表（human worker 需要）
- 现有 workflow 模板（用于匹配复用）

不传入：

- 凭证、token
- 历史执行数据
- 用户个人数据

---

## 不在此版本范围（V2+）

- NL 筛选翻译（Issue 列表 "显示高优先级未分配的 bug"）
- Dashboard NL 查询（"对比本月和上月成本"）
- Settings NL 指令
- 复杂 Issue 操作的 agent 管线（"帮我 review 这个 PR" — 与 @mention 触发机制重叠，需谨慎设计）
- 共享 undo stack（AI 操作和人工操作同栈回退）
- 语义匹配 / 智能路由（目前用精确指令）

---

## 附录：实现阶段需澄清的问题

以下问题在 spec review 中识别，不影响设计审批，但实现规划时必须明确：

1. **NL 解析位置** — Decision #13 的规则引擎在前后端各需一份：前端用于乐观更新（解析意图以立即改变 UI），后端用于 PromptBuilder（构造 agent prompt）。需确定共享方式（共享 TS 模块 + 后端等效 Go 实现，还是仅后端解析、前端不做乐观更新？）。

2. **AiInputCore.onSubmit 契约** — 当前 `Promise<void>` 不足以支持 Issue wrapper 的乐观更新（wrapper 需要知道解析后的意图）。建议改为返回 `{ taskId, agentId, parsedIntent? }` 或由 wrapper 自行二次解析。

3. **Workflow chat 上下文传递** — 对话历史存储在前端本地，但每次 `POST /api/commands` 需要完整历史才能让 LLM 理解上下文。需明确：前端每次携带 `messages[]`，还是后端维护 session、前端只传 `session_id`？

4. **Command 模式回滚** — 乐观更新后 agent 执行失败的回滚逻辑，可复用现有 TanStack Query 的 `onError` + `rollback` 模式。

5. **上下文大小控制** — 传给 LLM 的 agent/squad/member 列表在中大型工作区可能很大，需考虑截断策略或按需加载。

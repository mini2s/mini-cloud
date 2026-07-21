# assistant-ui Tool 渲染调研

> 日期：2026-07-20
>
> 状态：已实现并按真实 SSE/history payload 校准
>
> 范围：Multica 单个 conversation 的 `ExternalStoreRuntime`，以及
> `packages/views/common/session` 中的 assistant-ui 消息渲染。

## 结论

Multica 不需要替换现有 conversation runtime，也不需要引入
`@assistant-ui/react-opencode`。Tool 渲染应建立在当前链路之上：

```text
cloud proxy REST + SSE
  -> ConversationRuntimeController
  -> Query-backed ConversationRuntimeState
  -> OpenCode ToolPart -> assistant-ui tool-call 投影
  -> ExternalStoreRuntime
  -> assistant-ui Tools registry
  -> MessagePrimitive.GroupedParts
  -> 专用 renderer / fallback renderer
```

推荐方案：

1. 保留 `packages/core/conversations` 作为协议状态的唯一事实来源。
2. 保持 `toolCallId = callID ?? part.id`。这是
   `assistant-ui-react-tool-call-research.md` 建议的稳定业务 ID，也与
   Multica 当前投影一致。
3. 在 `packages/views/common/session/tools` 中复刻
   `examples/with-opencode/components/tools` 的 UI 和交互，不把 UI
   代码放进 `packages/core`。
4. 使用 assistant-ui `defineToolkit + Tools({ toolkit })` 注册
   `type: "backend"` 的纯 renderer，再由 `GroupedParts` 渲染
   `part.toolUI`。
5. 不复制示例中的 `"use generative"` 和 `externalTool()`。Multica
   没有接入对应编译转换；`externalTool()` 本身没有运行时实现，会直接
   抛错。
6. tool 仍由 cloud proxy 执行。renderer 不提供 `execute`，也不调用
   `addResult` 或 `onAddToolResult` 回写结果。
7. 用一个只读的 Tool bridge 把现有 Query state 中的 provider
   状态、progress、permission、question 和 controller actions
   暴露给 renderer；不建立第二份 store。
8. UI 可以复刻，但 OpenCode runtime extras 不能原样复制。VSCode
   `openFile/openDiff` 本次明确不实现；diff 只在对话内展示。

## 实现结果

当前实现已经完成：

- 稳定 ToolPart 投影、callID/part ID 对账和 unknown fallback；
- plain backend toolkit、真实 provider aliases 和
  `MessagePrimitive.GroupedParts` 分发；
- read/edit/write/bash/grep/glob/web search/web fetch/apply patch/task/
  question renderer；
- provider metadata、progress、task、permission 和 question bridge；
- permission/question 的 control/observe 交互；
- `metadata.filediff` 的 camelCase/snake_case 归一化和内嵌 diff；
- 真实抓包 fixture、projection/reducer/renderer/interaction 测试。

实现没有增加第二个 client/store，也没有实现 `openFile`、`openDiff`、
revert 或 MCP 专用 renderer。MCP/未知工具统一由安全 fallback 展示。

## 调研依据

### 指定文档

- `/home/dev/projects/workspace/workspace-1/opencode/packages/app-ai-native/docs/assistant-ui-react-tool-call-research.md`
  - ToolPart contract：54–128 行；
  - reducer、ID 对账和 snapshot：130–196 行；
  - assistant-ui 投影和 ID：198–249 行；
  - 状态映射及 falsy result：251–317 行；
  - renderer 注册、分发和 grouping：319–449 行。
- `/home/dev/projects/workspace/workspace-1/assistant-ui/examples/with-opencode/tool-rendering-research.md`
  - 完整调用链：24–158 行；
  - 在线分发与未接线 toolkit：160–208 行；
  - UI 组件行为：210–304 行；
  - permission/question：306–356 行；
  - 最小复刻架构与风险：372–530 行。

### 第一方源码

- assistant-ui ToolPart 投影：
  `/home/dev/projects/workspace/workspace-1/assistant-ui/packages/react-opencode/src/openCodeMessageProjection.ts`
  78–119、393–463 行。
- assistant-ui runtime 接线：
  `/home/dev/projects/workspace/workspace-1/assistant-ui/packages/react-opencode/src/useOpenCodeRuntime.ts`
  421–456、539–610 行。
- 示例的 tool 分发和 `GroupedParts`：
  `/home/dev/projects/workspace/workspace-1/assistant-ui/examples/with-opencode/components/assistant-ui/thread.tsx`
  116–179、698–747 行。
- assistant-ui `Tools` registry：
  `/home/dev/projects/workspace/workspace-1/assistant-ui/packages/core/src/react/client/Tools.ts`
  31–158 行。
- `GroupedParts` 的 `toolUI` 注入：
  `/home/dev/projects/workspace/workspace-1/assistant-ui/packages/core/src/react/primitives/message/MessageGroupedParts.tsx`
  19–132、178–293 行。
- `externalTool()` 的运行时限制：
  `/home/dev/projects/workspace/workspace-1/assistant-ui/packages/core/src/react/model-context/external-tool.ts`
  1–16 行。
- assistant-ui ToolPart status 推导：
  `/home/dev/projects/workspace/workspace-1/assistant-ui/packages/core/src/runtime/api/message-runtime.ts`
  39–57 行。

### Multica 实现前基线

- 协议状态：
  `packages/core/conversations/runtime/state.ts`。
- SSE reducer：
  `packages/core/conversations/runtime/reducer.ts`。
- REST/SSE controller 和交互 actions：
  `packages/core/conversations/runtime/controller.ts`。
- assistant-ui 投影：
  `packages/views/common/session/runtime/to-thread-message-like.ts`。
- ExternalStoreRuntime：
  `packages/views/common/session/runtime/use-conversation-runtime.ts`。
- 实现前通用 fallback：
  `packages/views/common/session/session-tool.tsx`。
- 当前消息渲染入口：
  `packages/views/common/session/session-message.tsx`。

Multica 固定使用 `@assistant-ui/react@0.14.26`，见
`pnpm-workspace.yaml` 36–37 行。该版本已经包含本方案需要的
`defineToolkit`、`Tools`、`useAui` 和 `MessagePrimitive.GroupedParts`。

## 真实 cloud proxy 协议验证

2026-07-20 使用授权的浏览器状态，在现有 cloud workspace 和
conversation 中选择 `DeepSeek-V4-Flash`，执行了两次只读工具调用：

1. 列出工作区根目录并读取 README 的前 20 行；
2. 执行 `pwd` 并用一句话回复。

两次调用都明确要求不修改文件。第一轮用于观察真实 Tool UI 和网络
请求，第二轮用于在页面内捕获并立即脱敏 SSE/history payload。

脱敏后的紧凑 fixture 位于：

`packages/core/conversations/clients/cloud-proxy/fixtures/tool-call-capture.json`

它保留请求、SSE、history 的字段关系和一组代表性状态转换，但做了
以下处理：

- 替换所有 host、workspace、conversation、message、part 和 call ID；
- 替换路径、命令输出、reasoning、正文和时间；
- 折叠 120 个重复的 `message.part.delta`；
- 不保存 cookie、Authorization、device ID、真实 proxy URL 或浏览器
  state。

### 已验证的端点和请求

| 用途 | 请求 | 结果 |
| --- | --- | --- |
| SSE | `GET /api/v1/events` | 200，`text/event-stream` |
| history | `GET /api/v1/conversations/:id/messages?limit=200` | 200，顶层数组 |
| prompt | `POST /api/v1/conversations/:id/prompt/async` | 200 |
| status | `GET /api/v1/conversations/status` | 200 |
| permissions | `GET /api/v1/permissions` | 200 |
| questions | `GET /api/v1/questions` | 200 |
| todo | `GET /api/v1/conversations/:id/todo` | 200 |

网页端实际发送的 prompt body 不是只有 `parts`：

```json
{
  "sessionID": "conversation-1",
  "messageID": "message-user-1",
  "agent": "build",
  "model": {
    "providerID": "costrict",
    "modelID": "DeepSeek-V4-Flash"
  },
  "parts": [
    {
      "id": "part-user-text-1",
      "type": "text",
      "text": "Run a read-only check."
    }
  ]
}
```

当前 Multica `CloudProxyClient.conversation.promptAsync()` 只提交
`{ parts }`。这是真实客户端与当前 runtime 的已验证协议差异。它不
阻塞本调研的 history/tool projection，但正式实现发送流程前应确认
proxy 是否保证为缺失的 `sessionID/messageID/agent/model/part.id`
补默认值；否则需要扩充 `OpenCodePromptInput`，并由 session 配置或
model selector 提供 agent/model。

### 已验证的 SSE 生命周期

一次只读 `bash/pwd` 调用共捕获：

| 事件 | 数量 |
| --- | ---: |
| `message.part.delta` | 120 |
| `message.part.updated` | 12 |
| `message.updated` | 6 |
| `session.status` | 4 |
| `session.info` | 1 |
| `session.result` | 1 |
| `session.idle` | 1 |
| `session.diff` | 1 |

目标 conversation 最终同时收到：

```text
session.status(idle)
-> session.idle
-> session.diff([])
```

因此：

- `session.status` 和 `session.idle` 都会出现，reducer 对重复 idle
  必须幂等；
- `session.result` 带 `subtype/isError/stopReason/usage`，它不是
  message 的正文；
- `session.info` 本次为 `subtype: "init"`；
- `session.diff` 即使为空也会在结束后出现；
- `message.part.delta` 只携带
  `messageID/partID/field/delta`，需要先有 part 才能原位应用；
- conversation 路由不能只看 `properties.sessionID`，还要兼容
  `properties.part.sessionID` 和 `properties.info.sessionID`。当前
  `normalizeOpenCodeEvent()` 已覆盖这三处。

本次未出现 `tool.progress`。因此无法根据这次抓包确认它使用
`callID`、part ID 还是 provider-specific ID，现有多键 fallback
设计仍然必要。

### 已验证的 tool history shape

history 是 `OpenCodeMessageWithParts[]`。一次工具调用会形成 user
message、包含 tool 的 assistant message，以及后续 final assistant
message。completed tool part 的真实核心形状是：

```json
{
  "id": "part-tool-1",
  "callID": "call-1",
  "type": "tool",
  "tool": "bash",
  "state": {
    "status": "completed",
    "input": {
      "command": "pwd",
      "description": "Print the current directory"
    },
    "output": "/workspace",
    "title": "Print the current directory",
    "time": {
      "start": 1001,
      "end": 1002
    }
  }
}
```

同一条 assistant message 的 `info.content` 还保留 provider 原始
`tool_use`：

```json
{
  "type": "tool_use",
  "id": "call-1",
  "name": "Bash",
  "input": {
    "command": "pwd"
  }
}
```

这确认了两个实现细节：

1. renderer 应以标准化 part 的 `tool: "bash"` 注册，而不是按
   provider content 中的 `"Bash"` 注册；
2. `callID` 与 provider `tool_use.id` 对应，`part.id` 是另一个 ID。
   `toolCallId = callID ?? part.id` 的选择与真实数据一致。

实际页面把 read/search/list 归入一个可折叠的 `Explored` 分组，把
`Bash` 作为独立 tool row 显示。复刻 UI 时应保持这种“探索类分组、
执行类独立”的层次，不应简单把所有连续 tool 都折叠成同一种卡片。

### HAR 的限制

浏览器网络捕获生成了一份原始 HAR，但 CDP 导出的 streaming fetch
response body 为空，无法单独用它回放 SSE；已完成的 history fetch
可以通过 CDP request detail 读取 response body。HAR 仍可能包含真实
workspace、device、conversation 标识和 prompt，所以不会加入仓库。
仓库中的脱敏 JSON fixture 比原始 HAR 更适合 reducer、projection 和
renderer mock 测试。

为避免从 UI 或最终 snapshot 反推事件，补充验证使用已审阅的 page-init
脚本包装 `fetch`：仅对 `/events` response 执行 `clone()`，旁路读取并
解析 clone 的 SSE，原 response 继续由页面消费。该方式确认了 HAR 中
缺失的 permission、question、task 和 diff 事件体，且不读取 cookie、
不改写请求，也不 mock 服务端响应。

### 补充场景验证

同日又构造了 read/glob/grep、question、write/edit、持续输出 Bash、
WebSearch、Agent 子任务和 tracked file diff 场景。脱敏结果位于：

`packages/core/conversations/clients/cloud-proxy/fixtures/tool-interaction-capture.json`

MCP 按要求没有触发。

#### Tool names 和输入

真实 `message.part.updated` 确认以下标准化 tool names：

| UI/场景 | `part.tool` | 完整 input keys |
| --- | --- | --- |
| Glob | `glob` | `path`, `pattern` |
| Grep | `grep` | `output_mode`, `path`, `pattern` |
| Read | `read` | `filePath`, `limit` |
| AskUserQuestion | `askuserquestion` | `questions` |
| Write/create | `edit` | `content`, `filePath` |
| Edit/replace | `edit` | `filePath`, `newString`, `oldString` |
| Bash | `bash` | `command`, `description` |
| Web Search | `websearch` | `query` |
| Agent | `task` | `description`, `prompt`, `subagent_type` |

这说明：

- create/write 和 replace/edit 在协议层都使用 `part.tool: "edit"`，
  renderer 应根据 input shape 决定显示 Write 还是 Edit；
- `edit` 的 pending/running/completed state 都可能带
  `metadata.filediff`，这是当前部署中比 session diff 更直接的 diff
  来源；
- question 的真实名称是全小写 `askuserquestion`，需要加入 registry
  alias；
- Web Search 的真实名称是 `websearch`，不是示例中的 camelCase
  `webSearch`；
- Agent 子任务投影为 `task` tool，同时另外发送 `task.*` 事件。

#### Live SSE 与 history 的 input casing 不同

同一批调用在 live `message.part.updated` 和 reload 后的 REST history
中出现了不同的 file argument 命名：

| 场景 | live SSE `state.input` | REST history `state.input` |
| --- | --- | --- |
| Read | `filePath`, `limit` | `file_path`, `limit`, 可选 `offset` |
| Write/create | `content`, `filePath` | `content`, `file_path` |
| Edit/replace | `filePath`, `newString`, `oldString` | `file_path`, `new_string`, `old_string` |

因此 renderer 的参数读取必须先归一化 camelCase/snake_case，不能只按
live SSE shape 实现。Tool name 没有这个差异：两种来源中的
write/create 和 edit/replace 都是 `tool: "edit"`。

#### Permission payload

本次捕获到四种 `permission.asked`：

```ts
type PermissionAskedProperties = {
  type: "permission.asked";
  id: string;
  sessionID: string;
  session_id: string;
  permission: "edit" | "bash" | "websearch";
  patterns: string[];
  always: string[];
  metadata: {
    input: Record<string, unknown>;
  };
  tool: {
    callID: string;
    messageID: string;
  };
};
```

其中：

- write/create 的 `metadata.input` 是 `filePath/content`；
- edit/replace 是 `filePath/oldString/newString`；
- Bash 是 `command/description`；
- WebSearch 是 `query`。

`permission.replied` 的稳定字段只有：

```ts
{
  type?: "permission.replied";
  requestID: string;
  sessionID: string;
  session_id?: string;
}
```

真实 SSE reply 没有携带 `once/always/reject` decision，所以 reducer
只能按 `requestID` 清除 pending permission；不能从 reply 事件重建
用户选择。

#### Question payload

`question.asked` 的真实 payload 是：

```ts
type QuestionAskedProperties = {
  type: "question.asked";
  id: string;
  sessionID: string;
  session_id: string;
  questions: Array<{
    header: string;
    question: string;
    multiple: boolean;
    custom: boolean;
    options: Array<{
      label: string;
      description: string;
    }>;
  }>;
  tool: {
    callID: string;
    messageID: string;
  };
};
```

`question.replied` 与 permission reply 类似，只包含
`requestID/sessionID/session_id/type`，没有返回用户选择的 answers。
UI 提交成功后应按 request ID 清除交互；如果需要展示历史答案，不能
依赖 replied SSE，需要从 history/tool result 或单独的本地提交状态
取得。

#### Progress 的真实行为

为了触发 progress，分别执行了：

1. 每秒输出一行、持续 5 秒的 Bash；
2. WebSearch；
3. Agent 子任务。

三种场景的 `tool.progress` 数量均为 0。实际行为是：

- Bash 实时输出通过 `message.part.delta` 传输；
- Agent 发送 `task.started`、`task.progress`、`task.completed`；
- running `task` ToolState 还可能带 `state.progress`。

因此当前部署中 `tool.progress` 只能视为可选的前向兼容事件，不能让
任何 renderer 依赖它才能显示实时状态。Bash 优先消费 part delta，
Agent 优先消费 `task.*` 和 ToolState.progress；已有
`toolProgress` store 可以保留兼容，但没有必要为当前协议制造假的
event。

#### Diff probe

为排除“untracked file 不进入 diff”的影响，测试先确认 tracked
`README.md` 没有本地修改，再追加唯一标记。此时本地 Git diff 明确
非空，但：

- SSE 仍返回 `session.diff { diff: [] }`；
- `GET /api/v1/conversations/:id/diff` 返回 501 error envelope。

捕获后已恢复 README 并删除临时文件，目标 workspace 针对这两个文件
的 Git 状态为空。

结论：当前部署不能提供非空 conversation diff。第一版 diff renderer
应使用 `edit` ToolState 的 `metadata.filediff`；session diff 保持可选
增强，REST 501 按现有 optional snapshot 逻辑降级为空数组。

## 实现前已经具备的能力

### ToolPart 的实时状态

`ConversationRuntimeState` 已保存：

- `messagesById` 和每条 message 的完整 parts；
- `permissions`；
- `questions`；
- `toolProgress`；
- `partProgress`；
- `diff`；
- `todo` 和 `tasks`。

证据见 `packages/core/conversations/runtime/state.ts` 55–82 行。

reducer 已处理：

- `message.part.updated`；
- `message.part.delta`；
- `message.part.removed`；
- `permission.asked/replied`；
- `question.asked/replied/rejected`；
- `tool.progress`；
- ToolState 内的 `progress`。

证据见 `packages/core/conversations/runtime/reducer.ts` 581–785 行。

controller 已提供：

- `respondToPermission`；
- `replyToQuestion`；
- `rejectQuestion`。

证据见 `packages/core/conversations/runtime/controller.ts` 126–139 行。

因此 Tool UI 不需要再创建事件订阅、SDK client 或 interaction store。
缺少的是从现有状态到 renderer 的展示桥接。

### 标准 tool-call 投影

实现前的 `projectPart` 已输出：

```ts
{
  type: "tool-call",
  toolCallId: part.callID ?? part.id,
  toolName: part.tool,
  args,
  argsText,
  result,
  isError,
}
```

见 `packages/views/common/session/runtime/to-thread-message-like.ts`
92–107 行。

这已经满足 assistant-ui renderer 的基本输入。实现前的
`SessionTool` 也能显示 running、complete、error，以及折叠后的原始
input/output；它可以在专用 renderer 上线后成为新的 fallback
实现参考。

## 实现前差距

| 层 | 当前状态 | 需要补充 |
| --- | --- | --- |
| 投影 | 所有非 error 状态都读取 `state.output` | 只在 `completed` 时提供 `result` |
| ID | `callID -> part.id -> "unknown-tool-call"` | 双 ID 都缺失时作为协议异常处理，避免固定 ID 冲突 |
| metadata | 原始 part 只在 message metadata 中 | 用 Tool bridge 保留 part/message/provider state |
| renderer | 只有 `SessionTool` fallback | 注册 read/edit/write/bash 等专用 renderer |
| 分组 | 使用 `MessagePrimitive.Parts` | 改为 `GroupedParts`，渲染 `part.toolUI` |
| progress | reducer 已保存，UI 不可访问 | bridge 按 callID/part ID 暴露 |
| permission/question | state 和 actions 已存在，UI 不可访问 | bridge + interaction decorator |
| diff | state 已保存，但专用 UI 和依赖不存在 | 适配 diff renderer，不新建第二个 client |
| host action | 没有 VSCode `openFile/openDiff` bridge | 本次明确不实现，也不显示依赖 host 的动作 |

## ToolPart 投影与 ID 设计

### 两个 ID 的语义

OpenCode ToolPart 同时包含：

- `part.id`：message part 的协议主键，用于 part update/remove；
- `callID`：同一次工具调用的业务键，用于 ToolState 更新、
  permission/question 和部分 progress 关联。

Multica reducer 应继续：

1. 优先按 `part.id` 更新已有 part；
2. 找不到时按 `callID` 对账；
3. 按 `callID` 命中时保留已有 `part.id`，避免 part identity 抖动。

当前实现见 `packages/core/conversations/runtime/reducer.ts` 110–135 行。

### `toolCallId` 的决策

两份参考材料存在一个需要显式解决的差异：

- 指定的 app-ai-native 研究建议
  `toolCallId = callID ?? part.id`；
- 当前 `react-opencode` 源码实际使用
  `part.id ?? callID`，再把 `callID` 以 `__openCodeCallId` 塞进 args
  供 interaction 查找。

Multica 选择前者：

```ts
toolCallId: part.callID ?? part.id
```

原因：

- 用户已指定投影和 ID 以
  `assistant-ui-react-tool-call-research.md` 为参考；
- permission、question 和 ToolState 生命周期天然围绕 `callID`；
- reducer 已允许同一 `callID` 的 part ID 发生变化；
- 使用 `callID` 可以在这种兼容更新中保留 React key、折叠状态和
  tool timing；
- 当前 Multica 投影已经采用该规则，不需要迁移现有 UI identity。

`part.id` 和 `messageID` 仍然要保留，但不应像示例一样写进业务
`args`。推荐按 `callID` 建只读 side map：

```ts
type ConversationToolEntry = {
  toolCallId: string;
  callId?: string;
  partId?: string;
  messageId: string;
  toolName: string;
  providerState?: Record<string, unknown>;
  progress: readonly string[];
  permission?: Record<string, unknown>;
  question?: Record<string, unknown>;
};
```

如果 `callID` 和 `part.id` 都不存在，不应继续使用固定字符串
`"unknown-tool-call"`，否则同一 message 的多个异常 tool 会共享
identity。推荐把该 part 降级成 `opencode-unsupported-part` data
part，同时记录 protocol warning；不要生成随机 ID。

### 推荐投影

```ts
function projectToolPart(part: OpenCodePart): ToolCallPart | DataPart {
  const state = asRecord(part.state);
  const status = state?.status;
  const toolCallId =
    typeof part.callID === "string"
      ? part.callID
      : typeof part.id === "string"
        ? part.id
        : undefined;

  if (!toolCallId) return projectMalformedToolPart(part);

  const input = parseToolInput(state?.input);
  const argsText =
    status === "pending" && typeof state?.raw === "string"
      ? state.raw
      : input.argsText;

  return {
    type: "tool-call",
    toolCallId,
    toolName: typeof part.tool === "string" ? part.tool : "unknown",
    args: input.args,
    argsText,
    ...(status === "completed" ? { result: state?.output } : {}),
    ...(status === "error"
      ? { result: state?.error, isError: true }
      : {}),
  };
}
```

必须保证：

- `pending/running` 不带 `result`；
- `completed` 才带 `output`；
- `error` 带 `result=error` 和 `isError=true`；
- `args` 永远是 JSON object；
- partial/raw input 只进入 `argsText`，不覆盖 object input；
- tool name 保留后端原值，alias 在 renderer registry 中处理。

### result metadata

示例为了渲染 edit/write diff，会把 completed ToolState metadata
包装成：

```ts
{ output: state.output, metadata: state.metadata }
```

见 `openCodeMessageProjection.ts` 92–101 行。

Multica 有两个选择：

1. 标准 `result` 保持原始 output，renderer 从 Tool bridge 读取
   `providerState.metadata`；
2. 对所有 tool 统一使用 `{ output, metadata }` envelope，并让
   fallback、bash 和 question renderer 都统一解包。

推荐第一种。它不会改变普通工具的公开 result shape，也不需要把
provider metadata 混入 `args`。

## Tool 状态语义

assistant-ui renderer 收到的 `status` 不是 OpenCode ToolState.status
的直接拷贝。

assistant-ui 先根据整个 assistant message 计算 `running`、
`incomplete`、`requires-action` 或 `complete`，再根据 tool part 是否
存在 truthy `result` 推导 ToolPart status。当前实现仍使用
`if (!part.result)`，因此 `""`、`0`、`false`、`null` 会被视为没有
result。证据见 assistant-ui
`packages/core/src/runtime/api/message-runtime.ts` 39–57 行。

renderer 的判断优先级应是：

```ts
if (isError) return "error";
if (providerState.status === "completed") return "completed";
if (status.type === "requires-action") return "requires-action";
if (status.type === "incomplete") return "cancelled-or-incomplete";
return "running";
```

其中 `providerState` 来自 Tool bridge。这样空字符串 output
也能稳定显示为 completed。

状态展示规则：

| Provider 状态 | assistant-ui 投影 | UI |
| --- | --- | --- |
| `pending` | 无 result | spinner，显示已形成的参数摘要 |
| `running` | 无 result | spinner，可显示 progress |
| `completed` | result=output | check，允许展开结果 |
| `error` | result=error + isError | destructive error，不依赖 incomplete |
| message cancelled | 无 result + incomplete/cancelled | muted/cancelled |
| pending interaction | message requires-action | warning + action UI |

自定义 fallback 必须优先读取 `isError`。不能原样使用一个只根据
`status.type === "incomplete"` 判断错误的通用 fallback。

## assistant-ui renderer 注册

### 不使用示例的 `externalTool()`

示例的 `components/tools/toolkit.tsx` 是 `"use generative"` 文件，
使用：

```ts
{ execute: externalTool(), render: ReadTool }
```

它依赖 assistant-ui build compiler 在构建时移除
`externalTool()`。该函数的第一方源码明确声明“没有运行时实现”，
直接执行会抛错。

Multica 当前没有接入该编译器，所以应使用 plain toolkit：

```tsx
import { defineToolkit } from "@assistant-ui/react";

export const conversationToolToolkit = defineToolkit({
  read: { type: "backend", render: ReadTool },
  edit: { type: "backend", render: EditTool },
  write: { type: "backend", render: WriteTool },
  bash: { type: "backend", render: BashTool },
  grep: { type: "backend", render: GrepTool },
  glob: { type: "backend", render: GlobTool },
  webSearch: { type: "backend", render: WebSearchTool },
  webFetch: { type: "backend", render: WebFetchTool },
  apply_patch: { type: "backend", render: ApplyPatchTool },
  question: { type: "backend", render: QuestionTool },
  ask_question: { type: "backend", render: QuestionTool },
  request_user_input: { type: "backend", render: QuestionTool },
  requestUserInput: { type: "backend", render: QuestionTool },
});
```

这些 entry 只注册 UI。没有 `execute`，工具仍由 cloud proxy 执行。

### Provider 接线

在 `ConversationRuntimeProvider` 中创建带 tools resource 的
assistant client：

```tsx
const aui = useAui({
  tools: Tools({ toolkit: conversationToolToolkit }),
});

return (
  <ConversationToolBridgeProvider value={toolBridge}>
    <AssistantRuntimeProvider aui={aui} runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  </ConversationToolBridgeProvider>
);
```

toolkit 必须在 module scope 创建，避免每次 render 重建 registry。

也可以通过 `MessagePrimitive.Parts components.tools.by_name` 直接传
renderer，但如果同时使用 toolkit 和手工 mapping，会产生两份
toolName registry。长期方案只保留 toolkit。

### GroupedParts

当前 `SessionMessage` 使用 `MessagePrimitive.Parts`。为了复刻示例的
reasoning/tool stack，应改成：

```tsx
<MessagePrimitive.GroupedParts
  groupBy={groupPartByType({
    reasoning: ["group-chain-of-thought", "group-reasoning"],
    "tool-call": ["group-chain-of-thought", "group-tool"],
  })}
>
  {({ part, children }) => {
    switch (part.type) {
      case "group-chain-of-thought":
        return <div data-slot="chain-of-thought">{children}</div>;
      case "group-reasoning":
        return <ReasoningGroup group={part}>{children}</ReasoningGroup>;
      case "group-tool":
        return <ToolGroup group={part}>{children}</ToolGroup>;
      case "text":
        return <MarkdownPart />;
      case "reasoning":
        return <ReasoningPart {...part} />;
      case "tool-call":
        return part.toolUI ?? <FallbackTool {...part} />;
      case "data":
        return <ConversationDataPart {...part} />;
      case "indicator":
        return null;
      default:
        return null;
    }
  }}
</MessagePrimitive.GroupedParts>
```

`GroupedParts` 使用 `toolCallId` 作为 tool leaf identity。保持
`callID` 稳定后，SSE 的 pending -> running -> completed 更新会原位
更新同一个 renderer，不会追加新卡片或丢失折叠状态。

## UI 复刻范围

目标是复刻视觉和交互边界，不是逐文件复制所有 OpenCode 耦合。

### 可直接迁移后适配 import/i18n 的部分

| 来源组件 | Multica 目标 | 说明 |
| --- | --- | --- |
| `tool-ui-shared.tsx` | 同名 | status icon、truncate、path helpers、action slot |
| `tool-group.tsx` | 同名 | 连续 tool 与相邻 text 的间距 |
| `reasoning-ghost.tsx` | 同名 | reasoning/tool grouping |
| `tool-ui-inline.tsx` | 同名 | read/grep/glob/web/fallback 的一行摘要 |
| `tool-ui-bash.tsx` | 同名 | terminal output、copy、exit code |
| `opencode-tools.tsx` | `conversation-tools.tsx` | HOC 包装后的 renderer exports |

import 需要统一替换：

- `@/lib/utils` -> `@multica/ui/lib/utils`；
- `@/components/ui/*` -> `@multica/ui/components/ui/*`；
- 示例 `useI18n` -> Multica `useT("chat")`；
- 示例私有 tooltip/button -> Multica UI primitives；
- 所有用户可见文本进入 `packages/views/locales/*/chat.json`。

### 需要重构后迁移的部分

#### Edit / Write / Apply Patch

示例依赖：

- `@pierre/diffs`；
- OpenCode `SnapshotFileDiff`；
- runtime extras 的 `getDiff/revertFile`；
- result 中注入的 `__openCodeMessageId` 等字段。

Multica 实现前没有 `@pierre/diffs` 依赖，本次已在 workspace catalog
和 `@multica/views` 增加。VSCode `openFile/openDiff` 属于示例宿主
能力，不是 cloud proxy runtime 的协议能力，本次明确不实现，也不
引入 host adapter。

推荐：

1. 在 pnpm catalog 和 `@multica/views` 中增加 `@pierre/diffs`；
2. 在 `tools/diff` 内定义 Multica 自己的最小
   `ConversationFileDiff`，不要从 `@assistant-ui/react-opencode`
   import 类型；
3. 从 Tool bridge 的 provider metadata 或现有 `state.diff`
   生成 diff；
4. 只显示路径和内嵌 diff，不提供打开文件或打开 diff 动作；
5. 第一版不实现 revert/undo。

不要为了 diff 再创建一个 cloud proxy client。当前 runtime 已经加载
`conversation.diff`，需要刷新时复用现有 controller。

#### Permission / Question

以下组件依赖 OpenCode runtime extras，不能只改 import：

- `opencode-tool-interactions.tsx`；
- `opencode-permission-card.tsx`；
- `opencode-question-card.tsx`。

应改成消费 Multica Tool bridge：

```ts
type ConversationToolBridge = {
  toolsByCallId: ReadonlyMap<string, ConversationToolEntry>;
  respondToPermission(
    requestId: string,
    decision: "once" | "always" | "reject",
  ): Promise<void>;
  replyToQuestion(requestId: string, answers: readonly unknown[]): Promise<void>;
  rejectQuestion(requestId: string): Promise<void>;
};
```

bridge 只是 Query state 和 controller action 的 React plumbing：

- 不复制 `permissions/questions`；
- 不自行订阅 SSE；
- 不把响应写入 assistant-ui `addResult`；
- action 成功后可以先 dispatch 本地 resolved action，再由 SSE/REST
  对账；如果第一版不做 optimistic update，按钮必须保持 submitting
  状态直到事件到达；
- question 缺少 tool metadata 时，可沿用示例的 normalized payload
  fallback，但需要单独测试。

#### Bash

可以复刻 terminal UI 和 clipboard fallback，但要修复示例的一个
边界：provider `isError` 必须优先于 exit code。否则没有 exit code
的 ToolState error 可能显示成成功。

#### Apply Patch

可以复刻 patch parser 和视觉，但 `ApplyPatchDiff` 也必须消费
`isError`，不能在 ToolState error 时继续显示完成 check。

### 第一版不建议复刻

- subtask dialog 中再次加载 child conversation；
- `task/todowrite/patch` 转成特殊 data part 的第二条投影路径；
- auto accept permission；
- disabled 的 revert/undo；
- OpenCode workbench 的第二个 SDK client；
- `"use generative"` toolkit；
- 任何 VSCode-only bridge。

`todowrite`、tasks 和 diff 已在 Multica canonical state 中保存。后续
若需要专用 data renderer，应单独设计，避免与标准 tool-call
renderer 混在第一阶段。

## Tool bridge

### 为什么需要 bridge

标准 assistant-ui ToolCall props 只有：

- `toolCallId`；
- `toolName`；
- `args/argsText`；
- `result/isError`；
- assistant-ui 推导的 `status`；
- human/frontend tool 的 result/approval methods。

它不包含 OpenCode 的：

- `part.id`、`messageID`；
- 原始 ToolState.status 和 metadata；
- progress；
- permission/question record；
- Multica controller actions。

这些扩展不能混进业务 args。推荐在
`ConversationRuntimeProvider` 内从当前 Query state 派生
`toolsByCallId`，并通过 React Context 暴露。

### 数据索引

索引过程：

1. 遍历 `messageOrder`；
2. 遍历每条 message 的 tool parts；
3. 取 `callID ?? part.id` 作为 bridge key；
4. 关联 `partProgress[callID]`；
5. 关联 `toolProgress[callID]`，必要时回退 part ID；
6. 根据 interaction 的 `tool.callID` 关联 permission/question；
7. 保留原始 part/state 引用，不深拷贝。

bridge value 使用 `useMemo`，依赖 Query state 和稳定 action closures。
它不成为新的 server-state source。

### Context 边界

`SessionRuntimeStateProvider` 目前只提供 loading/running/cancelling/error。
不建议把所有协议状态塞进该 context。新增独立的
`ConversationToolBridgeProvider`，职责仅限 tool extension plumbing。

这符合仓库规则：

- TanStack Query 继续拥有 server state；
- 没有新增 Zustand store；
- `packages/core` 不依赖 React 或 UI；
- `packages/views` 只消费 core state 和 actions；
- web 与 desktop 共享同一套 renderer。

## 实际目录

```text
packages/core/conversations/
  runtime/
    controller.ts                  # 保留：REST/SSE 与 interaction actions
    reducer.ts                     # 保留：ToolPart/interaction/progress state
    state.ts                       # 保留：canonical state
    select-conversation-tools.ts   # 可选：纯函数构建 tool side map

packages/views/common/session/
  session-message.tsx              # 改用 GroupedParts
  session-thread.tsx

  runtime/
    conversation-runtime-provider.tsx
    use-conversation-runtime.ts
    to-thread-message-like.ts
    project-tool-part.ts           # 从主投影拆出的纯 ToolPart converter
    conversation-tool-bridge.tsx   # Query state/controller -> renderer context

  tools/
    toolkit.tsx                    # 唯一 toolName -> renderer registry
    conversation-tools.tsx         # renderer + interaction decorator exports
    tool-groups.tsx
    tool-ui-shared.tsx
    tool-ui-inline.tsx
    tool-ui-bash.tsx
    tool-ui-apply-patch.tsx
    tool-interactions.tsx
    permission-card.tsx
    question-card.tsx
    tool-diff.tsx
```

命名使用通用的 `conversation` / `tool`，不把公共 UI 命名为
`issue-conversation` 或 `opencode-tools`。现有 `SessionMessage`、
`SessionThread` 可保留原名，因为它们描述 UI surface，而不是数据源。

### 包边界

- `packages/core/conversations`：
  - 可以保存 OpenCode/cloud proxy 协议类型和纯 selector；
  - 不得 import `@assistant-ui/react`、React 或 UI library。
- `packages/views/common/session/runtime`：
  - assistant-ui 投影；
  - runtime/provider 和 Tool bridge。
- `packages/views/common/session/tools`：
  - renderer、交互表单和 grouping；
  - 可以依赖 `@multica/core`、`@multica/ui` 和 assistant-ui。
- `packages/ui`：
  - 只保留通用原子组件；
  - 不加入 tool 名称、OpenCode 状态或 conversation 业务逻辑。

## 分阶段实现

### 阶段 1：稳定投影和 registry

1. 从 `to-thread-message-like.ts` 拆出 `project-tool-part.ts`。
2. 保持 `toolCallId = callID ?? part.id`。
3. 双 ID 缺失时降级 data part。
4. 仅在 terminal ToolState 上提供 result/isError。
5. 新建 plain backend toolkit。
6. `ConversationRuntimeProvider` 注册 `Tools({ toolkit })`。
7. `SessionMessage` 改成 `GroupedParts`。
8. 实现 `ToolCallFallback`、`ToolStatusIcon`、`ToolGroup`。

实现中已删除 `session-tool.tsx`，fallback 收敛到
`tools/tool-ui-inline.tsx`。

### 阶段 2：复刻常用工具

按代表性复杂度推进：

1. `read/grep/glob/webSearch/webFetch`；
2. `bash`；
3. `edit/write`；
4. `apply_patch`；
5. unknown/MCP fallback。

先覆盖摘要、terminal、diff 三类视觉，再补齐剩余 aliases。

### 阶段 3：Tool bridge 与 progress

1. 从 Query state 派生 `toolsByCallId`；
2. 暴露 provider state、metadata 和 progress；
3. running renderer 显示最近 progress；
4. terminal 状态清除临时 progress，继续以 result/history 为最终事实；
5. completed 空字符串专项处理。

### 阶段 4：Permission / Question

1. 实现 interaction decorator；
2. 迁移 permission card；
3. 迁移 question form；
4. controller actions 接线；
5. 防止重复 submit；
6. 处理 inline renderer 与 thread-level fallback 去重；
7. 测试 interaction 缺少 callID 时的 payload fallback。

### 阶段 5：内嵌 diff

1. 增加 `@pierre/diffs`；
2. 定义 Multica diff 类型和 parser；
3. 从 provider `metadata.filediff` 归一化 camelCase/snake_case；
4. 在 web/desktop 共用的 renderer 内展示，不接宿主文件动作。

## 测试策略

### Core reducer

在 `packages/core/conversations/runtime/reducer.test.ts` 覆盖：

- pending -> running -> completed；
- pending -> running -> error；
- 同 part ID 的重复 update 幂等；
- part ID 改变、callID 相同不产生第二个 part；
- part removed；
- snapshot 替换 stale part；
- progress append、截断和 terminal 清除；
- permission/question asked -> resolved；
- 非当前 conversation event 隔离。

### Projection

在 `project-tool-part.test.ts` /
`to-thread-message-like.test.ts` 覆盖：

- `callID` 优先，`part.id` fallback；
- 双 ID 缺失不生成固定 tool ID；
- pending raw -> argsText；
- object input -> args + argsText；
- pending/running 不带 result；
- completed 普通 result；
- completed 的 `""`、`0`、`false`、`null`；
- error -> result + `isError=true`；
- message running/complete/incomplete/requires-action；
- 连续 assistant message 合并后 toolCallId 不变。

### Registry 和 renderer

在 `packages/views/common/session/tools/*.test.tsx` 覆盖：

- 每个 canonical tool name；
- question 和 provider aliases；
- 未知 tool fallback；
- registered renderer 优先于 fallback；
- running/complete/error/cancelled/requires-action；
- `isError` 优先于 exit code/status；
- 空字符串 completed 不显示 spinner；
- 长 args/result/error 的折叠、滚动和 copy；
- patch parser；
- clipboard API 失败 fallback；
- keyboard、ARIA 和 reduced-motion。

### Bridge 和交互

- callID -> provider state/progress；
- part ID fallback；
- permission/question 与 tool 关联；
- submit loading/error；
- 重复点击只发送一次；
- optimistic resolved 和 SSE event 幂等；
- question payload fallback；
- inline claim 与 thread fallback 不重复；
- session 切换后无旧 interaction 泄漏。

### Runtime 集成

用测试本地 `ExternalStoreRuntime` 验证：

- 同一 callID 的 pending -> running -> completed 只保留一个 DOM renderer；
- 更新后折叠状态不丢失；
- toolkit renderer 能通过 `part.toolUI` 渲染；
- 未注册 tool 始终出现 fallback；
- GroupedParts 不跨 text/reasoning 改变顺序；
- observe/control mode 不影响只读 tool history。

## 已知缺口和风险

### 必须在实现前确认

1. **剩余 aliases**：已确认
   `read/glob/grep/askuserquestion/edit/bash/websearch/task`。两轮明确
   的 write/create 场景都归一为 `edit`，没有观察到独立 `write`
   tool name；还缺少 apply-patch 和 MCP 的生产样本，MCP 本轮按要求
   未触发。
2. **diff 的未来 contract**：当前部署只提供
   `edit.state.metadata.filediff`，即使 tracked Git diff 非空，
   `session.diff` 仍为空且 REST diff 返回 501。后续代理版本若补齐
   conversation diff，需要新增 fixture，而不是覆盖当前降级逻辑。
3. **tool.progress 的未来 contract**：Bash、WebSearch、Agent 均未
   产生该事件。当前只能保留可选兼容处理，无法验证 toolUseID 与
   parentToolUseID 的真实优先级。
4. **host file action**：web 是否只显示路径、desktop 是否支持打开
   workspace 文件，尚无产品 contract。
5. **prompt defaults**：确认 proxy 在只收到 `{ parts }` 时是否可靠
   补齐 session/message/part ID、agent 和 model；网页端真实请求显式
   传递了这些字段。

permission/question 的 wire shape 已捕获，不再是调研阻塞项；实现时仍
需为 schema 添加 malformed response 测试。

### 实现时必须防御

1. assistant-ui 对 falsy result 的 truthiness 判断；
2. ToolState error 主要依赖 `isError`，不能只看 status；
3. toolkit registry 对 tool name 是精确匹配，alias 必须集中维护；
4. unknown/MCP tool 必须进入 fallback；
5. `args/result/error` 只按文本或安全组件渲染，不注入未消毒 HTML；
6. URL 只通过现有安全 external-open 能力；
7. 长输出使用内部滚动，不截断底层数据；
8. running 动画遵循 reduced-motion；
9. 不创建第二个 SDK/cloud proxy client；
10. 不把 provider identity 写进用户可见 args。

## 验收标准

实现完成应满足：

- runtime/controller/SSE 架构不变；
- ToolPart 只投影成一个稳定 `tool-call`；
- `callID` 生命周期内 renderer identity 不变；
- read/edit/write/bash/grep/glob/web/fallback 视觉与
  `with-opencode/components/tools` 基本一致；
- error、cancelled、empty output 和 requires-action 状态准确；
- unknown tool 可见且不崩溃；
- permission/question 使用现有 proxy client 和 controller actions；
- web/desktop 共享同一套 renderer；
- `packages/core` 不增加 React/UI 依赖；
- 不使用 `externalTool()`、前端 execute 或 `addResult` 执行服务端 tool；
- projection、registry、renderer、bridge 和交互测试通过；
- `pnpm typecheck` 无 TypeScript 错误。

## 最终建议

第一轮实现应收敛在“稳定标准 tool-call + toolkit registry +
GroupedParts + 常用只读 renderer + 强健 fallback”。这一步不需要等待
permission/question 或 diff host 能力。

第二轮再接 Tool bridge、progress 和 HITL；第三轮处理内嵌 diff。
这样每一层都只依赖前一层的稳定 contract，也不会把
OpenCode 示例中的 SDK、VSCode 和 `"use generative"` 耦合带进
Multica。

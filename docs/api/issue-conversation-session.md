# Issue 页面会话接口文档

## 接口概述

用于 Issue 页面快速获取与某个 Issue 绑定的对话会话信息。通过该接口，前端可以直接拿到 `conversation_id`、`workspace_directory` 和设备代理前缀 `proxy_base_url`，从而复用现有 Workspace 的对话组件。

multica 后端负责保存 `issue_id → conversation_id` 的映射；cs-cloud 与本地设备不保存该映射状态。

---

## 接口信息

```http
GET /api/workspaces/{workspaceID}/issues/{issueID}/session
```

### 认证

需要携带用户的 multica 认证令牌：

```http
Authorization: Bearer <multica-jwt-or-pat>
```

### 路径参数

| 参数        | 类型   | 必填 | 说明                          |
|-------------|--------|------|-------------------------------|
| workspaceID | string | 是   | 工作区 UUID                   |
| issueID     | string | 是   | Issue UUID                    |

### 响应

#### 成功（200 OK）

```json
{
  "conversation_id": "conv_xxxxxxxx",
  "workspace_directory": "/Users/dev/project",
  "proxy_base_url": "/cloud-api/cloud/device/{deviceID}/proxy",
  "events_url": "/cloud-api/cloud/device/{deviceID}/proxy/api/v1/events?conversation_id=conv_xxxxxxxx",
  "questions_url": "/cloud-api/cloud/device/{deviceID}/proxy/api/v1/questions",
  "permissions_url": "/cloud-api/cloud/device/{deviceID}/proxy/api/v1/permissions"
}
```

| 字段                | 类型   | 说明                                            |
|---------------------|--------|-------------------------------------------------|
| conversation_id     | string | 该 Issue 对应的会话 ID                          |
| workspace_directory | string | 该 Issue 对应项目的本地绝对路径                 |
| proxy_base_url      | string | 设备代理前缀，所有 cs-cloud 对话 API 的 base URL（**推荐使用**） |
| events_url          | string | （已废弃，请用 proxy_base_url）Gateway 实时事件流地址（SSE）  |
| questions_url       | string | （已废弃，请用 proxy_base_url）Gateway 问卷地址     |
| permissions_url     | string | （已废弃，请用 proxy_base_url）Gateway 权限申请地址           |

> `proxy_base_url` 是相对路径，前端拼上同源 origin 即为完整 base URL。
> 所有对话相关 API 都是 `{proxy_base_url}/api/v1/...` 形式，例如
> `{proxy_base_url}/api/v1/conversations/{conversation_id}/prompt/async`。

#### 错误响应

| 状态码 | 场景                                       | 示例响应体                                      |
|--------|--------------------------------------------|-------------------------------------------------|
| 400    | Issue 没有关联项目，或项目未配置本地路径   | `{"error": "project local_directory not configured"}` |
| 404    | 工作区/Issue 不存在，或当前用户无权限      | `{"error": "workspace not found"}` / `{"error": "issue not found"}` |
| 503    | cs-cloud 设备不在线，或 Gateway 配置不可用 | `{"error": "cs-cloud device not online"}` / `{"error": "cloud runtime is not configured"}` |

---

## 调用流程

### 首次打开 Issue 页面

1. 前端调用 `GET /api/workspaces/{ws}/issues/{issue}/session`。
2. multica 发现没有该 Issue 的会话映射。
3. multica 根据 Issue 的 `project_id` 读取 `project.local_directory`。
4. multica 查找当前工作区在线的 cs-cloud 设备。
5. multica 通过 Gateway 同步调用 cs-cloud：

```http
POST /device/{deviceID}/proxy/api/v1/conversations
Headers:
  X-Workspace-Directory: /Users/dev/project
  Authorization: Bearer <user-token>
Body:
  {
    "agent": "csc",
    "workspace_directory": "/Users/dev/project",
    "initial_prompt": "Issue #123: 标题\n\n描述内容"
  }
```

6. cs-cloud 代理到 Agent 后端创建会话，返回 `{ "id": "conv_xxx" }`。
7. multica 保存 `issue_id → (conversation_id, workspace_directory, device_id)` 映射。
8. multica 返回给前端。

### 后续打开 Issue 页面

1. 前端调用同一接口。
2. multica 直接返回已保存的映射，不再调用 cs-cloud。

---

## 前端使用建议

### 1. 获取会话信息

```typescript
const res = await fetch(`/api/workspaces/${workspaceID}/issues/${issueID}/session`, {
  headers: { Authorization: `Bearer ${token}` },
});

if (!res.ok) {
  // 400: 项目未配置本地路径；503: 设备不在线
  handleError(res.status, await res.json());
  return;
}

const { conversation_id, workspace_directory, proxy_base_url } = await res.json();
```

### 2. 构造对话 client（推荐）

`proxy_base_url` 是设备代理前缀，拼上同源 origin 后即可作为对话 client 的
`baseUrl`。前端如有现成的 device client 封装（如 costrict-web 的
`createDeviceClient`），直接实例化即可获得全部对话方法，无需再拼接任何 URL：

```typescript
const client = createDeviceClient({
  baseUrl: new URL(proxy_base_url, location.origin).href,
  directory: workspace_directory, // transport 自动编码为 X-Workspace-Directory 头
});

// 发送消息（异步）
await client.conversation.promptAsync(conversation_id, {
  parts: [{ type: "text", text: "..." }],
});

// 停止生成
await client.conversation.abort(conversation_id);

// 加载历史
await client.conversation.messages(conversation_id, { limit: 50 });

// todo 列表 / 会话详情 / diff
await client.conversation.todo(conversation_id);
await client.conversation.get(conversation_id);
await client.conversation.diff(conversation_id);
```

### 3. 连接实时事件流

```typescript
// 通过 client 封装（内部即 GET {proxy_base_url}/api/v1/events）
const { stream } = await client.event.stream();

// 或手写 EventSource（鉴权只能依赖 Cookie，EventSource 无法自定义请求头）
const eventSource = new EventSource(`${proxy_base_url}/api/v1/events`, {
  withCredentials: true,
});
```

> 注意：
> 1. 事件流按 **workspace directory** 过滤，不按会话过滤——流里包含该目录下
>    所有会话的事件，前端必须按事件 payload 里的 `sessionID` 与
>    `conversation_id` 比对过滤。
> 2. `withCredentials: true` 在跨域场景下才会生效；如果前端与 Gateway 同源
>    （例如都走同一域名反向代理），浏览器不会额外发送预检请求，该参数无实际作用。

### 4. 回答问题 / 处理权限申请

对话过程中的问卷（question）和权限申请（permission）通过事件流推送，
payload 中带有 `requestID`，按其类型调用对应回复接口：

```typescript
await client.question.reply(requestID, { answers: [...] });
await client.question.reject(requestID);
await client.permission.respond(requestID, { behavior: "allow" });
```

### 5. 手写 fetch（不使用 client 封装时）

所有对话 API 都是 `{proxy_base_url}/api/v1/...` 形式，且**每个请求**都需要
携带 `X-Workspace-Directory` 头：

```typescript
await fetch(`${proxy_base_url}/api/v1/conversations/${conversation_id}/prompt/async`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "X-Workspace-Directory": encodeURIComponent(workspace_directory),
  },
  body: JSON.stringify({ parts: [{ type: "text", text: "..." }] }),
});
```

---

## 配置要求

### multica 侧

1. **项目本地路径**：在 `multica_project.local_directory` 中配置该 Issue 对应项目的本地绝对路径。
2. **Gateway 前缀**（可选）：通过环境变量 `MULTICA_CLOUD_GATEWAY_PROXY_PREFIX` 配置前端事件流 URL 前缀，默认为 `/cloud-api/cloud/device/%s/proxy`。

### cs-cloud 侧

cs-cloud 需要将其 Gateway `device_id` 注册到 multica 的 `agent_runtime` 表：

- `provider` = `cs-cloud`
- `daemon_id` 或 `metadata->>'device_id'` = Gateway device_id
- `status` = `online`

这样 multica 才能找到可用设备并发起 Gateway 调用。

---

## 变更范围

- 新增表：`multica_issue_conversation`
- `multica_project` 新增字段：`local_directory`
- 新增接口：`GET /api/workspaces/{workspaceID}/issues/{issueID}/session`
- `internal/cloudruntime` 增加 `Headers` 字段，支持透传自定义请求头

---

## 注意事项

- 该接口为同步创建：首次调用时会等待 cs-cloud 返回 conversation 后再响应，超时由 `CloudRuntime` 客户端控制。
- 如果设备在线但创建会话失败，接口返回 503，前端可提示用户重试。
- 该映射按 Issue 持久化；删除 Issue 时通过外键级联删除映射记录。

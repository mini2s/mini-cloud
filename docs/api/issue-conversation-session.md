# Issue 页面会话接口文档

## 接口概述

用于 Issue 页面快速获取与某个 Issue 绑定的对话会话信息。通过该接口，前端可以直接拿到 `conversation_id`、`workspace_directory`、Gateway 事件流地址、问卷地址以及权限申请地址，从而复用现有 Workspace 的对话组件。

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
  "events_url": "/cloud-api/cloud/device/{deviceID}/proxy/api/v1/events?conversation_id=conv_xxxxxxxx",
  "questions_url": "/cloud-api/cloud/device/{deviceID}/proxy/api/v1/questions",
  "permissions_url": "/cloud-api/cloud/device/{deviceID}/proxy/api/v1/permissions"
}
```

| 字段                | 类型   | 说明                                            |
|---------------------|--------|-------------------------------------------------|
| conversation_id     | string | 该 Issue 对应的会话 ID                          |
| workspace_directory | string | 该 Issue 对应项目的本地绝对路径                 |
| events_url          | string | 前端可直接连接的 Gateway 实时事件流地址（SSE）  |
| questions_url       | string | 对话过程中需要填写问卷时的 Gateway 问卷地址     |
| permissions_url     | string | 申请额外权限时的 Gateway 权限申请地址           |

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

const { conversation_id, workspace_directory, events_url, questions_url, permissions_url } = await res.json();
```

### 2. 连接实时事件流

```typescript
const eventSource = new EventSource(events_url, {
  withCredentials: true,
});

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // 渲染消息、状态变更等
};
```

### 3. 发送消息 / 加载历史

复用现有 Workspace 对话组件中的方法，只是基础路径从 Gateway 走：

```typescript
// 发送消息
await fetch(`/cloud-api/cloud/device/{deviceID}/proxy/api/v1/conversations/${conversation_id}/prompt`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "X-Workspace-Directory": workspace_directory,
  },
  body: JSON.stringify({ prompt: "..." }),
});

// 加载历史
await fetch(`/cloud-api/cloud/device/{deviceID}/proxy/api/v1/conversations/${conversation_id}/messages`, {
  headers: { Authorization: `Bearer ${token}` },
});
```

> 注意：`events_url` 已经包含了 `deviceID` 和 `conversation_id`，前端无需额外拼接。

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

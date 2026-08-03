# Workspace 会话迁移状态

> 更新时间：2026-08-03
> 当前范围：仅 Web。外部 CoStrict 服务端、设备端和 Desktop 不在当前仓库中实现。

## 当前结论

当前项目已经具备可复用的单会话运行时、设备代理客户端和共享会话 UI。本次新增了 Web 端“我的会话”基本框架，并按原项目的数据模型接入外部 CoStrict Workspace、Device 和 WorkspaceDirectory。

必须保持以下身份链，不能用 Multica 的 AgentRuntime 替代 Device：

```text
当前 Multica 页面
  -> 外部 CoStrict Workspace
  -> 外部 CoStrict Device
  -> 外部 CoStrict WorkspaceDirectory
  -> /cloud/device/{deviceId}/proxy
  -> CSC Conversation / Message / Part
```

Multica workspace 只负责当前页面路由与权限上下文。CoStrict Workspace、Device、Directory 和 Conversation 仍由外部服务负责，当前仓库没有复制服务端表或持久化逻辑。

## 本次已完成

### 1. 原项目设备概念

- 新增独立的 `CostrictDevice`、`CostrictWorkspace`、`CostrictWorkspaceDirectory` 类型和 zod 响应边界。
- 通过外部接口分别读取：
  - `GET /costrict-api/api/devices`
  - `GET /costrict-api/api/workspaces`
- Workspace 使用设备记录 ID 或 `deviceUniqueId` 与 Device 关联。
- 会话来源保留 `workspaceId`、`deviceRecordId`、`deviceId`、设备状态和目录路径。
- 默认 Workspace、默认目录优先展示；离线设备仍可见，但不会发起会话请求。
- `clusterAPIURL` 存在时沿用原项目的设备归属集群地址；否则使用当前 Web 的 CoStrict 代理。
- 跨集群请求从 `zgsmAdminToken` 补充 Bearer 认证，保持原设备 transport 的认证行为。
- 设备来源不再读取或推导 Multica `AgentRuntime`。

### 2. Web 前端代理

为避免和当前项目自己的 `/api`、`/cloud-api` 路由冲突，增加浏览器侧隔离前缀 `/costrict-api`。上游由运行时环境变量 `COSTRICT_API_URL` 配置，当前默认指向已部署的 `https://zgsm.sangfor.com`；本地部署可覆盖此变量。`COSTRICT_CLOUD_API_PREFIX` 默认使用当前网关的 `/cloud-api/api`，兼容旧服务时可改为 `/cloud-api`。

映射与原 Vite 前端代理一致：

| Web 请求 | CoStrict 上游请求 |
|---|---|
| `/costrict-api/api/*` | `/cloud-api/api/*`，前缀可配置 |
| `/costrict-api/api/v2/*` | `/cloud-dashboard/v2/*` |
| `/costrict-api/cloud/*` | `/cloud-api/api/*`，前缀可配置 |
| `/costrict-api/cloud/device/*` | `/cloud-api/cloud/device/*`（公网网关）；内部 cloud target 可配置为 `/cloud/device/*` |

浏览器请求继续携带当前登录 Cookie。这个代理只加入 `apps/web/proxy.ts`，Desktop 暂未接入。

### 3. “我的会话”基本框架

- Web `/[workspaceSlug]/sessions` 已从占位页切换为共享 `SessionsPage`。
- 页面结构已对齐原项目的 Workspace 页面：Workspace 栏、工具/会话栏和标签式内容区。
- Workspace 卡片展示当前/其他分组、设备在线状态、设备名称和默认目录；中小屏使用 Workspace 下拉切换。
- Workspace 列表保持外部接口顺序，不过滤 inactive/archived；运行中分组只包含用户实际打开的 Workspace。
- 卡片状态以 Workspace 响应的 `deviceStatus` 为准，并展示默认目录完整路径和默认 Workspace 标记。
- 会话按“今天 / 本周 / 更早”分组，并展示运行中状态，支持内联重命名、删除确认和关闭当前标签。
- 页面支持设备/目录选择、根会话列表、更新时间排序、新建会话和打开会话。
- 空白内容区可以直接输入第一条消息，同时创建会话并发送。
- `source` 与 `session` 写入 URL，刷新后可恢复选择。
- 已覆盖设备/Workspace 加载、无设备、设备离线、空列表和请求失败状态。
- 选中在线设备及会话后，复用已有 `ConversationRuntimeProvider` 与 `Session` UI。

### 4. 设备代理会话客户端

现有 cloud proxy 客户端已支持会话详情、消息、状态、异步 prompt、中断、Todo、task、权限、问题和 SSE。本次补充 Workspace 列表页需要的能力：

- `GET /api/v1/conversations`
- `POST /api/v1/conversations`
- `PATCH /api/v1/conversations/{id}`
- `DELETE /api/v1/conversations/{id}`

Query key 包含 `proxyBaseUrl + workspaceDirectory + conversationId`，不同设备与目录不会共用会话缓存。

### 5. 共享会话 UI

- 消息线程和输入框位于 `packages/views/common/session`，Web 直接复用。
- 已支持文本、reasoning、工具调用、Bash、Apply Patch、Permission、Question、发送、停止、失败重试和滚动定位。
- `ConversationRuntimeProvider` 现在允许宿主注入 transport，使 CoStrict 设备请求可以直接使用 Web 代理或绝对集群地址。

## 已有但尚未挂入产品入口

- Issue 会话 source 已有 descriptor、schema 与 Query 契约，但尚未挂入 Issue 详情页。
- 会话客户端已有 rename/delete 方法，但“我的会话”页面目前只接入 create。
- 单会话 SSE 已支持断线后的快照校正，但还没有事件序号和 `Last-Event-ID` 精确续传。

## 尚未迁移

- CoStrict Workspace、Device、Directory 的创建、编辑、删除、默认项和排序 UI。
- 设备注册、令牌轮换、版本更新、跨集群失败后刷新 `clusterAPIURL` 并重试。
- 会话 rename、delete、fork、revert、unrevert、归档、搜索和游标分页。
- Agent、Model、Variant、Command、Favorites、Prompt 草稿、历史输入和附件恢复。
- VCS 状态、文件树、文件预览、Diff、Terminal、内容 tabs 和 worktree 创建。
- 未读状态、后台完成通知、busy/retry 倒计时和跨 Workspace 汇总。
- WebSocket 特有代理升级验证、Quota Manager 代理和本地开发 Cookie 注入。
- Desktop、VSCode WebView、JetBrains JCEF 和 IDE Host Bridge。

## 与当前项目 Runtime 和旧 Chat 的边界

`AgentRuntime` 是 Multica 当前任务/代理执行域中的运行时，不是原 CoStrict Device。本次 Workspace 会话来源不会查询 `packages/core/runtimes`，也不会从 runtime metadata 拼出设备。

`packages/core/chat` 的 `ChatSession/ChatMessage` 是“Multica chat -> task queue -> daemon”链路，也不等同于 CSC 的 `Session/Message/Part`。“我的会话”直接消费外部设备代理协议，当前没有双写或自动转换。

## 建议下一阶段

1. 补齐设备管理只读详情与跨集群失败重试，确认外部服务的正式 Workspace/Device 响应契约。
2. 接入会话重命名、删除、归档、fork，并为 mutation 增加乐观更新和失败回滚。
3. 增加会话列表、消息的游标分页与搜索。
4. 再迁移 Model/Agent/Command、附件、VCS、Diff/Todo 和 worktree。

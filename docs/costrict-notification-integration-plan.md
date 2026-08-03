# multica 通知接入 costrict-web 通道方案

> Status: Proposed
> Last updated: 2026-07-27

## 1. 背景与目标

multica 与 costrict-web 是两个独立产品，通过 HTTP + iframe 融合（见 costrict-web
`docs/proposals/lights-out-factory/MULTICA_COBUILD_PROPOSAL.md`："不合并两个产品，只打通底层基建"）。
两边各有一套互不感知的通知体系：

- **multica**：进程内 event bus → `notification_listeners.go` → `multica_inbox_item` 表 →
  WS `inbox:new` → 前端 inbox UI。纯站内信，无外部通道。
- **costrict-web**：设备事件 → Dispatcher（防抖/回查/AI 汇总）→ `NotificationService` →
  用户订阅的外部渠道（企微应用 / 企微群机器人 / webhook）。`system_notifications` 收件箱
  当前只有公告在写入，且无读取端点（无站内通知中心 UI）。

**目标**：multica 的 issue 状态变更通知在写站内信的同时，也能通过 costrict-web
的企微/webhook 渠道外发。

**约束**：

1. multica 原有站内信逻辑不变（收件人、偏好过滤、bubbling 等行为零改动）。
2. 尽量少的 costrict-web 改动：只新增一个薄端点，投递体系完全复用。
3. 低耦合：单向 HTTP + 共享密钥，无 ID 映射表、无消息队列、无双向调用。

**非目标**：

- 不把 multica 通知落进 costrict-web 的 `system_notifications` 表（该表当前无读者）。
- 不覆盖全部通知类型。v1 只做 `status_changed`（issue 状态变更），评论/@提及等
  留作后续迭代（机制相同，只是事件筛选条件不同）。

## 2. 总体架构

```
multica server                                    costrict-web
┌──────────────────────────────────┐             ┌───────────────────────────────┐
│ event bus (issue:updated)        │             │ POST /api/integrations/       │
│   ├─ notification_listeners      │             │      multica/events           │
│   │   (站内信, 不变)              │             │   ① HMAC-SHA256 校验           │
│   │                              │             │   ② event_id 幂等去重          │
│   └─ integration_listener (新增)  │   HTTPS     │   ③ 邮箱 → 本地用户反查        │
│        │ 提取 status_changed      │  +HMAC      │   ④ TriggerNotifications(     │
│        ▼                          │────────────▶│      "multica.issue.           │
│   ResolveRecipients (新增)        │  信封 JSON   │      status_changed")         │
│   @提及优先, 回退创建者            │             │        │                      │
│        │ 邮箱列表                  │             │        ▼ 现有体系, 零改动       │
│        ▼                          │             │ user_notification_channels    │
│   Notifier (新增)                 │             │  → 企微应用/群机器人/webhook   │
│   异步队列 + 重试 + 签名           │             │  → notification_logs          │
└──────────────────────────────────┘             └───────────────────────────────┘
```

关键决策：

- **挂钩点在 event bus，不在通知监听器内部**。`issue:updated` 事件由所有状态变更路径
  统一发布（手动修改、workflow 节点同步、run 完成、取消、拆分取消——见
  `fix/workflow-node-status-notifications`），新通道订阅 bus 即可自动覆盖全部路径，
  不触碰任何业务代码。
- **event bus 是同步派发的**，Notifier 的 `Enqueue` 只做非阻塞写 channel，绝不阻塞
  bus 调用方（HTTP handler）。投递在后台 worker goroutine 中完成。
- **邮箱是两边系统的身份公约数**。multica 侧解析出收件人邮箱列表放进信封，
  costrict-web 按邮箱反查本地用户，未匹配的静默跳过。不建 ID 映射表。

## 3. 收件人逻辑（本方案的行为变更点）

新通道的收件人不沿用站内信的订阅者表逻辑，规则为：

1. **收集 issue 内被 @ 的人**：解析 issue 描述 + 全部评论中的
   `mention://member/<user_id>`（复用 `util.ParseMentions`），取 member 类型的 user_id 集合。
2. **若集合非空** → 收件人 = 这些用户的邮箱。
3. **若集合为空**（没有 @ 任何人，或只 @ 了 agent / squad 等非人实体）→
   回退到 issue 创建者：`creator_type == "member"` 时取 `creator_id` 对应用户的邮箱；
   创建者是 agent 时无收件人，跳过本次外发。
4. **排除操作者**：actor 是 member 且在收件人集合中时剔除（自己改的状态不通知自己；
   workflow 驱动的变更 actor 为 system，不受影响）。
5. 最终收件人为空 → 跳过，记 debug 日志。

明确排除：

- `@all` 不展开（避免企微轰炸整个工作区）。
- `@squad` v1 不展开，squad 内成员如需接收请在 issue 中直接 @（后续可迭代支持）。

## 4. multica 侧改动

全部为新增代码，现有文件只有装配点的一行调用。

### 4.1 新包 `server/internal/integration/`

```go
// Notifier 把事件信封异步推送到外部集成端点。
type Notifier struct {
    endpoint   string       // MULTICA_INTEGRATION_ENDPOINT
    secret     string       // MULTICA_INTEGRATION_SECRET (HMAC-SHA256)
    queue      chan Envelope // 缓冲 1024
    httpClient *http.Client // 超时 5s
}

func (n *Notifier) Envelope... Enqueue(env Envelope)  // 非阻塞；满了丢弃 + Warn
func (n *Notifier) Run(ctx context.Context)           // 2 个 worker goroutine
```

投递：POST JSON，Header `X-Multica-Signature: sha256=<hmac>`，
失败（网络错误 / 5xx / 429）指数退避重试 3 次（1s/4s/16s），最终失败写 error 日志。
4xx（签名/格式问题）不重试。

### 4.2 收件人解析

```go
// RecipientStore 使解析逻辑可脱离 DB 单测。
type RecipientStore interface {
    ListCommentBodies(ctx context.Context, issueID string) ([]string, error)
    GetUserEmail(ctx context.Context, userID string) (string, error)
}

func ResolveRecipients(ctx context.Context, store RecipientStore,
    in ResolveInput) ([]string, error)
```

`ResolveInput` 含 issueID、description、creatorType、creatorID、actorID，
规则见 §3。真实适配器薄封装 `db.Queries`（`ListCommentsForIssue` + `GetUser`）。

### 4.3 装配点 `cmd/server/integration_listener.go`

与 `registerNotificationListeners` 并列，订阅 `protocol.EventIssueUpdated`：

- `payload["status_changed"] == true` 才处理；
- 从 `payload["issue"].(handler.IssueResponse)` 提取字段；
- 调 `ResolveRecipients` 得邮箱列表，为空则跳过；
- 组装 `Envelope` → `notifier.Enqueue`。

`main.go`：配置了 `MULTICA_INTEGRATION_ENDPOINT` + `MULTICA_INTEGRATION_SECRET`
才创建并启动 Notifier，否则整个通道不启用，零开销。

### 4.4 事件信封（v1 契约）

```json
{
  "version": 1,
  "event_id": "uuid",
  "type": "multica.issue.status_changed",
  "occurred_at": "2026-07-27T10:00:00Z",
  "workspace": { "id": "...", "name": "..." },
  "actor":     { "type": "member|agent|system", "name": "..." },
  "issue": {
    "id": "...", "identifier": "MUL-123", "title": "...",
    "prev_status": "in_progress", "status": "done",
    "url": "https://<multica-host>/<slug>/issues/MUL-123"
  },
  "recipients": ["user1@corp.com"]
}
```

costrict-web 对未知字段一律忽略；新增字段向后兼容。

## 5. costrict-web 侧改动（独立 PR，约 150 行）

1. **新端点** `POST /api/integrations/multica/events`
   （`server/internal/integration/multica_handler.go`）：
   - HMAC-SHA256 校验（环境变量 `MULTICA_INTEGRATION_SECRET`，与 multica 侧共享）；
   - 按 `event_id` 幂等去重（`notification_logs` 查重或小表记录）；
   - 按 `recipients` 邮箱反查 `users`，未匹配跳过；
   - 构造中文消息（如「MUL-123 已完成 · 操作者 xxx」+ issue 链接 markdown）；
   - 对每个匹配用户调 `notificationSvc.TriggerNotifications(userID,
     "multica.issue.status_changed", ...)`。
2. **注册事件类型**：`GetSupportedTriggerEvents()` 列表加
   `"multica.issue.status_changed"`，自动进入现有用户渠道订阅体系（用户可在
   渠道配置页自行勾选企微/webhook，multica 侧完全不需要知道渠道配置）。

### 路由兜底（v1 可选）

邮箱一个都匹配不上时，若管理员配置了默认系统渠道（`system_notification_channels`
中启用的企微群机器人），发群机器人兜底；未配置则丢弃。v1 也可先不做，仅记日志。

## 6. 可靠性与安全

| 关注点 | 设计 |
|---|---|
| bus 阻塞 | Enqueue 非阻塞写 channel；队列满丢弃 + Warn，绝不影响 issue 写路径 |
| 投递失败 | 指数退避重试 3 次；最终失败 error 日志（后续可接告警） |
| multica 故障外溢 | 无：外发全部在后台 worker，与请求路径隔离 |
| 重复投递 | `event_id`（uuid）幂等，costrict-web 端点去重 |
| 重放/伪造 | HMAC-SHA256 签名 Header，密钥走环境变量，不进库不进仓 |
| 契约演进 | 信封 `version` 字段；对端忽略未知字段 |
| costrict-web 不可用 | multica 侧仅日志，站内信不受影响（本方案的硬约束） |

## 7. 测试计划

multica 侧（TDD）：

1. `ResolveRecipients`（fake RecipientStore）：
   - 描述中有 member 提及 → 返回其邮箱；
   - 仅评论中有提及（描述无）→ 同样命中；
   - 只有 agent 提及 → 回退创建者邮箱；
   - 无任何提及 → 回退创建者邮箱；
   - 创建者是 agent 且无 member 提及 → 空；
   - actor 在集合中 → 被剔除；
   - 多个 member 提及 → 去重后全部返回。
2. `Notifier`（httptest.Server）：
   - 信封 JSON 与 HMAC 签名头正确；
   - 500 重试 3 次后放弃；400 不重试；
   - 队列满时 Enqueue 不阻塞、不 panic。

costrict-web 侧：

- 端点 HMAC 校验失败 401；合法请求触发 `TriggerNotifications`（mock service）；
- 邮箱无匹配用户时静默 200；
- 相同 `event_id` 重复投递只处理一次。

## 8. 实施顺序

1. 本方案文档（multica 仓 `docs/`）。
2. multica 侧：integration 包 + listener 装配 + 测试（一个 PR）。
3. costrict-web 侧：薄端点 + 事件类型注册（独立 PR，可并行）。
4. 部署：两边配置同一密钥；costrict-web 用户在渠道配置页订阅
   `multica.issue.status_changed` 事件。

## 9. 后续迭代（不在本期）

- 评论 / @提及 / 任务完成等更多通知类型外发（仅事件筛选条件不同）。
- `@squad` 展开为成员邮箱。
- multica iframe 内监听 `inbox:new` 经 postMessage 桥在 portal 顶层弹 toast
  （纯前端桥，零服务端改动）。

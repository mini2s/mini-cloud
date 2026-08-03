# 负责人变更收件箱通知 — 设计

日期：2026-08-03
分支：feat/settings-repo-integration

## 背景与问题

需求：当某个成员被指定为 / 被移除某个 issue 的**负责人（responsible）**时，往他的收件箱（inbox）发通知；并在「设置 → 通知」页加一个独立开关项控制它。

调查后发现这个功能**已经大部分实现，不是从零开始**：

1. `responsible_assigned` 这个 inbox type 已存在（前端枚举、i18n、渲染分支、preference 静默逻辑全部就位）。
2. 「设置 → 通知」页已有一个 `assignments` 开关，但它的语义把**负责人（responsible）**和**执行者（assignee）**混在一起（描述：「你被分配或取消分配某个任务时」）。
3. **创建 issue 时**指定负责人 → 已经会发 `responsible_assigned` 通知，有单测与 e2e 覆盖（`notification_listeners.go` 的 `issue:created` listener，约 546-589 行）。

**唯一的真实缺口**：**编辑 issue** 改/移除负责人时，**不发任何通知**。根因是 `UpdateIssue` 发出的 `issue:updated` 事件 payload 根本不带 responsible 变更信号——`notification_listeners.go` 的 `issue:updated` listener 里只有 `assigneeChanged` 分支，没有 responsible 对应分支。

附带问题：`assignments` 开关把 responsible 和 assignee 混在一起，用户无法单独屏蔽「负责人」通知。需求明确要求「负责人」作为独立通知项（且这是系列通知的第 1 种，后续还有别的类型各自独立）。

## 目标

1. 编辑 issue 时，**指定**新负责人 → 给新负责人发 `responsible_assigned` 通知（severity `action_required`）。
2. 编辑 issue 时，**移除**负责人（换成别人，或清空）→ 给原负责人发 `responsible_unassigned` 通知（severity `info`）。
3. 「设置 → 通知」页新增独立的**「负责人」**开关，与现有「执行者」开关分开；创建 + 编辑两种场景的 responsible 通知都统一归这个新开关控制。
4. 自己把自己设为 / 移除负责人时，**仍然给自己发通知**（与现有创建路径 `SelfResponsibleStillNotified` 行为一致，全链路统一）。
5. 不破坏现有 `assignee` 通知行为；现有 `assignments` 开关收窄为只控制 assignee。

## 现状关键事实

- issue 表负责人字段：`responsible_user_id UUID REFERENCES multica_user(id) ON DELETE SET NULL`（`server/migrations/152_issue_responsible_user.up.sql`）。**user-only，非 polymorphic**——负责人只能是 member（user），不会是 agent。因此通知 `recipient_type` 恒为 `"member"`。
- 另有 `assignee_type` + `assignee_id`（多态执行者，member/agent/squad/workflow），由 `AfterIssueAssigned` 处理——**与本次无关**，不要混淆。
- `UpdateIssue` sqlc query（`server/pkg/db/queries/issue.sql:102-121`）第 110 行 `responsible_user_id = sqlc.narg('responsible_user_id')` 是裸 `narg`（非 `COALESCE`）：显式传 NULL = 清空负责人，不传 = 保持原值。这是「移除负责人」的 SQL 基础。
- `UpdateIssue` handler（`server/internal/handler/issue.go:2194`）：
  - `:2197` `prevIssue := h.loadIssueForUser(...)` —— old responsible 来源。
  - `:2289-2307` 解析 `responsible_user_id`（区分「未传」vs「显式 null」）。
  - `:2451` `h.Queries.UpdateIssue(...)` 返回 new issue —— new responsible 来源。
  - `:2466` 只算了 `assigneeChanged`，**没算 `responsibleUserChanged`**。
  - `:2481-2500` `h.publish(protocol.EventIssueUpdated, ...)` payload 有 `assignee_changed` / `prev_assignee_*`，**没有** responsible 相关字段。
- 通知发送集中在 `server/cmd/server/notification_listeners.go`（不是 `internal/service/`）：
  - `:79-97` `notifTypeToGroup`：`responsible_assigned` → `assignments`（需迁出）；`unassigned` → `assignments`。
  - `:101-107` `isNotifMuted(prefs, notifType)`：按 type 查 group，`prefs[group]=="muted"` 即屏蔽。**未配置的 type 永远送达**。
  - `:111-144` `loadUserPrefs` 批量拉偏好。
  - `:388-393` `notifyDirect(...)`：发前对 member 收件人查 mute——**这是本次要复用的核心 helper**。
  - `:546-589` `issue:created` listener：create 时对 responsible 发 `responsible_assigned`（已工作）。
  - `:592-756` `issue:updated` listener：有 `assigneeChanged` 分支（`:608-663`），**无 responsible 分支**——本次要补。
- preference 表 `multica_notification_preference`（`server/migrations/064_notification_preference.up.sql`）：`preferences JSONB`，是 `map[string]string`，key=组名，value=`"all"`/`"muted"`，**默认 unset = `"all"`（默认开）**。组定义在 `server/internal/handler/notification_preference.go:20-29`，`assignments` 已在。
- 前端设置页 `packages/views/settings/components/notifications-tab.tsx`：
  - `:15-24` `INBOX_GROUP_KEYS` 数组（不含 system_notifications）。
  - `:67-87` 逐 key 渲染 `Switch`，`checked = preferences[key] !== "muted"`。
  - `:34-51` `handleToggle`：`"all"` 时删 key 保持 object 干净。
- 前端 inbox type `packages/core/types/inbox.ts:5-26`：`responsible_assigned` 已在；**无 `responsible_unassigned`**。
- 前端渲染 `packages/views/inbox/components/inbox-detail-label.tsx`：
  - `:13-38` `useTypeLabels()` 返回 type→文案 map。
  - `:48-131` `switch (item.type)`；`responsible_assigned` 当前是简化 stub（`:91-92`，只显示 label），不像 `issue_assigned`（`:77-82`）那样读 `details` 渲染操作者。
- i18n：`packages/views/locales/{en,zh-Hans}/inbox.json` 有 `responsible_assigned`；`settings.json` 有 `assignments` 项。
- 既有测试：`server/cmd/server/notification_listeners_test.go:191/248/286`（create 路径）；`e2e/notification-matrix.verify.spec.ts:94/120/153`。

## 设计

### 后端（Go）

#### B1. `UpdateIssue` 发出 responsible 变更信号

文件：`server/internal/handler/issue.go`（`UpdateIssue`，约 2194-2520 行）。

1. 在 `:2466` 附近（算 `assigneeChanged` 的同一处）新增：
   ```go
   responsibleUserChanged := !uuidEqual(prevIssue.ResponsibleUserID, issue.ResponsibleUserID)
   ```
   （`uuidEqual` 比较两个 `pgtype.UUID`，处理 Valid/零值；复用文件里已有的 uuid 比较工具，没有就加一个小 helper。）
2. 在 `:2481` 的 `h.publish(protocol.EventIssueUpdated, ...)` payload map 里追加两个 key（仿现有 `prev_assignee_type` / `prev_assignee_id`）：
   ```go
   "responsible_user_changed": responsibleUserChanged,
   "prev_responsible_user_id": uuidToPtr(prevIssue.ResponsibleUserID),
   ```
   new responsible 已在 `resp.ResponsibleUserID` 里（payload 已含 issue 快照）。

无行为变更：只是把变更信号塞进既有事件，listener 才能消费。

#### B2. `issue:updated` listener 消费 responsible 变更并发通知

文件：`server/cmd/server/notification_listeners.go`（`issue:updated` listener，约 592-756 行）。

在现有 `assigneeChanged` 分支旁新增 `responsibleUserChanged` 分支，复用 `notifyDirect`：

```go
if responsibleUserChanged {
    // 指定：新负责人非空 → 通知新负责人
    if issue.ResponsibleUserID != nil && *issue.ResponsibleUserID != "" {
        notifyDirect(ctx, queries, bus,
            "member", *issue.ResponsibleUserID,
            issue.WorkspaceID, e, issue.ID, issue.Status,
            "responsible_assigned", "action_required",
            issue.Title, "", detailsWithActor(e))
    }
    // 移除：原负责人存在且与新人不同 → 通知原负责人
    if prevResponsibleID != nil && *prevResponsibleID != "" &&
        !uuidEqualPtr(prevResponsibleID, issue.ResponsibleUserID) {
        notifyDirect(ctx, queries, bus,
            "member", *prevResponsibleID,
            issue.WorkspaceID, e, issue.ID, issue.Status,
            "responsible_unassigned", "info",
            issue.Title, "", detailsWithActor(e))
    }
}
```

要点：
- `prevResponsibleID` 从 event payload 的 `prev_responsible_user_id`（B1 加的）取。
- **自指不豁免**：不判断 `actor == recipient`，与 create 路径一致。
- preference 静默、batch 加载偏好都由 `notifyDirect` 内部走 `isNotifMuted` 自动处理（见 B3 的映射）。
- `detailsWithActor(e)`：从 event 的 `ActorType/ActorID` 构造 `details` JSON（供前端渲染「X 把你设为负责人」），格式对齐现有 `issue_assigned` 用的 `details.new_assignee_id` 风格——具体 key 在实现时对齐前端 F2 读取的字段。
- **create 路径（`:546-589`）逻辑不变**：仅因 B3 的 type→group 映射改动，自动归到新开关下。

#### B3. 新增 preference group `responsible_changes` 并迁移映射

文件：
- `server/internal/handler/notification_preference.go:20-29` `validNotifGroups`：加 `"responsible_changes": true`。
- `server/cmd/server/notification_listeners.go:79-97` `notifTypeToGroup`：
  - `"responsible_assigned"`: `"assignments"` → **改为** `"responsible_changes"`
  - 新增 `"responsible_unassigned": "responsible_changes"`

无需 DB migration：`preferences` 是自由 JSONB key，旧用户数据里若有 `assignments:"muted"`，其 responsible 通知从此改由 `responsible_changes` 控制——这正是「独立开关」的预期行为。

### 前端（TS）

#### F1. 设置页新增「负责人」开关 + 收窄 assignments 文案

文件：
- `packages/views/settings/components/notifications-tab.tsx:15-24` `INBOX_GROUP_KEYS`：在最前面加 `"responsible_changes"`（置于 `assignments` 前，因为「负责人」概念优先级更高）。
- `packages/core/types/notification-preference.ts` `NotificationGroupKey`：加 `"responsible_changes"`。
- i18n `packages/views/locales/{en,zh-Hans}/settings.json`：
  - 新增 `responsible_changes` 项：
    - zh：label `负责人`，description `你被指定或移除某个任务的负责人时`
    - en：label `Responsible`，description `When you're set as or removed as the responsible owner of an issue`
  - 收窄现有 `assignments` 文案，只讲执行者：
    - zh：label `执行者`，description `你被分配或取消分配为任务执行者时`
    - en：label `Assignee`，description `When you're assigned or unassigned as an executor of an issue`

`Switch` 渲染、`handleToggle`、optimistic mutation 全部复用，无需改逻辑。

#### F2. inbox type 新增 `responsible_unassigned` + 渲染

文件：
- `packages/core/types/inbox.ts:5-26` `InboxItemType`：加 `"responsible_unassigned"`。
- `packages/views/inbox/components/inbox-detail-label.tsx`：
  - `:13-38` `useTypeLabels()` 给两个 type 都配文案。
  - `:48-131` `switch`：把 `responsible_assigned` 的 stub（`:91-92`）扩成读 `details` 渲染操作者（对齐 `issue_assigned` 的 `:77-82` 写法，显示「{actor} 把你设为负责人」）；新增 `responsible_unassigned` 分支（显示「{actor} 移除了你的负责人」）。
- i18n `packages/views/locales/{en,zh-Hans}/inbox.json`：
  - `responsible_assigned` 已有（保持/微调）。
  - 新增 `responsible_unassigned`：zh `已移除负责人`，en `Responsible removed`。

### 数据流

**编辑指定负责人（A → B）**：
1. 前端 `PATCH /api/issues/:id` 带 `responsible_user_id: B`。
2. `UpdateIssue`（`issue.go:2194`）：`prevIssue.ResponsibleUserID = A`，写库后 `issue.ResponsibleUserID = B`，算出 `responsibleUserChanged = true`。
3. `h.publish(EventIssueUpdated, { ..., responsible_user_changed: true, prev_responsible_user_id: A })`。
4. `notification_listeners.go` `issue:updated` listener 进入 responsible 分支：
   - 新负责人 B 非空 → `notifyDirect("member", B, ..., "responsible_assigned", "action_required")` → 写 `inbox_item` + 发 `inbox:new` WS（按 `user:B` 私投）。
   - 原负责人 A 存在且 ≠ B → `notifyDirect("member", A, ..., "responsible_unassigned", "info")`。
5. 前端 `useRealtimeSync` 收到 `inbox:new` → invalidate `["inbox", wsId, "list"]` → refetch → 侧栏/标题/favicon/toast 更新。

**清空负责人（A → 无）**：同上，但 new 为空，只走「移除」分支通知 A。

## 边界与错误

- 负责人只能是 member（`responsible_user_id` user-only），`recipient_type` 恒 `"member"`；不会有 agent 收件人。
- 负责人未变（`responsibleUserChanged = false`）→ 不发任何通知，即使 issue 其它字段变了。
- 自指（自己设/移除自己）→ 仍通知自己，不豁免。
- preference 静默：mute `responsible_changes` → 创建 + 编辑的 responsible 通知全屏蔽；不再受 `assignments` 开关影响。
- 旧用户 `preferences.assignments:"muted"` 历史值：responsible 通知不再被它屏蔽（改由 `responsible_changes` 控制）。这是预期行为，无需数据迁移。
- `prev_responsible_user_id` 在 payload 里可能为 nil（create 后首次编辑 / 原本无负责人）→ listener 里 nil 检查，跳过移除通知。

## 测试

### Go（`server/cmd/server/notification_listeners_test.go`，仿 `:191` 既有模式）

- `TestNotification_IssueUpdated_ResponsibleAssigned`：编辑把负责人从无/A 设为 B → B 收 `responsible_assigned`（action_required）。
- `TestNotification_IssueUpdated_ResponsibleUnassigned_OnReassign`：A → B → A 收 `responsible_unassigned`（info），B 收 `responsible_assigned`。
- `TestNotification_IssueUpdated_ResponsibleUnassigned_OnClear`：A → 空 → A 收 `responsible_unassigned`。
- `TestNotification_IssueUpdated_ResponsibleUnchanged`：改其它字段，负责人不变 → 无 responsible 通知。
- `TestNotification_IssueUpdated_ResponsibleSelfStillNotified`：自己把自己设为负责人 → 仍收到通知。
- `TestNotification_IssueUpdated_ResponsibleMutedByResponsibleChanges`：mute `responsible_changes` → 不送达。
- 更新 create 路径既有 mute 测试（`:286` `AssignmentPreferencesMuteResponsibleAndAssignee`）：mute `responsible_changes` 才屏蔽 responsible，mute `assignments` 只屏蔽 assignee。

### TS（`packages/views/`）

- 设置页渲染 `responsible_changes` 开关；切换走既有 optimistic mutation。
- `InboxDetailLabel` 对 `responsible_assigned` / `responsible_unassigned` 渲染操作者名（mock `details` + actor）。

### E2E（`e2e/notification-matrix.verify.spec.ts`，仿 `:94`）

- 编辑 issue 换负责人 → 新负责人 inbox 出现 `responsible_assigned`，原负责人出现 `responsible_unassigned`。
- mute `responsible_changes` → 两边都不出现。

## 不在范围

- 不改 `issue_subscriber` 表 / subscriber 机制（运行时本就不驱动 inbox）。
- 不动 WS 多端实时同步（`inbox:read/archived` 等已有前缀兜底）。
- 不做邮件通知（那是 `workflow_role_notification` 独立轨道）。
- 不动 create 路径的发送逻辑（只改它的 type→group 映射归属）。
- 不重构 `inbox-detail-label.tsx` 其它 type 分支。

## 决策记录

- **开关粒度选「新增独立 `responsible_changes` group」而非「复用 `assignments`」**：用户明确要「负责人」作为独立通知项，且这是系列通知的第 1 种（后续每种各自独立开关）。复用会让 responsible/assignee 绑死，无法单独屏蔽。
- **创建 + 编辑都归新开关（迁移 type→group 映射）而非只迁编辑路径**：同一个「负责人」概念受两个开关控制会割裂、反直觉。统一归 `responsible_changes`，开关语义干净；代价是旧 `assignments:"muted"` 用户的 responsible 创建通知不再被屏蔽——但这正是「独立控制」的预期。
- **移除通知用新 type `responsible_unassigned` 而非复用 `unassigned`**：`unassigned` 已承载 assignee 移除语义，复用会让一个 type 表两种概念，前端渲染与 i18n 无法区分。多一个 type 成本极低，换语义干净。
- **自指不豁免**：与现有 create 路径 `SelfResponsibleStillNotified` 一致，全链路统一，测试简单；豁免需额外 `actor==recipient` 判断且与 create 行为分叉。
- **severity：指定 `action_required`、移除 `info`**：指定需当事人关注（对齐 create 路径）；移除是知会性信息，无需动作。

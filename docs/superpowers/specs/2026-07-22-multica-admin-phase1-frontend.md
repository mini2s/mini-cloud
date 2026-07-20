# Multica Admin — Phase 1 (Frontend-Only Pages) Spec

**Date:** 2026-07-22
**Status:** Pending Approval
**Predecessor:** `2026-07-21-multica-admin-ui-design.md` (Master Spec), Phase 0 complete (commit `ccbae749`)

## 概述

Phase 0 完成 apps/admin 地基 + 32 路由骨架(10 真 + 22 Coming Soon)后,本 phase 实施**所有"纯前端可做"页面**——即复用现有后端 + 现有 `@multica/{core,ui,views}` 资产即可完成、不需要任何后端改动的页面。

合并了原 Master Spec 规划的 Phase 1(Home/Sessions/Tasks/Reviews)与 Phase 2 部分(Backlog),原因:这些页面共享相同的数据源(issues / chat)和相似的复用模式,合并为一个 spec + plan 避免重复流程开销。

### 范围

| 页面 | 路由 | 来源 | 工作量 |
|---|---|---|---|
| **Home** | `/` | re-export `@multica/views/dashboard` 的 `DashboardPage` | 0.5 天 |
| **Sessions** | `/sessions` | 新写全屏布局,复用 `ChatMessageList` + `ChatInput` + chat queries/mutations | 1.5 天 |
| **Reviews** | `/reviews` | 新写,基于 `in_review` 状态 issues + `issuePullRequestsOptions` 聚合 | 1 天 |
| **Backlog** | `/projects/backlog` | 复用 `BoardView` + `BOARD_STATUSES`,filter 到 backlog-only 或全状态 | 1 天 |
| **Tasks** | `/tasks` | Phase 0 已完成(re-export `MyIssuesPage`) | 0 |

**合计约 4 天。**

### 不在本 phase 范围

- **Dispatch**:虽然可参考 autopilots trigger-config,但真 dispatch 需要新的规则存储模型,不算纯前端。推迟。
- **Wiki / Memory / Metrics / Admin / Me 中的多数页面**:后端无对应概念(已在 Master Spec §6 标注)。这些会在后续"后端就绪后"的 phase 处理。
- **Home 的"工作台 dashboard"设想**(今日待办 / 快捷入口 / 活动时间线):这些组件在后端无对应活动流 API,本 phase 用现成 dashboard 替代;master spec 设想的"工作台首页"推迟到后端就绪。

---

## §1 关键事实核查(本 spec 的基础)

写 spec 前已核查以下事实,实施时**不需要再质疑**:

### 1.1 Chat 资产完整

- `chatSessionsOptions(wsId)` — 拉所有 chat sessions(active + archived)
- `chatMessagesOptions(sessionId)` — 拉 session 的消息
- `pendingChatTaskOptions(sessionId)` — 拉 session 的进行中任务
- `useCreateChatSession` / `useDeleteChatSession` / `useUpdateChatSession` / `useMarkChatSessionRead` — 4 个 mutation hooks
- `<ChatMessageList messages pendingTask availability />` — 独立可复用组件
- `<ChatInput onSend onUploadFile onStop isRunning disabled noAgent agentName leftAdornment rightAdornment topSlot />` — 独立可复用组件
- `useChatStore` 持久化 `activeSessionId` / `selectedAgentId` / `inputDrafts`(localStorage,key 前缀 `multica:chat:`)
- `ChatInput` **依赖** `useChatStore` 的 `activeSessionId` 和 `selectedAgentId` — Sessions 页面必须在渲染 `ChatInput` 前 `setActiveSession(id)`,否则发送目标不确定

### 1.2 Reviews 数据源确认

- `IssueStatus` 包含 `"in_review"`(`packages/core/types/issue.ts`)
- `api.listIssuePullRequests(issueId)` → `{ pull_requests: GitHubPullRequest[] }`(GitHub)
- `api.listIssueMergeRequests(issueId)` → `{ merge_requests: GitlabMergeRequest[] }`(GitLab)
- `issuePullRequestsOptions(issueId)` / `issueMergeRequestsOptions(issueId)` 已封装
- `<PullRequestList />` 组件已存在,但接收 `issueId` + 内部自取数据,**面向 issue 详情嵌入**,不是跨 issue 聚合视图
- **没有"列出所有 PRs"的端点** — Reviews 页面需用 N+1 查询模式(先拉 in_review issues,再对每个并行拉 PRs,React Query 缓存)

### 1.3 Backlog 组件完整

- `<BoardView issues assigneeGroups visibleStatuses hiddenStatuses onMoveIssue ... />` 完整可复用
- `<BoardColumn group issueIds issueMap ... />` 单列组件
- `BOARD_STATUSES = ["backlog","todo","in_progress","in_review","done","blocked"]`(已排除 cancelled)
- `STATUS_CONFIG` 提供 label/iconColor/columnBg 等
- `<BoardCard>` 单卡组件(通过 BoardView 间接使用)
- 现有 `MyIssuesPage` 已经把 BoardView 跑起来,Sessions/Backlog 的 BoardView 配置可参考其接线方式

### 1.4 后端路由已确认存在

```
GET  /api/me                              — profile
GET  /api/workspaces/{ws}/issues          — 支持 status filter
GET  /api/issues/{id}/pull-requests       — GitHub PRs
GET  /api/issues/{id}/merge-requests      — GitLab MRs
GET  /api/chat/sessions                   — chat 列表
GET  /api/chat/sessions/{id}/messages     — chat 消息
GET  /api/dashboard/usage/daily           — Home dashboard
GET  /api/dashboard/usage/by-agent        — Home dashboard
```

### 1.5 后端**没有**的(本 phase 不依赖)

- `/me/quota`, `/me/devices`, `/me/notifications`(个人级)
- 跨 issue 的 `/pull-requests` 聚合端点
- `dispatch rules` 存储

---

## §2 Home — re-export DashboardPage

### 2.1 设计

`/` 路由的 page.tsx 改为 re-export `@multica/views/dashboard` 的 `DashboardPage`。该组件已经包含:

- 时间窗口选择器(1d/7d/30d/90d/180d + daily/weekly 维度)
- 4 个 KPI 卡(daily cost/tokens/time/tasks)
- 多个图表(daily/weekly cost/tokens/time/tasks 折线/柱状)
- by-agent 表格(每位 agent 的 token/cost/time/tasks)
- 项目过滤

完全满足 "Home 应该是 dashboard" 的核心需求。

### 2.2 改动

**唯一改动**:`apps/admin/app/[workspaceSlug]/(dashboard)/page.tsx`

```tsx
"use client";

import { DashboardPage } from "@multica/views/dashboard";

export default function HomePage() {
  return <DashboardPage />;
}
```

(原来是 `<ComingSoon module="home" ... />`,替换掉)

### 2.3 不做的事

- **不**新建"工作台首页"组件(今日待办 + 快捷入口 + 活动时间线) — 这些需要新的后端 API(activity stream)和新的 UI 组件,超出本 phase 范围。
- **不**改 sidebar 的 Home label(`首页 / Home` 仍然合适,dashboard 也是首页的一种形态)。

---

## §3 Sessions — 全屏 chat 布局

### 3.1 设计

左侧 sessions 列表(280px 固定宽)+ 右侧消息流(自适应宽)。完全替代 FAB 形态,但**复用** chat 组件不重写。

```
┌────────────┬────────────────────────────────────┐
│ Sessions   │ [session title]      [rename][🗑]  │  ← 顶部工具栏
│ ─────────  ├────────────────────────────────────┤
│ [+ New]    │                                    │
│            │   ChatMessageList                  │  ← 消息流(滚动)
│ • sess-A   │   (复用 @multica/views/chat)       │
│ • sess-B * │                                    │
│ • sess-C   │                                    │
│            ├────────────────────────────────────┤
│            │   ChatInput                        │  ← 输入框
└────────────┴────────────────────────────────────┘
```

### 3.2 状态管理

**核心约束**:`ChatInput` 内部从 `useChatStore` 读 `activeSessionId` 和 `selectedAgentId`。Sessions 页面必须在切换 session 时调用 `setActiveSession(id)`,让 ChatInput 自动跟随。

**当前选中 session 的来源**:
- **方案 A(推荐)**:URL sub-route `/sessions/[id]` — 可分享、可刷新、与 Next.js 习惯一致
- ~~方案 B:URL query `?session=id`~~ — 不符合 Next.js file-based 路由习惯

选方案 A。`/sessions` 显示"未选中"占位(或重定向到第一个 session);`/sessions/[id]` 显示对应 session。

### 3.3 文件结构

```
apps/admin/components/sessions/
├── sessions-page.tsx          # /sessions 的容器(列表 + 右侧占位 or Outlet)
├── sessions-list.tsx          # 左侧列表
├── session-detail.tsx         # 右侧消息流(包括 header + ChatMessageList + ChatInput)
└── session-empty.tsx          # 未选中 session 的占位
```

```
apps/admin/app/[workspaceSlug]/(dashboard)/sessions/
├── page.tsx                   # /sessions — 渲染 <SessionsPage> (含 <SessionsList> + empty)
└── [id]/page.tsx              # /sessions/[id] — 渲染 <SessionsPage> + <SessionDetail id={id}>
```

### 3.4 关键交互

- **点击左侧 session** → `router.push(`/sessions/${id}`)`
- **+ 新建** → `useCreateChatSession().mutate({ title: null })` → 成功后 push 到新 session
- **重命名** → 顶部 header 的 edit 按钮 → inline input → `useUpdateChatSession`
- **删除** → 顶部 header 的 🗑 → 确认 → `useDeleteChatSession` → 删除后跳回 `/sessions`
- **发送消息** → `ChatInput.onSend(text, anchor)` → 调用现有发送逻辑(从 ChatWindow 抽取或直接调 api.sendChatMessage,见下)
- **切换 session** → `useChatStore.setActiveSession(id)`(让 ChatInput 跟随)

### 3.5 发送消息的具体接线(关键细节)

`ChatWindow` 的发送逻辑不在 ChatInput 里,而在 ChatWindow 自身。Sessions 页面需要复制这部分逻辑。**预期接线**(实施时验证):

```tsx
// 在 SessionDetail 内
const createTask = useCreateTask();  // or useSendChatMessage — verify actual name
const handleSend = useCallback((text: string, anchor?: ContextAnchor) => {
  if (!sessionId) return;
  // 1. 取 selectedAgentId from useChatStore
  // 2. createTask.mutate({ sessionId, message: text, agentId, anchor })
  // 3. invalidate chatKeys.messages(sessionId)
}, [sessionId]);
```

**实施时必须先 grep `packages/views/chat/components/chat-window.tsx` 的 `onSend` 接线**,把同样的逻辑搬到 Sessions 的 `SessionDetail`。如果发送涉及多个步骤(创建 task、attach anchor 等),完整复制 ChatWindow 的 onSend 实现,而不是猜测。

### 3.6 不做的事

- **不**重写 chat-store(已有的 `activeSessionId` / `selectedAgentId` / drafts 复用)
- **不**重写 ChatMessageList / ChatInput 的渲染逻辑
- **不**实现 ChatWindow 的 minimize/maximize/resize(FAB 形态独有,全屏页面不需要)
- **不**在 sessions 页面渲染 ChatFab / ChatWindow(那会导致双实例冲突)

### 3.7 dashboard layout 的 chat 冲突

apps/admin 的 `(dashboard)/layout.tsx` **不**渲染 `<ChatWindow>` / `<ChatFab>`(Phase 0 就没渲染)。所以 Sessions 页面自己渲染 chat 内容不会冲突。但 chat-store 是全局单例,Sessions 页面调用 `setActiveSession` 会影响其他页面(如果其他页面也读 chat-store)。本 phase 接受这个副作用。

---

## §4 Reviews — `in_review` issues + PRs 聚合

### 4.1 设计

显示当前工作空间所有 `in_review` 状态的 issues,**并行**对每个 issue 拉取其关联的 PRs/MRs(GitHub/GitLab 之一,取决于 workspace 的 code platform)。每个 issue 卡片显示其 PR 状态汇总(open/merged/closed 数量)+ 链接到 issue 详情。

```
┌────────────────────────────────────────────────┐
│ Reviews                         [GitHub|GitLab]│  ← 平台切换(自动)
├────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────┐   │
│ │ #123  Fix login redirect                 │   │
│ │ PR: ✓ merged  ✓ merged  ⚠ open           │   │  ← 该 issue 的 PR 状态
│ │ Updated 2h ago  • @assignee              │   │
│ └──────────────────────────────────────────┘   │
│ ┌──────────────────────────────────────────┐   │
│ │ #124  Add dark mode toggle               │   │
│ │ PR: ⚠ open (checks pending)              │   │
│ └──────────────────────────────────────────┘   │
└────────────────────────────────────────────────┘
```

### 4.2 数据流

1. `useQuery(issueListOptions({ status: "in_review" }))` → 拿到所有 in_review issues
2. 对每个 issue `useQuery(issuePullRequestsOptions(issue.id))` 或 `issueMergeRequestsOptions(issue.id)` (React Query 自动并行 + 缓存)
3. 按 workspace 的 `code_platform` 设置决定查 PR 还是 MR

### 4.3 文件结构

```
apps/admin/components/reviews/
├── reviews-page.tsx           # 主页面,管理 issue 列表 + PR 聚合
├── review-card.tsx            # 单个 issue + 其 PR 状态卡
└── use-reviews-data.ts        # hook: 封装 issue list + 并行 PR fetch + flatten
```

### 4.4 复用 vs 新写

**复用**:
- `issueListOptions` 或 `api.listIssues({ status: "in_review" })`
- `issuePullRequestsOptions(issueId)` / `issueMergeRequestsOptions(issueId)`
- `derivePullRequestStatusKind` / `derivePullRequestProgressSegments` (from `@multica/core/github`)
- `<ActorAvatar />` for assignee

**新写**:
- `reviews-page.tsx`(布局 + 数据协调)
- `review-card.tsx`(issue + PR 状态汇总)
- `use-reviews-data.ts`(并行 fetch 聚合 hook)

**不复用 `<PullRequestList />`** — 它面向单 issue 详情,接收 `issueId` 内部自取数据。Reviews 页面需要跨 issue 聚合视图,直接用底层 `issuePullRequestsOptions` 更灵活。

### 4.5 性能考虑

- N+1 查询模式(in_review issues × PR fetch)。React Query 缓存 + 并行执行,实测应该可接受
- 如果 in_review issues 超过 50 个,考虑分页 / 虚拟列表。本 phase 不做,加 TODO
- staleTime 用默认(不强制 Infinity),让用户刷新时拿到最新状态

### 4.6 点击行为

点击 ReviewCard → 跳转到该 issue 的详情页 `/{slug}/issues/{id}`(由现有 `IssueDetail` 提供)。

---

## §5 Backlog — BoardView 复用

### 5.1 设计

显示**所有未完成 issues** 的看板视图(不限 backlog 状态,而是 backlog/todo/in_progress/in_review/blocked 全部),按状态分列。用户可以拖拽 issue 在状态间移动。

```
┌──────┬──────┬───────────┬──────────┬────────┐
│Bklog │ Todo │ In Prog   │ In Review│ Done   │  ← 用 BOARD_STATUSES
│ ───  │ ───  │ ───       │ ───      │ ───    │
│ #301 │ #295 │ #280      │ #270     │ (hide) │
│ #302 │ #296 │ #281      │          │        │
│      │ #297 │           │          │        │
└──────┴──────┴───────────┴──────────┴────────┘
```

> **设计决策:** "Backlog 页面" 显示**所有未完成**状态而不是只 backlog 列。原因:
> - 只显示 backlog 列会让其他状态的 issue 无处可见
> - 用户在 backlog 想做的核心动作是"把 issue 推进到下一个状态",这需要看到所有列
> - 如果用户要纯 backlog 列,可以用 Tasks 页面(MyIssuesPage)filter 到 backlog

如果 master spec §6 Backlog 的原意确实只是"backlog 列",实施时改成单列 list view 即可,但本 spec 推荐全状态看板。

### 5.2 复用

完整复用 `BoardView` + `BOARD_STATUSES` + `STATUS_CONFIG` + `useUpdateIssue`(拖拽时改 status)。参考 `packages/views/my-issues/components/my-issues-page.tsx` 的 board 模式接线(它已经把 BoardView 跑起来过)。

### 5.3 与 MyIssuesPage 的差异

| 维度 | MyIssuesPage | Backlog |
|---|---|---|
| 数据范围 | 我被 assign 的 issues | **工作空间全部** issues |
| 默认视图 | list 或 board(用户选) | board(强制) |
| 状态 filter | 用户控制 | 全状态(可由用户隐藏列) |
| 分组 | 用户选 assignee/status | 默认 status 列 |

所以 Backlog **不复用 MyIssuesPage 组件**,但**复用 BoardView** + 接线模式。

### 5.4 文件结构

```
apps/admin/components/backlog/
└── backlog-page.tsx           # 主页面:拉所有 issues + 渲染 BoardView
```

(单文件即可,数据查询和 BoardView 接线不复杂)

### 5.5 改动

替换 `apps/admin/app/[workspaceSlug]/(dashboard)/projects/backlog/page.tsx` 的 Coming Soon 为:

```tsx
"use client";

import { BacklogPage } from "@/components/backlog/backlog-page";

export default function Page() {
  return <BacklogPage />;
}
```

### 5.6 数据规模保护

工作空间 issue 总数可能很大(几百到几千)。本 phase **不**做虚拟滚动,但用 `limit=200` 默认值;如果实际超过 200,后续 phase 加无限滚动或分页。在 `BacklogPage` 顶部显示 "Showing first 200 issues" 提示。

---

## §6 共享组件

本 phase **不**新建 `features/common/` 共享组件。Reviews/Backlog 各自的卡片都直接用 `@multica/ui` 原子和 `@multica/views` 现有组件。如果实施时发现明显复用机会(比如 ReviewCard 和 BoardCard 都需要 actor + status),由实施者临时抽出,不强求。

---

## §7 实施分期(本 phase 内部任务顺序)

按依赖与风险递增排序:

| Task | 内容 | 风险 |
|---|---|---|
| 1 | Home re-export(最简单,验证 DashboardPage 跑通) | 低 |
| 2 | Backlog(参考 MyIssuesPage 接线,BoardView 已知可用) | 中 |
| 3 | Reviews(N+1 数据流需要调试,但组件复用多) | 中 |
| 4 | Sessions(发送消息接线最复杂,需要从 ChatWindow 抽取逻辑) | 高 |

实施按 1→2→3→4 顺序。每个 task 走 subagent-driven-development:implementer → spec reviewer → code quality reviewer。

---

## §8 验收标准

### Home

- [ ] `/` 显示 DashboardPage,有时间窗口选择器、KPI 卡、图表、by-agent 表格
- [ ] 切换时间窗口,图表刷新
- [ ] 切换 project filter,数据更新
- [ ] 无 console error

### Sessions

- [ ] `/sessions` 显示左侧 sessions 列表(后端真实数据)
- [ ] `/sessions/[id]` 显示右侧对应 session 的消息流
- [ ] 点击左侧 session,URL 切换,右侧内容更新
- [ ] 新建 session 后自动选中
- [ ] 在 ChatInput 输入消息并发送,消息出现在 ChatMessageList
- [ ] 重命名 session 后,标题更新
- [ ] 删除 session 后,跳回 `/sessions`,列表更新
- [ ] 无 console error
- [ ] **关键**:切换 session 时,ChatInput 的 draft 跟随(因为 `setActiveSession` 被调用)

### Reviews

- [ ] `/reviews` 显示所有 `in_review` 状态 issues 的卡片
- [ ] 每张卡显示该 issue 关联的 PR/MR 状态汇总
- [ ] workspace 是 GitHub 时显示 PR;GitLab 时显示 MR
- [ ] 无 in_review issues 时显示空态
- [ ] 点击卡片跳转到 issue 详情
- [ ] 无 console error

### Backlog

- [ ] `/projects/backlog` 显示 BoardView,默认所有 `BOARD_STATUSES` 列
- [ ] 拖拽 issue 卡片到其他列,issue status 更新(刷新后保持)
- [ ] 显示 "Showing first N issues" 计数提示
- [ ] 无 console error

### 全局

- [ ] `pnpm --filter @multica/admin typecheck` 通过
- [ ] `pnpm --filter @multica/admin lint` 通过(允许 1 个预先存在的 warning)
- [ ] 在能访问 Google Fonts 的环境下,`pnpm --filter @multica/admin build` 通过(沙箱环境跳过)
- [ ] apps/web 回归:typecheck/lint 不受影响

---

## 附录 A:工作量明细

| 任务 | 写代码 | 测试调试 | 文档/审 review | 合计 |
|---|---|---|---|---|
| Home | 0.2 天 | 0.1 天 | 0.2 天 | 0.5 天 |
| Backlog | 0.5 天 | 0.3 天 | 0.2 天 | 1 天 |
| Reviews | 0.5 天 | 0.3 天 | 0.2 天 | 1 天 |
| Sessions | 0.7 天 | 0.5 天 | 0.3 天 | 1.5 天 |
| **合计** | **1.9 天** | **1.2 天** | **0.9 天** | **4 天** |

---

## 附录 B:已知风险与缓解

| 风险 | 缓解 |
|---|---|
| Sessions 发送消息接线复杂(ChatWindow 的 onSend 涉及多个 step) | 实施前先完整阅读 ChatWindow 的 onSend 实现,1:1 复制逻辑,不要重写 |
| Reviews N+1 查询慢 | React Query 并行 + 缓存;接受首次加载稍慢 |
| Backlog issue 数量大(>200) | limit=200 + 显示计数;后续加无限滚动 |
| `useChatStore` 全局单例,Sessions 切换 session 影响其他页面读 chat-store 的组件 | 本 phase 接受;Phase 0 dashboard layout 没渲染 ChatWindow,无冲突 |
| ChatInput 依赖的 `useChatStore.activeSessionId` 是 string|null,需要正确 setActiveSession | 在 SessionDetail 的 useEffect 里 `setActiveSession(id)` |

---

## 附录 C:本 phase 推迟的功能(明确不做)

- Home 的"工作台首页"(今日待办 + 活动时间线 + 快捷入口)— 等后端有 activity stream API
- Reviews 的 diff viewer(代码 diff 展示)— 现有 PR 数据无 diff 字段,需要后端扩展
- Backlog 的 WIP limit、column collapse、自定义列 — 后续小迭代
- Sessions 的搜索、pin、批量删除 — 后续小迭代
- Dispatch 完整功能 — 等后端规则存储模型

这些都在各自页面留 TODO 注释,不阻塞验收。

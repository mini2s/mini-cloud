# Multica Admin UI — Master Spec

**Date:** 2026-07-21
**Status:** Approved (Phase 0)
**Owner:** TBD
**Visual reference:** [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) v2.2.1

## 概述

为 Multica 设计一套全新的 Web Admin UI,覆盖产品规划的 8 个一级模块(首页、工作台、项目、协同、知识中心、效能度量、平台管理、个人中心)共 **32 个页面**(Home 1 + Workbench 3 + Projects 6 + Collaboration 3 + Repository 3 + Metrics 5 + Admin 6 + Me 5)。

本 spec 是 **Master Spec**:
- 覆盖"地基"决策——仓库位置、技术栈、复用策略、目录结构、视觉风格、32 页规格总览、实施分期
- 不深入任何单页的详细设计——那是后续每个 Phase 独立 spec 的工作
- Phase 0(地基)的实施直接由本 spec 驱动;Phase 1–7 各自走 brainstorm → spec → plan → 执行循环

## 顶层决策汇总

| 决策 | 选择 |
|---|---|
| 与 monorepo 关系 | **monorepo 新 app**——`apps/admin`,与 `apps/web` 共存 |
| 复用策略 | **最大化复用** `packages/{core, ui, views}`,零重写已有业务页面 |
| 技术栈 | **Next.js App Router**(与 apps/web 同构),`@base-ui/react` primitives |
| shadcn-admin 价值 | **参考视觉设计 + 布局范式**,不 Fork 代码;layout 用 @multica/ui 重写 |
| 数据来源 | **直接连现有后端**(`server/` + middleware.ts 代理),不 mock |
| Spec 策略 | **Master Spec + 后续按模块拆分** |
| 本次范围 | **32 页一次性规划**,分 Phase 实施 |
| URL 结构 | **扁平优先**——主要列表页一级 URL,Metrics/Admin/Me 用二级前缀 |
| Sidebar 组织 | **7 个 nav-group**(Home 单独一项),用 collapsible 分组 |

### 决策推导关键事实

本方案建立在以下对现有 monorepo 的事实核查之上:

- `@multica/ui` **已经有 58 个 shadcn 风格组件**(button/dialog/table/form/chart/command/data-table 等),基于 `@base-ui/react`(不是 Radix)
- `@multica/views` **已经实现了** 大部分业务页面:issues / projects / workflows / skills / members / agents / autopilots / inbox / dashboard / squads / runtimes / settings / chat / my-issues / editor / search / auth / invitations / invite / onboarding
- `apps/web` 已经有完整的后端代理(`middleware.ts` → `REMOTE_API_URL` 默认 `http://localhost:8080`)
- 因此:**Fork shadcn-admin 模板 = 把这些都重写一遍,与"复用"根本矛盾**

基于这些事实,shadcn-admin 的真正价值在于**视觉设计 + 布局范式**(collapsible sidebar、header、config-drawer、Cmd+K、主题切换),而不是代码本身。这些价值通过"用 @multica/ui 重写 layout 组件"即可获得,且零 primitives 冲突。

---

## §1 仓库位置与初始化

### 1.1 新 app 在现有 monorepo

```
multica-zgsm/
├── apps/
│   ├── web/          # 保留不动,与 admin 共存
│   ├── desktop/      # 保留不动
│   └── admin/        # ★ 新增 (本 spec 的产物)
├── packages/
│   ├── core/         # 复用,0 改动
│   ├── ui/           # 复用,0 改动
│   ├── views/        # 复用,0 改动
│   └── ...
└── server/           # 复用,直接连
```

### 1.2 初始化命令

```bash
mkdir -p apps/admin
# 参考 apps/web 的 package.json/next.config.ts/tsconfig 结构创建 apps/admin
# 关键依赖与 apps/web 对齐:next、react、@multica/{core,ui,views}
```

### 1.3 pnpm workspace 注册

`pnpm-workspace.yaml` 已经包含 `apps/*`,无需改动。新 app 自动被 monorepo 工具链识别。

### 1.4 端口分配

- `apps/web`: 现有端口(默认 3000)
- `apps/admin`: 新端口(建议 3100,通过 `FRONTEND_PORT=3100 pnpm dev --filter @multica/admin`)

### 1.5 开发命令

```bash
# 单独起 admin(连真实后端)
make server                          # 后端
FRONTEND_PORT=3100 pnpm dev --filter @multica/admin   # admin 前端

# 或加入 Makefile
make dev-admin                       # 等效快捷命令(本 spec 之外的可选优化)
```

---

## §2 技术栈(与 apps/web 对齐)

### 2.1 严格对齐 apps/web

本 spec **不引入新框架**。apps/admin 与 apps/web 用同一套技术栈,保证:

- 零学习成本(团队已经会)
- 共享工具链(eslint、tsconfig、turbo 配置)
- `@multica/{core, ui, views}` 直接 import,无 transpile 适配成本

| 层 | 选择 |
|---|---|
| 框架 | Next.js (App Router),版本与 apps/web 一致 |
| UI primitives | `@base-ui/react`(via `@multica/ui`) |
| 样式 | Tailwind(与 apps/web 版本一致) |
| 路由 | Next.js App Router(file-based) |
| 服务端状态 | TanStack Query |
| 客户端状态 | Zustand |
| 表单 | react-hook-form + zod(与现有代码一致) |
| 图标 | lucide-react |
| 图表 | recharts |
| 编辑器 | tiptap(Wiki 页用,@multica/views/editor 已有) |
| WebSocket | gorilla/websocket via 现有 core 层 |
| i18n | react-i18next(与现有一致) |

### 2.2 不引入的依赖

- ❌ Vite / TanStack Router(shadcn-admin 模板用的,与 Next.js 冲突)
- ❌ Radix UI(shadcn-admin 用的 primitives,与 @base-ui 冲突)
- ❌ msw / faker(直接连真实后端,不需要 mock)

---

## §3 复用清单(零改动)

### 3.1 从 `@multica/core` 复用

- 全部 API client(`api.issues.list()` 等)
- 全部 Zustand stores(auth/config/workspace 等)
- 全部 TypeScript 类型
- 全部 React Query keys / options / mutations
- 全部 hooks(useWorkspaceId、useFileUpload 等)

### 3.2 从 `@multica/ui` 复用

58 个 shadcn 风格组件,基于 @base-ui/react:

- 表单类:button、input、textarea、select、checkbox、radio-group、switch、slider、label、form、combobox
- 反馈类:dialog、alert-dialog、sheet、drawer、popover、tooltip、toast(sonner)、progress、skeleton
- 导航类:tabs、accordion、breadcrumb、pagination、command(cmdk)、menu
- 数据类:data-table、calendar、date-picker、carousel、chart
- 布局类:card、separator、scroll-area、resizable-panel、collapsible
- 其他:avatar、badge、alert、aspect-ratio、context-menu、hover-card

### 3.3 从 `@multica/views` 复用(对照 32 页规划)

| 规划模块 | 页面 | views 是否有 | 复用入口 |
|---|---|---|---|
| **Home** | `/` Home | 🟡 部分 | dashboard view 改造 |
| **Workbench** | Sessions | 🟡 基础 | `@multica/views/chat` |
| | Tasks | ✅ | `@multica/views/my-issues` |
| | Reviews | ❌ | 新写 |
| **Projects** | Overview | ✅ | `@multica/views/projects/components` → ProjectsPage |
| | Backlog | ❌ | 新写 |
| | Issues | ✅ | `@multica/views/issues/components` → IssuesPage |
| | Design | ❌ | 新写 |
| | Review | ❌ | 新写 |
| | Settings | 🟡 | 基础 form 新写 |
| **Collaboration** | Workflows | ✅ | `@multica/views/workflows/components` → WorkflowsPage、WorkflowDetailShell、WorkflowRunsPage、WorkflowRunPage、DAGCanvas |
| | Squads | ✅ | `@multica/views/squads` |
| | Dispatch | 🟡 | 参考 autopilots trigger-config |
| **Repository** | Wiki | ❌ | 新写(用 editor) |
| | Skills | ✅ | `@multica/views/skills` |
| | Memory | ❌ | 新写 |
| **Metrics** | Efficiency | 🟡 | 参考 dashboard 改造 |
| | Quality | ❌ | 新写 |
| | Cost | ✅ | `@multica/views/dashboard`(cost 部分)+ runtimes |
| | Coverage | ❌ | 新写 |
| | Contribution | 🟡 | dashboard by-agent 改造 |
| **Admin** | Members | ✅ | `@multica/views/members` |
| | Permissions | 🟡 | settings/workflow-admins-tab 参考 |
| | Devices | ❌ | 新写 |
| | Connectors | 🟡 | settings/github-tab、gitlab-tab 参考 |
| | Channels | ❌ | 新写 |
| | Quotas | ❌ | 新写 |
| **Me** | Profile | ✅ | `@multica/views/settings` → AccountTab |
| | Quota | ❌ | 新写 |
| | Notifications | 🟡 | settings/notifications-tab 改造 |
| | Devices | ❌ | 新写 |
| | Preferences | ✅ | `@multica/views/settings` → PreferencesTab + AppearanceTab |

**统计:**
- ✅ 直接复用:10 页
- 🟡 改造复用:9 页
- ❌ 新写:13 页

### 3.4 从 `apps/web` 模式复用(参考但不直接 import)

- `middleware.ts`(API 代理模式)→ 拷一份到 apps/admin
- `platform/navigation.tsx`(NavigationAdapter)→ 拷一份
- providers 链(QueryClient、Auth、Theme、i18n)→ 参考 apps/web/components/web-providers.tsx

---

## §4 apps/admin 目录结构

### 4.1 整体结构

```
apps/admin/
├── app/                              # Next.js App Router
│   ├── layout.tsx                    # 根 layout(providers 注入)
│   ├── providers.tsx                 # QueryClient / Auth / Theme / i18n
│   ├── globals.css                   # 全局样式(引入 @multica/ui tokens)
│   ├── page.tsx                      # / → 重定向到默认工作空间
│   │
│   ├── (auth)/                       # 公开路由
│   │   ├── login/page.tsx            # 复用 @multica/views/auth
│   │   ├── invite/[id]/page.tsx      # 复用 @multica/views/invite
│   │   └── invitations/page.tsx      # 复用 @multica/views/invitations
│   │
│   └── [workspaceSlug]/              # 工作空间作用域(沿用 apps/web 模式)
│       ├── layout.tsx                # workspace 解析 + 权限校验
│       ├── (dashboard)/
│       │   ├── layout.tsx            # ★ shadcn-admin 风格 layout(AppSidebar + Header)
│       │   ├── loading.tsx
│       │   │
│       │   ├── page.tsx              # / Home
│       │   │
│       │   ├── sessions/page.tsx     # Workbench
│       │   ├── tasks/page.tsx
│       │   ├── reviews/page.tsx
│       │   │
│       │   ├── projects/page.tsx     # Projects
│       │   ├── projects/backlog/page.tsx
│       │   ├── issues/page.tsx       # 复用 IssuesPage
│       │   ├── design/page.tsx
│       │   ├── review/page.tsx
│       │   ├── projects/settings/page.tsx
│       │   │
│       │   ├── workflows/page.tsx    # 复用 WorkflowsPage
│       │   ├── workflows/[id]/page.tsx
│       │   ├── squads/page.tsx       # 复用 SquadsPage
│       │   ├── dispatch/page.tsx
│       │   │
│       │   ├── wiki/page.tsx         # Repository
│       │   ├── skills/page.tsx       # 复用 SkillsPage
│       │   ├── memory/page.tsx
│       │   │
│       │   ├── metrics/efficiency/page.tsx
│       │   ├── metrics/quality/page.tsx
│       │   ├── metrics/cost/page.tsx
│       │   ├── metrics/coverage/page.tsx
│       │   ├── metrics/contribution/page.tsx
│       │   │
│       │   ├── admin/members/page.tsx      # Admin(共享 dashboard layout)
│       │   ├── admin/permissions/page.tsx
│       │   ├── admin/devices/page.tsx
│       │   ├── admin/connectors/page.tsx
│       │   ├── admin/channels/page.tsx
│       │   ├── admin/quotas/page.tsx
│       │   │
│       │   ├── me/profile/page.tsx         # Me(共享 dashboard layout)
│       │   ├── me/quota/page.tsx
│       │   ├── me/notifications/page.tsx
│       │   ├── me/devices/page.tsx
│       │   └── me/preferences/page.tsx
│
├── components/
│   └── layout/                       # ★ shadcn-admin 风格 layout 组件(新写)
│       ├── app-sidebar.tsx           # 7 nav-group collapsible
│       ├── sidebar-data.ts           # 导航配置(32 路由)
│       ├── nav-group.tsx
│       ├── nav-user.tsx
│       ├── team-switcher.tsx         # 工作空间切换
│       ├── header.tsx                # 顶部栏(search + theme + profile)
│       ├── config-drawer.tsx         # 右侧设置抽屉(主题/布局)
│       ├── command-menu.tsx          # Cmd+K(用 @multica/ui command)
│       ├── theme-switch.tsx
│       └── profile-dropdown.tsx
│
├── platform/
│   └── navigation.tsx                # Next.js NavigationAdapter(参考 apps/web)
│
├── middleware.ts                     # API 代理(参考 apps/web/proxy.ts)
├── next.config.ts                    # 与 apps/web 对齐
├── tsconfig.json
├── package.json
└── eslint.config.mjs
```

### 4.2 一个典型路由的写法(复用 views 的情况)

```tsx
// apps/admin/app/[workspaceSlug]/(dashboard)/issues/page.tsx
"use client";
import { IssuesPage } from "@multica/views/issues/components";
import { ErrorBoundary } from "@multica/ui/components/common/error-boundry";

export default function Page() {
  return (
    <ErrorBoundary>
      <IssuesPage />
    </ErrorBoundary>
  );
}
```

几乎全部是 1–5 行的 re-export,与 apps/web 现有模式完全一致。

### 4.3 一个典型路由的写法(Coming Soon)

```tsx
// apps/admin/app/[workspaceSlug]/(dashboard)/reviews/page.tsx
import { ComingSoon } from "@/components/layout/coming-soon";

export default function Page() {
  return <ComingSoon module="reviews" label="我的审查 / Reviews" />;
}
```

---

## §5 视觉风格(参考 shadcn-admin)

### 5.1 不 Fork 代码,参考视觉

shadcn-admin 的真正价值是**视觉设计 + 布局范式**。我们照着它的视觉用 @multica/ui 重新实现 layout,达到"看起来像 shadcn-admin"的效果。

### 5.2 视觉要素清单

| 要素 | shadcn-admin 风格 | 实现方式 |
|---|---|---|
| 左侧 sidebar | collapsible,分组折叠 | `@multica/ui` sidebar + collapsible,新写 app-sidebar |
| 分组导航 | 7 个 nav-group,可独立折叠 | nav-group.tsx(参考 shadcn-admin 视觉) |
| 顶部 header | sticky,含 search/theme/profile | header.tsx |
| 右侧 config-drawer | 主题/布局/密度切换 | config-drawer.tsx(用 sheet/drawer) |
| Cmd+K 命令面板 | 全局快速跳转 | command-menu.tsx(用 @multica/ui command) |
| 明暗主题 | 默认暗色,可切换 | next-themes(已用) |
| 主色切换 | 多种 primary 色 | CSS 变量切换 |
| 4 种布局变体 | sidebar 左/右、可折叠、toggled | layout-provider 模式 |
| 密度切换 | 紧凑/舒适 | 通过 CSS class |

### 5.3 主题与颜色

- 完全沿用 `@multica/ui/styles/tokens.css` 的 HSL 变量
- 默认主题与 apps/web 保持一致(明/暗)
- 可选:在 admin 内增加 config-drawer 允许用户切换主色/密度(Phase 0 不做)

### 5.4 字体与 i18n

- 字体:与 apps/web 一致(已有中文 fallback)
- i18n:**复用 `@multica/views/locales/`**(zh-Hans、en 已有)
- 新增模块的文案(Reviews/Wiki/Memory 等)在各自 Phase 的 spec 里新增 locale 文件

### 5.5 业务 Token

沿用 multica 现有约定(avatar、badge、status icon 等),不另起炉灶。新增约定:

| 类别 | 约定 |
|---|---|
| 模块色 | Workbench=蓝、Projects=紫、Collaboration=青、Repository=橙、Metrics=绿、Admin=红、Me=灰 |

---

## §6 数据来源(直接连真实后端)

### 6.1 不需要 mock

`apps/admin` 直接复用 `apps/web` 的 API 代理模式:

```ts
// apps/admin/middleware.ts(参考 apps/web/proxy.ts)
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const proxyPrefixes = ["/api/", "/auth/", "/uploads/"];
const proxyExact = ["/ws"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const shouldProxy =
    proxyPrefixes.some((p) => pathname.startsWith(p)) ||
    proxyExact.includes(pathname);
  if (!shouldProxy) return NextResponse.next();

  const remoteApiUrl = process.env.REMOTE_API_URL || "http://localhost:8080";
  const url = new URL(pathname + request.nextUrl.search, remoteApiUrl);
  return NextResponse.rewrite(url);
}
```

### 6.2 启动流程

```bash
make server                                       # 后端 :8080
FRONTEND_PORT=3100 pnpm dev --filter @multica/admin  # admin :3100
```

浏览器访问 `http://localhost:3100`,所有数据都是真实的。

### 6.3 如果后端没起来

可以临时加 mock(不在本 spec 范围)。但默认策略是连真实后端,这样 Phase 1+ 才能看到真实数据流。

---

## §7 32 页规格总览

每页 1–2 句概括。详细 UI 设计放在各自 Phase 的 spec。

### 🏠 首页 / Home

| 路由 | 页面 | 规格 | 来源 |
|---|---|---|---|
| `/` | Home | 工作台 dashboard:今日待办、任务统计、近期活动时间线、快捷入口 | 🟡 dashboard 改造 |

### 💼 工作台 / Workbench

| 路由 | 页面 | 规格 | 来源 |
|---|---|---|---|
| `/sessions` | Sessions | 与 agent 对话会话列表 + 消息流 | 🟡 views/chat |
| `/tasks` | Tasks | 我的任务 DataTable,筛选/drawer 编辑 | ✅ views/my-issues |
| `/reviews` | Reviews | 待我审查的 PR/变更列表 | ❌ 新写 |

### 📁 项目 / Projects

| 路由 | 页面 | 规格 | 来源 |
|---|---|---|---|
| `/projects` | Overview | 项目 KPI + 列表 | ✅ views/projects |
| `/projects/backlog` | Backlog | 看板视图,拖拽 | ❌ 新写 |
| `/issues` | Issues | 需求 DataTable + 详情 drawer | ✅ views/issues |
| `/design` | Design | 设计稿网格 | ❌ 新写 |
| `/review` | Review | PR-style 列表 | ❌ 新写 |
| `/projects/settings` | Settings | 项目元信息 form | ❌ 新写 |

### 🤝 协同 / Collaboration

| 路由 | 页面 | 规格 | 来源 |
|---|---|---|---|
| `/workflows` | Workflows | 列表 + DAG 详情 + 运行历史 | ✅ views/workflows |
| `/squads` | Squads | 团队卡片网格 | ✅ views/squads |
| `/dispatch` | Dispatch | 任务委派规则列表 | 🟡 参考 autopilots |

### 📚 知识中心 / Repository

| 路由 | 页面 | 规格 | 来源 |
|---|---|---|---|
| `/wiki` | Wiki | 文档树 + markdown 编辑器(tiptap) | ❌ 新写(用 views/editor) |
| `/skills` | Skills | 技能卡片网格 | ✅ views/skills |
| `/memory` | Memory | agent 记忆时间线 | ❌ 新写 |

### 📊 效能度量 / Metrics

| 路由 | 页面 | 规格 | 来源 |
|---|---|---|---|
| `/metrics/efficiency` | Efficiency | 交付速率/周期/吞吐量 | 🟡 dashboard 改造 |
| `/metrics/quality` | Quality | bug 密度/review 通过率 | ❌ 新写 |
| `/metrics/cost` | Cost | token/费用/工时 | ✅ dashboard + runtimes |
| `/metrics/coverage` | Coverage | 覆盖率热力图 | ❌ 新写 |
| `/metrics/contribution` | Contribution | 贡献度排行 | 🟡 dashboard by-agent |

### ⚙️ 平台管理 / Admin

| 路由 | 页面 | 规格 | 来源 |
|---|---|---|---|
| `/admin/members` | Members | 成员 DataTable + 邀请 | ✅ views/members |
| `/admin/permissions` | Permissions | 角色 × 权限矩阵 | 🟡 workflow-admins-tab 参考 |
| `/admin/devices` | Devices | 设备列表 | ❌ 新写 |
| `/admin/connectors` | Connectors | 集成卡片网格 | 🟡 github-tab/gitlab-tab 参考 |
| `/admin/channels` | Channels | 通知渠道列表 | ❌ 新写 |
| `/admin/quotas` | Quotas | 配额策略 form | ❌ 新写 |

### 👤 个人中心 / Me

| 路由 | 页面 | 规格 | 来源 |
|---|---|---|---|
| `/me/profile` | Profile | 资料 form | ✅ settings/AccountTab |
| `/me/quota` | My Quota | 配额进度 + 趋势 | ❌ 新写 |
| `/me/notifications` | Notifications | 个人通知收件箱 | 🟡 notifications-tab 改造 |
| `/me/devices` | My Devices | 我的设备列表 | ❌ 新写 |
| `/me/preferences` | Preferences | 偏好(主题/显示/通知) | ✅ settings tabs |

---

## §8 实施分期

每个 phase 走完整 brainstorm → spec → plan → 执行循环。每个 phase 的复用度不同。

| Phase | 内容 | 页数 | 复用度 |
|---|---|---|---|
| **0** | **地基(本 Master Spec 覆盖)** | — | 90% |
| **1** | 工作台(Home + Sessions/Tasks/Reviews) | 4 | 70% |
| **2** | 项目(Overview/Backlog/Issues/Design/Review/Settings) | 6 | 60% |
| **3** | 协同(Workflows/Squads/Dispatch) | 3 | 80% |
| **4** | 知识中心(Wiki/Skills/Memory) | 3 | 40% |
| **5** | 效能度量(5 metrics) | 5 | 30% |
| **6** | 平台管理(6 admin) | 6 | 30% |
| **7** | 个人中心(5 me) | 5 | 60% |

**合计: 4 + 6 + 3 + 3 + 5 + 6 + 5 = 32 页**(Phase 1 含 Home)

### 后续每个 phase 的 spec 模板

1. 该 phase 涉及页面的**详细 UI 设计**(字段、交互、空/载/错态)
2. **复用清单**(具体从 views 的哪些组件复用,如何 props 适配)
3. **新写组件清单**(本 phase 独有的)
4. **数据模型**(如需新增后端字段,标注 backend dependency)
5. **组件拆分**(本 phase 内的目录结构)
6. **验收标准**(逐页面 checklist)

---

## §9 Master Spec 验收标准(仅 Phase 0 地基)

以下全部达成才算 Phase 0 完成:

- [ ] `apps/admin/` 目录创建,package.json 注册到 workspace
- [ ] `pnpm dev --filter @multica/admin`(端口 3100)起得来,无报错
- [ ] middleware.ts 代理工作,`make server` 起来后能登录(复用现有 auth 流程)
- [ ] Sidebar 显示 7 大模块 nav-group,中文 label,正确图标(仿 shadcn-admin 视觉)
- [ ] ~~Header 显示 search / theme-switch / profile-dropdown~~ → **推迟到 Phase 1**(Phase 0 的 sidebar footer 已含 user info;主题切换通过 next-themes 生效,只是没有可见 toggle;Header 与 Home 一起在 Phase 1 实现)
- [ ] 32 个路由全部可访问:
  - 复用类(10 页):真实数据渲染,与 apps/web 同样的功能
  - 改造类(9 页)和新写类(13 页):显示 Coming Soon 占位
- [ ] 暗色/明色主题切换正常
- [ ] `pnpm typecheck && pnpm lint && pnpm build --filter @multica/admin` 全部通过
- [ ] README(在 apps/admin/README.md)写清楚:这是 Multica Admin,Phase 0,后续 phases 见 specs 目录

**不在 Master Spec 验收范围内**: 任何新写/改造页面的实际功能(那些归各自 Phase 的 spec 验收)。

---

## 附录 A:Phase 0 工作量预估

| 任务 | 预估 |
|---|---|
| 创建 apps/admin 骨架(package.json/next.config/tsconfig) | 0.5 天 |
| providers + middleware.ts + globals.css | 0.5 天 |
| shadcn-admin 风格 layout 组件(sidebar/header/nav-group/config-drawer) | 1.5 天 |
| sidebar-data.ts(32 路由配置) | 0.5 天 |
| 32 个 page.tsx(复用类 re-export + Coming Soon 类占位) | 0.5 天 |
| 主题切换、暗色模式验证 | 0.5 天 |
| typecheck/lint/build 通过 + README | 0.5 天 |
| **合计** | **约 4.5 天** |

---

## 附录 B:决策记录(本 spec 推导过程中的关键选择)

| 决策 | 选择 | 备选 | 理由 |
|---|---|---|---|
| 与 monorepo 关系 | monorepo 新 app | 独立新仓库 / 原地改 apps/web | 复用最大化;与 apps/web 共存,零风险 |
| 技术栈 | Next.js + Base UI(对齐 apps/web) | Vite + TanStack Router + Radix(模板) | 零 primitives 冲突;零学习成本;零重写 |
| shadcn-admin 用法 | 参考视觉,不 Fork 代码 | Fork 整个仓库 | multica 已有 58 个 shadcn 风格组件 + 一半业务页面,Fork 等于全部重写 |
| Mock 方案 | 不 mock,连真实后端 | MSW + faker | 后端 server/ 已经在跑,直接连真实数据流更省事;Phase 1+ 才有意义 |
| Spec 策略 | Master + 后续拆分 | 一个大 spec | 32 页一次性塞进 spec 会失控;Master 当宪法 |
| URL 结构 | 扁平优先 | 严格层级 | 主列表页一级 URL 更短更含义化 |
| apps/web 去留 | 共存 | 立即替换 / 删除 | 共存零风险,admin 成熟后再考虑迁移 |

### 推导过程中的方向修正记录

本 spec 经历过一次重大方向修正:

1. **初版**(已废弃):基于"multica 没有现成 UI 资产"的错误前提,推荐 Fork shadcn-admin 独立新仓库,完全重写。提交于 `ec6e69d8`(分支 `new-ui-demo`)。
2. **用户反馈**: "我不想自己重新实现一套" —— 意识到 Fork 等于重写已有页面。
3. **事实核查**: 发现 `@multica/ui` 已有 58 个 shadcn 风格组件,`@multica/views` 已实现大部分业务页面。
4. **方向重定**: 改为 monorepo 新 app + 复用 core/ui/views + 参考 shadcn-admin 视觉重写 layout。
5. **本版**(当前): 即上述修订。

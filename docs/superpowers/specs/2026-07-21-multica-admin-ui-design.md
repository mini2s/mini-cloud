# Multica Admin UI — Master Spec

**Date:** 2026-07-21
**Status:** Approved (Phase 0)
**Owner:** TBD
**Template source:** [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) (v2.2.1)

## 概述

为 Multica 设计一套全新的 Web Admin UI,覆盖产品规划的 8 个一级模块(首页、工作台、项目、协同、知识中心、效能度量、平台管理、个人中心)共 **32 个页面**(Home 1 + Workbench 3 + Projects 6 + Collaboration 3 + Repository 3 + Metrics 5 + Admin 6 + Me 5)。

本 spec 是 **Master Spec**:
- 覆盖"地基"决策——仓库、技术栈、目录结构、设计系统、Mock 层、共享组件、25 页规格总览、实施分期。
- 不深入任何单页的详细设计——那是后续每个 Phase 独立 spec 的工作。
- Phase 0(地基)的实施直接由本 spec 驱动;Phase 1–7 各自走 brainstorm → spec → plan → 执行循环。

## 顶层决策汇总

| 决策 | 选择 |
|---|---|
| 与现有 multica-zgsm 的关系 | **完全独立新仓库**,不复用 monorepo 任何包 |
| 仓库位置 | `../multica-admin`(与 multica-zgsm 同级) |
| 模板用法 | **Fork 模式**——clone 整个 shadcn-admin 作为起点 |
| 技术栈 | **严格按模板**——Vite + React 19 + TanStack Router/Query/Table + Tailwind v4 + shadcn/ui (Radix) + Zustand + react-hook-form + zod + sonner |
| Spec 策略 | **Master Spec + 后续按模块拆分** |
| 本次范围 | **32 页一次性全做**,但分 Phase 实施 |
| Mock 策略 | **MSW + faker**,模拟完整 REST API 契约,可切换到真实后端 |
| URL 结构 | **扁平优先**——主要列表页一级 URL,Metrics/Admin/Me 用二级前缀 |
| Sidebar 组织 | **7 个 nav-group**,用模板 `nav-group.tsx` collapsible |

---

## §1 仓库与技术栈

### 1.1 仓库初始化

```bash
git clone https://github.com/satnaing/shadcn-admin.git ../multica-admin
cd ../multica-admin
rm -rf .git
git init
```

- 重置 git history,以 multica-admin 为全新仓库起点
- 与现有 `multica-zgsm` monorepo 完全解耦,**不复用** `packages/core`、`packages/ui`、`packages/views`

### 1.2 保留(零改动)

以下模板资产全部保留:

```
src/
├── components/
│   ├── layout/            # app-sidebar, header, nav-group, nav-user, team-switcher, top-nav
│   ├── ui/                # shadcn/ui 全套原子组件
│   ├── command-menu.tsx   # Cmd+K 全局命令面板
│   ├── config-drawer.tsx  # 右侧设置抽屉(主题/布局/方向/密度)
│   ├── confirm-dialog.tsx
│   ├── data-table/        # 通用 TanStack Table 封装
│   ├── date-picker.tsx
│   ├── profile-dropdown.tsx
│   ├── theme-switch.tsx
│   ├── sign-out-dialog.tsx
│   ├── search.tsx
│   ├── select-dropdown.tsx
│   ├── long-text.tsx
│   ├── navigation-progress.tsx
│   ├── password-input.tsx
│   ├── skip-to-main.tsx
│   ├── learn-more.tsx
│   └── coming-soon.tsx
├── context/               # theme/font/layout/direction/search providers
├── hooks/                 # use-dialog-state, use-mobile, use-table-url-state
├── stores/auth-store.ts
├── styles/{index,theme}.css
├── config/fonts.ts
├── tanstack-table.d.ts
├── main.tsx
├── routeTree.gen.ts
└── vite-env.d.ts

配置文件:components.json, eslint.config.js, tsconfig*, vite.config.ts,
        .prettierrc, knip.config.ts, index.html
```

### 1.3 删除

- `src/routes/clerk/` — Clerk 集成分支(改用模板自带的 email/password sign-in)
- `src/features/dashboard/` — 模板示例首页(替换为 Multica home)
- `src/features/apps/` — 模板示例
- `src/features/chats/` — 模板示例(替换为 Multica workbench/sessions)
- `src/features/users/` — 模板示例(替换为 Multica admin/members)
- `src/features/tasks/` — 模板示例(替换为 Multica workbench/tasks)
- `src/assets/clerk-*` — Clerk 品牌 logo
- `netlify.toml` — Netlify 部署配置(按需替换)
- `README.md`、`LICENSE`、`CHANGELOG.md`、`cz.yaml` — 替换为 Multica

### 1.4 新增依赖

```bash
pnpm add msw
pnpm add @faker-js/faker          # 从 devDeps 移到 deps
pnpm add i18next react-i18next    # 中英双语
pnpm add dayjs                    # 中文 locale 完善,比 date-fns 更轻
pnpm add @fontsource-variable/inter
```

> **关于 date-fns vs dayjs:** 模板已经依赖 date-fns。本 spec **不替换** date-fns,而是在新代码中优先使用 dayjs。两者共存不冲突。

### 1.5 环境变量

```bash
# .env
VITE_API_MODE=mock                # mock | real
VITE_API_BASE_URL=                # real 模式时填,例如 https://api.multica.ai
VITE_ENABLE_DEVTOOLS=true         # TanStack Router/Query devtools 开关
```

---

## §2 导航 IA 与路由表

### 2.1 Sidebar 结构(替换 `components/layout/data/sidebar-data.ts`)

7 个 nav-group,每个对应一个产品模块:

| 分组 | 默认状态 | 子项 |
|---|---|---|
| 🏠 首页 / Home | — | `/`(单独项,不分组) |
| 💼 工作台 / Workbench | 展开 | Sessions, Tasks, Reviews |
| 📁 项目 / Projects | 展开 | Overview, Backlog, Issues, Design, Review, Settings |
| 🤝 协同 / Collaboration | 展开 | Workflows, Squads, Dispatch |
| 📚 知识中心 / Repository | 展开 | Wiki, Skills, Memory |
| 📊 效能度量 / Metrics | 折叠 | Efficiency, Quality, Cost, Coverage, Contribution |
| ⚙️ 平台管理 / Admin | 折叠 | Members, Permissions, Devices, Connectors, Channels, Quotas |
| 👤 个人中心 / Me | 折叠 | Profile, My Quota, Notifications, My Devices, Preferences |

顶部保留模板的 **team-switcher**(改为 workspace/org 切换)、**command-menu**(Cmd+K)、**config-drawer**(主题/布局)。

### 2.2 路由表(TanStack Router file-based)

```
src/routes/
├── (auth)/                          # 公开路由,无 authenticated layout
│   ├── sign-in.tsx                  # /sign-in
│   ├── sign-up.tsx                  # /sign-up
│   ├── forgot-password.tsx          # /forgot-password
│   └── otp.tsx                      # /otp
├── (errors)/                        # 错误页
│   ├── 401.tsx  403.tsx  404.tsx  500.tsx  503.tsx
├── __root.tsx                       # 根 + Provider 链
└── _authenticated/                  # 受保护路由
    ├── route.tsx                    # 认证守卫 + AuthenticatedLayout
    ├── index.tsx                    # / (首页)
    │
    ├── sessions/  tasks/  reviews/                          # 工作台
    │
    ├── projects/                →  /projects (Overview)
    ├── projects/backlog/        →  /projects/backlog
    ├── issues/                  →  /issues
    ├── design/                  →  /design
    ├── review/                  →  /review
    ├── projects/settings/       →  /projects/settings
    │
    ├── workflows/  squads/  dispatch/                       # 协同
    │
    ├── wiki/  skills/  memory/                             # 知识中心
    │
    ├── metrics/efficiency/                                     # 效能度量
    ├── metrics/quality/
    ├── metrics/cost/
    ├── metrics/coverage/
    ├── metrics/contribution/
    │
    ├── admin/members/                                          # 平台管理
    ├── admin/permissions/
    ├── admin/devices/
    ├── admin/connectors/
    ├── admin/channels/
    ├── admin/quotas/
    │
    ├── me/profile/                                             # 个人中心
    ├── me/quota/
    ├── me/notifications/
    ├── me/devices/
    ├── me/preferences/
    │
    └── settings/                  # 复用模板自带 settings(作为 Me 的 backend)
```

### 2.3 关键约定

- **首屏 `/`**:工作台 dashboard,显示今日待办、任务统计、近期活动、快捷入口。
- **未实现页面**:统一用模板 `coming-soon.tsx` 占位,不报错。Phase 0 完成后 25 个路由都可访问但多数显示 Coming Soon。
- **扁平 URL**:主要列表页用一级 URL(`/issues`、`/workflows`、`/skills`),Metrics/Admin/Me 用二级前缀。
- **列表+详情同页**:用右侧 drawer 或 split view,**不**做 `/issues/123` 深路径,降低路由复杂度。后续如确有需要(如 wiki 文档)再开放深路径。
- **i18n 路径**:URL slug 用英文,显示文案中英双语。

---

## §3 设计系统

### 3.1 主题策略:100% 继承模板

shadcn-admin 已经调好完整的 HSL CSS 变量系统(`styles/theme.css`)、Tailwind v4 + tw-animate-css、明暗双主题、3 种主色(default/slate/zinc)、4 种布局变体、紧凑/舒适密度、RTL 支持。本 spec **不重写**这些。

### 3.2 品牌化替换

| 资产 | 操作 |
|---|---|
| `src/assets/logo.tsx` | 替换为 Multica logo(SVG) |
| `public/images/favicon.{png,svg}` | 替换为 Multica favicon |
| `index.html` 的 `<title>` | "Multica Admin" |
| sign-in 页左侧 brand panel | Multica 品牌 + slogan |
| `README.md`、`LICENSE` | 替换 |
| (可选)主题色 default | 改为 Multica 品牌色 |

### 3.3 字体

```ts
// src/config/fonts.ts
display: ['Inter Variable', 'PingFang SC', 'Microsoft YaHei', 'sans-serif']
sans:    ['Inter Variable', 'PingFang SC', 'Microsoft YaHei', 'sans-serif']
mono:    ['JetBrains Mono', 'Source Code Pro', 'monospace']
```

通过 `@fontsource-variable/inter` 加载 Inter,中文 fallback 到系统字体。

### 3.4 i18n

- 主语言 **zh-CN**(默认),副语言 en
- 用 `i18next + react-i18next`
- 文案文件按模块拆:`src/locales/zh-CN/{common,home,workbench,projects,collaboration,repository,metrics,admin,me,settings}.json`
- sidebar / header / DataTable 表头 / 表单 label 全部走 i18n
- 模板原生硬编码字符串(sign-in 文案、错误页文案等)抽到 i18n
- 语言切换器:加在 `config-drawer.tsx` 或 `profile-dropdown.tsx`

### 3.5 业务 Token 约定

沿用模板语义色,新增少量业务 token:

| 类别 | 约定 |
|---|---|
| 状态色 | success / warning / danger / info — 复用模板语义色 |
| 优先级 | P0(红) / P1(橙) / P2(黄) / P3(灰) — badge 变体 |
| 角色 | Agent(紫头像/标签) / Human(蓝头像/标签) |
| 模块色 | Workbench=蓝, Projects=紫, Collaboration=青, Repository=橙, Metrics=绿, Admin=红, Me=灰 — 用于 sidebar 图标 hover、page header accent |

---

## §4 Mock 数据层架构

### 4.1 核心原则

Mock 不是写死 JSON,而是**模拟一套完整的 REST API 契约**。前端代码只调用 `api.tasks.list()` 这类函数,不知道也不关心背后是 MSW 还是真实后端。切换到真实后端只需要改环境变量。

### 4.2 分层架构

```
┌─────────────────────────────────────────────────┐
│  React 组件 (features/*)                         │
│    useQuery(taskKeys.list, () => api.tasks.list())│
└──────────────────┬──────────────────────────────┘
                   │ TanStack Query
┌──────────────────▼──────────────────────────────┐
│  src/api/client.ts                              │  ← 统一 API 入口
│    api.tasks.list() / api.issues.create() ...   │
└──────────────────┬──────────────────────────────┘
                   │ axios
┌──────────────────▼──────────────────────────────┐
│  MSW (mock mode)  或  真实后端 (real mode)       │
│  VITE_API_MODE=mock | real                      │
└─────────────────────────────────────────────────┘
```

### 4.3 目录结构

```
src/
├── api/
│   ├── client.ts            # axios 实例 + 拦截器(auth token 等)
│   ├── tasks.ts             # api.tasks = { list, get, create, update, delete }
│   ├── issues.ts
│   ├── projects.ts
│   └── ... (每个业务模块一个文件)
├── mock/
│   ├── browser.ts           # MSW setupWorker(dev 时启动)
│   ├── handlers.ts          # 所有 handler 聚合
│   ├── db.ts                # 内存数据库(faker 种子 + CRUD)
│   ├── schema/              # 每个实体的 faker 生成器
│   │   ├── task.ts          # generateTask(overrides?)
│   │   ├── issue.ts
│   │   └── ...
│   └── handlers/
│       ├── tasks.ts         # http.get('/tasks', ...) 等
│       └── ...
└── main.tsx                 # 根据 VITE_API_MODE 启动 MSW
```

### 4.4 关键设计点

- **db.ts 是有状态的内存数据库**:Map 存储,启动时 faker 种子生成 50–200 条/实体,支持 CRUD(刷新前持久化),支持分页/筛选/排序的查询参数。
- **每个 handler 是完整 CRUD**:`GET /tasks`(分页/筛选/排序)、`GET /tasks/:id`、`POST`、`PATCH`、`DELETE`,模拟 200–500ms 随机延迟。
- **关联数据真实**:`task.projectId` 真实指向某个 project;`issue.assigneeId` 真实指向某个 member;时间字段用 dayjs 生成相对当前的真实分布。
- **auth mock**:任意邮箱+密码登录成功,返回 fake JWT,MSW 拦截 `/me` 返回当前用户。
- **WS mock(可选)**:后续若做实时通知,可加 mock-socket 模拟服务端推送。Phase 0 不做。

### 4.5 切换到真实后端

```bash
# .env.production
VITE_API_MODE=real
VITE_API_BASE_URL=https://api.multica.ai
```

只要后端实现同一套 REST 契约,前端零改动。契约文档由 `src/api/*.ts` 的函数签名 + JSDoc 充当,后续可生成 OpenAPI spec。

### 4.6 开发体验

- **MSW 只在 dev 启动**:`main.tsx` 根据 `import.meta.env.DEV && VITE_API_MODE === 'mock'` 决定
- **种子数据可调**:`src/mock/db.ts` 导出 `SEED_COUNT` 常量
- **"重置 mock 数据"按钮**:加在 config-drawer,清空 localStorage + 重载种子
- **请求可见性**:MSW 在 console 打印每次请求摘要

---

## §5 features/ 目录与共享组件

### 5.1 features/ 顶层分组

```
src/features/
├── auth/              # 保留模板(sign-in/sign-up/forgot/otp 页面)
├── errors/            # 保留模板(401/403/404/500/503)
├── settings/          # 保留模板(profile/account/notifications/appearance/display)
│
├── home/              # 首页 / 工作台 dashboard
│
├── workbench/         # 工作台
│   ├── sessions/      # 我的会话(chat-style)
│   ├── tasks/         # 我的任务(DataTable)
│   └── reviews/       # 我的审查(DataTable + 状态筛选)
│
├── projects/          # 项目
│   ├── overview/      # 项目总览(KPI + 列表)
│   ├── backlog/       # 待办(kanban)
│   ├── issues/        # 需求(DataTable + 详情 drawer)
│   ├── design/        # 设计(附件/图片网格)
│   ├── review/        # 审查(PR-style 列表)
│   └── settings/      # 项目设置(form)
│
├── collaboration/     # 协同
│   ├── workflows/     # 工作流(列表 + DAG 详情)
│   ├── squads/        # 团队(卡片网格)
│   └── dispatch/      # 任务委派(规则列表)
│
├── repository/        # 知识中心
│   ├── wiki/          # 知识(文档树 + 编辑器)
│   ├── skills/        # 技能(卡片网格)
│   └── memory/        # 记忆(时间线 + 搜索)
│
├── metrics/           # 效能度量
│   ├── efficiency/    # chart-heavy
│   ├── quality/
│   ├── cost/
│   ├── coverage/
│   └── contribution/
│
├── admin/             # 平台管理
│   ├── members/       # DataTable
│   ├── permissions/   # 角色矩阵
│   ├── devices/       # DataTable
│   ├── connectors/    # 卡片网格
│   ├── channels/      # form 列表
│   └── quotas/        # form 列表
│
├── me/                # 个人中心
│   ├── profile/       # 复用 settings/profile
│   ├── quota/         # progress + 图表
│   ├── notifications/ # inbox 列表
│   ├── devices/       # DataTable
│   └── preferences/   # 复用 settings/appearance+display
│
└── common/            # 跨模块共享业务组件
```

### 5.2 每个 feature 目录内部结构(统一约定)

```
src/features/workbench/tasks/
├── components/
│   ├── tasks-table.tsx           # 主列表
│   ├── tasks-columns.tsx         # 列定义
│   ├── tasks-dialogs.tsx         # 增删改对话框聚合
│   ├── tasks-mutate-drawer.tsx   # 新建/编辑抽屉
│   ├── tasks-primary-buttons.tsx # 顶部按钮
│   └── tasks-provider.tsx        # 局部状态 context
├── data/
│   ├── schema.ts                 # zod schema
│   └── types.ts                  # TS 类型
├── hooks/
│   └── use-tasks.ts              # useQuery / mutations 封装
└── index.tsx                     # 页面入口(默认导出)
```

**规则**:
- 严格 1 页 = 1 feature 目录
- feature 之间**不**互相 import
- 跨 feature 复用走 `features/common/`

### 5.3 共享业务组件(`features/common/`)

**列表类:**
- `<DataTable/>` — 模板自带,通用
- `<KanbanBoard/>` — backlog / dispatch 用(dnd-kit)
- `<PageHeader/>` — 标题 + 操作区
- `<EmptyState/>` — 空态
- `<FilterBar/>` — 筛选条(搜索 + 多维筛选 + 排序)

**展示类:**
- `<UserAvatar/>` — 人 / agent 头像
- `<StatusBadge/>` — 状态徽章
- `<PriorityBadge/>` — P0–P3
- `<ModuleIcon/>` — 7 大模块图标
- `<MetricCard/>` — KPI 卡
- `<ChartContainer/>` — recharts 封装(loading / error / empty 三态)
- `<Timeline/>` — 活动流 / memory 用

### 5.4 Me 与 Settings 的复用关系

- `me/profile` → 复用 `settings/profile`(加 Multica 特定字段:角色/团队)
- `me/preferences` → 复用 `settings/appearance + settings/display + settings/notifications`
- `me/quota` / `me/notifications` / `me/devices` → 全新实现

---

## §6 32 页规格总览

每页 1–2 句概括。详细 UI 设计(字段、交互、空/载/错态)放在各自 Phase 的 spec。

### 🏠 首页 / Home

| 路由 | 页面 | 规格 | 主要组件 |
|---|---|---|---|
| `/` | Home | 工作台 dashboard:今日待办、任务统计、近期活动时间线、快捷入口 | MetricCard × 4 + Timeline + 快捷卡 |

### 💼 工作台 / Workbench

| 路由 | 页面 | 规格 | 主要组件 |
|---|---|---|---|
| `/sessions` | Sessions | 与 agent 的对话会话列表(左)+ 当前会话消息流(右) | ChatWindow + 列表 |
| `/tasks` | Tasks | 我的任务 DataTable,状态/优先级/项目筛选,新建/编辑 drawer | DataTable + MutateDrawer |
| `/reviews` | Reviews | 待我审查的 PR/变更列表(pending/approved/rejected),点击进 diff | DataTable + DiffView |

### 📁 项目 / Projects

| 路由 | 页面 | 规格 | 主要组件 |
|---|---|---|---|
| `/projects` | Overview | 所有项目 KPI 卡网格 + 项目列表(进度、成员、最近活动) | MetricCard + 卡片网格 |
| `/projects/backlog` | Backlog | 看板视图(To Do / In Progress / Review / Done),拖拽 | KanbanBoard (dnd-kit) |
| `/issues` | Issues | 需求/bug DataTable,点击行展开 drawer 详情 | DataTable + IssueDetailDrawer |
| `/design` | Design | 设计稿网格(图片/附件),上传、预览、按项目/标签筛选 | MediaGrid + Lightbox |
| `/review` | Review | PR-style 变更列表(作者/审查者/状态/文件数) | DataTable + PRCard |
| `/projects/settings` | Settings | 项目元信息 form(名称/描述/key/成员/删除) | Form (react-hook-form) |

### 🤝 协同 / Collaboration

| 路由 | 页面 | 规格 | 主要组件 |
|---|---|---|---|
| `/workflows` | Workflows | 工作流列表 + 详情 DAG 图(节点/连线/运行历史) | DAGCanvas + RunsTable |
| `/squads` | Squads | 团队卡片网格(成员/技能/当前任务) | CardGrid + SquadDetail |
| `/dispatch` | Dispatch | 任务委派规则列表(触发条件/目标 agent/优先级),启停 | DataTable + RuleEditor |

### 📚 知识中心 / Repository

| 路由 | 页面 | 规格 | 主要组件 |
|---|---|---|---|
| `/wiki` | Wiki | 左侧文档树 + 右侧 markdown 编辑/预览(tiptap),全文搜索 | DocTree + Editor |
| `/skills` | Skills | 技能卡片网格(名称/描述/版本/作者/使用次数),版本管理 | CardGrid + SkillDetail |
| `/memory` | Memory | agent 记忆条目时间线(来源/类型/关键内容),搜索筛选 | Timeline + SearchBar |

### 📊 效能度量 / Metrics

| 路由 | 页面 | 规格 | 主要组件 |
|---|---|---|---|
| `/metrics/efficiency` | Efficiency | 交付速率 / 周期时间 / 吞吐量趋势,按项目/团队/时间窗口筛选 | recharts 折线/柱状 |
| `/metrics/quality` | Quality | bug 密度 / review 通过率 / rework 率,缺陷趋势 | ChartContainer |
| `/metrics/cost` | Cost | token / 费用 / agent 工时成本,按模块/agent 分布 | KPI + 饼图 + 表格 |
| `/metrics/coverage` | Coverage | 测试覆盖率 / 技能覆盖 / agent 任务覆盖,模块热力图 | Heatmap |
| `/metrics/contribution` | Contribution | 人/agent 贡献度排行榜,多维度 | Leaderboard |

### ⚙️ 平台管理 / Admin

| 路由 | 页面 | 规格 | 主要组件 |
|---|---|---|---|
| `/admin/members` | Members | 成员 DataTable(姓名/邮箱/角色/状态),邀请/编辑/禁用 | DataTable + InviteDialog |
| `/admin/permissions` | Permissions | 角色 × 权限矩阵表,自定义角色 | PermissionMatrix |
| `/admin/devices` | Devices | 设备列表(名称/类型/最后在线/用户),远程登出 | DataTable |
| `/admin/connectors` | Connectors | 集成卡片网格(GitHub/GitLab/Slack/...),连接/配置/断开 | CardGrid + ConfigDialog |
| `/admin/channels` | Channels | 通知渠道列表(类型/启用/模板),测试发送 | DataTable + TestButton |
| `/admin/quotas` | Quotas | 配额策略 form 列表(每角色/项目的 token/任务上限) | FormList |

### 👤 个人中心 / Me

| 路由 | 页面 | 规格 | 主要组件 |
|---|---|---|---|
| `/me/profile` | Profile | 复用模板 settings/profile,加 Multica 字段(角色/团队) | 复用 ProfileForm |
| `/me/quota` | My Quota | 我的配额使用进度条(token/任务/agent 工时),历史趋势 | Progress + Chart |
| `/me/notifications` | Notifications | 个人通知收件箱(已读/未读/星标),按类型分组 | InboxList |
| `/me/devices` | My Devices | 我的登录设备列表,远程登出 | DataTable |
| `/me/preferences` | Preferences | 复用模板 settings/appearance + display + notifications | 复用 Settings 组件 |

---

## §7 实施分期

Master Spec 完成后,实施按以下顺序逐 phase 推进。每个 phase 走完整的 brainstorm → spec → plan → 执行循环。

| Phase | 内容 | 页数 | 说明 |
|---|---|---|---|
| **0** | **地基(本 Master Spec 覆盖)** | — | Fork 仓库、branding、sidebar、MSW、i18n、32 Coming Soon 路由 |
| **1** | 工作台(Home + Sessions/Tasks/Reviews) | 4 | 最常用入口,先把"每天打开就看到"的体验做扎实 |
| **2** | 项目(Overview/Backlog/Issues/Design/Review/Settings) | 6 | 核心交付物管理,与 Workbench 共享 DataTable/Drawer |
| **3** | 协同(Workflows/Squads/Dispatch) | 3 | DAG 画布是重点 |
| **4** | 知识中心(Wiki/Skills/Memory) | 3 | 编辑器(tiptap)和树组件是重点 |
| **5** | 效能度量(5 metrics) | 5 | recharts 重度使用,共享 ChartContainer + 时间窗口筛选 |
| **6** | 平台管理(6 admin) | 6 | 权限矩阵是重点 |
| **7** | 个人中心(5 me) | 5 | 大量复用模板 settings,工作量最轻 |

**合计: 4 + 6 + 3 + 3 + 5 + 6 + 5 = 32 页**(Phase 1 含 Home)

### 后续每个 phase 的 spec 模板

1. 该 phase 涉及页面的**详细 UI 设计**(字段、交互、空/载/错态)
2. **数据模型**(TypeScript 类型 + zod schema)
3. **API 契约**(endpoint + 请求/响应 schema)
4. **MSW handler 实现**(含种子数据策略)
5. **组件拆分**(本 phase 内的 feature 目录)
6. **验收标准**(逐页面 checklist)

---

## §8 Master Spec 验收标准(仅 Phase 0 地基)

以下全部达成才算 Phase 0 完成:

- [ ] `pnpm dev` 起得来,浏览器打开看到 Multica 品牌(sign-in 页 logo + sidebar 顶部)
- [ ] Sidebar 显示 7 大模块 nav-group,中文 label,正确图标
- [ ] 32 个路由全部可访问,未实现的显示 `coming-soon.tsx`
- [ ] MSW 启动,任意邮箱密码登录成功,`/me` 返回 fake 用户
- [ ] 中英文切换工作正常(至少 sidebar 文案)
- [ ] 明暗主题切换、3 主色切换、4 布局变体都能用
- [ ] `pnpm typecheck && pnpm lint && pnpm build` 全部通过
- [ ] README 写清楚:这是 Multica Admin,fork 自 shadcn-admin,后续 phases 见 specs 目录

**不在 Master Spec 验收范围内**: 任何业务页面的实际功能(那些归各自 Phase 的 spec 验收)。

---

## 附录 A:依赖清单(完整)

### 生产依赖(在模板基础上)

```
# 模板原有
@radix-ui/react-*           # 全套 Radix primitives
@tanstack/react-query       # 服务端状态
@tanstack/react-router      # 路由
@tanstack/react-table       # 表格
axios                       # HTTP
class-variance-authority    # 组件变体
clsx                        # className 合并
cmdk                        # 命令面板
date-fns                    # 日期(模板已用)
input-otp                   # OTP 输入
lucide-react                # 图标
react / react-dom           # React 19
react-day-picker            # 日期选择器
react-hook-form             # 表单
react-top-loading-bar       # 路由顶部进度条
recharts                    # 图表
sonner                      # toast
tailwind-merge              # Tailwind class 合并
tailwindcss + @tailwindcss/vite  # Tailwind v4
tw-animate-css              # 动画
zod                         # schema 校验
zustand                     # 客户端状态

# 新增
msw                         # Mock Service Worker
@faker-js/faker             # 假数据生成
i18next + react-i18next     # 国际化
dayjs                       # 日期(新代码优先用)
@fontsource-variable/inter  # Inter 字体
```

### 删除

```
@clerk/clerk-react          # Clerk 集成
```

---

## 附录 B:Phase 0 工作量预估

| 任务 | 预估 |
|---|---|
| Fork + 清理 Clerk/示例页 | 0.5 天 |
| 品牌化(logo/favicon/title/README) | 0.5 天 |
| Sidebar IA(7 nav-group + 25 路由) | 1 天 |
| Coming Soon 占位(32 路由) | 0.5 天 |
| MSW 框架 + auth mock + db 种子骨架 | 1 天 |
| i18n 框架 + zh-CN/en 基础文案 | 1 天 |
| 字体/中文 fallback | 0.5 天 |
| typecheck/lint/build 通过 + README | 0.5 天 |
| **合计** | **约 5.5 天** |

---

## 附录 C:决策记录(本 spec 推导过程中的关键选择)

| 决策 | 选择 | 备选 | 理由 |
|---|---|---|---|
| 与 monorepo 关系 | 完全独立新仓库 | monorepo 新 app | 用户明确要求独立;彻底解耦,不被 Turborepo/pnpm 误扫 |
| 模板用法 | Fork 模式 | 依赖模式 | shadcn-admin 未发 npm 包;Fork 最大化复用(80% vs 30%) |
| 技术栈 | 严格按模板 | 模板 + 扩展 | 用户明确要求"主要想使用 shadcn-admin UI" |
| Mock 方案 | MSW + faker | 客户端 mock / 本地 server | 模拟完整 REST 契约,切换真实后端零改动 |
| Spec 策略 | Master + 后续拆分 | 一个大 spec | 32 页一次性塞进 spec 会失控;Master 当宪法,各 phase 引用 |
| URL 结构 | 扁平优先 | 严格层级 | 主列表页一级 URL 更短更含义化 |
| 目录结构 | features/&lt;module&gt;/&lt;page&gt; | 严格模板 / DDD | 与模板 features/ 三层结构兼容,同时反映产品架构 |

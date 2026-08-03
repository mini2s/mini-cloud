# 指标看板迁移到 mini-cloud — 设计文档

**日期**：2026-07-24
**源项目**：`/home/mini/workspace/costrict-space/efficiency-dashboard`（Go Gin + React 19 + Vite，basename `/kanban`）
**目标项目**：`/home/mini/workspace/costrict-space/mini-cloud`（Go Chi + Next.js + pnpm monorepo，`@multica/*`）
**状态**：设计已确认（§1-§5），待用户复核规格

---

## 1. 背景与目标

源项目 `efficiency-dashboard` 是一个 AI Coding 研发效能指标看板，包含总览大屏、4 个维度看板（使用/效率/成本/贡献）、需求/任务/提交/用户/仓库/项目下钻详情、平台运维与设置页。前端约 128 个文件、3 万行代码，后端约 50 个 `/api/v2/*` 接口。

目标项目 `mini-cloud`（multica）是 AI 任务管理平台，其 `apps/web` 下已预留 `metrics_group` 导航占位（usage/efficiency/quality/cost/coverage/contribution），均为 8 行占位页，等待真实实现落地。

**本次迁移目标**：把源项目指标看板的前端全量移植到 `apps/web`，用 mini-cloud 的技术栈与组件库重写 UI，数据层先用 mock，后端 API 后续在同域名下补齐后切换。

---

## 2. 范围与约束

### 2.1 范围（全量移植）

- **前端页面**：总览大屏 + 4 维度看板 + 下钻详情 + 设置/平台运维页（全部）
- **数据层**：源项目 `api/`（types/endpoints/queries）+ `hooks/` + `lib/` + `store/` 的逻辑
- **UI 组件**：源项目 `components/`（ui/executive/charts）

### 2.2 约束（已与用户确认）

| 维度 | 决定 |
|---|---|
| **后端** | 仅前端移植；后端 API 保留在同域名下，**先用 mock 数据**，后端就绪后切真 |
| **UI 风格** | 重写为 mini-cloud 风格（shadcn/Base UI + 语义 token，放弃源项目的 glass 玻璃拟态 / ECharts 自写件）|
| **图表** | 用目标项目已有的 **recharts 3.8.0** + `ChartContainer`/`--chart-*` token |
| **路由落点** | 沿用目标项目已预留的 `metrics_group` / `admin_group` 占位，**只在 `apps/web` 落地，不动 `apps/admin`** |
| **历史链接** | 丢弃源项目的旧链重定向层（`/user-v2`→`/usage/user`、`/distribution-v2`、`/cloud/kanban` 等），新平台无历史包袱 |

---

## 3. 路由与 IA 映射（§1）

源项目采用"维度优先 IA"：一级导航选维度，内层 Tab 选主体（org/user/project/repo），`/:dim/:entity`。迁移到目标项目时，**主体收进组件内 Tabs**（不进 URL 路径段），简化 IA。

### 3.1 路由映射表

| 源项目页面 | 目标路由（`apps/web`）| nav 落点 |
|---|---|---|
| Overview 总览大屏 | `/{ws}/metrics`（新建 page.tsx）| metrics_group 顶部 |
| usage 使用维度 | `/{ws}/usage`（替换现有占位）| `usage`（已有）|
| efficiency 效率维度 | `/{ws}/metrics/efficiency`（替换占位）| `metricsEfficiency`（已有）|
| cost 成本维度 | `/{ws}/metrics/cost`（替换占位）| `metricsCost`（已有）|
| contribution 贡献维度 | `/{ws}/metrics/contribution`（替换占位）| `metricsContribution`（已有）|
| 维度下钻详情 | `/{ws}/metrics/{user,repo,project,need,task,commit}/[id]` | 无（下钻进入）|
| settings/价格 | `/{ws}/settings/pricing`（新建）| admin_group 下 |
| settings/数据源 | `/{ws}/settings/datasources` | admin_group 下 |
| settings/同步任务 | `/{ws}/settings/sync` | admin_group 下 |
| settings/系统配置 | `/{ws}/settings/config` | admin_group 下 |
| platform/平台总览 | `/{ws}/settings/platform/overview` | admin_group 下 |
| platform/健康度 | `/{ws}/settings/platform/health` | admin_group 下 |
| platform/实时态势 | `/{ws}/settings/platform/realtime` | admin_group 下 |
| platform/明细查询 | `/{ws}/settings/platform/realtime/query` | admin_group 下 |

### 3.2 不迁移 / 保持占位

- `metricsQuality`（质量）：源项目已下沉到平台运维，不单列维度，保持占位
- `metricsCoverage`（覆盖）：源项目无直接对应（AI 渗透率在 Overview 内），保持占位

### 3.3 IA 取舍

1. **主体用组件内 Tabs**：源项目用 URL param `/:dim/:entity`（4×4 矩阵 + 脏值守卫 + 大量旧链重定向）。目标项目把 entity 收进组件内 Tabs（`?entity=user` query 或纯本地 state），不进路径段。理由：mini-cloud 是新落点无历史包袱；Tabs 交互更轻；避免占用大量顶层动态段。
2. **丢弃所有旧链重定向层**：源项目的 `FlipRedirect`/`SimpleRedirect`/`legacyEntityRedirects` 全部不迁。
3. **设置/平台页复用目标 settings 框架**：源项目 SettingsLayout 是"4 设置页 + 4 平台页"一个壳；迁移后作为 `/{ws}/settings/*` 子路由。

---

## 4. 包结构与分层（§2）

遵循目标项目硬架构规则：`views → core+ui`；core 无 react-dom、零 UI 库；ui 无业务逻辑。

**新建一个独立的 `efficiency` 域**，而非散落到目标项目现有 domain（projects/issues/members）。理由：源项目的 projects/repos/users 是"研发效能"视角的只读指标聚合，与目标项目 projects（可编辑任务项目）、members（成员管理）语义不同；混入会污染现有 domain 职责。

### 4.1 分层映射

```
源项目 efficiency-dashboard          →    目标项目 mini-cloud
─────────────────────────────────────────────────────────────────
api/types.ts (1346行 类型)            →    packages/core/efficiency/types.ts
api/client.ts + endpoints.ts         →    packages/core/efficiency/api.ts (复用现有 api 单例)
api/queries.ts (30个 query hooks)    →    packages/core/efficiency/queries.ts (queryOptions 工厂)
store/viewState.ts                   →    packages/core/efficiency/view-state-store.ts
hooks/* (useEntityObjects 等)         →    packages/core/efficiency/hooks.ts
lib/* (date/formatters/glossary等)    →    packages/core/efficiency/utils/ (纯函数)

components/ui/* (MetricCard/Glass等)  →    packages/views/efficiency/components/ (用 shadcn 重写)
components/charts/* (EChart)          →    packages/views/efficiency/charts/ (改 recharts)
components/executive/* (Hero/趋势卡)  →    packages/views/efficiency/components/
components/layout/* (AppShell 等)     →    不迁 (用目标项目现有 sidebar/dashboard 壳)

pages/Overview.tsx                    →    packages/views/efficiency/overview-page.tsx
pages/dimensions/usage/*              →    packages/views/efficiency/usage/*.tsx
pages/dimensions/EfficiencyDimension  →    packages/views/efficiency/efficiency/*.tsx
pages/dimensions/cost/*               →    packages/views/efficiency/cost/*.tsx
pages/dimensions/contribution/*       →    packages/views/efficiency/contribution/*.tsx
pages/{users,repos,projects,needs,
       tasks,commits,workdir}/*       →    packages/views/efficiency/detail/*.tsx
pages/settings/* + pages/platform/*   →    packages/views/efficiency/settings/*.tsx
```

### 4.2 packages/views/efficiency 目录结构

```
packages/views/efficiency/
├── components/        # MetricCard(复用KpiCard), ScorecardStrip, DeptPKCard, TrendCard, TopRankCard...
├── charts/            # recharts 版趋势图/分布图/排行图
├── overview-page.tsx
├── usage/             # UsageKanban + DeptAggregateView + MembersView...
├── efficiency/        # EfficiencyDimension + rankings
├── cost/              # CostKanban + views
├── contribution/      # ContributionDimension + 4主体视图
├── detail/            # UserDetail, RepoDetail, ProjectDetail, NeedDetail, TaskDetail, CommitDetail, WorkDirDetail
├── settings/          # Pricing, Datasources, SyncTasks, SystemConfig, platform/*
└── index.ts
```

### 4.3 关键决策

1. **独立 `efficiency` 域**：边界清晰，符合目标"每个 domain 一个目录"惯例。
2. **数据层全进 `core/efficiency/`**：严格遵守 core 无 react-dom。
3. **UI 组件全进 `views/efficiency/components/`**：用 shadcn 重写。
4. **ECharts 封装丢弃**：改 recharts + `@multica/ui/components/ui/chart`。
5. **AppShell 不迁**：目标项目用现有 `AppSidebar` + `(dashboard)/layout.tsx` 壳。全局时间范围（DateRangePicker）改为放进 efficiency 各页的 `PageHeader` 区域（参考 dashboard 页的 period selector 范式，每域自管时间窗）。

---

## 5. 数据层与 mock 策略（§3）

### 5.1 mock 注入位置：queryOptions 层

在 `queryOptions` 的 `queryFn` 内按开关切换 mock，而非在 api client 层硬编码。

```
packages/core/efficiency/
├── api.ts            # 端点方法，对接 api.get/post (同域名 /api/v2/efficiency/*)
├── queries.ts        # queryOptions 工厂 (efficiencyKeys: summary/trends/dept/...)
├── mock/
│   ├── index.ts      # MOCK_ENABLED 开关 + getMock(key, params) 分发
│   ├── dashboard.ts  # summary/trends 假数据
│   ├── usage.ts      # deptTree/ranking/overview/members
│   ├── cost.ts
│   ├── contribution.ts
│   └── detail.ts     # user/repo/project/need/task/commit
├── types.ts          # 从源项目 types.ts 迁移 (1346行)
├── view-state-store.ts
└── utils/            # date/formatters/glossary 等纯函数
```

**queryOptions mock 注入模式：**
```ts
export function dashboardSummaryOptions(wsId, startDate, endDate) {
  return queryOptions({
    queryKey: efficiencyKeys.summary(wsId, startDate, endDate),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.getDashboardSummary({ startDate, endDate });
      return api.getDashboardSummary({ startDate, endDate });
    },
  });
}
```

### 5.2 为什么这样切 mock

1. **后端就绪后零改动切真**：`MOCK_ENABLED = false`（环境变量），queryFn 自动走真接口。
2. **组件层无感**：`views/` 只调 `useQuery(dashboardSummaryOptions(...))`。
3. **mock 集中可维护**：对照源项目真实接口结构编写，为后续联调提供参照。
4. **预留 schema 校验**：真接口接入后，queryFn 里对响应跑 `parseWithFallback`（目标 CLAUDE.md 强制要求）。

### 5.3 其他决策

5. **复用现有 api 单例**：源项目用独立 axios 实例（`baseURL=/kanban/api`）。目标项目复用现有 `api` 单例（同域名），端点路径 `/api/v2/efficiency/*`。
6. **chat 代理通道不迁**：源项目 `chatGet`/`chatPost`（独立 `{success,code,data}` 信封解包）。目标后端"同域名保留接口"后统一成目标响应格式，端点统一走 `api` 单例标准解包。
7. **类型迁移**：源 `types.ts`（1346 行）整体搬到 `core/efficiency/types.ts`，这是源后端契约；后端就绪后可能调整。

---

## 6. UI 组件重写映射（§4）

源项目 UI 三层：`ui/`（基础件 721 行）、`executive/`（高管卡 1415 行）、`charts/`（ECharts 176 行）。目标项目 `packages/ui/components/ui/` 已有 60+ shadcn 件，`packages/views/runtimes/` 已有 `KpiCard`/charts 范式。

### 6.1 重写映射表

| 源组件 | 处理 | 目标实现 |
|---|---|---|
| `Glass.tsx` | 丢弃 | 不需要，目标用语义 token（`bg-card`/`border`），无玻璃拟态 |
| `MetricCard.tsx` | 复用现有 | 直接用 `packages/views/runtimes/components/shared` 的 `KpiCard`（同构），不另建 |
| `Modal.tsx` | 替换 | shadcn `Dialog`（`@multica/ui/components/ui/dialog`）|
| `EntityTabs.tsx` | 替换 | shadcn `Tabs`（`@multica/ui/components/ui/tabs`）|
| `ObjectSelector.tsx` | 替换 | shadcn `Combobox`（`@multica/ui/components/ui/combobox`）|
| `DateRangePicker.tsx` | 替换 | shadcn `Calendar`+`Popover`（参考 dashboard-page period selector）|
| `Pagination.tsx` | 替换 | shadcn `Pagination`（`@multica/ui/components/ui/pagination`）|
| `SortableTh.tsx` | 替换 | shadcn `DataTable`+`DataTableColumnHeader` |
| `PercentPill`/`RatioPill`/`Tag` | 替换 | shadcn `Badge`（`@multica/ui/components/ui/badge`）|
| `Skeleton.tsx` | 替换 | shadcn `Skeleton`（`@multica/ui/components/ui/skeleton`）|
| `charts/EChart.tsx`+`barOption`+`chartTheme` | 丢弃+重写 | ECharts 封装丢弃，图表用 recharts 重写到 `views/efficiency/charts/` |
| `executive/*`（9 张高管卡）| 重写 | 进 `views/efficiency/components/`，结构参照源、样式换语义 token |

### 6.2 关键决策

1. **优先复用目标现有件**：源项目基础件全部用 shadcn 件替换，不搬源 `ui/`。只有 shadcn 无法覆盖时才在 `views/efficiency/components/` 自建（且基于 shadcn 原语）。
2. **executive 高管卡重写**：进 `views/efficiency/components/`，逻辑（数据组装、环比计算）从源迁，视觉换语义 token。
3. **图表统一 recharts + ChartContainer**：颜色用 `var(--chart-1..4)`，与目标 `runtimes/charts` 一致。
   - 趋势图 → `LineChart`/`AreaChart`
   - 部门 PK → `BarChart`（横向）
   - 分布直方 → `BarChart`
   - 热力图（contribution）→ recharts 无原生热力，改 GitHub 风格自建网格（参考目标 `runtimes/components/charts/activity-heatmap.tsx`）

### 6.3 样式 token 映射约定（贯穿所有重写）

| 源项目 | 目标项目 |
|---|---|
| `glass rounded-2xl p-5` | `rounded-lg border bg-card p-5` |
| `text-apple-blue` / `#0071e3` | `text-brand` / `text-primary` |
| `text-gray-500 dark:text-gray-400` | `text-muted-foreground` |
| `text-emerald-600` / `text-rose-600` | `text-success` / `text-destructive` |
| `bg-white dark:bg-zinc-900` | `bg-background` |

### 6.4 hooks 迁移

源 `hooks/`（useCountUp/useTheme/useUserNameMap/useEntityObjects）进 `core/efficiency/hooks.ts`。`useEChart`（ECharts 专用）不迁。

---

## 7. 迁移顺序（增量交付，§5）

自底向上 + 按维度切片，每片可独立编译验证、可独立 PR。共 8 个增量。

### 切片 0：基础设施（core/efficiency 地基）
- `core/efficiency/types.ts`（迁源 types.ts 1346 行）
- `core/efficiency/utils/`（date/formatters/glossary/sort/timeBucket/week 等纯函数）
- `core/efficiency/view-state-store.ts`（时间范围 store）
- `core/efficiency/api.ts` + `queries.ts`（queryOptions 工厂）+ `mock/index.ts` 骨架
- **验收**：`pnpm typecheck` 通过；mock 开关可切换；无 UI

### 切片 1：共享 UI 基础件（views/efficiency/components）
- `MetricCard` → 直接用现有 `KpiCard`
- 自建少量业务件：`ScorecardStrip`、`glossaryTip` 悬浮提示（shadcn `Tooltip`）
- recharts 图表基础封装：`views/efficiency/charts/`（TrendChart/BarChart/Histogram）
- **验收**：组件在隔离环境渲染（vitest），用 mock 数据

### 切片 2：总览大屏（Overview）
- `views/efficiency/overview-page.tsx` + 9 张高管卡重写
- `apps/web/.../metrics/page.tsx`（新建）
- 依赖：`useDashboardSummary`/`useDashboardTrends`/`useDeptRanking`/`useDeptTree`/`useUsers`/`useGlobalConfig`
- **验收**：`/{ws}/metrics` 可访问，mock 数据驱动大屏渲染

### 切片 3：usage 使用维度
- `views/efficiency/usage/`（UsageKanban + DeptAggregateView + DeptCompareView + MembersView + MemberDetail + DeptTreePanel）
- `apps/web/.../usage/page.tsx`（替换现有占位）
- 依赖：`useDeptTree`/`useDeptOverview`/`useDeptRanking`/`useDeptTreeMembers`/`useDeptTreeTrend`
- **验收**：`/{ws}/usage` 部门树 + 视角切换可用

### 切片 4：efficiency / cost 维度
- `views/efficiency/efficiency/`（EfficiencyDimension + rankings）
- `views/efficiency/cost/`（CostKanban + AggregateView + CompareView + MembersView）
- `apps/web/.../metrics/efficiency/page.tsx`、`metrics/cost/page.tsx`（替换占位）
- **验收**：两个维度看板可用

### 切片 5：contribution 维度 + 下钻详情页
- `views/efficiency/contribution/`（4 主体视图）
- `views/efficiency/detail/`（UserDetail/RepoDetail/ProjectDetail/NeedDetail/TaskDetail/CommitDetail/WorkDirDetail）
- `apps/web/.../metrics/{user,repo,project,need,task,commit}/[id]/page.tsx`
- **验收**：维度页下钻到详情可用

### 切片 6：设置与平台运维页
- `views/efficiency/settings/`（Pricing/Datasources/SyncTasks/SystemConfig）
- `views/efficiency/settings/platform/`（PlatformOverview/PlatformHealth/RealtimeReport/RealtimeQuery）
- `apps/web/.../settings/{pricing,datasources,sync,config}/page.tsx`、`settings/platform/*`
- **验收**：设置区 4 页 + 平台 4 页可用

### 切片 7：导航接线 + 收尾
- `paths.ts` 补充新增路径方法（若有）
- `app-sidebar.tsx` 确认 metrics_group/admin_group 导航项指向正确
- `locales/{en,zh-Hans}/layout.json` 补充新 label
- `views/efficiency/index.ts` 统一导出
- **验收**：`make check`（typecheck + test）通过；侧边栏导航完整

### 切片间约束

- 每片完成后 `pnpm typecheck` 必须绿（目标 CLAUDE.md：逐步验证，不攒着编译）
- 切片 0 是所有后续片的地基，必须先完成
- 切片 2-6 之间互相独立，顺序可调（但建议 Overview 先行作为端到端样板）

---

## 8. 验证策略

- **类型**：每个切片 `pnpm typecheck` 绿
- **单元测试**：`packages/core/efficiency/*.test.ts`（纯函数：formatters/date/sort）+ `packages/views/efficiency/*.test.tsx`（组件渲染，mock 数据）
- **集成**：`make check` 全量通过
- **手动**：`pnpm dev:web` 启动，逐路由访问 `/{ws}/metrics`、`/usage`、各维度、下钻详情，确认 mock 数据驱动渲染正常
- **切真接口**：`MOCK_ENABLED=false` 后，对照后端 `/api/v2/efficiency/*` 联调

---

## 9. 未决事项 / 后续

- `metricsQuality` / `metricsCoverage` 两个 nav key 本轮保持占位，后续按需补
- 后端 `/api/v2/efficiency/*` 路由的实际挂载（由后端侧完成，前端预留路径）
- 真接口接入后的 `parseWithFallback` schema 定义（mock 阶段先不引入）

# 指标看板迁移到 mini-cloud 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把源项目 `efficiency-dashboard` 的指标看板前端全量移植到 `mini-cloud` 的 `apps/web`，用 shadcn/recharts 重写 UI，数据层先 mock，后端就绪后切真。

**Architecture:** 新建独立 `efficiency` 域：数据层（types/api/queries/store/utils）进 `packages/core/efficiency/`（无 react-dom），UI（components/charts/pages）进 `packages/views/efficiency/`（shadcn + recharts + 语义 token）。mock 在 queryOptions 层注入，环境变量切换。路由填入 `apps/web/app/[workspaceSlug]/(dashboard)/metrics/*` 与 `settings/*` 已有占位。详见 `docs/superpowers/specs/2026-07-24-efficiency-dashboard-migration-design.md`。

**Tech Stack:** Next.js (App Router) · TypeScript strict · shadcn (Base UI) · recharts 3.8 · TanStack Query · Zustand · pnpm catalog

**源项目路径**：`/home/mini/workspace/costrict-space/efficiency-dashboard/frontend-react/src`
**目标项目路径**：`/home/mini/workspace/costrict-space/mini-cloud`

**关键约束（源项目 CLAUDE.md + 目标项目 CLAUDE.md）**：
- Git 必须加 `-c core.autocrlf=false`
- 目标项目评论只用英文；中文产品文案走 i18n
- 每个切片完成 `pnpm typecheck` 必须绿
- 复用优先：写新函数/组件前先搜索目标项目是否已有

---

## 文件结构总览

### 新建 — packages/core/efficiency/（数据层，无 react-dom）
```
packages/core/efficiency/
├── index.ts                  # 统一导出
├── types.ts                  # 源 types.ts 迁移（97 个导出类型）
├── api.ts                    # 端点方法（调 getApi()，路径 /api/v2/efficiency/*）
├── queries.ts                # queryOptions 工厂 + efficiencyKeys
├── view-state-store.ts       # 时间范围 zustand store
├── hooks.ts                  # useEntityObjects / useUserNameMap / useCountUp
├── mock/
│   ├── index.ts              # MOCK_ENABLED 开关 + 分发器
│   ├── dashboard.ts
│   ├── usage.ts
│   ├── efficiency.ts
│   ├── cost.ts
│   ├── contribution.ts
│   └── detail.ts
└── utils/
    ├── index.ts
    ├── formatters.ts         # 源 lib/formatters.ts（formatNumber/formatV2Ratio...）
    ├── date.ts               # 源 lib/date.ts
    ├── glossary.ts           # 源 lib/glossary.ts
    ├── sort.ts               # 源 lib/sort.ts
    ├── time-bucket.ts        # 源 lib/timeBucket.ts
    └── week.ts               # 源 lib/week.ts + weekWindows.ts
```

### 新建 — packages/views/efficiency/（UI 层）
```
packages/views/efficiency/
├── index.ts
├── components/               # 高管卡 + 业务件（KpiCard 复用 runtimes）
├── charts/                   # recharts 图表
├── overview-page.tsx
├── usage/
├── efficiency/
├── cost/
├── contribution/
├── detail/
└── settings/
```

### 修改 — apps/web/app/[workspaceSlug]/(dashboard)/（路由占位换真实实现）
```
metrics/page.tsx              # 新建（Overview）
metrics/efficiency/page.tsx   # 替换占位
metrics/cost/page.tsx         # 替换占位
metrics/contribution/page.tsx # 替换占位
usage/page.tsx                # 替换占位（当前导出 DashboardPage）
metrics/user/[userId]/page.tsx         # 新建
metrics/repo/[...addr]/page.tsx        # 新建
metrics/project/[projectId]/page.tsx   # 新建
metrics/need/[needId]/page.tsx         # 新建
metrics/task/[taskId]/page.tsx         # 新建
metrics/commit/[commitId]/page.tsx     # 新建
settings/pricing/page.tsx              # 新建
settings/datasources/page.tsx          # 新建
settings/sync/page.tsx                 # 新建
settings/config/page.tsx               # 新建
settings/platform/overview/page.tsx    # 新建
settings/platform/health/page.tsx      # 新建
settings/platform/realtime/page.tsx    # 新建
settings/platform/realtime/query/page.tsx  # 新建
```

---

## 切片 0：基础设施（core/efficiency 地基）

> 地基切片，所有后续切片依赖。无 UI，纯数据层 + 工具函数 + mock 骨架。

### Task 0.1：创建包目录与 package 元信息

**Files:**
- Create: `packages/core/efficiency/package.json`（不需要，efficiency 是 core 包内子目录，不单独建包）
- 实际：efficiency 作为 `@multica/core` 包内的子目录，复用 core 的 package.json

**说明**：`packages/core/` 是单个包 `@multica/core`，efficiency 是其下子目录（参考 `packages/core/dashboard/` 模式）。无需新建 package.json。

- [ ] **Step 1: 确认 core 包导入惯例**

Run:
```bash
cd /home/mini/workspace/costrict-space/mini-cloud
grep -n '"@multica/core"' packages/views/package.json
```
Expected: 看到 `"@multica/core": "workspace:*"`，确认 views 通过 `@multica/core` 导入 core 子模块。

- [ ] **Step 2: 创建 efficiency 目录骨架**

Run:
```bash
cd /home/mini/workspace/costrict-space/mini-cloud
mkdir -p packages/core/efficiency/mock packages/core/efficiency/utils
mkdir -p packages/views/efficiency/components packages/views/efficiency/charts
```

- [ ] **Step 3: 提交骨架**

```bash
git -c core.autocrlf=false add -A && git -c core.autocrlf=false commit -m "chore(efficiency): scaffold efficiency domain directories"
```
（若 git 报错 nothing to commit，因为空目录不追踪，跳过此步，在 Task 0.2 有文件后一并提交）

---

### Task 0.2：迁移 types.ts

**Files:**
- Create: `packages/core/efficiency/types.ts`
- Source ref: `efficiency-dashboard/frontend-react/src/api/types.ts`（1346 行，97 个导出）

- [ ] **Step 1: 复制源 types.ts 并调整导入**

源 types.ts 是纯类型定义（interface/type），无运行时依赖，几乎可整体复制。需调整：源项目用 `DateRange = [string, string]` 等本地类型，保持原样。

```bash
cp /home/mini/workspace/costrict-space/efficiency-dashboard/frontend-react/src/api/types.ts \
   /home/mini/workspace/costrict-space/mini-cloud/packages/core/efficiency/types.ts
```

- [ ] **Step 2: 检查并移除任何对源项目内部路径的导入**

Run:
```bash
cd /home/mini/workspace/costrict-space/mini-cloud
grep -n "from '@/" packages/core/efficiency/types.ts
```
Expected: 无输出（types.ts 应是自包含的纯类型）。若有 `@/` 导入，删除或内联。

- [ ] **Step 3: typecheck**

Run:
```bash
pnpm --filter @multica/core typecheck
```
Expected: PASS（无类型错误）

- [ ] **Step 4: 提交**

```bash
git -c core.autocrlf=false add packages/core/efficiency/types.ts
git -c core.autocrlf=false commit -m "feat(efficiency): migrate type definitions from source project"
```

---

### Task 0.3：迁移 utils 工具函数

**Files:**
- Create: `packages/core/efficiency/utils/formatters.ts`
- Create: `packages/core/efficiency/utils/date.ts`
- Create: `packages/core/efficiency/utils/glossary.ts`
- Create: `packages/core/efficiency/utils/sort.ts`
- Create: `packages/core/efficiency/utils/time-bucket.ts`
- Create: `packages/core/efficiency/utils/week.ts`
- Create: `packages/core/efficiency/utils/index.ts`
- Create: `packages/core/efficiency/utils/formatters.test.ts`
- Source ref: `efficiency-dashboard/frontend-react/src/lib/{formatters,date,glossary,sort,timeBucket,week,weekWindows}.ts`

这些是纯函数，无 React/DOM 依赖（除 formatters 用 `toLocaleString`，Node 环境可用）。符合 core"零 react-dom"约束。

- [ ] **Step 1: 复制工具函数文件**

```bash
SRC=/home/mini/workspace/costrict-space/efficiency-dashboard/frontend-react/src/lib
DST=/home/mini/workspace/costrict-space/mini-cloud/packages/core/efficiency/utils
cp "$SRC/formatters.ts" "$DST/formatters.ts"
cp "$SRC/date.ts" "$DST/date.ts"
cp "$SRC/glossary.ts" "$DST/glossary.ts"
cp "$SRC/sort.ts" "$DST/sort.ts"
cp "$SRC/timeBucket.ts" "$DST/time-bucket.ts"
cp "$SRC/week.ts" "$DST/week.ts"
cp "$SRC/weekWindows.ts" "$DST/week-windows.ts"
```

- [ ] **Step 2: 修复内部导入路径**

源文件间可能有相对导入（如 formatters 引用 date）。统一改为相对路径：
```bash
cd /home/mini/workspace/costrict-space/mini-cloud
# 检查源 lib 内部导入
grep -rn "from '\./\|from '\.\./" packages/core/efficiency/utils/
```
Expected: 文件间相对导入（`./date`、`./formatters`）保持有效。

- [ ] **Step 3: 复制源测试文件作为格式参照，编写 formatters 测试**

源项目已有 `formatters.test.ts`，复制并适配：
```bash
cp /home/mini/workspace/costrict-space/efficiency-dashboard/frontend-react/src/lib/formatters.test.ts \
   /home/mini/workspace/costrict-space/mini-cloud/packages/core/efficiency/utils/formatters.test.ts
```
检查测试中的导入路径是否需要修正（`from './formatters'` 保持不变）。

- [ ] **Step 4: 创建 utils/index.ts 统一导出**

```typescript
// packages/core/efficiency/utils/index.ts
export * from "./formatters";
export * from "./date";
export * from "./glossary";
export * from "./sort";
export * from "./time-bucket";
export * from "./week";
export * from "./week-windows";
```

- [ ] **Step 5: 运行测试验证**

Run:
```bash
pnpm --filter @multica/core exec vitest run efficiency/utils/formatters.test.ts
```
Expected: PASS

- [ ] **Step 6: typecheck**

Run:
```bash
pnpm --filter @multica/core typecheck
```
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git -c core.autocrlf=false add packages/core/efficiency/utils/
git -c core.autocrlf=false commit -m "feat(efficiency): migrate pure utility functions (formatters/date/sort/week)"
```

---

### Task 0.4：创建 view-state-store（时间范围）

**Files:**
- Create: `packages/core/efficiency/view-state-store.ts`
- Source ref: `efficiency-dashboard/frontend-react/src/store/viewState.ts`

目标项目 Zustand store 放 core（CLAUDE.md：所有 shared Zustand stores 在 core，含 view-related）。但源 store 用 `localStorage` 持久化——目标项目 core 禁止直接用 localStorage（必须用 StorageAdapter）。

- [ ] **Step 1: 查看目标项目 StorageAdapter 惯例**

Run:
```bash
cd /home/mini/workspace/costrict-space/mini-cloud
grep -rn "StorageAdapter\|createJSONStorage\|persist(" packages/core/ --include="*.ts" | grep -v test | grep -v node_modules | head
```
确认目标项目持久化 store 的写法（`persist` + `createJSONStorage` + adapter）。

- [ ] **Step 2: 编写 view-state-store.ts**

```typescript
// packages/core/efficiency/view-state-store.ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { getDefaultDateRangeWide } from "./utils/date";

// Efficiency dashboard global time range. Bound to the per-page date picker
// in PageHeader (each efficiency page owns its own picker — no cross-page
// global binding, matching the dashboard page's period-selector convention).
// Persisted so a refresh keeps the selected window.
const STORAGE_KEY = "efficiency.viewState.timeRange";

export type DateRange = [string, string];

interface ViewState {
  /** Global time range [start, end], YYYY-MM-DD. */
  timeRange: DateRange;
  setTimeRange: (range: DateRange) => void;
}

export const useViewState = create<ViewState>()(
  persist(
    (set) => ({
      timeRange: getDefaultDateRangeWide(7),
      setTimeRange: (range) => set({ timeRange: range }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
```

注意：若目标项目强制 StorageAdapter（core 禁止直接 localStorage），改用目标项目的 adapter。先按 Step 1 的结果决定。若目标项目其他 core store 也直接用 `localStorage`（如 runtimes/custom-pricing-store），则保持一致即可。

- [ ] **Step 3: 确认 core 是否已有 localStorage 用法先例**

Run:
```bash
cd /home/mini/workspace/costrict-space/mini-cloud
grep -rn "localStorage" packages/core/ --include="*.ts" | grep -v test | grep -v node_modules | head
```
Expected: 看 `custom-pricing-store` 等。若已有先例直接用 localStorage，则 Step 2 代码合规。

- [ ] **Step 4: typecheck**

Run:
```bash
pnpm --filter @multica/core typecheck
```
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git -c core.autocrlf=false add packages/core/efficiency/view-state-store.ts
git -c core.autocrlf=false commit -m "feat(efficiency): add view-state store for global time range"
```

---

### Task 0.5：创建 mock 基础设施

**Files:**
- Create: `packages/core/efficiency/mock/index.ts`

mock 在 queryOptions 层注入，需一个全局开关 + 按查询 key 分发。

- [ ] **Step 1: 编写 mock/index.ts 开关与分发骨架**

```typescript
// packages/core/efficiency/mock/index.ts
// Mock data layer. Injected at the queryOptions layer (see queries.ts):
// when MOCK_ENABLED is true, queryFn returns mock data instead of hitting
// the API. Flip to false (or set EFFICIENCY_MOCK=0 in env) once the
// backend /api/v2/efficiency/* endpoints are live.
import type { DashboardSummary, DashboardTrends } from "../types";
import { getMockDashboardSummary, getMockDashboardTrends } from "./dashboard";

const RAW = process.env.EFFICIENCY_MOCK;
// Default: mock ON (backend not yet live). Set EFFICIENCY_MOCK=0 to disable.
export const MOCK_ENABLED = RAW == null ? true : RAW !== "0" && RAW !== "false";

// Central dispatcher: queries.ts calls mock(key, params) keyed by query name.
// Each domain (dashboard/usage/cost/...) owns its own mock module.
export const mock = {
  dashboardSummary: (p: { startDate?: string; endDate?: string }): DashboardSummary =>
    getMockDashboardSummary(p),
  dashboardTrends: (p: { startDate?: string; endDate?: string }): DashboardTrends =>
    getMockDashboardTrends(p),
  // TODO(slice3+): add usage/cost/contribution/detail mock entry points as
  // those slices land. Each follows the same shape.
} as const;
```

- [ ] **Step 2: typecheck（会失败，因为 ./dashboard 尚未创建）**

预期失败——这是 TDD 的红阶段。先创建占位 dashboard mock 让它编译。

- [ ] **Step 3: 创建 mock/dashboard.ts 占位（带真实结构样本）**

```typescript
// packages/core/efficiency/mock/dashboard.ts
import type { DashboardSummary, DashboardTrends } from "../types";

// Sample data modeled on the source backend's /v2/dashboard/summary response.
// Numbers are illustrative; structure matches DashboardSummary type exactly
// so the Overview page renders meaningfully during the mock phase.
export function getMockDashboardSummary(_p: { startDate?: string; endDate?: string }): DashboardSummary {
  return {
    total_repos: 42,
    total_branchs: 86,
    total_users: 28,
    total_users_v2: 31,
    total_needs: 156,
    merged_needs: 98,
    eligible_needs: 72,
    total_commits: 1240,
    total_commit_lines: 89400,
    ai_code_ratio: 0.34,
    ai_penetration_rate: 0.61,
    ai_coverage_rate: 0.48,
    // spread remaining optional fields per type as needed during slice 2
  } as DashboardSummary;
}

export function getMockDashboardTrends(_p: { startDate?: string; endDate?: string }): DashboardTrends {
  // 8 weekly points — enough for the trend card sparkline.
  const points = Array.from({ length: 8 }, (_, i) => ({
    week: `W${i + 1}`,
    active_users: 18 + Math.round(Math.sin(i) * 4 + i),
    commit_diff_lines: 8200 + i * 320,
  }));
  return {
    points,
    compare: { usage: 0.12, contribution: -0.05 },
  } as DashboardTrends;
}
```

注意：`DashboardSummary` / `DashboardTrends` 的字段以迁移后的 `types.ts` 实际定义为准。若字段不匹配，按 types.ts 修正 mock（用 `as DashboardSummary` 过渡，slice 2 精确对齐）。

- [ ] **Step 4: typecheck**

Run:
```bash
pnpm --filter @multica/core typecheck
```
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git -c core.autocrlf=false add packages/core/efficiency/mock/
git -c core.autocrlf=false commit -m "feat(efficiency): add mock infrastructure with dashboard samples"
```

---

### Task 0.6：创建 api.ts（端点方法）

**Files:**
- Create: `packages/core/efficiency/api.ts`
- Source ref: `efficiency-dashboard/frontend-react/src/api/endpoints.ts`

端点方法调 `getApi()`（目标项目单例），路径 `/api/v2/efficiency/*`。mock 阶段 queryFn 不走这里，但方法需存在以便后端就绪后切真。

- [ ] **Step 1: 查看 getApi 用法**

Run:
```bash
cd /home/mini/workspace/costrict-space/mini-cloud
grep -n "getApi()\|fetch<\|this.fetch" packages/core/api/index.ts packages/core/api/client.ts | head
```
确认 `getApi()` 返回的 client 有 `fetch<T>(path)` 方法。

- [ ] **Step 2: 编写 api.ts**

```typescript
// packages/core/efficiency/api.ts
// Endpoint methods for /api/v2/efficiency/*. Calls go through the shared
// api singleton (getApi) — same domain, no separate axios instance (the
// source project's /kanban/api baseURL and chat-proxy channel are dropped;
// the mini-cloud backend will mount these under /api/v2/efficiency).
import { getApi } from "../api";
import type {
  DashboardSummary,
  DashboardTrends,
  GlobalConfig,
} from "./types";

// Base path for all efficiency endpoints. Backend will mount routes here.
const BASE = "/api/v2/efficiency";

function qs(params: Record<string, string | undefined>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : "";
}

export async function getDashboardSummary(p: {
  startDate?: string;
  endDate?: string;
}): Promise<DashboardSummary> {
  return getApi().fetch<DashboardSummary>(`${BASE}/dashboard/summary${qs({ start_date: p.startDate, end_date: p.endDate })}`);
}

export async function getDashboardTrends(p: {
  startDate?: string;
  endDate?: string;
}): Promise<DashboardTrends> {
  return getApi().fetch<DashboardTrends>(`${BASE}/dashboard/trends${qs({ start_date: p.startDate, end_date: p.endDate })}`);
}

export async function getGlobalConfig(): Promise<GlobalConfig> {
  return getApi().fetch<GlobalConfig>(`${BASE}/config`);
}

// TODO(slice3-6): add remaining endpoints (users/repos/dept-tree/needs/
// commits/tasks/projects/cost/contribution) following the same pattern,
// one function per source endpoint in endpoints.ts.
```

- [ ] **Step 3: 确认 getApi().fetch 签名匹配**

Run:
```bash
cd /home/mini/workspace/costrict-space/mini-cloud
grep -n "fetch<\|public fetch\|protected fetch\|async fetch" packages/core/api/client.ts | head
```
确认 `fetch<T>(path: string): Promise<T>` 存在。若签名是 `fetch<T>(path, init?)` 调整。

- [ ] **Step 4: typecheck**

Run:
```bash
pnpm --filter @multica/core typecheck
```
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git -c core.autocrlf=false add packages/core/efficiency/api.ts
git -c core.autocrlf=false commit -m "feat(efficiency): add api endpoint methods (/api/v2/efficiency/*)"
```

---

### Task 0.7：创建 queries.ts（queryOptions 工厂）

**Files:**
- Create: `packages/core/efficiency/queries.ts`
- Source ref: `efficiency-dashboard/frontend-react/src/api/queries.ts`（30 个 hooks）
- Test: `packages/core/efficiency/queries.test.ts`

把源项目的 `useXxx` hooks 改写为目标项目的 `xxxOptions`（queryOptions 工厂），由 views 层 `useQuery(...)` 调用。mock 在这里注入。

- [ ] **Step 1: 编写 queries.ts（先覆盖 dashboard/config，其余切片补）**

```typescript
// packages/core/efficiency/queries.ts
import { queryOptions } from "@tanstack/react-query";
import { getDashboardSummary, getDashboardTrends, getGlobalConfig } from "./api";
import { MOCK_ENABLED, mock } from "./mock";

// Query keys — workspace-scoped (wsId first) so cache is isolated per workspace,
// matching the architectural rule "workspace-scoped queries must key on wsId".
export const efficiencyKeys = {
  all: (wsId: string) => ["efficiency", wsId] as const,
  summary: (wsId: string, startDate?: string, endDate?: string) =>
    [...efficiencyKeys.all(wsId), "summary", startDate, endDate] as const,
  trends: (wsId: string, startDate?: string, endDate?: string) =>
    [...efficiencyKeys.all(wsId), "trends", startDate, endDate] as const,
  config: (wsId: string) => [...efficiencyKeys.all(wsId), "config"] as const,
};

const STALE_TIME = 60 * 1000; // 1 min — matches dashboard rollup cadence

export function dashboardSummaryOptions(
  wsId: string,
  startDate?: string,
  endDate?: string,
) {
  return queryOptions({
    queryKey: efficiencyKeys.summary(wsId, startDate, endDate),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.dashboardSummary({ startDate, endDate });
      return getDashboardSummary({ startDate, endDate });
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function dashboardTrendsOptions(
  wsId: string,
  startDate?: string,
  endDate?: string,
) {
  return queryOptions({
    queryKey: efficiencyKeys.trends(wsId, startDate, endDate),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.dashboardTrends({ startDate, endDate });
      return getDashboardTrends({ startDate, endDate });
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function globalConfigOptions(wsId: string) {
  return queryOptions({
    queryKey: efficiencyKeys.config(wsId),
    queryFn: async () => {
      // config has no mock variant in slice 0; return a sensible default
      // during mock phase, hit API when disabled.
      if (MOCK_ENABLED) {
        return {
          traditional_dev_lines_per_day: 500,
          cost_per_person_day: 2000,
          dashboard_title_prefix: "",
          chat_stats_enabled: false,
        };
      }
      return getGlobalConfig();
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

// TODO(slice3-6): add deptTree/deptRanking/deptOverview/users/repos/needs/
// commits/tasks/projects/cost/contribution options, one per source hook.
```

- [ ] **Step 2: 编写测试验证 queryKey 结构**

```typescript
// packages/core/efficiency/queries.test.ts
import { describe, it, expect } from "vitest";
import { efficiencyKeys } from "./queries";

describe("efficiencyKeys", () => {
  it("scopes all keys under wsId", () => {
    expect(efficiencyKeys.all("ws1")).toEqual(["efficiency", "ws1"]);
  });

  it("nests summary under wsId + dates", () => {
    expect(efficiencyKeys.summary("ws1", "2026-01-01", "2026-01-31")).toEqual([
      "efficiency", "ws1", "summary", "2026-01-01", "2026-01-31",
    ]);
  });

  it("config key is stable", () => {
    expect(efficiencyKeys.config("ws1")).toEqual(["efficiency", "ws1", "config"]);
  });
});
```

- [ ] **Step 3: 运行测试**

Run:
```bash
pnpm --filter @multica/core exec vitest run efficiency/queries.test.ts
```
Expected: 3 tests PASS

- [ ] **Step 4: typecheck**

Run:
```bash
pnpm --filter @multica/core typecheck
```
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git -c core.autocrlf=false add packages/core/efficiency/queries.ts packages/core/efficiency/queries.test.ts
git -c core.autocrlf=false commit -m "feat(efficiency): add queryOptions factories with mock injection"
```

---

### Task 0.8：创建 hooks.ts

**Files:**
- Create: `packages/core/efficiency/hooks.ts`
- Source ref: `efficiency-dashboard/frontend-react/src/hooks/{useCountUp,useUserNameMap,useEntityObjects}.ts`

注意：`useEChart` 不迁（ECharts 专用）。`useTheme` 需评估——目标项目有自己的主题机制，可能不迁。

- [ ] **Step 1: 查看源 hooks 内容**

Run:
```bash
wc -l /home/mini/workspace/costrict-space/efficiency-dashboard/frontend-react/src/hooks/*.ts /home/mini/workspace/costrict-space/efficiency-dashboard/frontend-react/src/hooks/*.tsx
```

- [ ] **Step 2: 迁移 useCountUp（纯逻辑，无 DOM）**

读取源 `useCountUp.ts`，复制到 `packages/core/efficiency/hooks.ts`，调整导入路径。这是数字滚动动画 hook（用 requestAnimationFrame），但 requestAnimationFrame 是 DOM API —— 若 core 禁止 DOM，此 hook 应移到 views 层。检查：

```bash
cd /home/mini/workspace/costrict-space/mini-cloud
grep -rn "requestAnimationFrame\|window\.\|document\." packages/core/ --include="*.ts" | grep -v test | grep -v node_modules | head
```
若 core 无 DOM 先例，把 useCountUp 放到 `packages/views/efficiency/hooks/` 而非 core。

- [ ] **Step 3: 迁移 useUserNameMap、useEntityObjects（数据 hooks，调 query）**

这两个 hook 调用 query hooks，改写为基于 `useQuery(xxxOptions)`。先建占位（slice 3 补全依赖的 options）：

```typescript
// packages/core/efficiency/hooks.ts
// NOTE: data hooks (useUserNameMap, useEntityObjects) depend on options
// added in later slices. Stubbed here, filled as their backing endpoints land.
export {};
```

- [ ] **Step 4: typecheck + 提交**

```bash
pnpm --filter @multica/core typecheck
git -c core.autocrlf=false add packages/core/efficiency/hooks.ts
git -c core.autocrlf=false commit -m "feat(efficiency): add hooks module (data hooks added per-slice)"
```

---

### Task 0.9：创建 index.ts 统一导出 + 全量验证

**Files:**
- Create: `packages/core/efficiency/index.ts`

- [ ] **Step 1: 编写 index.ts**

```typescript
// packages/core/efficiency/index.ts
export * from "./types";
export * from "./utils";
export * from "./queries";
export * from "./api";
export * from "./view-state-store";
export { MOCK_ENABLED } from "./mock";
```

注意：hooks 暂不导出（Task 0.8 为空 stub）。

- [ ] **Step 2: 检查导出冲突**

`types` 和 `utils` 可能有同名导出。运行：
```bash
pnpm --filter @multica/core typecheck
```
若有 "Duplicate identifier" 或 "Export conflict"，用命名空间隔离（`export * as utils from "./utils"`）。

- [ ] **Step 3: 全量验证切片 0**

Run:
```bash
cd /home/mini/workspace/costrict-space/mini-cloud
pnpm --filter @multica/core typecheck
pnpm --filter @multica/core test
```
Expected: 全部 PASS

- [ ] **Step 4: 提交**

```bash
git -c core.autocrlf=false add packages/core/efficiency/index.ts
git -c core.autocrlf=false commit -m "feat(efficiency): add barrel export, complete slice 0 foundation"
```

---

## 切片 1：共享 UI 基础件（views/efficiency/components + charts）

> 为切片 2（Overview）准备图表与卡片基础件。

### Task 1.1：确认 KpiCard 复用并建立 components 导出

**Files:**
- Create: `packages/views/efficiency/components/index.ts`
- Ref: `packages/views/runtimes/components/shared`（KpiCard 所在）

- [ ] **Step 1: 确认 KpiCard 导出路径**

Run:
```bash
cd /home/mini/workspace/costrict-space/mini-cloud
grep -rn "export.*KpiCard\|KpiCard" packages/views/runtimes/components/shared* packages/views/runtimes/components/index.ts 2>/dev/null | head
```

- [ ] **Step 2: 在 efficiency 组件中 re-export 或直接引用**

决策：直接从 runtimes 引用（`import { KpiCard } from "../runtimes/components/shared"`），不 re-export，避免制造多余间接层。若 KpiCard 位置不便跨域引用，复制一份到 `views/efficiency/components/kpi-card.tsx`（基于 shadcn Card）。

- [ ] **Step 3: 提交占位 index.ts**

```typescript
// packages/views/efficiency/components/index.ts
// Shared efficiency UI building blocks. KpiCard is reused from runtimes;
// executive cards (HeroSaving, TrendCard, etc.) added in slice 2.
export {};
```

---

### Task 1.2：创建 recharts 图表基础封装

**Files:**
- Create: `packages/views/efficiency/charts/trend-chart.tsx`
- Create: `packages/views/efficiency/charts/bar-chart.tsx`
- Create: `packages/views/efficiency/charts/index.ts`
- Ref: `packages/views/runtimes/components/charts/daily-tokens-chart.tsx`（范式参照）

基于目标项目 `ChartContainer` + `ChartTooltip` + `var(--chart-1..4)`。**每个图表组件只接收 `data` props，不自带空状态**（父组件决定，与 runtimes 惯例一致）。

- [ ] **Step 1: 编写 trend-chart.tsx（折线/面积趋势）**

```typescript
// packages/views/efficiency/charts/trend-chart.tsx
"use client";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@multica/ui/components/ui/chart";

export interface TrendPoint {
  label: string;
  value: number;
}

const config = {
  value: { label: "Value", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function TrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <ChartContainer config={config} className="aspect-[3/1] w-full">
      <AreaChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={50} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area dataKey="value" type="monotone" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.2} />
      </AreaChart>
    </ChartContainer>
  );
}
```

- [ ] **Step 2: 编写 bar-chart.tsx（横向柱状，用于部门 PK / 排行）**

```typescript
// packages/views/efficiency/charts/bar-chart.tsx
"use client";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@multica/ui/components/ui/chart";

export interface BarDatum {
  label: string;
  value: number;
}

const config = { value: { label: "Value", color: "var(--chart-1)" } } satisfies ChartConfig;

export function HBarChart({ data }: { data: BarDatum[] }) {
  return (
    <ChartContainer config={config} className="h-[var(--recharts-height,300px)] w-full">
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 8, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis dataKey="label" type="category" tickLine={false} axisLine={false} width={90} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="value" fill="var(--chart-1)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
```

- [ ] **Step 3: 编写 index.ts**

```typescript
export { TrendChart } from "./trend-chart";
export { HBarChart } from "./bar-chart";
export type { TrendPoint, BarDatum };
```

- [ ] **Step 4: typecheck**

Run:
```bash
pnpm --filter @multica/views typecheck
```
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git -c core.autocrlf=false add packages/views/efficiency/charts/
git -c core.autocrlf=false commit -m "feat(efficiency): add recharts trend/bar chart wrappers"
```

---

## 切片 2：总览大屏（Overview）

> 端到端样板：第一个完整页面，验证 mock → query → 组件 → 路由全链路。

### Task 2.1：补全 dashboard mock 数据（精确对齐 types）

**Files:**
- Modify: `packages/core/efficiency/mock/dashboard.ts`

slice 0 的 mock 是占位，现在按 Overview 实际需要的字段精确填充（HeroSaving/PlatformObjective/Scorecard/Trend/DeptPK/TopRank/Counts 各卡的输入）。

- [ ] **Step 1: 读取源 Overview 依赖的数据字段**

Run:
```bash
grep -h "summary\.\|trends\.\|data\.\|s\.\.\|points\." /home/mini/workspace/costrict-space/efficiency-dashboard/frontend-react/src/pages/Overview.tsx /home/mini/workspace/costrict-space/efficiency-dashboard/frontend-react/src/components/executive/*.tsx | sort -u | head -40
```
列出所有从 summary/trends 读取的字段。

- [ ] **Step 2: 按字段清单填充 mock/dashboard.ts**

对照 DashboardSummary / DashboardTrends 类型与 Step 1 的字段，补全 mock 返回值（合理样本数据）。

- [ ] **Step 3: typecheck（确保 mock 返回值类型匹配）**

Run: `pnpm --filter @multica/core typecheck` — 移除 `as DashboardSummary` 断言，让类型检查保证字段完整。

- [ ] **Step 4: 提交**

```bash
git -c core.autocrlf=false add packages/core/efficiency/mock/dashboard.ts
git -c core.autocrlf=false commit -m "feat(efficiency): flesh out dashboard mock data for Overview"
```

---

### Task 2.2：重写 9 张高管卡

**Files:**
- Create: `packages/views/efficiency/components/{hero-saving,platform-objective-card,scorecard-strip,ai-penetration-card,trend-card,dept-pk-card,top-rank-card,counts-card,metric-scorecard}.tsx`
- Source ref: `efficiency-dashboard/frontend-react/src/components/executive/*.tsx`（9 个文件）

逐个重写：逻辑（数据组装/环比）从源迁，样式换语义 token。**每张卡接收 props（startDate/endDate 或 data），内部调 query**（与源项目一致）。

- [ ] **Step 1: 重写 MetricScorecard（基础件，其余卡复用）**

参照源 `MetricScorecard.tsx`，改 shadcn `Card` + 语义 token + `TrendChart` sparkline。用 `text-brand`/`text-muted-foreground`。

- [ ] **Step 2: 重写 HeroSaving**

源 197 行。核心：省人天/净节省/综合提效三指标。调 `useQuery(dashboardSummaryOptions)`。样式换 `bg-card`/`text-brand`。

- [ ] **Step 3: 重写 PlatformObjectiveCard、ScorecardStrip、AIPenetrationCard、TrendCard、DeptPKCard、TopRankCard、CountsCard**

每个：读源组件逻辑 → 用 shadcn + recharts 重写 → typecheck。DeptPKCard/TopRankCard 用 Task 1.2 的 `HBarChart`。

- [ ] **Step 4: 每张卡 typecheck + 提交**

每完成 1-2 张卡：
```bash
pnpm --filter @multica/views typecheck
git -c core.autocrlf=false add packages/views/efficiency/components/
git -c core.autocrlf=false commit -m "feat(efficiency): rewrite <card-name> with shadcn/recharts"
```

---

### Task 2.3：组装 overview-page + 接入路由

**Files:**
- Create: `packages/views/efficiency/overview-page.tsx`
- Create: `apps/web/app/[workspaceSlug]/(dashboard)/metrics/page.tsx`
- Source ref: `efficiency-dashboard/frontend-react/src/pages/Overview.tsx`

- [ ] **Step 1: 编写 overview-page.tsx**

参照源 Overview.tsx 的 Bento 12 列网格结构，组装 9 张卡。用 `useWorkspaceId()` 拿 wsId，`useViewState()` 拿时间范围。**页面自管 PageHeader + 日期选择**（不放全局顶部）。

```typescript
// packages/views/efficiency/overview-page.tsx
"use client";
import { useWorkspaceId } from "@multica/core/hooks";
import { useViewState } from "@multica/core/efficiency";
import { PageHeader } from "../layout/page-header";
// ... import 9 cards
```

- [ ] **Step 2: 创建路由 page.tsx**

```typescript
// apps/web/app/[workspaceSlug]/(dashboard)/metrics/page.tsx
export { OverviewPage as default } from "@multica/views/efficiency";
```
（在 `views/efficiency/index.ts` 导出 `OverviewPage`）

- [ ] **Step 3: 端到端验证**

Run:
```bash
pnpm typecheck
pnpm dev:web  # 手动访问 /{ws}/metrics 确认 mock 数据渲染
```

- [ ] **Step 4: 提交**

```bash
git -c core.autocrlf=false add packages/views/efficiency/overview-page.tsx "apps/web/app/[workspaceSlug]/(dashboard)/metrics/page.tsx" packages/views/efficiency/index.ts
git -c core.autocrlf=false commit -m "feat(efficiency): wire Overview page to /metrics route"
```

---

## 切片 3：usage 使用维度

> usage 维度：部门树 + 视角切换（部门聚合/对比/成员）。

### Task 3.1：补全 usage 相关 query options + mock + api

**Files:**
- Modify: `packages/core/efficiency/{queries,api,mock/usage}.ts`
- Source ref: 源 `useDeptTree/useDeptOverview/useDeptRanking/useDeptTreeMembers/useDeptTreeTrend`

按 Task 0.5-0.7 同样模式，为 dept-tree 5 个端点补 options（`deptTreeOptions`/`deptOverviewOptions`/`deptRankingOptions`/`deptMembersOptions`/`deptTrendOptions`）+ mock + api 方法。每个 typecheck + 提交。

### Task 3.2：重写 usage 维度组件

**Files:**
- Create: `packages/views/efficiency/usage/{usage-kanban,dept-aggregate-view,dept-compare-view,members-view,member-detail,dept-tree-panel}.tsx`
- Source ref: `efficiency-dashboard/frontend-react/src/pages/dimensions/usage/*.tsx`（6 个）

主体切换用 shadcn `Tabs`（org/user/project/repo 内部 Tab，不进 URL）。部门树用 shadcn `Tree` 或 `Collapsible`。

### Task 3.3：接入 usage 路由

**Files:**
- Modify: `apps/web/app/[workspaceSlug]/(dashboard)/usage/page.tsx`（当前导出 DashboardPage，改为 UsageKanban）

```typescript
export { UsageKanban as default } from "@multica/views/efficiency";
```

验证：`/{ws}/usage` 部门树+视角切换可用。提交。

---

## 切片 4：efficiency / cost 维度

### Task 4.1：efficiency 维度

**Files:**
- Create: `packages/views/efficiency/efficiency/{efficiency-dimension,efficiency-user-ranking,efficiency-repo-ranking}.tsx`
- Source ref: 源 `pages/dimensions/EfficiencyDimension.tsx` + `Efficiency*Ranking.tsx`
- Modify: `apps/web/.../metrics/efficiency/page.tsx`

补 `efficiencyAggregateOptions`（源 `useEfficiencyV2`）+ mock。重写组件（时间线→KPI→排行/明细）。替换路由占位。提交。

### Task 4.2：cost 维度

**Files:**
- Create: `packages/views/efficiency/cost/{cost-kanban,cost-aggregate-view,cost-compare-view,cost-members-view}.tsx`
- Source ref: 源 `pages/dimensions/cost/*.tsx`（4 个）
- Modify: `apps/web/.../metrics/cost/page.tsx`

源 cost 对接 10 个 `/cost/*` 接口。补 options + mock（成本数据样本）。重写组件。替换路由占位。提交。

---

## 切片 5：contribution 维度 + 下钻详情页

### Task 5.1：contribution 维度

**Files:**
- Create: `packages/views/efficiency/contribution/{contribution-dimension,org-contribution,user-contribution,project-contribution,repo-contribution}.tsx`
- Source ref: 源 `pages/dimensions/contribution/*.tsx`（5 个）
- Modify: `apps/web/.../metrics/contribution/page.tsx`

contribution 是"零平台请求"派生（合并需求/代码行/提交/贡献者）。重写组件，热力图用 GitHub 风格网格（参考 `runtimes/components/charts/activity-heatmap.tsx`）。提交。

### Task 5.2：下钻详情页（7 个）

**Files:**
- Create: `packages/views/efficiency/detail/{user-detail,repo-detail,project-detail,need-detail,task-detail,commit-detail,workdir-detail}.tsx`
- Create: `apps/web/.../metrics/{user,repo,project,need,task,commit}/[id]/page.tsx`（7 个路由）
- Source ref: 源 `pages/{users,repos,projects,needs,tasks,commits,workdir}/*Detail.tsx`

每个详情页：补对应 `useXxxDetail` options + mock → 重写组件（含返回按钮、shadcn `DataTable`/`Tabs`）→ 创建路由。逐个 typecheck + 提交。

注意路由段：`metrics/user/[userId]`、`metrics/repo/[...addr]`（repo 地址含斜杠用 catch-all）、`metrics/project/[projectId]`、`metrics/need/[needId]`、`metrics/task/[taskId]`、`metrics/commit/[commitId]`。

---

## 切片 6：设置与平台运维页

### Task 6.1：设置区 4 页

**Files:**
- Create: `packages/views/efficiency/settings/{pricing,datasources,sync-tasks,system-config}.tsx`
- Create: `apps/web/.../settings/{pricing,datasources,sync,config}/page.tsx`
- Source ref: 源 `pages/settings/{Pricing,Datasources,SyncTasks,SystemConfig}.tsx`

补 `chatPricing/chatDatasources/chatSyncTasks/chatSystemConfig` options + mock（mock 阶段返回合理默认）。重写组件（表格/表单用 shadcn `DataTable`/`Form`/`Input`）。创建路由。提交。

### Task 6.2：平台运维 4 页

**Files:**
- Create: `packages/views/efficiency/settings/platform/{platform-overview,platform-health,realtime-report,realtime-query}.tsx`
- Create: `apps/web/.../settings/platform/{overview,health,realtime,realtime/query}/page.tsx`
- Source ref: 源 `pages/platform/{PlatformOverview,PlatformHealth,RealtimeReport,RealtimeQuery}.tsx`（含 2138 行的 RealtimeQuery）

PlatformOverview（1060 行）与 RealtimeQuery（2138 行）是最大的两个文件。按 Tab 拆分重写（源用 PerformanceTab/TimeDistributionTab）。chat_stats_enabled=false 时优雅降级（与源 SettingsLayout 一致）。逐页 typecheck + 提交。

---

## 切片 7：导航接线 + 收尾

### Task 7.1：补全 paths.ts 路径方法

**Files:**
- Modify: `packages/core/paths/paths.ts`

- [ ] **Step 1: 检查现有 paths.ts 是否覆盖新路由**

Run:
```bash
cd /home/mini/workspace/costrict-space/mini-cloud
grep -n "metrics\|usage\|settings" packages/core/paths/paths.ts
```
现有已有 `metricsEfficiency` 等。补 `metricsOverview`（→ `/{ws}/metrics`）、`metricsUser`/`metricsRepo` 等详情路径方法（若有导航需要）。

### Task 7.2：确认 app-sidebar 导航项

**Files:**
- Modify: `packages/views/layout/app-sidebar.tsx`（仅 label/icon 调整，路由已存在）

确认 metrics_group 6 项指向正确页面（usage/efficiency/cost/contribution 已替换为真实实现，quality/coverage 保持占位）。

### Task 7.3：补充 i18n label

**Files:**
- Modify: `packages/views/locales/{en,zh-Hans}/layout.json`

为新增的 metrics 根（Overview）、settings 子页补 label key（若 sidebar 引用了新 labelKey）。

### Task 7.4：全量验证

- [ ] **Step 1: make check**

Run:
```bash
cd /home/mini/workspace/costrict-space/mini-cloud
make check
```
Expected: typecheck + unit test + Go test + E2E 全绿

- [ ] **Step 2: 手动逐路由验证**

`pnpm dev:web`，访问所有新增路由确认 mock 渲染。

- [ ] **Step 3: 提交收尾**

```bash
git -c core.autocrlf=false add -A
git -c core.autocrlf=false commit -m "feat(efficiency): complete navigation wiring and i18n labels"
```

---

## 切换到真实后端（切片 7 之后，后端就绪时）

当后端 `/api/v2/efficiency/*` 就绪：

- [ ] 设置 `EFFICIENCY_MOCK=0`（或移除默认 true）
- [ ] 在各 queryFn 的真接口分支加 `parseWithFallback` + zod schema（目标 CLAUDE.md 强制）
- [ ] 对照后端响应校准 `types.ts`（源 types 是旧契约，可能需调整）
- [ ] 逐端点联调

---

## 备注

- **源项目参考路径**：`/home/mini/workspace/costrict-space/efficiency-dashboard/frontend-react/src/`（所有"Source ref"相对于此）
- **逐步验证**：每个 Task 后立即 typecheck，不攒着
- **复用优先**：写新组件前先 grep 目标项目是否已有（`@multica/ui/components/ui/*`）
- **Git**：所有 git 命令带 `-c core.autocrlf=false`
- **评论英文**：代码注释英文，中文产品文案走 i18n

# 效能看板前端迁移计划（efficiency-dashboard → multica）

> **For agentic workers:** 本计划按里程碑执行，任务用 `- [ ]` 跟踪。源码在 `costrict-space/efficiency-dashboard/frontend-react/`，目标 multica 仓库。

## 定位

`efficiency-dashboard` 后端线上现成、数据真实（同系列产品）。本任务**只重写前端**到 multica：shadcn + recharts + 直连线上 API。不做后端、不做反代、不动线上服务。

**已锁定决策（不再讨论）：**

| 项 | 决策 |
|---|---|
| API | 前端**直连**线上 efficiency-dashboard API；dev 用 `next.config.js` rewrites 转发规避 CORS；线上靠 CORS 放行 multica origin |
| 组件 | **shadcn / Base UI**，源自研 UI（Glass/MetricCard/Modal…）一律换 shadcn 等价件，不搬运 |
| 图表 | **recharts（shadcn charts）**；折线/柱/饼/面积/表格照搬；分布直方图·双轴趋势·热力图 3 个复杂图先简化占位 |
| 数据层 | `api/{client,endpoints,queries,types}.ts` **原样搬**到 `packages/core/metrics/`，只改 baseURL；types（1346 行，对齐后端 struct）不改 |
| 口径 | 提效比 helper（百分比/小数两套）、`RatioPill`/`PercentPill`、covered/total 先和后比——**原样保留，不自创** |
| i18n | 可用版阶段**中文硬编码**，打磨阶段统一抽 `metrics` namespace |

**范围：** Tier 1 = 总览 + 效能/成本/贡献/覆盖（+usage），填 multica「效能度量」5 占位。Tier 2（needs/users/repos/projects 详情）/ Tier 3（platform/settings）另行排期。

## 工作量（单人，AI 辅助）

| 阶段 | 乐观 | 保守 |
|---|---|---|
| P0 一次性基建 + 跑通 Cost | 1 天 | 2 天 |
| P1 可用粗版（+4 页，照搬 P0 模式） | 1 天 | 2 天 |
| **→ 可用粗版交付** | **2 天** | **3 天** |
| P2 打磨（i18n + 状态 + 复杂图 + 降级） | 2 天 | 3 天 |
| **→ Tier 1 完整** | ~4 天 | **~1 周** |

**对外口径：可用粗版 3 天内，Tier 1 完整一周。**

---

## P0 一次性基建 + 跑通 Cost（1~2 天）

风险集中在此：CORS / auth shim / 数据形状首次联调。跑通 1 页后，P1 即为复制。

- [ ] **P0-1 数据层搬运**
  - 新建 `packages/core/metrics/{client.ts,endpoints.ts,queries.ts,types.ts}`，从 `efficiency-dashboard/frontend-react/src/api/*` 原样复制
  - `client.ts` baseURL 改为相对 `/kanban/api`（dev 由 rewrite 转发）；chat 实例 baseURL `/kanban/api/v2/chat`
  - `pnpm-workspace.yaml` catalog 加 `axios`（multica 若未用）
  - 导出 `packages/core/metrics/index.ts`
- [ ] **P0-2 dev rewrites**
  - `apps/web/next.config.js` 加 rewrite：`/kanban/api/*` → `${METRICS_API_BASE}/kanban/api/*`（线上地址走 env）
- [ ] **P0-3 图表基座**
  - 新建 `packages/views/metrics/charts/{line-trend.tsx,bar-series.tsx,pie-share.tsx,area-series.tsx,chart-card.tsx,empty-hint.tsx}`
  - 取语义 token 配色（对齐源 `chartTheme.ts` 的品牌色），recharts ResponsiveContainer
- [ ] **P0-4 共享件**
  - `packages/views/metrics/components/{kpi-card.tsx,section-card.tsx,period-picker.tsx}`（shadcn Card + Select）
  - 时间范围/主体切换用 Next `searchParams`
- [ ] **P0-5 跑通 Cost 页**
  - `packages/views/metrics/cost/cost-page.tsx`（移植 `cost/CostAggregateView.tsx` 的布局，换 shadcn + recharts）
  - `apps/web/app/[workspaceSlug]/(dashboard)/metrics/cost/page.tsx` 挂载
  - 验证：浏览器看到真实成本趋势 + 模型占比
- [ ] **P0-6 验证**：curl 线上 `/kanban/api/v2/...` 通；Cost 页真实数据画出

---

## P1 可用粗版（1~2 天）

**搬页标准流程（每页照做）：**
1. 读源页 + 其调用的 endpoints/types/components
2. 在 `packages/views/metrics/<dim>/` 重建组件，shadcn 换 UI、recharts 换图
3. 复用 P0 的图表基座 + 共享件
4. 挂 `apps/web/.../metrics/<dim>/page.tsx`
5. 浏览器验证真实数据

复杂图（直方/双轴/热力）这一阶段先用普通柱/折线占位，标注 TODO。

- [ ] **P1-1 总览 Overview**（`Overview.tsx`）
  - Hero 省人天/ROI + 趋势 + Top 榜 + 规模概览
  - 顺带把 multica Home 页的 mock「效能统计」换成真实数据
- [ ] **P1-2 效能 Efficiency**（`EfficiencyDimension.tsx`）
  - 周趋势 + 速览卡 + 用户/仓库排行；分布直方图先简化为柱状
- [ ] **P1-3 贡献 Contribution**（`ContributionDimension.tsx` + `contrib/*`）
  - 组织/用户/项目/仓库贡献排行 + 周时序
- [ ] **P1-4 覆盖 Coverage / 使用**（`usage/UsageKanban.tsx`）
  - AI 渗透率/覆盖率卡；部门树依赖 dept-sync，未开则空着
- [ ] **P1-5 验收**：5 页可进、真实数据、基础图、导航 + 时间范围切换可用；中文硬编码；空态/错误态最简兜底

→ **可用粗版交付**

---

## P2 打磨（2~3 天）

- [ ] i18n：抽 `metrics` namespace（en + zh-Hans 同步，过 `locales/parity.test.ts`，注册 `locales/index.ts` + `resources-types.ts`）
- [ ] 空态 / loading / 错误态完备
- [ ] 复杂图补齐：分布直方图（堆叠）、双轴趋势、热力图——按需 scoped 引 ECharts
- [ ] chat-stats / dept-sync 未启用时的降级提示
- [ ] 表格排序/分页、响应式、细节对齐

→ **Tier 1 完整**

---

## P3（可选，另行排期）Tier 2 实体详情

needs / users / repos / projects / orgs 列表与详情页，作为维度页下钻。估 +1~2 周。

---

## 关键文件锚点

**数据层（P0-1）**
- 源：`efficiency-dashboard/frontend-react/src/api/{client,endpoints,queries,types}.ts`
- 目标：`packages/core/metrics/`

**Tier 1 页面（P1）**
- 源：`src/pages/Overview.tsx`、`src/pages/dimensions/{EfficiencyDimension.tsx,cost/*,ContributionDimension.tsx,usage/*}`、`src/pages/distribution/*`
- 目标：`packages/views/metrics/<dim>/` + `apps/web/app/[workspaceSlug]/(dashboard)/metrics/<dim>/page.tsx`

**口径真相源（搬页时必读，勿改）**
- `src/api/types.ts` 头注释、各页头注释、`src/components/ui/{PercentPill,RatioPill}.tsx`、`src/lib/formatters.ts`

## 风险与对策

| 风险 | 对策 |
|---|---|
| 首次联调（CORS/auth/数据形状）卡住 | 全部压到 P0；跑通 Cost 再铺开；dev rewrites 规避 CORS |
| 复杂图 recharts 做不好 | P1 先简化占位，P2 按需 scoped ECharts |
| 口径踩坑（百分比/小数、先和后比） | helper 原样搬；types.ts 注释为准 |
| chat-stats/dept-sync 未开导致整页空 | P1 先空着，P2 加降级提示 |
| 线上 API 地址 / CORS 未定 | 开工前必须确认（见下一步） |

## 开工前确认

1. **线上 efficiency-dashboard API 地址**（base URL，配 rewrite + CORS）
2. **可用版是否进主干**（进→按完整一周排，过 i18n+测试；只演示→按 2~3 天）
3. 复杂图先简化占位——已默认按此执行，如不同意请说明

确认后启动 P0-1。

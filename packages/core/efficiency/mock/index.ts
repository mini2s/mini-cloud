// Mock data layer. Injected at the queryOptions layer (see queries.ts):
// when MOCK_ENABLED is true, queryFn returns mock data instead of hitting
// the API. Flip EFFICIENCY_MOCK=0 in env to disable once the backend
// /api/v2/efficiency/* endpoints are live.
import type { DashboardSummary, DashboardTrends, GlobalConfig } from "../types";
import {
  getMockDashboardSummary,
  getMockDashboardTrends,
  getMockGlobalConfig,
} from "./dashboard";

const RAW = process.env.EFFICIENCY_MOCK;
// Default: mock ON (backend not yet live). Set EFFICIENCY_MOCK=0 to disable.
export const MOCK_ENABLED = RAW == null ? true : RAW !== "0" && RAW !== "false";

export const mock = {
  dashboardSummary: (p: { startDate?: string; endDate?: string }): DashboardSummary =>
    getMockDashboardSummary(p),
  dashboardTrends: (p: { startDate?: string; endDate?: string }): DashboardTrends =>
    getMockDashboardTrends(p),
  globalConfig: (): GlobalConfig => getMockGlobalConfig(),
  // usage/cost/contribution/detail mock entry points added in later slices.
} as const;

// Endpoint methods for /api/v2/efficiency/*. The mini-cloud backend will
// mount these routes once live. During the mock phase (MOCK_ENABLED=true,
// default) queries.ts never calls these — it returns mock data instead.
//
// The shared ApiClient's fetch is private, so these wrap calls that will be
// added as ApiClient methods (or a dedicated efficiency transport) when the
// backend lands. Until then the false-MOCK path throws a clear error.
import type { DashboardSummary, DashboardTrends, GlobalConfig } from "./types";

const BASE = "/api/v2/efficiency";
const NOT_WIRED =
  "Efficiency backend not yet wired — set EFFICIENCY_MOCK=1 (default) or wait for /api/v2/efficiency/* endpoints.";

function qs(params: Record<string, string | undefined>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : "";
}

// TODO(slice 7+): replace these stubs with real calls once the backend
// mounts /api/v2/efficiency/*. Likely add ApiClient methods (mirroring
// getDashboardUsageDaily) or a dedicated efficiency fetch path.
export async function getDashboardSummary(p: {
  startDate?: string;
  endDate?: string;
}): Promise<DashboardSummary> {
  void `${BASE}/dashboard/summary${qs({
    start_date: p.startDate,
    end_date: p.endDate,
  })}`;
  throw new Error(NOT_WIRED);
}

export async function getDashboardTrends(p: {
  startDate?: string;
  endDate?: string;
}): Promise<DashboardTrends> {
  void `${BASE}/dashboard/trends${qs({
    start_date: p.startDate,
    end_date: p.endDate,
  })}`;
  throw new Error(NOT_WIRED);
}

export async function getGlobalConfig(): Promise<GlobalConfig> {
  void `${BASE}/config`;
  throw new Error(NOT_WIRED);
}

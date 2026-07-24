// Endpoint methods for /api/v2/efficiency/*. The mini-cloud backend will
// mount these routes once live. During the mock phase (MOCK_ENABLED=true,
// default) queries.ts never calls these — it returns mock data instead.
//
// The shared ApiClient's fetch is private, so these wrap calls that will be
// added as ApiClient methods (or a dedicated efficiency transport) when the
// backend lands. Until then the false-MOCK path throws a clear error.
import type {
  ApiList,
  DashboardSummary,
  DashboardTrends,
  DeptRankingResponse,
  DeptTreeNode,
  GlobalConfig,
  ListParams,
  NeedsV2Summary,
  UserV2Row,
} from "./types";

const BASE = "/api/v2/efficiency";
const NOT_WIRED =
  "Efficiency backend not yet wired — re-enable mock with EFFICIENCY_MOCK=1, or wire up /api/v2/efficiency/* endpoints (slice 7+).";

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

// Authoritative full department tree (proxy of dept-sync /department/tree);
// date-independent. Returns a forest (array of roots).
export async function getDeptTree(): Promise<DeptTreeNode[]> {
  void `${BASE}/dept-tree`;
  throw new Error(NOT_WIRED);
}

// One-shot ranking: each direct child department of parentDeptId with its
// whole-subtree conserved summary. parentDeptId empty => configured root.
export async function getDeptRanking(p: {
  parentDeptId?: string;
  startDate?: string;
  endDate?: string;
}): Promise<DeptRankingResponse> {
  void `${BASE}/dept-tree/ranking${qs({
    parent_dept_id: p.parentDeptId,
    start_date: p.startDate,
    end_date: p.endDate,
  })}`;
  throw new Error(NOT_WIRED);
}

// Paginated fetch of the entire needs list (caller drives pagination; mirrors
// the source getAllNeedsV2 helper which loops pages internally). Returns a
// bare array of merged rows.
export async function getAllNeeds(p: ListParams): Promise<NeedsV2Summary[]> {
  void `${BASE}/needs${qs({
    start_date: p.startDate,
    end_date: p.endDate,
    page: p.page != null ? String(p.page) : undefined,
    page_size: p.pageSize != null ? String(p.pageSize) : undefined,
    order: p.order,
  })}`;
  throw new Error(NOT_WIRED);
}

// Users list (server slices by pageSize; the Overview ranking passes a large
// pageSize and re-sorts client-side). Returns the paginated envelope.
export async function getUsers(p: {
  startDate?: string;
  endDate?: string;
  pageSize?: number;
}): Promise<ApiList<UserV2Row>> {
  void `${BASE}/users${qs({
    start_date: p.startDate,
    end_date: p.endDate,
    page_size: p.pageSize != null ? String(p.pageSize) : undefined,
  })}`;
  throw new Error(NOT_WIRED);
}

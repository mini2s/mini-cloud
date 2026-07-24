import { describe, it, expect } from "vitest";
import { efficiencyKeys } from "./queries";
import type { DeptQuery, MembersQuery } from "./types-usage";

describe("efficiencyKeys", () => {
  it("scopes all keys under wsId", () => {
    expect(efficiencyKeys.all("ws1")).toEqual(["efficiency", "ws1"]);
  });

  it("nests summary under wsId + dates", () => {
    expect(
      efficiencyKeys.summary("ws1", "2026-01-01", "2026-01-31"),
    ).toEqual(["efficiency", "ws1", "summary", "2026-01-01", "2026-01-31"]);
  });

  it("handles undefined dates in summary key", () => {
    expect(efficiencyKeys.summary("ws1")).toEqual([
      "efficiency",
      "ws1",
      "summary",
      undefined,
      undefined,
    ]);
  });

  it("config key is stable", () => {
    expect(efficiencyKeys.config("ws1")).toEqual([
      "efficiency",
      "ws1",
      "config",
    ]);
  });

  it("deptTree key nests under wsId", () => {
    expect(efficiencyKeys.deptTree("ws1")).toEqual([
      "efficiency",
      "ws1",
      "dept-tree",
    ]);
  });

  it("deptRanking key includes parentDeptId and window", () => {
    expect(
      efficiencyKeys.deptRanking("ws1", "d-company", "2026-07-01", "2026-07-31"),
    ).toEqual([
      "efficiency",
      "ws1",
      "dept-ranking",
      "d-company",
      "2026-07-01",
      "2026-07-31",
    ]);
  });

  it("deptRanking key handles undefined params", () => {
    expect(efficiencyKeys.deptRanking("ws1")).toEqual([
      "efficiency",
      "ws1",
      "dept-ranking",
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("allNeeds key nests window under wsId", () => {
    expect(efficiencyKeys.allNeeds("ws1", "2026-07-01", "2026-07-31")).toEqual([
      "efficiency",
      "ws1",
      "all-needs",
      "2026-07-01",
      "2026-07-31",
    ]);
  });

  it("users key includes window and pageSize", () => {
    expect(efficiencyKeys.users("ws1", "2026-07-01", "2026-07-31", 1000)).toEqual([
      "efficiency",
      "ws1",
      "users",
      "2026-07-01",
      "2026-07-31",
      1000,
    ]);
  });

  it("users key handles undefined params", () => {
    expect(efficiencyKeys.users("ws1")).toEqual([
      "efficiency",
      "ws1",
      "users",
      undefined,
      undefined,
      undefined,
    ]);
  });

  // ---- Usage dimension keys (must mirror source usageData.ts trailing
  // fields so different depts/windows isolate) ----

  const deptQ: DeptQuery = {
    deptId: "d-infra",
    start: "2026-07-01",
    end: "2026-07-31",
    includeChildren: true,
  };

  it("usageDeptOverview key is workspace-scoped and carries the full DeptQuery", () => {
    expect(efficiencyKeys.usageDeptOverview("ws1", deptQ)).toEqual([
      "efficiency",
      "ws1",
      "usage",
      "dept-overview",
      "d-infra",
      "2026-07-01",
      "2026-07-31",
      true,
    ]);
  });

  it("usage keys distinguish includeChildren=false from true", () => {
    const noChildren: DeptQuery = { ...deptQ, includeChildren: false };
    expect(efficiencyKeys.usageDeptTrend("ws1", noChildren)).toEqual([
      "efficiency",
      "ws1",
      "usage",
      "dept-trend",
      "d-infra",
      "2026-07-01",
      "2026-07-31",
      false,
    ]);
    expect(efficiencyKeys.usageDeptTrend("ws1", noChildren)).not.toEqual(
      efficiencyKeys.usageDeptTrend("ws1", deptQ),
    );
  });

  it("usageDeptMembers key carries paging/sort/search after the DeptQuery fields", () => {
    const m: MembersQuery = {
      ...deptQ,
      page: 2,
      pageSize: 20,
      sortBy: "sum_total_tokens",
      sortOrder: "desc",
      search: "alice",
    };
    expect(efficiencyKeys.usageDeptMembers("ws1", m)).toEqual([
      "efficiency",
      "ws1",
      "usage",
      "dept-members",
      "d-infra",
      "2026-07-01",
      "2026-07-31",
      true,
      2,
      20,
      "sum_total_tokens",
      "desc",
      "alice",
    ]);
  });

  it("usageUserDetail / usageUserTrend keys carry uid + window", () => {
    expect(efficiencyKeys.usageUserDetail("ws1", "u-200", "2026-07-01", "2026-07-31")).toEqual([
      "efficiency",
      "ws1",
      "usage",
      "user-detail",
      "u-200",
      "2026-07-01",
      "2026-07-31",
    ]);
    expect(efficiencyKeys.usageUserTrend("ws1", "u-200", "2026-07-01", "2026-07-31")).toEqual([
      "efficiency",
      "ws1",
      "usage",
      "user-trend",
      "u-200",
      "2026-07-01",
      "2026-07-31",
    ]);
  });

  it("each usage segment namespacing is distinct (no cross-query cache collisions)", () => {
    const segments = [
      efficiencyKeys.usageDeptOverview("ws1", deptQ),
      efficiencyKeys.usageDeptActiveUsers("ws1", deptQ),
      efficiencyKeys.usageDeptTrend("ws1", deptQ),
      efficiencyKeys.usageDeptModels("ws1", deptQ),
      efficiencyKeys.usageDeptWeekly("ws1", deptQ),
      efficiencyKeys.usageDeptResults("ws1", deptQ),
      efficiencyKeys.usageDeptPeriodCompare("ws1", deptQ),
      efficiencyKeys.usageDeptModeUsage("ws1", deptQ),
    ];
    const dedup = new Set(segments.map((k) => JSON.stringify(k)));
    expect(dedup.size).toBe(segments.length);
  });
});

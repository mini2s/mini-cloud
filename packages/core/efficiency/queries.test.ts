import { describe, it, expect } from "vitest";
import { efficiencyKeys } from "./queries";
import type { ChatDetailQueryReq } from "./types";
import type { DeptQuery, MembersQuery } from "./types-usage";
import type { CostMembersQuery } from "./types-cost";

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

  // ---- Efficiency dimension keys (aggregate + non-paginated full lists) ----

  it("efficiencyAggregate key nests window + userId under wsId", () => {
    expect(
      efficiencyKeys.efficiencyAggregate(
        "ws1",
        "2026-07-01",
        "2026-07-31",
        "u-200",
      ),
    ).toEqual([
      "efficiency",
      "ws1",
      "efficiency-aggregate",
      "2026-07-01",
      "2026-07-31",
      "u-200",
    ]);
  });

  it("efficiencyAggregate key handles undefined window/userId", () => {
    expect(efficiencyKeys.efficiencyAggregate("ws1")).toEqual([
      "efficiency",
      "ws1",
      "efficiency-aggregate",
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("efficiencyAggregate distinguishes per-user aggregations", () => {
    expect(
      efficiencyKeys.efficiencyAggregate("ws1", "2026-07-01", "2026-07-31", "u-200"),
    ).not.toEqual(
      efficiencyKeys.efficiencyAggregate("ws1", "2026-07-01", "2026-07-31", "u-201"),
    );
    // userId undefined vs explicit must NOT collide
    expect(
      efficiencyKeys.efficiencyAggregate("ws1", "2026-07-01", "2026-07-31"),
    ).not.toEqual(
      efficiencyKeys.efficiencyAggregate("ws1", "2026-07-01", "2026-07-31", "u-200"),
    );
  });

  it("allUsers key nests window under wsId", () => {
    expect(efficiencyKeys.allUsers("ws1", "2026-07-01", "2026-07-31")).toEqual([
      "efficiency",
      "ws1",
      "all-users",
      "2026-07-01",
      "2026-07-31",
    ]);
  });

  it("allRepos key nests window under wsId", () => {
    expect(efficiencyKeys.allRepos("ws1", "2026-07-01", "2026-07-31")).toEqual([
      "efficiency",
      "ws1",
      "all-repos",
      "2026-07-01",
      "2026-07-31",
    ]);
  });

  it("allUsers and allRepos keys are distinct (no cross-query cache collisions)", () => {
    expect(
      efficiencyKeys.allUsers("ws1", "2026-07-01", "2026-07-31"),
    ).not.toEqual(
      efficiencyKeys.allRepos("ws1", "2026-07-01", "2026-07-31"),
    );
  });

  it("projectList key includes window and order under wsId", () => {
    expect(
      efficiencyKeys.projectList("ws1", "2026-07-01", "2026-07-31", "desc"),
    ).toEqual([
      "efficiency",
      "ws1",
      "project-list",
      "2026-07-01",
      "2026-07-31",
      "desc",
    ]);
  });

  it("projectList key handles all-undefined params", () => {
    expect(efficiencyKeys.projectList("ws1")).toEqual([
      "efficiency",
      "ws1",
      "project-list",
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("projectList distinguishes different orders", () => {
    expect(
      efficiencyKeys.projectList("ws1", "2026-07-01", "2026-07-31", "asc"),
    ).not.toEqual(
      efficiencyKeys.projectList("ws1", "2026-07-01", "2026-07-31", "desc"),
    );
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

  // ---- Cost dimension keys (must mirror source costData.ts trailing
  // fields so different depts/windows isolate; must also stay distinct from
  // usage keys) ----

  it("costOverview key is workspace-scoped and carries the full DeptQuery", () => {
    expect(efficiencyKeys.costOverview("ws1", deptQ)).toEqual([
      "efficiency",
      "ws1",
      "cost",
      "overview",
      "d-infra",
      "2026-07-01",
      "2026-07-31",
      true,
    ]);
  });

  it("cost keys distinguish includeChildren=false from true", () => {
    const noChildren: DeptQuery = { ...deptQ, includeChildren: false };
    expect(efficiencyKeys.costModels("ws1", noChildren)).toEqual([
      "efficiency",
      "ws1",
      "cost",
      "models",
      "d-infra",
      "2026-07-01",
      "2026-07-31",
      false,
    ]);
    expect(efficiencyKeys.costModels("ws1", noChildren)).not.toEqual(
      efficiencyKeys.costModels("ws1", deptQ),
    );
  });

  it("costMembers key carries paging/sort/search after the DeptQuery fields", () => {
    const m: CostMembersQuery = {
      ...deptQ,
      page: 2,
      pageSize: 20,
      sortBy: "total_cost",
      sortOrder: "desc",
      search: "alice",
    };
    expect(efficiencyKeys.costMembers("ws1", m)).toEqual([
      "efficiency",
      "ws1",
      "cost",
      "members",
      "d-infra",
      "2026-07-01",
      "2026-07-31",
      true,
      2,
      20,
      "total_cost",
      "desc",
      "alice",
    ]);
  });

  it("each cost segment namespacing is distinct (no cross-query cache collisions)", () => {
    const segments = [
      efficiencyKeys.costOverview("ws1", deptQ),
      efficiencyKeys.costPeriodCompare("ws1", deptQ),
      efficiencyKeys.costModels("ws1", deptQ),
      efficiencyKeys.costModelTrend("ws1", deptQ),
      efficiencyKeys.costModelComposition("ws1", deptQ),
      efficiencyKeys.costAnomaly("ws1", deptQ),
      efficiencyKeys.costSubDepts("ws1", deptQ),
      efficiencyKeys.costTeamTrend("ws1", deptQ),
      efficiencyKeys.costTeamComposition("ws1", deptQ),
    ];
    const dedup = new Set(segments.map((k) => JSON.stringify(k)));
    expect(dedup.size).toBe(segments.length);
  });

  it("cost keys never collide with usage keys (different dimension segment)", () => {
    // Same dept/window on both dimensions must produce different keys.
    expect(efficiencyKeys.costOverview("ws1", deptQ)).not.toEqual(
      efficiencyKeys.usageDeptOverview("ws1", deptQ),
    );
    expect(efficiencyKeys.costPeriodCompare("ws1", deptQ)).not.toEqual(
      efficiencyKeys.usageDeptPeriodCompare("ws1", deptQ),
    );
    // The 2nd element ("cost" vs "usage") is the dimension discriminator.
    expect(efficiencyKeys.costOverview("ws1", deptQ)[2]).toBe("cost");
    expect(efficiencyKeys.usageDeptOverview("ws1", deptQ)[2]).toBe("usage");
  });

  // ---- Detail dimension keys (per-entity drill-downs) ----

  it("userDetail key nests userId + window under wsId", () => {
    expect(
      efficiencyKeys.userDetail("ws1", "u-200", "2026-07-01", "2026-07-31"),
    ).toEqual([
      "efficiency",
      "ws1",
      "detail",
      "user",
      "u-200",
      "2026-07-01",
      "2026-07-31",
    ]);
  });

  it("userDetail key handles undefined window", () => {
    expect(efficiencyKeys.userDetail("ws1", "u-200")).toEqual([
      "efficiency",
      "ws1",
      "detail",
      "user",
      "u-200",
      undefined,
      undefined,
    ]);
  });

  it("userDetail distinguishes different users", () => {
    expect(
      efficiencyKeys.userDetail("ws1", "u-200", "2026-07-01", "2026-07-31"),
    ).not.toEqual(
      efficiencyKeys.userDetail("ws1", "u-201", "2026-07-01", "2026-07-31"),
    );
  });

  it("repoDetail key carries the full param shape (addr/branch/window)", () => {
    expect(
      efficiencyKeys.repoDetail("ws1", {
        repoAddr: "git@github.com:costrict/repo-1.git",
        repoBranch: "main",
        startDate: "2026-07-01",
        endDate: "2026-07-31",
      }),
    ).toEqual([
      "efficiency",
      "ws1",
      "detail",
      "repo",
      "git@github.com:costrict/repo-1.git",
      "main",
      "2026-07-01",
      "2026-07-31",
    ]);
  });

  it("repoDetail distinguishes branches of the same repo", () => {
    expect(
      efficiencyKeys.repoDetail("ws1", {
        repoAddr: "git@github.com:costrict/repo-1.git",
        repoBranch: "main",
      }),
    ).not.toEqual(
      efficiencyKeys.repoDetail("ws1", {
        repoAddr: "git@github.com:costrict/repo-1.git",
        repoBranch: "develop",
      }),
    );
  });

  it("repoBranches / repoTrend / projectTrend keys carry their id/window fields", () => {
    expect(
      efficiencyKeys.repoBranches("ws1", "git@github.com:costrict/repo-1.git"),
    ).toEqual([
      "efficiency",
      "ws1",
      "detail",
      "repo-branches",
      "git@github.com:costrict/repo-1.git",
    ]);
    expect(
      efficiencyKeys.repoTrend("ws1", {
        repoAddr: "git@github.com:costrict/repo-1.git",
        startDate: "2026-07-01",
        endDate: "2026-07-31",
      }),
    ).toEqual([
      "efficiency",
      "ws1",
      "detail",
      "repo-trend",
      "git@github.com:costrict/repo-1.git",
      "2026-07-01",
      "2026-07-31",
    ]);
    expect(
      efficiencyKeys.projectTrend("ws1", {
        projectId: "p-100",
        startDate: "2026-07-01",
        endDate: "2026-07-31",
      }),
    ).toEqual([
      "efficiency",
      "ws1",
      "detail",
      "project-trend",
      "p-100",
      "2026-07-01",
      "2026-07-31",
    ]);
  });

  it("projectDetail / projectNeeds / needDetail / taskDetail / commitDetail keys nest the id", () => {
    expect(efficiencyKeys.projectDetail("ws1", "p-100")).toEqual([
      "efficiency",
      "ws1",
      "detail",
      "project",
      "p-100",
    ]);
    expect(efficiencyKeys.projectNeeds("ws1", "p-100")).toEqual([
      "efficiency",
      "ws1",
      "detail",
      "project-needs",
      "p-100",
    ]);
    expect(efficiencyKeys.needDetail("ws1", "n-1000")).toEqual([
      "efficiency",
      "ws1",
      "detail",
      "need",
      "n-1000",
    ]);
    expect(efficiencyKeys.taskDetail("ws1", "t-100")).toEqual([
      "efficiency",
      "ws1",
      "detail",
      "task",
      "t-100",
    ]);
    expect(efficiencyKeys.commitDetail("ws1", "c-100")).toEqual([
      "efficiency",
      "ws1",
      "detail",
      "commit",
      "c-100",
    ]);
  });

  it("each detail segment namespacing is distinct (no cross-query cache collisions)", () => {
    const segments = [
      efficiencyKeys.userDetail("ws1", "u-200"),
      efficiencyKeys.repoDetail("ws1", { repoAddr: "r" }),
      efficiencyKeys.repoBranches("ws1", "r"),
      efficiencyKeys.repoTrend("ws1", { repoAddr: "r" }),
      efficiencyKeys.projectDetail("ws1", "p"),
      efficiencyKeys.projectTrend("ws1", { projectId: "p" }),
      efficiencyKeys.projectNeeds("ws1", "p"),
      efficiencyKeys.needDetail("ws1", "n"),
      efficiencyKeys.taskDetail("ws1", "t"),
      efficiencyKeys.commitDetail("ws1", "c"),
    ];
    const dedup = new Set(segments.map((k) => JSON.stringify(k)));
    expect(dedup.size).toBe(segments.length);
  });

  it("detail keys never collide with cost/usage keys (different dimension segment)", () => {
    // The "detail" discriminator at index 2 keeps detail cache isolated from
    // the cost/usage dimensions even when ids happen to coincide.
    expect(efficiencyKeys.userDetail("ws1", "overview")[2]).toBe("detail");
    expect(efficiencyKeys.costOverview("ws1", deptQ)[2]).toBe("cost");
    expect(efficiencyKeys.usageDeptOverview("ws1", deptQ)[2]).toBe("usage");
  });

  // ---- Chat dimension keys (chat-settings + platform-ops pages) ----

  it("chat settings keys are workspace-scoped with a stable segment", () => {
    expect(efficiencyKeys.chatPricing("ws1")).toEqual([
      "efficiency",
      "ws1",
      "chat",
      "pricing",
    ]);
    expect(efficiencyKeys.chatDatasources("ws1")).toEqual([
      "efficiency",
      "ws1",
      "chat",
      "datasources",
    ]);
    expect(efficiencyKeys.chatSyncTasks("ws1")).toEqual([
      "efficiency",
      "ws1",
      "chat",
      "sync-tasks",
    ]);
    expect(efficiencyKeys.chatSystemConfig("ws1")).toEqual([
      "efficiency",
      "ws1",
      "chat",
      "system-config",
    ]);
  });

  it("chatRealtime key carries range and datasourceId", () => {
    expect(
      efficiencyKeys.chatRealtime("ws1", { range: "1h", datasourceId: "ds-1" }),
    ).toEqual([
      "efficiency",
      "ws1",
      "chat",
      "realtime",
      "1h",
      "ds-1",
    ]);
  });

  it("chatRealtime key handles undefined datasourceId", () => {
    expect(efficiencyKeys.chatRealtime("ws1", { range: "30m" })).toEqual([
      "efficiency",
      "ws1",
      "chat",
      "realtime",
      "30m",
      undefined,
    ]);
  });

  it("chatRealtime distinguishes different ranges/datasources", () => {
    expect(
      efficiencyKeys.chatRealtime("ws1", { range: "1h", datasourceId: "ds-1" }),
    ).not.toEqual(
      efficiencyKeys.chatRealtime("ws1", { range: "3h", datasourceId: "ds-1" }),
    );
    expect(
      efficiencyKeys.chatRealtime("ws1", { range: "1h", datasourceId: "ds-1" }),
    ).not.toEqual(
      efficiencyKeys.chatRealtime("ws1", { range: "1h", datasourceId: "ds-2" }),
    );
  });

  it("chatModelTrend key carries window and models filter", () => {
    expect(
      efficiencyKeys.chatModelTrend("ws1", {
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        models: "glm-4.6,gpt-4o",
      }),
    ).toEqual([
      "efficiency",
      "ws1",
      "chat",
      "model-trend",
      "2026-07-01",
      "2026-07-31",
      "glm-4.6,gpt-4o",
    ]);
  });

  it("chatModelTrend key handles undefined models filter", () => {
    expect(
      efficiencyKeys.chatModelTrend("ws1", {
        startDate: "2026-07-01",
        endDate: "2026-07-31",
      }),
    ).toEqual([
      "efficiency",
      "ws1",
      "chat",
      "model-trend",
      "2026-07-01",
      "2026-07-31",
      undefined,
    ]);
  });

  it("chatUserTrend key carries uid + window", () => {
    expect(
      efficiencyKeys.chatUserTrend("ws1", "u-300", {
        startDate: "2026-07-01",
        endDate: "2026-07-31",
      }),
    ).toEqual([
      "efficiency",
      "ws1",
      "chat",
      "user-trend",
      "u-300",
      "2026-07-01",
      "2026-07-31",
    ]);
  });

  it("chatUserTrend distinguishes different users", () => {
    expect(
      efficiencyKeys.chatUserTrend("ws1", "u-300", {
        startDate: "2026-07-01",
        endDate: "2026-07-31",
      }),
    ).not.toEqual(
      efficiencyKeys.chatUserTrend("ws1", "u-301", {
        startDate: "2026-07-01",
        endDate: "2026-07-31",
      }),
    );
  });

  it("chatDetailQuery key nests the full request shape", () => {
    const req: ChatDetailQueryReq = {
      datasource_id: "ds-1",
      start_time: "2026-07-21T00:00:00Z",
      end_time: "2026-07-21T23:59:59Z",
      has_error: true,
      limit: 100,
      order: "desc",
    };
    expect(efficiencyKeys.chatDetailQuery("ws1", req)).toEqual([
      "efficiency",
      "ws1",
      "chat",
      "detail-query",
      req,
    ]);
  });

  it("chatDetailQuery distinguishes different request bodies", () => {
    const a: ChatDetailQueryReq = {
      start_time: "2026-07-21T00:00:00Z",
      end_time: "2026-07-21T23:59:59Z",
    };
    const b: ChatDetailQueryReq = {
      start_time: "2026-07-21T00:00:00Z",
      end_time: "2026-07-21T23:59:59Z",
      has_error: true,
    };
    expect(efficiencyKeys.chatDetailQuery("ws1", a)).not.toEqual(
      efficiencyKeys.chatDetailQuery("ws1", b),
    );
  });

  it("chatLogPreview key nests the path under wsId", () => {
    expect(
      efficiencyKeys.chatLogPreview("ws1", "/var/log/chat/req-0.log"),
    ).toEqual([
      "efficiency",
      "ws1",
      "chat",
      "log-preview",
      "/var/log/chat/req-0.log",
    ]);
  });

  it("chatLogPreview distinguishes different paths", () => {
    expect(
      efficiencyKeys.chatLogPreview("ws1", "/var/log/chat/req-0.log"),
    ).not.toEqual(
      efficiencyKeys.chatLogPreview("ws1", "/var/log/chat/req-1.log"),
    );
  });

  it("chatTraceLogs key nests the request body under wsId", () => {
    const req = {
      datasource_id: "ds-1",
      request_id: "req-123",
      start_time: "2026-07-21T00:00:00Z",
      end_time: "2026-07-21T23:59:59Z",
      limit: 100,
    };
    expect(efficiencyKeys.chatTraceLogs("ws1", req)).toEqual([
      "efficiency",
      "ws1",
      "chat",
      "trace-logs",
      req,
    ]);
  });

  it("chatTraceLogs distinguishes different request_ids", () => {
    const base = {
      datasource_id: "ds-1",
      start_time: "2026-07-21T00:00:00Z",
      end_time: "2026-07-21T23:59:59Z",
    };
    expect(efficiencyKeys.chatTraceLogs("ws1", { ...base, request_id: "req-a" })).not.toEqual(
      efficiencyKeys.chatTraceLogs("ws1", { ...base, request_id: "req-b" }),
    );
  });

  it("each chat segment namespacing is distinct (no cross-query cache collisions)", () => {
    const segments = [
      efficiencyKeys.chatPricing("ws1"),
      efficiencyKeys.chatDatasources("ws1"),
      efficiencyKeys.chatSyncTasks("ws1"),
      efficiencyKeys.chatSystemConfig("ws1"),
      efficiencyKeys.chatRealtime("ws1", { range: "1h" }),
      efficiencyKeys.chatModelTrend("ws1", {
        startDate: "2026-07-01",
        endDate: "2026-07-31",
      }),
      efficiencyKeys.chatUserTrend("ws1", "u-300", {
        startDate: "2026-07-01",
        endDate: "2026-07-31",
      }),
      efficiencyKeys.chatDetailQuery("ws1", {
        start_time: "2026-07-21T00:00:00Z",
        end_time: "2026-07-21T23:59:59Z",
      }),
      efficiencyKeys.chatLogPreview("ws1", "/var/log/chat/req-0.log"),
      efficiencyKeys.chatTraceLogs("ws1", {
        datasource_id: "ds-1",
        request_id: "req-0",
        start_time: "2026-07-21T00:00:00Z",
        end_time: "2026-07-21T23:59:59Z",
      }),
    ];
    const dedup = new Set(segments.map((k) => JSON.stringify(k)));
    expect(dedup.size).toBe(segments.length);
  });

  it("chat keys never collide with other dimensions (different dimension segment)", () => {
    // The "chat" discriminator at index 2 keeps chat cache isolated from the
    // cost/usage/detail dimensions even when ids happen to coincide.
    expect(efficiencyKeys.chatPricing("ws1")[2]).toBe("chat");
    expect(efficiencyKeys.costOverview("ws1", deptQ)[2]).toBe("cost");
    expect(efficiencyKeys.usageDeptOverview("ws1", deptQ)[2]).toBe("usage");
    expect(efficiencyKeys.userDetail("ws1", "u-1")[2]).toBe("detail");
  });
});

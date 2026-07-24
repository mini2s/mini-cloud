import { describe, it, expect } from "vitest";
import { paths, isGlobalPath } from "./paths";
import { RESERVED_SLUGS } from "./reserved-slugs";

// C4 — every parameterless workspace route method on paths.workspace() must
// appear in this allowlist, and every method must resolve to the exact
// /{slug}/{segment} string documented here. We can't import the sidebar's
// NavKey union or link-handler's WORKSPACE_ROUTE_SEGMENTS from here (they live
// in packages/views; no inverse import allowed), so this list is the canonical
// cross-module contract — if you add/rename a route in paths.ts, update BOTH
// this test and the sidebar nav wiring. Drift is caught here.
describe("paths.workspace() shape", () => {
  it("exposes the expected parameterless workspace route methods", () => {
    const ws = paths.workspace("__probe__");
    const parameterlessRoutes = Object.entries(ws)
      .filter(([, fn]) => typeof fn === "function" && fn.length === 0)
      .map(([key]) => key);

    expect(new Set(parameterlessRoutes)).toEqual(
      new Set([
        "root",
        "usage",
        "issues",
        "projects",
        "autopilots",
        "agents",
        "members",
        "squads",
        "inbox",
        "myIssues",
        "runtimes",
        "skills",
        "settings",
        "workflows",
        "roles",
        // Upcoming product surface (web-only placeholder destinations).
        "home",
        "sessions",
        "reviews",
        "wiki",
        "memory",
        "dispatch",
        "hub",
        "hubSkill",
        "hubSubagent",
        "hubCommand",
        "hubMcp",
        "hubPlugin",
        "hubManager",
        // Efficiency dashboard.
        "metricsOverview",
        "metricsEfficiency",
        "metricsQuality",
        "metricsCost",
        "metricsCoverage",
        "metricsContribution",
        // Administration.
        "permissions",
        "devices",
        "connectors",
        "channels",
        "quotas",
        // Personal account.
        "meProfile",
        "meQuota",
        "meNotifications",
        "meDevices",
      ]),
    );
  });

  it("each parameterless route emits /{slug}/{segment}", () => {
    const ws = paths.workspace("acme");
    // For each method, assert the full URL it produces. Most are a single
    // kebab-case segment, but several are nested paths (metrics/*, me/*,
    // hub/manager) or carry a query string (hub?type=...). Each entry pins
    // the exact contract so an accidental path-shape change is caught.
    const expectedSegments: Array<[string, string]> = [
      ["root", "issues"],
      ["usage", "usage"],
      ["issues", "issues"],
      ["projects", "projects"],
      ["autopilots", "autopilots"],
      ["agents", "agents"],
      ["members", "members"],
      ["squads", "squads"],
      ["inbox", "inbox"],
      ["myIssues", "my-issues"],
      ["runtimes", "runtimes"],
      ["skills", "skills"],
      ["settings", "settings"],
      ["workflows", "workflows"],
      ["roles", "roles"],
      // Upcoming product surface.
      ["home", "home"],
      ["sessions", "sessions"],
      ["reviews", "reviews"],
      ["wiki", "wiki"],
      ["memory", "memory"],
      ["dispatch", "dispatch"],
      ["hub", "hub"],
      ["hubSkill", "hub?type=skill"],
      ["hubSubagent", "hub?type=subagent"],
      ["hubCommand", "hub?type=command"],
      ["hubMcp", "hub?type=mcp"],
      ["hubPlugin", "hub?type=plugin"],
      ["hubManager", "hub/manager"],
      // Efficiency dashboard.
      ["metricsOverview", "metrics"],
      ["metricsEfficiency", "metrics/efficiency"],
      ["metricsQuality", "metrics/quality"],
      ["metricsCost", "metrics/cost"],
      ["metricsCoverage", "metrics/coverage"],
      ["metricsContribution", "metrics/contribution"],
      // Administration.
      ["permissions", "permissions"],
      ["devices", "devices"],
      ["connectors", "connectors"],
      ["channels", "channels"],
      ["quotas", "quotas"],
      // Personal account.
      ["meProfile", "me/profile"],
      ["meQuota", "me/quota"],
      ["meNotifications", "me/notifications"],
      ["meDevices", "me/devices"],
    ];
    const wsAsAny = ws as unknown as Record<string, () => string>;
    for (const [method, segment] of expectedSegments) {
      const fn = wsAsAny[method];
      expect(typeof fn).toBe("function");
      expect(fn!()).toBe(`/acme/${segment}`);
    }
  });
});

// C5 — invariants between the global/reserved lists.
describe("global path / reserved slug consistency", () => {
  // If a path is "global" (never workspace-scoped), the slug name underlying it
  // must be reserved — otherwise a user could create a workspace with that slug
  // and shadow the global route's URL space.
  //
  // GLOBAL_PREFIXES from paths.ts is private — we re-derive the list from
  // probing isGlobalPath. Order matters: keep this list in sync with paths.ts.
  const globalPrefixes = [
    "/login",
    "/logout",
    "/signup",
    "/workspaces/",
    "/invite/",
    "/auth/",
  ];

  it("isGlobalPath agrees with the canonical global prefix list", () => {
    for (const prefix of globalPrefixes) {
      expect(isGlobalPath(prefix)).toBe(true);
    }
    expect(isGlobalPath("/acme/issues")).toBe(false);
    expect(isGlobalPath("/")).toBe(false);
  });

  it("every global prefix's first path segment is a reserved slug", () => {
    for (const prefix of globalPrefixes) {
      const firstSegment = prefix.split("/").filter(Boolean)[0];
      if (!firstSegment) continue;
      expect(
        RESERVED_SLUGS.has(firstSegment),
        `'${firstSegment}' is a global path prefix but not a reserved slug — ` +
          `a workspace could be created with this slug and shadow the global route`,
      ).toBe(true);
    }
  });
});

import { describe, it, expect } from "vitest";
import { efficiencyKeys } from "./queries";

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
});

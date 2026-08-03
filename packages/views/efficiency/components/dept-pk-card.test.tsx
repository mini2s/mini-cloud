import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const { mockPush } = vi.hoisted(() => ({
  mockPush: vi.fn(),
}));

// Smoke test: DeptPKCard renders its header and the top-ranked department
// row from mocked query data without crashing. The ranked list shows
// department rows with rank badges, member/need counts, and RatioPill.
// The base-ui Select portal is not exercised here — the trigger renders
// closed by default.

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    metricsEfficiency: () => "/acme/metrics/efficiency",
  }),
}));

vi.mock("../../navigation", () => ({
  useNavigation: () => ({ push: mockPush }),
}));

// Mock useQuery to return canned dept-tree + dept-ranking data keyed off the
// query key (matches the established settings/members-tab test pattern).
vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
  return {
    ...actual,
    useQuery: (options: { queryKey?: readonly unknown[] }) => {
      const key = JSON.stringify(options.queryKey ?? []);
      if (key.includes("dept-tree")) {
        return {
          data: [
            {
              dept_id: "root",
              dept_name: "全公司",
              parent_dept_id: "",
              dept_path: "/root",
              dept_level: 0,
              order_num: 0,
              child_dept_count: 2,
              status: 1,
              children: [
                {
                  dept_id: "dept-a",
                  dept_name: "部门A",
                  parent_dept_id: "root",
                  dept_path: "/root/dept-a",
                  dept_level: 1,
                  order_num: 1,
                  child_dept_count: 0,
                  status: 1,
                  children: [],
                },
                {
                  dept_id: "dept-b",
                  dept_name: "部门B",
                  parent_dept_id: "root",
                  dept_path: "/root/dept-b",
                  dept_level: 1,
                  order_num: 2,
                  child_dept_count: 0,
                  status: 1,
                  children: [],
                },
              ],
            },
          ],
          isLoading: false,
          isError: false,
          error: null,
        };
      }
      if (key.includes("dept-ranking")) {
        return {
          data: {
            parent_dept_id: "",
            items: [
              {
                dept_id: "dept-a",
                dept_name: "部门A",
                summary: {
                  dept_id: "dept-a",
                  member_count: 10,
                  kanban_member_count: 8,
                  merged_need_count: 42,
                  actual_calendar_min: 5000,
                  baseline_calendar_min: 9000,
                  calendar_ratio: 0.8,
                  work_ratio: 0.7,
                  commit_count: 100,
                  commit_diff_lines: 2000,
                  cost: 300,
                },
              },
              {
                dept_id: "dept-b",
                dept_name: "部门B",
                summary: {
                  dept_id: "dept-b",
                  member_count: 5,
                  kanban_member_count: 4,
                  merged_need_count: 20,
                  actual_calendar_min: 3000,
                  baseline_calendar_min: 4000,
                  calendar_ratio: 0.33,
                  work_ratio: 0.25,
                  commit_count: 50,
                  commit_diff_lines: 800,
                  cost: 150,
                },
              },
            ],
          },
          isLoading: false,
          isError: false,
          error: null,
        };
      }
      return { data: undefined, isLoading: false, isError: false, error: null };
    },
  };
});

import { DeptPKCard } from "./dept-pk-card";

describe("DeptPKCard", () => {
  it("renders the header and top-ranked department from mocked data", () => {
    render(
      <DeptPKCard startDate="2026-01-01" endDate="2026-06-30" />,
    );
    // Header is present.
    expect(screen.getByText("部门 PK")).toBeInTheDocument();
    // The top-ranked department (部门A, ratio 0.8 → 80.0%) is listed with its
    // member / need counts. Ratio is rendered in a separate RatioPill.
    expect(screen.getByText("部门A")).toBeInTheDocument();
    expect(screen.getByText(/8 人 · 需求 42/)).toBeInTheDocument();
    expect(screen.getByText("80.0%")).toBeInTheDocument();
    // The second-ranked department is also rendered (ratio 0.33 → 33.0%).
    expect(screen.getByText("部门B")).toBeInTheDocument();
    expect(screen.getByText(/4 人 · 需求 20/)).toBeInTheDocument();
    expect(screen.getByText("33.0%")).toBeInTheDocument();
  });

  it("shows the resolved org-level label in the trigger, never the raw sentinel", () => {
    render(
      <DeptPKCard startDate="2026-01-01" endDate="2026-06-30" />,
    );
    // Default selection is the ROOT sentinel "__root__"; the trigger must
    // render its display label instead (SelectValue function children).
    expect(screen.getByText("全公司（一级部门）")).toBeInTheDocument();
    expect(screen.queryByText("__root__")).not.toBeInTheDocument();
  });

  it("opens the organization-focused efficiency view for a department", () => {
    render(
      <DeptPKCard startDate="2026-01-01" endDate="2026-06-30" />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "查看部门 部门A 效率详情" }),
    );

    expect(mockPush).toHaveBeenCalledWith(
      "/acme/metrics/efficiency?entity=org&object=dept-a",
    );
  });
});

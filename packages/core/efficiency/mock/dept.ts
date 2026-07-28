// Mock samples for the department tree + ranking endpoints (Overview page
// dept-PK card). Shapes match DeptTreeNode (recursive forest) and
// DeptRankingResponse (parent + per-child subtree summary). Numbers are
// synthetic but kept in plausible ranges so the ranking bar chart renders.

import type {
  DeptMember,
  DeptMembersResponse,
  DeptOverviewResponse,
  DeptMembersSummary,
  DeptRankingResponse,
  DeptRankingItem,
  DeptTreeNode,
  DeptTreeNodeWithSummary,
} from "../types";

// Builds a DeptMembersSummary with sensible rounded values. calendar_ratio /
// work_ratio are decimal multipliers (1.0 = break-even); cost in yuan.
function makeSummary(deptId: string, memberCount: number): DeptMembersSummary {
  const mergedNeedCount = Math.round(memberCount * 14.5);
  const actualCalendarMin = memberCount * 3200;
  const baselineCalendarMin = memberCount * 9000;
  const commitDiffLines = memberCount * 8400;
  return {
    dept_id: deptId,
    member_count: memberCount,
    kanban_member_count: Math.round(memberCount * 0.85),
    merged_need_count: mergedNeedCount,
    actual_calendar_min: actualCalendarMin,
    baseline_calendar_min: baselineCalendarMin,
    calendar_ratio: actualCalendarMin > 0 ? baselineCalendarMin / actualCalendarMin : null,
    work_ratio: 2.6 + (memberCount % 5) * 0.07, // ~2.6–2.9 decimal ratio
    silica: 0.32,
    commit_count: Math.round(memberCount * 6.2),
    commit_diff_lines: commitDiffLines,
    cost: memberCount * 215.4,
  };
}

// Leaf child helper.
function leaf(
  deptId: string,
  deptName: string,
  parentDeptId: string,
  deptPath: string,
  orderNum: number,
): DeptTreeNode {
  return {
    dept_id: deptId,
    dept_name: deptName,
    parent_dept_id: parentDeptId,
    dept_path: deptPath,
    dept_level: deptPath.split("/").length - 1,
    order_num: orderNum,
    child_dept_count: 0,
    status: 1,
    children: [],
  };
}

// Small authoritative tree: company root + 5 business lines (aligned with
// getMockDeptRanking so tree joins resolve). d-infra has two sub-teams.
// dept_path uses a leading slash + slash-separated breadcrumb (matches backend).
export function getMockDeptTree(): DeptTreeNode[] {
  const infraChildren: DeptTreeNode[] = [
    leaf("d-frontend", "Frontend Team", "d-infra", "/company/infra/frontend", 1),
    leaf("d-backend", "Backend Team", "d-infra", "/company/infra/backend", 2),
  ];
  const infraNode: DeptTreeNode = {
    dept_id: "d-infra",
    dept_name: "Infrastructure Platform",
    parent_dept_id: "d-company",
    dept_path: "/company/infra",
    dept_level: 2,
    order_num: 1,
    child_dept_count: infraChildren.length,
    status: 1,
    children: infraChildren,
  };
  const companyChildren: DeptTreeNode[] = [
    infraNode,
    leaf("d-data", "Data & AI", "d-company", "/company/data", 2),
    leaf("d-product", "Product & Design", "d-company", "/company/product", 3),
    leaf("d-growth", "Growth & Marketing", "d-company", "/company/growth", 4),
    leaf("d-ops", "Operations", "d-company", "/company/ops", 5),
  ];
  const companyNode: DeptTreeNode = {
    dept_id: "d-company",
    dept_name: "Costrict Corp.",
    parent_dept_id: "",
    dept_path: "/company",
    dept_level: 1,
    order_num: 1,
    child_dept_count: companyChildren.length,
    status: 1,
    children: companyChildren,
  };
  return [companyNode];
}

export function getMockDeptOverview(): DeptOverviewResponse {
  const counts = new Map<string, number>([
    ["d-company", 51],
    ["d-infra", 18],
    ["d-frontend", 9],
    ["d-backend", 9],
    ["d-data", 12],
    ["d-product", 7],
    ["d-growth", 9],
    ["d-ops", 5],
  ]);

  function withSummary(node: DeptTreeNode): DeptTreeNodeWithSummary {
    return {
      ...node,
      summary: makeSummary(node.dept_id, counts.get(node.dept_id) ?? 0),
      children: node.children.map(withSummary),
    };
  }

  return { nodes: getMockDeptTree().map(withSummary) };
}

export function getMockDeptTreeMembers(deptId: string): DeptMembersResponse {
  const members: DeptMember[] = Array.from({ length: 24 }, (_, index) => {
    const active = index % 5 !== 0;
    return {
      universal_id: `u-dept-${index + 1}`,
      real_name: `成员 ${index + 1}`,
      emp_no: `E${String(index + 1).padStart(4, "0")}`,
      dept_id: deptId,
      position: index % 3 === 0 ? "Senior" : "Engineer",
      is_main: 1,
      has_kanban_data: active,
      merged_need_count: active ? 8 + (index % 7) : 0,
      actual_calendar_min: active ? 2400 + index * 30 : 0,
      baseline_calendar_min: active ? 6500 + index * 60 : 0,
      calendar_ratio: active ? 2.4 + (index % 6) * 0.08 : null,
      work_ratio: active ? 2.1 + (index % 5) * 0.07 : null,
      silica: active ? 0.25 + (index % 4) * 0.05 : null,
      commit_count: active ? 12 + index : 0,
      commit_diff_lines: active ? 1800 + index * 120 : 0,
      cost: active ? 120 + index * 8 : 0,
    };
  });
  return {
    summary: makeSummary(deptId, members.length),
    members,
  };
}

// Ranking: parentDeptId empty => configured company root; return its direct
// children with whole-subtree summaries. parentDeptId provided => return the
// direct children of that node. The window is accepted for signature parity
// but ignored (static sample).
export function getMockDeptRanking(_p: {
  parentDeptId?: string;
  startDate?: string;
  endDate?: string;
}): DeptRankingResponse {
  const items: DeptRankingItem[] = [
    {
      dept_id: "d-infra",
      dept_name: "Infrastructure Platform",
      summary: makeSummary("d-infra", 18),
    },
    {
      dept_id: "d-data",
      dept_name: "Data & AI",
      summary: makeSummary("d-data", 12),
    },
    {
      dept_id: "d-product",
      dept_name: "Product & Design",
      summary: makeSummary("d-product", 7),
    },
    {
      dept_id: "d-growth",
      dept_name: "Growth & Marketing",
      summary: makeSummary("d-growth", 9),
    },
    {
      dept_id: "d-ops",
      dept_name: "Operations",
      summary: makeSummary("d-ops", 5),
    },
  ];
  return {
    parent_dept_id: "d-company",
    items,
    self: makeSummary("d-company", 51),
  };
}

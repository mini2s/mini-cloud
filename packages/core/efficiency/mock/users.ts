// Mock samples for the users list (Overview page user ranking card). The
// source getUsersV2 returns the paginated ApiList<UserV2Row> envelope, so this
// mock returns the same shape. ~8 rows with plausible decimal-ratio values.

import type { ApiList, UserV2Row } from "../types";

const NAMES = [
  "Alice Wang",
  "Bob Li",
  "Carol Zhang",
  "David Chen",
  "Emma Liu",
  "Frank Zhao",
  "Grace Sun",
  "Henry Wu",
];

// Builds a single UserV2Row. calendar_ratio / work_ratio are decimal
// multipliers; cost in yuan; confidence_limited flags low-data weeks.
function makeUser(i: number): UserV2Row {
  const mergedNeedCount = 8 + i;
  const actualCalendarMin = 2200 + i * 120;
  const baselineCalendarMin = 6400 + i * 180;
  const actualWorkMin = 850 + i * 40;
  const baselineWorkMin = 2400 + i * 55;
  const confidenceLimited = i % 5 === 0;
  return {
    user_id: `u-${200 + i}`,
    user_name: NAMES[i % NAMES.length] ?? `User ${200 + i}`,
    week_count: 4 + (i % 3),
    merged_need_count: mergedNeedCount,
    active_need_count: 2 + (i % 4),
    abandoned_need_count: i % 3,
    actual_calendar_min: actualCalendarMin,
    baseline_calendar_min: baselineCalendarMin,
    calendar_ratio:
      baselineCalendarMin > 0 ? actualCalendarMin / baselineCalendarMin : null,
    actual_work_min: actualWorkMin,
    baseline_work_min: baselineWorkMin,
    work_ratio: baselineWorkMin > 0 ? actualWorkMin / baselineWorkMin : null,
    commit_count: 14 + i * 3,
    commit_diff_lines: 3200 + i * 210,
    cost: 180 + i * 24.5,
    tokens: 1_200_000 + i * 95_000,
    ai_code_ratio: 0.26 + (i % 5) * 0.03,
    confidence_limited: confidenceLimited,
    confidence_reason: confidenceLimited ? "few sample weeks" : "",
  };
}

export function getMockUsers(_p: {
  startDate?: string;
  endDate?: string;
  pageSize?: number;
}): ApiList<UserV2Row> {
  const data = Array.from({ length: 8 }, (_, i) => makeUser(i));
  return {
    total: data.length,
    page: 1,
    pageSize: _p.pageSize ?? data.length,
    data,
  };
}

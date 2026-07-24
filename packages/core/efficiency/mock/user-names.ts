// Mock roster for display-name resolution (/v2/user-names). Resolves the raw
// dashboard user_id (UUID-style in production, "u-2xx" in the other mock
// samples) to a "真名(工号)" display string via useUserNameMap.
//
// The user_id values here intentionally OVERLAP the ids emitted by the other
// mock factories (mock/users.ts, mock/detail.ts, mock/efficiency.ts all use
// `u-${200 + i}` for i=0..7), so resolution actually lands on these rows.
// In production this endpoint is backed by the dept-sync roster.

import type { UserNameRow } from "../types";

// Pairs of (real_name, emp_no). Plausible Chinese names + zero-padded ids.
const ROWS: Array<[name: string, empNo: string]> = [
  ["张伟", "E001"],
  ["李娜", "E002"],
  ["王芳", "E003"],
  ["刘洋", "E004"],
  ["陈静", "E005"],
  ["杨磊", "E006"],
  ["赵敏", "E007"],
  ["孙浩", "E008"],
  ["周婷", "E009"],
  ["吴强", "E010"],
  ["郑爽", "E011"],
  ["冯雪", "E012"],
  ["马超", "E013"],
  ["韩梅", "E014"],
  ["曹峰", "E015"],
];

// The first 8 ids (u-200..u-207) cover every user the other mock samples emit
// (users/detail/efficiency all index NAMES by i%8 starting at u-200). The
// remaining ids (u-208..u-214) give the name map extra rows so the resolver
// has data to show even when a list surfaces an id beyond the core 8.
export function getMockUserNames(): UserNameRow[] {
  return ROWS.map(([realName, empNo], i) => ({
    user_id: `u-${200 + i}`,
    universal_id: `uni-${1000 + i}`,
    real_name: realName,
    emp_no: empNo,
  }));
}

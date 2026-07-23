// 周窗口切分 —— 平台(chat-stats)无「按用户的时间桶」，但 /stats/users/ranking 吃日期范围。
// 故把全局 timeRange 切成 N 个 ISO 周窗口，各查一次区间聚合，拼成「按周」的个人/组织时间线。
// 纯函数，便于单测；不依赖 React / 网络。窗口以周一为界（对齐 lib/week.ts 的 ISO 周口径）。

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Date → 本地 'YYYY-MM-DD'。 */
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 'YYYY-MM-DD' → 本地 Date（置零到 00:00:00）。非法返回 null。 */
function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) {
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate())
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** 取某日期所在 ISO 周的周一（本地 00:00:00；周一为一周起始）。 */
function isoWeekMonday(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - day)
  return date
}

export interface WeekWindow {
  /** 'YYYY-Wxx'（对齐 lib/week.ts 的 key 口径）。 */
  key: string
  /** 该周周一（本地 00:00:00），趋势排序/标签用。 */
  monday: Date
  /** 查询用起始日期 'YYYY-MM-DD'（不早于 rangeStart）。 */
  startDate: string
  /** 查询用结束日期 'YYYY-MM-DD'（不晚于 rangeEnd）。 */
  endDate: string
}

/** ISO 周编号（ISO-8601：含当年第一个周四的那周为第 1 周）—— 与 lib/week.ts 一致。 */
function isoWeekNumber(d: Date): { year: number; week: number } {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - day + 3)
  const firstThursday = new Date(date.getFullYear(), 0, 4)
  const firstDay = (firstThursday.getDay() + 6) % 7
  firstThursday.setDate(firstThursday.getDate() - firstDay + 3)
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000))
  return { year: date.getFullYear(), week }
}

/**
 * 把 [rangeStart, rangeEnd]（含端点，'YYYY-MM-DD'）切成按 ISO 周（周一为界）的窗口列表。
 * 首尾窗口被 range 端点裁剪（startDate/endDate 不越界）。区间过大时用 maxWindows 兜底（取最后 N 周，
 * 避免 N 次串行请求拖死）。非法/空区间返回空数组。
 */
export function sliceWeekWindows(
  rangeStart: string,
  rangeEnd: string,
  maxWindows = 16,
): WeekWindow[] {
  const start = parseLocalDate(rangeStart)
  const end = parseLocalDate(rangeEnd)
  if (!start || !end || start.getTime() > end.getTime()) return []

  const windows: WeekWindow[] = []
  // 从首周周一逐周推进，直到越过 end。
  let cursor = isoWeekMonday(start)
  while (cursor.getTime() <= end.getTime()) {
    const weekEnd = new Date(cursor)
    weekEnd.setDate(weekEnd.getDate() + 6) // 该周周日
    // 与 range 端点求交集（首尾窗口裁剪）。
    const winStart = cursor.getTime() < start.getTime() ? start : cursor
    const winEnd = weekEnd.getTime() > end.getTime() ? end : weekEnd
    const { year, week } = isoWeekNumber(cursor)
    windows.push({
      key: `${year}-W${pad2(week)}`,
      monday: new Date(cursor),
      startDate: toDateStr(winStart),
      endDate: toDateStr(winEnd),
    })
    cursor = new Date(cursor)
    cursor.setDate(cursor.getDate() + 7)
  }

  // 兜底：窗口太多只取最近 maxWindows 周（趋势看近况，且限制串行请求数）。
  if (windows.length > maxWindows) return windows.slice(windows.length - maxWindows)
  return windows
}

/** 周一日期 → 'MM/DD' 显示标签（趋势 x 轴用；对齐 lib/week.ts weekLabel）。 */
export function weekWindowLabel(monday: Date): string {
  return `${pad2(monday.getMonth() + 1)}/${pad2(monday.getDate())}`
}

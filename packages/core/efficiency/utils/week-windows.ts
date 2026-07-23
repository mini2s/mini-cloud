// Week-window slicing — the platform (chat-stats) has no "per-user time bucket", but /stats/users/ranking accepts a date range.
// So we split the global timeRange into N ISO-week windows, query a per-range aggregate once each, and stitch them into a "by-week" personal/org timeline.
// Pure functions for easy unit testing; no React / network dependency. Windows are bounded by Monday (aligned with lib/week.ts's ISO-week scope).

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Date → local 'YYYY-MM-DD'. */
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 'YYYY-MM-DD' → local Date (zeroed to 00:00:00). Returns null if invalid. */
function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) {
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate())
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** Get the Monday of the ISO week containing a date (local 00:00:00; week starts Monday). */
function isoWeekMonday(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - day)
  return date
}

export interface WeekWindow {
  /** 'YYYY-Wxx' (aligned with lib/week.ts's key scope). */
  key: string
  /** Monday of the week (local 00:00:00), for trend sorting/labeling. */
  monday: Date
  /** Query start date 'YYYY-MM-DD' (no earlier than rangeStart). */
  startDate: string
  /** Query end date 'YYYY-MM-DD' (no later than rangeEnd). */
  endDate: string
}

/** ISO week number (ISO-8601: the week containing the year's first Thursday is week 1) — consistent with lib/week.ts. */
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
 * Split [rangeStart, rangeEnd] (inclusive, 'YYYY-MM-DD') into a list of windows by ISO week (bounded by Monday).
 * The first and last windows are clipped by the range endpoints (startDate/endDate stay in bounds). When the range is too large, maxWindows caps it (taking the last N weeks,
 * to avoid N serial requests hanging). Returns an empty array for invalid/empty ranges.
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
  // Advance week by week from the first Monday until past end.
  let cursor = isoWeekMonday(start)
  while (cursor.getTime() <= end.getTime()) {
    const weekEnd = new Date(cursor)
    weekEnd.setDate(weekEnd.getDate() + 6) // Sunday of that week
    // Intersect with range endpoints (clip the first/last windows).
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

  // Fallback: too many windows → keep only the most recent maxWindows weeks (trends look at recent state, and this caps the number of serial requests).
  if (windows.length > maxWindows) return windows.slice(windows.length - maxWindows)
  return windows
}

/** Monday date → 'MM/DD' display label (for the trend x-axis; aligned with lib/week.ts weekLabel). */
export function weekWindowLabel(monday: Date): string {
  return `${pad2(monday.getMonth() + 1)}/${pad2(monday.getDate())}`
}

// Date utilities — ported verbatim from Vue frontend/src/utils/date.js.
// list endpoint params must first be converted via formatDateParam to YYYYMMDD before sending. See research/api-contract.md §3.5.

function fmt(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Last 7 days range → [startStr, endStr], format YYYY-MM-DD (includes today, -6) */
export function getDefaultDateRange(): [string, string] {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 6)
  return [fmt(start), fmt(end)]
}

/** Last N days range (default 90), for pages with a wide data span (Home / executive dashboard) */
export function getDefaultDateRangeWide(days = 90): [string, string] {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - (days - 1))
  return [fmt(start), fmt(end)]
}

/** 'YYYY-MM-DD' → 'YYYYMMDD' */
export function formatDateParam(dateStr: string): string {
  return dateStr.replace(/-/g, '')
}

/** Add (or subtract) N days to a 'YYYY-MM-DD' string, returning 'YYYY-MM-DD'. */
export function addDays(dateStr: string, delta: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + delta)
  return fmt(d)
}

/**
 * The previous comparison window for a [start, end] range: an equal-length
 * span immediately before `start` (i.e. [start - span, start - 1]). Used by
 * the usage period-compare query to feed the backend's previous_start /
 * previous_end params. Shared by the mock path and the real-api path so the
 * "previous = equal span before current" rule lives in one place.
 */
export function computePreviousRange(start: string, end: string): [string, string] {
  const span =
    Math.round(
      (new Date(end + 'T00:00:00').getTime() -
        new Date(start + 'T00:00:00').getTime()) /
        86_400_000,
    ) + 1
  return [addDays(start, -span), addDays(start, -1)]
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function parseCalendarDate(value: string): [number, number, number] | null {
  const match = DATE_RE.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return [year, month, day]
}

function addCalendarDays(value: string, days: number): string | null {
  const parsed = parseCalendarDate(value)
  if (!parsed) return null
  const date = new Date(Date.UTC(parsed[0], parsed[1] - 1, parsed[2] + days))
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  const day = String(date.getUTCDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/**
 * Converts an inclusive calendar-day selection in Shanghai time to the sync
 * API's half-open [start, end) interval.
 */
export function toShanghaiSyncRange(
  startDate: string,
  endDate: string,
): { start_time: string; end_time: string } | null {
  if (
    !parseCalendarDate(startDate) ||
    !parseCalendarDate(endDate) ||
    startDate > endDate
  ) {
    return null
  }
  const exclusiveEnd = addCalendarDays(endDate, 1)
  if (!exclusiveEnd) return null
  return {
    start_time: `${startDate}T00:00:00+08:00`,
    end_time: `${exclusiveEnd}T00:00:00+08:00`,
  }
}

function shanghaiDate(instant: Date): string {
  return new Date(instant.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

/**
 * Renders a Shanghai-midnight half-open interval as an inclusive day range.
 * Returns null for invalid or non-calendar-day intervals.
 */
export function formatShanghaiDayRange(
  startTime: string,
  endTime: string,
): string | null {
  const start = new Date(startTime)
  const end = new Date(endTime)
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start >= end
  ) {
    return null
  }
  const startShanghai = new Date(start.getTime() + 8 * 60 * 60 * 1000)
  const endShanghai = new Date(end.getTime() + 8 * 60 * 60 * 1000)
  const isMidnight = (date: Date) =>
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  if (!isMidnight(startShanghai) || !isMidnight(endShanghai)) return null
  return `${shanghaiDate(start)} ~ ${shanghaiDate(new Date(end.getTime() - 1))}`
}

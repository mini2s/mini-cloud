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

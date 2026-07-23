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

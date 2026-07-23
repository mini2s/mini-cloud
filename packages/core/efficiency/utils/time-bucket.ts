// Trend time bucketing — re-aggregates "by-day" data into day/week/month granularity (front-end only, does not change backend data fetching).
// Weeks **start on Sunday** (unlike lib/week.ts's ISO Monday-start scope, so a separate implementation).
// The date range / day count of the first and last buckets is clipped by clamp (usually the selected timeRange) to avoid going out of bounds.

export type Granularity = 'day' | 'week' | 'month'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 'YYYY-MM-DD' → local Date (zeroed to 00:00:00). Returns null if invalid. */
function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Date → local 'YYYY-MM-DD'. */
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 'YYYY-MM-DD' → 'MM/DD' (x-axis label). */
function mmdd(s: string): string {
  const d = parseLocalDate(s)
  return d ? `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}` : s
}

/** Inclusive day span. Returns 0 if invalid/reversed. */
export function rangeDays(start: string, end: string): number {
  const a = parseLocalDate(start)
  const b = parseLocalDate(end)
  if (!a || !b || a.getTime() > b.getTime()) return 0
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1
}

/** Available granularity set based on range span (< 14d day only; ≥ 14d day/week; ≥ 60d day/week/month). */
export function availableGranularities(spanDays: number): Granularity[] {
  if (spanDays >= 60) return ['day', 'week', 'month']
  if (spanDays >= 14) return ['day', 'week']
  return ['day']
}

/** Default granularity: ≥ 60d month, ≥ 14d week, otherwise day. */
export function defaultGranularity(spanDays: number): Granularity {
  if (spanDays >= 60) return 'month'
  if (spanDays >= 14) return 'week'
  return 'day'
}

export const GRANULARITY_CN: Record<Granularity, string> = { day: '按天', week: '按周', month: '按月' }

export interface TimeBucket {
  /** Unique key. day: 'YYYY-MM-DD'; week: that week's Sunday 'YYYY-MM-DD'; month: 'YYYY-MM'. */
  key: string
  /** x-axis label. day/week: 'MM/DD' (week uses Sunday); month: 'M月'. */
  label: string
  /** Tooltip header date range (first/last buckets clipped by clamp). day: 'YYYY-MM-DD'; week/month: 'YYYY-MM-DD ~ YYYY-MM-DD'. */
  rangeText: string
  /** Dates that fall into this bucket and appear in the data (ascending). */
  dates: string[]
  /** Calendar days this bucket covers within clamp (denominator for the active-user "daily average"). */
  spanDays: number
}

/** Get the Sunday of the week containing a date (local 00:00:00; Sunday is the first day of the week). */
function sundayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - x.getDay()) // getDay(): Sunday=0
  return x
}

function strMax(a: string, b?: string): string {
  return b && b > a ? b : a
}
function strMin(a: string, b?: string): string {
  return b && b < a ? b : a
}

/**
 * Re-aggregate dates appearing in the data into buckets of the specified granularity (ascending by time).
 * @param sortedDates Dates appearing in the data ('YYYY-MM-DD'; deduped + sorted internally).
 * @param gran Target granularity.
 * @param clamp Range used to clip the first/last buckets' rangeText/spanDays (usually the selected timeRange).
 */
export function buildBuckets(
  dates: string[],
  gran: Granularity,
  clamp?: { start?: string; end?: string },
): TimeBucket[] {
  const uniq = Array.from(new Set(dates.filter((d) => parseLocalDate(d)))).sort()
  if (!uniq.length) return []

  // 1. Group: key → member dates (in appearance order; since uniq is ascending, naturally time-ordered).
  const order: string[] = []
  const groups = new Map<string, string[]>()
  for (const ds of uniq) {
    const d = parseLocalDate(ds)!
    let key: string
    if (gran === 'week') key = toDateStr(sundayOf(d))
    else if (gran === 'month') key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
    else key = ds
    if (!groups.has(key)) {
      groups.set(key, [])
      order.push(key)
    }
    groups.get(key)!.push(ds)
  }

  // 2. Compute label / rangeText / spanDays per bucket (first/last clipped to natural bounds by clamp).
  return order.map((key) => {
    const memberDates = groups.get(key)!
    let label: string
    let boundStart: string
    let boundEnd: string
    if (gran === 'day') {
      label = mmdd(key)
      boundStart = key
      boundEnd = key
    } else if (gran === 'week') {
      const sun = parseLocalDate(key)!
      const sat = new Date(sun)
      sat.setDate(sat.getDate() + 6)
      label = mmdd(key)
      boundStart = key
      boundEnd = toDateStr(sat)
    } else {
      const y = Number(key.slice(0, 4))
      const mo = Number(key.slice(5, 7))
      label = `${mo}月`
      boundStart = `${key}-01`
      boundEnd = toDateStr(new Date(y, mo, 0)) // last day of that month
    }
    // clamp clipping
    const clampedStart = strMax(boundStart, clamp?.start)
    const clampedEnd = strMin(boundEnd, clamp?.end)
    const spanDays = Math.max(1, rangeDays(clampedStart, clampedEnd))
    const rangeText = gran === 'day' ? key : `${clampedStart} ~ ${clampedEnd}`
    return { key, label, rangeText, dates: memberDates, spanDays }
  })
}

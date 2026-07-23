// 趋势时间分桶 —— 把「按天」数据重聚合成 天/周/月 粒度（纯前端，不改后端取数）。
// 周**以周日为一周首天**（区别于 lib/week.ts 的 ISO 周一口径，故另起一套）。
// 首尾桶的日期范围 / 天数按 clamp（一般传所选 timeRange）裁剪，避免越界。

export type Granularity = 'day' | 'week' | 'month'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 'YYYY-MM-DD' → 本地 Date（置零到 00:00:00）。非法返回 null。 */
function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Date → 本地 'YYYY-MM-DD'。 */
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 'YYYY-MM-DD' → 'MM/DD'（x 轴标签）。 */
function mmdd(s: string): string {
  const d = parseLocalDate(s)
  return d ? `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}` : s
}

/** 含端点的天数跨度。非法/逆序返回 0。 */
export function rangeDays(start: string, end: string): number {
  const a = parseLocalDate(start)
  const b = parseLocalDate(end)
  if (!a || !b || a.getTime() > b.getTime()) return 0
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1
}

/** 按区间跨度给可选粒度集合（< 14d 仅天；≥ 14d 天/周；≥ 60d 天/周/月）。 */
export function availableGranularities(spanDays: number): Granularity[] {
  if (spanDays >= 60) return ['day', 'week', 'month']
  if (spanDays >= 14) return ['day', 'week']
  return ['day']
}

/** 默认粒度：≥ 60d 月，≥ 14d 周，否则天。 */
export function defaultGranularity(spanDays: number): Granularity {
  if (spanDays >= 60) return 'month'
  if (spanDays >= 14) return 'week'
  return 'day'
}

export const GRANULARITY_CN: Record<Granularity, string> = { day: '按天', week: '按周', month: '按月' }

export interface TimeBucket {
  /** 唯一键。day: 'YYYY-MM-DD'；week: 该周周日 'YYYY-MM-DD'；month: 'YYYY-MM'。 */
  key: string
  /** x 轴标签。day/week: 'MM/DD'（week 取周日）；month: 'M月'。 */
  label: string
  /** tooltip 头部日期范围（首尾桶按 clamp 裁剪）。day: 'YYYY-MM-DD'；week/month: 'YYYY-MM-DD ~ YYYY-MM-DD'。 */
  rangeText: string
  /** 落入该桶、且在数据里出现的日期（升序）。 */
  dates: string[]
  /** 该桶在 clamp 内覆盖的日历天数（活跃用户「日均」分母用）。 */
  spanDays: number
}

/** 取某日期所在周的周日（本地 00:00:00；周日为一周首天）。 */
function sundayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - x.getDay()) // getDay(): 周日=0
  return x
}

function strMax(a: string, b?: string): string {
  return b && b > a ? b : a
}
function strMin(a: string, b?: string): string {
  return b && b < a ? b : a
}

/**
 * 把数据里出现的日期重聚合成指定粒度的桶（按时间升序）。
 * @param sortedDates 数据中出现的日期（'YYYY-MM-DD'，会内部去重+排序）。
 * @param gran 目标粒度。
 * @param clamp 用于裁剪首尾桶 rangeText/spanDays 的区间（一般传所选 timeRange）。
 */
export function buildBuckets(
  dates: string[],
  gran: Granularity,
  clamp?: { start?: string; end?: string },
): TimeBucket[] {
  const uniq = Array.from(new Set(dates.filter((d) => parseLocalDate(d)))).sort()
  if (!uniq.length) return []

  // 1. 分组：key → 成员日期（按出现顺序，因 uniq 已升序故天然时间序）。
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

  // 2. 每桶算 label / rangeText / spanDays（首尾按 clamp 裁剪自然边界）。
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
      boundEnd = toDateStr(new Date(y, mo, 0)) // 该月最后一天
    }
    // clamp 裁剪
    const clampedStart = strMax(boundStart, clamp?.start)
    const clampedEnd = strMin(boundEnd, clamp?.end)
    const spanDays = Math.max(1, rangeDays(clampedStart, clampedEnd))
    const rangeText = gran === 'day' ? key : `${clampedStart} ~ ${clampedEnd}`
    return { key, label, rangeText, dates: memberDates, spanDays }
  })
}

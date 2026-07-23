// ISO 周工具 —— 高管大屏「提效趋势」按周聚合 needs 用。
// 周一为一周起始；key 形如 '2026-W21'。

/** 解析日期字符串为 Date（支持 ISO8601 带时区）。无效返回 null */
function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d
}

/** 取某日期所在 ISO 周的周一（本地时区，置零到 00:00:00） */
function isoWeekMonday(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  // getDay(): 周日=0 … 周六=6 → 换算到周一为 0 的偏移
  const day = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - day)
  return date
}

/** ISO 周编号（ISO-8601：含当年第一个周四的那周为第 1 周） */
function isoWeekNumber(d: Date): { year: number; week: number } {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  // 移到本周周四（ISO 周以周四定年）
  const day = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - day + 3)
  const firstThursday = new Date(date.getFullYear(), 0, 4)
  const firstDay = (firstThursday.getDay() + 6) % 7
  firstThursday.setDate(firstThursday.getDate() - firstDay + 3)
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000))
  return { year: date.getFullYear(), week }
}

export interface IsoWeek {
  /** 'YYYY-Wxx' */
  key: string
  /** 该周周一（本地 00:00:00） */
  monday: Date
}

/** 日期字符串 → ISO 周。无效日期返回 null */
export function isoWeekOf(dateStr: string | null | undefined): IsoWeek | null {
  const d = parseDate(dateStr)
  if (!d) return null
  const { year, week } = isoWeekNumber(d)
  return { key: `${year}-W${String(week).padStart(2, '0')}`, monday: isoWeekMonday(d) }
}

/** 周一日期 → 'MM/DD' 显示标签（趋势 x 轴用） */
export function weekLabel(monday: Date): string {
  const m = String(monday.getMonth() + 1).padStart(2, '0')
  const d = String(monday.getDate()).padStart(2, '0')
  return `${m}/${d}`
}

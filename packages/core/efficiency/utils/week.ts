// ISO week utilities — aggregates needs by week for the executive "efficiency trend" view.
// Week starts Monday; key format like '2026-W21'.

/** Parse a date string into a Date (supports ISO8601 with timezone). Returns null if invalid. */
function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d
}

/** Get the Monday of the ISO week containing a date (local timezone, zeroed to 00:00:00). */
function isoWeekMonday(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  // getDay(): Sunday=0 … Saturday=6 → convert to an offset where Monday is 0
  const day = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - day)
  return date
}

/** ISO week number (ISO-8601: the week containing the year's first Thursday is week 1). */
function isoWeekNumber(d: Date): { year: number; week: number } {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  // Move to this week's Thursday (the ISO week determines the year by Thursday)
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
  /** Monday of the week (local 00:00:00) */
  monday: Date
}

/** Date string → ISO week. Returns null for an invalid date. */
export function isoWeekOf(dateStr: string | null | undefined): IsoWeek | null {
  const d = parseDate(dateStr)
  if (!d) return null
  const { year, week } = isoWeekNumber(d)
  return { key: `${year}-W${String(week).padStart(2, '0')}`, monday: isoWeekMonday(d) }
}

/** Monday date → 'MM/DD' display label (for the trend x-axis). */
export function weekLabel(monday: Date): string {
  const m = String(monday.getMonth() + 1).padStart(2, '0')
  const d = String(monday.getDate()).padStart(2, '0')
  return `${m}/${d}`
}

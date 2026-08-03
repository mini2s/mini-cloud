// Ratio formatting — ported verbatim from Vue frontend/src/utils/formatters.js (dropping the el-table (row,col,value) signature, taking only value).
// Number ratios must match Vue exactly; see research/api-contract.md §3.1 / §4.

/** Cost: 2 decimal places */
export function fmtCost(value: number | null | undefined): string {
  if (value == null) return ''
  return Number(value).toFixed(2)
}

/** v2 efficiency ratio (decimal ratio: 0.25 => 25%). Empty/non-finite => '-'. Used by Need/User/Org lists/Dashboard */
export function formatV2Ratio(value: number | string | null | undefined, digits = 1): string {
  if (value == null || value === '') return '-'
  const num = Number(value)
  if (!Number.isFinite(num)) return '-'
  return `${(num * 100).toFixed(digits)}%`
}

/**
 * Percentage ratio: input is already a percentage value (e.g. 300 => '300.0%'), no ×100.
 * In Vue this was an inline `.toFixed(1)+'%'` (no formatPercent function); extracted here for consistency.
 * Used by Commit/Repo/Task/Project/Org detail/UserGroup. See api-contract §4.
 */
export function formatPercent(value: number | string | null | undefined, digits = 1): string {
  if (value == null || value === '') return '-'
  const num = Number(value)
  if (!Number.isFinite(num)) return '-'
  return `${num.toFixed(digits)}%`
}

/** Locale-aware thousands separator. */
export function formatNumber(
  value: number | string | null | undefined,
  digits = 0,
  locale = 'en',
): string {
  if (value == null || value === '') return '-'
  const num = Number(value)
  if (!Number.isFinite(num)) return '-'
  return num.toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** Currency code → symbol (system_currency KV; unknown codes returned as-is, default CNY) */
const CURRENCY_SYMBOL: Record<string, string> = { CNY: '¥', USD: '$', EUR: '€', GBP: '£', JPY: '¥' }
export function currencySymbol(code: string | null | undefined): string {
  const c = (code || 'CNY').toUpperCase()
  return CURRENCY_SYMBOL[c] || c
}

/** Format a value in the configured business currency using the UI locale. */
export function formatCurrency(
  value: number | null | undefined,
  currency: string,
  locale: string,
): string {
  if (value == null || !Number.isFinite(value)) return '-'
  const normalizedCurrency = currency.toUpperCase()
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: normalizedCurrency,
      currencyDisplay: 'symbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${currencySymbol(normalizedCurrency)}${formatNumber(value, 2, locale)}`
  }
}

/** AI-estimated person-days (1 decimal place, 0 => '-') */
export function fmtDays(value: number | null | undefined): string {
  if (value == null || value === 0) return '-'
  return Number(value).toFixed(1)
}

/** Milliseconds → minutes (1 decimal place, suffix ' min') */
export function fmtMsToMin(value: number | null | undefined): string {
  if (value == null) return ''
  const minutes = Number(value) / 60000
  return minutes.toFixed(1) + ' min'
}

/** ISO 8601 → local YYYY-MM-DD HH:mm:ss */
export function formatLocalTime(isoStr: string | null | undefined): string {
  if (!isoStr) return '-'
  const d = new Date(isoStr)
  if (isNaN(d.getTime())) return '-'
  const Y = d.getFullYear()
  const M = String(d.getMonth() + 1).padStart(2, '0')
  const D = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  return `${Y}-${M}-${D} ${h}:${m}:${s}`
}

/** ISO 8601 → local YYYY-MM-DD HH:mm (drop seconds, for compact list display). Empty/invalid => '-' */
export function formatDateTimeShort(isoStr: string | null | undefined): string {
  if (!isoStr) return '-'
  const d = new Date(isoStr)
  if (isNaN(d.getTime())) return '-'
  const Y = d.getFullYear()
  const M = String(d.getMonth() + 1).padStart(2, '0')
  const D = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${Y}-${M}-${D} ${h}:${m}`
}

/** ISO 8601 → local MM-DD HH:mm (drop year and seconds, for compact list display). Empty/invalid => '-' */
export function formatDateTimeNoYear(isoStr: string | null | undefined): string {
  if (!isoStr) return '-'
  const d = new Date(isoStr)
  if (isNaN(d.getTime())) return '-'
  const M = String(d.getMonth() + 1).padStart(2, '0')
  const D = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${M}-${D} ${h}:${m}`
}

export type DurationParts =
  | { kind: 'empty' }
  | { kind: 'minutes'; minutes: number }
  | { kind: 'hours'; hours: number }
  | { kind: 'hours_minutes'; hours: number; minutes: number }
  | { kind: 'person_days'; personDays: number }

/** Convert minutes to display-ready values without choosing localized labels. */
export function getDurationParts(
  minutes: number | null | undefined,
): DurationParts {
  const numericMinutes = Number(minutes)
  if (!Number.isFinite(numericMinutes) || numericMinutes <= 0) {
    return { kind: 'empty' }
  }
  const roundedMinutes = Math.round(numericMinutes)
  if (roundedMinutes < 60) {
    return { kind: 'minutes', minutes: roundedMinutes }
  }
  if (roundedMinutes <= PERSON_DAY_MINUTES) {
    const hours = Math.floor(roundedMinutes / 60)
    const remainingMinutes = roundedMinutes % 60
    return remainingMinutes === 0
      ? { kind: 'hours', hours }
      : { kind: 'hours_minutes', hours, minutes: remainingMinutes }
  }
  return {
    kind: 'person_days',
    personDays: roundedMinutes / PERSON_DAY_MINUTES,
  }
}

/** 1 person-day = 480 minutes (8 hours) */
export const PERSON_DAY_MINUTES = 480

/** Minutes → person-days (for the executive dashboard, aligned with Home.vue days()). <=0 => '-' */
export function toPersonDays(minutes: number | null | undefined, digits = 1): string {
  const m = Number(minutes || 0)
  if (!Number.isFinite(m) || m <= 0) return '-'
  return (m / PERSON_DAY_MINUTES).toFixed(digits)
}

/** Minutes → person-day number (used to multiply by the per-day rate to compute ¥). <=0 => 0 */
export function personDaysValue(minutes: number | null | undefined): number {
  const m = Number(minutes || 0)
  if (!Number.isFinite(m) || m <= 0) return 0
  return m / PERSON_DAY_MINUTES
}

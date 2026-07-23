// 日期工具 —— 从 Vue frontend/src/utils/date.js 原样搬运。
// list 端点参数要先 formatDateParam 转 YYYYMMDD 再发。见 research/api-contract.md §3.5。

function fmt(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 最近 7 天范围 → [startStr, endStr]，格式 YYYY-MM-DD（含今天，-6） */
export function getDefaultDateRange(): [string, string] {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 6)
  return [fmt(start), fmt(end)]
}

/** 最近 N 天范围（默认 90），用于数据跨度大的页面（Home/高管大屏用） */
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

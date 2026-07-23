// 口径格式化 —— 从 Vue frontend/src/utils/formatters.js 原样搬运（去掉 el-table 的 (row,col,value) 签名，只取 value）。
// 数字口径必须与 Vue 完全一致，见 research/api-contract.md §3.1 / §4。

/** 费用：保留 2 位小数 */
export function fmtCost(value: number | null | undefined): string {
  if (value == null) return ''
  return Number(value).toFixed(2)
}

/** v2 提效比（小数口径：0.25 => 25%）。空/非有限 => '-'。用于 Need/User/Org列表/Dashboard */
export function formatV2Ratio(value: number | string | null | undefined, digits = 1): string {
  if (value == null || value === '') return '-'
  const num = Number(value)
  if (!Number.isFinite(num)) return '-'
  return `${(num * 100).toFixed(digits)}%`
}

/**
 * 百分比口径：输入已是百分比数值（如 300 => '300.0%'），不再 ×100。
 * Vue 里是内联 `.toFixed(1)+'%'`（无 formatPercent 函数），这里抽函数统一。
 * 用于 Commit/Repo/Task/Project/Org详情/UserGroup。见 api-contract §4。
 */
export function formatPercent(value: number | string | null | undefined, digits = 1): string {
  if (value == null || value === '') return '-'
  const num = Number(value)
  if (!Number.isFinite(num)) return '-'
  return `${num.toFixed(digits)}%`
}

/** 千分位 */
export function formatNumber(value: number | string | null | undefined, digits = 0): string {
  if (value == null || value === '') return '-'
  const num = Number(value)
  if (!Number.isFinite(num)) return '-'
  return num.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** 币种代码 → 符号（system_currency KV；未知代码原样返回，缺省按 CNY） */
const CURRENCY_SYMBOL: Record<string, string> = { CNY: '¥', USD: '$', EUR: '€', GBP: '£', JPY: '¥' }
export function currencySymbol(code: string | null | undefined): string {
  const c = (code || 'CNY').toUpperCase()
  return CURRENCY_SYMBOL[c] || c
}

/** AI 预估人天（保留 1 位，0 => '-'） */
export function fmtDays(value: number | null | undefined): string {
  if (value == null || value === 0) return '-'
  return Number(value).toFixed(1)
}

/** 毫秒转分钟（保留 1 位，后缀 ' min'） */
export function fmtMsToMin(value: number | null | undefined): string {
  if (value == null) return ''
  const minutes = Number(value) / 60000
  return minutes.toFixed(1) + ' min'
}

/** ISO 8601 → 本地 YYYY-MM-DD HH:mm:ss */
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

/** ISO 8601 → 本地 YYYY-MM-DD HH:mm（去秒，列表紧凑展示用）。空/非法 => '-' */
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

/** ISO 8601 → 本地 MM-DD HH:mm（去年份、去秒，列表紧凑展示用）。空/非法 => '-' */
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

/** 分钟自适应：分钟 / 小时[分钟] / 人天（480min=1人天=8h）。0 与空 => '-' */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || minutes === 0) return '-'
  const m = Math.round(Number(minutes))
  if (m < 60) return `${m}分钟`
  if (m <= 480) {
    const h = Math.floor(m / 60)
    const rem = m % 60
    return rem === 0 ? `${h}小时` : `${h}小时${rem}分钟`
  }
  return (m / 480).toFixed(1) + '人天'
}

export const VERIFY_UNAVAILABLE_TIP = '当前采集口径未记录命令执行（bash / 测试 / 编译），验证时长不可用'
export const STAGE_ESTIMATE_TIP = '思考 / 执行为粗略口径：基于对话轮与代码 diff 推断，含时长估算'

/** 验证时长：0/空 => '—'（全角破折号 U+2014，采集未覆盖），非 0 正常显示 */
export function formatVerifyMin(minutes: number | null | undefined): string {
  if (Number(minutes || 0) === 0) return '—'
  return formatDuration(minutes)
}

/** 1 人天 = 480 分钟（8 小时） */
export const PERSON_DAY_MINUTES = 480

/** 分钟换算人天（高管大屏用，对齐 Home.vue days()）。<=0 => '-' */
export function toPersonDays(minutes: number | null | undefined, digits = 1): string {
  const m = Number(minutes || 0)
  if (!Number.isFinite(m) || m <= 0) return '-'
  return (m / PERSON_DAY_MINUTES).toFixed(digits)
}

/** 分钟换算人天数值（用于再乘人天单价算 ¥）。<=0 => 0 */
export function personDaysValue(minutes: number | null | undefined): number {
  const m = Number(minutes || 0)
  if (!Number.isFinite(m) || m <= 0) return 0
  return m / PERSON_DAY_MINUTES
}

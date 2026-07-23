// 列表排序 —— 从 Vue frontend/src/utils/sort.js 原样搬运（TS 泛型化）。
// order 约定与后端 parseOrderParam 一致：'-foo'=降序，'foo'=升序，空=无排序。
// 关键不变量：null/undefined 恒沉底（升降都末尾，不翻转）；同值按原始 index 稳定保序。
// 见 research/api-contract.md §3.4。

export interface ParsedOrder {
  field: string
  desc: boolean
}

/** 解析 order 字符串 → { field, desc } | null */
export function parseOrder(order?: string | null): ParsedOrder | null {
  const t = (order || '').trim()
  if (!t) return null
  return t.startsWith('-') ? { field: t.slice(1), desc: true } : { field: t, desc: false }
}

/** 由 field + desc 构造 order 字符串；field 空 → undefined（清除排序） */
export function toOrder(field?: string | null, desc?: boolean): string | undefined {
  if (!field) return undefined
  return desc ? `-${field}` : field
}

/** 非空值比较器：number 数值比较 / boolean false<true / 其它 localeCompare */
export function compareValue(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1
  return String(a).localeCompare(String(b))
}

/**
 * 客户端稳定排序：
 * - getter(row) == null 的行恒末尾（升降都末尾，不随方向翻转）
 * - 同值按原始 index 稳定保序
 */
export function sortRows<T>(rows: T[], getter: (row: T) => unknown, desc: boolean): T[] {
  const idx = rows.map((row, i) => ({ row, i }))
  idx.sort((A, B) => {
    const av = getter(A.row)
    const bv = getter(B.row)
    const ae = av == null
    const be = bv == null
    if (ae || be) {
      if (ae && be) return A.i - B.i
      return ae ? 1 : -1
    }
    const c = compareValue(av, bv)
    if (c !== 0) return desc ? -c : c
    return A.i - B.i
  })
  return idx.map((x) => x.row)
}

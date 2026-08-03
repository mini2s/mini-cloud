// List sorting — ported verbatim from Vue frontend/src/utils/sort.js (made generic in TS).
// The order convention matches the backend parseOrderParam: '-foo'=descending, 'foo'=ascending, empty=no sort.
// Key invariant: null/undefined always sinks to the bottom (last in both directions, never flipped); ties keep the original index order (stable).
// See research/api-contract.md §3.4.

export interface ParsedOrder {
  field: string
  desc: boolean
}

/** Parse an order string → { field, desc } | null */
export function parseOrder(order?: string | null): ParsedOrder | null {
  const t = (order || '').trim()
  if (!t) return null
  return t.startsWith('-') ? { field: t.slice(1), desc: true } : { field: t, desc: false }
}

/** Build an order string from field + desc; empty field → undefined (clears the sort) */
export function toOrder(field?: string | null, desc?: boolean): string | undefined {
  if (!field) return undefined
  return desc ? `-${field}` : field
}

/** Non-null value comparator: number numeric comparison / boolean false<true / others via localeCompare */
export function compareValue(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1
  return String(a).localeCompare(String(b))
}

/**
 * Client-side stable sort:
 * - rows whose getter(row) == null always go last (last in both directions, never flips with direction)
 * - ties keep the original index order (stable)
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

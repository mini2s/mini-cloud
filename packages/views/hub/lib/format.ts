// Shared display-format helpers for the hub module. Single source of truth —
// do NOT re-declare local copies inside components (previously scattered as
// `fmtCompact`/`fmt` across hub-manager, subscribe-button, card/list views).

// formatCompact renders a count in compact form: 999 → "999", 1_500 → "1.5K",
// 2_000_000 → "2M". Trailing ".0" is stripped so round numbers stay clean.
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0"
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
}

// formatCount is formatCompact for nullable stats — renders "—" when the
// backend did not return the field.
export function formatCount(n: number | null | undefined): string {
  if (n == null) return "—"
  return formatCompact(n)
}

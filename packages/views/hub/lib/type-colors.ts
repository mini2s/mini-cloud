/**
 * SD-09: capability type → themeable accent color mapping.
 *
 * Replaces the hard-coded hex `TYPE_COLORS` that lived in `lib/constants.ts`.
 * Every entry resolves to a CSS custom property so the palette reacts to the
 * active theme (light/dark) instead of pinning one hex value that only read
 * well on light backgrounds.
 *
 * - skill / subagent / command reuse the global semantic tokens
 *   (--warning / --info / --success) which already have tuned dark variants.
 * - mcp / plugin have no semantic counterpart in the palette, so two hub
 *   tokens (--hub-type-mcp / --hub-type-plugin) are registered in
 *   `packages/ui/styles/tokens.css` for both light and dark themes.
 */

export const TYPE_COLORS: Record<string, string> = {
  skill: "var(--warning)",
  subagent: "var(--info)",
  command: "var(--success)",
  mcp: "var(--hub-type-mcp)",
  plugin: "var(--hub-type-plugin)",
}

/** Resolve the accent color for a capability type, falling back to --primary. */
export function typeColor(type: string): string {
  return TYPE_COLORS[type] ?? "var(--primary)"
}

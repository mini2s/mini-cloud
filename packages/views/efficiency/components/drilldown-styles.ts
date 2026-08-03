/**
 * Shared visual affordances for efficiency drill-down controls.
 *
 * Keep these classes centralized so a clickable table row, text link, or tree
 * item always has the same pointer, hover, and keyboard-focus feedback.
 */
export const DRILLDOWN_ROW_CLASS =
  "group cursor-pointer transition-colors hover:bg-accent/70 hover:text-accent-foreground focus-visible:bg-accent/70 focus-visible:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

export const DRILLDOWN_LINK_CLASS =
  "cursor-pointer rounded-sm font-medium text-brand underline decoration-brand/35 underline-offset-4 transition-colors hover:bg-brand/5 hover:text-brand hover:decoration-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50";

export const DRILLDOWN_TREE_ITEM_CLASS =
  "cursor-pointer transition-colors hover:bg-accent/70 hover:text-accent-foreground focus-visible:bg-accent/70 focus-visible:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

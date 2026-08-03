"use client";

import type { ReactNode } from "react";

// Shared helpers for the four efficiency settings pages (pricing / datasources
// / sync / config). Kept here (not in usage/shared or detail/shared) because
// the settings pages use a different layout: a bordered "section" card with a
// header row (title + count + actions) + an optional table body, plus a
// labelled Field row for the forms. The usage Th/Td primitives ARE reused for
// the settings tables (re-exported below for one-import ergonomics).
//
// These are top-level pages rather than detail drill-downs. Each page owns its
// PageHeader and uses semantic colour tokens so it can render in both themes.

// ============================ Section card ============================

interface SectionProps {
  /** Header title (e.g. "Model pricing"). */
  title: string;
  /** Optional small count/caption rendered beside the title. */
  count?: ReactNode;
  /** Right-aligned slot for actions (Add button, Refresh, etc.). */
  rightSlot?: ReactNode;
  /** Body. Tables should pass bodyClassName="overflow-x-auto". */
  children: ReactNode;
  /** Extra body classes. */
  bodyClassName?: string;
}

/**
 * Bordered section card with a header row (title + count + right slot). The
 * canonical container for each settings page block. Mirrors the source's
 * "glass rounded-2xl" panels, ported to the shadcn semantic-token vocabulary.
 */
export function Section({
  title,
  count,
  rightSlot,
  children,
  bodyClassName,
}: SectionProps) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <span className="text-sm font-semibold text-card-foreground">
          {title}
          {count != null && (
            <span className="ml-1 text-muted-foreground">({count})</span>
          )}
        </span>
        {rightSlot != null && (
          <div className="flex items-center gap-2">{rightSlot}</div>
        )}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

// ============================ Form field ============================

interface FieldProps {
  label: string;
  /** Optional small hint rendered under the control. */
  hint?: ReactNode;
  children: ReactNode;
}

/**
 * Labelled form field (label + control + optional hint). The source's
 * SettingsLayout.Field; ported to plain JSX so it composes with any input.
 */
export function SettingsField({ label, hint, children }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      {children}
      {hint != null && (
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}

// ============================ Page error banner ============================

/**
 * Inline error banner for a failed read query (replaces the table body). Keeps
 * the table-less "failed to load" state consistent across the four pages.
 */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-destructive">
      {message}
    </div>
  );
}

// ============================ Table primitive re-exports ============================
// The settings tables (pricing list, datasource list, sync task list) reuse the
// usage dimension's Th/Td presentational primitives. Re-exported here so each
// page imports from one module.
export { Th, ThNum, Td, TdNum } from "../usage/shared";

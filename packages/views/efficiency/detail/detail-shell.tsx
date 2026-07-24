"use client";

import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";

// Shared shell for the four efficiency detail pages (user/need/task/commit).
// Provides the chrome they all share: a back button (wired via onBack so the
// shared view stays free of any router dependency), a title block, and the
// three terminal states (loading/error/empty) so each page can hand off the
// whole render instead of duplicating the spinner/alert boilerplate.
//
// Design decision #1: no react-router in shared views. The route page owns
// navigation and passes an `onBack` callback here; this component never
// imports next/* or react-router-dom.

interface DetailShellProps {
  /** Back navigation — owned by the route page (e.g. router.back()). */
  onBack: () => void;
  /** Page heading (e.g. "User detail"). */
  title: string;
  /** Sub-line under the title (e.g. the entity id / display name). */
  subtitle?: ReactNode;
  /** Badges/tags rendered on the right of the title row. */
  headerExtra?: ReactNode;
  /** Body content. Rendered only when not loading/error/empty. */
  children?: ReactNode;
  /** Show the loading state (skeleton) instead of children. */
  loading?: boolean;
  /** Show the error state with this message instead of children. */
  error?: unknown;
  /** Show the empty state with this message instead of children. */
  empty?: ReactNode;
}

export function DetailShell({
  onBack,
  title,
  subtitle,
  headerExtra,
  children,
  loading,
  error,
  empty,
}: DetailShellProps) {
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* Title row: back button + heading + optional badges. */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-foreground">
              {title}
            </h1>
            {subtitle != null && (
              <p className="mt-0.5 truncate break-all font-mono text-xs text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {headerExtra != null && (
          <div className="flex flex-wrap items-center gap-2">{headerExtra}</div>
        )}
      </header>

      {/* Body: terminal states take precedence over children. */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-5">
        {error != null ? (
          <StateBlock tone="error">
            {(error as Error)?.message || "Failed to load detail."}
          </StateBlock>
        ) : loading ? (
          <DetailSkeleton />
        ) : empty != null ? (
          <StateBlock tone="muted">{empty}</StateBlock>
        ) : (
          <div className="space-y-5">{children}</div>
        )}
      </div>
    </div>
  );
}

// Generic centered state block for error/empty messages. tone picks the
// semantic colour (destructive for errors, muted-foreground for empties).
function StateBlock({
  tone,
  children,
}: {
  tone: "error" | "muted";
  children: ReactNode;
}) {
  const cls =
    tone === "error" ? "text-destructive" : "text-muted-foreground";
  return (
    <div
      className={`flex min-h-[200px] items-center justify-center rounded-lg border px-6 py-8 text-center text-sm ${cls}`}
    >
      {children}
    </div>
  );
}

// Loading skeleton: a row of KPI tiles + a few section blocks, matching the
// shape of every detail page so the layout doesn't jump when data lands.
function DetailSkeleton() {
  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-lg border bg-card"
          />
        ))}
      </section>
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="h-48 animate-pulse rounded-lg border bg-card" />
      ))}
    </div>
  );
}

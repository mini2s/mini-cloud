"use client";

import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";
import { useT } from "../i18n";
import { PageHeader } from "../layout/page-header";

/**
 * Generic placeholder for product pages whose real implementation is pending.
 *
 * Renders the standard dashboard page header (so the mobile sidebar trigger
 * keeps working) plus a centered empty state. Each upcoming page wraps this
 * with its own title / description / icon; when the real feature lands, swap
 * the wrapper for the real component and delete the entry from
 * `packages/views/placeholders`.
 */
interface PlaceholderBodyProps {
  /** Already-translated title, shown as the headline. */
  title: string;
  /** Optional sub-line shown under the icon. */
  description?: string;
  /** Lucide icon component rendered in the empty state. */
  icon?: ComponentType<LucideProps>;
}

/**
 * Centered empty state without a page header. Use when embedding a placeholder
 * inside a surface that already renders its own header (e.g. project detail tabs).
 */
export function PlaceholderBody({ title, description, icon: Icon }: PlaceholderBodyProps) {
  const { t } = useT("common");
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      {Icon ? (
        <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Icon className="size-6" />
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-base font-medium">{title}</p>
        {description ? (
          <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <span className="rounded-full border border-dashed px-3 py-1 text-xs text-muted-foreground">
        {t(($) => $.placeholder.coming_soon)}
      </span>
    </div>
  );
}

interface PlaceholderPageProps extends PlaceholderBodyProps {
  /** Shown in the header bar; defaults to `title` when omitted. */
  title: string;
}

export function PlaceholderPage({ title, description, icon: Icon }: PlaceholderPageProps) {
  return (
    <>
      <PageHeader>
        <h1 className="text-sm font-semibold">{title}</h1>
      </PageHeader>
      <PlaceholderBody title={title} description={description} icon={Icon} />
    </>
  );
}

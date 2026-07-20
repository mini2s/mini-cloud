import { Construction } from "lucide-react";

interface ComingSoonProps {
  /** Module key, for future analytics / deep linking */
  module?: string;
  /** Display label shown to the user */
  label: string;
}

/**
 * Placeholder for pages scheduled in Phases 1–7 of the admin UI program.
 * Rendered by every page.tsx whose underlying view doesn't exist yet.
 */
export function ComingSoon({ module, label }: ComingSoonProps) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center"
      data-module={module}
    >
      <Construction className="size-10 text-muted-foreground" />
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">{label}</h2>
        <p className="text-sm text-muted-foreground">
          此页面正在开发中 / This page is under construction.
        </p>
      </div>
    </div>
  );
}

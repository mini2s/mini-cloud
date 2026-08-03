"use client"

import { useT } from "@multica/views/i18n"
import { cn } from "@multica/ui/lib/utils"
import { LayoutGrid, Rows3 } from "lucide-react"

export type ViewMode = "grid" | "list"

export interface ViewToggleProps {
  value: ViewMode
  onChange: (mode: ViewMode) => void
}

export function ViewToggle({ value, onChange }: ViewToggleProps) {
  const { t } = useT("hub")

  const modes: { key: ViewMode; icon: typeof LayoutGrid; label: string }[] = [
    { key: "grid", icon: LayoutGrid, label: t(($) => $.home.view.grid) },
    { key: "list", icon: Rows3, label: t(($) => $.home.view.list) },
  ]

  return (
    <div className="inline-flex items-center rounded-lg border border-border/60 bg-background p-0.5">
      {modes.map((mode) => {
        const Icon = mode.icon
        const active = value === mode.key
        return (
          <button
            key={mode.key}
            type="button"
            aria-label={mode.label}
            title={mode.label}
            onClick={() => onChange(mode.key)}
            className={cn(
              "flex cursor-pointer items-center justify-center rounded-md p-1.5 transition-colors",
              active
                ? "bg-accent text-accent-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon size={16} />
          </button>
        )
      })}
    </div>
  )
}

export default ViewToggle

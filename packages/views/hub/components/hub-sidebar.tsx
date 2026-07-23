"use client"

import { useT } from "@multica/views/i18n"
import { cn } from "@multica/ui/lib/utils"
import { HubIcon } from "../lib/hub-icons"

export interface NavItem {
  key: string
  labelKey: string
  icon: "all" | "skill" | "subagent" | "command" | "mcp" | "plugin"
  type?: string
}

export const HUB_NAV: NavItem[] = [
  { key: "all", labelKey: "hub.home.typeTab.all", icon: "all" },
  { key: "skill", labelKey: "hub.home.typeTab.skill", icon: "skill", type: "skill" },
  { key: "subagent", labelKey: "hub.home.typeTab.subagent", icon: "subagent", type: "subagent" },
  { key: "command", labelKey: "hub.home.typeTab.command", icon: "command", type: "command" },
  { key: "mcp", labelKey: "hub.home.typeTab.mcp", icon: "mcp", type: "mcp" },
  { key: "plugin", labelKey: "hub.home.typeTab.plugin", icon: "plugin", type: "plugin" },
]

export interface HubSidebarProps {
  currentType?: string | null
  counts?: Record<string, number>
  onNavigate?: (type?: string) => void
}

export function HubSidebar({ currentType, counts, onNavigate }: HubSidebarProps) {
  const { t } = useT("hub")

  return (
    <aside className="flex w-[var(--native-sidebar-width)] shrink-0 flex-col overflow-hidden bg-gradient-to-b from-background/90 to-background">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <span className="font-display text-[1rem] font-semibold tracking-[-0.035em] text-foreground">
            {t(($) => $.home.title)}
          </span>
        </div>
      </div>

      <nav className="thin-scrollbar flex flex-1 flex-col gap-5 overflow-y-auto px-2 py-2.5">
        <div>
          <div className="flex flex-col gap-px">
            {HUB_NAV.map((item) => {
              const active = item.type
                ? currentType === item.type
                : !currentType
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onNavigate?.(item.type)}
                  className={cn(
                    "relative flex w-full items-center gap-2.5 rounded-[var(--native-radius-md)] px-2.5 py-[0.5rem] text-left text-[0.8125rem] transition-all duration-150",
                    active
                      ? "bg-primary/8 text-foreground shadow-sm"
                      : "bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center transition-all"
                    style={{ color: active ? "var(--foreground)" : "var(--muted-foreground)" }}
                  >
                    <HubIcon name={item.icon} size={15} />
                  </span>
                  <span className="font-medium">{t(($) => $.home.typeTab[item.key as "all" | "skill" | "subagent" | "command" | "mcp" | "plugin"])}</span>
                  {counts?.[item.key] != null && (
                    <span className="ml-auto rounded-[var(--native-radius-full)] bg-muted/60 px-[0.5rem] text-[11px] font-medium leading-[1.65] text-muted-foreground">
                      {counts[item.key]}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </nav>
    </aside>
  )
}

export default HubSidebar

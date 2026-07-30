"use client"

import { useT } from "@multica/views/i18n"
import { cn } from "@multica/ui/lib/utils"
import { Settings } from "lucide-react"
import { HubIcon } from "../lib/hub-icons"
import { AppLink } from "../../navigation"
import { useWorkspacePaths } from "@multica/core/paths"

export interface NavItem {
  key: string
  labelKey: string
  icon?: "all" | "skill" | "subagent" | "command" | "mcp" | "plugin"
  type?: string
  /** Pure link item (no type filter / count badge) — rendered as a navigation link. */
  link?: "manager"
}

export const HUB_NAV: NavItem[] = [
  { key: "all", labelKey: "hub.home.typeTab.all", icon: "all" },
  { key: "skill", labelKey: "hub.home.typeTab.skill", icon: "skill", type: "skill" },
  { key: "subagent", labelKey: "hub.home.typeTab.subagent", icon: "subagent", type: "subagent" },
  { key: "command", labelKey: "hub.home.typeTab.command", icon: "command", type: "command" },
  { key: "mcp", labelKey: "hub.home.typeTab.mcp", icon: "mcp", type: "mcp" },
  { key: "plugin", labelKey: "hub.home.typeTab.plugin", icon: "plugin", type: "plugin" },
  { key: "manager", labelKey: "hub.home.typeTab.manager", link: "manager" },
]

export interface HubSidebarProps {
  currentType?: string | null
  counts?: Record<string, number>
  onNavigate?: (type?: string) => void
  /** Layout direction. Defaults to "vertical" (the original left sidebar). */
  orientation?: "vertical" | "horizontal"
}

export function HubSidebar({ currentType, counts, onNavigate, orientation = "vertical" }: HubSidebarProps) {
  const { t } = useT("hub")
  const paths = useWorkspacePaths()
  const horizontal = orientation === "horizontal"

  if (horizontal) {
    return (
      <nav className="flex w-full items-center gap-1.5 overflow-x-auto px-6 py-2 max-[640px]:px-4">
        {HUB_NAV.map((item) => {
          if (item.link === "manager") {
            return (
              <AppLink
                key={item.key}
                href={paths.hubManager()}
                className={cn(
                  "ml-auto inline-flex h-[34px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[10px] border px-3 text-[12.5px] font-bold transition-[color,border-color,background-color] duration-150",
                  "border-border/60 bg-background text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground",
                )}
              >
                <Settings size={15} />
                <span className="whitespace-nowrap">{t(($) => $.home.typeTab.manager)}</span>
              </AppLink>
            )
          }
          const active = item.type ? currentType === item.type : !currentType
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onNavigate?.(item.type)}
              className={cn(
                "inline-flex h-[34px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[10px] border px-3 text-[12.5px] font-bold transition-[color,border-color,background-color] duration-150",
                active
                  ? "border-primary/45 bg-primary/10 text-primary"
                  : "border-border/60 bg-background text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground",
              )}
            >
              <HubIcon name={item.icon ?? "all"} size={15} />
              <span className="whitespace-nowrap">{t(($) => $.home.typeTab[item.key as "all" | "skill" | "subagent" | "command" | "mcp" | "plugin"])}</span>
              {counts?.[item.key] != null && (
                <span className="rounded-full bg-muted/60 px-1.5 text-[11px] font-medium leading-[1.65] text-muted-foreground">
                  {counts[item.key]}
                </span>
              )}
            </button>
          )
        })}
      </nav>
    )
  }

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col overflow-hidden bg-gradient-to-b from-background/90 to-background max-[1024px]:hidden">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <span className="font-heading text-base font-semibold tracking-[-0.035em] text-foreground">
            {t(($) => $.home.title)}
          </span>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-2 py-2.5">
        <div>
          <div className="flex flex-col gap-px">
            {HUB_NAV.map((item) => {
              if (item.link === "manager") {
                return (
                  <AppLink
                    key={item.key}
                    href={paths.hubManager()}
                    className={cn(
                      "relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-all duration-150",
                      "bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground transition-all">
                      <Settings size={15} />
                    </span>
                    <span className="font-medium">{t(($) => $.home.typeTab.manager)}</span>
                  </AppLink>
                )
              }
              const active = item.type
                ? currentType === item.type
                : !currentType
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onNavigate?.(item.type)}
                  className={cn(
                    "relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-all duration-150",
                    active
                      ? "bg-primary/8 text-foreground shadow-sm"
                      : "bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center transition-all",
                      active ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <HubIcon name={item.icon ?? "all"} size={15} />
                  </span>
                  <span className="font-medium">{t(($) => $.home.typeTab[item.key as "all" | "skill" | "subagent" | "command" | "mcp" | "plugin"])}</span>
                  {counts?.[item.key] != null && (
                    <span className="ml-auto rounded-full bg-muted/60 px-2 text-[11px] font-medium leading-[1.65] text-muted-foreground">
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

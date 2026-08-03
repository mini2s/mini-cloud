"use client"

import { useCallback, useRef, useEffect, useState } from "react"
import { useNavigation } from "../../navigation"
import { useT } from "@multica/views/i18n"
import { cn } from "@multica/ui/lib/utils"
import { HubIcon } from "../lib/hub-icons"
import { TYPE_COLORS } from "../lib/type-colors"
import type { HubIconName } from "../lib/hub-icons"

const TABS = [
  { key: "all", icon: "all" as HubIconName },
  { key: "skill", icon: "skill" as HubIconName },
  { key: "subagent", icon: "subagent" as HubIconName },
  { key: "command", icon: "command" as HubIconName },
  { key: "mcp", icon: "mcp" as HubIconName },
  { key: "plugin", icon: "plugin" as HubIconName },
] as const

const VALID_TYPES = new Set(TABS.map((t) => t.key))

export interface TypeTabsProps {
  value?: string
  onChange?: (type: string) => void
}

export function TypeTabs({ value, onChange }: TypeTabsProps) {
  const { t } = useT("hub")
  const { searchParams, pathname, replace } = useNavigation()

  const activeType = value ?? searchParams.get("type") ?? "all"
  const resolved = VALID_TYPES.has(activeType as typeof TABS[number]["key"]) ? activeType : "all"

  const [thumbStyle, setThumbStyle] = useState<React.CSSProperties>({ opacity: 0 })
  const tabEls = useRef<Record<string, HTMLButtonElement | null>>({})

  const measure = useCallback(() => {
    const el = tabEls.current[resolved]
    if (!el) return
    const { offsetLeft: x, offsetWidth: w } = el
    setThumbStyle({
      transform: `translateX(${x}px)`,
      width: `${w}px`,
      opacity: 1,
    })
  }, [resolved])

  useEffect(() => {
    requestAnimationFrame(measure)
  }, [measure])

  useEffect(() => {
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [measure])

  const handleChange = (type: string) => {
    if (type === resolved) return
    if (onChange) {
      onChange(type)
      return
    }
    const next = new URLSearchParams(searchParams)
    if (type === "all") {
      next.delete("type")
    } else {
      next.set("type", type)
    }
    replace(`${pathname}?${next.toString()}`)
  }

  const accentColor = TYPE_COLORS[resolved] ?? "var(--primary)"
  const isActive = (key: string) => key === resolved

  return (
    <div className="relative flex flex-nowrap items-center gap-0.5" role="tablist">
      <div
        className="pointer-events-none absolute inset-y-0 z-0 rounded-[9px] border border-border/60 bg-background shadow-sm transition-[transform,width,opacity] duration-200 ease-out"
        style={thumbStyle}
      />
      {TABS.map((tab) => (
        <button
          key={tab.key}
          ref={(el) => {
            tabEls.current[tab.key] = el
          }}
          type="button"
          role="tab"
          aria-selected={isActive(tab.key)}
          onClick={() => handleChange(tab.key)}
          className={cn(
            "relative z-[1] flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[9px] px-3 py-[7px] text-sm font-bold transition-colors duration-200 ease-out",
            isActive(tab.key)
              ? "text-primary"
              : "text-muted-foreground/70 hover:text-foreground",
          )}
        >
          <HubIcon
            name={tab.icon}
            size={15}
            className="shrink-0 transition-colors duration-200 ease-out"
            style={{ color: isActive(tab.key) ? "var(--primary)" : accentColor }}
          />
          <span className="whitespace-nowrap">{t(($) => $.home.typeTab[tab.key])}</span>
        </button>
      ))}
    </div>
  )
}

export default TypeTabs

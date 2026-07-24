"use client"

import { useT } from "@multica/views/i18n"
import { HubIcon } from "../lib/hub-icons"
import { TYPE_COLORS } from "../lib/constants"
import type { HubIconName } from "../lib/hub-icons"

type ItemType = "all" | "skill" | "subagent" | "command" | "mcp" | "plugin"

const ICON_MAP: Record<string, HubIconName> = {
  all: "all",
  skill: "skill",
  subagent: "subagent",
  command: "command",
  mcp: "mcp",
  plugin: "plugin",
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

export interface TypeHeroProps {
  type: string
  total: number
  totalInstalls: number
}

export function TypeHero({ type, total, totalInstalls }: TypeHeroProps) {
  const tp = type as ItemType
  const { t } = useT("hub")
  const accent = TYPE_COLORS[type] ?? "var(--primary)"
  const icon = ICON_MAP[type] ?? "all"

  return (
    <div className="flex min-w-0 flex-col gap-4 max-[1280px]:gap-3" data-type-hero={type}>
      {/* Hero Header */}
      <header
        className="relative flex flex-col gap-4 lg:gap-5 overflow-hidden rounded-[1.25rem] border border-border/12 bg-[linear-gradient(135deg,var(--background),color-mix(in_srgb,var(--tp-accent)_5%,var(--background)))] px-4 py-4 lg:px-7 lg:py-6 before:pointer-events-none before:absolute before:right-[-5%] before:top-[-40%] before:h-[280px] before:w-[280px] before:rounded-full before:bg-[radial-gradient(circle,color-mix(in_srgb,var(--tp-accent)_8%,transparent),transparent_70%)] before:content-[''] lg:flex-row lg:items-center lg:justify-between"
        style={{ "--tp-accent": accent } as React.CSSProperties}
      >
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[var(--native-radius-lg)]"
          style={{ backgroundColor: `color-mix(in_srgb, ${accent} 10%, transparent)` }}
        >
          <HubIcon name={icon} size={24} style={{ color: accent }} />
        </div>

        <div className="relative min-w-0 flex-1">
          <h1 className="m-0 text-[1.375rem] leading-[1.2] font-extrabold tracking-[-0.03em] text-foreground">
            {t(($) => $.home.typeTab[tp])}
          </h1>
          <p className="mt-1 text-[0.8125rem] font-semibold leading-[1.5] text-muted-foreground">
            {t(($) => $.home.type[tp].description)}
          </p>
        </div>

        <div className="relative grid w-full grid-cols-2 gap-2.5 lg:w-auto lg:min-w-[14rem]">
          <div
            className="rounded-[var(--native-radius-md)] border border-border/8 px-3.5 py-2 text-center"
            style={{ borderColor: `color-mix(in_srgb, ${accent} 8%, transparent)`, backgroundColor: `color-mix(in_srgb, ${accent} 4%, var(--background))` }}
          >
            <div className="text-[1.125rem] leading-[1.3] font-extrabold text-foreground [font-variant-numeric:tabular-nums]">
              {total.toLocaleString()}
            </div>
            <div className="text-[12px] uppercase tracking-[0.04em] text-muted-foreground">
              {t(($) => $.home.typeTab[tp])}
            </div>
          </div>
          <div
            className="rounded-[var(--native-radius-md)] border border-border/8 px-3.5 py-2 text-center"
            style={{ borderColor: `color-mix(in_srgb, ${accent} 8%, transparent)`, backgroundColor: `color-mix(in_srgb, ${accent} 4%, var(--background))` }}
          >
            <div className="text-[1.125rem] leading-[1.3] font-extrabold text-foreground [font-variant-numeric:tabular-nums]">
              {fmtCompact(totalInstalls)}
            </div>
            <div className="text-[12px] uppercase tracking-[0.04em] text-muted-foreground">
              {t(($) => $.detail.install) || "Installs"}
            </div>
          </div>
        </div>
      </header>
    </div>
  )
}

export default TypeHero

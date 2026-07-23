"use client"

import type { CapabilityItem } from "@multica/core/types/hub"
import { useT } from "@multica/views/i18n"
import { cn } from "@multica/ui/lib/utils"
import { Star, Eye, Download, GitFork } from "lucide-react"
import { HubIcon, type HubIconName } from "../lib/hub-icons"
import { TYPE_COLORS } from "../lib/constants"
import { pickItemDescription } from "../lib/item-description"
import { matchEnterprise, matchEnterpriseByName } from "../lib/enterprise"
import SecurityTag from "./security-tag"
import FromPluginBadge from "./from-plugin-badge"

// ── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_ICON_NAMES = new Set<HubIconName>(["skill", "subagent", "command", "mcp", "plugin"])

function iconName(t: string): HubIconName {
  return TYPE_ICON_NAMES.has(t as HubIconName) ? (t as HubIconName) : "all"
}

function col(t: string): string {
  return TYPE_COLORS[t] ?? "var(--native-primary)"
}

const GOLD = "#E5B545"

function fmt(n: number | undefined | null) {
  if (n == null) return "—"
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface HubCardGridProps {
  items: CapabilityItem[]
  loading?: boolean
  onItemClick?: (item: CapabilityItem) => void
  onFavoriteToggle?: (item: CapabilityItem) => void
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="flex animate-pulse flex-col overflow-hidden rounded-[18px] border bg-background">
      <div className="h-[62px] bg-muted" />
      <div className="space-y-3 p-4">
        <div className="h-4 w-3/4 rounded bg-muted" />
        <div className="h-3 w-full rounded bg-muted" />
        <div className="h-3 w-1/2 rounded bg-muted" />
      </div>
      <div className="flex gap-2 px-4 pb-4">
        <div className="h-5 w-16 rounded-full bg-muted" />
        <div className="h-5 w-20 rounded-full bg-muted" />
      </div>
      <div className="flex items-center justify-between border-t px-4 py-3">
        <div className="h-4 w-12 rounded bg-muted" />
        <div className="h-8 w-20 rounded-full bg-muted" />
      </div>
    </div>
  )
}

// ── Card ──────────────────────────────────────────────────────────────────────

interface CardProps {
  item: CapabilityItem
  onClick?: (item: CapabilityItem) => void
  onFav?: (item: CapabilityItem) => void
}

function Card({ item, onClick, onFav }: CardProps) {
  const { t, i18n } = useT("hub")
  const locale = i18n.language
  const ent = matchEnterprise(item.createdBy) ?? matchEnterpriseByName(item.name)
  const tc = col(item.itemType)
  const desc = pickItemDescription(item, locale)

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onClick?.(item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onClick?.(item)
        }
      }}
      className={cn(
        "group relative flex cursor-pointer flex-col overflow-hidden rounded-[18px] border bg-background",
        "transition-all duration-[260ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
        "hover:-translate-y-[3px] hover:shadow-lg hover:will-change-transform",
        ent
          ? "border-[color:color-mix(in_oklab,var(--card-brand)_45%,var(--border))]"
          : "border-border/40 hover:border-[color:color-mix(in_oklab,var(--card-type)_55%,var(--border))]",
      )}
      style={
        {
          "--card-type": tc,
          ...(ent ? { "--card-brand": tc } : {}),
        } as React.CSSProperties
      }
    >
      {/* Enterprise gold edge */}
      {ent && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[2] rounded-[18px]"
          style={{
            padding: "1px",
            background: `linear-gradient(135deg, color-mix(in oklab, ${GOLD} 70%, transparent), transparent 40%, color-mix(in oklab, var(--card-brand) 55%, transparent))`,
            WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            WebkitMaskComposite: "xor",
            maskComposite: "exclude",
          }}
        />
      )}

      {/* ── Header ── */}
      <div
        className="relative flex h-[62px] items-start justify-between overflow-hidden px-[14px] py-[11px]"
        style={{
          background: ent
            ? "linear-gradient(135deg, color-mix(in oklab, var(--card-brand) 24%, var(--background)), color-mix(in oklab, var(--card-brand) 6%, var(--background)))"
            : `linear-gradient(135deg, color-mix(in oklab, var(--card-type) 28%, var(--background)), color-mix(in oklab, var(--card-type) 7%, var(--background)))`,
        }}
      >
        {/* Enterprise watermark */}
        {ent && (
          <img
            src={ent.logo}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute right-[-18px] top-1/2 size-[104px] -translate-y-1/2 rounded-[18px] object-contain opacity-10"
          />
        )}

        {/* Media tile: logo for enterprise, type icon otherwise */}
        {ent ? (
          <span className="relative z-[1] flex size-[38px] shrink-0 items-center justify-center rounded-[10px] border border-border/60 bg-white p-[5px] shadow-sm">
            <img src={ent.logo} alt={ent.name} className="size-full object-contain" />
          </span>
        ) : (
          <span
            className="relative z-[1] flex size-[38px] shrink-0 items-center justify-center rounded-[11px] border border-border/55 bg-white shadow-sm"
            style={{ color: tc }}
          >
            <HubIcon name={iconName(item.itemType)} size={18} />
          </span>
        )}

        {/* Enterprise seal / user-uploaded pill */}
        {ent ? (
          <span
            className="relative z-[1] inline-flex h-6 items-center gap-1.5 rounded-full border px-[9px] py-[2px] text-[11.5px] font-bold backdrop-blur-[6px]"
            style={{
              borderColor: `color-mix(in oklab, ${tc} 35%, transparent)`,
              backgroundColor: `color-mix(in oklab, ${tc} 10%, #ffffffcc)`,
              color: tc,
            }}
          >
            {ent.name}
            <HubIcon name="checkCircle" size={11} style={{ color: tc }} />
          </span>
        ) : item.createdBy !== "system" ? (
          <span className="relative z-[1] inline-flex h-6 items-center gap-1.5 rounded-full border border-[#00000012] bg-[#ffffffcc] px-[9px] py-[2px] text-[11.5px] font-bold text-foreground backdrop-blur-[6px] dark:border-[#ffffff24] dark:bg-[#ffffff14]">
            <HubIcon name="upload" size={12} />
            {t(($) => $.detail.source)}
          </span>
        ) : null}
      </div>

      {/* ── Body ── */}
      <div className="px-[15px] pt-[12px]">
        <div className="truncate text-[16px] font-black text-foreground" title={item.name}>
          {item.name}
        </div>
        <p
          className="mt-[5px] min-h-[2.6em] overflow-hidden text-[12.5px] font-semibold leading-[1.5] text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
          title={desc}
        >
          {desc}
        </p>
      </div>

      {/* ── Chips ── */}
      <div className="flex flex-wrap items-center gap-[7px] px-[15px] pt-[10px]">
        {item.category && (
          <span className="inline-flex items-center gap-[5px] text-[11.5px] font-semibold text-muted-foreground">
            <HubIcon name="layers" size={12} />
            {item.category}
          </span>
        )}
        <SecurityTag status={item.securityStatus} />
        <FromPluginBadge name={item.parentPluginName} />
      </div>

      {/* ── Footer ── */}
      <div className="mt-[10px] flex items-center gap-[11px] border-t border-border/18 px-[15px] pb-[13px] pt-[11px]">
        <div className="flex items-center gap-3 text-[12.5px] font-semibold text-muted-foreground">
          {item.favoriteCount != null && (
            <span className="inline-flex items-center gap-1" title={t(($) => $.detail.favorite)}>
              <Star size={13} className="fill-amber-400 text-amber-400" />
              {fmt(item.favoriteCount)}
            </span>
          )}
          {item.previewCount != null && (
            <span className="inline-flex items-center gap-1" title={t(($) => $.detail.preview)}>
              <Eye size={13} />
              {fmt(item.previewCount)}
            </span>
          )}
          {item.installCount != null && (
            <span className="inline-flex items-center gap-1" title={t(($) => $.detail.install)}>
              <Download size={13} />
              {fmt(item.installCount)}
            </span>
          )}
          {item.forkCount != null && (
            <span className="inline-flex items-center gap-1" title={t(($) => $.detail.fork)}>
              <GitFork size={13} />
              {fmt(item.forkCount)}
            </span>
          )}
        </div>

        {onFav && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onFav(item)
            }}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-colors hover:bg-accent"
          >
            <Star size={13} className={item.favorited ? "fill-amber-400 text-amber-400" : ""} />
            {item.favorited ? t(($) => $.detail.unfavorite) : t(($) => $.detail.favorite)}
          </button>
        )}
      </div>
    </article>
  )
}

// ── Grid ──────────────────────────────────────────────────────────────────────

export function HubCardGrid({ items, loading, onItemClick, onFavoriteToggle }: HubCardGridProps) {
  const { t } = useT("hub")

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} />)}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/30 px-6 py-16 text-center text-sm text-muted-foreground">
        {t(($) => $.home.empty.noMatch)}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <Card key={item.id} item={item} onClick={onItemClick} onFav={onFavoriteToggle} />
      ))}
    </div>
  )
}

export default HubCardGrid

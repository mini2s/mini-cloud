"use client"

import type { CapabilityItem } from "@multica/core/types/hub"
import { useT } from "@multica/views/i18n"
import { cn } from "@multica/ui/lib/utils"
import { Star, Eye, Download, GitFork } from "lucide-react"
import { HubIcon, type HubIconName } from "../lib/hub-icons"
import { TYPE_COLORS } from "../lib/type-colors"
import { formatCount } from "../lib/format"
import { mcpListSubscribeBlocked } from "../lib/mcp-config"
import { pickItemDescription } from "../lib/item-description"
import { matchEnterprise, matchEnterpriseByName } from "../lib/enterprise"
import SecurityTag from "./security-tag"
import FromPluginBadge from "./from-plugin-badge"
import { HighlightText } from "./highlight-text"

// ── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_ICON_NAMES = new Set<HubIconName>(["skill", "subagent", "command", "mcp", "plugin"])

function iconName(t: string): HubIconName {
  return TYPE_ICON_NAMES.has(t as HubIconName) ? (t as HubIconName) : "all"
}
function col(t: string): string {
  return TYPE_COLORS[t] ?? "var(--primary)"
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface HubListViewProps {
  items: CapabilityItem[]
  loading?: boolean
  /** Current search keyword — title/description hits are highlighted (FR-06). */
  searchQuery?: string
  onItemClick?: (item: CapabilityItem) => void
  onFavoriteToggle?: (item: CapabilityItem) => void
  /** Called when a subscribe click is blocked because the MCP item still needs
   *  its config saved (F-09). The caller should open the item detail so the
   *  user lands on the MCP config form. */
  onMcpSubscribeBlocked?: (item: CapabilityItem) => void
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex animate-pulse items-center gap-3.5 border-b px-4 py-3.5 last:border-b-0">
      <div className="size-11 shrink-0 rounded-xl bg-muted" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="h-4 w-2/5 rounded bg-muted" />
        <div className="h-3 w-3/5 rounded bg-muted" />
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <div className="h-4 w-10 rounded bg-muted" />
        <div className="h-4 w-10 rounded bg-muted" />
        <div className="h-4 w-10 rounded bg-muted" />
        <div className="h-4 w-10 rounded bg-muted" />
      </div>
      <div className="h-8 w-20 shrink-0 rounded-full bg-muted" />
    </div>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

interface RowProps {
  item: CapabilityItem
  index: number
  searchQuery?: string
  onClick?: (item: CapabilityItem) => void
  onFav?: (item: CapabilityItem) => void
  onMcpSubscribeBlocked?: (item: CapabilityItem) => void
}

function Row({ item, index, searchQuery, onClick, onFav, onMcpSubscribeBlocked }: RowProps) {
  const { t, i18n } = useT("hub")
  const locale = i18n.language
  const ent = matchEnterprise(item.createdBy) ?? matchEnterpriseByName(item.name)
  const tc = col(item.itemType)
  const desc = pickItemDescription(item, locale)

  return (
    <div
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
        "group relative flex cursor-pointer items-center gap-3.5 overflow-hidden px-4 py-3.5",
        "transition-all duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
        "hover:translate-x-[3px] hover:shadow-md hover:will-change-transform",
        // FR-14: entrance rise+fade for new result sets, staggered by index.
        // `motion-safe:` disables it entirely under prefers-reduced-motion.
        "motion-safe:animate-hub-list-enter",
        ent
          ? "border border-[color:color-mix(in_oklab,var(--bc)_36%,var(--border))] bg-[linear-gradient(100deg,color-mix(in_oklab,var(--bc)_12%,var(--background)),var(--background)_46%)] hover:border-[color:color-mix(in_oklab,var(--bc)_55%,var(--border))]"
          : "border border-border/30 bg-background hover:border-border/55",
        index % 2 === 1 && !ent && "bg-muted/30",
      )}
      style={
        {
          borderRadius: index === 0 ? "1rem 1rem 0 0" : undefined,
          ...(ent ? { "--bc": tc } : {}),
          animationDelay: `${Math.min(index * 28, 280)}ms`,
        } as React.CSSProperties
      }
    >
      {/* Enterprise watermark */}
      {ent && (
        <img
          src={ent.logo}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute right-[-26px] top-1/2 z-0 size-[168px] -translate-y-1/2 rounded-3xl object-contain opacity-[0.07]"
        />
      )}

      {/* Media tile */}
      {ent ? (
        <span className="relative z-[1] flex size-11 shrink-0 items-center justify-center rounded-[11px] border border-border/60 bg-white p-1.5">
          <img src={ent.logo} alt={ent.name} className="size-full rounded-[5px] object-contain" />
        </span>
      ) : (
        <span
          className="relative z-[1] flex size-11 shrink-0 items-center justify-center rounded-xl border"
          style={{
            backgroundColor: `color-mix(in oklab, ${tc} 14%, transparent)`,
            borderColor: `color-mix(in oklab, ${tc} 26%, transparent)`,
            color: tc,
          }}
        >
          <HubIcon name={iconName(item.itemType)} size={18} />
        </span>
      )}

      {/* Middle section: title + description + meta */}
      <div className="relative z-[1] flex min-w-0 flex-1 flex-col">
        {/* Title row */}
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-base font-black leading-5 text-foreground" title={item.name}>
            <HighlightText text={item.name} query={searchQuery} />
          </span>

          {/* Enterprise seal / user-uploaded pill */}
          {ent ? (
            <span
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border py-0.5 pl-[5px] pr-[7px] text-[10.5px] font-extrabold"
              style={{
                borderColor: `color-mix(in oklab, ${tc} 35%, transparent)`,
                backgroundColor: `color-mix(in oklab, ${tc} 14%, transparent)`,
                color: tc,
              }}
              title={ent.name}
            >
              <HubIcon name="checkCircle" size={11} style={{ color: tc }} />
              {ent.name}
            </span>
          ) : item.createdBy !== "system" ? (
            <span className="inline-flex h-5.5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[#0000000a] px-2 text-xs font-semibold text-muted-foreground dark:bg-[#ffffff0d]">
              <HubIcon name="upload" size={12} />
              {t(($) => $.detail.source)}
            </span>
          ) : null}

          <FromPluginBadge name={item.parentPluginName} />
          <SecurityTag status={item.securityStatus} />
        </div>

        {/* Description */}
        {desc && (
          <div className="mt-1.5 max-w-xl truncate text-[12.5px] font-semibold text-muted-foreground" title={desc}>
            <HighlightText text={desc} query={searchQuery} />
          </div>
        )}

        {/* Meta row: category · tags · updated time */}
        <div className="mt-1.5 flex flex-wrap items-center gap-[0.5625rem] text-xs font-semibold text-muted-foreground/70">
          {item.category && (
            <span className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
              <HubIcon name="layers" size={12} />
              {item.category}
            </span>
          )}
          {item.category && (item.tags?.length ?? 0) > 0 && (
            <span aria-hidden="true" className="opacity-45">·</span>
          )}
          {(item.tags?.length ?? 0) > 0 && (
            <span className="inline-flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground/60">
              {item.tags!.slice(0, 3).map((tag) => (
                <span key={tag.slug} className="whitespace-nowrap">#{tag.slug}</span>
              ))}
            </span>
          )}
          {item.updatedAt && (
            <>
              <span aria-hidden="true" className="opacity-45">·</span>
              <span className="inline-flex items-center gap-1 [font-variant-numeric:tabular-nums]">
                <HubIcon name="clock" size={12} />
                {new Date(item.updatedAt).toLocaleDateString()}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Right side: stats + favorite action */}
      <div className="relative z-[1] flex shrink-0 items-center gap-[0.9375rem]">
        <div className="flex items-center gap-2.5 text-[12.5px] font-semibold text-muted-foreground">
          {item.favoriteCount != null && (
            <span className="inline-flex items-center gap-1" title={t(($) => $.detail.favorite)}>
              <Star size={13} className="fill-amber-400 text-amber-400" />
              {formatCount(item.favoriteCount)}
            </span>
          )}
          {item.previewCount != null && (
            <span className="inline-flex items-center gap-1" title={t(($) => $.detail.preview)}>
              <Eye size={13} />
              {formatCount(item.previewCount)}
            </span>
          )}
          {item.installCount != null && (
            <span className="inline-flex items-center gap-1" title={t(($) => $.detail.install)}>
              <Download size={13} />
              {formatCount(item.installCount)}
            </span>
          )}
          {item.forkCount != null && (
            <span className="inline-flex items-center gap-1" title={t(($) => $.detail.fork)}>
              <GitFork size={13} />
              {formatCount(item.forkCount)}
            </span>
          )}
        </div>

        {onFav && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              // F-09: block subscribing an unconfigured MCP from the list and
              // route the user to the detail page's MCP config form instead.
              if (mcpListSubscribeBlocked(item, item.favorited)) {
                onMcpSubscribeBlocked?.(item)
                return
              }
              onFav(item)
            }}
            className={cn(
              "inline-flex h-8 items-center gap-[7px] rounded-full border px-[13px] text-[12.5px] font-extrabold",
              "transition-[background-color,color,border-color,transform] duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
              "active:scale-[0.94] hover:bg-accent",
              item.favorited
                ? "border-amber-400/40 bg-amber-400/10 text-amber-500"
                : "border-border text-muted-foreground",
            )}
          >
            <Star size={13} className={item.favorited ? "fill-amber-400 text-amber-400" : ""} />
            {item.favorited ? t(($) => $.detail.unfavorite) : t(($) => $.detail.favorite)}
          </button>
        )}
      </div>
    </div>
  )
}

// ── List ──────────────────────────────────────────────────────────────────────

export function HubListView({ items, loading, searchQuery, onItemClick, onFavoriteToggle, onMcpSubscribeBlocked }: HubListViewProps) {
  const { t } = useT("hub")

  if (loading) {
    return (
      <div className="flex flex-col overflow-hidden rounded-xl border">
        {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/30 px-6 py-14 text-center text-sm text-muted-foreground">
        {t(($) => $.home.empty.noMatch)}
      </div>
    )
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border">
      {items.map((item, i) => (
        <Row
          key={item.id}
          item={item}
          index={i}
          searchQuery={searchQuery}
          onClick={onItemClick}
          onFav={onFavoriteToggle}
          onMcpSubscribeBlocked={onMcpSubscribeBlocked}
        />
      ))}
    </div>
  )
}

export default HubListView

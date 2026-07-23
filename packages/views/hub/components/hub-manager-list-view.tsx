"use client"

import type { CapabilityItem } from "@multica/core/types/hub"
import { useT } from "@multica/views/i18n"
import { cn } from "@multica/ui/lib/utils"
import { Trash2, Star, Eye, Download, GitFork, CheckSquare, Square, Pencil } from "lucide-react"
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
  return TYPE_COLORS[t] ?? "var(--hub-primary)"
}

function fmt(n: number | undefined | null) {
  if (n == null) return "—"
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface HubManagerListViewProps {
  items: CapabilityItem[]
  loading?: boolean
  error?: string | null
  selected: Set<string>
  onToggleRow: (id: string, checked: boolean) => void
  onTogglePage: (checked: boolean) => void
  onClearSelection?: () => void
  onBatchDelete?: () => void
  onItemClick?: (item: CapabilityItem) => void
  onFavoriteToggle?: (item: CapabilityItem) => void
  onDeleteItem?: (id: string) => void
  onFav?: (item: CapabilityItem) => void
  onEdit?: (item: CapabilityItem) => void
  onDelete?: (id: string) => void
  tab?: string
  searchQuery?: string
  total?: number
  allMatching?: boolean
  selectable?: boolean
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex animate-pulse items-center gap-3.5 border-b px-[1.125rem] py-3.5 last:border-b-0">
      <div className="size-5 shrink-0 rounded bg-muted" />
      <div className="size-11 shrink-0 rounded-[0.8125rem] bg-muted" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="h-4 w-2/5 rounded bg-muted" />
        <div className="h-3 w-3/5 rounded bg-muted" />
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <div className="h-4 w-10 rounded bg-muted" />
        <div className="h-4 w-10 rounded bg-muted" />
        <div className="h-4 w-10 rounded bg-muted" />
        <div className="h-4 w-10 rounded bg-muted" />
        <div className="h-4 w-10 rounded bg-muted" />
      </div>
      <div className="h-8 w-14 shrink-0 rounded bg-muted" />
    </div>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

interface RowProps {
  item: CapabilityItem
  index: number
  selected: Set<string>
  onToggle: (id: string, checked: boolean) => void
  onClick?: (item: CapabilityItem) => void
  onFav?: (item: CapabilityItem) => void
  onEdit?: (item: CapabilityItem) => void
  onDelete?: (id: string) => void
}

function Row({ item, index, selected, onToggle, onClick, onFav, onEdit, onDelete }: RowProps) {
  const { t, i18n } = useT("hub")
  const locale = i18n.language
  const ent = matchEnterprise(item.createdBy) ?? matchEnterpriseByName(item.name)
  const tc = col(item.itemType)
  const desc = pickItemDescription(item, locale)
  const checked = selected.has(item.id)

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
        "group relative flex cursor-pointer items-center gap-3.5 overflow-hidden px-[1.125rem] py-3.5",
        "transition-all duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
        "hover:translate-x-[3px] hover:shadow-md hover:will-change-transform",
        checked
          ? "border border-[color:color-mix(in_oklab,var(--hub-primary)_55%,transparent)] bg-[color:color-mix(in_oklab,var(--hub-primary)_7%,var(--background))]"
          : ent
            ? "border border-[color:color-mix(in_oklab,var(--bc)_36%,var(--border))] bg-[linear-gradient(100deg,color-mix(in_oklab,var(--bc)_12%,var(--background)),var(--background)_46%)] hover:border-[color:color-mix(in_oklab,var(--bc)_55%,var(--border))]"
            : "border border-border/30 bg-background hover:border-border/55",
        index % 2 === 1 && !ent && !checked && "bg-muted/30",
      )}
      style={
        {
          borderRadius: index === 0 ? "1rem 1rem 0 0" : undefined,
          ...(ent ? { "--bc": tc } : {}),
        } as React.CSSProperties
      }
    >
      {/* Enterprise watermark */}
      {ent && (
        <img
          src={ent.logo}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute right-[-26px] top-1/2 z-0 size-[168px] -translate-y-1/2 rounded-[24px] object-contain opacity-[0.07]"
        />
      )}

      {/* Multi-select checkbox */}
      <span
        className="relative z-[1] flex shrink-0 items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          onClick={() => onToggle(item.id, !checked)}
          className={cn(
            "flex size-5 items-center justify-center rounded-[4px] border transition-all duration-150",
            checked
              ? "border-[var(--hub-primary)] bg-[var(--hub-primary)] text-white"
              : "border-border/50 text-transparent hover:border-[var(--hub-primary)]",
          )}
        >
          {checked ? <CheckSquare size={14} /> : <Square size={14} />}
        </button>
      </span>

      {/* Media tile */}
      {ent ? (
        <span className="relative z-[1] flex size-11 shrink-0 items-center justify-center rounded-[11px] border border-border/60 bg-white p-1.5">
          <img src={ent.logo} alt={ent.name} className="size-full rounded-[5px] object-contain" />
        </span>
      ) : (
        <span
          className="relative z-[1] flex size-11 shrink-0 items-center justify-center rounded-[0.8125rem] border"
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
          <span className="truncate text-[16px] font-black leading-5 text-foreground" title={item.name}>
            {item.name}
          </span>

          {/* Type chip */}
          <span
            className="inline-flex h-[1.375rem] shrink-0 items-center whitespace-nowrap rounded-full px-2 text-[11px] font-bold"
            style={{
              backgroundColor: `color-mix(in oklab, ${tc} 13%, transparent)`,
              color: tc,
            }}
          >
            {t(($) => $.home.typeTab[item.itemType as "all" | "skill" | "subagent" | "command" | "mcp" | "plugin"] ?? item.itemType)}
          </span>

          {/* Enterprise seal / user-uploaded pill */}
          {ent ? (
            <span
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border py-[2px] pl-[5px] pr-[7px] text-[10.5px] font-extrabold"
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
            <span className="inline-flex h-[1.375rem] shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[#0000000a] px-2 text-[12px] font-semibold text-muted-foreground dark:bg-[#ffffff0d]">
              <HubIcon name="upload" size={12} />
              {t(($) => $.detail.source)}
            </span>
          ) : null}

          <FromPluginBadge name={item.parentPluginName} />
          <SecurityTag status={item.securityStatus} />
        </div>

        {/* Description */}
        {desc && (
          <div className="mt-1.5 max-w-[35rem] truncate text-[12.5px] font-semibold text-muted-foreground" title={desc}>
            {desc}
          </div>
        )}

        {/* Meta row: category · tags · updated time */}
        <div className="mt-1.5 flex flex-wrap items-center gap-[0.5625rem] text-[12px] font-semibold text-muted-foreground/70">
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

      {/* Right side: stats + actions */}
      <div className="relative z-[1] flex shrink-0 items-center gap-[0.9375rem]">
        <div className="flex items-center gap-2.5 text-[12.5px] font-semibold text-muted-foreground">
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

        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {/* Favorite button */}
          {onFav && (
            <button
              type="button"
              onClick={() => onFav(item)}
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

          {/* Delete button */}
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(item.id)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/50 text-muted-foreground opacity-0 transition-all duration-200 hover:border-red-400/50 hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100 group-focus-within:opacity-100"
              title={t(($) => $.detail.delete)}
            >
              <Trash2 size={14} />
            </button>
          )}

          {/* Edit button */}
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(item)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/50 text-muted-foreground opacity-0 transition-all duration-200 hover:border-primary/50 hover:bg-primary/10 hover:text-primary group-hover:opacity-100 group-focus-within:opacity-100"
              title={t(($) => $.manager.edit)}
            >
              <Pencil size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Batch Action Bar ──────────────────────────────────────────────────────────

function BatchBar({
  count,
  onClear,
  onDelete,
}: {
  count: number
  onClear: () => void
  onDelete: () => void
}) {
  const { t } = useT("hub")

  return (
    <div className="mb-2.5 flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-[0.875rem] bg-[color:color-mix(in_oklab,var(--hub-primary)_8%,var(--background))] px-4 py-2.5 ring-1 ring-inset ring-[color:color-mix(in_oklab,var(--hub-primary)_18%,transparent)] shadow-[0_6px_16px_-8px_color-mix(in_oklab,var(--hub-primary)_45%,transparent)]">
      <span className="text-[13px] font-bold text-foreground/80">
        {t(($) => $.manager.batch.selected, { count })}
      </span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={onClear}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/40 px-3 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-accent"
      >
        {t(($) => $.manager.batch.deselectAll)}
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-400/40 bg-red-500/10 px-3 text-[12px] font-bold text-red-500 transition-colors hover:bg-red-500/20 hover:text-red-600"
      >
        <Trash2 size={14} />
        {t(($) => $.manager.batch.delete)}
      </button>
    </div>
  )
}

// ── Error State ───────────────────────────────────────────────────────────────

function ErrorState({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border/30 px-6 py-14 text-center">
      <span className="text-[13px] font-semibold text-red-500">{msg}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/40 px-3 text-[12px] font-semibold transition-colors hover:bg-accent"
        >
          {"Retry"}
        </button>
      )}
    </div>
  )
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/30 px-6 py-14 text-center text-sm text-muted-foreground">
      {msg}
    </div>
  )
}

// ── View ──────────────────────────────────────────────────────────────────────

export function HubManagerListView({
  items,
  loading,
  error,
  selected,
  onToggleRow,
  onTogglePage,
  onClearSelection,
  onBatchDelete,
  onItemClick,
  onFavoriteToggle,
  onDeleteItem,
  onFav,
  onEdit,
  onDelete,
  selectable = true,
}: HubManagerListViewProps) {
  const fav = onFav ?? onFavoriteToggle
  const del = onDelete ?? onDeleteItem
  const { t } = useT("hub")
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id))
  const someSelected = items.some((item) => selected.has(item.id))

  if (error) {
    return <ErrorState msg={error} />
  }

  if (loading) {
    return (
      <div className="flex flex-col overflow-hidden rounded-[1rem] border">
        {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <EmptyState msg={"No items found"} />
    )
  }

  return (
    <div className="flex flex-col">
      {/* Batch action bar */}
      {selectable && selected.size > 0 && (
        <BatchBar count={selected.size} onClear={onClearSelection!} onDelete={onBatchDelete!} />
      )}

      {/* Select-all header */}
      {selectable && (
        <div className="flex items-center gap-3.5 border-b border-border/20 px-[1.125rem] py-2">
          <button
            type="button"
            role="checkbox"
            aria-checked={allSelected}
            onClick={() => onTogglePage(!allSelected)}
            className={cn(
              "flex size-5 items-center justify-center rounded-[4px] border transition-all duration-150",
              allSelected
                ? "border-[var(--hub-primary)] bg-[var(--hub-primary)] text-white"
                : someSelected
                  ? "border-[var(--hub-primary)] bg-[var(--hub-primary)]/20 text-[var(--hub-primary)]"
                  : "border-border/50 text-transparent hover:border-[var(--hub-primary)]",
            )}
          >
            {allSelected ? <CheckSquare size={14} /> : someSelected ? <Square size={14} /> : <Square size={14} />}
          </button>
          <span className="text-[12px] font-semibold text-muted-foreground">
            {t(($) => $.manager.batch.selectAll)}
          </span>
        </div>
      )}

      {/* Rows */}
      <div className="flex flex-col overflow-hidden rounded-[1rem] border">
        {items.map((item, i) => (
          <Row
            key={item.id}
            item={item}
            index={i}
            selected={selected}
            onToggle={onToggleRow}
            onClick={onItemClick}
            onFav={fav}
            onEdit={onEdit}
            onDelete={del}
          />
        ))}
      </div>
    </div>
  )
}

export default HubManagerListView

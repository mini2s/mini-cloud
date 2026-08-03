"use client"

/**
 * F-17: "Best practices" carousel, migrated from the source project's
 * `pages/store/components/best-practice-carousel.tsx` (SolidJS) to React.
 *
 * Shows the top-N capabilities of the active type sorted by install count,
 * in a horizontally scroll-snap track with prev/next buttons. Each card
 * offers a per-card favorite toggle and, for items with a real install
 * command (plugins / zip downloads), a copy-install button.
 *
 * Styling converges onto the shared token system (no --native-*, no raw
 * hex): the per-type accent resolves through `typeColor()` (SD-09) and is
 * injected as the component-local `--card-accent` variable so all the
 * color-mix gradients/borders follow the active theme.
 *
 * IMPORTANT (per tasks.md): this component is intentionally NOT exported
 * from `components/index.ts` and has no wiring call-site yet — it is
 * migrated ahead of time so a later iteration can mount it without a
 * second migration pass. The "no usage" acceptance check greps for its
 * component name outside this file.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight, Copy, Check, Star, Download, Eye, Sparkles, Brain, TerminalSquare, Blocks, Puzzle } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { hubItemsQueryOptions, hubKeys } from "@multica/core/hub/queries"
import { useHubFavoriteMutation, useHubUnfavoriteMutation } from "@multica/core/hub/mutations"
import type { CapabilityItem } from "@multica/core/types/hub"
import { useT } from "@multica/views/i18n"
import { cn } from "@multica/ui/lib/utils"
import { SecurityTag } from "./security-tag"
import { typeColor } from "../lib/type-colors"
import { typeKey } from "../lib/constants"
import { getInstallCommand } from "../lib/install-command"
import { pickItemDescription } from "../lib/item-description"

const CAROUSEL_SIZE = 5

const TYPE_ICON: Record<string, LucideIcon> = {
  skill: Sparkles,
  subagent: Brain,
  command: TerminalSquare,
  mcp: Puzzle,
  plugin: Blocks,
}

export interface BestPracticeCarouselProps {
  /** Currently active capability type (skill/subagent/command/mcp/plugin). */
  activeType: string
  /** Called when a card body is clicked — open the detail for that item. */
  onSelectItem: (id: string) => void
}

export function BestPracticeCarousel({ activeType, onSelectItem }: BestPracticeCarouselProps) {
  const { t, i18n } = useT("hub")
  const queryClient = useQueryClient()

  // ── Scroll state ────────────────────────────────────────────────────────
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [favPending, setFavPending] = useState<string | null>(null)

  const updateScrollState = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    setCanScrollLeft(track.scrollLeft > 1)
    setCanScrollRight(track.scrollLeft + track.clientWidth < track.scrollWidth - 1)
  }, [])

  const scrollByDirection = useCallback((direction: -1 | 1) => {
    const track = trackRef.current
    if (!track) return
    const firstChild = track.firstElementChild as HTMLElement | null
    const cardWidth = firstChild?.offsetWidth ?? 340
    const gap = 16
    track.scrollBy({ left: direction * (cardWidth + gap), behavior: "smooth" })
  }, [])

  // ── Data: top-N by install count for the active type ───────────────────
  const params = useMemo(
    () => ({ type: activeType, page: 1, pageSize: CAROUSEL_SIZE, sort: "installCount" as const, order: "desc" as const }),
    [activeType],
  )
  const { data, isLoading } = useQuery(hubItemsQueryOptions(params))

  // Keep previous items while a new type is loading to avoid flicker.
  const [cachedItems, setCachedItems] = useState<CapabilityItem[]>([])
  const items = useMemo(() => {
    const list = data?.items
    return list && list.length > 0 ? list : cachedItems
  }, [data, cachedItems])

  useEffect(() => {
    if (data?.items && data.items.length > 0) setCachedItems(data.items)
  }, [data])

  // Reset scroll position and re-measure when items change / type switches.
  useEffect(() => {
    if (trackRef.current) trackRef.current.scrollLeft = 0
    const raf = requestAnimationFrame(updateScrollState)
    return () => cancelAnimationFrame(raf)
  }, [items, updateScrollState])

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    track.addEventListener("scroll", updateScrollState, { passive: true })
    const raf = requestAnimationFrame(updateScrollState)
    return () => {
      track.removeEventListener("scroll", updateScrollState)
      cancelAnimationFrame(raf)
    }
  }, [updateScrollState])

  // ── Favorite mutations ─────────────────────────────────────────────────
  const favorite = useHubFavoriteMutation()
  const unfavorite = useHubUnfavoriteMutation()

  const toggleFavorite = useCallback(
    async (item: CapabilityItem, e: React.MouseEvent) => {
      e.stopPropagation()
      if (favPending) return
      setFavPending(item.id)
      try {
        if (item.favorited) {
          await unfavorite.mutateAsync(item.id)
        } else {
          await favorite.mutateAsync(item.id)
        }
        // The mutations already invalidate hubKeys.items(); also nudge the
        // favorite-status query in case a detail sheet is open elsewhere.
        queryClient.invalidateQueries({ queryKey: hubKeys.favorite(item.id) })
      } finally {
        setFavPending(null)
      }
    },
    [favPending, favorite, unfavorite, queryClient],
  )

  const copyInstall = useCallback(async (item: CapabilityItem, e: React.MouseEvent) => {
    e.stopPropagation()
    const cmd = getInstallCommand(item)
    if (!cmd) return
    try {
      await navigator.clipboard.writeText(cmd)
      setCopiedId(item.id)
      setTimeout(() => setCopiedId((cur) => (cur === item.id ? null : cur)), 2000)
    } catch {
      // Clipboard failures are non-fatal (permission denied etc.).
    }
  }, [])

  const navButtonClass =
    "inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/20 bg-card/80 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"

  return (
    <section className="mb-6">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{t(($) => $.home.bestPractices.title)}</h2>
          <p className="text-sm text-muted-foreground">{t(($) => $.home.bestPractices.description)}</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" className={navButtonClass} disabled={!canScrollLeft} onClick={() => scrollByDirection(-1)} aria-label="Scroll left">
            <ChevronLeft size={16} />
          </button>
          <button type="button" className={navButtonClass} disabled={!canScrollRight} onClick={() => scrollByDirection(1)} aria-label="Scroll right">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        isLoading ? (
          <div className="flex gap-4">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-68 min-w-[280px] flex-[0_0_calc((100%-2rem)/3)] animate-pulse rounded-xl bg-muted/50 max-[1024px]:min-w-[260px] max-[1024px]:flex-[0_0_calc((100%-1rem)/2)] max-[720px]:min-w-[240px] max-[720px]:flex-[0_0_85%]"
              />
            ))}
          </div>
        ) : (
          <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
            {t(($) => $.home.empty.noCategory)}
          </div>
        )
      ) : (
        <div
          ref={trackRef}
          className="flex gap-4 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [scroll-snap-type:x_mandatory] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((item) => {
            const accent = typeColor(item.itemType)
            const TypeIcon = TYPE_ICON[item.itemType] ?? Sparkles
            const installCommand = getInstallCommand(item)
            return (
              <article
                key={item.id}
                className="flex min-w-[280px] flex-[0_0_calc((100%-2rem)/3)] snap-start flex-col overflow-hidden rounded-xl border border-border/12 bg-gradient-to-b from-card/95 to-muted/95 shadow-[0_16px_40px_-32px_color-mix(in_oklab,var(--primary)_20%,transparent)] transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-[color:color-mix(in_oklab,var(--card-accent)_25%,transparent)] hover:shadow-[0_20px_48px_-28px_color-mix(in_oklab,var(--card-accent)_30%,transparent)] max-[1024px]:min-w-[260px] max-[1024px]:flex-[0_0_calc((100%-1rem)/2)] max-[720px]:min-w-[240px] max-[720px]:flex-[0_0_85%]"
                style={{ "--card-accent": accent } as React.CSSProperties}
                onClick={() => onSelectItem(item.id)}
              >
                <div className="relative flex h-30 items-center justify-center overflow-hidden border-b border-border/8 bg-[linear-gradient(135deg,color-mix(in_oklab,var(--card-accent)_12%,var(--card))_0%,color-mix(in_oklab,var(--card-accent)_4%,var(--card))_60%,var(--card)_100%)] max-[720px]:h-20">
                  <TypeIcon className="h-12 w-12 text-[var(--card-accent)] opacity-35" />
                </div>

                <div className="flex flex-1 flex-col gap-1.5 px-4 pt-3 pb-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-lg bg-[color:color-mix(in_oklab,var(--card-accent)_12%,transparent)] px-2 py-0.5 text-xs whitespace-nowrap text-[var(--card-accent)]">
                      {t(typeKey(item.itemType) as never)}
                    </span>
                    {item.securityStatus ? <SecurityTag status={item.securityStatus} /> : null}
                  </div>

                  <h3 className="m-0 truncate text-base font-bold text-foreground">{item.name}</h3>
                  <p className="line-clamp-2 min-h-[2.5em] flex-1 text-sm text-muted-foreground">
                    {pickItemDescription(item, i18n.language)}
                  </p>

                  <div className="mt-1 flex items-center justify-between">
                    <div className="flex gap-2.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-0.5" title={t(($) => $.detail.favorite)}>
                        <Star size={12} className="opacity-65" />
                        {(item.favoriteCount ?? 0).toLocaleString()}
                      </span>
                      <span className="inline-flex items-center gap-0.5" title={t(($) => $.detail.installCount)}>
                        <Download size={12} className="opacity-65" />
                        {(item.installCount ?? 0).toLocaleString()}
                      </span>
                      <span className="inline-flex items-center gap-0.5" title={t(($) => $.detail.preview)}>
                        <Eye size={12} className="opacity-65" />
                        {(item.previewCount ?? 0).toLocaleString()}
                      </span>
                    </div>

                    <div className="flex gap-1">
                      {installCommand ? (
                        <button
                          type="button"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                          onClick={(e) => copyInstall(item, e)}
                          title={t(($) => $.detail.copyInstall)}
                        >
                          {copiedId === item.id ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={cn(
                          "inline-flex h-7 w-7 items-center justify-center rounded-md bg-transparent transition-colors hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-40",
                          item.favorited ? "text-amber-500 hover:text-amber-500" : "text-muted-foreground hover:text-foreground",
                        )}
                        onClick={(e) => toggleFavorite(item, e)}
                        title={item.favorited ? t(($) => $.detail.unfavoriteTooltip) : t(($) => $.detail.favoriteTooltip)}
                        disabled={favPending === item.id}
                      >
                        <Star size={14} fill={item.favorited ? "currentColor" : "none"} />
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default BestPracticeCarousel

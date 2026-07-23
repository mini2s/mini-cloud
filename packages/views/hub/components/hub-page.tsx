"use client"

import { useState, useCallback, useMemo, useEffect, useRef } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { useT } from "@multica/views/i18n"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@multica/ui/components/ui/sheet"
import { Search, X, RefreshCw } from "lucide-react"
import type { CapabilityItem, ItemSort, ItemOrder } from "@multica/core/types"

import HubLayout from "./hub-layout"
import { TypeHero } from "./type-hero"
import { SearchTokenBox } from "./search-token-box"
import { HubFilterBar } from "./hub-filter-bar"
import type { FilterGroup } from "./hub-filter-bar"
import { SortDropdown } from "./sort-dropdown"
import type { SortOption } from "./sort-dropdown"
import { ViewToggle } from "./view-toggle"
import type { ViewMode } from "./view-toggle"
import { PaginationBar } from "./pagination-bar"
import { HubCardGrid } from "./hub-card-grid"
import { HubListView } from "./hub-list-view"
import { ItemDetailContent } from "./item-detail-content"
import { useHubItems } from "../hooks/use-hub-items"
import { useHubFilterOptions } from "../hooks/use-hub-filters"
import { useHubPagination } from "../hooks/use-hub-pagination"
import { useHubFavoriteMutation, useHubUnfavoriteMutation } from "../hooks/use-hub-favorites"

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_TYPES = new Set(["all", "skill", "subagent", "command", "mcp", "plugin"])

type HubType = "all" | "skill" | "subagent" | "command" | "mcp" | "plugin"

const SORT_OPTIONS: { value: ItemSort; labelKey: string }[] = [
  { value: "favoriteCount", labelKey: "home.sort.favoriteCount" },
  { value: "experienceScore", labelKey: "home.sort.experienceScore" },
  { value: "updatedAt", labelKey: "home.sort.updatedAt" },
]

const VIEW_STORAGE_KEY = "hub:viewMode"

function loadViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY)
    if (v === "grid" || v === "list") return v
  } catch { /* noop */ }
  return "list"
}

function saveViewMode(mode: ViewMode) {
  try { localStorage.setItem(VIEW_STORAGE_KEY, mode) } catch { /* noop */ }
}

// ── HubPage ───────────────────────────────────────────────────────────────────

export function HubPage() {
  const { t } = useT("hub")
  const { t: tc } = useT("common")
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const { page, pageSize, setPage, setPageSize } = useHubPagination()

  // ── URL-derived state ──
  const activeType = useMemo<HubType>(() => {
    const raw = searchParams.get("type")
    return raw && VALID_TYPES.has(raw) ? (raw as HubType) : "all"
  }, [searchParams])

  const sortBy = useMemo<ItemSort>(() => {
    const raw = searchParams.get("sort") as ItemSort | null
    return SORT_OPTIONS.some((o) => o.value === raw) ? raw! : "favoriteCount"
  }, [searchParams])

  const sortOrder = useMemo<ItemOrder>(() => {
    return searchParams.get("order") === "asc" ? "asc" : "desc"
  }, [searchParams])

  // ── Local state ──
  const [viewMode, setViewModeState] = useState<ViewMode>(loadViewMode)
  const [searchText, setSearchText] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)

  // Applied filters from URL
  const appliedCategories = useMemo(() => {
    const raw = searchParams.get("categories")
    return raw ? raw.split(",").filter(Boolean) : []
  }, [searchParams])

  const appliedSources = useMemo(() => {
    const raw = searchParams.get("sources")
    return raw ? raw.split(",").filter(Boolean) : []
  }, [searchParams])

  const appliedTags = useMemo(() => {
    const raw = searchParams.get("tags")
    return raw ? raw.split(",").filter(Boolean) : []
  }, [searchParams])

  // Refs
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Data fetching ──
  const listParams = useMemo(() => ({
    type: activeType === "all" ? undefined : activeType,
    search: debouncedSearch || undefined,
    categories: appliedCategories.length ? appliedCategories : undefined,
    source: appliedSources.length ? appliedSources : undefined,
    tags: appliedTags.length ? appliedTags : undefined,
    page,
    pageSize,
    sort: sortBy,
    order: sortOrder,
  }), [activeType, debouncedSearch, appliedCategories, appliedSources, appliedTags, page, pageSize, sortBy, sortOrder])

  const { data: listData, isLoading, isError, refetch } = useHubItems(listParams)
  const { data: filterOpts } = useHubFilterOptions()

  const favMutation = useHubFavoriteMutation()
  const unfavMutation = useHubUnfavoriteMutation()

  const items = listData?.items ?? []
  const total = listData?.total ?? 0

  // Popular items for type-hero
  const popularParams = useMemo(() =>
    activeType !== "all"
      ? { type: activeType, page: 1, pageSize: 20 }
      : null
  , [activeType])

  const { data: popularData } = useHubItems(popularParams ?? { pageSize: 0 })
  const popularItems = useMemo(() => {
    if (!popularData?.items) return []
    return [...popularData.items]
      .sort((a, b) => (b.installCount ?? 0) - (a.installCount ?? 0))
      .slice(0, 3)
  }, [popularData])

  const totalInstalls = useMemo(() => {
    if (!popularData?.items) return 0
    return popularData.items.reduce((s, i) => s + (i.installCount ?? 0), 0)
  }, [popularData])
// ── URL update helper ──
const updateURL = useCallback((updates: Record<string, string | null>) => {
  const next = new URLSearchParams(searchParams)
  for (const [key, val] of Object.entries(updates)) {
    if (val === null || val === "") next.delete(key)
    else next.set(key, val)
  }
  router.replace(`${pathname}?${next.toString()}`, { scroll: false })
}, [searchParams, router, pathname])

  // ── Search handlers ──
  const handleSearchInput = useCallback((value: string) => {
    setSearchText(value)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      const trimmed = value.trim()
      setDebouncedSearch(trimmed)
      setPage(1)
      updateURL({ search: trimmed || null, page: "1" })
    }, 300)
  }, [setPage, updateURL])

  const clearSearch = useCallback(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    setSearchText("")
    setDebouncedSearch("")
    setPage(1)
    updateURL({ search: null, page: "1" })
  }, [setPage, updateURL])

  // ── Type change (via global sidebar URL) — clear search/filters on type switch ──
  const prevTypeRef = useRef(activeType)
  useEffect(() => {
    if (prevTypeRef.current === activeType) return
    prevTypeRef.current = activeType
    setSearchText("")
    setDebouncedSearch("")
    setSelectedItemId(null)
    setPage(1)
  }, [activeType])

  // ── Sort change ──
  const handleSortChange = useCallback((value: string) => {
    setPage(1)
    updateURL({ sort: value, order: "desc", page: "1" })
  }, [setPage, updateURL])

  // ── View mode change ──
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewModeState(mode)
    saveViewMode(mode)
  }, [])

  // ── Filter handlers ──
  const toggleFilter = useCallback((key: string, value: string) => {
    const getCurrent = (): [string[], string] => {
      if (key === "categories") return [appliedCategories, "categories"]
      if (key === "sources") return [appliedSources, "sources"]
      if (key === "tags") return [appliedTags, "tags"]
      return [[], key]
    }
    const [current, urlKey] = getCurrent()
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value]
    setPage(1)
    updateURL({ [urlKey]: next.length ? next.join(",") : null, page: "1" })
  }, [appliedCategories, appliedSources, appliedTags, setPage, updateURL])

  const clearAllFilters = useCallback(() => {
    setSearchText("")
    setDebouncedSearch("")
    setPage(1)
    updateURL({
      search: null,
      categories: null,
      sources: null,
      tags: null,
      page: "1",
    })
  }, [setPage, updateURL])

  // ── Detail sheet ──
  const openDetail = useCallback((item: CapabilityItem) => {
    setSelectedItemId(item.id)
  }, [])

  const closeDetail = useCallback(() => {
    setSelectedItemId(null)
  }, [])

  // ── Favorite toggle ──
  const [favoritePending, setFavoritePending] = useState(false)

  const handleFavoriteToggle = useCallback((item: CapabilityItem) => {
    if (favoritePending) return
    setFavoritePending(true)
    const mutation = item.favorited ? unfavMutation : favMutation
    mutation.mutate(item.id, {
      onSettled: () => setFavoritePending(false),
    })
  }, [favMutation, unfavMutation, favoritePending])

  // ── Sidebar navigation ──
  // ── Cleanup ──
  useEffect(() => {
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [])

  // ── Search placeholder ──
  const searchPlaceholder = useMemo(() => {
    const map: Record<HubType, string> = {
      all: t(($) => $.home.search.placeholderType.all),
      skill: t(($) => $.home.search.placeholderType.skill),
      subagent: t(($) => $.home.search.placeholderType.subagent),
      command: t(($) => $.home.search.placeholderType.command),
      mcp: t(($) => $.home.search.placeholderType.mcp),
      plugin: t(($) => $.home.search.placeholderType.plugin),
    }
    return map[activeType] ?? map.all
  }, [activeType, t])

  // ── Filter groups for HubFilterBar ──
  const filterGroups = useMemo(() => {
    const categories: FilterGroup = {
      options: (filterOpts?.categories ?? []).map((c) => ({
        value: c.slug ?? c.id ?? String(c),
        label: Object.values(c.names ?? {})[0] ?? c.slug ?? String(c),
      })),
      appliedValues: appliedCategories,
      toggle: (v: string) => toggleFilter("categories", v),
      reset: () => {
        setPage(1)
        updateURL({ categories: null, page: "1" })
      },
    }

    const tags: FilterGroup = {
      options: (filterOpts?.tags ?? []).map((tag) => ({
        value: typeof tag === "string" ? tag : tag.slug ?? tag.id ?? String(tag),
        label: typeof tag === "string" ? tag : tag.slug ?? tag.id ?? String(tag),
      })),
      appliedValues: appliedTags,
      toggle: (v: string) => toggleFilter("tags", v),
      reset: () => {
        setPage(1)
        updateURL({ tags: null, page: "1" })
      },
    }

    const sources: FilterGroup = {
      options: [],
      appliedValues: appliedSources,
      toggle: (v: string) => toggleFilter("sources", v),
      reset: () => {
        setPage(1)
        updateURL({ sources: null, page: "1" })
      },
    }

    const security: FilterGroup = {
      options: [],
      appliedValues: [],
      toggle: () => {},
      reset: () => {},
    }

    return { categories, tags, sources, security }
  }, [filterOpts, appliedCategories, appliedSources, appliedTags, toggleFilter, setPage, updateURL])

  // ── Sort dropdown options ──
  const sortDropdownOptions: SortOption[] = useMemo(() =>
    SORT_OPTIONS.map((o) => ({
      value: o.value,
      label: t(o.labelKey as any),
    }))
  , [t])

  // ── Render ──
  const showHero = activeType !== "all"
  const detailOpen = selectedItemId !== null
  const hasActiveQuery = debouncedSearch.length > 0
    || appliedCategories.length > 0
    || appliedSources.length > 0
    || appliedTags.length > 0


  return (
    <HubLayout>
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {/* ═══ TYPE HERO (type-specific mode) ═══ */}
          {showHero && (
            <div className="px-6 pt-4 max-[640px]:px-4">
              <TypeHero
                type={activeType}
                items={popularItems}
                total={popularData?.total ?? 0}
                totalInstalls={totalInstalls}
                onItemClick={openDetail}
              />
            </div>
          )}

          {/* ═══ SEARCH / TOOLBAR ═══ */}
          <div className="flex w-full flex-col gap-3 px-6 py-4 max-[640px]:px-4">
            <div className="flex w-full items-center gap-3 max-[640px]:gap-2">
              <SearchTokenBox
                value={searchText}
                onInput={handleSearchInput}
                onClear={clearSearch}
                placeholder={searchPlaceholder ?? ""}
                tags={appliedTags}
                onAddTag={(slug) => toggleFilter("tags", slug)}
                onRemoveTag={(slug) => toggleFilter("tags", slug)}
              />

              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                <SortDropdown
                  options={sortDropdownOptions}
                  value={sortBy}
                  onChange={handleSortChange}
                />

                <ViewToggle
                  value={viewMode}
                  onChange={handleViewModeChange}
                />
              </div>
            </div>
          </div>

          {/* ═══ FILTER BAR ═══ */}
          <div className="px-6 pb-3 max-[640px]:px-4">
            <HubFilterBar
              category={filterGroups.categories}
              security={filterGroups.security}
              source={filterGroups.sources}
              tag={filterGroups.tags}
              totalItems={total}
              onClearAll={clearAllFilters}
            />
          </div>

          {/* ═══ CONTENT ═══ */}
          <div className="relative min-h-[18rem] flex-1 px-6 pb-6 max-[640px]:px-4">
            {/* Loading overlay (refresh with cache) */}
            {isLoading && items.length > 0 && (
              <div className="absolute inset-0 z-10 flex items-start justify-center rounded-lg bg-background/60 pt-12">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <RefreshCw size={16} className="animate-spin" />
                  {tc($ => $.loading)}
                </div>
              </div>
            )}

            {/* Error state (no cached data) */}
            {isError && items.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-3 py-20">
                <div className="rounded-full bg-destructive/10 p-3">
                  <X size={24} className="text-destructive" />
                </div>
                <p className="text-sm font-medium text-destructive">
                  {t(($) => $.home.error.loadFailed)}
                </p>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border/60 bg-background px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
                >
                  <RefreshCw size={14} />
                  {t(($) => $.home.error.retry)}
                </button>
              </div>
            )}

            {/* Skeleton on first load */}
            {isLoading && items.length === 0 && (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex animate-pulse items-center gap-3.5 rounded-lg border border-border/40 bg-background px-4 py-3.5">
                    <div className="h-11 w-11 shrink-0 rounded-[0.8125rem] bg-muted/60" />
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="h-4 w-2/5 rounded bg-muted/60" />
                      <div className="h-3 w-3/5 rounded bg-muted/60" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {!isLoading && !isError && items.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-3 py-20">
                <div className="rounded-full bg-muted/40 p-3">
                  <Search size={24} className="text-muted-foreground/60" />
                </div>
                <p className="text-sm text-muted-foreground">
                  {hasActiveQuery
                    ? t($ => $.home.empty.noMatch)
                    : t($ => $.home.empty.noCategory)}
                </p>
                {hasActiveQuery && (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
                  >
                    {t($ => $.home.filter.clearAll)}
                  </button>
                )}
              </div>
            )}

            {/* Actual content */}
            {items.length > 0 && (
              <>
                {viewMode === "grid" ? (
                  <HubCardGrid
                    items={items}
                    loading={isLoading}
                    onItemClick={openDetail}
                    onFavoriteToggle={handleFavoriteToggle}
                  />
                ) : (
                  <HubListView
                    items={items}
                    loading={isLoading}
                    onItemClick={openDetail}
                    onFavoriteToggle={handleFavoriteToggle}
                  />
                )}
              </>
            )}
          </div>

          {/* ═══ PAGINATION ═══ */}
          {total > 0 && (
            <div className="px-6 pb-6 max-[640px]:px-4">
              <PaginationBar
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            </div>
          )}
        </div>

      {/* ═══ DETAIL SHEET ═══ */}
      <Sheet
        open={detailOpen}
        onOpenChange={(open) => { if (!open) closeDetail() }}
      >
        <SheetContent
          side="right"
          className="w-[min(68rem,94vw)] p-0 data-[side=right]:w-[min(68rem,94vw)] data-[side=right]:sm:max-w-none"
          showCloseButton={true}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Capability Detail</SheetTitle>
            <SheetDescription>View capability details and manage subscriptions</SheetDescription>
          </SheetHeader>

          {selectedItemId && (
            <div className="h-full overflow-y-auto">
              <ItemDetailContent
                itemId={selectedItemId}
                className="thin-scrollbar"
                onDeleted={closeDetail}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </HubLayout>
  )
}

export function HubManager() {
  return <div>Hub Manager - Coming Soon</div>
}

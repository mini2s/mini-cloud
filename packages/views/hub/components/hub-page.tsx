"use client"

import { useState, useCallback, useMemo, useEffect, useRef } from "react"
import { flushSync } from "react-dom"
import { useNavigation } from "../../navigation"
import { useT } from "@multica/views/i18n"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@multica/ui/components/ui/sheet"
import { toast } from "sonner"
import { Search, X, RefreshCw, Layers } from "lucide-react"
import type { CapabilityItem, ItemSort, ItemOrder } from "@multica/core/types"

import HubLayout from "./hub-layout"
import { PageHeader } from "../../layout/page-header"
import { HubSidebar } from "./hub-sidebar"
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
import {
  useHubItems,
  useHubFilterOptions,
  useHubPagination,
  useHubFavoriteMutation,
  useHubUnfavoriteMutation,
  useHubViewStore,
  useHubTypeCounts,
  useHubSemanticSearch,
  HUB_ITEM_TYPES,
  HUB_PAGE_SIZE_OPTIONS,
} from "@multica/core/hub"

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_TYPES = new Set(["all", "skill", "subagent", "command", "mcp", "plugin"])

type HubType = "all" | "skill" | "subagent" | "command" | "mcp" | "plugin"

const SORT_OPTIONS: { value: ItemSort; labelKey: string }[] = [
  { value: "favoriteCount", labelKey: "home.sort.favoriteCount" },
  { value: "experienceScore", labelKey: "home.sort.experienceScore" },
  { value: "updatedAt", labelKey: "home.sort.updatedAt" },
]

// ── HubPage ───────────────────────────────────────────────────────────────────

export function HubPage() {
  const { t } = useT("hub")
  const { t: tc } = useT("common")
  const { searchParams, pathname, replace } = useNavigation()
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
  const viewMode = useHubViewStore((s) => s.viewMode)
  const setViewMode = useHubViewStore((s) => s.setViewMode)
  const [searchText, setSearchText] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  // 「显示 Fork」— 公共浏览默认隐藏 fork 副本（GitHub 式），打开后包含。
  const [showForks, setShowForks] = useState(false)
  // 「隐藏插件子集」
  const [hideSubSkills, setHideSubSkills] = useState(false)

  // Applied filters from URL
  const appliedCategories = useMemo(() => {
    const raw = searchParams.get("categories")
    return raw ? raw.split(",").filter(Boolean) : []
  }, [searchParams])

  const appliedSources = useMemo(() => {
    const raw = searchParams.get("sources")
    return raw ? raw.split(",").filter(Boolean) : []
  }, [searchParams])

  // 风险筛选值来自 securityRiskGroups，但作为 securityStatuses 传给列表查询（与源项目一致）
  const appliedSecurityFilters = useMemo(() => {
    const raw = searchParams.get("security")
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
    securityStatuses: appliedSecurityFilters.length ? appliedSecurityFilters : undefined,
    tags: appliedTags.length ? appliedTags : undefined,
    page,
    pageSize,
    sort: sortBy,
    order: sortOrder,
    ...(showForks && { includeForks: true }),
    ...(hideSubSkills && { excludeSubSkills: true }),
  }), [activeType, debouncedSearch, appliedCategories, appliedSources, appliedSecurityFilters, appliedTags, page, pageSize, sortBy, sortOrder, showForks, hideSubSkills])

  const { data: listData, isLoading, isError, refetch } = useHubItems(listParams)
  const { data: filterOpts } = useHubFilterOptions()

  const favMutation = useHubFavoriteMutation()
  const unfavMutation = useHubUnfavoriteMutation()

  const items = useMemo(() => listData?.items ?? [], [listData])
  const total = listData?.total ?? 0

  // ── FR-08: per-type totals for the sidebar badges ──
  // Counts are type totals (own queryKey + long staleTime) — they never
  // change with filter/sort/page state, mirroring the source store sidebar.
  const { counts: typeCounts, isLoading: typeCountsLoading } = useHubTypeCounts()
  const sidebarCounts = useMemo(() => {
    if (typeCountsLoading) return undefined
    const all = HUB_ITEM_TYPES.reduce((sum, type) => sum + (typeCounts[type] ?? 0), 0)
    return { all, ...typeCounts }
  }, [typeCounts, typeCountsLoading])

  // ── FR-09: semantic search (Enter-triggered) ──
  // The keyword list query above stays the backbone (filters/sort/pagination
  // keep working against it). Pressing Enter in the search box additionally
  // fires `hubSemanticSearch`; its relevance-ranked hits lead the displayed
  // list, with keyword results appended (deduped by id) — the source store's
  // merge-priority rule. Any later list-driving interaction (type / filter /
  // sort / page / pageSize change, or editing the query) invalidates the
  // semantic boost and the list falls back to pure keyword results, so
  // filter/sort linkage is always correct.
  const { search: semanticSearch } = useHubSemanticSearch()
  const [semanticHits, setSemanticHits] = useState<{ query: string; items: CapabilityItem[] } | null>(null)

  const listContextKey = JSON.stringify([
    activeType,
    appliedCategories,
    appliedSources,
    appliedTags,
    sortBy,
    sortOrder,
    page,
    pageSize,
  ])
  // FR-14: remount key for the results list — any new result set (filter /
  // search / sort / page change) replays the staggered entrance animation.
  const resultSetKey = `${listContextKey}|${debouncedSearch}`
  const prevListContextKey = useRef(listContextKey)
  useEffect(() => {
    if (prevListContextKey.current === listContextKey) return
    prevListContextKey.current = listContextKey
    setSemanticHits(null)
  }, [listContextKey])

  const semanticActive =
    semanticHits !== null &&
    semanticHits.items.length > 0 &&
    semanticHits.query === debouncedSearch

  const displayItems = useMemo(() => {
    if (!semanticActive || !semanticHits) return items
    const seen = new Set(semanticHits.items.map((item) => item.id))
    return [...semanticHits.items, ...items.filter((item) => !seen.has(item.id))]
  }, [semanticActive, semanticHits, items])
// ── URL update helper ──
const updateURL = useCallback((updates: Record<string, string | null>) => {
  const next = new URLSearchParams(searchParams)
  for (const [key, val] of Object.entries(updates)) {
    if (val === null || val === "") next.delete(key)
    else next.set(key, val)
  }
  replace(`${pathname}?${next.toString()}`)
}, [searchParams, replace, pathname])

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

  // ── Semantic search submit (Enter / "Search" row in the token box) ──
  // Commits the keyword search immediately (no 300ms debounce wait), then
  // fires the semantic search for the same query. Failures degrade silently
  // to the keyword list — the semantic layer is additive, never blocking.
  const handleSearchSubmit = useCallback((rawValue: string) => {
    const q = rawValue.trim()
    if (searchTimer.current) {
      clearTimeout(searchTimer.current)
      searchTimer.current = null
    }
    setSearchText(q)
    setDebouncedSearch(q)
    setPage(1)
    updateURL({ search: q || null, page: "1" })
    if (!q) {
      setSemanticHits(null)
      return
    }
    semanticSearch(q)
      .then((hits) => setSemanticHits({ query: q, items: hits }))
      .catch(() => setSemanticHits(null))
  }, [semanticSearch, setPage, updateURL])

  const clearSearch = useCallback(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    setSearchText("")
    setDebouncedSearch("")
    setSemanticHits(null)
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
  }, [activeType, setPage])

  // ── Sort change ──
  const handleSortChange = useCallback((value: string) => {
    setPage(1)
    updateURL({ sort: value, order: "desc", page: "1" })
  }, [setPage, updateURL])

  // ── View mode change ──
  // FR-14: wrap the card⇄list switch in the platform-agnostic View
  // Transitions DOM API so the old view fades out while the new one fades
  // in (styles registered in packages/ui/styles/tokens.css). Skipped when
  // the user prefers reduced motion or the API is unavailable — the state
  // commit then happens instantly. flushSync forces the DOM update inside
  // the transition callback so the browser snapshots the new view.
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    if (mode === viewMode) return
    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (
      !reduceMotion &&
      typeof document !== "undefined" &&
      typeof document.startViewTransition === "function"
    ) {
      document.startViewTransition(() => flushSync(() => setViewMode(mode)))
      return
    }
    setViewMode(mode)
  }, [viewMode, setViewMode])

  // ── Filter handlers ──
  const toggleFilter = useCallback((key: string, value: string) => {
    const getCurrent = (): [string[], string] => {
      if (key === "categories") return [appliedCategories, "categories"]
      if (key === "sources") return [appliedSources, "sources"]
      if (key === "security") return [appliedSecurityFilters, "security"]
      if (key === "tags") return [appliedTags, "tags"]
      return [[], key]
    }
    const [current, urlKey] = getCurrent()
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value]
    setPage(1)
    updateURL({ [urlKey]: next.length ? next.join(",") : null, page: "1" })
  }, [appliedCategories, appliedSources, appliedSecurityFilters, appliedTags, setPage, updateURL])

  const clearAllFilters = useCallback(() => {
    setSearchText("")
    setDebouncedSearch("")
    setSemanticHits(null)
    setPage(1)
    updateURL({
      search: null,
      categories: null,
      sources: null,
      security: null,
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
    setDetailMcpFocus(false)
  }, [])

  // F-09: subscribing an unconfigured MCP from the list is blocked — toast the
  // reason and open the detail sheet focused on the MCP config form.
  const [detailMcpFocus, setDetailMcpFocus] = useState(false)
  const handleMcpSubscribeBlocked = useCallback((item: CapabilityItem) => {
    toast.warning(t(($) => $.detail.mcp.subscribeBlocked))
    setDetailMcpFocus(true)
    setSelectedItemId(item.id)
  }, [t])

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
  const handleSidebarNavigate = useCallback((type?: string) => {
    setPage(1)
    updateURL({ type: type ?? null, page: "1" })
  }, [setPage, updateURL])

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

  // ── 「隐藏插件子集」按钮 label：根据当前 type 切换文案，与源项目 store 一致 ──
  const hidePluginItemsLabel = useMemo(() => {
    const map: Partial<Record<HubType, string>> = {
      all: t(($) => $.home.hidePluginItemsLabel.all),
      skill: t(($) => $.home.hidePluginItemsLabel.skill),
      mcp: t(($) => $.home.hidePluginItemsLabel.mcp),
    }
    return map[activeType] ?? t(($) => $.home.hidePluginItems)
  }, [activeType, t])

  // ── Filter groups for HubFilterBar ──
  // 源项目 home 页筛选条仅保留 分类/风险/来源 三个维度；tag 由 SearchTokenBox 独立处理。
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

    const sources: FilterGroup = {
      options: (filterOpts?.sources ?? []).map((s) => ({
        value: s.value,
        label: s.label || s.value,
      })),
      appliedValues: appliedSources,
      toggle: (v: string) => toggleFilter("sources", v),
      reset: () => {
        setPage(1)
        updateURL({ sources: null, page: "1" })
      },
    }

    // 风险组 label：优先 names 的本地化/英文，去掉源项目遗留的尾部 ".." 占位（与源 securityRiskGroupLabel 一致）
    const security: FilterGroup = {
      options: (filterOpts?.securityRiskGroups ?? []).map((o) => ({
        value: o.value,
        label: (Object.values(o.names ?? {})[0] ?? o.value).replace(/\.{2,}$/g, ""),
      })),
      appliedValues: appliedSecurityFilters,
      toggle: (v: string) => toggleFilter("security", v),
      reset: () => {
        setPage(1)
        updateURL({ security: null, page: "1" })
      },
    }

    return { categories, sources, security }
  }, [filterOpts, appliedCategories, appliedSources, appliedSecurityFilters, toggleFilter, setPage, updateURL])

  // ── Sort dropdown options ──
  const sortDropdownOptions: SortOption[] = useMemo(() =>
    SORT_OPTIONS.map((o) => ({
      value: o.value,
      label: t(o.labelKey as any),
    }))
  , [t])

  // ── Render ──
  const detailOpen = selectedItemId !== null
  const hasActiveQuery = debouncedSearch.length > 0
    || appliedCategories.length > 0
    || appliedSources.length > 0
    || appliedSecurityFilters.length > 0
    || appliedTags.length > 0


  return (
    <HubLayout>
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        {/* ═══ PAGE HEADER (title + type tabs in one row) ═══ */}
        <PageHeader>
          <h1 className="shrink-0 text-sm font-semibold">{t(($) => $.home.title)}</h1>
          <HubSidebar
            currentType={activeType === "all" ? null : activeType}
            counts={sidebarCounts}
            onNavigate={handleSidebarNavigate}
            orientation="horizontal"
          />
        </PageHeader>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">

          {/* ═══ SEARCH / TOOLBAR ═══ */}
          <div className="flex w-full flex-col gap-3 px-6 py-4 max-[640px]:px-4">
            <div className="flex w-full items-center gap-3 max-[640px]:gap-2">
              <SearchTokenBox
                value={searchText}
                onInput={handleSearchInput}
                onClear={clearSearch}
                onSubmit={handleSearchSubmit}
                placeholder={searchPlaceholder ?? ""}
                tags={appliedTags}
                onAddTag={(slug) => toggleFilter("tags", slug)}
                onRemoveTag={(slug) => toggleFilter("tags", slug)}
              />

              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                {/* 显示 Fork — 公共浏览默认隐藏 fork 副本（GitHub 式），打开后包含 */}
                <button
                  type="button"
                  onClick={() => { setShowForks((v) => !v); setPage(1) }}
                  aria-pressed={showForks}
                  title={t(($) => $.home.showForks)}
                  className="inline-flex h-[34px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[10px] border px-3 text-[12.5px] font-bold transition-[color,border-color,background-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={showForks
                    ? { borderColor: "color-mix(in srgb, var(--color-primary) 45%, transparent)", backgroundColor: "color-mix(in srgb, var(--color-primary) 10%, var(--background))", color: "var(--color-primary)" }
                    : {}}
                >
                  <Layers size={14} />
                  <span className="max-[640px]:hidden">{t(($) => $.home.showForks)}</span>
                </button>

                {/* 隐藏插件子集 — 根据当前 type 切换 label */}
                <button
                  type="button"
                  role="switch"
                  aria-pressed={hideSubSkills}
                  onClick={() => { setHideSubSkills((v) => !v); setPage(1); setSelectedItemId(null) }}
                  title={hidePluginItemsLabel}
                  className="inline-flex h-[34px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[10px] border px-3 text-[12.5px] font-bold transition-[color,border-color,background-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={hideSubSkills
                    ? { borderColor: "color-mix(in srgb, var(--color-primary) 45%, transparent)", backgroundColor: "color-mix(in srgb, var(--color-primary) 10%, var(--background))", color: "var(--color-primary)" }
                    : {}}
                >
                  <Layers size={14} />
                  <span className="whitespace-nowrap max-[640px]:hidden">{hidePluginItemsLabel}</span>
                </button>

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
              trailing={total > 0 ? (
                <PaginationBar
                  page={page}
                  pageSize={pageSize}
                  total={total}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                  pageSizeOptions={[...HUB_PAGE_SIZE_OPTIONS]}
                  inline
                />
              ) : undefined}
              onClearAll={clearAllFilters}
            />
          </div>

          {/* ═══ CONTENT ═══ */}
          <div className="relative min-h-72 flex-1 px-6 pb-6 max-[640px]:px-4">
            {/* Loading overlay (refresh with cache) */}
            {isLoading && displayItems.length > 0 && (
              <div className="absolute inset-0 z-10 flex items-start justify-center rounded-lg bg-background/60 pt-12">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <RefreshCw size={16} className="animate-spin" />
                  {tc($ => $.loading)}
                </div>
              </div>
            )}

            {/* Error state (no cached data) */}
            {isError && displayItems.length === 0 && (
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
            {isLoading && displayItems.length === 0 && (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex animate-pulse items-center gap-3.5 rounded-lg border border-border/40 bg-background px-4 py-3.5">
                    <div className="h-11 w-11 shrink-0 rounded-xl bg-muted/60" />
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="h-4 w-2/5 rounded bg-muted/60" />
                      <div className="h-3 w-3/5 rounded bg-muted/60" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {!isLoading && !isError && displayItems.length === 0 && (
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
                    {t($ => $.home.empty.clearFilters)}
                  </button>
                )}
              </div>
            )}

            {/* Actual content (semantic hits lead, keyword results appended) */}
            {displayItems.length > 0 && (
              <>
                {viewMode === "grid" ? (
                  <HubCardGrid
                    key={resultSetKey}
                    items={displayItems}
                    loading={isLoading}
                    searchQuery={debouncedSearch}
                    onItemClick={openDetail}
                    onFavoriteToggle={handleFavoriteToggle}
                    onMcpSubscribeBlocked={handleMcpSubscribeBlocked}
                  />
                ) : (
                  <HubListView
                    key={resultSetKey}
                    items={displayItems}
                    loading={isLoading}
                    searchQuery={debouncedSearch}
                    onItemClick={openDetail}
                    onFavoriteToggle={handleFavoriteToggle}
                    onMcpSubscribeBlocked={handleMcpSubscribeBlocked}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ═══ DETAIL SHEET ═══ */}
      <Sheet
        open={detailOpen}
        onOpenChange={(open) => { if (!open) closeDetail() }}
      >
        <SheetContent
          side="right"
          className="w-screen p-0 data-[side=right]:w-screen data-[side=right]:sm:w-[min(68rem,94vw)] data-[side=right]:sm:max-w-none"
          showCloseButton={true}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{t(($) => $.detail.title)}</SheetTitle>
            <SheetDescription>{t(($) => $.detail.description)}</SheetDescription>
          </SheetHeader>

          {selectedItemId && (
            <div className="h-full overflow-y-auto">
              <ItemDetailContent
                itemId={selectedItemId}
                onDeleted={closeDetail}
                autoFocusMcpConfig={detailMcpFocus}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </HubLayout>
  )
}

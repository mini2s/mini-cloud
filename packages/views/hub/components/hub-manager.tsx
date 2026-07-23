"use client"

import { useState, useCallback, useRef, useMemo, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query"
import { Button } from "@multica/ui/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@multica/ui/components/ui/sheet"
import { toast } from "sonner"
import { api } from "@multica/core/api"
import { useT } from "@multica/views/i18n"
import {
  useHubItems,
  useHubFavoriteMutation,
  useHubUnfavoriteMutation,
  useHubForkDistributionMutation,
  useHubMyReceivedDistributions,
  useHubMySentDistributions,
  useHubDistributionAuthority,
} from "../hooks"
import { useHubFilterOptions } from "../hooks/use-hub-filters"
import type { FilterGroup } from "./hub-filter-bar"
import type {
  CapabilityItem,
  HubItemListParams,
} from "@multica/core/types/hub"
import { ItemDetailContent } from "./item-detail-content"
import { HubFilterBar } from "./hub-filter-bar"
import { HubManagerListView } from "./hub-manager-list-view"
import { CreateCapabilityDialog } from "./create-capability-dialog"
import { EditCapabilityDialog } from "./edit-capability-dialog"
import { UploadPluginDialog } from "./upload-plugin-dialog"
import { DistributeDialog } from "./distribute-dialog"
import HubLayout from "./hub-layout"
import { PaginationBar } from "./pagination-bar"
import { ConfirmDialog } from "./confirm-dialog"
import { SearchTokenBox } from "./search-token-box"
import { ChevronLeft, Share2, CloudUpload, Trash2 } from "lucide-react"

const PAGE_SIZE = 20 as const
const MAX_BATCH_DELETE = 200

type TabKey = "created" | "favorited" | "received" | "sent"

interface SidebarNavItem {
  key: TabKey
  icon: string
}

const SIDEBAR_NAV: SidebarNavItem[] = [
  { key: "created", icon: "📦" },
  { key: "favorited", icon: "⭐" },
  { key: "received", icon: "📥" },
  { key: "sent", icon: "📤" },
]

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function mkGroup(applied: string[], toggle: (v: string) => void, reset: () => void): FilterGroup {
  return { options: [], appliedValues: applied, toggle, reset }
}

export function HubManager() {
  const { t } = useT("hub")
  const router = useRouter()
  const searchParams = useSearchParams()
  const qc = useQueryClient()
  const { data: filterOpts } = useHubFilterOptions()
  const revokeTargetRef = useRef<string | null>(null)

  // ── Tab & URL sync ──────────────────────────────────────────────────────
  const tabFromUrl = searchParams.get("tab") as TabKey | null
  const [tab, setTab] = useState<TabKey>(tabFromUrl ?? "created")

  useEffect(() => {
    const urlTab = searchParams.get("tab") as TabKey | null
    if (urlTab && ["created", "favorited", "received", "sent"].includes(urlTab)) {
      setTab(urlTab as TabKey)
    }
  }, [searchParams])

  // ── Search ──────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("")
  const [debounced, setDebounced] = useState("")
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const handleSearch = useCallback((val: string) => {
    setSearch(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setDebounced(val.trim())
      setPage(1)
    }, 300)
  }, [])

  const handleSearchClear = useCallback(() => {
    setSearch("")
    setDebounced("")
    setPage(1)
  }, [])

  // ── Pagination ──────────────────────────────────────────────────────────
  const [page, setPage] = useState(1)

  // ── Filters ─────────────────────────────────────────────────────────────
  const [typeFilter, setTypeFilter] = useState<string[]>([])
  const [catFilter, setCatFilter] = useState<string[]>([])
  const [secFilter, setSecFilter] = useState<string[]>([])
  const [srcFilter, setSrcFilter] = useState<string[]>([])
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [sort] = useState("favoriteCount_desc")

  const afterFilter = useCallback(() => {
    setDetailItemId(null)
    setPage(1)
  }, [])

  const toggleFilter = (arr: string[], setter: (v: string[]) => void, val: string) =>
    setter(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val])

  const clearFilters = useCallback(() => {
    setTypeFilter([])
    setCatFilter([])
    setSecFilter([])
    setSrcFilter([])
    setTagFilter([])
    afterFilter()
  }, [afterFilter])

  const listParams = useMemo<HubItemListParams>(() => ({
    page,
    pageSize: PAGE_SIZE,
    search: debounced || undefined,
    type: typeFilter.length ? (typeFilter[0] as CapabilityItem["itemType"]) : undefined,
    categories: catFilter.length ? catFilter : undefined,
    securityStatuses: secFilter.length ? secFilter : undefined,
    source: srcFilter.length ? srcFilter : undefined,
    tags: tagFilter.length ? tagFilter : undefined,
    sort: sort as HubItemListParams["sort"],
  }), [page, debounced, typeFilter, catFilter, secFilter, srcFilter, tagFilter, sort])

  // ── Data fetching ───────────────────────────────────────────────────────
  const createdQuery = useHubItems(listParams)
  const favQuery = useHubItems({ ...listParams, favorited: true })
  const receivedQuery = useHubMyReceivedDistributions()
  const sentQuery = useHubMySentDistributions()

  const isItemTab = tab === "created" || tab === "favorited"

  const items = ((): CapabilityItem[] => {
    if (tab === "created") return createdQuery.data?.items ?? []
    if (tab === "favorited") return favQuery.data?.items ?? []
    return []
  })()

  const itemTotal = ((): number => {
    if (tab === "created") return createdQuery.data?.total ?? 0
    if (tab === "favorited") return favQuery.data?.total ?? 0
    return 0
  })()

  const itemLoading = ((): boolean => {
    if (tab === "created") return createdQuery.isLoading
    if (tab === "favorited") return favQuery.isLoading
    return false
  })()

  const receipts = receivedQuery.receipts
  const distributions = sentQuery.distributions

  const filteredReceipts = useMemo(() => {
    if (tab !== "received") return []
    const q = debounced.toLowerCase()
    if (!q) return receipts
    return receipts.filter((r) => {
      const name = r.distribution?.item?.name?.toLowerCase() ?? ""
      const desc = r.distribution?.item?.description?.toLowerCase() ?? ""
      return name.includes(q) || desc.includes(q)
    })
  }, [tab, receipts, debounced])

  const filteredDistributions = useMemo(() => {
    if (tab !== "sent") return []
    const q = debounced.toLowerCase()
    if (!q) return distributions
    return distributions.filter((d) => {
      const name = d.distribution.item?.name?.toLowerCase() ?? ""
      const desc = d.distribution.item?.description?.toLowerCase() ?? ""
      return name.includes(q) || desc.includes(q)
    })
  }, [tab, distributions, debounced])

  const tabCount = useCallback((key: TabKey): number => {
    switch (key) {
      case "created": return createdQuery.data?.total ?? 0
      case "favorited": return favQuery.data?.total ?? 0
      case "received": return receipts.length
      case "sent": return distributions.length
    }
  }, [createdQuery.data, favQuery.data, receipts.length, distributions.length])

  // ── Detail sheet + view tracking ────────────────────────────────────────
  const [detailItemId, setDetailItemId] = useState<string | null>(null)
  const trackedIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!detailItemId || trackedIdRef.current === detailItemId) return
    trackedIdRef.current = detailItemId
    api.hubLogBehavior(detailItemId, {
      action: "view",
      actionType: "view",
      context: "manager",
      metadata: { route: "hub-manager" },
    }).catch(() => {})
  }, [detailItemId])

  useEffect(() => {
    if (!detailItemId) trackedIdRef.current = null
  }, [detailItemId])

  const openDetail = useCallback((item: CapabilityItem) => {
    setDetailItemId(item.id)
  }, [])

  const detailReady = detailItemId != null

  const switchTab = useCallback((next: TabKey) => {
    if (next === tab) return
    setDetailItemId(null)
    setTab(next)
  }, [tab])

  useEffect(() => {
    const p = new URLSearchParams(searchParams.toString())
    p.set("tab", tab)
    router.replace(`?${p.toString()}`, { scroll: false })
  }, [tab, router, searchParams])

  // ── Selection (batch) ───────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [allMatching, setAllMatching] = useState(false)

  const clearSel = useCallback(() => {
    setSelected(new Set())
    setAllMatching(false)
  }, [])

  const toggleRow = useCallback((id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const togglePage = useCallback((checked: boolean) => {
    const ids = items.map((x) => x.id)
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) ids.forEach((id) => next.add(id))
      else ids.forEach((id) => next.delete(id))
      return next
    })
  }, [items])

  const selCount = allMatching ? itemTotal : selected.size

  // ── Delete ──────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.hubDeleteItem(id),
    onSuccess: () => {
      toast.success(t(($) => $.manager.deleteSuccess))
      qc.invalidateQueries({ queryKey: ["hub"] })
      setDetailItemId(null)
    },
    onError: (err: Error) => {
      toast.error(t(($) => $.manager.deleteFailed), { description: err.message })
    },
  })

  const batchDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => api.hubBatchDeleteItems(ids),
    onSuccess: (res: { deleted: number; skipped?: number; forbidden?: number }) => {
      const parts = [t(($) => $.manager.batchDeleted, { deleted: res.deleted })]
      if ((res.skipped ?? 0) > 0 || (res.forbidden ?? 0) > 0) {
        parts.push(t(($) => $.manager.batchSkip, { skipped: (res.skipped ?? 0) + (res.forbidden ?? 0) }))
      }
      toast.success(parts.join(" · "))
      qc.invalidateQueries({ queryKey: ["hub"] })
      clearSel()
      setDeleteDialog({ open: false, id: null, ids: [], batch: false, desc: "" })
    },
    onError: (err: Error) => {
      toast.error(t(($) => $.manager.batchDeleteFailed), { description: err.message })
    },
  })

  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean
    id: string | null
    ids: string[]
    batch: boolean
    desc: string
  }>({ open: false, id: null, ids: [], batch: false, desc: "" })

  const startBatchDelete = useCallback(async () => {
    let ids: string[]
    if (allMatching) {
      const res = await api.hubListItems({ ...listParams, page: 1, pageSize: MAX_BATCH_DELETE })
      ids = res.items.map((i) => i.id)
      const capped = itemTotal > MAX_BATCH_DELETE
      let desc = t(($) => $.manager.confirmBatchDelete, { count: ids.length })
      if (capped) {
        desc += " " + t(($) => $.manager.batchCapped, { total: itemTotal, max: MAX_BATCH_DELETE })
      }
      setDeleteDialog({ open: true, id: null, ids, batch: true, desc })
    } else {
      ids = Array.from(selected)
      if (ids.length === 0) return
      setDeleteDialog({ open: true, id: null, ids, batch: true, desc: t(($) => $.manager.confirmBatchDelete, { count: ids.length }) })
    }
  }, [allMatching, selected, listParams, itemTotal, t])

  // ── Favorite toggle (optimistic) ────────────────────────────────────────
  const favMutation = useHubFavoriteMutation()
  const unfavMutation = useHubUnfavoriteMutation()

  const handleFav = useCallback((item: CapabilityItem) => {
    const wasFav = item.favorited ?? false
    const id = item.id
    const mut = wasFav ? unfavMutation : favMutation
    mut.mutate(id, {
      onSettled: () => {
        qc.invalidateQueries({ queryKey: ["hub", "items"] })
      },
    })
  }, [unfavMutation, favMutation, qc])

  // ── Distribution authority + gating ─────────────────────────────────────
  const { authority } = useHubDistributionAuthority()
  const canDistribute = !!authority && (authority.unlimited || (authority.departments?.length ?? 0) > 0)

  // ── Distribution mutations ──────────────────────────────────────────────
  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.hubRevokeDistribution(id),
    onSuccess: () => {
      toast.success(t(($) => $.manager.revokeSuccess))
      qc.invalidateQueries({ queryKey: ["hub", "distributions"] })
    },
    onError: (err: Error) => {
      toast.error(t(($) => $.manager.revokeFailed), { description: err.message })
    },
  })

  const dismissMutation = useMutation({
    mutationFn: (id: string) => api.hubDismissDistribution(id),
    onSuccess: () => {
      toast.success(t(($) => $.manager.dismissSuccess))
      qc.invalidateQueries({ queryKey: ["hub", "distributions"] })
    },
    onError: (err: Error) => {
      toast.error(t(($) => $.manager.dismissFailed), { description: err.message })
    },
  })

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.hubMarkDistributionRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub", "distributions"] })
    },
    onError: (err: Error) => {
      toast.error(t(($) => $.manager.markReadFailed), { description: err.message })
    },
  })

  const forkMutation = useHubForkDistributionMutation()

  // ── Distributor name resolution (received tab) ──────────────────────────
  const distributorIds = useMemo(() => {
    if (tab !== "received") return []
    const ids = new Set<string>()
    for (const r of receipts) {
      const did = r.distribution?.distributorId
      if (did) ids.add(did)
    }
    return [...ids]
  }, [tab, receipts])

  const { data: distributorNames } = useQuery({
    queryKey: ["hub", "user-names", distributorIds],
    queryFn: () => api.hubGetUserNames(distributorIds),
    enabled: distributorIds.length > 0,
    staleTime: 10 * 60 * 1000,
  })

  // ── Dialogs ─────────────────────────────────────────────────────────────
  const [uploadOpen, setUploadOpen] = useState(false)
  const [editItem, setEditItem] = useState<CapabilityItem | null>(null)
  const [distDialog, setDistDialog] = useState<{
    item: CapabilityItem | null
    open: boolean
  }>({ item: null, open: false })

  // ── Render helpers ──────────────────────────────────────────────────────
  const tagSuggestions = useMemo(() => {
    return (filterOpts?.tags ?? []).map((tag) => ({ id: tag.id ?? tag.slug, label: tag.slug }))
  }, [])

  const handlePage = useCallback((next: number) => {
    setPage(next)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }, [])

  const renderSidebar = (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-background">
      <nav className="flex flex-col gap-1 p-3">
        {SIDEBAR_NAV.map((item) => {
          const active = tab === item.key
          const count = tabCount(item.key)
          return (
            <button
              key={item.key}
              onClick={() => switchTab(item.key)}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              <span className="text-base">{item.icon}</span>
              <span className="flex-1">{t(($) => $.manager.tabs[item.key])}</span>
              {count > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums">
                  {fmtCompact(count)}
                </span>
              )}
            </button>
          )
        })}
      </nav>
    </aside>
  )

  const renderToolbar = (
    <header className="relative overflow-hidden border-b border-border bg-gradient-to-br from-background via-primary/[2%] to-primary/[10%]">
      <div className="mx-auto flex max-w-[78rem] items-center gap-4 px-4 py-5">
        <div className="min-w-0 flex-1">
          <h1 className="relative m-0 shrink-0 text-[1.625rem] leading-[1.15] font-extrabold tracking-[-0.035em] text-foreground">
            {t(($) => tab === "received" ? $.manager.titleReceived : tab === "sent" ? $.manager.titleSent : $.manager.title)}
          </h1>
          <p className="relative m-0 min-w-0 max-w-[38rem] text-[0.8125rem] leading-6 text-muted-foreground">
            {t(($) => tab === "received" ? $.manager.descReceived : tab === "sent" ? $.manager.descSent : $.manager.desc)}
          </p>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-3">
          <Button type="button" variant="outline" size="sm" className="h-8 cursor-pointer px-3" onClick={() => router.push("/hub")}>
            <ChevronLeft size={16} />
            {t(($) => $.manager.backToHub)}
          </Button>
          <CreateCapabilityDialog onCreated={() => qc.invalidateQueries({ queryKey: ["hub"] })} />
          <Button type="button" variant="default" size="sm" className="h-8 cursor-pointer px-3" onClick={() => setUploadOpen(true)}>
            <CloudUpload size={14} />
            {t(($) => $.manager.upload)}
          </Button>
          {canDistribute && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 cursor-pointer px-3"
              disabled={selected.size === 0}
              onClick={() => {
                const item = items.find((x) => selected.has(x.id)) ?? null
                if (item) setDistDialog({ item, open: true })
                else toast.error(t(($) => $.manager.distributeSelectItem))
              }}
            >
              <Share2 size={14} />
              {t(($) => $.manager.distribute.label)}
            </Button>
          )}
        </div>
      </div>
    </header>
  )

  const isLoadingView = isItemTab ? itemLoading : (tab === "received" ? receivedQuery.isLoading : sentQuery.isLoading)
  const isEmpty = isItemTab ? (!itemLoading && items.length === 0) : (tab === "received" ? filteredReceipts.length === 0 : filteredDistributions.length === 0)

  return (
    <HubLayout>
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
        {renderToolbar}
        <div className="flex min-h-0 flex-1">
          <div className="hidden md:block">{renderSidebar}</div>
          <section className="flex min-h-0 flex-1 flex-col px-2 sm:px-3">
            {/* Search */}
            <div className="flex items-center gap-2 py-3">
              <div className="relative min-w-0 flex-1">
                <SearchTokenBox
                  value={search}
                  onInput={handleSearch}
                  onClear={handleSearchClear}
                  placeholder={t(($) => $.manager.searchPlaceholder)}
                  tags={tagFilter}
                  suggestions={tagSuggestions.map((s) => s.id)}
                  onAddTag={(slug: string) => toggleFilter(tagFilter, setTagFilter, slug)}
                  onRemoveTag={(slug: string) => toggleFilter(tagFilter, setTagFilter, slug)}
                />
              </div>
            </div>

            {/* Filter bar — item tabs only */}
            {isItemTab && (
              <div className="mx-auto mb-2.5 w-full max-w-[64rem] px-4">
                <HubFilterBar
                  type={mkGroup(typeFilter, (v) => toggleFilter(typeFilter, setTypeFilter, v), () => setTypeFilter([]))}
                  category={mkGroup(catFilter, (v) => toggleFilter(catFilter, setCatFilter, v), () => setCatFilter([]))}
                  security={mkGroup(secFilter, (v) => toggleFilter(secFilter, setSecFilter, v), () => setSecFilter([]))}
                  source={mkGroup(srcFilter, (v) => toggleFilter(srcFilter, setSrcFilter, v), () => setSrcFilter([]))}
                  tag={mkGroup(tagFilter, (v) => toggleFilter(tagFilter, setTagFilter, v), () => setTagFilter([]))}
                  totalItems={itemTotal}
                  onClearAll={clearFilters}
                />
              </div>
            )}

            {/* Selection bar — created tab only */}
            {tab === "created" && selected.size > 0 && (
              <div className="mx-auto flex w-full max-w-[64rem] items-center gap-2 px-4 pb-2">
                <span className="text-sm text-muted-foreground">
                  {allMatching
                    ? t(($) => $.manager.allMatchingSelected, { count: itemTotal })
                    : t(($) => $.manager.selectedCount, { count: selCount })}
                </span>
                {!allMatching && items.length > 0 && itemTotal > items.length && (
                  <button
                    className="text-xs text-primary hover:underline"
                    onClick={() => setAllMatching(true)}
                  >
                    {t(($) => $.manager.selectAllMatching, { count: itemTotal })}
                  </button>
                )}
                <button
                  className="text-xs text-muted-foreground hover:underline"
                  onClick={clearSel}
                >
                  {t(($) => $.manager.clearSelection)}
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-destructive hover:text-destructive"
                    onClick={startBatchDelete}
                  >
                    <Trash2 size={14} />
                    {t(($) => $.manager.batchDelete)}
                  </Button>
                </div>
              </div>
            )}

            {/* Content area */}
            <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
              {isLoadingView && isEmpty && (
                <HubManagerListView
                  items={[]}
                  loading={true}
                  selected={selected}
                  onToggleRow={toggleRow}
                  onTogglePage={togglePage}
                  onItemClick={openDetail}
                  onFav={handleFav}
                  onEdit={(item) => setEditItem(item)}
                  onDelete={(id) => setDeleteDialog({ open: true, id, ids: [], batch: false, desc: t(($) => $.manager.confirmDelete) })}
                  searchQuery={debounced}
                  total={itemTotal}
                />
              )}

              {!isLoadingView && isEmpty && (
                <div className="flex flex-col items-center justify-center py-20">
                  <p className="mb-1 text-[0.9375rem] font-medium text-muted-foreground">
                    {t(($) => tab === "created" ? $.manager.emptyCreated : tab === "favorited" ? $.manager.emptyFavorited : tab === "received" ? $.manager.emptyReceived : $.manager.emptySent)}
                  </p>
                </div>
              )}

              {/* Received tab */}
              {tab === "received" && !isEmpty && (
                <div className="min-h-0 flex-1 overflow-auto rounded-[0.875rem] border border-border">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colName)}</th>
                        <th className="w-[14rem] px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colDesc)}</th>
                        <th className="w-[8rem] px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colType)}</th>
                        <th className="w-[10rem] px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colFrom)}</th>
                        <th className="w-[10rem] px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colPermission)}</th>
                        <th className="w-[8rem] px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colStatus)}</th>
                        <th className="w-[12rem] px-4 py-3 text-right font-semibold text-foreground">{t(($) => $.manager.colAction)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredReceipts.map((receipt) => {
                        const dist = receipt.distribution
                        const item = dist?.item
                        const isUnread = receipt.receiptStatus === "unread"
                        const canDismiss = dist?.permissionMode === "dismissible"
                        const distributorName = (dist?.distributorId && distributorNames?.[dist.distributorId]) || dist?.distributorId
                        return (
                          <tr key={receipt.id} className="border-b border-border/50 transition-colors hover:bg-muted/20">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <button
                                  className="text-left font-medium hover:text-primary hover:underline"
                                  onClick={() => item && openDetail(item)}
                                >
                                  {item?.name ?? t(($) => $.manager.unknownItem)}
                                </button>
                                {isUnread && <span className="size-2 shrink-0 rounded-full bg-primary" />}
                              </div>
                              {dist?.message && (
                                <div className="mt-0.5 truncate text-xs text-muted-foreground">{dist.message}</div>
                              )}
                            </td>
                            <td className="max-w-[14rem] px-4 py-3">
                              <span className="line-clamp-2 text-muted-foreground">{item?.description ?? "—"}</span>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{item ? t(($) => $.home.typeTab[item.itemType as "skill" | "subagent" | "command" | "mcp" | "plugin"]) : "—"}</td>
                            <td className="px-4 py-3 text-muted-foreground">{distributorName ?? "—"}</td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                {t(($) => dist?.permissionMode === "readonly" ? $.manager.permissionReadonly : $.manager.permissionDismissible)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {t(($) => isUnread ? $.manager.statusUnread : $.manager.statusRead)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                {isUnread && (
                                  <button
                                    className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
                                    onClick={() => markReadMutation.mutate(receipt.distributionId)}
                                    title={t(($) => $.manager.markRead)}
                                  >
                                    {t(($) => $.manager.markRead)}
                                  </button>
                                )}
                                {canDismiss && (
                                  <button
                                    className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
                                    onClick={() => dismissMutation.mutate(receipt.distributionId)}
                                    title={t(($) => $.manager.dismiss)}
                                  >
                                    {t(($) => $.manager.dismiss)}
                                  </button>
                                )}
                                <button
                                  className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
                                  onClick={() => forkMutation.mutate(receipt.distributionId)}
                                  title={t(($) => $.manager.fork)}
                                >
                                  {t(($) => $.manager.fork)}
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Sent tab */}
              {tab === "sent" && !isEmpty && (
                <div className="min-h-0 flex-1 overflow-auto rounded-[0.875rem] border border-border">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colName)}</th>
                        <th className="w-[14rem] px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colDesc)}</th>
                        <th className="w-[8rem] px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colType)}</th>
                        <th className="w-[10rem] px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colScope)}</th>
                        <th className="w-[10rem] px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colPermission)}</th>
                        <th className="w-[8rem] px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colStatus)}</th>
                        <th className="w-[6rem] px-4 py-3 text-right font-semibold text-foreground">{t(($) => $.manager.colAction)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDistributions.map((dist) => {
                        const item = dist.distribution.item
                        const isActive = dist.distribution.status === "active"
                        return (
                          <tr key={dist.distribution.id} className="border-b border-border/50 transition-colors hover:bg-muted/20">
                            <td className="px-4 py-3">
                              <button
                                className="text-left font-medium hover:text-primary hover:underline"
                                onClick={() => item && openDetail(item)}
                              >
                                {item?.name ?? t(($) => $.manager.unknownItem)}
                              </button>
                            </td>
                            <td className="max-w-[14rem] px-4 py-3">
                              <span className="line-clamp-2 text-muted-foreground">{item?.description ?? "—"}</span>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{item ? t(($) => $.home.typeTab[item.itemType as "skill" | "subagent" | "command" | "mcp" | "plugin"]) : "—"}</td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {dist.distribution.scopeType === "department"
                                ? t(($) => $.manager.scopeDepartment)
                                : t(($) => $.manager.scopeUser)}: {dist.distribution.targetId}
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                {t(($) => dist.distribution.permissionMode === "readonly" ? $.manager.permissionReadonly : $.manager.permissionDismissible)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {t(($) => dist.distribution.status === "active" ? $.manager.statusActive : dist.distribution.status === "paused" ? $.manager.statusPaused : $.manager.statusRevoked)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {isActive && (
                                <button
                                  className="rounded-md px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
                                  onClick={() => {
                                    setDeleteDialog({
                                      open: true,
                                      id: null,
                                      ids: [],
                                      batch: false,
                                      desc: t(($) => $.manager.revokeConfirm),
                                    })
                                    revokeTargetRef.current = dist.distribution.id
                                  }}
                                  title={t(($) => $.manager.revoke)}
                                >
                                  {t(($) => $.manager.revoke)}
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Created / Favorited tab */}
              {isItemTab && !isEmpty && (
                <HubManagerListView
                  items={items}
                  selected={selected}
                  allMatching={allMatching}
                  onToggleRow={toggleRow}
                  onTogglePage={togglePage}
                  onItemClick={openDetail}
                  onFav={handleFav}
                  onEdit={(item) => setEditItem(item)}
                  onDelete={(id) => setDeleteDialog({ open: true, id, ids: [], batch: false, desc: t(($) => $.manager.confirmDelete) })}
                  searchQuery={debounced}
                  total={itemTotal}
                />
              )}
            </div>

            {/* Pagination — item tabs only */}
            {isItemTab && (
              <div className="px-4 pb-4 pt-2">
                <PaginationBar
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={itemTotal}
                  onPageChange={handlePage}
                />
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Detail sheet */}
      <Sheet open={detailItemId != null} onOpenChange={(open) => { if (!open) setDetailItemId(null) }} modal={false}>
        <SheetContent className="w-[min(68rem,94vw)] overflow-y-auto data-[side=right]:w-[min(68rem,94vw)] data-[side=right]:sm:max-w-none">
          <SheetHeader className="sr-only">
            <SheetTitle>{t(($) => $.detail.preview)}</SheetTitle>
            <SheetDescription>{t(($) => $.detail.preview)}</SheetDescription>
          </SheetHeader>
          {detailReady && detailItemId && (
            <ItemDetailContent
              itemId={detailItemId}
              onDeleted={() => {
                setDetailItemId(null)
                qc.invalidateQueries({ queryKey: ["hub"] })
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Dialogs */}
      <UploadPluginDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onCreated={() => {
          setUploadOpen(false)
          qc.invalidateQueries({ queryKey: ["hub"] })
        }}
      />

      {editItem && (
        <EditCapabilityDialog
          item={editItem}
          open={!!editItem}
          onUpdated={() => {
            setEditItem(null)
            qc.invalidateQueries({ queryKey: ["hub"] })
          }}
          onOpenChange={(open) => { if (!open) setEditItem(null) }}
        />
      )}

      {distDialog.item && (
        <DistributeDialog
          item={distDialog.item}
          open={distDialog.open}
          onCreated={() => {
            setDistDialog({ item: null, open: false })
            qc.invalidateQueries({ queryKey: ["hub"] })
          }}
          onOpenChange={(open) => setDistDialog((prev) => ({ ...prev, open }))}
        />
      )}

      <ConfirmDialog
        open={deleteDialog.open}
        onOpenChange={(open) => { if (!open) setDeleteDialog({ open: false, id: null, ids: [], batch: false, desc: "" }) }}
        title={deleteDialog.batch ? t(($) => $.manager.batchDeleteTitle) : t(($) => $.manager.deleteTitle)}
        description={deleteDialog.desc}
        confirmLabel={deleteDialog.batch ? t(($) => $.manager.batchDelete) : t(($) => $.manager.delete)}
        variant="danger"
        onConfirm={async () => {
          if (deleteDialog.batch) {
            await batchDeleteMutation.mutateAsync(deleteDialog.ids)
          } else if (revokeTargetRef.current && !deleteDialog.id) {
            await revokeMutation.mutateAsync(revokeTargetRef.current)
            revokeTargetRef.current = null
            setDeleteDialog({ open: false, id: null, ids: [], batch: false, desc: "" })
          } else if (deleteDialog.id) {
            await deleteMutation.mutateAsync(deleteDialog.id)
            setDeleteDialog({ open: false, id: null, ids: [], batch: false, desc: "" })
          }
        }}
      />
    </HubLayout>
  )
}

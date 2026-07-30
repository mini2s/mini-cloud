"use client"

import { useState, useCallback, useRef, useMemo, useEffect } from "react"
import { useNavigation } from "../../navigation"
import { useWorkspacePaths } from "@multica/core/paths"
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
  useHubMyItems,
  useHubFavoriteMutation,
  useHubUnfavoriteMutation,
  useHubMyReceivedDistributions,
  useHubMySentDistributions,
  useHubDistributionAuthority,
  useHubFilterOptions,
  useHubManagerTabCounts,
  useHubLogBehaviorMutation,
  HUB_ITEM_TYPES,
} from "@multica/core/hub"
import type { FilterGroup } from "./hub-filter-bar"
import type {
  CapabilityItem,
  HubItemListParams,
} from "@multica/core/types/hub"
import { ItemDetailContent } from "./item-detail-content"
import { HubFilterBar } from "./hub-filter-bar"
import { HubManagerListView } from "./hub-manager-list-view"
import { CreateCapabilityDialog } from "./create-capability-dialog"
import { DistributeDialog } from "./distribute-dialog"
import { CreateDistributionDialog } from "./create-distribution-dialog"
import HubLayout from "./hub-layout"
import { PageHeader } from "../../layout/page-header"
import { PaginationBar } from "./pagination-bar"
import { ConfirmDialog } from "./confirm-dialog"
import { SearchTokenBox } from "./search-token-box"
import { formatCompact } from "../lib/format"
import { ChevronLeft, Share2, CloudUpload, Trash2, FileCode2, Package, Star, Inbox, Send, Eye, X } from "lucide-react"
import type { LucideIcon } from "lucide-react"

const PAGE_SIZE = 10 as const
const MAX_BATCH_DELETE = 200

type TabKey = "created" | "favorited" | "received" | "sent"

interface SidebarNavItem {
  key: TabKey
  icon: LucideIcon
}

// SD-06: lucide icons only — emoji were a leftover from the source project.
const SIDEBAR_NAV: SidebarNavItem[] = [
  { key: "created", icon: Package },
  { key: "favorited", icon: Star },
  { key: "received", icon: Inbox },
  { key: "sent", icon: Send },
]

function mkGroup(
  applied: string[],
  toggle: (v: string) => void,
  reset: () => void,
  options: FilterGroup["options"] = [],
): FilterGroup {
  return { options, appliedValues: applied, toggle, reset }
}

export function HubManager() {
  const { t, i18n } = useT("hub")
  const navigation = useNavigation()
  const paths = useWorkspacePaths()
  const searchParams = navigation.searchParams
  const qc = useQueryClient()
  const { data: filterOpts } = useHubFilterOptions()
  const revokeTargetRef = useRef<string | null>(null)

  // Current locale for resolving localized filter-option names (categories /
  // risk groups carry a names map keyed by locale).
  const locale = i18n.language?.startsWith("zh") ? "zh" : "en"

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
  // "我创建的" 走 /api/items/my（后端按会话 token 识别用户），不能用公开的
  // /api/items + createdBy:"me"（后端不认 "me"，会返回全站数据）。
  const createdQuery = useHubMyItems(listParams)
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

  // ── Tab badge counts (M-01) ─────────────────────────────────────────────
  // 我创建的 = hubListItems({ createdBy: "me", pageSize: 1 }).total and
  // 我订阅的 = favorites list total — both filter-independent dedicated count
  // queries that refresh via items-namespace invalidation. 收到的分发 =
  // unread receipts; 发出的分发 / 我的仓库 = list lengths.
  const { createdCount, favoritedCount } = useHubManagerTabCounts()
  const unreadCount = useMemo(
    () => receipts.filter((r) => r.receiptStatus === "unread").length,
    [receipts],
  )

  const tabCount = useCallback((key: TabKey): number => {
    switch (key) {
      case "created": return createdCount
      case "favorited": return favoritedCount
      case "received": return unreadCount
      case "sent": return distributions.length
    }
  }, [createdCount, favoritedCount, unreadCount, distributions.length])

  // ── Detail sheet + view tracking (FR-10, via the core/hub mutation) ─────
  const [detailItemId, setDetailItemId] = useState<string | null>(null)
  const trackedIdRef = useRef<string | null>(null)
  const logBehavior = useHubLogBehaviorMutation()

  useEffect(() => {
    if (!detailItemId || trackedIdRef.current === detailItemId) return
    trackedIdRef.current = detailItemId
    logBehavior.mutate({
      id: detailItemId,
      actionType: "view",
      context: "manager",
      metadata: { route: "hub-manager" },
    })
  }, [detailItemId, logBehavior])

  useEffect(() => {
    if (!detailItemId) trackedIdRef.current = null
  }, [detailItemId])

  const openDetail = useCallback((item: CapabilityItem) => {
    setDetailItemId(item.id)
  }, [])

  const detailReady = detailItemId != null

  // ── Selection (batch) ───────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [allMatching, setAllMatching] = useState(false)

  const clearSel = useCallback(() => {
    setSelected(new Set())
    setAllMatching(false)
  }, [])

  const switchTab = useCallback((next: TabKey) => {
    if (next === tab) return
    setDetailItemId(null)
    clearSel()
    setTab(next)
  }, [tab, clearSel])

  useEffect(() => {
    const p = new URLSearchParams(searchParams.toString())
    p.set("tab", tab)
    navigation.replace(`${navigation.pathname}?${p.toString()}`)
  }, [tab, navigation, searchParams])

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
      setDeleteDialog({ open: false, id: null, ids: [], batch: false, isRevoke: false, desc: "" })
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
    isRevoke: boolean
    desc: string
  }>({ open: false, id: null, ids: [], batch: false, isRevoke: false, desc: "" })

  const startBatchDelete = useCallback(async () => {
    let ids: string[]
    if (allMatching) {
      const res = await api.hubListMyItems({ ...listParams, page: 1, pageSize: MAX_BATCH_DELETE })
      ids = res.items.map((i) => i.id)
      const capped = itemTotal > MAX_BATCH_DELETE
      let desc = t(($) => $.manager.confirmBatchDelete, { count: ids.length })
      if (capped) {
        desc += " " + t(($) => $.manager.batchCapped, { total: itemTotal, max: MAX_BATCH_DELETE })
      }
      setDeleteDialog({ open: true, id: null, ids, batch: true, isRevoke: false, desc })
    } else {
      ids = Array.from(selected)
      if (ids.length === 0) return
      setDeleteDialog({ open: true, id: null, ids, batch: true, isRevoke: false, desc: t(($) => $.manager.confirmBatchDelete, { count: ids.length }) })
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
  const { canDistribute, departments: authorityDepartments } = useHubDistributionAuthority()

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

  // ── Sent target name resolution (sent tab) ──────────────────────────────
  // Department targets resolve against the authority tree; user targets use the
  // same name lookup as the received tab. Raw targetId is the fallback.
  const sentUserTargetIds = useMemo(() => {
    if (tab !== "sent") return []
    const ids = new Set<string>()
    for (const d of distributions) {
      if (d.distribution.scopeType === "user") ids.add(d.distribution.targetId)
    }
    return [...ids]
  }, [tab, distributions])

  const { data: sentUserNames } = useQuery({
    queryKey: ["hub", "user-names", sentUserTargetIds],
    queryFn: () => api.hubGetUserNames(sentUserTargetIds),
    enabled: sentUserTargetIds.length > 0,
    staleTime: 10 * 60 * 1000,
  })

  const deptNameMap = useMemo(() => {
    const map = new Map<string, string>()
    const walk = (nodes: { id: string; name: string; children?: any[] }[]) => {
      for (const n of nodes) {
        map.set(n.id, n.name)
        if (n.children?.length) walk(n.children)
      }
    }
    walk(authorityDepartments as any)
    return map
  }, [authorityDepartments])

  const sentTargetLabel = useCallback(
    (d: { scopeType: string; targetId: string }) => {
      if (d.scopeType === "department") {
        return deptNameMap.get(d.targetId) ?? d.targetId
      }
      return (d.targetId && sentUserNames?.[d.targetId]) || d.targetId
    },
    [deptNameMap, sentUserNames],
  )

  // ── Dialogs ─────────────────────────────────────────────────────────────
  const [uploadOpen, setUploadOpen] = useState(false)
  const [distDialog, setDistDialog] = useState<{
    item: CapabilityItem | null
    open: boolean
  }>({ item: null, open: false })
  const [createDistOpen, setCreateDistOpen] = useState(false)

  // ── Render helpers ──────────────────────────────────────────────────────
  const tagSuggestions = useMemo(() => {
    return (filterOpts?.tags ?? []).map((tag) => ({ id: tag.id ?? tag.slug, label: tag.slug }))
  }, [])

  // Filter-bar dropdown options, derived from filterOpts. The source page built
  // these from the same data; here they're memoized so a re-render doesn't drop
  // them. Categories/risk-groups carry a localized names map; sources/tags use
  // a plain label/slug. Type options are the fixed set of hub item types.
  const typeOptions = useMemo(
    () =>
      HUB_ITEM_TYPES.map((type) => ({
        value: type,
        label: t(($) => $.home.typeTab[type]),
      })),
    [t],
  )
  const filterOptionLists = useMemo(() => {
    const cats = filterOpts?.categories ?? []
    const risks = filterOpts?.securityRiskGroups ?? []
    const sources = filterOpts?.sources ?? []
    const tags = filterOpts?.tags ?? []
    const pickName = (names: Record<string, string> | undefined) =>
      names?.[locale] ?? names?.["en"] ?? names?.["zh"] ?? ""
    return {
      category: cats.map((c) => ({ value: c.slug, label: pickName(c.names) || c.slug })),
      security: risks.map((r) => ({ value: r.value, label: pickName(r.names) || r.value })),
      source: sources.map((s) => ({ value: s.value, label: s.label || s.value })),
      tag: tags.map((tag) => ({ value: tag.slug, label: tag.slug })),
    }
  }, [filterOpts, locale])

  const categoryLabel = useCallback(
    (slug: string) => {
      const cat = (filterOpts?.categories ?? []).find((c) => c.slug === slug)
      if (!cat?.names) return ""
      return cat.names["zh-Hans"] ?? cat.names["en"] ?? cat.names["zh"] ?? ""
    },
    [filterOpts],
  )

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
              <item.icon size={16} className="shrink-0" />
              <span className="flex-1">{t(($) => $.manager.tabs[item.key])}</span>
              {count > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums">
                  {formatCompact(count)}
                </span>
              )}
            </button>
          )
        })}
      </nav>
    </aside>
  )

  const managerTitle = useMemo(() => {
    if (tab === "received") return t(($) => $.manager.titleReceived)
    if (tab === "sent") return t(($) => $.manager.titleSent)
    return t(($) => $.manager.title)
  }, [tab, t])

  const managerDescription = useMemo(() => {
    if (tab === "received") return t(($) => $.manager.descReceived)
    if (tab === "sent") return t(($) => $.manager.descSent)
    return t(($) => $.manager.desc)
  }, [tab, t])

  // SD-08: header shares the dashboard-wide PageHeader (h-12, border-b) so the
  // manager page title/action hierarchy matches every other dashboard page.
  const renderToolbar = (
    <PageHeader>
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold">{managerTitle}</h1>
        <p className="truncate text-xs text-muted-foreground">{managerDescription}</p>
      </div>
        <div className="ml-auto flex shrink-0 items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" className="h-8 cursor-pointer px-3" onClick={() => navigation.push(paths.hub())}>
            <ChevronLeft size={16} />
            {t(($) => $.manager.backToHub)}
          </Button>
          <>
          <CreateCapabilityDialog onCreated={() => qc.invalidateQueries({ queryKey: ["hub"] })} />
          <Button type="button" variant="outline" size="sm" className="h-8 cursor-pointer px-3" onClick={() => navigation.push(paths.hubEditor())}>
            <FileCode2 size={14} />
            {t(($) => $.manager.full_editor)}
          </Button>
          <Button type="button" variant="default" size="sm" className="h-8 cursor-pointer px-3" onClick={() => setUploadOpen(true)}>
            <CloudUpload size={14} />
            {t(($) => $.manager.upload)}
          </Button>
          {/* "上传 Plugin" opens the same create-capability form preset to plugin,
              matching the source store (the standalone UploadPluginDialog was removed
              in PR #112 there). */}
          <CreateCapabilityDialog
            defaultItemType="plugin"
            open={uploadOpen}
            onOpenChange={setUploadOpen}
            onCreated={() => qc.invalidateQueries({ queryKey: ["hub"] })}
          />
          {canDistribute && isItemTab && (
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
          {canDistribute && tab === "sent" && (
            <Button
              type="button"
              variant="default"
              size="sm"
              className="h-8 cursor-pointer px-3"
              onClick={() => setCreateDistOpen(true)}
            >
              <Share2 size={14} />
              {t(($) => $.dialog.distribute.new_label)}
            </Button>
          )}
            </>
        </div>
    </PageHeader>
  )

  const isLoadingView = isItemTab ? itemLoading : (tab === "received" ? receivedQuery.isLoading : sentQuery.isLoading)
  const isEmpty = isItemTab ? (!itemLoading && items.length === 0) : (tab === "received" ? filteredReceipts.length === 0 : filteredDistributions.length === 0)
  const isErrorView = !isItemTab && (tab === "received" ? receivedQuery.isError : sentQuery.isError)
  const retryFetch = tab === "received" ? receivedQuery.refetch : sentQuery.refetch

  return (
    <HubLayout>
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
        {renderToolbar}
        <div className="flex min-h-0 flex-1">
          {renderSidebar}
          <section className="flex min-h-0 flex-1 flex-col px-2 sm:px-3">
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
              <div className="mx-auto mb-2.5 w-full max-w-5xl px-4">
                <HubFilterBar
                  type={mkGroup(typeFilter, (v) => toggleFilter(typeFilter, setTypeFilter, v), () => setTypeFilter([]), typeOptions)}
                  category={mkGroup(catFilter, (v) => toggleFilter(catFilter, setCatFilter, v), () => setCatFilter([]), filterOptionLists.category)}
                  security={mkGroup(secFilter, (v) => toggleFilter(secFilter, setSecFilter, v), () => setSecFilter([]), filterOptionLists.security)}
                  source={mkGroup(srcFilter, (v) => toggleFilter(srcFilter, setSrcFilter, v), () => setSrcFilter([]), filterOptionLists.source)}
                  tag={mkGroup(tagFilter, (v) => toggleFilter(tagFilter, setTagFilter, v), () => setTagFilter([]), filterOptionLists.tag)}
                  totalItems={itemTotal}
                  onClearAll={clearFilters}
                />
              </div>
            )}

            {/* Selection bar — created tab only */}
            {tab === "created" && selected.size > 0 && (
              <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-4 pb-2">
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
                  onFav={tab === "created" ? handleFav : undefined}
                  onEdit={tab === "created" ? (item) => navigation.push(paths.hubEditorItem(item.id)) : undefined}
                  onOpenInEditor={undefined}
                  onDelete={tab === "created" ? (id) => setDeleteDialog({ open: true, id, ids: [], batch: false, isRevoke: false, desc: t(($) => $.manager.confirmDelete) }) : undefined}
                  selectable={tab === "created"}
                  searchQuery={debounced}
                  categoryLabel={categoryLabel}
                  total={itemTotal}
                />
              )}

              {!isLoadingView && isEmpty && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <p className="mb-1 text-[15px] font-medium text-muted-foreground">
                    {t(($) => tab === "created" ? $.manager.emptyCreated : tab === "favorited" ? $.manager.emptyFavorited : tab === "received" ? $.manager.emptyReceived : $.manager.emptySent)}
                  </p>
                  {(tab === "received" || tab === "sent") && (
                    <p className="text-sm text-muted-foreground/75">
                      {t(($) => tab === "received" ? $.manager.emptyReceivedHint : $.manager.emptySentHint)}
                    </p>
                  )}
                </div>
              )}

              {/* Error state — received/sent tabs */}
              {isErrorView && (
                <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                  <p className="text-sm font-semibold text-destructive">{t(($) => $.manager.loadFailed)}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => retryFetch()}>
                    {t(($) => $.home.error.retry)}
                  </Button>
                </div>
              )}

              {/* Received tab */}
              {tab === "received" && !isErrorView && !isEmpty && (
                <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colName)}</th>
                        <th className="w-56 px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colDesc)}</th>
                        <th className="w-32 px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colType)}</th>
                        <th className="w-40 px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colFrom)}</th>
                        <th className="w-40 px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colPermission)}</th>
                        <th className="w-32 px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colStatus)}</th>
                        <th className="w-48 px-4 py-3 text-right font-semibold text-foreground">{t(($) => $.manager.colAction)}</th>
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
                            <td className="max-w-56 px-4 py-3">
                              <span className="line-clamp-2 text-muted-foreground">{item?.description ?? "—"}</span>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{item ? t(($) => $.home.typeTab[item.itemType as "skill" | "subagent" | "command" | "mcp" | "plugin"]) : "—"}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-px">
                                <span className="truncate text-sm text-foreground">{distributorName ?? "—"}</span>
                                {dist?.distributorId && (
                                  <span className="truncate text-[11px] text-muted-foreground">{dist.distributorId}</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                {t(($) => dist?.permissionMode === "readonly" ? $.manager.permissionReadonly : $.manager.permissionDismissible)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {t(($) => dist?.status === "paused" ? $.manager.statusPaused : dist?.status === "revoked" ? $.manager.statusRevoked : $.manager.statusActive)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                {isUnread && (
                                  <button
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
                                    disabled={markReadMutation.isPending}
                                    onClick={() => markReadMutation.mutate(receipt.distributionId)}
                                    title={t(($) => $.manager.markRead)}
                                  >
                                    <Eye size={16} />
                                  </button>
                                )}
                                {canDismiss && (
                                  <button
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                                    disabled={dismissMutation.isPending}
                                    onClick={() => dismissMutation.mutate(receipt.distributionId)}
                                    title={t(($) => $.manager.dismiss)}
                                  >
                                    <X size={16} />
                                  </button>
                                )}
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
              {tab === "sent" && !isErrorView && !isEmpty && (
                <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colName)}</th>
                        <th className="w-56 px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colDesc)}</th>
                        <th className="w-32 px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colType)}</th>
                        <th className="w-40 px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colScope)}</th>
                        <th className="w-40 px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colPermission)}</th>
                        <th className="w-32 px-4 py-3 font-semibold text-foreground">{t(($) => $.manager.colStatus)}</th>
                        <th className="w-24 px-4 py-3 text-right font-semibold text-foreground">{t(($) => $.manager.colAction)}</th>
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
                              {dist.distribution.message && (
                                <div className="mt-0.5 truncate text-xs text-muted-foreground">{dist.distribution.message}</div>
                              )}
                            </td>
                            <td className="max-w-56 px-4 py-3">
                              <span className="line-clamp-2 text-muted-foreground">{item?.description ?? "—"}</span>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{item ? t(($) => $.home.typeTab[item.itemType as "skill" | "subagent" | "command" | "mcp" | "plugin"]) : "—"}</td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {dist.distribution.scopeType === "department"
                                ? t(($) => $.manager.scopeDepartment)
                                : t(($) => $.manager.scopeUser)}: {sentTargetLabel(dist.distribution)}
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
                                      isRevoke: true,
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
                  onFav={tab === "created" ? handleFav : undefined}
                  onEdit={tab === "created" ? (item) => navigation.push(paths.hubEditorItem(item.id)) : undefined}
                  onOpenInEditor={undefined}
                  onDelete={tab === "created" ? (id) => setDeleteDialog({ open: true, id, ids: [], batch: false, isRevoke: false, desc: t(($) => $.manager.confirmDelete) }) : undefined}
                  selectable={tab === "created"}
                  searchQuery={debounced}
                  categoryLabel={categoryLabel}
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
        <SheetContent className="w-screen overflow-y-auto data-[side=right]:w-screen data-[side=right]:sm:w-[min(68rem,94vw)] data-[side=right]:sm:max-w-none">
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

      <CreateDistributionDialog
        open={createDistOpen}
        onOpenChange={setCreateDistOpen}
        onCreated={() => {
          setCreateDistOpen(false)
          qc.invalidateQueries({ queryKey: ["hub"] })
        }}
      />

      <ConfirmDialog
        open={deleteDialog.open}
        onOpenChange={(open) => { if (!open) setDeleteDialog({ open: false, id: null, ids: [], batch: false, isRevoke: false, desc: "" }) }}
        title={deleteDialog.isRevoke ? t(($) => $.manager.revokeTitle) : deleteDialog.batch ? t(($) => $.manager.batchDeleteTitle) : t(($) => $.manager.deleteTitle)}
        description={deleteDialog.desc}
        confirmLabel={deleteDialog.isRevoke ? t(($) => $.manager.revoke) : deleteDialog.batch ? t(($) => $.manager.batchDelete) : t(($) => $.manager.delete)}
        variant="danger"
        onConfirm={async () => {
          if (deleteDialog.batch) {
            await batchDeleteMutation.mutateAsync(deleteDialog.ids)
          } else if (revokeTargetRef.current && !deleteDialog.id) {
            await revokeMutation.mutateAsync(revokeTargetRef.current)
            revokeTargetRef.current = null
            setDeleteDialog({ open: false, id: null, ids: [], batch: false, isRevoke: false, desc: "" })
          } else if (deleteDialog.id) {
            await deleteMutation.mutateAsync(deleteDialog.id)
            setDeleteDialog({ open: false, id: null, ids: [], batch: false, isRevoke: false, desc: "" })
          }
        }}
      />
    </HubLayout>
  )
}

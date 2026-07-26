"use client"

import { useState, useCallback, useMemo, useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Star,
  Trash2,
  Calendar,
  Shield,
  ExternalLink,
  GitFork,
  Eye,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  Zap,
  Bot,
  Terminal,
  Puzzle,
  FileText,
  Blocks,
  Check,
  Link,
  ChevronLeft,
  Copy,
  Send,
  Download,
} from "lucide-react"
import { Button } from "@multica/ui/components/ui/button"
import { Badge } from "@multica/ui/components/ui/badge"
import { Separator } from "@multica/ui/components/ui/separator"
import { Skeleton } from "@multica/ui/components/ui/skeleton"
import { useT } from "@multica/views/i18n"
import { toast } from "sonner"
import { api } from "@multica/core/api"
import type { CapabilityItem, CapabilityVersion, ItemTag } from "@multica/core/types"
import FromPluginBadge from "./from-plugin-badge"
import HealthRadar from "./health-radar"
import { SubItemTree } from "./sub-item-tree"
import type { VirtualTreeNode } from "./sub-item-tree"
import { SubscribeButton } from "./subscribe-button"
import { McpConfigForm } from "./mcp-config-form"
import { ConfirmDialog } from "./confirm-dialog"
import { ShareButton } from "./share-button"
import { ScanResults } from "./scan-results"
import { ArtifactList } from "./artifact-list"
import { BuiltinContentDialog } from "./builtin-content-dialog"
import {
  useHubItemDetail,
  useHubFavoriteStatus,
  useHubFavoriteMutation,
  useHubUnfavoriteMutation,
  useHubDistributionAuthority,
  useHubLogBehaviorMutation,
} from "@multica/core/hub"
import { DistributeDialog } from "./distribute-dialog"
import { getInstallCommand } from "../lib/install-command"
import { formatCompact } from "../lib/format"
import { typeKey } from "../lib/constants"
import { TYPE_COLORS } from "../lib/type-colors"
import { pickItemDescription } from "../lib/item-description"
import { matchEnterprise, matchEnterpriseByName, type EnterpriseInfo } from "../lib/enterprise"
import { useLogoColor } from "../lib/use-logo-color"

// ── Helpers ─────────────────────────────────────────────────────────────────

const EVAL_SIGNALS = [
  "coding_relevance",
  "doc_completeness",
  "desc_accuracy",
  "writing_quality",
  "specificity",
  "install_clarity",
] as const

const EVAL_WEIGHTS: Record<string, number> = {
  coding_relevance: 0.25,
  doc_completeness: 0.2,
  desc_accuracy: 0.15,
  writing_quality: 0.15,
  specificity: 0.15,
  install_clarity: 0.1,
}

function contentQuality(evaluation: NonNullable<CapabilityItem["evaluation"]>): number | null {
  let ws = 0
  let wv = 0
  for (const dim of EVAL_SIGNALS) {
    const val = evaluation[dim]
    if (val == null) continue
    const w = EVAL_WEIGHTS[dim]
    if (w == null) continue
    ws += w
    wv += (val / 5) * 100 * w
  }
  if (ws === 0) return null
  return Math.round(wv / ws)
}

function hasHealth(s?: CapabilityItem["health"]) {
  const sig = s?.signals
  return !!sig && (sig.freshness != null || sig.popularity != null || sig.source_trust != null)
}

function hasEval(e?: CapabilityItem["evaluation"]) {
  if (!e) return false
  return (
    (e.final_score != null && e.final_score > 0) ||
    EVAL_SIGNALS.some((dim) => e[dim] != null)
  )
}

const FIELD_LABEL = "text-xs font-bold text-muted-foreground/70"

function fmtDate(iso: string) {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d)
}

function compareTags(a: ItemTag, b: ItemTag) {
  const ap = a.tagClass === "system" ? 0 : 1
  const bp = b.tagClass === "system" ? 0 : 1
  if (ap !== bp) return ap - bp
  return a.slug.localeCompare(b.slug)
}

// SD-09: was "#E5B645" — now the semantic --warning token (theme-aware).
const ENTERPRISE_GOLD = "var(--warning)"

// ── Type meta lookup ────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, typeof Zap> = {
  skill: Zap,
  subagent: Bot,
  command: Terminal,
  mcp: Puzzle,
  rule: Shield,
  template: FileText,
  plugin: Blocks,
}

function typeMeta(t?: string) {
  const type = t ?? "skill"
  const Icon = TYPE_ICONS[type] ?? Zap
  const color = TYPE_COLORS[type] ?? "var(--warning)"
  return { Icon, color }
}

// ── Props ───────────────────────────────────────────────────────────────────

export interface ItemDetailContentProps {
  itemId: string
  className?: string
  showBackButton?: boolean
  onBack?: () => void
  onDeleted?: () => void
  onFavoriteChanged?: (item: CapabilityItem) => void
  onFav?: (item: CapabilityItem) => void
  /** When true, scroll the MCP config form into view once the item loads
   *  (used when the detail was opened from a blocked MCP subscribe click). */
  autoFocusMcpConfig?: boolean
}

// ── Component ───────────────────────────────────────────────────────────────

export function ItemDetailContent({
  itemId,
  className,
  showBackButton,
  onBack,
  onDeleted,
  onFavoriteChanged,
  autoFocusMcpConfig,
}: ItemDetailContentProps) {
  const { t } = useT("hub")

  // Data fetching
  const { data: item, isLoading, isError, refetch } = useHubItemDetail(itemId)
  const { data: fav } = useHubFavoriteStatus(itemId)
  const favMut = useHubFavoriteMutation()
  const unfavMut = useHubUnfavoriteMutation()

  // Sub-items (for plugins)
  const { data: subItems } = useQuery<VirtualTreeNode[]>({
    queryKey: ["hub", "sub-items", itemId],
    queryFn: async () => {
      const res = await api.hubListItems({ parentPluginId: itemId, pageSize: 100 })
      return (res.items ?? []).map((sub: CapabilityItem) => ({
        path: sub.id,
        name: sub.name,
        kind: "file" as const,
      }))
    },
    enabled: item?.itemType === "plugin",
  })

  // Enterprise branding
  const enterprise = useMemo<EnterpriseInfo | null>(() => {
    if (!item) return null
    return matchEnterprise(item.createdBy) ?? matchEnterpriseByName(item.name)
  }, [item])
  // FR-07: brand color extracted from the enterprise logo (cached per logo);
  // falls back to `var(--card)` when there is no logo or extraction fails, so
  // the header `color-mix` expressions degrade to the plain card color.
  const brandColor = useLogoColor(enterprise?.logo)

  // State
  // State
  const [delOpen, setDelOpen] = useState(false)
  const [, setDelLoading] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [cmdCopied, setCmdCopied] = useState(false)
  const [distOpen, setDistOpen] = useState(false)
  const [builtinOpen, setBuiltinOpen] = useState(false)
  const [builtinToggling, setBuiltinToggling] = useState(false)

  // Distribute entry gating (D-17): hidden entirely when the caller has no
  // distribution reach.
  const { canDistribute } = useHubDistributionAuthority()
  const { color: typeColor } = typeMeta(item?.itemType)
  const desc = item ? pickItemDescription(item, "en") : ""

  const actualFav = fav ?? { favorited: false, favoriteCount: 0 }
  const mcpConfig = item?.mcpConfig
  const mcpMetadata = item?.metadata as Record<string, unknown> | undefined

  // Favorites toggle
  const toggleFav = useCallback(() => {
    if (!item) return
    const mutate = actualFav.favorited ? unfavMut : favMut
    mutate.mutate(itemId, {
      onSuccess: () => onFavoriteChanged?.(item),
    })
  }, [item, itemId, actualFav.favorited, favMut, unfavMut, onFavoriteChanged])

  // F-09: subscribing an unconfigured MCP is blocked by SubscribeButton — guide
  // the user to the MCP config form by scrolling it into view and focusing the
  // first input.
  const mcpConfigRef = useRef<HTMLDivElement>(null)
  const focusMcpConfig = useCallback(() => {
    const el = mcpConfigRef.current
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    window.setTimeout(() => {
      el.querySelector("input")?.focus({ preventScroll: true })
    }, 350)
  }, [])

  // Auto-locate the MCP config form when the detail was opened from a blocked
  // subscribe click in the list (fires once per opening, after data arrives).
  const autoFocusDoneRef = useRef(false)
  useEffect(() => {
    if (!autoFocusMcpConfig) {
      autoFocusDoneRef.current = false
      return
    }
    if (autoFocusDoneRef.current || !mcpConfig) return
    autoFocusDoneRef.current = true
    focusMcpConfig()
  }, [autoFocusMcpConfig, mcpConfig, focusMcpConfig])

  // Behavior logging (FR-10): single mutation entry point from core/hub —
  // components only declare the action point, the wire format stays
  // centralized in the mutation.
  const logBehavior = useHubLogBehaviorMutation()

  // View behavior tracking (once per item)
  const trackedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!item || trackedRef.current === itemId) return
    trackedRef.current = itemId
    logBehavior.mutate({ id: itemId, actionType: "view", context: "detail" })
  }, [item, itemId, logBehavior])

  // Fork
  const [forking, setForking] = useState(false)
  const handleFork = useCallback(async () => {
    if (!item || forking) return
    setForking(true)
    try {
      await api.hubForkItem(itemId)
      toast.success(t(($) => $.detail.toast_favorited))
    } catch {
      // silent
    } finally {
      setForking(false)
    }
  }, [item, itemId, forking, t])

  // Install command — zip_download commands / plugin marketplace install,
  // matching the source store's getInstallCommand rules.
  const installCmd = useMemo(() => getInstallCommand(item), [item])

  // Preview behavior (FR-10 preview point): long content starts collapsed;
  // expanding the content preview logs a `preview` action once per item.
  const [contentExpanded, setContentExpanded] = useState(false)
  const previewTrackedRef = useRef<string | null>(null)
  useEffect(() => {
    setContentExpanded(false)
  }, [itemId])

  const isLongContent = useMemo(() => {
    const content = item?.content
    if (!content) return false
    return content.length > 600 || content.split("\n").length > 12
  }, [item])

  const expandContentPreview = useCallback(() => {
    setContentExpanded(true)
    if (previewTrackedRef.current === itemId) return
    previewTrackedRef.current = itemId
    logBehavior.mutate({ id: itemId, actionType: "preview", context: "content-preview" })
  }, [itemId, logBehavior])

  // Delete
  const handleDelete = useCallback(async () => {
    if (!item) return
    setDelLoading(true)
    try {
      await api.hubDeleteItem(itemId)
      setDelOpen(false)
      onDeleted?.()
    } catch (err) {
      throw err
    } finally {
      setDelLoading(false)
    }
  }, [item, itemId, onDeleted])

  // Copy item ID
  const copyId = useCallback(async () => {
    await navigator.clipboard.writeText(itemId)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [itemId])

  // Copy install command (+ install behavior log)
  const copyCmd = useCallback(async () => {
    if (!installCmd) return
    await navigator.clipboard.writeText(installCmd)
    setCmdCopied(true)
    setTimeout(() => setCmdCopied(false), 1500)
    logBehavior.mutate({ id: itemId, actionType: "install", context: "copy-install-command" })
  }, [installCmd, itemId, logBehavior])

  // Built-in toggle (source semantics: gated by distribution authority and
  // plugin type). Un-setting is a plain update; setting opens the markdown
  // upload dialog.
  const handleBuiltinToggle = useCallback(async () => {
    if (!item || builtinToggling) return
    if (!item.isBuiltIn) {
      setBuiltinOpen(true)
      return
    }
    setBuiltinToggling(true)
    try {
      await api.hubUpdateItem(itemId, { isBuiltIn: false })
      toast.success(t(($) => $.detail.unset_builtin_success))
      refetch()
    } catch (err) {
      toast.error(t(($) => $.detail.toggle_builtin_failed), {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBuiltinToggling(false)
    }
  }, [item, itemId, builtinToggling, refetch, t])

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64 rounded-lg bg-muted" />
        <Skeleton className="h-4 w-48 rounded bg-muted" />
        <Skeleton className="mt-4 h-40 w-full rounded-lg bg-muted" />
      </div>
    )
  }

  // Error state
  if (isError || !item) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16">
        <p className="text-destructive">{t(($) => $.home.error.detailFailed)}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          {t(($) => $.home.error.retry)}
        </Button>
      </div>
    )
  }

  const { Icon } = typeMeta(item.itemType)

  return (
    <div className={`flex h-full flex-col ${className ?? ""}`.trim()}>
      {/* Back button */}
      {showBackButton && onBack && (
        <div className="border-b px-6 py-2">
          <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
            <ChevronLeft className="h-4 w-4" />
            <span className="ml-1">{t(($) => $.manager.backToHub)}</span>
          </Button>
        </div>
      )}

      {/* ── Header ── */}
      <div
        className="relative overflow-hidden border-b px-6 pb-5 pr-14 pt-6"
        style={
          enterprise
            ? ({ "--hub-brand": brandColor } as React.CSSProperties)
            : undefined
        }
      >
        {enterprise && (
          <>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "linear-gradient(135deg, color-mix(in oklab, var(--hub-brand) 12%, transparent), transparent 46%)",
              }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-0.5"
              style={{
                background: `linear-gradient(90deg, color-mix(in oklab, ${ENTERPRISE_GOLD} 70%, transparent), transparent 40%, color-mix(in oklab, var(--hub-brand) 55%, transparent))`,
              }}
            />
            {enterprise.logo && (
              <img
                src={enterprise.logo}
                alt=""
                aria-hidden="true"
                className="pointer-events-none absolute right-[-30px] top-1/2 size-[168px] -translate-y-1/2 rounded-2xl object-contain opacity-[0.06]"
              />
            )}
          </>
        )}
        <div className="relative">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-6">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {/* Type / Enterprise icon */}
                {enterprise && enterprise.logo ? (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-card p-[5px] shadow-sm">
                    <img src={enterprise.logo} alt={enterprise.name} className="size-full object-contain" />
                  </div>
                ) : (
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `color-mix(in srgb, ${typeColor} 12%, transparent)`, color: typeColor }}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                )}

                <div className="min-w-0 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <h1 className="min-w-0 text-2xl font-bold tracking-tight text-foreground">
                    {item.name}
                  </h1>

                  {/* Enterprise seal */}
                  {enterprise && (
                    <span
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold"
                      style={{
                        borderColor: "color-mix(in oklab, var(--hub-brand) 35%, transparent)",
                        backgroundColor: "color-mix(in oklab, var(--hub-brand) 10%, var(--card))",
                        color: "var(--hub-brand)",
                      }}
                    >
                      {enterprise.name}
                      <CheckCircle className="h-3 w-3" />
                    </span>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex shrink-0 items-center gap-1.5 self-start">
                {item.sourceType === "archive" && (
                  <Badge variant="outline" className="text-xs text-blue-500">
                    <ExternalLink className="mr-1 h-3 w-3" />
                    {"Archived"}
                  </Badge>
                )}

                {/* Fork — public, non-archive, not own */}
                {item.repoVisibility !== "private" && item.sourceType !== "archive" && item.createdBy !== "system" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleFork}
                    disabled={forking}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <GitFork className="h-4 w-4" />
                    <span className="ml-1.5">{t(($) => $.detail.fork)}</span>
                  </Button>
                )}

                {onDeleted && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDelOpen(true)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="ml-1.5">{t(($) => $.detail.delete)}</span>
                  </Button>
                )}

                <SubscribeButton
                  item={item}
                  favorited={actualFav.favorited}
                  favoriteCount={actualFav.favoriteCount}
                  pending={favMut.isPending || unfavMut.isPending}
                  authenticated={true}
                  onToggle={toggleFav}
                  onSubscribeBlocked={focusMcpConfig}
                  labels={{
                    subscribe: t(($) => $.detail.favorite),
                    subscribed: t(($) => $.detail.unfavorite),
                    tooltip: "Toggle subscription",
                  }}
                />

                {/* Share (D-10) */}
                <ShareButton itemId={itemId} />

                {/* Built-in toggle (D-13) — source gating: distribution
                    authority + plugin type only */}
                {canDistribute && item.itemType === "plugin" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleBuiltinToggle}
                    disabled={builtinToggling}
                    className="text-muted-foreground hover:text-foreground"
                    title={
                      item.isBuiltIn
                        ? t(($) => $.detail.cancel_builtin)
                        : t(($) => $.detail.set_builtin)
                    }
                  >
                    <Star
                      className={`h-4 w-4 ${item.isBuiltIn ? "fill-current text-amber-500" : ""}`}
                    />
                    <span className="ml-1.5">
                      {item.isBuiltIn
                        ? t(($) => $.detail.cancel_builtin)
                        : t(($) => $.detail.set_builtin)}
                    </span>
                  </Button>
                )}

                {/* Distribute — only with distribution authority (D-17) */}
                {canDistribute && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDistOpen(true)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Send className="h-4 w-4" />
                    <span className="ml-1.5">{t(($) => $.detail.distribute)}</span>
                  </Button>
                )}
              </div>
            </div>

            {/* Plugin parent badge */}
            {item.parentPluginName && (
              <FromPluginBadge name={item.parentPluginName} />
            )}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(14rem,0.6fr)]">
          {/* ── Left Column ── */}
          <div className="min-w-0 space-y-5">
            {/* Description */}
            {desc && (
              <p className="text-sm leading-6 text-muted-foreground">{desc}</p>
            )}

            {/* Install command (plugins) */}
            {installCmd && (
              <div className="space-y-1.5">
                <span className={FIELD_LABEL}>{t(($) => $.detail.installCommand)}</span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-lg border bg-muted/50 px-3 py-2 font-mono text-sm text-foreground">
                    {installCmd}
                  </code>
                  <Button variant="outline" size="icon" onClick={copyCmd} className="h-9 w-9 shrink-0">
                    {cmdCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            )}

            {/* Health + Evaluation */}
            {(hasHealth(item.health) || hasEval(item.evaluation)) && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-4">
                  {/* Content quality */}
                  {item.evaluation && (item.evaluation.content_quality ?? contentQuality(item.evaluation)) != null && (
                    <div className="min-w-64 flex-1 rounded-lg border bg-muted/30 p-4">
                      <div className="mb-3 flex items-center justify-between gap-4">
                        <span className={FIELD_LABEL}>{"Content Quality"}</span>
                        <span className="inline-flex items-baseline gap-0.5 font-bold" style={{ color: typeColor }}>
                          <span className="text-lg">
                            {item.evaluation.content_quality ?? contentQuality(item.evaluation)}
                          </span>
                          <span className="text-[11px] font-semibold opacity-60">/100</span>
                        </span>
                      </div>
                      <div className="space-y-2.5">
                        {EVAL_SIGNALS.map((dim) => {
                          const val = item.evaluation![dim]
                          if (val == null) return null
                          return (
                            <div key={dim} className="flex items-center gap-3">
                              <span className="w-28 shrink-0 text-[11px] text-muted-foreground">
                                {dim.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                              </span>
                              <div className="flex flex-1 gap-1">
                                {[1, 2, 3, 4, 5].map((seg) => (
                                  <div
                                    key={seg}
                                    className="h-2 flex-1 rounded-full"
                                    style={{
                                      backgroundColor:
                                        seg <= val
                                          ? typeColor
                                          : `color-mix(in srgb, hsl(var(--muted-foreground)) 22%, transparent)`,
                                    }}
                                  />
                                ))}
                              </div>
                              <span className="w-4 text-right text-[11px] text-muted-foreground">{val}</span>
                            </div>
                          )
                        })}
                      </div>
                      {item.evaluation.evaluated_at && (
                        <p className="mt-3 text-[11px] text-muted-foreground">
                          {t("detail.eval.evaluator" as any)}: {item.evaluation.model_id === "__cached__" ? "deepseek-chat" : item.evaluation.model_id || "unknown"}
                          {" · "}
                          {fmtDate(item.evaluation.evaluated_at)}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Health radar */}
                  {hasHealth(item.health) && item.health && (
                    <div className="min-w-64 flex-1 rounded-lg border bg-muted/30 p-4">
                      <div className="mb-3 flex items-center justify-between gap-4">
                        <span className={FIELD_LABEL}>{t(($) => $.detail.health.label)}</span>
                        {(item.health.effective_score ?? item.health.score) != null && (
                          <span className="inline-flex items-baseline gap-0.5 font-bold" style={{ color: typeColor }}>
                            <span className="text-lg">
                              {Math.round(item.health.effective_score ?? item.health.score!)}
                            </span>
                            <span className="text-[11px] font-semibold opacity-60">/100</span>
                          </span>
                        )}
                      </div>
                      <HealthRadar signals={item.health.signals} accent={typeColor} />
                    </div>
                  )}
                </div>

                {/* Overall score */}
                {hasEval(item.evaluation) && item.evaluation && item.evaluation.final_score > 0 && (
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border bg-muted/30 px-4 py-3">
                    <span className={FIELD_LABEL}>{"Overall Score"}</span>
                    <span className="text-lg font-bold" style={{ color: typeColor }}>
                      {Math.round(item.evaluation.final_score)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {"out of 100"}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Content */}
            {/* Content — long content starts collapsed; expanding logs the
                `preview` behavior (FR-10) */}
            {item.content && (
              <div className="space-y-1.5">
                <div
                  className={
                    contentExpanded || !isLongContent
                      ? "min-h-[26rem] overflow-y-auto rounded-lg border bg-muted/50 p-4"
                      : "max-h-40 overflow-hidden rounded-lg border bg-muted/50 p-4"
                  }
                >
                  <pre className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                    {item.content}
                  </pre>
                </div>
                {isLongContent && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={() =>
                      contentExpanded ? setContentExpanded(false) : expandContentPreview()
                    }
                  >
                    {contentExpanded ? (
                      <>
                        <ChevronUp className="mr-1 h-3.5 w-3.5" />
                        {t(($) => $.detail.contentCollapse)}
                      </>
                    ) : (
                      <>
                        <ChevronDown className="mr-1 h-3.5 w-3.5" />
                        {t(($) => $.detail.contentExpand)}
                      </>
                    )}
                  </Button>
                )}
              </div>
            )}
            {/* Artifacts (D-16) — authenticated per-file download */}
            <ArtifactList itemId={itemId} fallbackArtifacts={item.artifacts} />

            {/* Plugin sub-items */}
            {item.itemType === "plugin" && (
              <div>
                <h3 className={`mb-3 ${FIELD_LABEL}`}>{"Bundled Skills"}</h3>
                {subItems && subItems.length > 0 ? (
                  <div className="rounded-lg border bg-muted/20 py-1">
                    <SubItemTree nodes={subItems} />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{"No bundled skills"}</p>
                )}
              </div>
            )}
          </div>

          {/* ── Right Column (Sidebar) ── */}
          <aside className="min-w-0 space-y-5 xl:sticky xl:top-0 xl:self-start">
            <div className="p-1">
              <div className="space-y-3">
                {/* Type + stats */}
                <div className="flex items-center gap-4 text-sm text-foreground">
                  <span className="inline-flex items-center gap-1.5" title={t(typeKey(item.itemType ?? "skill") as any)}>
                    <div
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
                      style={{ backgroundColor: `color-mix(in srgb, ${typeColor} 12%, transparent)`, color: typeColor }}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <span>{t(($) => $.home.typeTab[(item.itemType ?? "all") as "all" | "skill" | "subagent" | "command" | "mcp" | "plugin"])}</span>
                  </span>
                  {/* D-12: behavior counts render only when the backend
                      returns the field — no zero placeholders */}
                  {item.previewCount != null && (
                    <span className="inline-flex items-center gap-1.5" title={`Previews: ${item.previewCount.toLocaleString()}`}>
                      <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{formatCompact(item.previewCount)}</span>
                    </span>
                  )}
                  {item.installCount != null && (
                    <span className="inline-flex items-center gap-1.5" title={`Installs: ${item.installCount.toLocaleString()}`}>
                      <Download className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{formatCompact(item.installCount)}</span>
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5" title={`Subscribers: ${(item.favoriteCount ?? 0).toLocaleString()}`}>
                    <Star className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{formatCompact(item.favoriteCount ?? 0)}</span>
                  </span>
                </div>

                {/* Security scan details (D-08) — collapsible ScanRows via
                    hubGetScanResults; falls back to the plain status tag */}
                <ScanResults itemId={itemId} securityStatus={item.securityStatus} />

                {/* Tags */}
                {item.tags && item.tags.length > 0 && (
                  <div>
                    <span className={`mb-2 block ${FIELD_LABEL}`}>{"Tags"}</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[...item.tags].sort(compareTags).map((tag) => (
                        <Badge key={tag.slug} variant="outline" className="text-[11px] font-semibold">
                          {tag.slug}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Visibility */}
                <div className="flex items-center justify-between gap-4">
                  <span className={FIELD_LABEL}>{"Visibility"}</span>
                  <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
                    {item.repoVisibility === "private" ? (
                      <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    {item.repoVisibility === "public"
                      ? "Public"
                      : item.repoVisibility === "private"
                        ? "Private"
                        : "-"}
                  </span>
                </div>

                {/* Forked from */}
                {item.forkedFromItemId && (
                  <div className="inline-flex max-w-full items-center gap-1.5 text-sm text-muted-foreground">
                    <GitFork className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{"Forked from"}</span>
                  </div>
                )}

                {/* Author */}
                <div className="flex items-center justify-between gap-4">
                  <span className={FIELD_LABEL}>{t(($) => $.detail.author)}</span>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="max-w-48 truncate text-right text-sm text-foreground">
                      {item.createdBy}
                    </span>
                    <button
                      type="button"
                      onClick={copyId}
                      className="inline-flex shrink-0 cursor-pointer items-center text-muted-foreground transition-colors hover:text-foreground"
                      title={itemId}
                    >
                      {copied ? <Check className="h-3 w-3" /> : <Link className="h-3 w-3" />}
                    </button>
                  </div>
                </div>

                {/* Category */}
                {item.category && (
                  <div className="flex items-center justify-between gap-4">
                    <span className={FIELD_LABEL}>{"Category"}</span>
                    <span className="text-right text-sm text-foreground">{item.category}</span>
                  </div>
                )}

                {/* Dates */}
                <Separator />
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className={FIELD_LABEL}>{t(($) => $.detail.created)}</span>
                    <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      {fmtDate(item.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className={FIELD_LABEL}>{t(($) => $.detail.updated)}</span>
                    <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      {fmtDate(item.updatedAt)}
                    </span>
                  </div>
                </div>

                {/* Versions */}
                {item.versions && item.versions.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setVersionsOpen((v) => !v)}
                      className="inline-flex w-full cursor-pointer items-center justify-between gap-2 py-1 text-sm font-medium text-foreground transition-colors hover:text-muted-foreground"
                    >
                      <span className={FIELD_LABEL}>{t(($) => $.detail.versions)}</span>
                      {versionsOpen ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                    {versionsOpen && (
                      <div className="mt-2 space-y-2">
                        {item.versions.map((v: CapabilityVersion) => (
                          <div
                            key={v.id}
                            className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2 text-sm"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium text-foreground">
                                {v.versionLabel ?? `r${v.revision}`}
                              </div>
                              {v.commitMsg && (
                                <div className="truncate text-xs text-muted-foreground">{v.commitMsg}</div>
                              )}
                            </div>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {fmtDate(v.createdAt)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* MCP Config */}
                {mcpConfig && (
                  <div ref={mcpConfigRef} className="space-y-2 rounded-lg border bg-muted/30 p-3">
                    <span className={FIELD_LABEL}>{t(($) => $.detail.mcp.label)}</span>
                    <McpConfigForm
                      itemId={itemId}
                      metadata={mcpMetadata}
                      status={mcpConfig}
                      onSaved={() => refetch()}
                    />
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* ── Delete Confirm Dialog ── */}
      <ConfirmDialog
        open={delOpen}
        onOpenChange={setDelOpen}
        title={t(($) => $.detail.delete_dialog.title)}
        description={t(($) => $.detail.delete_dialog.description)}
        variant="danger"
        onConfirm={handleDelete}
      />

      {/* ── Distribute Dialog (shared by Sheet and standalone page) ── */}
      {item && (
        <DistributeDialog
          item={item}
          open={distOpen}
          onOpenChange={setDistOpen}
          onCreated={() => setDistOpen(false)}
        />
      )}

      {/* ── Built-in Content Dialog (D-13, set built-in via .md upload) ── */}
      {item && (
        <BuiltinContentDialog
          itemId={itemId}
          itemName={item.name}
          open={builtinOpen}
          onOpenChange={setBuiltinOpen}
          onSuccess={() => refetch()}
        />
      )}
    </div>
  )
}

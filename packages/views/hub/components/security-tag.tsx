"use client"

import { Shield, AlertTriangle, CheckCircle, Bug } from "lucide-react"
import type { LucideProps } from "lucide-react"
import type { FC } from "react"
import { Badge } from "@multica/ui/components/ui/badge"
import { useT } from "../../i18n"

export type SecurityStatus =
  | "unscanned"
  | "pending"
  | "scanning"
  | "clean"
  | "low"
  | "medium"
  | "high"
  | "extreme"
  | "error"
  | "skipped"

const COLORS: Record<SecurityStatus, string> = {
  unscanned: "bg-muted text-muted-foreground border-muted-foreground/20",
  pending: "bg-muted text-muted-foreground border-muted-foreground/20",
  scanning: "bg-muted text-muted-foreground border-muted-foreground/20",
  clean: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
  low: "bg-lime-500/10 text-lime-600 border-lime-500/20 dark:text-lime-400",
  medium: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",
  high: "bg-orange-500/10 text-orange-600 border-orange-500/20 dark:text-orange-400",
  extreme: "bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400",
  error: "bg-muted text-muted-foreground border-muted-foreground/20",
  skipped: "bg-muted text-muted-foreground border-muted-foreground/20",
}

const ICONS: Record<SecurityStatus, FC<LucideProps> | null> = {
  unscanned: null,
  pending: null,
  scanning: null,
  clean: CheckCircle,
  low: AlertTriangle,
  medium: AlertTriangle,
  high: Shield,
  extreme: Shield,
  error: Bug,
  skipped: null,
}

const PULSE: Set<SecurityStatus> = new Set(["pending", "scanning"])

function isSecurityStatus(v: string): v is SecurityStatus {
  return v in COLORS
}

interface SecurityTagProps {
  status?: string
}

export function SecurityTag({ status }: SecurityTagProps) {
  const { t } = useT("hub")
  if (!status) return null
  const s = isSecurityStatus(status) ? status : "unscanned"
  const Icon = ICONS[s]
  const pulse = PULSE.has(s)

  return (
    <Badge
      variant="outline"
      className={`inline-flex items-center gap-1 ${COLORS[s]} ${pulse ? "animate-pulse" : ""}`}
      title={t(($) => ($.detail.security as Record<string, string>)[s] ?? s)}
    >
      {Icon && <Icon className="h-3 w-3" />}
      <span className="dot h-1.5 w-1.5 rounded-full" />
      {t(($) => ($.detail.security as Record<string, string>)[s] ?? s)}
    </Badge>
  )
}

export default SecurityTag

export type Verdict = "safe" | "caution" | "reject"

const VERDICT_COLORS: Record<Verdict, string> = {
  safe: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
  caution: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",
  reject: "bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400",
}

const VERDICT_ALIASES: Record<string, Verdict> = {
  safe: "safe",
  pass: "safe",
  passed: "safe",
  ok: "safe",
  clean: "safe",
  low: "safe",
  caution: "caution",
  warn: "caution",
  warning: "caution",
  review: "caution",
  medium: "caution",
  reject: "reject",
  fail: "reject",
  failed: "reject",
  block: "reject",
  blocked: "reject",
  danger: "reject",
  high: "reject",
}

interface VerdictTagProps {
  verdict?: string
}

export function VerdictTag({ verdict }: VerdictTagProps) {
  const { t } = useT("hub")
  if (!verdict) return null
  const v = VERDICT_ALIASES[verdict.toLowerCase()] ?? "safe"

  return (
    <Badge
      variant="outline"
      className={VERDICT_COLORS[v]}
      title={t(($) => ($.detail.verdict as Record<string, string>)[v] ?? v)}
    >
      {t(($) => ($.detail.verdict as Record<string, string>)[v] ?? v)}
    </Badge>
  )
}

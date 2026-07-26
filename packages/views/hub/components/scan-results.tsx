"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { CodeBlock } from "@multica/ui/markdown"
import type { ScanResult } from "@multica/core/types"
import { useHubScanResults } from "@multica/core/hub"
import { SecurityTag, VerdictTag } from "./security-tag"
import { useT } from "../../i18n"

// ── Helpers (mirrors the source store ScanRow formatting) ──────────────────

function formatDuration(ms: number) {
  if (!ms || Number.isNaN(ms)) return ""
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${(ms / 60_000).toFixed(1)} min`
}

function formatDate(iso: string) {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d)
}

/** Extracts a human-readable reason from a scan finding object
 *  (redFlags/recommendations), preferring known text fields. */
function formatValue(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value == null) return ""
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>
    for (const key of ["message", "reason", "description", "detail", "text", "title"]) {
      const v = rec[key]
      if (typeof v === "string" && v) {
        const label =
          (typeof rec.severity === "string" && rec.severity) ||
          (typeof rec.type === "string" && rec.type) ||
          ""
        return label ? `[${label}] ${v}` : v
      }
    }
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

// ── ScanRow ────────────────────────────────────────────────────────────────

function ScanRow({ scan }: { scan: ScanResult }) {
  const { t } = useT("hub")
  const [open, setOpen] = useState(false)

  const permLabel = (key: string) => {
    if (key === "files") return t(($) => $.detail.scanResults.permFiles)
    if (key === "network") return t(($) => $.detail.scanResults.permNetwork)
    if (key === "commands") return t(($) => $.detail.scanResults.permCommands)
    return key
  }

  const formatPermValue = (val: unknown): string => {
    if (Array.isArray(val)) return val.length ? val.map(String).join(", ") : "—"
    const formatted = formatValue(val)
    return formatted === "" ? "—" : formatted
  }

  const redFlags = scan.redFlags ?? []
  const recommendations = scan.recommendations ?? []
  const perms = Object.entries(scan.permissions ?? {})
  const meta = [
    scan.scanModel,
    scan.triggerType,
    formatDuration(scan.durationMs),
    formatDate(scan.finishedAt),
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t(($) => $.detail.scanResults.details)}
        className="group -mx-1.5 flex w-full cursor-pointer flex-col gap-1 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/50"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="text-xs font-bold text-muted-foreground/70">
            {t(($) => $.detail.security.label)}
          </div>
          <div className="flex items-center gap-1.5">
            <SecurityTag status={scan.riskLevel} />
            <VerdictTag verdict={scan.verdict} />
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 ${open ? "rotate-180" : ""}`}
            />
          </div>
        </div>
        {scan.summary && (
          <p className="break-words text-xs leading-5 text-muted-foreground">{scan.summary}</p>
        )}
      </button>

      {open && (
        <div className="mt-2 space-y-3 text-xs">
          <div>
            <div className="mb-1 text-xs text-muted-foreground/70">
              {t(($) => $.detail.scanResults.foundIssues)}
            </div>
            {redFlags.length > 0 ? (
              <ul className="list-disc space-y-1 pl-4">
                {redFlags.map((f, i) => (
                  <li key={i} className="break-words text-foreground">
                    {formatValue(f)}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-muted-foreground">{t(($) => $.detail.scanResults.noRedFlags)}</div>
            )}
          </div>

          <div>
            <div className="mb-1 text-xs text-muted-foreground/70">
              {t(($) => $.detail.scanResults.suggestions)}
            </div>
            {recommendations.length > 0 ? (
              <ul className="list-disc space-y-1 pl-4">
                {recommendations.map((r, i) => (
                  <li key={i} className="break-words text-foreground">
                    {formatValue(r)}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-muted-foreground">
                {t(($) => $.detail.scanResults.noRecommendations)}
              </div>
            )}
          </div>

          {perms.length > 0 && (
            <div>
              <div className="mb-1 text-xs text-muted-foreground/70">
                {t(($) => $.detail.scanResults.permissions)}
              </div>
              <div className="space-y-1">
                {perms.map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground/70">{permLabel(key)}</span>
                    <span className="break-words text-right text-foreground">
                      {formatPermValue(val)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {meta && <div className="text-muted-foreground/70">{meta}</div>}

          {/* Raw scan payload — shiki dual-theme JSON highlight via ui CodeBlock. */}
          <div>
            <div className="mb-1 text-xs text-muted-foreground/70">
              {t(($) => $.detail.scanResults.rawJson)}
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border bg-muted/30 p-2">
              <CodeBlock
                code={JSON.stringify(scan, null, 2)}
                language="json"
                mode="minimal"
                className="text-xs"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Section ────────────────────────────────────────────────────────────────

export interface ScanResultsProps {
  itemId: string
  /** Fallback status shown while loading or when no scan data is available. */
  securityStatus?: string
}

/**
 * Security scan details (D-08): each ScanResult is a collapsible ScanRow.
 * Data comes from `hubGetScanResults` via the core/hub query. When the query
 * errors or returns nothing, degrades to the plain security-status row so the
 * sidebar never breaks.
 */
export function ScanResults({ itemId, securityStatus }: ScanResultsProps) {
  const { t } = useT("hub")
  const { data: scans, isLoading, isError } = useHubScanResults(itemId)

  if (isError || (!isLoading && (scans ?? []).length === 0)) {
    return (
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs font-bold text-muted-foreground/70">
          {t(($) => $.detail.security.label)}
        </span>
        <div className="flex items-center gap-1.5">
          {isLoading && (
            <span className="text-xs text-muted-foreground">{t(($) => $.detail.scanResults.loading)}</span>
          )}
          <SecurityTag status={securityStatus} />
        </div>
      </div>
    )
  }

  if (isLoading || !scans) {
    return (
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs font-bold text-muted-foreground/70">
          {t(($) => $.detail.security.label)}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t(($) => $.detail.scanResults.loading)}</span>
          <SecurityTag status={securityStatus} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {scans.map((scan) => (
        <ScanRow key={scan.id} scan={scan} />
      ))}
    </div>
  )
}

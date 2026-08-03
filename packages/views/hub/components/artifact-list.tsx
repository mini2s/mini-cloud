"use client"

import { useState, useCallback } from "react"
import { Download, Loader2, FileArchive } from "lucide-react"
import { Button } from "@multica/ui/components/ui/button"
import { toast } from "sonner"
import { api } from "@multica/core/api"
import type { CapabilityArtifact } from "@multica/core/types"
import { useHubArtifacts, useHubLogBehaviorMutation } from "@multica/core/hub"
import { useT } from "../../i18n"

function formatBytes(n: number): string {
  if (!n || Number.isNaN(n)) return ""
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export interface ArtifactListProps {
  itemId: string
  /** Artifacts embedded in the item payload, used when the list endpoint is
   *  unavailable or still loading. */
  fallbackArtifacts?: CapabilityArtifact[]
}

/**
 * Artifact downloads (D-16): lists the item's artifacts and downloads each
 * through the authenticated client (`hubDownloadArtifact` — fetch + blob +
 * browser save), never a bare `<a href>`. Each successful download also logs
 * an `install` behavior (source actionType enum; consumed by task 12 counts).
 */
export function ArtifactList({ itemId, fallbackArtifacts }: ArtifactListProps) {
  const { t } = useT("hub")
  const { data } = useHubArtifacts(itemId)
  const logBehavior = useHubLogBehaviorMutation()
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const artifacts = data ?? fallbackArtifacts ?? []
  if (artifacts.length === 0) return null

  const handleDownload = useCallback(
    async (artifact: CapabilityArtifact) => {
      if (downloadingId) return
      setDownloadingId(artifact.id)
      try {
        await api.hubDownloadArtifact(artifact.id, artifact.filename)
        logBehavior.mutate({ id: itemId, actionType: "install", context: "artifact-download" })
      } catch {
        toast.error(t(($) => $.detail.artifacts.download_failed))
      } finally {
        setDownloadingId(null)
      }
    },
    [downloadingId, itemId, logBehavior, t],
  )

  return (
    <div className="space-y-1.5">
      <span className="text-xs font-bold text-muted-foreground/70">
        {t(($) => $.detail.artifacts.label)}
      </span>
      <div className="divide-y rounded-lg border bg-muted/20">
        {artifacts.map((artifact) => (
          <div key={artifact.id} className="flex items-center gap-3 px-3 py-2">
            <FileArchive className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">
                {artifact.filename}
                {artifact.isLatest && (
                  <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                    {t(($) => $.detail.artifacts.latest)}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {[artifact.version, formatBytes(artifact.fileSize)].filter(Boolean).join(" · ")}
              </div>
            </div>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              disabled={downloadingId !== null}
              onClick={() => handleDownload(artifact)}
              title={t(($) => $.detail.download)}
            >
              {downloadingId === artifact.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

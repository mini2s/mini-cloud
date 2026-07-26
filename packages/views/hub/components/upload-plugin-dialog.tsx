"use client"

import { useState, useRef, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@multica/ui/components/ui/dialog"
import { Button } from "@multica/ui/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select"
import { Label } from "@multica/ui/components/ui/label"
import type { CapabilityItem } from "@multica/core/types/hub"
import { useT } from "@multica/views/i18n"
import { toast } from "sonner"
import { Upload, X, File, Package } from "lucide-react"
import { useHubMyRepos, useHubUploadPluginMutation } from "@multica/core/hub"
import { cn } from "@multica/ui/lib/utils"

export type UploadPluginDialogProps = {
  onCreated: (item: CapabilityItem) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UploadPluginDialog(props: UploadPluginDialogProps) {
  const { t } = useT("hub")
  const { repos, isLoading: reposLoading } = useHubMyRepos()
  const uploadPlugin = useHubUploadPluginMutation()
  const inputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [repoId, setRepoId] = useState("")
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState("")
  const [dragOver, setDragOver] = useState(false)
  const uploading = uploadPlugin.isPending

  // Default to first repo when repos load
  const [initialized, setInitialized] = useState(false)
  if (!initialized && repos.length > 0 && !repoId) {
    setRepoId(repos[0]!.id)
    setInitialized(true)
  }

  function validateFile(f: File): string | null {
    if (!f.name.toLowerCase().endsWith(".zip")) {
      return t(($) => $.dialog.plugin_not_zip)
    }
    if (f.size > 50 * 1024 * 1024) {
      return t(($) => $.dialog.plugin_too_large)
    }
    return null
  }

  function handleFile(f: File) {
    const err = validateFile(f)
    if (err) {
      setError(err)
      setFile(null)
      return
    }
    setFile(f)
    setError("")
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }, [])

  function reset() {
    setFile(null)
    setProgress(0)
    setError("")
    if (inputRef.current) inputRef.current.value = ""
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !repoId || uploading) return

    setProgress(0)
    setError("")

    try {
      const item = await uploadPlugin.mutateAsync({
        repoId,
        file,
        onProgress: (p) => {
          setProgress(p.total > 0 ? p.loaded / p.total : 0)
        },
      })
      props.onCreated(item)
      toast.success(t(($) => $.dialog.plugin_uploaded))
      props.onOpenChange(false)
      reset()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast.error(t(($) => $.dialog.plugin_upload_failed), { description: msg })
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={(v) => { if (!uploading) { props.onOpenChange(v); if (!v) reset() }}}>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              <Package className="mr-2 inline-block size-5" />
              {t(($) => $.dialog.plugin_upload_title)}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Repo select */}
            <div className="space-y-1.5">
              <Label>{t(($) => $.field.repository)}</Label>
              <Select
                value={repoId}
                onValueChange={(v) => setRepoId(v ?? "")}
                disabled={reposLoading || repos.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t(($) => $.dialog.select_repo)} />
                </SelectTrigger>
                <SelectContent>
                  {repos.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Drop zone */}
            <div
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors",
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-muted-foreground/40",
                file && "border-solid border-primary/40 bg-primary/5",
              )}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0]
                  if (f) handleFile(f)
                }}
              />

              {file ? (
                <div className="flex items-center gap-3">
                  <File className="size-8 text-primary" />
                  <div className="text-left">
                    <p className="text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    onClick={(e) => { e.stopPropagation(); reset() }}
                    disabled={uploading}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <Upload className="mb-2 size-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {t(($) => $.dialog.plugin_drag_hint)}{" "}
                    <span className="font-medium text-primary">
                      {t(($) => $.dialog.plugin_click_browse)}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t(($) => $.dialog.plugin_size_hint)}
                  </p>
                </>
              )}
            </div>

            {/* Progress bar */}
            {uploading && (
              <div className="space-y-1">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
                <p className="text-right text-xs text-muted-foreground">
                  {Math.round(progress * 100)}%
                </p>
              </div>
            )}

            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => { props.onOpenChange(false); reset() }}
              disabled={uploading}
            >
              {t(($) => $.dialog.cancel)}
            </Button>
            <Button type="submit" disabled={uploading || !file || !repoId}>
              {uploading
                ? `${t(($) => $.dialog.uploading)} ${Math.round(progress * 100)}%`
                : t(($) => $.dialog.upload)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
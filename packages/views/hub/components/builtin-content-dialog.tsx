"use client"

import { useState, useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { CloudUpload, FileText, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@multica/ui/components/ui/dialog"
import { Button } from "@multica/ui/components/ui/button"
import { toast } from "sonner"
import { api } from "@multica/core/api"
import type { CapabilityItem } from "@multica/core/types"
import { hubKeys } from "@multica/core/hub"
import { useT } from "../../i18n"

const MAX_FILE_SIZE = 5 * 1024 * 1024

export interface BuiltinContentDialogProps {
  itemId: string
  itemName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (item: CapabilityItem) => void
}

/**
 * Built-in content dialog (D-13), migrated from the source store
 * builtin-content-dialog: uploading a Markdown file marks a plugin as
 * built-in with that content (`hubUpdateItem(id, { isBuiltIn: true, content
 * })`). Un-setting built-in is a plain update handled by the caller, not by
 * this dialog.
 */
export function BuiltinContentDialog({
  itemId,
  itemName,
  open,
  onOpenChange,
  onSuccess,
}: BuiltinContentDialogProps) {
  const { t } = useT("hub")
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [fileContent, setFileContent] = useState("")
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState("")

  const reset = useCallback(() => {
    setFile(null)
    setFileContent("")
    setUploading(false)
    setDragOver(false)
    setError("")
  }, [])

  const readFile = (f: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ""))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(f)
    })

  const handleFileSelect = useCallback(
    async (f: File) => {
      if (!f.name.toLowerCase().endsWith(".md")) {
        setError(t(($) => $.detail.builtinContent.error_not_md))
        setFile(null)
        setFileContent("")
        return
      }
      if (f.size > MAX_FILE_SIZE) {
        setError(t(($) => $.detail.builtinContent.error_too_large))
        setFile(null)
        setFileContent("")
        return
      }
      setFile(f)
      setError("")
      try {
        setFileContent(await readFile(f))
      } catch {
        setError(t(($) => $.detail.builtinContent.error_read_failed))
        setFileContent("")
      }
    },
    [t],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const f = e.dataTransfer?.files?.[0]
      if (f) void handleFileSelect(f)
    },
    [handleFileSelect],
  )

  const handleSubmit = useCallback(async () => {
    if (!file || !fileContent || uploading) return
    setUploading(true)
    setError("")
    try {
      const updated = await api.hubUpdateItem(itemId, { isBuiltIn: true, content: fileContent })
      toast.success(t(($) => $.detail.set_builtin_success))
      qc.invalidateQueries({ queryKey: hubKeys.item(itemId) })
      onSuccess?.(updated)
      onOpenChange(false)
      reset()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast.error(t(($) => $.detail.toggle_builtin_failed), { description: message })
    } finally {
      setUploading(false)
    }
  }, [file, fileContent, uploading, itemId, qc, t, onSuccess, onOpenChange, reset])

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) reset()
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t(($) => $.detail.builtinContent.title, { name: itemName })}</DialogTitle>
          <DialogDescription>{t(($) => $.detail.builtinContent.description)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Drag & drop area */}
          <div
            className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
              dragOver ? "border-primary bg-primary/5" : "border-border"
            }`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {file ? (
              <div className="flex items-center justify-center gap-2">
                <FileText className="h-4 w-4 text-foreground" />
                <span className="text-sm text-foreground">{file.name}</span>
                <button
                  type="button"
                  className="cursor-pointer text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setFile(null)
                    setFileContent("")
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <>
                <CloudUpload className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {t(($) => $.detail.builtinContent.drag_hint)}
                  <label className="cursor-pointer text-primary hover:underline">
                    {t(($) => $.detail.builtinContent.click_select)}
                    <input
                      type="file"
                      accept=".md"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.currentTarget.files?.[0]
                        if (f) void handleFileSelect(f)
                        e.currentTarget.value = ""
                      }}
                    />
                  </label>
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t(($) => $.detail.builtinContent.size_hint)}
                </p>
              </>
            )}
          </div>

          {/* Content preview */}
          {fileContent && (
            <div className="max-h-48 overflow-y-auto rounded-lg border bg-muted/50 px-4 py-3">
              <pre className="whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                {fileContent.slice(0, 500)}
                {fileContent.length > 500 ? "..." : ""}
              </pre>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t(($) => $.detail.delete_dialog.cancel)}
          </Button>
          <Button onClick={handleSubmit} disabled={uploading || !fileContent}>
            {uploading
              ? t(($) => $.detail.builtinContent.saving)
              : t(($) => $.detail.builtinContent.confirm)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

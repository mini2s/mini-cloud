"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@multica/ui/components/ui/dialog"
import { Button } from "@multica/ui/components/ui/button"
import { Input } from "@multica/ui/components/ui/input"
import { Textarea } from "@multica/ui/components/ui/textarea"
import { Label } from "@multica/ui/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select"
import { api } from "@multica/core/api"
import type { Repository } from "@multica/core/types/hub"
import { useT } from "@multica/views/i18n"
import { toast } from "sonner"

export type EditRepoDialogProps = {
  repo: Repository
  onUpdated: (repo: Repository) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditRepoDialog(props: EditRepoDialogProps) {
  const { t } = useT("hub")
  const [name, setName] = useState(props.repo.name)
  const [displayName, setDisplayName] = useState(props.repo.displayName)
  const [desc, setDesc] = useState(props.repo.description)
  const [visibility, setVisibility] = useState(props.repo.visibility)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  async function handle(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return

    setSaving(true)
    setError("")
    try {
      const updated = await api.hubUpdateRepo(props.repo.id, {
        name: trimmed,
        displayName: displayName.trim() || undefined,
        description: desc.trim() || undefined,
        visibility,
      })
      props.onUpdated(updated)
      toast.success(t(($) => $.repo.updated_toast))
      props.onOpenChange(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast.error(t(($) => $.repo.update_failed), { description: msg })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={(v) => { if (!saving) props.onOpenChange(v) }}>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handle}>
          <DialogHeader>
            <DialogTitle>{t(($) => $.repo.edit_title)}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Name */}
            <div className="space-y-1.5">
              <Label>
                {t(($) => $.repo.field_name)} <span className="text-destructive">*</span>
              </Label>
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            {/* Display name */}
            <div className="space-y-1.5">
              <Label>{t(($) => $.repo.field_display_name)}</Label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label>{t(($) => $.repo.field_description)}</Label>
              <Textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={3}
              />
            </div>

            {/* Visibility */}
            <div className="space-y-1.5">
              <Label>{t(($) => $.repo.field_visibility)}</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v ?? "private")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">
                    {t(($) => $.repo.visibility_private)}
                  </SelectItem>
                  <SelectItem value="public">
                    {t(($) => $.repo.visibility_public)}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {error && (
              <div
                className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              disabled={saving}
            >
              {t(($) => $.dialog.cancel)}
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? t(($) => $.dialog.saving) : t(($) => $.dialog.edit.save)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default EditRepoDialog

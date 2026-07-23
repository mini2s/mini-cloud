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
import { Plus } from "lucide-react"

export type CreateRepoDialogProps = {
  onCreated: (repo: Repository) => void
}

export function CreateRepoDialog(props: CreateRepoDialogProps) {
  const { t } = useT("hub")
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [desc, setDesc] = useState("")
  const [visibility, setVisibility] = useState("private")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  function reset() {
    setName("")
    setDisplayName("")
    setDesc("")
    setVisibility("private")
    setError("")
  }

  async function handle(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return

    setSaving(true)
    setError("")
    const repo = await api.hubCreateRepo({
      name: trimmed,
      displayName: displayName.trim() || undefined,
      description: desc.trim() || undefined,
      visibility,
    } as any)
    try {
      props.onCreated(repo)
      toast.success(t(($) => $.repo.created_toast))
      setOpen(false)
      reset()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast.error(t(($) => $.repo.create_failed), { description: msg })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-1 size-4" />
        {t(($) => $.repo.create)}
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!saving) setOpen(v) }}>
        <DialogContent className="sm:max-w-[480px]">
          <form onSubmit={handle}>
            <DialogHeader>
              <DialogTitle>{t(($) => $.repo.create_title)}</DialogTitle>
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
                  placeholder="my-repo"
                  required
                />
              </div>

              {/* Display name */}
              <div className="space-y-1.5">
                <Label>{t(($) => $.repo.field_display_name)}</Label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t(($) => $.repo.field_display_name_placeholder)}
                />
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <Label>{t(($) => $.repo.field_description)}</Label>
                <Textarea
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder={t(($) => $.repo.field_description_placeholder)}
                  rows={3}
                />
              </div>

              {/* Visibility */}
              <div className="space-y-1.5">
                <Label>{t(($) => $.repo.field_visibility)}</Label>
                <Select value={visibility} onValueChange={(v) => setVisibility(v ?? "")}>
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
                onClick={() => { setOpen(false); reset() }}
                disabled={saving}
              >
                {t(($) => $.dialog.cancel)}
              </Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? t(($) => $.dialog.saving) : t(($) => $.repo.create_submit)}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default CreateRepoDialog

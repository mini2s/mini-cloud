"use client"

import { useState, useEffect } from "react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select"
import { Badge } from "@multica/ui/components/ui/badge"
import { Label } from "@multica/ui/components/ui/label"
import { Separator } from "@multica/ui/components/ui/separator"
import { api } from "@multica/core/api"
import type { CapabilityItem } from "@multica/core/types/hub"
import { useT } from "@multica/views/i18n"
import { toast } from "sonner"
import { X } from "lucide-react"
import { TYPE_COLORS } from "../lib/constants"
import { useHubFilterOptions } from "../hooks/use-hub-filters"

const VISIBILITY_OPTS = ["public", "private", "org"] as const

export type EditCapabilityDialogProps = {
  item: CapabilityItem
  onUpdated: (item: CapabilityItem) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditCapabilityDialog(props: EditCapabilityDialogProps) {
  const { t } = useT("hub")
  const { data: filterOpts } = useHubFilterOptions()
  const tags = filterOpts?.tags ?? []
  const existing = props.item

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const [name, setName] = useState(existing.name)
  const [desc, setDesc] = useState(existing.description ?? "")
  const [visibility, setVisibility] = useState(existing.visibility ?? "public")
  const [selectedTags, setSelectedTags] = useState<string[]>(existing.tags?.map((t) => t.id ?? t) ?? [])

  useEffect(() => {
    setName(existing.name)
    setDesc(existing.description ?? "")
    setVisibility(existing.visibility ?? "public")
    setSelectedTags(existing.tags?.map((t) => t.id ?? t) ?? [])
    setError("")
  }, [existing, props.open])

  function toggleTag(tagId: string) {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    )
  }

  async function handle(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return

    setSaving(true)
    setError("")
    try {
      const updated = await api.hubUpdateItem(existing.id, {
        name: trimmed,
        description: desc.trim() || undefined,
        visibility,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
      })
      props.onUpdated(updated)
      toast.success(t(($) => $.dialog.update_success))
      props.onOpenChange(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast.error(t(($) => $.dialog.update_failed), { description: msg })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={(v) => { if (!saving) props.onOpenChange(v) }}>
      <DialogContent className="sm:max-w-[520px]">
        <form onSubmit={handle}>
          <DialogHeader>
            <DialogTitle>
              {t(($) => $.dialog.edit_title)} —{" "}
              <span
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: TYPE_COLORS[existing.itemType] }}
              />
              {" "}{existing.name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Name */}
            <div className="space-y-1.5">
              <Label>
                {t(($) => $.field.name)} <span className="text-destructive">*</span>
              </Label>
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label>{t(($) => $.field.description)}</Label>
              <Textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={3}
              />
            </div>

            {/* Visibility */}
            <div className="space-y-1.5">
              <Label>{t(($) => $.field.visibility)}</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v ?? "")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VISIBILITY_OPTS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {t(`hub.capability.visibility.${v}` as any)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Tags */}
            <div className="space-y-1.5">
              <Label>{t(($) => $.field.tags)}</Label>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => {
                  const active = selectedTags.includes(tag.id)
                  return (
                    <Badge
                      key={tag.id}
                      variant={active ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleTag(tag.id)}
                    >
                      {tag.slug}
                      {active && <X className="ml-1 size-3" />}
                    </Badge>
                  )
                })}
                {tags.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t(($) => $.dialog.no_tags)}
                  </p>
                )}
              </div>
            </div>

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
              onClick={() => props.onOpenChange(false)}
              disabled={saving}
            >
              {t(($) => $.dialog.cancel)}
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? t(($) => $.dialog.saving) : t(($) => $.dialog.save)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default EditCapabilityDialog

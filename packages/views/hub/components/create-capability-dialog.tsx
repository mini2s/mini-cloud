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
import { Plus, X } from "lucide-react"
import { TYPE_COLORS } from "../lib/constants"
import { useHubFilterOptions } from "../hooks/use-hub-filters"

const ITEM_TYPES = ["skill", "subagent", "command", "mcp", "plugin"] as const

const VISIBILITY_OPTS = ["public", "private", "org"] as const

const TYPE_LABEL_KEY: Record<string, string> = {
  skill: "hub.capability.type.skill",
  subagent: "hub.capability.type.subagent",
  command: "hub.capability.type.command",
  mcp: "hub.capability.type.mcp",
  plugin: "hub.capability.type.plugin",
}

export type CreateCapabilityDialogProps = {
  onCreated: (item: CapabilityItem) => void
}

export function CreateCapabilityDialog(props: CreateCapabilityDialogProps) {
  const { t } = useT("hub")
  const { data: filterOpts } = useHubFilterOptions()
  const tags = filterOpts?.tags ?? []

  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const [itemType, setItemType] = useState("skill")
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [visibility, setVisibility] = useState("public")
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  function toggleTag(tagId: string) {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    )
  }

  function reset() {
    setName("")
    setDesc("")
    setVisibility("public")
    setSelectedTags([])
    setItemType("skill")
    setError("")
  }

  async function handle(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return

    setSaving(true)
    setError("")
    try {
      const item = await api.hubCreateItem({
        itemType,
        name: trimmed,
        description: desc.trim() || undefined,
        visibility,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
      })
      props.onCreated(item)
      toast.success(t(($) => $.dialog.create_success))
      setOpen(false)
      reset()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast.error(t(($) => $.dialog.create_failed), { description: msg })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-1 size-4" />
        {t(($) => $.dialog.create_capability)}
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!saving) setOpen(v) }}>
        <DialogContent className="sm:max-w-[520px]">
          <form onSubmit={handle}>
            <DialogHeader>
              <DialogTitle>{t(($) => $.dialog.create_title)}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Type */}
              <div className="space-y-1.5">
                <Label>{t(($) => $.field.type)}</Label>
                <Select value={itemType} onValueChange={(v) => setItemType(v as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ITEM_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block size-2 rounded-full"
                            style={{ backgroundColor: TYPE_COLORS[type] }}
                          />
                          {t(TYPE_LABEL_KEY[type] as any)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Name */}
              <div className="space-y-1.5">
                <Label>
                  {t(($) => $.field.name)} <span className="text-destructive">*</span>
                </Label>
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t(($) => $.field.name_placeholder)}
                  required
                />
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <Label>{t(($) => $.field.description)}</Label>
                <Textarea
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder={t(($) => $.field.desc_placeholder)}
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
                onClick={() => { setOpen(false); reset() }}
                disabled={saving}
              >
                {t(($) => $.dialog.cancel)}
              </Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? t(($) => $.dialog.saving) : t(($) => $.dialog.create.submit)}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default CreateCapabilityDialog

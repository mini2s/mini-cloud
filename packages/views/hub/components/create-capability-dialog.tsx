"use client"

import { useState, useMemo } from "react"
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
import { Label } from "@multica/ui/components/ui/label"
import { api } from "@multica/core/api"
import type { CapabilityItem } from "@multica/core/types/hub"
import { useHubFilterOptions, useHubMyRepos } from "@multica/core/hub"
import { useT } from "@multica/views/i18n"
import { toast } from "sonner"
import { Plus, Upload, X } from "lucide-react"
import { TYPE_COLORS } from "../lib/type-colors"

const ITEM_TYPES = ["skill", "subagent", "command", "mcp", "plugin"] as const
type ItemType = (typeof ITEM_TYPES)[number]

const TYPE_LABEL_KEY: Record<string, string> = {
  skill: "hub.capability.type.skill",
  subagent: "hub.capability.type.subagent",
  command: "hub.capability.type.command",
  mcp: "hub.capability.type.mcp",
  plugin: "hub.capability.type.plugin",
}

// Mirrors the source store's TYPE_CONTENT_PLACEHOLDER.
const TYPE_CONTENT_PLACEHOLDER: Record<string, string> = {
  skill: "# SKILL\n\nDescribe what this skill does...",
  subagent: "# Subagent\n\nDescribe the subagent behavior...",
  command: "# Command\n\nDescribe the command behavior...",
  mcp: '{\n  "mcpServers": {\n      \n  }\n}',
  plugin: '{\n  "install": {\n    "plugin_name": "",\n    "marketplace_name": "",\n    "marketplace_repo": ""\n  }\n}',
}

const ACCEPTED_ARCHIVE_TYPES = ".zip,.tar.gz,.tgz"

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function isArchive(name: string) {
  const file = name.toLowerCase()
  return [".zip", ".tar.gz", ".tgz"].some((ext) => file.endsWith(ext))
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

/** Whether the item type supports archive (file) upload, matching canArchive. */
function canArchive(type: string) {
  return type === "skill" || type === "mcp" || type === "plugin"
}

export type CreateCapabilityDialogProps = {
  onCreated: (item: CapabilityItem) => void
  /** Preset the item type (e.g. "plugin" for the "上传 Plugin" button). */
  defaultItemType?: string
  /** Externally controlled open state (no built-in trigger button rendered). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function CreateCapabilityDialog(props: CreateCapabilityDialogProps) {
  const { t } = useT("hub")
  const { data: filterOpts } = useHubFilterOptions()
  const { repos } = useHubMyRepos()
  const categories = filterOpts?.categories ?? []

  const [internalOpen, setInternalOpen] = useState(false)
  const open = props.open ?? internalOpen
  const setOpen = props.onOpenChange ?? setInternalOpen
  const controlled = props.onOpenChange != null

  const initialType = (props.defaultItemType ?? "skill") as ItemType
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const [itemType, setItemType] = useState<ItemType>(initialType)
  const [namespace, setNamespace] = useState("public")
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugManual, setSlugManual] = useState(false)
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState("utilities")
  const [content, setContent] = useState(TYPE_CONTENT_PLACEHOLDER[initialType] ?? "")
  const [contentMode, setContentMode] = useState<"text" | "archive">("text")
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)

  // Default category to first available once categories load.
  const categoryInitialized = useMemo(() => {
    if (categories.length === 0) return category
    if (categories.some((c) => c.slug === category)) return category
    return categories[0]?.slug ?? category
  }, [categories, category])

  // Namespace options: public + user repos.
  const namespaceOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [{ value: "public", label: "public" }]
    for (const repo of repos) {
      options.push({ value: `repo:${repo.id}`, label: `@${repo.name}` })
    }
    return options
  }, [repos])

  const selectedNamespace = namespaceOptions.find((o) => o.value === namespace) ?? namespaceOptions[0]!
  const archive = canArchive(itemType)
  const mode: "text" | "archive" = archive ? contentMode : "text"

  const visibility = selectedNamespace.value === "public" ? "public" : "repo"

  function handleNameInput(value: string) {
    setName(value)
    if (!slugManual) setSlug(slugify(value))
  }

  function setItemTypeValue(value: ItemType) {
    setItemType(value)
    setContent(TYPE_CONTENT_PLACEHOLDER[value] ?? "")
    if (!slugManual) setSlug(slugify(name))
  }

  function handleFilePick(f: File | undefined | null) {
    if (!f) return
    if (!isArchive(f.name)) {
      setError(t(($) => $.capabilityDialog.content.invalid))
      return
    }
    setError("")
    setFile(f)
  }

  function reset() {
    setName("")
    setSlug("")
    setSlugManual(false)
    setDescription("")
    setNamespace("public")
    setCategory("utilities")
    setItemType((props.defaultItemType ?? "skill") as ItemType)
    setContent(TYPE_CONTENT_PLACEHOLDER[(props.defaultItemType ?? "skill") as ItemType] ?? "")
    setContentMode("text")
    setFile(null)
    setError("")
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !slug.trim()) return
    if (mode === "archive" && !file) {
      setError(t(($) => $.capabilityDialog.content.required))
      return
    }

    setSaving(true)
    setError("")
    try {
      const item = await api.hubCreateItem({
        itemType,
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || undefined,
        category: categoryInitialized,
        content: mode === "text" ? content.trim() : undefined,
        visibility,
        registryId: undefined,
        file: mode === "archive" ? file : null,
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
      {!controlled && (
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-1 size-4" />
          {t(($) => $.dialog.create_capability)}
        </Button>
      )}

      <Dialog open={open} onOpenChange={(v) => { if (!saving) setOpen(v) }}>
        <DialogContent className="sm:max-w-[720px]">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{t(($) => $.capabilityDialog.create.title)}</DialogTitle>
            </DialogHeader>

            <div className="space-y-5 py-4">
              {/* Type */}
              <div className="space-y-1.5">
                <Label>{t(($) => $.capabilityDialog.create.type)}</Label>
                <Select value={itemType} onValueChange={(v) => setItemTypeValue(v as ItemType)}>
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
                          {t(TYPE_LABEL_KEY[type] as never)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Namespace + Slug */}
              <div className="space-y-1.5">
                <Label>
                  {t(($) => $.capabilityDialog.field.ownerPackage)} <span className="text-destructive">*</span>
                </Label>
                <div className="flex items-center gap-2">
                  <Select value={namespace} onValueChange={(v) => setNamespace(v ?? "public")}>
                    <SelectTrigger className="min-w-[180px] flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {namespaceOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-muted-foreground">/</span>
                  <Input
                    value={slug}
                    onChange={(e) => { setSlug(e.target.value); setSlugManual(true) }}
                    placeholder={`my-${itemType}`}
                    className="flex-[1.2] font-mono"
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {`${selectedNamespace.label}/${slug || `my-${itemType}`}`}
                </p>
              </div>

              {/* Name */}
              <div className="space-y-1.5">
                <Label>
                  {t(($) => $.capabilityDialog.field.displayName)} <span className="text-destructive">*</span>
                </Label>
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => handleNameInput(e.target.value)}
                  placeholder={t(($) => $.capabilityDialog.field.displayNamePlaceholder, { type: itemType })}
                  required
                />
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <Label>{t(($) => $.capabilityDialog.field.description)}</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t(($) => $.capabilityDialog.field.descriptionPlaceholder)}
                />
              </div>

              {/* Category + Visibility */}
              <div className="flex gap-4">
                <div className="flex-1 space-y-1.5">
                  <Label>
                    {t(($) => $.capabilityDialog.field.category)} <span className="text-destructive">*</span>
                  </Label>
                  <Select value={categoryInitialized} onValueChange={(v) => setCategory(v ?? "utilities")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.slug} value={c.slug}>
                          {c.names?.["zh-Hans"] ?? c.names?.["en"] ?? c.slug}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 space-y-1.5">
                  <Label>{t(($) => $.capabilityDialog.field.visibility)}</Label>
                  <div className="flex h-9 items-center rounded-md border border-input px-3 text-sm text-muted-foreground opacity-60">
                    {visibility === "public"
                      ? t(($) => $.capabilityDialog.visibility.public)
                      : t(($) => $.capabilityDialog.visibility.repository)}
                  </div>
                </div>
              </div>

              {/* Content (text / archive) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{t(($) => $.capabilityDialog.field.content)}</Label>
                  {archive && (
                    <div className="flex items-center gap-2">
                      {(["text", "archive"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          className={
                            "rounded-md border px-3 py-1.5 text-sm transition-colors " +
                            (mode === m
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground")
                          }
                          onClick={() => { setContentMode(m); setError("") }}
                        >
                          {t(($) => $.capabilityDialog.content[m])}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {mode === "text" ? (
                  <Textarea
                    value={content}
                    onChange={(e) => { setContent(e.target.value); setError("") }}
                    rows={6}
                    className="font-mono"
                  />
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    className={
                      "rounded-xl p-5 transition-colors outline-none " +
                      (file
                        ? "cursor-pointer border border-border"
                        : dragOver
                          ? "border border-primary bg-primary/5"
                          : "cursor-pointer border-2 border-dashed border-border hover:border-primary/40")
                    }
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFilePick(e.dataTransfer.files?.[0]) }}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={(e) => { e.preventDefault(); setDragOver(false) }}
                    onClick={() => document.getElementById("create-cap-file")?.click()}
                  >
                    <input
                      id="create-cap-file"
                      type="file"
                      accept={ACCEPTED_ARCHIVE_TYPES}
                      className="hidden"
                      onChange={(e) => { handleFilePick(e.currentTarget.files?.[0]); e.currentTarget.value = "" }}
                    />
                    {file ? (
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{file.name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{formatBytes(file.size)}</div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="shrink-0"
                          onClick={(e) => { e.stopPropagation(); setError(""); setFile(null) }}
                        >
                          <X className="mr-1 size-3.5" />
                          {t(($) => $.capabilityDialog.content.remove)}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 py-6 text-center text-muted-foreground">
                        <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Upload className="size-5" />
                        </div>
                        <div className="text-sm">{t(($) => $.capabilityDialog.content.dropHint)}</div>
                        <div className="text-xs">{t(($) => $.capabilityDialog.content.accepted)}</div>
                      </div>
                    )}
                  </div>
                )}
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
              <Button type="submit" disabled={saving || !name.trim() || !slug.trim()}>
                {saving
                  ? mode === "archive"
                    ? t(($) => $.capabilityDialog.content.uploading)
                    : t(($) => $.capabilityDialog.create.submitting)
                  : t(($) => $.capabilityDialog.create.submit)}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

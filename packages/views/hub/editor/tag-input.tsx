"use client"

// Tag input for the capability editor (task 13 / FR-15) — migrated from the
// source console `components/tag-input.tsx`.
//
// Free-form tag creation with normalization (trim, lowercase, spaces collapse
// to dashes, dedupe) plus suggestions from the hub filter-options catalog.
// Values are tag slugs; the publish layer maps known slugs back to ids and
// passes new labels through verbatim (the backend creates them), matching the
// source semantics.

import { useMemo, useRef, useState } from "react"
import { X } from "lucide-react"
import { Badge } from "@multica/ui/components/ui/badge"
import { Input } from "@multica/ui/components/ui/input"
import { cn } from "@multica/ui/lib/utils"
import { useT } from "@multica/views/i18n"
import type { ItemTag } from "@multica/core/types/hub"

/** Normalize a raw tag token: lowercase, trimmed, inner whitespace -> single
 *  dash, strip characters outside letters/digits/underscore/dash/CJK. */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
}

export interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  /** Catalog tags for autocomplete suggestions (optional). */
  suggestions?: ItemTag[]
  placeholder?: string
  disabled?: boolean
}

export function TagInput({ value, onChange, suggestions, placeholder, disabled }: TagInputProps) {
  const { t } = useT("hub")
  const [draft, setDraft] = useState("")
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = normalizeTag(draft)
    const catalog = suggestions ?? []
    return catalog
      .filter((tag) => !value.includes(tag.slug))
      .filter((tag) => !q || tag.slug.includes(q))
      .slice(0, 8)
  }, [draft, suggestions, value])

  const addTag = (raw: string) => {
    const tag = normalizeTag(raw)
    if (!tag) return
    if (!value.includes(tag)) onChange([...value, tag])
    setDraft("")
  }

  const removeTag = (tag: string) => {
    onChange(value.filter((v) => v !== tag))
  }

  const commitDraft = () => {
    if (draft.trim()) addTag(draft)
  }

  return (
    <div
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5",
        "focus-within:ring-1 focus-within:ring-ring",
        disabled && "cursor-not-allowed opacity-60",
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag) => (
        <Badge key={tag} variant="secondary" className="gap-1 pr-1 text-xs">
          {tag}
          <button
            type="button"
            aria-label={t(($) => $.editor.tags.remove, { tag })}
            className="rounded-full p-0.5 hover:bg-background/60"
            onClick={(e) => {
              e.stopPropagation()
              if (!disabled) removeTag(tag)
            }}
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}

      <div className="relative min-w-24 flex-1">
        <Input
          ref={inputRef}
          value={draft}
          disabled={disabled}
          placeholder={value.length === 0 ? (placeholder ?? t(($) => $.editor.tags.placeholder)) : ""}
          className="h-6 border-0 bg-transparent px-1 py-0 text-xs shadow-none focus-visible:ring-0"
          onChange={(e) => {
            setDraft(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay so a suggestion click still lands before the list closes.
            setTimeout(() => setOpen(false), 120)
            commitDraft()
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault()
              addTag(draft)
            } else if (e.key === "Backspace" && !draft && value.length > 0) {
              removeTag(value[value.length - 1]!)
            }
          }}
        />
        {open && filtered.length > 0 && (
          <div className="absolute left-0 top-full z-20 mt-1 w-full min-w-40 rounded-md border border-border bg-popover p-1 shadow-md">
            {filtered.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className="flex w-full items-center rounded-sm px-2 py-1 text-left text-xs hover:bg-accent"
                onMouseDown={(e) => {
                  e.preventDefault()
                  addTag(tag.slug)
                }}
              >
                {tag.slug}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

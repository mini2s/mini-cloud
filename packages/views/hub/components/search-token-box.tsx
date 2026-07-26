"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import { useT } from "@multica/views/i18n"
import { Popover, PopoverContent, PopoverTrigger } from "@multica/ui/components/ui/popover"
import { cn } from "@multica/ui/lib/utils"
import { HubIcon } from "../lib/hub-icons"

export interface SearchTokenBoxProps {
  value: string
  onInput: (value: string) => void
  onClear: () => void
  /** Fired on Enter (or picking the "Search" row). Receives the input's live
   *  DOM value — the controlled `value` prop can lag behind keystrokes while
   *  the internal debounce is still pending. */
  onSubmit?: (value: string) => void
  placeholder: string
  tags: string[]
  onAddTag: (slug: string) => void
  onRemoveTag: (slug: string) => void
  suggestions?: string[]
  loading?: boolean
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 pl-[11px] pr-1.5 text-xs font-bold text-primary">
      <span className="max-w-48 truncate">{label}</span>
      <button
        type="button"
        className="flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-full text-primary/80 transition-colors hover:bg-primary/20"
        onClick={onRemove}
        aria-label="remove"
      >
        <HubIcon name="x" size={11} />
      </button>
    </span>
  )
}

export function SearchTokenBox({
  value,
  onInput,
  onClear,
  onSubmit,
  placeholder,
  tags,
  onAddTag,
  onRemoveTag,
  suggestions = [],
  loading = false,
}: SearchTokenBoxProps) {
  const { t } = useT("hub")
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [composing, setComposing] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const trimmed = value.trim()
  const isOpen = open && !dismissed && !composing && trimmed.length > 0

  const filtered = useMemo(() => {
    const selected = new Set(tags)
    return suggestions.filter((s) => !selected.has(s))
  }, [suggestions, tags])

  const totalOptions = 1 + filtered.length

  useEffect(() => {
    setHighlightedIndex(0)
  }, [value, filtered.length])

  const handleInput = useCallback(
    (val: string) => {
      setDismissed(false)
      setOpen(true)
      if (debounceTimer.current) clearTimeout(debounceTimer.current!)
      debounceTimer.current = setTimeout(() => onInput(val), 300)
    },
    [onInput],
  )

  const submitNameSearch = useCallback(() => {
    // Flush the pending input debounce so the submit always carries what the
    // user actually sees in the box, not a 300ms-stale controlled value.
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
      debounceTimer.current = null
    }
    onSubmit?.(inputRef.current?.value ?? value)
    setDismissed(true)
  }, [onSubmit, value])

  const activateHighlighted = useCallback(() => {
    if (highlightedIndex <= 0) {
      submitNameSearch()
      return
    }
    const tag = filtered[highlightedIndex - 1]
    if (tag) onAddTag(tag)
  }, [highlightedIndex, filtered, submitNameSearch, onAddTag])

  return (
    <Popover open={isOpen} onOpenChange={(v) => { if (!v) setDismissed(true) }}>
      <div
        ref={anchorRef}
        className="relative flex min-h-10 min-w-0 max-w-xl flex-1 flex-wrap items-center gap-1.5 rounded-[13px] border border-border bg-background py-1 pl-[13px] pr-1 transition-[border-color,box-shadow] hover:shadow-sm focus-within:border-ring/50 focus-within:shadow-[0_0_0_3px_hsl(var(--ring)/0.15)]"
      >
        <span className="flex shrink-0 items-center text-muted-foreground">
          <HubIcon name="search" size={16} />
        </span>

        {tags.map((slug) => (
          <FilterChip key={slug} label={slug} onRemove={() => onRemoveTag(slug)} />
        ))}

        <PopoverTrigger>
          <input
            ref={inputRef}
            type="text"
            inputMode="search"
            placeholder={placeholder}
            value={value}
            role="combobox"
            aria-expanded={isOpen}
            aria-autocomplete="list"
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(e) => {
              setComposing(false)
              handleInput((e.currentTarget as HTMLInputElement).value)
            }}
            onInput={(e) => {
              if (composing || (e.nativeEvent as InputEvent).isComposing) return
              handleInput((e.currentTarget as HTMLInputElement).value)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && value.length === 0 && tags.length > 0) {
                e.preventDefault()
                onRemoveTag(tags[tags.length - 1]!)
                return
              }
              if (!isOpen) {
                if (e.key === "ArrowDown" && trimmed.length > 0) {
                  e.preventDefault()
                  setDismissed(false)
                  setOpen(true)
                }
                return
              }
              switch (e.key) {
                case "ArrowDown":
                  e.preventDefault()
                  setHighlightedIndex((i) => Math.min(i + 1, totalOptions - 1))
                  break
                case "ArrowUp":
                  e.preventDefault()
                  setHighlightedIndex((i) => Math.max(i - 1, 0))
                  break
                case "Enter":
                  e.preventDefault()
                  activateHighlighted()
                  break
                case "Escape":
                  e.preventDefault()
                  setDismissed(true)
                  break
              }
            }}
            className="h-8 min-w-24 flex-1 border-none bg-transparent text-sm font-medium text-foreground caret-primary outline-none placeholder:font-normal placeholder:text-muted-foreground/70 focus:outline-none focus-visible:outline-none"
          />
        </PopoverTrigger>

        {value.length > 0 && (
          <button
            type="button"
            aria-label="Clear"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClear}
            className="flex h-[30px] w-9 shrink-0 cursor-pointer items-center justify-center rounded-[9px] text-muted-foreground/80 transition-colors hover:text-foreground"
          >
            <HubIcon name="x" size={16} />
          </button>
        )}
      </div>

      <PopoverContent
        className="w-(--anchor-width) min-w-64 p-[7px]"
        align="start"
        sideOffset={4}
      >
        <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto" role="listbox">
          <li
            role="option"
            aria-selected={highlightedIndex === 0}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setHighlightedIndex(0)}
            onClick={submitNameSearch}
            className={cn(
              "flex cursor-pointer items-center gap-[9px] rounded-[9px] px-[9px] py-2 text-sm text-foreground transition-colors",
              highlightedIndex === 0
                ? "bg-primary/10"
                : "hover:bg-muted/50",
            )}
          >
            <HubIcon name="search" size={14} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              {`Search "${value}"`}
            </span>
          </li>

          {filtered.length > 0 && (
            <>
              <li
                role="presentation"
                className="px-[9px] pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground"
              >
                {t(($) => $.home.filter.tags)}
              </li>
              {filtered.map((tag, i) => {
                const rowIdx = i + 1
                return (
                  <li
                    key={tag}
                    role="option"
                    aria-selected={highlightedIndex === rowIdx}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHighlightedIndex(rowIdx)}
                    onClick={() => onAddTag(tag)}
                    className={cn(
                      "flex cursor-pointer items-center gap-[9px] rounded-[9px] px-[9px] py-2 text-sm text-foreground transition-colors",
                      highlightedIndex === rowIdx
                        ? "bg-primary/10"
                        : "hover:bg-muted/50",
                    )}
                  >
                    <span className="inline-flex h-4 shrink-0 items-center rounded-[5px] bg-primary/12 px-1 text-[11px] font-bold text-primary">
                      #
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {tag}
                    </span>
                  </li>
                )
              })}
            </>
          )}

          {loading && (
            <li className="flex items-center justify-center py-3 text-sm text-muted-foreground">
              <span className="size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

export default SearchTokenBox

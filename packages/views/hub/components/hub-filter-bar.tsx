"use client"

import { useState } from "react"
import { useT } from "@multica/views/i18n"
import { Popover, PopoverContent, PopoverTrigger } from "@multica/ui/components/ui/popover"
import { Checkbox } from "@multica/ui/components/ui/checkbox"
import { cn } from "@multica/ui/lib/utils"
import { HubIcon } from "../lib/hub-icons"

export interface FilterOptionItem {
  value: string
  label: string
  count?: number
}

export interface FilterGroup {
  options: FilterOptionItem[]
  appliedValues: string[]
  toggle: (value: string) => void
  reset: () => void
}

export interface HubFilterBarProps {
  type?: FilterGroup
  category: FilterGroup
  security: FilterGroup
  source: FilterGroup
  tag?: FilterGroup
  totalItems: number
  onClearAll: () => void
}

const RISK_DOT: Record<string, string> = {
  unknown: "rgb(156,163,175)",
  low: "rgb(22,163,74)",
  medium: "rgb(202,138,4)",
  high: "rgb(234,88,12)",
}

type GroupKind = "type" | "category" | "security" | "source" | "tag"

function FilterDropdown({
  kind,
  label,
  group,
}: {
  kind: GroupKind
  label: string
  group: FilterGroup
}) {
  const { t } = useT("hub")
  const [open, setOpen] = useState(false)
  const count = group.appliedValues.length
  const active = count > 0
  const isSelected = (v: string) => group.appliedValues.includes(v)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex h-[34px] cursor-pointer items-center gap-[7px] rounded-[10px] border px-3 text-[12.5px] font-bold transition-[color,border-color,background-color] duration-150",
              active
                ? "border-primary/45 bg-primary/10 text-primary"
                : "border-border/60 bg-background text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground",
            )}
          />
        }
      >
        {active && (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10.5px] font-extrabold leading-none text-primary-foreground [font-variant-numeric:tabular-nums]">
            {count}
          </span>
        )}
        <span>{label}</span>
        <HubIcon
          name="caret"
          size={13}
          className={cn("shrink-0 transition-transform duration-250 ease-out", open && "rotate-180")}
        />
      </PopoverTrigger>
      <PopoverContent className="min-w-48 p-[7px]" align="start">
        <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
          {group.options.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-[9px] rounded-[9px] px-[9px] py-2 text-sm text-foreground transition-colors hover:bg-muted/50"
              onClick={(e) => {
                e.preventDefault()
                group.toggle(option.value)
              }}
            >
              <Checkbox checked={isSelected(option.value)} className="size-[17px]" />
              {kind === "security" && (
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: RISK_DOT[option.value] ?? RISK_DOT.unknown }}
                />
              )}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.count != null && (
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground [font-variant-numeric:tabular-nums]">
                  {option.count}
                </span>
              )}
            </label>
          ))}
          {group.options.length === 0 && (
            <div className="px-2.5 py-3 text-sm text-muted-foreground">
              {t(($) => $.home.filter.noOptions)}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function FilterChip({
  label,
  dotColor,
  onRemove,
}: {
  label: string
  dotColor?: string
  onRemove: () => void
}) {
  return (
    <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 pl-[11px] pr-1.5 text-xs font-bold text-primary">
      {dotColor && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} />}
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

export function HubFilterBar({
  type,
  category,
  security,
  source,
  tag,
  totalItems,
  onClearAll,
}: HubFilterBarProps) {
  const { t } = useT("hub")

  const labelFor = (group: FilterGroup, value: string) =>
    group.options.find((o) => o.value === value)?.label ?? value

  interface Chip {
    key: string
    label: string
    dotColor?: string
    onRemove: () => void
  }

  const chips: Chip[] = []
  if (type) {
    for (const v of type.appliedValues) {
      chips.push({ key: `type:${v}`, label: labelFor(type, v), onRemove: () => type.toggle(v) })
    }
  }
  for (const v of category.appliedValues) {
    chips.push({ key: `cat:${v}`, label: labelFor(category, v), onRemove: () => category.toggle(v) })
  }
  for (const v of security.appliedValues) {
    chips.push({
      key: `risk:${v}`,
      label: labelFor(security, v),
      dotColor: RISK_DOT[v] ?? RISK_DOT.unknown,
      onRemove: () => security.toggle(v),
    })
  }
  for (const v of source.appliedValues) {
    chips.push({ key: `src:${v}`, label: labelFor(source, v), onRemove: () => source.toggle(v) })
  }
  if (tag) {
    for (const v of tag.appliedValues) {
      chips.push({ key: `tag:${v}`, label: labelFor(tag, v), onRemove: () => tag.toggle(v) })
    }
  }

  const hasAny = chips.length > 0

  return (
    <div className="flex flex-wrap items-center gap-[9px]">
      <style>{`@keyframes hub-chip-in{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:none}}`}</style>

      {type && <FilterDropdown kind="type" label={t(($) => $.home.filter.type)} group={type} />}
      <FilterDropdown kind="category" label={t(($) => $.home.filter.category)} group={category} />
      <FilterDropdown kind="security" label={t(($) => $.home.filter.risk)} group={security} />
      <FilterDropdown kind="source" label={t(($) => $.home.filter.source)} group={source} />
      {tag && <FilterDropdown kind="tag" label={t(($) => $.home.filter.tags)} group={tag} />}

      {hasAny && (
        <>
          <span className="inline-flex flex-wrap items-center gap-2">
            {chips.map((chip) => (
              <FilterChip key={chip.key} label={chip.label} dotColor={chip.dotColor} onRemove={chip.onRemove} />
            ))}
          </span>
          <button
            type="button"
            className="cursor-pointer rounded-[8px] px-2 py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            onClick={onClearAll}
          >
            {t(($) => $.home.filter.clearAll)}
          </button>
        </>
      )}
      <span className="ml-auto whitespace-nowrap text-[12.5px] font-semibold text-muted-foreground [font-variant-numeric:tabular-nums]">
        {t(($) => $.home.filter.totalItems, { count: totalItems })}
      </span>
    </div>
  )
}

export default HubFilterBar

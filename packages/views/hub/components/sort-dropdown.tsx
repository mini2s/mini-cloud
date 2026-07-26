"use client"

import { useT } from "@multica/views/i18n"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu"
import { cn } from "@multica/ui/lib/utils"
import { ArrowUpDown, Check } from "lucide-react"

export type SortOption = {
  value: string
  label: string
}

export interface SortDropdownProps {
  options: SortOption[]
  value: string
  onChange: (value: string) => void
}

export function SortDropdown({ options, value, onChange }: SortDropdownProps) {
  const { t } = useT("hub")
  const current = options.find((o) => o.value === value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-[34px] cursor-pointer items-center gap-[7px] rounded-[10px] border border-border/60 bg-background px-3 text-[12.5px] font-bold text-muted-foreground transition-colors hover:border-muted-foreground/30 hover:text-foreground">
        <ArrowUpDown size={14} />
        <span>{current?.label ?? t(($) => $.home.sort.label)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onChange(option.value)}
            className={cn(
              "cursor-pointer",
              value === option.value && "font-semibold text-primary",
            )}
          >
            {option.label}
            {value === option.value && (
              <Check size={14} className="ml-auto text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default SortDropdown

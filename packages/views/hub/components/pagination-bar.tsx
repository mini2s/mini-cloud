"use client"

import { Button } from "@multica/ui/components/ui/button"
import { cn } from "@multica/ui/lib/utils"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useT } from "@multica/views/i18n"

export interface PaginationBarProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
}

export function PaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 15, 20, 30, 50],
}: PaginationBarProps) {
  const { t } = useT("hub")
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const pages = getPageRange(page, totalPages)

  return (
    <div className="flex items-center justify-between gap-4 pt-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>
          {t(($) => $.pagination.total, { count: total })}
        </span>
        {onPageSizeChange && (
          <span className="flex items-center gap-1">
            <span>/</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="cursor-pointer rounded-md border border-border/60 bg-background px-2 py-0.5 text-xs text-foreground outline-none hover:border-muted-foreground/30"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {t(($) => $.pagination.pageSize, { count: size })}
                </option>
              ))}
            </select>
          </span>
        )}
      </div>

      <nav aria-label="pagination" className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="h-8 w-8"
        >
          <ChevronLeft size={16} />
        </Button>

        {pages.map((p, i) =>
          p === "..." ? (
            <span key={`ellipsis-${i}`} className="flex h-8 w-8 items-center justify-center text-sm text-muted-foreground">
              ...
            </span>
          ) : (
            <Button
              key={p}
              variant={page === p ? "default" : "outline"}
              size="icon"
              onClick={() => onPageChange(p as number)}
              className={cn("h-8 w-8 text-sm", page === p && "pointer-events-none")}
            >
              {p}
            </Button>
          ),
        )}

        <Button
          variant="outline"
          size="icon"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="h-8 w-8"
        >
          <ChevronRight size={16} />
        </Button>
      </nav>
    </div>
  )
}

function getPageRange(current: number, total: number): (number | "...")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }

  const result: (number | "...")[] = []
  const delta = 1

  result.push(1)

  if (current - delta > 2) {
    result.push("...")
  }

  const start = Math.max(2, current - delta)
  const end = Math.min(total - 1, current + delta)

  for (let i = start; i <= end; i++) {
    result.push(i)
  }

  if (current + delta < total - 1) {
    result.push("...")
  }

  result.push(total)

  return result
}

export default PaginationBar

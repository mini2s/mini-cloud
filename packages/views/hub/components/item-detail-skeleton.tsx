"use client"

import { Skeleton } from "@multica/ui/components/ui/skeleton"

export interface ItemDetailSkeletonProps {
  className?: string
}

export function ItemDetailSkeleton({ className }: ItemDetailSkeletonProps) {
  return (
    <div className={`overflow-hidden px-6 py-6 ${className ?? ""}`.trim()}>
      <div className="space-y-6">
        <div className="border-b border-border pb-5 pr-12">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-lg bg-muted" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-6 w-56 max-w-[60%] rounded-md bg-muted" />
                <Skeleton className="h-3.5 w-28 rounded-full bg-muted" />
              </div>
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-20 rounded-lg bg-muted" />
              <Skeleton className="h-9 w-24 rounded-lg bg-muted" />
            </div>
          </div>
          <div className="mt-4 flex w-[70%] max-w-full items-center gap-2 rounded-lg border bg-muted/30 px-4 py-2.5">
            <Skeleton className="h-4 flex-1 rounded bg-muted" />
            <Skeleton className="size-6 rounded-md bg-muted" />
          </div>
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(14rem,0.6fr)]">
          <div className="space-y-4">
            <div className="space-y-2.5">
              <Skeleton className="h-4 w-[92%] rounded bg-muted" />
              <Skeleton className="h-4 w-[84%] rounded bg-muted" />
            </div>
            <div className="rounded-xl border bg-gradient-to-b from-muted/30 to-muted/20 p-4">
              <div className="space-y-3">
                <Skeleton className="h-3.5 w-24 rounded-full bg-muted" />
                <Skeleton className="h-3.5 w-[96%] rounded bg-muted" />
                <Skeleton className="h-3.5 w-[88%] rounded bg-muted" />
                <Skeleton className="h-3.5 w-[82%] rounded bg-muted" />
                <Skeleton className="mt-2 h-88 rounded-lg bg-muted" />
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-xl border bg-muted/20 p-4">
              <div className="space-y-3">
                <Skeleton className="h-4 w-28 rounded bg-muted" />
                <Skeleton className="h-10 w-full rounded-lg bg-muted" />
                <Skeleton className="h-10 w-[85%] rounded-lg bg-muted" />
              </div>
            </div>
            <div className="rounded-xl border bg-muted/20 p-4">
              <div className="space-y-3">
                <Skeleton className="h-4 w-24 rounded bg-muted" />
                <Skeleton className="h-16 w-full rounded-lg bg-muted" />
                <Skeleton className="h-16 w-full rounded-lg bg-muted" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

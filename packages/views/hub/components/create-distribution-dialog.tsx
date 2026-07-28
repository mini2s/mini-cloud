"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@multica/ui/components/ui/dialog"
import { Button } from "@multica/ui/components/ui/button"
import { Input } from "@multica/ui/components/ui/input"
import { useHubItems } from "@multica/core/hub"
import type { CapabilityItem } from "@multica/core/types/hub"
import { useT } from "@multica/views/i18n"
import { Search } from "lucide-react"
import { cn } from "@multica/ui/lib/utils"
import { DistributeDialog } from "./distribute-dialog"

export type CreateDistributionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}

/**
 * Two-step "new distribution" entry that mirrors the source store's wizard:
 * step 1 searches and picks a capability, step 2 hands off to the existing
 * `DistributeDialog` for target/permission selection. Used on the sent tab
 * where there is no pre-selected item.
 */
export function CreateDistributionDialog(props: CreateDistributionDialogProps) {
  const { t } = useT("hub")
  const [query, setQuery] = useState("")
  const [picked, setPicked] = useState<CapabilityItem | null>(null)

  // Reset picker state each time the outer dialog opens.
  useEffect(() => {
    if (props.open) {
      setQuery("")
      setPicked(null)
    }
  }, [props.open])

  const listParams = useMemo(
    () => ({ search: query.trim() || undefined, page: 1, pageSize: 20 }),
    [query],
  )
  const { data, isLoading } = useHubItems(listParams)
  const items = data?.items ?? []

  // Step 2: render the existing distribute dialog for the picked item.
  if (picked) {
    return (
      <DistributeDialog
        item={picked}
        open={props.open}
        onOpenChange={props.onOpenChange}
        onCreated={() => {
          props.onCreated?.()
        }}
      />
    )
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t(($) => $.dialog.distribute.pick_item_title)}</DialogTitle>
          <DialogDescription>{t(($) => $.dialog.distribute.subtitle)}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(($) => $.dialog.distribute.pick_item_search_placeholder)}
            className="pl-8"
          />
        </div>

        <div className="max-h-80 overflow-y-auto">
          {isLoading && items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">…</p>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t(($) => $.dialog.distribute.pick_item_empty)}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(item)}
                    className={cn(
                      "flex w-full items-center gap-3 px-2 py-2.5 text-left transition-colors hover:bg-muted/60",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {item.name}
                      </span>
                      {item.description && (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t(($) => $.home.typeTab[item.itemType as "skill" | "subagent" | "command" | "mcp" | "plugin"])}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => props.onOpenChange(false)}
          >
            {t(($) => $.dialog.distribute.cancel)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

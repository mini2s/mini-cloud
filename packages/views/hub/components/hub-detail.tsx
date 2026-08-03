"use client"

import { useCallback } from "react"
import { ArrowLeft } from "lucide-react"
import { Button } from "@multica/ui/components/ui/button"
import { ScrollArea } from "@multica/ui/components/ui/scroll-area"
import { useNavigation } from "../../navigation"
import { useWorkspacePaths } from "@multica/core/paths"
import { useT } from "@multica/views/i18n"
import { PageHeader } from "../../layout/page-header"
import { ItemDetailContent } from "./item-detail-content"

export interface HubDetailProps {
  itemId: string
}

export function HubDetail({ itemId }: HubDetailProps) {
  const { t } = useT("hub")
  const navigation = useNavigation()
  const paths = useWorkspacePaths()

  // SD-08: detail page offers an adapter.back() action, falling back to the
  // hub home when there is no in-app history to pop (e.g. shared link).
  const handleBack = useCallback(() => {
    if (window.history.length > 1) {
      navigation.back()
    } else {
      navigation.push(paths.hub())
    }
  }, [navigation, paths])

  const handleDeleted = useCallback(() => {
    navigation.push(paths.hub())
  }, [navigation, paths])

  if (!itemId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">{"Missing item ID"}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      <PageHeader>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 mr-1 h-8 shrink-0 px-2"
          onClick={handleBack}
        >
          <ArrowLeft className="mr-1 size-4" />
          {t(($) => $.manager.backToHub)}
        </Button>
        <h1 className="truncate text-sm font-semibold">{t(($) => $.detail.title)}</h1>
      </PageHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-5xl px-4 py-6">
          <ItemDetailContent
            itemId={itemId}
            onDeleted={handleDeleted}
          />
        </div>
      </ScrollArea>
    </div>
  )
}

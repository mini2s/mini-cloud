"use client"

import { useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@multica/ui/components/ui/button"
import { ScrollArea } from "@multica/ui/components/ui/scroll-area"
import { ItemDetailContent } from "./item-detail-content"

export function HubDetail() {
  const router = useRouter()
  const params = useParams<{ itemId: string }>()
  const itemId = params?.itemId ?? ""

  const handleBack = useCallback(() => {
    if (window.history.length > 1) {
      router.back()
    } else {
      router.push("/hub")
    }
  }, [router])

  const handleDeleted = useCallback(() => {
    router.push("/hub")
  }, [router])

  if (!itemId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">{"Missing item ID"}</p>
      </div>
    )
  }

  return (
    <div className="h-full w-full">
      <ScrollArea>
        <div className="mx-auto max-w-5xl px-4 py-6">
          <Button variant="ghost" onClick={handleBack} className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {"Back"}
          </Button>

          <ItemDetailContent
            itemId={itemId}
            onDeleted={handleDeleted}
          />
        </div>
      </ScrollArea>
    </div>
  )
}

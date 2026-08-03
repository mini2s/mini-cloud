"use client"

import { useState, useCallback } from "react"
import { Share2, Check } from "lucide-react"
import { Button } from "@multica/ui/components/ui/button"
import { toast } from "sonner"
import { useWorkspacePaths } from "@multica/core/paths"
import { useNavigation } from "../../navigation"
import { useT } from "../../i18n"

export interface ShareButtonProps {
  itemId: string
}

/**
 * Detail-page share entry (D-10): copies the absolute shareable URL of the
 * item's standalone detail page (`getShareableUrl(/hub/{id})`, workspace
 * prefix included) to the clipboard and confirms with a toast.
 */
export function ShareButton({ itemId }: ShareButtonProps) {
  const { t } = useT("hub")
  const navigation = useNavigation()
  const paths = useWorkspacePaths()
  const [copied, setCopied] = useState(false)

  const handleShare = useCallback(async () => {
    const url = navigation.getShareableUrl(paths.hubDetail(itemId))
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast.success(t(($) => $.detail.toast_link_copied))
    } catch {
      toast.error(t(($) => $.detail.share_failed))
    }
  }, [navigation, paths, itemId, t])

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleShare}
      className="text-muted-foreground hover:text-foreground"
      title={t(($) => $.detail.share)}
    >
      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Share2 className="h-4 w-4" />}
      <span className="ml-1.5">{copied ? t(($) => $.detail.copied) : t(($) => $.detail.share)}</span>
    </Button>
  )
}

"use client"

import { Blocks } from "lucide-react"
import { Badge } from "@multica/ui/components/ui/badge"
import { useT } from "../../i18n"

interface FromPluginBadgeProps {
  name?: string
  className?: string
}

export default function FromPluginBadge({ name, className }: FromPluginBadgeProps) {
  const { t } = useT("hub")
  if (!name) return null

  return (
    <Badge
      variant="outline"
      className={`inline-flex max-w-full shrink-0 items-center gap-1 whitespace-nowrap px-2 py-0.5 text-[11.5px] font-medium leading-4 ${className ?? ""}`.trim()}
      title={t(($) => $.detail.fromPlugin, { name })}
    >
      <Blocks className="h-3 w-3 shrink-0 opacity-70" />
      <span className="shrink-0">{t(($) => $.detail.fromPluginLabel)}</span>
      <span className="inline-block max-w-28 truncate align-bottom">{name}</span>
    </Badge>
  )
}

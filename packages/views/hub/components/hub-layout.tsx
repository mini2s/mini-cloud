"use client"

import type { ReactNode } from "react"

interface HubLayoutProps {
  children: ReactNode
}

/**
 * SD-08: slimmed-down hub container. The dashboard route-group layout (web)
 * and the desktop app shell already mount the global <Toaster />, so this
 * layout only keeps the in-page "secondary nav + content" two-pane container.
 */
export default function HubLayout({ children }: HubLayoutProps) {
  return (
    <div className="flex h-full w-full min-h-0 overflow-x-hidden">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden">
        {children}
      </div>
    </div>
  )
}

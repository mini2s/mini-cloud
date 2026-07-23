"use client"

import type { ReactNode } from "react"
import { Toaster } from "@multica/ui/components/ui/sonner"

interface HubLayoutProps {
  children: ReactNode
}

export default function HubLayout({ children }: HubLayoutProps) {
  return (
    <>
      <div className="flex h-full w-full min-h-0 overflow-x-hidden">
        <div className="relative flex-1 min-h-0 overflow-x-hidden overflow-y-auto">
          {children}
        </div>
      </div>
      <Toaster />
    </>
  )
}

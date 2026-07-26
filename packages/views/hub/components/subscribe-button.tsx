"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@multica/ui/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@multica/ui/components/ui/tooltip"
import { cn } from "@multica/ui/lib/utils"
import { toast } from "sonner"
import { useT } from "@multica/views/i18n"
import { HubIcon } from "../lib/hub-icons"
import { formatCompact } from "../lib/format"
import { mcpListSubscribeBlocked } from "../lib/mcp-config"
import type { CapabilityItem } from "@multica/core/types"

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
}

export interface SubscribeButtonProps {
  item: CapabilityItem
  favorited: boolean
  favoriteCount: number
  pending?: boolean
  authenticated: boolean
  disabled?: boolean
  onToggle: (item: CapabilityItem) => void
  /** Called when subscribing is blocked because the MCP item has no saved
   *  config yet — the caller should guide the user to the MCP config form
   *  (e.g. scroll it into view). A toast is shown by this component. */
  onSubscribeBlocked?: (item: CapabilityItem) => void
  labels: { subscribe: string; subscribed: string; tooltip: string }
}

export function SubscribeButton(props: SubscribeButtonProps) {
  const { t } = useT("hub")
  const [animating, setAnimating] = useState(false)
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const widthAnim = useRef<Animation | null>(null)
  const prevWidth = useRef(0)

  // FLIP width animation: measure old→new width when favorited flips
  useEffect(() => {
    const btn = btnRef.current
    if (!btn) return

    widthAnim.current?.cancel()
    const nw = btn.getBoundingClientRect().width
    if (!prefersReducedMotion() && prevWidth.current && Math.abs(prevWidth.current - nw) > 0.5) {
      widthAnim.current = btn.animate(
        [{ width: `${prevWidth.current}px` }, { width: `${nw}px` }],
        { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      )
      widthAnim.current.onfinish = () => { widthAnim.current = null }
      widthAnim.current.oncancel = () => { widthAnim.current = null }
    }
    prevWidth.current = nw
  }, [props.favorited])

  // Seed prevWidth on mount
  useEffect(() => {
    prevWidth.current = btnRef.current?.getBoundingClientRect().width ?? 0
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animTimer.current) clearTimeout(animTimer.current)
      widthAnim.current?.cancel()
    }
  }, [])

  const interactive = props.authenticated && !props.disabled && !props.pending

  const triggerAnimation = useCallback(() => {
    setAnimating(false)
    if (animTimer.current) clearTimeout(animTimer.current)
    // Force reflow to flush removed animation
    void btnRef.current?.offsetWidth
    requestAnimationFrame(() => {
      setAnimating(true)
      animTimer.current = setTimeout(() => setAnimating(false), 700)
    })
  }, [])

  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation()
    if (!interactive) return
    // FR-06/F-09: an unsubscribed MCP item with un-filled config placeholders
    // (or one bound to its parent plugin runtime) cannot be subscribed directly.
    // Block the toggle, explain via toast, and let the caller surface the MCP
    // config form. Unsubscribing is never blocked.
    if (mcpListSubscribeBlocked(props.item, props.favorited)) {
      toast.warning(t(($) => $.detail.mcp.subscribeBlocked))
      props.onSubscribeBlocked?.(props.item)
      return
    }
    triggerAnimation()
    props.onToggle(props.item)
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={btnRef}
            variant="outline"
            type="button"
            aria-pressed={props.favorited}
            disabled={!interactive}
            onClick={handleClick}
            className={cn(
              "relative h-8 cursor-pointer gap-1.5 overflow-hidden rounded-full px-3.5 text-xs font-extrabold",
              "transition-[background-color,color,border-color,transform] duration-250 motion-safe:active:scale-95",
              props.favorited
                ? "border-primary/45 bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary"
                : "text-foreground hover:border-muted-foreground/60",
            )}
          />
        }
      >
          {/* Ping halo */}
          {animating && (
            <span
              aria-hidden="true"
              className="motion-safe:animate-store-ping pointer-events-none absolute left-3.5 top-1/2 size-4.5 -translate-x-0.5 -translate-y-1/2 rounded-full border-2 border-primary"
              onAnimationEnd={() => setAnimating(false)}
            />
          )}

          {/* Bell icon — cross-fade stroke ↔ filled */}
          <span
            className={cn(
              "relative inline-flex size-3.5 shrink-0 transition-transform duration-[400ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]",
              animating && "motion-safe:animate-bell-once",
            )}
          >
            <HubIcon
              name="bell"
              size={14}
              className={cn(
                "absolute inset-0 transition-opacity duration-[250ms] ease-out",
                props.favorited ? "opacity-0" : "opacity-100",
              )}
              style={{ color: "currentColor" }}
            />
            <HubIcon
              name="bell"
              size={14}
              className={cn(
                "absolute inset-0 transition-opacity duration-[250ms] ease-out",
                props.favorited ? "opacity-100" : "opacity-0",
              )}
              style={{ color: "currentColor" }}
            />
          </span>

          {/* Label */}
          <span className="inline-flex shrink-0 items-center justify-center whitespace-nowrap">
            {props.favorited ? props.labels.subscribed : props.labels.subscribe}
          </span>

          {/* Count */}
          <span
            className={cn(
              "font-bold [font-variant-numeric:tabular-nums] transition-colors duration-[250ms] ease-out",
              props.favorited ? "text-primary/80" : "text-muted-foreground",
            )}
          >
            {formatCompact(props.favoriteCount)}
          </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {props.labels.tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Tooltip, TooltipTrigger, TooltipContent } from "@multica/ui/components/ui/tooltip"
import { cn } from "@multica/ui/lib/utils"
import { HubIcon } from "../lib/hub-icons"
import type { CapabilityItem } from "@multica/core/types"

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
}

function formatCompact(n: number) {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
}

export interface SubscribeButtonProps {
  item: CapabilityItem
  favorited: boolean
  favoriteCount: number
  pending?: boolean
  authenticated: boolean
  disabled?: boolean
  onToggle: (item: CapabilityItem) => void
  labels: { subscribe: string; subscribed: string; tooltip: string }
}

export function SubscribeButton(props: SubscribeButtonProps) {
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
    triggerAnimation()
    props.onToggle(props.item)
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            ref={btnRef}
            type="button"
            aria-pressed={props.favorited}
            disabled={!interactive}
            onClick={handleClick}
            className={cn(
              "store-subscribe-btn relative inline-flex h-8 cursor-pointer items-center gap-[7px] overflow-hidden whitespace-nowrap rounded-full border px-[13px] text-[12.5px] font-extrabold",
              "[transition:background-color_0.25s_cubic-bezier(0.22,1,0.36,1),color_0.25s_cubic-bezier(0.22,1,0.36,1),border-color_0.25s_cubic-bezier(0.22,1,0.36,1),transform_0.12s_cubic-bezier(0.34,1.56,0.64,1)]",
              "active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-50",
              props.favorited
                ? "border-[color:color-mix(in_oklab,var(--native-primary)_45%,transparent)] bg-[color:color-mix(in_oklab,var(--native-primary)_15%,transparent)] text-[var(--native-primary)]"
                : "border-[color:color-mix(in_oklab,var(--native-foreground)_11%,transparent)] bg-[color:color-mix(in_oklab,var(--native-foreground)_4%,transparent)] text-[var(--native-foreground)] hover:border-[var(--native-dim)]",
            )}
          />
        }
      >
          {/* Ping halo */}
          {animating && (
            <span
              aria-hidden="true"
              className="animate-store-ping pointer-events-none absolute left-[13px] top-1/2 size-[18px] -translate-x-[2px] -translate-y-1/2 rounded-full border-2 border-[var(--native-primary)]"
              onAnimationEnd={() => setAnimating(false)}
            />
          )}

          {/* Bell icon — cross-fade stroke ↔ filled */}
          <span
            className={cn(
              "relative inline-flex size-[14px] shrink-0 transition-transform duration-[400ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]",
              animating && "animate-bell-once",
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
              props.favorited
                ? "text-[color:color-mix(in_oklab,var(--native-primary)_80%,var(--native-foreground))]"
                : "text-[var(--native-muted)]",
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
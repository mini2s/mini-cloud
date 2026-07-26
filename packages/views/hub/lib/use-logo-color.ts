// Logo dominant-color extraction for 大客户 branding (FR-07), migrated from the
// source project's `store/lib/use-logo-color.ts` (SolidJS) to a React hook.
//
// Pipeline: load the logo image → draw it downsampled onto a 32×32 canvas →
// quantize pixels into 5-bit buckets → pick the most frequent meaningful color
// (skipping transparent / near-white / near-black) → `#rrggbb`.
//
// The result is cached in a module-level Map keyed by the logo source, so any
// number of cards/details sharing one logo extract its color only once.
//
// The extracted color is NOT registered as a global design token. Callers inject
// it as a component-local CSS variable (e.g. `--hub-brand`) via inline style and
// express backgrounds as `color-mix(in oklab, var(--hub-brand) X%, var(--card))`,
// which converges onto `--card` in dark theme automatically. When the logo is
// missing or extraction fails, the hook resolves to the fallback (`var(--card)`
// by default), so `color-mix` expressions degrade to the plain card color.

import { useEffect, useState } from "react"

// Cache extracted colors per logo source so repeated cards sharing one logo extract only once.
const LOGO_COLOR_CACHE = new Map<string, string>()
const DEFAULT_FALLBACK = "var(--card)"

/**
 * Extract a representative brand color from a logo image (base64 data URI or
 * same-origin URL) using a downsampled canvas.
 *
 * Behavior:
 * - Returns the `fallback` (default `var(--card)`) until extraction completes,
 *   and on any failure (no logo, SSR/no document, image/canvas error,
 *   all-transparent image).
 * - Caches by logo string; cache hits resolve synchronously on first render.
 * - Picks the most frequent non-white / non-near-black / non-transparent
 *   quantized color.
 */
export function useLogoColor(logo: string | undefined, fallback: string = DEFAULT_FALLBACK): string {
  const [color, setColor] = useState<string>(() => {
    if (!logo) return fallback
    return LOGO_COLOR_CACHE.get(logo) ?? fallback
  })

  useEffect(() => {
    if (!logo) {
      setColor(fallback)
      return
    }

    const cached = LOGO_COLOR_CACHE.get(logo)
    if (cached) {
      setColor(cached)
      return
    }

    // SSR / non-browser guard.
    if (typeof document === "undefined" || typeof Image === "undefined") {
      setColor(fallback)
      return
    }

    setColor(fallback)
    let disposed = false

    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      if (disposed) return
      const extracted = extractDominantColor(img)
      if (extracted) {
        LOGO_COLOR_CACHE.set(logo, extracted)
        setColor(extracted)
      } else {
        setColor(fallback)
      }
    }
    img.onerror = () => {
      if (disposed) return
      setColor(fallback)
    }
    img.src = logo

    // A still-loading image whose row unmounts (filter/page/refresh) must not
    // setState on an unmounted component.
    return () => {
      disposed = true
    }
  }, [logo, fallback])

  return color
}

const SAMPLE_SIZE = 32

/** Draw the image downsampled and return the most frequent meaningful color as `#rrggbb`, or null. */
function extractDominantColor(img: HTMLImageElement): string | null {
  try {
    const canvas = document.createElement("canvas")
    canvas.width = SAMPLE_SIZE
    canvas.height = SAMPLE_SIZE
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) return null

    ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
    const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)

    const counts = new Map<string, { count: number; r: number; g: number; b: number }>()
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!
      const g = data[i + 1]!
      const b = data[i + 2]!
      const a = data[i + 3]!

      if (a < 128) continue // skip transparent
      if (r > 240 && g > 240 && b > 240) continue // skip near-white
      if (r < 24 && g < 24 && b < 24) continue // skip near-black

      // Quantize to 5-bit buckets to merge similar shades.
      const key = `${r >> 3}-${g >> 3}-${b >> 3}`
      const entry = counts.get(key)
      if (entry) {
        entry.count += 1
        entry.r += r
        entry.g += g
        entry.b += b
      } else {
        counts.set(key, { count: 1, r, g, b })
      }
    }

    let best: { count: number; r: number; g: number; b: number } | undefined
    for (const entry of counts.values()) {
      if (!best || entry.count > best.count) best = entry
    }
    if (!best) return null

    const r = Math.round(best.r / best.count)
    const g = Math.round(best.g / best.count)
    const b = Math.round(best.b / best.count)
    return toHex(r, g, b)
  } catch {
    // Canvas may be tainted (cross-origin) or unavailable — fall back.
    return null
  }
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, "0")
  return `#${h(r)}${h(g)}${h(b)}`
}

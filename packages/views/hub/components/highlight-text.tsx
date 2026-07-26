"use client"

import { Fragment, useMemo } from "react"

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

interface Segment {
  text: string
  highlight: boolean
}

// splitByQuery splits `text` into segments, marking the parts that match any
// whitespace-separated term of `query` (case-insensitive). Mirrors the source
// project's HighlightText (store-capability-table.tsx).
function splitByQuery(text: string, query?: string): Segment[] {
  const q = query?.trim()
  if (!q) return [{ text, highlight: false }]
  const terms = Array.from(
    new Set(
      q
        .split(/\s+/)
        .filter(Boolean)
        .map((term) => term.toLowerCase()),
    ),
  )
  if (terms.length === 0) return [{ text, highlight: false }]
  const regex = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi")
  const termSet = new Set(terms)
  return text
    .split(regex)
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, highlight: termSet.has(part.toLowerCase()) }))
}

export interface HighlightTextProps {
  text: string
  query?: string
}

// HighlightText renders `text` with search-keyword hits wrapped in <mark>.
// Styling uses semantic tokens only (bg-warning/40 + text-foreground) so it
// stays readable in both light and dark themes.
export function HighlightText({ text, query }: HighlightTextProps) {
  const segments = useMemo(() => splitByQuery(text, query), [text, query])

  if (segments.length === 1 && !segments[0]!.highlight) return <>{text}</>

  return (
    <>
      {segments.map((seg, i) =>
        seg.highlight ? (
          <mark key={i} className="rounded-sm bg-warning/40 px-0.5 text-foreground">
            {seg.text}
          </mark>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        ),
      )}
    </>
  )
}

export default HighlightText

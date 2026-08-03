"use client"

import { useT } from "../../i18n"

interface HealthSignals {
  freshness: number
  popularity: number
  source_trust: number
  manifest_completeness?: number
}

interface HealthRadarProps {
  signals: HealthSignals
  accent?: string
}

type SignalKey = "popularity" | "freshness" | "source_trust" | "manifest_completeness"

interface Axis {
  key: SignalKey
  label: (t: ReturnType<typeof useT<"hub">>["t"]) => string
  angle: number
}

const AXES_3: Axis[] = [
  {
    key: "popularity",
    label: (t) => t(($) => $.detail.health.popularity),
    angle: -90,
  },
  {
    key: "freshness",
    label: (t) => t(($) => $.detail.health.freshness),
    angle: 30,
  },
  {
    key: "source_trust",
    label: (t) => t(($) => $.detail.health.source_trust),
    angle: 150,
  },
]

const AXES_4: Axis[] = [
  {
    key: "popularity",
    label: (t) => t(($) => $.detail.health.popularity),
    angle: -90,
  },
  {
    key: "manifest_completeness",
    label: (t) => t(($) => $.detail.health.manifest_completeness),
    angle: 0,
  },
  {
    key: "freshness",
    label: (t) => t(($) => $.detail.health.freshness),
    angle: 90,
  },
  {
    key: "source_trust",
    label: (t) => t(($) => $.detail.health.source_trust),
    angle: 180,
  },
]

const PAD_X = 80
const PAD_Y = 30
const RADIUS = 65
const CX = PAD_X + RADIUS
const CY = PAD_Y + RADIUS
const WIDTH = 2 * (PAD_X + RADIUS)
const HEIGHT = 2 * (PAD_Y + RADIUS)
const GRID_LEVELS = [0.25, 0.5, 0.75, 1]

function polar(angle: number, r: number) {
  const rad = (angle * Math.PI) / 180
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) }
}

interface LabelPos {
  x: number
  y: number
  anchor: "start" | "middle" | "end"
}

const LABEL_POS_3: Record<SignalKey, LabelPos> = {
  popularity: { x: CX, y: PAD_Y - 14, anchor: "middle" },
  freshness: { x: WIDTH - 16, y: CY + RADIUS * 0.6, anchor: "end" },
  source_trust: { x: 16, y: CY + RADIUS * 0.6, anchor: "start" },
  manifest_completeness: { x: CX, y: CY, anchor: "middle" },
}

const LABEL_POS_4: Record<SignalKey, LabelPos> = {
  popularity: { x: CX, y: PAD_Y - 14, anchor: "middle" },
  manifest_completeness: { x: WIDTH - 16, y: CY, anchor: "end" },
  freshness: { x: CX, y: HEIGHT - PAD_Y + 18, anchor: "middle" },
  source_trust: { x: 16, y: CY, anchor: "start" },
}

export default function HealthRadar({ signals, accent }: HealthRadarProps) {
  const { t } = useT("hub")
  const a = accent ?? "var(--color-primary)"
  const hasManifest = signals.manifest_completeness != null
  const axes = hasManifest ? AXES_4 : AXES_3
  const labelPos = hasManifest ? LABEL_POS_4 : LABEL_POS_3
  const gridColor = "var(--color-border)"
  const labelColor = "var(--color-muted-foreground)"

  const val = (key: SignalKey) => signals[key] || 0

  const dataPts = axes.map((ax) => polar(ax.angle, RADIUS * (val(ax.key) / 100)))
  const dataPath = dataPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + "Z"

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="mx-auto block"
      style={{ maxWidth: `${WIDTH}px`, height: "auto" }}
    >
      {GRID_LEVELS.map((level) => {
        const d =
          axes
            .map((ax, i) => {
              const p = polar(ax.angle, RADIUS * level)
              return `${i === 0 ? "M" : "L"}${p.x},${p.y}`
            })
            .join(" ") + "Z"
        return <path key={level} d={d} fill="none" stroke={gridColor} strokeWidth={1} />
      })}

      {axes.map((ax) => {
        const end = polar(ax.angle, RADIUS)
        return <line key={ax.key} x1={CX} y1={CY} x2={end.x} y2={end.y} stroke={gridColor} strokeWidth={1} />
      })}

      <path d={dataPath} fill={`color-mix(in srgb, ${a} 15%, transparent)`} stroke={a} strokeWidth={2} />

      {dataPts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={a} />
      ))}

      {axes.map((ax) => {
        const lp = labelPos[ax.key]
        return (
          <text
            key={ax.key}
            x={lp.x}
            y={lp.y}
            textAnchor={lp.anchor}
            dominantBaseline="middle"
            fill={labelColor}
            style={{ fontSize: "11px" }}
          >
            {ax.label(t)} ({Math.round(val(ax.key))})
          </text>
        )
      })}
    </svg>
  )
}

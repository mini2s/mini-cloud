import {
  LayoutGrid,
  Rows3,
  ChevronDown,
  X,
  Check,
  Layers,
  Zap,
  Puzzle,
  Terminal,
  Bot,
  Blocks,
  Search,
  Cloud,
  Upload,
  Download,
  Star,
  Bell,
  Clock,
  BadgeCheck,
  CircleCheck,
} from "lucide-react"
import type { FC } from "react"
import type { LucideProps } from "lucide-react"

export type HubIconName =
  | "skill"
  | "mcp"
  | "command"
  | "subagent"
  | "plugin"
  | "all"
  | "search"
  | "cloud"
  | "upload"
  | "download"
  | "star"
  | "bell"
  | "clock"
  | "layers"
  | "badgeCheck"
  | "checkCircle"
  | "grid"
  | "rows"
  | "caret"
  | "x"
  | "check"

type IconComponent = FC<LucideProps>

const ICONS: Record<HubIconName, IconComponent> = {
  skill: Zap,
  mcp: Puzzle,
  command: Terminal,
  subagent: Bot,
  plugin: Blocks,
  all: LayoutGrid,
  search: Search,
  cloud: Cloud,
  upload: Upload,
  download: Download,
  star: Star,
  bell: Bell,
  clock: Clock,
  layers: Layers,
  badgeCheck: BadgeCheck,
  checkCircle: CircleCheck,
  grid: LayoutGrid,
  rows: Rows3,
  caret: ChevronDown,
  x: X,
  check: Check,
}

export interface HubIconProps {
  name: HubIconName
  size?: number
  className?: string
  style?: React.CSSProperties
}

export function HubIcon({ name, size = 16, className, style }: HubIconProps) {
  const Icon = ICONS[name]
  return <Icon size={size} className={className} style={style} aria-hidden={true} />
}

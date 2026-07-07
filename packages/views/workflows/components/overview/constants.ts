export const LANE_HEIGHT = 160;
export const GRADIENT_HEIGHT = 16;
export const LANE_STEP = LANE_HEIGHT + GRADIENT_HEIGHT; // 176
export const LANE_PADDING_TOP = 12;
export const PANORAMA_WIDTH = 2400;

export const WORKER_WIDTH = 224;
export const WORKER_HEIGHT = 80;
export const CRITIC_WIDTH = 144;
export const CRITIC_HEIGHT = 48;
export const WORKER_CRITIC_GAP = 20;

export const STAGE_COLOR_PALETTE = [
  {
    bgClass: "bg-slate-100/80",
    lineClass: "text-slate-300",
    barClass: "border-l-slate-300/80",
    markerColor: "rgb(203 213 225)",
  },
  {
    bgClass: "bg-stone-100/80",
    lineClass: "text-stone-300",
    barClass: "border-l-stone-300/80",
    markerColor: "rgb(214 211 209)",
  },
  {
    bgClass: "bg-blue-100/60",
    lineClass: "text-blue-300",
    barClass: "border-l-blue-300/80",
    markerColor: "rgb(147 197 253)",
  },
  {
    bgClass: "bg-rose-100/60",
    lineClass: "text-rose-300",
    barClass: "border-l-rose-300/80",
    markerColor: "rgb(253 164 175)",
  },
  {
    bgClass: "bg-violet-100/60",
    lineClass: "text-violet-300",
    barClass: "border-l-violet-300/80",
    markerColor: "rgb(196 181 253)",
  },
  {
    bgClass: "bg-amber-100/60",
    lineClass: "text-amber-300",
    barClass: "border-l-amber-300/80",
    markerColor: "rgb(252 211 77)",
  },
] as const;

export function getStageColorIndex(index: number): number {
  return Math.abs(index) % STAGE_COLOR_PALETTE.length;
}

export function getStageColor(index: number): (typeof STAGE_COLOR_PALETTE)[number] {
  return STAGE_COLOR_PALETTE[getStageColorIndex(index)]!;
}

export const STAGE_BG_COLORS = STAGE_COLOR_PALETTE.map((color) => color.bgClass);
export const STAGE_LINE_COLORS = STAGE_COLOR_PALETTE.map((color) => color.lineClass);
export const STAGE_COLOR_BAR_CLASSES = STAGE_COLOR_PALETTE.map((color) => color.barClass);
export const STAGE_MARKER_COLORS = STAGE_COLOR_PALETTE.map((color) => color.markerColor);

export const STAGE_TRANSITION_GRADIENTS = [
  "bg-gradient-to-b from-slate-100/60 to-stone-100/60",
  "bg-gradient-to-b from-stone-100/60 to-blue-100/50",
  "bg-gradient-to-b from-blue-100/50 to-rose-100/50",
  "bg-gradient-to-b from-rose-100/50 to-violet-100/50",
  "bg-gradient-to-b from-violet-100/50 to-amber-100/50",
  "bg-gradient-to-b from-amber-100/50 to-slate-100/60",
] as const;

export function UNASSIGNED_LANE_Y(stagesLength: number): number {
  return stagesLength * LANE_STEP + 16;
}

export function computeLaneY(sortOrder: number): number {
  return sortOrder * LANE_STEP + LANE_PADDING_TOP;
}

export function sortStagesForDisplay<T extends { sort_order: number; created_at?: string; id: string }>(stages: T[]): T[] {
  return [...stages].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    if ((a.created_at ?? "") !== (b.created_at ?? "")) return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    return a.id.localeCompare(b.id);
  });
}

export function createStageVisualIndexMap<T extends { sort_order: number; created_at?: string; id: string }>(
  stages: T[],
): Map<string, number> {
  return new Map(sortStagesForDisplay(stages).map((stage, index) => [stage.id, index]));
}

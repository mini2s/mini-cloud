export const LANE_HEIGHT = 128;
export const GRADIENT_HEIGHT = 8;
export const LANE_STEP = LANE_HEIGHT + GRADIENT_HEIGHT; // 136
export const LANE_PADDING_TOP = 12;
export const PANORAMA_WIDTH = 2400;

export const WORKER_WIDTH = 224;
export const WORKER_HEIGHT = 64;
export const CRITIC_WIDTH = 144;
export const CRITIC_HEIGHT = 48;
export const WORKER_CRITIC_GAP = 20;

export const STAGE_BG_COLORS = [
  "bg-slate-50/70",
  "bg-stone-50/70",
  "bg-blue-50/45",
  "bg-rose-50/45",
  "bg-violet-50/45",
  "bg-amber-50/45",
] as const;

export const STAGE_LINE_COLORS = [
  "text-slate-300",
  "text-stone-300",
  "text-blue-300",
  "text-rose-300",
  "text-violet-300",
  "text-amber-300",
] as const;

export const STAGE_TRANSITION_GRADIENTS = [
  "bg-gradient-to-b from-slate-50/40 to-stone-50/40",
  "bg-gradient-to-b from-stone-50/40 to-blue-50/35",
  "bg-gradient-to-b from-blue-50/35 to-rose-50/35",
  "bg-gradient-to-b from-rose-50/35 to-violet-50/35",
  "bg-gradient-to-b from-violet-50/35 to-amber-50/35",
  "bg-gradient-to-b from-amber-50/35 to-slate-50/40",
] as const;

export function UNASSIGNED_LANE_Y(stagesLength: number): number {
  return stagesLength * LANE_STEP + 16;
}

export function computeLaneY(sortOrder: number): number {
  return sortOrder * LANE_STEP + LANE_PADDING_TOP;
}

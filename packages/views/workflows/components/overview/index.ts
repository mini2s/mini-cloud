// New unified panorama page
export { WorkflowPanoramaPage } from "./workflow-panorama-page";
export type { WorkflowPanoramaPageProps } from "./workflow-panorama-page";

// New components
export { PanoramaToolbar } from "./panorama-toolbar";
export type { PanoramaToolbarProps } from "./panorama-toolbar";
export { CanvasStageLabels } from "./canvas-stage-labels";
export type { CanvasStageLabelsProps } from "./canvas-stage-labels";

// New ReactFlow custom nodes/edges
export { panoramaNodeTypes } from "./reactflow-nodes";
export { panoramaEdgeTypes } from "./reactflow-edges";

// New constants
export {
  LANE_HEIGHT,
  GRADIENT_HEIGHT,
  LANE_STEP,
  LANE_PADDING_TOP,
  PANORAMA_WIDTH,
  WORKER_WIDTH,
  WORKER_HEIGHT,
  CRITIC_WIDTH,
  CRITIC_HEIGHT,
  WORKER_CRITIC_GAP,
  STAGE_BG_COLORS,
  STAGE_LINE_COLORS,
  STAGE_TRANSITION_GRADIENTS,
  UNASSIGNED_LANE_Y,
  computeLaneY,
} from "./constants";

// Reused from old architecture
export { StageLane } from "./stage-lane";
export type { StageLaneProps } from "./stage-lane";
export { CompactNodeCard } from "./compact-node-card";
export type { CompactNodeCardProps } from "./compact-node-card";
export { CriticBadge } from "./critic-badge";
export type { CriticBadgeProps } from "./critic-badge";
export { PanoramaSvgOverlay } from "./panorama-svg-overlay";
export type { PanoramaSvgOverlayProps, EdgePath } from "./panorama-svg-overlay";
export { StageCreateDialog } from "./stage-create-dialog";

// Keep these for backward compat until confirmed unused
export { WorkflowOverviewPage } from "./workflow-overview-page";
export { ArchitectureDetailPanel } from "./architecture-detail-panel";

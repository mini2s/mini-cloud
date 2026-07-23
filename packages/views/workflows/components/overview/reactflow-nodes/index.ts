export { LaneBgNode } from "./lane-bg-node";
export type { LaneBgNodeData } from "./lane-bg-node";

export { GradientBgNode } from "./gradient-bg-node";
export type { GradientBgNodeData } from "./gradient-bg-node";

export { CompactWorkerNode } from "./compact-worker-node";
export type { CompactWorkerNodeData } from "./compact-worker-node";

export { CriticBadgeNode } from "./critic-badge-node";
export type { CriticBadgeNodeData } from "./critic-badge-node";

export { BoundaryNode, BOUNDARY_HEIGHT, BOUNDARY_WIDTH } from "./boundary-node";
export type { BoundaryNodeData } from "./boundary-node";

import { LaneBgNode } from "./lane-bg-node";
import { GradientBgNode } from "./gradient-bg-node";
import { CompactWorkerNode } from "./compact-worker-node";
import { CriticBadgeNode } from "./critic-badge-node";
import { BoundaryNode } from "./boundary-node";

export const panoramaNodeTypes = {
  laneBg: LaneBgNode,
  gradientBg: GradientBgNode,
  compactWorker: CompactWorkerNode,
  criticBadge: CriticBadgeNode,
  boundary: BoundaryNode,
};

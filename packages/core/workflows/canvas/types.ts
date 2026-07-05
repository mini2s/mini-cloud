import type {
  CriticType,
  NodeRunStatus,
  NodeShape,
  WorkerType,
  WorkflowEdge,
  WorkflowNode,
  WorkflowStage,
} from "../../types";

export type CanvasMode = "edit" | "readonly-definition" | "readonly-runtime";

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasStage {
  id: string;
  workflowId: string;
  name: string;
  description: string;
  sortOrder: number;
  nodeCount: number;
  source: WorkflowStage | null;
  isVirtual: boolean;
}

export interface RuntimeNodeOverlay {
  nodeRunId: string;
  workflowRunId: string;
  status: NodeRunStatus;
  retryCount: number;
  workerOutput: unknown;
  criticOutput: unknown;
  criticComment: string;
  startedAt: string | null;
  completedAt: string | null;
  sessionId: string | null;
  runtimeId: string | null;
  deviceId: string | null;
}

export interface CanvasNode {
  id: string;
  workflowId: string;
  title: string;
  description: string;
  position: CanvasPoint;
  sortOrder: number;
  stageId: string | null;
  shape: NodeShape;
  formatSchema: unknown;
  workerType: WorkerType;
  workerId: string | null;
  criticType: CriticType;
  criticId: string | null;
  criticApiUrl: string | null;
  source: WorkflowNode;
  runtime: RuntimeNodeOverlay | null;
}

export interface CanvasEdge {
  id: string;
  workflowId: string;
  sourceNodeId: string;
  targetNodeId: string;
  condition: unknown;
  source: WorkflowEdge;
}

export interface CanvasSelection {
  nodeIds: string[];
  edgeId: string | null;
}

export interface CanvasDraftOverlay {
  nodeEdits: Record<string, Partial<WorkflowNode>>;
  deletedNodeIds: string[];
}

export interface BuildCanvasModelInput {
  stages: WorkflowStage[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  draft?: CanvasDraftOverlay;
  nodeRuns?: Array<{
    id: string;
    workflow_run_id: string;
    workflow_node_id: string;
    status: NodeRunStatus;
    retry_count: number;
    worker_output: unknown;
    critic_output: unknown;
    critic_comment: string;
    started_at: string | null;
    completed_at: string | null;
    session_id: string | null;
    runtime_id: string | null;
    device_id: string | null;
  }>;
}

export interface CanvasModel {
  stages: CanvasStage[];
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  nodesById: Map<string, CanvasNode>;
  edgesById: Map<string, CanvasEdge>;
}

export const UNASSIGNED_STAGE_ID = "__unassigned__";

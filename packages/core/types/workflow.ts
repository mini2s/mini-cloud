export type WorkflowStatus = "draft" | "active" | "paused" | "archived";
export type WorkerType = "human" | "agent" | "squad" | "role";
export type CriticType = "human" | "agent" | "squad" | "api" | "role";
export type RoleActorType = "member" | "agent" | "squad";
export type NodeShape = "rectangle" | "diamond" | "pill" | "hexagon";
export type WorkflowNodeFormatKind = "task" | "gateway" | "annotation" | "split";
export type GatewayKind = "fork" | "join";
export type SplitMode = "barrier" | "pipeline";

export interface SplitConfig {
  sub_template_id: string | null;
  mode: SplitMode;
  max_concurrency: number;
  max_failures: number;
}

export interface WorkflowNodeFormat {
  kind: WorkflowNodeFormatKind;
  shape: NodeShape;
  template_id: string | null;
  template_category: string;
  gateway_kind: GatewayKind | null;
  gateway_kind_valid: boolean;
  split_config: SplitConfig | null;
  split_config_valid: boolean;
}

export const NODE_SHAPES: NodeShape[] = ["rectangle", "diamond", "pill", "hexagon"];

const CATEGORY_DEFAULT_SHAPES: Record<string, NodeShape> = {
  trigger: "pill",
  logic: "diamond",
  human: "hexagon",
  action: "rectangle",
  ai: "rectangle",
};

function parseTemplateCategory(formatSchema: unknown): string {
  if (!formatSchema || typeof formatSchema !== "object" || Array.isArray(formatSchema)) {
    return "action";
  }

  const value = (formatSchema as Record<string, unknown>).template_category;
  return typeof value === "string" && value.trim() ? value : "action";
}

export function parseNodeShape(formatSchema: unknown): NodeShape {
  if (
    formatSchema &&
    typeof formatSchema === "object" &&
    "shape" in (formatSchema as Record<string, unknown>) &&
    typeof (formatSchema as Record<string, unknown>).shape === "string" &&
    NODE_SHAPES.includes((formatSchema as Record<string, unknown>).shape as NodeShape)
  ) {
    return (formatSchema as Record<string, unknown>).shape as NodeShape;
  }
  return CATEGORY_DEFAULT_SHAPES[parseTemplateCategory(formatSchema)] ?? "rectangle";
}

function isGatewayKind(value: unknown): value is GatewayKind {
  return value === "fork" || value === "join";
}

function isSplitMode(value: unknown): value is SplitMode {
  return value === "barrier" || value === "pipeline";
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function parseNodeFormat(formatSchema: unknown): WorkflowNodeFormat {
  const base: WorkflowNodeFormat = {
    kind: "task",
    shape: parseNodeShape(formatSchema),
    template_id: null,
    template_category: "action",
    gateway_kind: null,
    gateway_kind_valid: true,
    split_config: null,
    split_config_valid: true,
  };

  if (!formatSchema || typeof formatSchema !== "object" || Array.isArray(formatSchema)) {
    return base;
  }

  const schema = formatSchema as Record<string, unknown>;
  const templateId = readString(schema, "template_id");
  const templateCategory = readString(schema, "template_category") ?? "action";

  if (schema.type === "annotation") {
    return {
      ...base,
      kind: "annotation",
      template_id: templateId,
      template_category: templateCategory,
    };
  }

  if (schema.type === "gateway") {
    const gatewayKind = isGatewayKind(schema.gateway_kind) ? schema.gateway_kind : null;
    return {
      ...base,
      kind: "gateway",
      template_id: templateId,
      template_category: templateCategory,
      gateway_kind: gatewayKind,
      gateway_kind_valid: gatewayKind !== null,
    };
  }

  if (schema.type === "split") {
    const rawConfig = schema.split_config;
    const config = rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
      ? rawConfig as Record<string, unknown>
      : {};
    const subTemplateId = readString(config, "sub_template_id");
    const rawMaxConcurrency = config.max_concurrency;
    const rawMaxFailures = config.max_failures;
    const maxConcurrencyValid =
      typeof rawMaxConcurrency === "number" &&
      Number.isInteger(rawMaxConcurrency) &&
      rawMaxConcurrency >= 1 &&
      rawMaxConcurrency <= 20;
    const maxFailuresValid =
      typeof rawMaxFailures === "number" &&
      Number.isInteger(rawMaxFailures) &&
      rawMaxFailures >= 0;
    const splitConfig: SplitConfig = {
      sub_template_id: subTemplateId,
      mode: isSplitMode(config.mode) ? config.mode : "barrier",
      max_concurrency: maxConcurrencyValid ? rawMaxConcurrency : 5,
      max_failures: maxFailuresValid ? rawMaxFailures : 0,
    };
    return {
      ...base,
      kind: "split",
      template_id: templateId,
      template_category: templateCategory,
      split_config: splitConfig,
      split_config_valid:
        subTemplateId !== null &&
        (config.mode == null || isSplitMode(config.mode)) &&
        (rawMaxConcurrency == null || maxConcurrencyValid) &&
        (rawMaxFailures == null || maxFailuresValid),
    };
  }

  return {
    ...base,
    template_id: templateId,
    template_category: templateCategory,
  };
}

/** Map workflow node worker/critic type to actor type used by useActorName(). */
export function workerTypeToActorType(t: string): "member" | "agent" | "squad" {
  if (t === "human") return "member";
  if (t === "agent") return "agent";
  if (t === "squad") return "squad";
  if (t === "role") return "agent"; // roles resolve to agents for actor-name lookup
  return "member";
}

export type NodeRunStatus =
  | "pending" | "format_checking" | "format_ok" | "format_failed"
  | "worker_assigned" | "working" | "awaiting_input" | "awaiting_critic"
  | "critic_reviewing" | "critic_approved" | "critic_rework"
  | "completed" | "failed" | "blocked" | "skipped" | "cancelled"
  | "splitting" | "awaiting_split_review" | "split_active";
export type WorkflowRunStatus = "running" | "completed" | "failed" | "cancelled";
export type WorkflowRuntimeDisplayStatus =
  | "pending"
  | "todo"
  | "in_progress"
  | "reviewing"
  | "completed"
  | "blocked"
  | "cancelled";
export type WorkflowDeliverableSignal = "none" | "red" | "yellow" | "green";

export function toWorkflowRuntimeDisplayStatus(status: string): WorkflowRuntimeDisplayStatus {
  switch (status) {
    case "pending":
      return "pending";
    case "worker_assigned":
      return "todo";
    case "format_checking":
    case "format_ok":
    case "awaiting_input":
    case "working":
    case "splitting":
    case "split_active":
      return "in_progress";
    case "awaiting_critic":
    case "critic_reviewing":
    case "awaiting_split_review":
      return "reviewing";
    case "critic_approved":
    case "completed":
      return "completed";
    case "failed":
    case "format_failed":
    case "blocked":
    case "critic_rework":
      return "blocked";
    case "cancelled":
    case "skipped":
      return "cancelled";
    default:
      return "pending";
  }
}

export interface Workflow {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  status: WorkflowStatus;
  max_retries: number;
  created_by_type: string;
  created_by_id: string;
  node_count: number;
  is_template: boolean;
  source_template_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowNode {
  id: string;
  workflow_id: string;
  title: string;
  description: string;
  position_x: number;
  position_y: number;
  format_schema: unknown;
  worker_type: WorkerType;
  worker_id: string | null;
  critic_type: CriticType;
  critic_id: string | null;
  critic_api_url: string | null;
  sort_order: number;
  stage_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowEdge {
  id: string;
  workflow_id: string;
  source_node_id: string;
  target_node_id: string;
  condition: unknown;
  created_at: string;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  workspace_id: string;
  workflow_title: string;
  status: WorkflowRunStatus;
  triggered_by_type: string;
  triggered_by_id: string | null;
  input: unknown;
  output: unknown;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface WorkflowNodeRun {
  id: string;
  workflow_run_id: string;
  workflow_node_id: string;
  node_title: string;
  status: NodeRunStatus;
  retry_count: number;
  worker_type: WorkerType;
  worker_id: string | null;
  worker_output: unknown;
  worker_agent_task_id: string | null;
  critic_type: CriticType;
  critic_id: string | null;
  critic_output: unknown;
  critic_comment: string;
  critic_agent_task_id: string | null;
  agent_task_id: string | null;
  /** Non-null when this node run is bound to a CSC session for human/agent collaboration. */
  session_id: string | null;
  /** Runtime that owns the session for this node run, if any. */
  runtime_id: string | null;
  /** Device identifier for the runtime/session bound to this node run, if any. */
  device_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type SplitTaskStatus =
  | "draft"
  | "approved"
  | "discarded"
  | "created"
  | "running"
  | "done"
  | "failed"
  | "cancelled"
  | "skipped";

export type SplitTaskAssigneeType = "member" | "agent" | "squad";

export interface SplitTask {
  id: string;
  node_run_id: string;
  title: string;
  description: string;
  suggested_assignee_type: SplitTaskAssigneeType | null;
  suggested_assignee_id: string | null;
  depends_on: string[];
  sort_order: number;
  status: SplitTaskStatus;
  issue_id: string | null;
  run_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SplitProgress {
  total: number;
  created: number;
  running: number;
  done: number;
  failed: number;
  cancelled: number;
  skipped: number;
}

export interface SplitTasksResponse {
  tasks: SplitTask[];
  progress: SplitProgress;
}

export interface ApproveSplitRequest {
  approved_task_ids: string[];
  modifications: SplitTaskModification[];
}

export type SplitTaskModification =
  | {
      id: string;
      title?: string;
      description?: string;
      depends_on?: string[];
      suggested_assignee_type?: SplitTaskAssigneeType | null;
      suggested_assignee_id?: string | null;
    }
  | {
      action: "add";
      title: string;
      description: string;
      depends_on?: string[];
      suggested_assignee_type?: SplitTaskAssigneeType | null;
      suggested_assignee_id?: string | null;
    }
  | { action: "delete"; id: string };

export interface WorkflowNodeRuntimeSummary {
  workflow_node_id: string;
  node_run_id: string;
  display_status: WorkflowRuntimeDisplayStatus;
  active_actor_type: string;
  active_actor_id: string | null;
  deliverable_signal: WorkflowDeliverableSignal;
  required_deliverables_total: number;
  required_deliverables_submitted: number;
  required_deliverables_approved: number;
  duration_seconds: number | null;
  session_id: string | null;
  runtime_id: string | null;
  device_id: string | null;
  has_error: boolean;
  error_message: string;
  split_progress: SplitProgress | null;
}

export interface WorkflowRunCanvasSummaryResponse {
  run: WorkflowRun;
  node_runs: WorkflowNodeRun[];
  node_runtime_summaries: WorkflowNodeRuntimeSummary[];
}

export interface CreateWorkflowRequest {
  title: string;
  description?: string;
  template?: string;
}

export interface UpdateWorkflowRequest {
  title?: string;
  description?: string;
  status?: WorkflowStatus;
  max_retries?: number;
}

export interface CreateNodeRequest {
  title: string;
  description?: string;
  position_x?: number;
  position_y?: number;
  format_schema?: unknown;
  worker_type: WorkerType;
  worker_id?: string | null;
  critic_type: CriticType;
  critic_id?: string | null;
  critic_api_url?: string | null;
  stage_id?: string | null;
}

export interface UpdateNodeRequest {
  title?: string;
  description?: string;
  position_x?: number;
  position_y?: number;
  format_schema?: unknown;
  worker_type?: WorkerType;
  worker_id?: string | null;
  critic_type?: CriticType;
  critic_id?: string | null;
  critic_api_url?: string | null;
  sort_order?: number;
}

export interface CreateEdgeRequest {
  source_node_id: string;
  target_node_id: string;
  condition?: unknown;
}

export interface SubmitNodeRunRequest {
  output: unknown;
}

export interface ReviewNodeRunRequest {
  approved: boolean;
  comment?: string;
}

export interface ListWorkflowsResponse {
  workflows: Workflow[];
  total: number;
}

export interface ListWorkflowRunsResponse {
  runs: WorkflowRun[];
  total: number;
}

export interface MyWorkflowTaskResponse {
  node_runs: WorkflowNodeRun[];
  total: number;
}

export interface WorkflowStage {
  id: string;
  workflow_id: string;
  name: string;
  description: string;
  sort_order: number;
  node_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateStageRequest {
  name: string;
  description?: string;
  sort_order?: number;
}

export interface UpdateStageRequest {
  name?: string;
  description?: string;
  sort_order?: number;
}

export interface ReorderStagesItem {
  id: string;
  sort_order: number;
}

export interface AssignNodeToStageRequest {
  stage_id: string | null;
}

export interface WorkflowAdmin {
  id: string;
  name: string;
  email: string;
  can_manage_workflows: boolean;
}

// ── Deliverable types ──────────────────────────────────────────────────────

export type WorkflowDeliverableKind = "document" | "pull_request";
export type WorkflowDeliverableSubmissionStatus = "missing" | "submitted" | "approved" | "rejected";

export interface WorkflowNodeDeliverable {
  id: string;
  workflow_node_id: string;
  kind: WorkflowDeliverableKind;
  title: string;
  description: string;
  required: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface WorkflowNodeDeliverableSubmission {
  id: string;
  workflow_node_run_id: string;
  deliverable_id: string;
  submitted_by_type: "member" | "agent" | "system";
  submitted_by_id: string | null;
  status: WorkflowDeliverableSubmissionStatus;
  content: string;
  attachment_id: string | null;
  pull_request_url: string;
  review_comment: string;
  submitted_at: string;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Composite view joining a deliverable definition with its submission for a node run. */
export interface DeliverableWithSubmission {
  deliverable: WorkflowNodeDeliverable;
  submission: WorkflowNodeDeliverableSubmission | null;
}

// ── Role types ──────────────────────────────────────────────────────────────

export interface WorkflowRole {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRoleBinding {
  id: string;
  role_id: string;
  actor_type: RoleActorType;
  actor_id: string;
  priority: number;
  created_at: string;
}

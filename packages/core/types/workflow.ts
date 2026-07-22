export type WorkflowStatus = "draft" | "active" | "paused" | "archived";
export type WorkerType = "human" | "agent" | "squad" | "role";
export type CriticType = "human" | "agent" | "squad" | "api" | "role";
export type RoleActorType = "member" | "agent" | "squad";
export type WorkflowRoleKey = "developer" | "qa" | "tech_lead" | (string & {});

export const BUILTIN_WORKFLOW_ROLES: WorkflowRoleKey[] = ["developer", "qa", "tech_lead"];
export type NodeShape = "rectangle" | "diamond" | "pill" | "hexagon";
export type WorkflowBoundaryKind = "start" | "end";
export type WorkflowNodeFormatKind = "task" | "gateway" | "annotation" | "split" | WorkflowBoundaryKind;
export type GatewayKind = "fork" | "join";
export type SplitMode = "barrier" | "pipeline";

export interface SplitConfig {
  default_issue_workflow_id: string | null;
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

  if (schema.type === "start" || schema.type === "end") {
    return {
      ...base,
      kind: schema.type,
      template_id: templateId,
      template_category: templateCategory,
    };
  }

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
    const defaultIssueWorkflowId = readString(config, "default_issue_workflow_id");
    const rawMaxConcurrency = config.max_concurrency;
    const rawMaxFailures = config.max_failures;
    const maxConcurrencyValid =
      typeof rawMaxConcurrency === "number" &&
      Number.isInteger(rawMaxConcurrency) &&
      rawMaxConcurrency >= 1 &&
      rawMaxConcurrency <= 50;
    const maxFailuresValid =
      typeof rawMaxFailures === "number" &&
      Number.isInteger(rawMaxFailures) &&
      rawMaxFailures >= 0;
    const splitConfig: SplitConfig = {
      default_issue_workflow_id: defaultIssueWorkflowId,
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
        defaultIssueWorkflowId !== null &&
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

export function isBoundaryNode(node: Pick<WorkflowNode, "format_schema">): boolean {
  const kind = parseNodeFormat(node.format_schema).kind;
  return kind === "start" || kind === "end";
}

export function isStartNode(node: Pick<WorkflowNode, "format_schema">): boolean {
  return parseNodeFormat(node.format_schema).kind === "start";
}

export function isEndNode(node: Pick<WorkflowNode, "format_schema">): boolean {
  return parseNodeFormat(node.format_schema).kind === "end";
}

export function isInvalidBoundaryConnection(
  source: Pick<WorkflowNode, "format_schema">,
  target: Pick<WorkflowNode, "format_schema">,
): boolean {
  const sourceKind = parseNodeFormat(source.format_schema).kind;
  const targetKind = parseNodeFormat(target.format_schema).kind;
  const sourceBoundary = sourceKind === "start" || sourceKind === "end";
  const targetBoundary = targetKind === "start" || targetKind === "end";

  return targetKind === "start" ||
    sourceKind === "end" ||
    (sourceKind === "start" && targetKind === "end") ||
    (sourceBoundary && targetKind === "annotation") ||
    (sourceKind === "annotation" && targetBoundary);
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
export type WorkflowRunStatus =
  | "resolving_roles"
  | "waiting_role_assignment"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
export type WorkflowRuntimeDisplayStatus =
  | "pending"
  | "todo"
  | "in_progress"
  | "reviewing"
  | "completed"
  | "blocked"
  | "cancelled";

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
  custom_roles: string[];
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
  worker_role_id?: string | null;
  /** @deprecated compatibility for pre-role-id responses */
  worker_role?: WorkflowRoleKey | null;
  critic_type: CriticType;
  critic_id: string | null;
  critic_role_id?: string | null;
  /** @deprecated compatibility for pre-role-id responses */
  critic_role?: WorkflowRoleKey | null;
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
  /** Chat session used for natural-language split draft review, if any. */
  split_review_chat_session_id: string | null;
  split_config_version: number;
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

export type SplitDraftSource = "agent" | "chat" | "recovered";

export interface SplitTask {
  id: string;
  node_run_id: string;
  title: string;
  description: string;
  workflow_id: string;
  depends_on: string[];
  sort_order: number;
  status: SplitTaskStatus;
  issue_id: string | null;
  run_id: string | null;
  version: number;
  draft_key: string | null;
  draft_source: SplitDraftSource;
  last_error: SplitTaskLastError | null;
  created_at: string;
  updated_at: string;
}

export interface SplitTaskLastError {
  code: string;
  message: string;
  child_issue_id: string | null;
  workflow_run_id: string | null;
  node_run_id: string | null;
  occurred_at: string;
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

/** Returned by POST /api/node-runs/:id/split/chat — extends SplitTasksResponse
 *  with the chat session and agent task IDs needed for real-time updates. */
export interface SplitChatResponse extends SplitTasksResponse {
  chat_session_id: string;
  task_id: string;
}

export interface ApproveSplitRequest {
  approved_task_ids: string[];
  confirm_empty?: boolean;
}

export interface PatchSplitDraftTaskRequest {
  title?: string;
  description?: string;
  depends_on?: string[];
  discarded?: boolean;
  workflow_id?: string;
  expected_version: number;
}

export interface CreateSplitDraftTaskRequest {
  title: string;
  description?: string;
  workflow_id?: string;
  depends_on?: string[];
}

export interface BatchPatchSplitDraftTasksRequest {
  updates: Array<{
    task_id: string;
    workflow_id: string;
    expected_version: number;
  }>;
}

export interface PatchSplitConfigRequest {
  max_concurrency: number;
  expected_config_version: number;
}

export interface RetrySplitTaskRequest {
  workflow_id?: string;
}

export interface WorkflowNodeRuntimeSummary {
  workflow_node_id: string;
  node_run_id: string;
  display_status: WorkflowRuntimeDisplayStatus;
  active_actor_type: string;
  active_actor_id: string | null;
  duration_seconds: number | null;
  /** Non-null when this node run is bound to a CSC session for human/agent collaboration. */
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
  custom_roles?: string[];
}

export interface CreateNodeRequest {
  title: string;
  description?: string;
  position_x?: number;
  position_y?: number;
  format_schema?: unknown;
  worker_type: WorkerType;
  worker_id?: string | null;
  worker_role_id?: string | null;
  critic_type: CriticType;
  critic_id?: string | null;
  critic_role_id?: string | null;
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
  worker_role_id?: string | null;
  critic_type?: CriticType;
  critic_id?: string | null;
  critic_role_id?: string | null;
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

// ── Role types ──────────────────────────────────────────────────────────────

export interface WorkflowRole {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  is_builtin: boolean;
  needs_description: boolean;
  is_referenced: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type WorkflowRoleResolutionStatus = "pending" | "resolved" | "needs_human" | "invalidated";
export interface WorkflowRoleResolution {
  id: string;
  workflow_run_id: string;
  workflow_node_run_id: string;
  slot_type: "worker" | "critic";
  role_id: string | null;
  role_name: string;
  role_description: string;
  status: WorkflowRoleResolutionStatus | (string & {});
  resolved_user_id: string | null;
  source: "llm" | "manual" | null;
  reason_code: string;
  reason_detail: string;
  version: number;
  resolved_by: string | null;
  resolved_at: string | null;
  notification_status?: "pending" | "sending" | "sent" | "failed" | "skipped_no_email" | (string & {});
  created_at: string;
  updated_at: string;
}

export interface WorkflowRoleAssignmentInput {
  resolution_id: string;
  user_id: string;
  version: number;
}

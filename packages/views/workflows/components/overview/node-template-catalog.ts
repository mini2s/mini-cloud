import type {
  CreateNodeRequest,
  CriticType,
  GatewayKind,
  NodeShape,
  WorkerType,
  WorkflowBoundaryKind,
} from "@multica/core/types";

export type NodeTemplateCategoryId =
  | "trigger"
  | "action"
  | "logic"
  | "ai"
  | "human"
  | "annotation";

export interface NodeTemplateCategory {
  id: NodeTemplateCategoryId;
  labelKey: `${NodeTemplateCategoryId}`;
  descriptionKey: `${NodeTemplateCategoryId}_description`;
}

export interface NodeTemplate {
  id: string;
  category: NodeTemplateCategoryId;
  title: string;
  description: string;
  tags: string[];
  shape: NodeShape;
  worker_type: WorkerType;
  critic_type: CriticType;
  gateway_kind?: GatewayKind;
  annotation?: boolean;
  split?: boolean;
  boundary_kind?: WorkflowBoundaryKind;
}

export const NODE_TEMPLATE_CATEGORIES: NodeTemplateCategory[] = [
  { id: "trigger", labelKey: "trigger", descriptionKey: "trigger_description" },
  { id: "action", labelKey: "action", descriptionKey: "action_description" },
  { id: "logic", labelKey: "logic", descriptionKey: "logic_description" },
  { id: "ai", labelKey: "ai", descriptionKey: "ai_description" },
  { id: "human", labelKey: "human", descriptionKey: "human_description" },
  { id: "annotation", labelKey: "annotation", descriptionKey: "annotation_description" },
];

export const NODE_TEMPLATES: NodeTemplate[] = [
  {
    id: "workflow-start",
    category: "trigger",
    title: "Start",
    description: "Mark the workflow entry boundary.",
    tags: ["start", "entry", "boundary"],
    shape: "pill",
    worker_type: "human",
    critic_type: "human",
    boundary_kind: "start",
  },
  {
    id: "workflow-end",
    category: "trigger",
    title: "End",
    description: "Mark the workflow exit boundary.",
    tags: ["end", "finish", "boundary"],
    shape: "pill",
    worker_type: "human",
    critic_type: "human",
    boundary_kind: "end",
  },
  {
    id: "manual-trigger",
    category: "trigger",
    title: "Manual trigger",
    description: "Start this workflow from a button or manual run.",
    tags: ["start", "manual", "trigger"],
    shape: "pill",
    worker_type: "human",
    critic_type: "human",
  },
  {
    id: "agent-task",
    category: "action",
    title: "Task",
    description: "Create a normal task for a member, agent, or squad.",
    tags: ["task", "action", "worker"],
    shape: "rectangle",
    worker_type: "agent",
    critic_type: "human",
  },
  {
    id: "condition-branch",
    category: "logic",
    title: "Decision",
    description: "Represent a branch or approval decision.",
    tags: ["if", "condition", "branch", "decision"],
    shape: "diamond",
    worker_type: "human",
    critic_type: "human",
  },
  {
    id: "fork-gateway",
    category: "logic",
    title: "Fork",
    description: "Run multiple downstream branches in parallel.",
    tags: ["parallel", "fork", "gateway", "split"],
    shape: "diamond",
    worker_type: "agent",
    critic_type: "human",
    gateway_kind: "fork",
  },
  {
    id: "join-gateway",
    category: "logic",
    title: "Join",
    description: "Wait for multiple upstream branches before continuing.",
    tags: ["join", "gateway", "merge", "wait"],
    shape: "diamond",
    worker_type: "agent",
    critic_type: "human",
    gateway_kind: "join",
  },
  {
    id: "task-splitter",
    category: "logic",
    title: "Task split",
    description: "Generate a reviewed child task plan and launch each child issue with its selected workflow.",
    tags: ["split", "parallel", "child tasks", "planning"],
    shape: "rectangle",
    worker_type: "agent",
    critic_type: "human",
    split: true,
  },
  {
    id: "ai-agent-task",
    category: "ai",
    title: "Agent task",
    description: "Ask an agent to complete a workflow step.",
    tags: ["ai", "agent", "automation"],
    shape: "rectangle",
    worker_type: "agent",
    critic_type: "human",
  },
  {
    id: "human-review",
    category: "human",
    title: "Human review",
    description: "Pause for a person to review or approve output.",
    tags: ["human", "review", "approval"],
    shape: "hexagon",
    worker_type: "human",
    critic_type: "human",
  },
  {
    id: "sticky-note",
    category: "annotation",
    title: "Note",
    description: "Add context, assumptions, or handoff notes to the canvas.",
    tags: ["note", "annotation", "comment"],
    shape: "rectangle",
    worker_type: "human",
    critic_type: "human",
    annotation: true,
  },
];

export function filterNodeTemplates(query: string): NodeTemplate[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return NODE_TEMPLATES;

  return NODE_TEMPLATES.filter((template) => {
    const haystack = [
      template.title,
      template.description,
      template.category,
      ...template.tags,
    ].join(" ").toLocaleLowerCase();
    return haystack.includes(normalized);
  });
}

export function buildCreateNodeRequestFromTemplate(
  template: NodeTemplate,
  input: { x: number; y: number; stageId: string | null },
): CreateNodeRequest {
  const formatSchema = template.boundary_kind
    ? {
        type: template.boundary_kind,
        shape: template.shape,
        template_id: template.id,
        template_category: template.category,
      }
    : template.annotation
    ? {
        type: "annotation",
        template_id: template.id,
        template_category: template.category,
      }
    : template.gateway_kind
      ? {
          type: "gateway",
          gateway_kind: template.gateway_kind,
          shape: template.shape,
          template_id: template.id,
          template_category: template.category,
        }
      : template.split
        ? {
            type: "split",
            shape: template.shape,
            template_id: template.id,
            template_category: template.category,
            split_config: {
              default_issue_workflow_id: null,
              mode: "barrier",
              max_concurrency: 5,
              max_failures: 0,
            },
          }
      : {
          shape: template.shape,
          template_id: template.id,
          template_category: template.category,
        };

  return {
    title: template.title,
    description: template.description,
    position_x: Math.round(input.x),
    position_y: 0,
    stage_id: input.stageId,
    format_schema: formatSchema,
    worker_type: template.worker_type,
    worker_id: null,
    critic_type: template.critic_type,
    critic_id: null,
    critic_api_url: null,
  };
}

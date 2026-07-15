/**
 * 编码任务拆分 Workflow 种子数据
 *
 * 将一个大型编码任务智能拆分为多个子任务并行执行。
 * 基于 spec: docs/superpowers/specs/2026-07-12-dynamic-task-splitting-design.md
 *
 * ## 流程概览
 *
 *   Stage 1: 分析规划     (2 nodes)  代码库分析 → 任务拆分(split node)
 *   Stage 2: 集成验证     (2 nodes)  集成检查 → 汇总报告
 *
 *   split 节点将父任务拆分为 N 个子任务，每个子任务独立执行编码 workflow，
 *   barrier 模式下等待所有子任务完成后才释放下游。
 */

import type {
  WorkflowStage,
  WorkflowNode,
  WorkflowEdge,
  CreateStageRequest,
  CreateNodeRequest,
  CreateEdgeRequest,
} from "@multica/core/types";

// ─────────────────────────────────────────────────────────────
// Workflow 元数据
// ─────────────────────────────────────────────────────────────

export const CODING_TASK_SPLITTING_WORKFLOW = {
  title: "编码任务拆分",
  description:
    "将大型编码任务智能拆分为多个子任务并行执行。Agent 分析代码库结构后生成拆分方案，经人工审核后批量创建子任务，各子任务独立执行编码流程，最终汇总验证整体一致性。适用于跨模块功能开发、大规模重构、多端同步开发等场景。",
  status: "active" as const,
  max_retries: 3,
  is_template: true,
} as const;

// ─────────────────────────────────────────────────────────────
// Stage 种子数据
// ─────────────────────────────────────────────────────────────

export interface SeedStage extends CreateStageRequest {
  ref: string;
  sort_order: number;
}

export const CODING_SPLIT_STAGES: SeedStage[] = [
  {
    ref: "analysis",
    name: "分析规划",
    description: "Agent 分析代码库结构和依赖关系，生成任务拆分方案",
    sort_order: 0,
  },
  {
    ref: "integration",
    name: "集成验证",
    description: "所有子任务完成后，验证集成结果的一致性并生成汇总报告",
    sort_order: 1,
  },
];

// ─────────────────────────────────────────────────────────────
// Node 种子数据
// ─────────────────────────────────────────────────────────────

export interface SeedNode extends CreateNodeRequest {
  ref: string;
  stageRef: string | null;
  position_x: number;
  position_y: number;
  sort_order: number;
  description: string;
}

export const CODING_SPLIT_NODES: SeedNode[] = [
  // ── Stage 1: 分析规划 (2 nodes) ───────────────────────────────
  {
    ref: "codebase-analysis",
    stageRef: "analysis",
    title: "代码库分析",
    description:
      "Agent 分析当前代码库的模块结构、依赖关系和变更影响范围，产出代码库分析报告，为任务拆分提供上下文依据",
    position_x: 200,
    position_y: 200,
    sort_order: 0,
    worker_type: "agent",
    worker_id: null,
    critic_type: "human",
    critic_id: null,
    format_schema: {
      type: "object",
      properties: {
        modules_affected: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "模块名称" },
              path: { type: "string", description: "模块路径" },
              change_scope: {
                type: "string",
                enum: ["full", "partial", "minimal"],
                description: "变更范围",
              },
              dependencies: {
                type: "array",
                items: { type: "string" },
                description: "依赖的其他模块",
              },
            },
          },
        },
        estimated_complexity: {
          type: "string",
          enum: ["S", "M", "L", "XL"],
          description: "预估复杂度",
        },
        suggested_split_strategy: {
          type: "string",
          description: "建议的拆分策略说明",
        },
      },
      required: ["modules_affected", "estimated_complexity"],
    },
  },
  {
    ref: "task-splitting",
    stageRef: "analysis",
    title: "任务拆分",
    description:
      "根据代码库分析结果，智能生成子任务列表。Agent 产出拆分方案，人工审核确认后批量创建子 issue，各子任务并行执行编码 workflow",
    position_x: 600,
    position_y: 200,
    sort_order: 1,
    worker_type: "agent",
    worker_id: null,
    critic_type: "human",
    critic_id: null,
    format_schema: {
      type: "split",
      shape: "rectangle",
      template_id: "task-splitter",
      template_category: "logic",
      split_config: {
        child_workflow_id: null,
        mode: "barrier",
        max_concurrency: 5,
        max_failures: 0,
      },
    },
  },

  // ── Stage 2: 集成验证 (2 nodes) ───────────────────────────────
  {
    ref: "integration-check",
    stageRef: "integration",
    title: "集成检查",
    description:
      "所有子任务完成后，Agent 验证各子任务产出的一致性，检查接口兼容性、代码冲突和整体架构完整性",
    position_x: 200,
    position_y: 200,
    sort_order: 0,
    worker_type: "agent",
    worker_id: null,
    critic_type: "human",
    critic_id: null,
    format_schema: {
      type: "object",
      properties: {
        consistency_check: {
          type: "object",
          properties: {
            interface_compatibility: { type: "boolean" },
            no_code_conflicts: { type: "boolean" },
            architecture_integrity: { type: "boolean" },
          },
        },
        issues_found: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              severity: {
                type: "string",
                enum: ["critical", "major", "minor"],
              },
              related_subtask: { type: "string" },
            },
          },
        },
        overall_status: {
          type: "string",
          enum: ["pass", "needs_fix", "fail"],
        },
      },
      required: ["consistency_check", "overall_status"],
    },
  },
  {
    ref: "summary-report",
    stageRef: "integration",
    title: "汇总报告",
    description:
      "生成完整的编码任务执行报告，包含各子任务的完成情况、代码变更摘要、测试覆盖率和遗留问题",
    position_x: 600,
    position_y: 200,
    sort_order: 1,
    worker_type: "agent",
    worker_id: null,
    critic_type: "human",
    critic_id: null,
    format_schema: {
      type: "object",
      properties: {
        subtask_summary: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              status: { type: "string" },
              files_changed: { type: "number" },
              test_coverage_pct: { type: "number" },
            },
          },
        },
        total_files_changed: { type: "number" },
        overall_test_coverage_pct: { type: "number" },
        open_issues: {
          type: "array",
          items: { type: "string" },
        },
        deployment_ready: { type: "boolean" },
      },
      required: ["subtask_summary", "deployment_ready"],
    },
  },
];

// ─────────────────────────────────────────────────────────────
// Edge 种子数据
// ─────────────────────────────────────────────────────────────

export interface SeedEdge {
  ref: string;
  sourceRef: string;
  targetRef: string;
  source_node_id: string;
  target_node_id: string;
  condition?: unknown;
}

export const CODING_SPLIT_EDGES: SeedEdge[] = [
  // Stage 1 edges
  {
    ref: "e-analysis-1",
    source_node_id: "",
    target_node_id: "",
    sourceRef: "codebase-analysis",
    targetRef: "task-splitting",
  },
  // Stage 2 edges
  {
    ref: "e-integration-1",
    source_node_id: "",
    target_node_id: "",
    sourceRef: "task-splitting",
    targetRef: "integration-check",
  },
  {
    ref: "e-integration-2",
    source_node_id: "",
    target_node_id: "",
    sourceRef: "integration-check",
    targetRef: "summary-report",
    condition: { type: "check_passed" },
  },
];

// ─────────────────────────────────────────────────────────────
// 动态运行时类型
// ─────────────────────────────────────────────────────────────

export interface ResolvedStage extends WorkflowStage {
  ref: string;
}

export interface ResolvedNode extends WorkflowNode {
  ref: string;
  stageRef: string | null;
}

export interface ResolvedEdge extends WorkflowEdge {
  ref: string;
  sourceRef: string;
  targetRef: string;
}

export function buildNodeIdMap(
  createdNodes: Array<{ id: string; ref?: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const n of createdNodes) {
    if (n.ref) map.set(n.ref, n.id);
  }
  return map;
}

export function buildStageIdMap(
  createdStages: Array<{ id: string; ref?: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of createdStages) {
    if (s.ref) map.set(s.ref, s.id);
  }
  return map;
}

export function resolveEdges(
  edges: SeedEdge[],
  nodeIdMap: Map<string, string>,
): CreateEdgeRequest[] {
  return edges.map((e) => ({
    source_node_id: nodeIdMap.get(e.sourceRef) ?? e.source_node_id,
    target_node_id: nodeIdMap.get(e.targetRef) ?? e.target_node_id,
    condition: (e as { condition?: unknown }).condition,
  }));
}

// ─────────────────────────────────────────────────────────────
// API 批量创建参数
// ─────────────────────────────────────────────────────────────

export interface CreateNodeWithStageRequest extends CreateNodeRequest {
  stageRef: string | null;
}

export function toCreateNodeRequest(n: SeedNode): CreateNodeRequest {
  return {
    title: n.title,
    description: n.description,
    position_x: n.position_x,
    position_y: n.position_y,
    format_schema: n.format_schema,
    worker_type: n.worker_type,
    worker_id: n.worker_id,
    critic_type: n.critic_type,
    critic_id: n.critic_id,
    critic_api_url: (n as { critic_api_url?: string }).critic_api_url,
    stage_id: (n as { stage_id?: string | null }).stage_id,
  };
}

// ─────────────────────────────────────────────────────────────
// 统计信息
// ─────────────────────────────────────────────────────────────

export const CODING_SPLIT_STATS = {
  totalStages: 2,
  totalNodes: 4,
  totalEdges: 3,
  stageBreakdown: {
    analysis: { nodeCount: 2, edgeCount: 1 },
    integration: { nodeCount: 2, edgeCount: 2 },
  },
  configCoverage: {
    workerTypes: { agent: 4, human: 0, squad: 0 },
    criticTypes: { human: 4, agent: 0, squad: 0, api: 0 },
    withFormatSchema: 4,
    withoutFormatSchema: 0,
    withApiCriticUrl: 0,
    splitNodes: 1,
  },
} as const;

import { parseNodeFormat, type WorkflowNode, type WorkflowEdge, type WorkflowStage } from "../types";

// ── Types ──

export type PreflightCheckId =
  | "dag-cycle"
  | "orphan-node"
  | "unreachable-node"
  | "worker-missing"
  | "split-planner-missing"
  | "split-planner-not-specialized"
  | "split-critic-missing"
  | "split-critic-automated"
  | "invalid-critic-ref"
  | "stage-missing"
  | "gateway-fork-outgoing"
  | "gateway-join-incoming"
  | "gateway-kind-invalid"
  | "gateway-join-multiple-outgoing"
  | "split-default-issue-workflow-missing"
  | "split-default-issue-workflow-invalid"
  | "split-default-issue-workflow-inactive"
  | "split-default-issue-workflow-nested"
  | "split-default-issue-workflow-self"
  | "split-max-concurrency-invalid";

export type PreflightSeverity = "error" | "warning";

export interface PreflightIssue {
  checkId: PreflightCheckId;
  severity: PreflightSeverity;
  blocking: boolean;
  nodeId: string;
  nodeTitle?: string;
  stageName?: string;
  message: string;
  detail?: string;
}

export interface PreflightResult {
  issues: PreflightIssue[];
  blockingCount: number;
  warningCount: number;
  passed: boolean;
}

// ── Helpers ──

export const DEFAULT_SPLIT_PLANNER_AGENT_IDS = [
  "dd79d98e-3be1-4cb5-9cdd-aee809287741",
  "3ef3f4fd-0de7-4a84-a03d-cb5d4df2f30c",
  "32fc6f0c-2f00-44d7-a6a2-36f1d75a144a",
  "6b3ea222-f3ee-44c5-b4c9-33a1674a1127",
] as const;

const defaultSplitPlannerAgentIds = new Set<string>(DEFAULT_SPLIT_PLANNER_AGENT_IDS);

function isAnnotation(node: WorkflowNode): boolean {
  return parseNodeFormat(node.format_schema).kind === "annotation";
}

function isGateway(node: WorkflowNode): boolean {
  return parseNodeFormat(node.format_schema).kind === "gateway";
}

function isSplit(node: WorkflowNode): boolean {
  return parseNodeFormat(node.format_schema).kind === "split";
}

// ── Check functions ──

/** Detect directed cycles using iterative DFS with recursion-stack tracking. */
export function checkDAGCycles(nodes: WorkflowNode[], edges: WorkflowEdge[]): PreflightIssue[] {
  if (nodes.length === 0) return [];

  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    const list = adj.get(e.source_node_id);
    if (list) list.push(e.target_node_id);
  }

  const issues: PreflightIssue[] = [];
  const visited = new Set<string>();
  const onStack = new Set<string>();
  // Map of node -> its parent for reconstructing cycle paths
  const parent = new Map<string, string>();

  function* dfs(startId: string): Generator<PreflightIssue, void, void> {
    // Iterative DFS with an explicit stack of [nodeId, iteratorIndex]
    const stack: Array<{ nodeId: string; neighborIdx: number }> = [{ nodeId: startId, neighborIdx: 0 }];
    visited.add(startId);
    onStack.add(startId);

    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const neighbors = adj.get(top.nodeId) ?? [];

      if (top.neighborIdx >= neighbors.length) {
        // Done with this node
        onStack.delete(top.nodeId);
        stack.pop();
        continue;
      }

      const neighbor = neighbors[top.neighborIdx]!;
      top.neighborIdx++;

      if (onStack.has(neighbor)) {
        // Back edge -> cycle detected. Reconstruct the path.
        const cycleNodes: string[] = [];
        // Walk from top.nodeId back to neighbor through the stack
        // We know neighbor is on the stack somewhere; collect nodes from top back to neighbor
        const stackIds = stack.map((s) => s.nodeId);
        const neighborIdx = stackIds.lastIndexOf(neighbor);
        if (neighborIdx !== -1) {
          // The cycle is the path from neighbor back to the top including the edge top->neighbor
          for (let i = neighborIdx; i < stackIds.length; i++) {
            cycleNodes.push(stackIds[i]!);
          }
          cycleNodes.push(neighbor); // close the loop
        }

        const nodeMap = new Map(nodes.map((n) => [n.id, n]));
        const path = cycleNodes.map((id) => `"${nodeMap.get(id)?.title ?? id}"`).join(" → ");

        const anyNodeInCycle = nodes.find((n) => n.id === neighbor);
        yield {
          checkId: "dag-cycle",
          severity: "error",
          blocking: true,
          nodeId: neighbor, // point to the node that creates the back edge
          nodeTitle: anyNodeInCycle?.title,
          message: `Nodes form a cycle: ${path}`,
          detail: path,
        };
        continue;
      }

      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        onStack.add(neighbor);
        parent.set(neighbor, top.nodeId);
        stack.push({ nodeId: neighbor, neighborIdx: 0 });
      }
    }
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      onStack.clear(); // fresh stack per component
      for (const issue of dfs(node.id)) {
        issues.push(issue);
      }
    }
  }

  return issues;
}

/** Detect orphan nodes: nodes not referenced by any edge. */
export function checkOrphanNodes(nodes: WorkflowNode[], edges: WorkflowEdge[]): PreflightIssue[] {
  if (nodes.length <= 1) return [];

  const connected = new Set<string>();
  for (const e of edges) {
    connected.add(e.source_node_id);
    connected.add(e.target_node_id);
  }

  return nodes
    .filter((n) => !connected.has(n.id))
    .map((n) => ({
      checkId: "orphan-node" as const,
      severity: "warning" as const,
      blocking: false,
      nodeId: n.id,
      nodeTitle: n.title,
      message: "Node has no connections",
    }));
}

/** Detect unreachable nodes: nodes with no incoming edges that are not in the earliest stage. */
export function checkUnreachableNodes(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  stages: WorkflowStage[],
): PreflightIssue[] {
  if (nodes.length <= 1) return [];

  // Build indegree map
  const indegree = new Map<string, number>();
  for (const n of nodes) indegree.set(n.id, 0);
  for (const e of edges) {
    indegree.set(e.target_node_id, (indegree.get(e.target_node_id) ?? 0) + 1);
  }

  // Determine the primary stage (lowest sort_order among stages that contain any nodes)
  if (stages.length === 0) return [];

  const sortedStages = [...stages].sort((a, b) => a.sort_order - b.sort_order);
  const nodeStageMap = new Map(nodes.map((n) => [n.id, n.stage_id]));
  const primaryStageOrder = sortedStages[0]!.sort_order;

  return nodes
    .filter((n) => {
      if (indegree.get(n.id) !== 0) return false; // has incoming edges
      // Check if this node belongs to a later stage (not the primary one or unassigned)
      const stageId = nodeStageMap.get(n.id);
      if (stageId == null) return false; // unassigned nodes are not flagged
      const stage = sortedStages.find((s) => s.id === stageId);
      return stage && stage.sort_order > primaryStageOrder;
    })
    .map((n) => {
      const stageId = nodeStageMap.get(n.id);
      const stage = stageId ? sortedStages.find((s) => s.id === stageId) : undefined;
      return {
        checkId: "unreachable-node" as const,
        severity: "warning" as const,
        blocking: false,
        nodeId: n.id,
        nodeTitle: n.title,
        stageName: stage?.name,
        message: "Node has no incoming connections from the primary stage",
      };
    });
}

/** Detect nodes without an assigned worker. */
export function checkWorkerMissing(nodes: WorkflowNode[]): PreflightIssue[] {
  return nodes
    .filter((n) => !isAnnotation(n) && !isGateway(n) && (!n.worker_type || !n.worker_id))
    .map((n): PreflightIssue => ({
      checkId: isSplit(n) ? "split-planner-missing" : "worker-missing",
      severity: "error" as const,
      blocking: true,
      nodeId: n.id,
      nodeTitle: n.title,
      message: isSplit(n) ? "Assign an Agent to this split node" : "Assign a worker to this node",
    }));
}

/** Detect nodes with invalid critic references (critic_id not in agent list). */
export function checkInvalidCriticRef(nodes: WorkflowNode[], agentIds: Set<string>): PreflightIssue[] {
  return nodes
    .filter((n) => {
      if (isGateway(n)) return false;
      if (!n.critic_id) return false;
      if (n.critic_type !== "agent") return false;
      return !agentIds.has(n.critic_id);
    })
    .map((n) => ({
      checkId: "invalid-critic-ref" as const,
      severity: "error" as const,
      blocking: true,
      nodeId: n.id,
      nodeTitle: n.title,
      message: "Critic ID not found in available agents",
    }));
}

/** Detect split nodes without an explicit critic/reviewer. */
export function checkSplitCriticRequired(nodes: WorkflowNode[]): PreflightIssue[] {
  return nodes
    .filter((n) => {
      if (!isSplit(n)) return false;
      if (n.critic_type === "api") return !n.critic_api_url;
      return !n.critic_id;
    })
    .map((n) => ({
      checkId: "split-critic-missing" as const,
      severity: "error" as const,
      blocking: true,
      nodeId: n.id,
      nodeTitle: n.title,
      message: "Assign a Critic to review split drafts",
    }));
}

/** Warn when split draft generation uses a non-specialized worker. */
export function checkSplitWorkerSpecialized(
  nodes: WorkflowNode[],
  splitPlannerAgentIds: Set<string> = defaultSplitPlannerAgentIds,
): PreflightIssue[] {
  return nodes
    .filter((n) => {
      if (!isSplit(n)) return false;
      if (!n.worker_type || !n.worker_id) return false;
      if (n.worker_type !== "agent") return true;
      return !splitPlannerAgentIds.has(n.worker_id);
    })
    .map((n) => ({
      checkId: "split-planner-not-specialized" as const,
      severity: "warning" as const,
      blocking: false,
      nodeId: n.id,
      nodeTitle: n.title,
      message: "Use a dedicated split planner agent for this split node",
    }));
}

/** Warn when split draft review is configured for automatic approval. */
export function checkSplitAutomatedCriticWarning(nodes: WorkflowNode[]): PreflightIssue[] {
  return nodes
    .filter((n) => {
      if (!isSplit(n)) return false;
      if (n.critic_type === "agent") return Boolean(n.critic_id);
      if (n.critic_type === "api") return Boolean(n.critic_api_url);
      return false;
    })
    .map((n) => ({
      checkId: "split-critic-automated" as const,
      severity: "warning" as const,
      blocking: false,
      nodeId: n.id,
      nodeTitle: n.title,
      message: "Automated split draft critics can approve risky task plans",
    }));
}

/** Detect nodes without a stage assignment. */
export function checkStageMissing(nodes: WorkflowNode[]): PreflightIssue[] {
  return nodes
    .filter((n) => !isAnnotation(n) && !isGateway(n) && !n.stage_id)
    .map((n) => ({
      checkId: "stage-missing" as const,
      severity: "warning" as const,
      blocking: false,
      nodeId: n.id,
      nodeTitle: n.title,
      message: "Assign this node to a stage",
    }));
}

export interface SplitIssueWorkflowPreflightContext {
  id: string;
  status: string;
  nodes: WorkflowNode[];
}

export function checkSplitChildWorkflowConfig(
  nodes: WorkflowNode[],
  splitChildWorkflows: SplitIssueWorkflowPreflightContext[] = [],
): PreflightIssue[] {
  const workflowsByID = new Map(splitChildWorkflows.map((workflow) => [workflow.id, workflow]));
  const issues: PreflightIssue[] = [];

  for (const node of nodes) {
    const format = parseNodeFormat(node.format_schema);
    if (format.kind !== "split") continue;

    const defaultIssueWorkflowID = format.split_config?.default_issue_workflow_id;
    if (!defaultIssueWorkflowID) {
      issues.push({
        checkId: "split-default-issue-workflow-missing",
        severity: "error",
        blocking: true,
        nodeId: node.id,
        nodeTitle: node.title,
        message: "Split node needs a default issue workflow",
      });
      continue;
    }

    const childWorkflow = workflowsByID.get(defaultIssueWorkflowID);
    if (defaultIssueWorkflowID === node.workflow_id) {
      issues.push({
        checkId: "split-default-issue-workflow-self",
        severity: "error",
        blocking: true,
        nodeId: node.id,
        nodeTitle: node.title,
        message: "Split default issue workflow cannot be the current workflow",
      });
    }

    if (defaultIssueWorkflowID !== node.workflow_id && !childWorkflow) {
      issues.push({
        checkId: "split-default-issue-workflow-invalid",
        severity: "error",
        blocking: true,
        nodeId: node.id,
        nodeTitle: node.title,
        message: "Split default issue workflow is unavailable",
      });
    }

    if (childWorkflow && childWorkflow.status !== "active") {
      issues.push({
        checkId: "split-default-issue-workflow-inactive",
        severity: "error",
        blocking: true,
        nodeId: node.id,
        nodeTitle: node.title,
        message: "Split default issue workflow must be active",
      });
    }

    if (childWorkflow?.nodes.some((workflowNode) => parseNodeFormat(workflowNode.format_schema).kind === "split")) {
      issues.push({
        checkId: "split-default-issue-workflow-nested",
        severity: "error",
        blocking: true,
        nodeId: node.id,
        nodeTitle: node.title,
        message: "Split default issue workflow cannot contain another split node",
      });
    }
  }

  return issues;
}

export function checkSplitMaxConcurrency(nodes: WorkflowNode[]): PreflightIssue[] {
  return nodes.flatMap((node) => {
    const format = parseNodeFormat(node.format_schema);
    if (format.kind !== "split") return [];
    const schema = node.format_schema as Record<string, unknown>;
    const rawConfig = schema.split_config;
    const value = rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
      ? (rawConfig as Record<string, unknown>).max_concurrency
      : undefined;
    if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 50) return [];
    return [{
      checkId: "split-max-concurrency-invalid" as const,
      severity: "error" as const,
      blocking: true,
      nodeId: node.id,
      nodeTitle: node.title,
      message: "Split concurrency must be an integer from 1 to 50",
    }];
  });
}

export function checkGatewayTopology(nodes: WorkflowNode[], edges: WorkflowEdge[]): PreflightIssue[] {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const node of nodes) {
    incoming.set(node.id, 0);
    outgoing.set(node.id, 0);
  }
  for (const edge of edges) {
    outgoing.set(edge.source_node_id, (outgoing.get(edge.source_node_id) ?? 0) + 1);
    incoming.set(edge.target_node_id, (incoming.get(edge.target_node_id) ?? 0) + 1);
  }

  const issues: PreflightIssue[] = [];
  for (const node of nodes) {
    const format = parseNodeFormat(node.format_schema);
    if (format.kind !== "gateway") continue;

    if (!format.gateway_kind_valid) {
      issues.push({
        checkId: "gateway-kind-invalid",
        severity: "error",
        blocking: true,
        nodeId: node.id,
        nodeTitle: node.title,
        message: "Gateway type must be Fork or Join",
      });
      continue;
    }

    if (format.gateway_kind === "fork" && (outgoing.get(node.id) ?? 0) < 2) {
      issues.push({
        checkId: "gateway-fork-outgoing",
        severity: "error",
        blocking: true,
        nodeId: node.id,
        nodeTitle: node.title,
        message: "Fork gateway needs at least two downstream nodes",
      });
    }

    if (format.gateway_kind === "join") {
      if ((incoming.get(node.id) ?? 0) < 2) {
        issues.push({
          checkId: "gateway-join-incoming",
          severity: "error",
          blocking: true,
          nodeId: node.id,
          nodeTitle: node.title,
          message: "Join gateway needs at least two upstream nodes",
        });
      }
      if ((outgoing.get(node.id) ?? 0) > 1) {
        issues.push({
          checkId: "gateway-join-multiple-outgoing",
          severity: "warning",
          blocking: false,
          nodeId: node.id,
          nodeTitle: node.title,
          message: "Join gateway usually continues to one downstream node",
        });
      }
    }
  }
  return issues;
}

// ── Master aggregator ──

export interface PreflightCheckInput {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  stages: WorkflowStage[];
  agentIds: Set<string>;
  splitPlannerAgentIds?: Set<string>;
  splitChildWorkflows?: SplitIssueWorkflowPreflightContext[];
}

export function runAllPreflightChecks(input: PreflightCheckInput): PreflightResult {
  const { nodes, edges, stages, agentIds } = input;

  if (nodes.length === 0) {
    return { issues: [], blockingCount: 0, warningCount: 0, passed: true };
  }

  const allIssues: PreflightIssue[] = [
    ...checkDAGCycles(nodes, edges),
    ...checkOrphanNodes(nodes, edges),
    ...checkUnreachableNodes(nodes, edges, stages),
    ...checkWorkerMissing(nodes),
    ...checkSplitWorkerSpecialized(nodes, input.splitPlannerAgentIds),
    ...checkSplitCriticRequired(nodes),
    ...checkSplitAutomatedCriticWarning(nodes),
    ...checkInvalidCriticRef(nodes, agentIds),
    ...checkStageMissing(nodes),
    ...checkGatewayTopology(nodes, edges),
    ...checkSplitChildWorkflowConfig(nodes, input.splitChildWorkflows ?? []),
    ...checkSplitMaxConcurrency(nodes),
  ];

  // Sort: blocking first, then by checkId, then by nodeTitle
  allIssues.sort((a, b) => {
    if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
    if (a.checkId !== b.checkId) return a.checkId.localeCompare(b.checkId);
    return (a.nodeTitle ?? "").localeCompare(b.nodeTitle ?? "");
  });

  const blockingCount = allIssues.filter((i) => i.blocking).length;
  const warningCount = allIssues.filter((i) => !i.blocking).length;

  return {
    issues: allIssues,
    blockingCount,
    warningCount,
    passed: allIssues.length === 0,
  };
}

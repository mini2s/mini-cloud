import type { CanvasModel } from "./types";

export type PreflightIssueCode =
  | "missing_worker"
  | "missing_critic"
  | "isolated_node"
  | "unreachable_node"
  | "cycle_detected";

export interface CanvasPreflightIssue {
  code: PreflightIssueCode;
  nodeId?: string;
  edgeId?: string;
  message: string;
}

function hasCycle(model: CanvasModel): boolean {
  const adjacency = new Map<string, string[]>();
  for (const node of model.nodes) adjacency.set(node.id, []);
  for (const edge of model.edges) adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId);

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  return model.nodes.some((node) => visit(node.id));
}

function reachableNodeIds(model: CanvasModel): Set<string> {
  const adjacency = new Map(model.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of model.edges) {
    adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId);
  }

  // BFS from all nodes that have outgoing edges (the "sources" of the DAG).
  const queue = [...new Set(model.edges.map((e) => e.sourceNodeId))];
  const reachable = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    queue.push(...(adjacency.get(id) ?? []));
  }
  return reachable;
}

export function runCanvasPreflight(model: CanvasModel): CanvasPreflightIssue[] {
  const issues: CanvasPreflightIssue[] = [];

  for (const node of model.nodes) {
    if (!node.workerId) {
      issues.push({
        code: "missing_worker",
        nodeId: node.id,
        message: `Node "${node.title}" is missing a worker.`,
      });
    }
    if (!node.criticId && !node.criticApiUrl) {
      issues.push({
        code: "missing_critic",
        nodeId: node.id,
        message: `Node "${node.title}" is missing a critic.`,
      });
    }
  }

  const connected = new Set<string>();
  for (const edge of model.edges) {
    connected.add(edge.sourceNodeId);
    connected.add(edge.targetNodeId);
  }
  for (const node of model.nodes) {
    if (!connected.has(node.id)) {
      issues.push({
        code: "isolated_node",
        nodeId: node.id,
        message: `Node "${node.title}" is not connected.`,
      });
    }
  }

  if (hasCycle(model)) {
    issues.push({
      code: "cycle_detected",
      message: "Workflow contains a cycle.",
    });
  }

  if (model.edges.length > 0) {
    const reachable = reachableNodeIds(model);
    for (const node of model.nodes) {
      if (!reachable.has(node.id)) {
        issues.push({
          code: "unreachable_node",
          nodeId: node.id,
          message: `Node "${node.title}" is unreachable from the workflow start.`,
        });
      }
    }
  }

  return issues;
}

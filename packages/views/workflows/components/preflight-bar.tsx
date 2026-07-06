"use client";

import type { WorkflowNode, WorkflowEdge } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { AlertCircle, AlertTriangle } from "lucide-react";

export interface PreflightCheck {
  type: "cycle-detected" | "orphan-node" | "unreachable-node" | "missing-worker" | "missing-stage" | "missing-schema";
  severity: "error" | "warning";
  message: string;
  nodeId?: string;
}

function isAnnotationNode(node: WorkflowNode): boolean {
  return Boolean(
    node.format_schema &&
      typeof node.format_schema === "object" &&
      !Array.isArray(node.format_schema) &&
      (node.format_schema as Record<string, unknown>).type === "annotation",
  );
}

/** Run validation checks against workflow nodes and edges. */
export function runPreflightChecks(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): PreflightCheck[] {
  const checks: PreflightCheck[] = [];

  // Build adjacency for graph analysis
  const inDegree = new Map(nodes.map((n) => [n.id, 0]));
  const outEdges = new Map(nodes.map((n) => [n.id, [] as string[]]));

  for (const edge of edges) {
    inDegree.set(edge.target_node_id, (inDegree.get(edge.target_node_id) ?? 0) + 1);
    const outs = outEdges.get(edge.source_node_id) ?? [];
    outs.push(edge.target_node_id);
    outEdges.set(edge.source_node_id, outs);
  }

  // Cycle detection via DFS topological order check
  const visited = new Set<string>();
  const inStack = new Set<string>();
  let hasCycle = false;

  function dfs(nodeId: string) {
    if (hasCycle) return;
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const next of outEdges.get(nodeId) ?? []) {
      if (inStack.has(next)) { hasCycle = true; return; }
      if (!visited.has(next)) dfs(next);
    }
    inStack.delete(nodeId);
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) dfs(node.id);
  }

  if (hasCycle) {
    checks.push({ type: "cycle-detected", severity: "error", message: "DAG contains a cycle — workflow cannot be published" });
  }

  // Worker check
  for (const node of nodes) {
    if (!node.worker_id) {
      const isAnnotation = isAnnotationNode(node);
      if (!isAnnotation) {
        checks.push({ type: "missing-worker", severity: "error", message: `"${node.title}" has no worker assigned`, nodeId: node.id });
      }
    }
  }

  // Orphan nodes (no incoming or outgoing edges)
  for (const node of nodes) {
    const hasIncoming = (inDegree.get(node.id) ?? 0) > 0;
    const hasOutgoing = (outEdges.get(node.id)?.length ?? 0) > 0;
    if (!hasIncoming && !hasOutgoing) {
      const isAnnotation = isAnnotationNode(node);
      if (!isAnnotation) {
        checks.push({ type: "orphan-node", severity: "warning", message: `"${node.title}" is not connected to any other node`, nodeId: node.id });
      }
    }
  }

  // Unreachable nodes (no incoming edges, not the first node)
  if (nodes.length > 1) {
    for (const node of nodes) {
      if ((inDegree.get(node.id) ?? 0) === 0 && (outEdges.get(node.id)?.length ?? 0) > 0) {
        // Only warn if there are other nodes with incoming edges (i.e., this could be a root node)
        const someHaveIncoming = nodes.some((n) => n.id !== node.id && (inDegree.get(n.id) ?? 0) > 0);
        const isAnnotation = isAnnotationNode(node);
        if (someHaveIncoming && !isAnnotation) {
          checks.push({ type: "unreachable-node", severity: "warning", message: `"${node.title}" may be unreachable (no incoming edges)`, nodeId: node.id });
        }
      }
    }
  }

  return checks;
}

export interface PreflightBarProps {
  checks: PreflightCheck[];
  onCheckClick?: (check: PreflightCheck) => void;
  className?: string;
}

/** Bottom bar displaying pre-publish validation results. */
export function PreflightBar({ checks, onCheckClick, className }: PreflightBarProps) {
  if (checks.length === 0) return null;

  const errors = checks.filter((c) => c.severity === "error");
  const warnings = checks.filter((c) => c.severity === "warning");

  return (
    <div
      data-testid="preflight-bar"
      className={cn("flex items-center gap-2 px-4 py-2 border-t bg-muted/50 text-xs", className)}
    >
      {errors.length > 0 && (
        <span className="flex items-center gap-1 text-destructive font-medium">
          <AlertCircle className="h-3.5 w-3.5" />
          {errors.length} error{errors.length > 1 ? "s" : ""}
        </span>
      )}
      {warnings.length > 0 && (
        <span className="flex items-center gap-1 text-workflow-warning font-medium">
          <AlertTriangle className="h-3.5 w-3.5" />
          {warnings.length} warning{warnings.length > 1 ? "s" : ""}
        </span>
      )}
      <div className="flex-1" />
      <div className="flex items-center gap-3">
        {checks.map((check, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onCheckClick?.(check)}
            className={cn(
              "flex items-center gap-1 hover:underline cursor-pointer",
              check.severity === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {check.severity === "error" ? <AlertCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            <span className="truncate max-w-[180px]">{check.message}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

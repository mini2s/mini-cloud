package service

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"

	"github.com/multica-ai/multica/server/internal/util"
)

// PreflightIssue represents a single issue found during preflight check.
type PreflightIssue struct {
	Severity string  `json:"severity"` // "error" or "warning"
	Message  string  `json:"message"`
	NodeID   *string `json:"node_id,omitempty"`
}

// PreflightResult is the outcome of a workflow preflight check.
type PreflightResult struct {
	Passed bool             `json:"passed"` // true if no blocking issues
	Issues []PreflightIssue `json:"issues"`
}

// RunPreflight runs all preflight checks against a workflow and returns issues.
// Blocking issues (severity="error") prevent publishing.
func RunPreflight(ctx context.Context, q *db.Queries, workflowID pgtype.UUID) (*PreflightResult, error) {
	issues := make([]PreflightIssue, 0)

	nodes, err := q.ListWorkflowNodes(ctx, workflowID)
	if err != nil {
		return nil, fmt.Errorf("list nodes: %w", err)
	}
	edges, err := q.ListWorkflowEdges(ctx, workflowID)
	if err != nil {
		return nil, fmt.Errorf("list edges: %w", err)
	}

	// Build adjacency for graph checks
	inDegree := make(map[string]int)
	outDegree := make(map[string]int)
	nodeIDs := make(map[string]bool)
	for _, n := range nodes {
		nid := util.UUIDToString(n.ID)
		nodeIDs[nid] = true
		inDegree[nid] = 0
		outDegree[nid] = 0
	}
	for _, e := range edges {
		src := util.UUIDToString(e.SourceNodeID)
		tgt := util.UUIDToString(e.TargetNodeID)
		outDegree[src]++
		inDegree[tgt]++
	}

	// 1. DAG cycle detection (blocking) — use Kahn's algorithm
	if hasCycle(nodeIDs, inDegree, outDegree, edges) {
		issues = append(issues, PreflightIssue{
			Severity: "error",
			Message:  "Workflow contains a cycle. DAG structure is required.",
		})
	}

	// 2. Orphaned nodes (warning) — nodes with no edges at all
	for _, n := range nodes {
		nid := util.UUIDToString(n.ID)
		if inDegree[nid] == 0 && outDegree[nid] == 0 {
			issues = append(issues, PreflightIssue{
				Severity: "warning",
				Message:  fmt.Sprintf("Node %q is not connected to any other node", n.Title),
				NodeID:   strPtr(nid),
			})
		}
	}

	// 3. Unreachable nodes (warning) — nodes with no incoming edge and not a start node
	// Start nodes have no incoming edges and >=1 outgoing edge — they're legitimate.
	// Unreachable = no incoming AND no outgoing AND not alone (already caught by orphaned)
	// True unreachable: multiple start nodes that cannot all be reached from the same DAG
	startCount := 0
	for _, n := range nodes {
		nid := util.UUIDToString(n.ID)
		if inDegree[nid] == 0 && outDegree[nid] > 0 {
			startCount++
		}
	}
	if startCount > 1 {
		issues = append(issues, PreflightIssue{
			Severity: "warning",
			Message:  fmt.Sprintf("Workflow has %d start nodes. Consider using a single entry point.", startCount),
		})
	}

	// 4. Per-node checks
	for _, n := range nodes {
		nid := util.UUIDToString(n.ID)

		// Worker missing (blocking)
		if n.WorkerType == "" {
			issues = append(issues, PreflightIssue{
				Severity: "error",
				Message:  fmt.Sprintf("Node %q has no worker assigned", n.Title),
				NodeID:   strPtr(nid),
			})
		}

		// Agent-type worker without worker_id (blocking)
		if n.WorkerType == "agent" && !n.WorkerID.Valid {
			issues = append(issues, PreflightIssue{
				Severity: "error",
				Message:  fmt.Sprintf("Node %q has agent worker but no agent selected", n.Title),
				NodeID:   strPtr(nid),
			})
		}

		// Critic reference validity (blocking) — only check if critic_id is set
		if n.CriticID.Valid {
			switch n.CriticType {
			case "agent":
				_, err := q.GetAgent(ctx, n.CriticID)
				if err != nil {
					issues = append(issues, PreflightIssue{
						Severity: "error",
						Message:  fmt.Sprintf("Node %q references a non-existent critic agent", n.Title),
						NodeID:   strPtr(nid),
					})
				}
			case "human":
				_, err := q.GetMember(ctx, n.CriticID)
				if err != nil {
					issues = append(issues, PreflightIssue{
						Severity: "error",
						Message:  fmt.Sprintf("Node %q references a non-existent critic member", n.Title),
						NodeID:   strPtr(nid),
					})
				}
			case "squad":
				_, err := q.GetSquad(ctx, n.CriticID)
				if err != nil {
					issues = append(issues, PreflightIssue{
						Severity: "error",
						Message:  fmt.Sprintf("Node %q references a non-existent critic squad", n.Title),
						NodeID:   strPtr(nid),
					})
				}
			}
		}

		// Stage missing (warning)
		if !n.StageID.Valid {
			issues = append(issues, PreflightIssue{
				Severity: "warning",
				Message:  fmt.Sprintf("Node %q is not assigned to any stage", n.Title),
				NodeID:   strPtr(nid),
			})
		}
	}

	passed := true
	for _, issue := range issues {
		if issue.Severity == "error" {
			passed = false
			break
		}
	}

	return &PreflightResult{Passed: passed, Issues: issues}, nil
}

// hasCycle detects cycles using Kahn's algorithm (topological sort).
func hasCycle(nodeIDs map[string]bool, inDegree map[string]int, outDegree map[string]int, edges []db.MulticaWorkflowEdge) bool {
	if len(nodeIDs) == 0 {
		return false
	}

	// Copy in-degree for manipulation
	deg := make(map[string]int, len(inDegree))
	for k, v := range inDegree {
		deg[k] = v
	}

	// Build adjacency list
	adj := make(map[string][]string)
	for _, e := range edges {
		src := util.UUIDToString(e.SourceNodeID)
		tgt := util.UUIDToString(e.TargetNodeID)
		adj[src] = append(adj[src], tgt)
	}

	// Queue nodes with in-degree 0
	queue := make([]string, 0)
	for nid := range nodeIDs {
		if deg[nid] == 0 {
			queue = append(queue, nid)
		}
	}

	visited := 0
	for len(queue) > 0 {
		nid := queue[0]
		queue = queue[1:]
		visited++

		for _, neighbor := range adj[nid] {
			deg[neighbor]--
			if deg[neighbor] == 0 {
				queue = append(queue, neighbor)
			}
		}
	}

	return visited != len(nodeIDs)
}

// Helpers for pointer creation
func strPtr(s string) *string { return &s }

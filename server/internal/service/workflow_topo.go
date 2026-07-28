package service

import (
	"context"
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/multica-ai/multica/server/internal/gitea"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// NodeTopoOrder returns a map of workflow node ID (string) → its 0-based
// position in a stable topological order of the workflow DAG. It backs the
// readable <NN> prefix in Gitea deliverable repo paths (NodeBranch/NodeDir/
// DeliverablePath) so nodes sort in execution order even when sort_order was
// not explicitly set on every node (e.g. workflows authored by edge alone).
func NodeTopoOrder(ctx context.Context, q *db.Queries, workflowID pgtype.UUID) (map[string]int, error) {
	nodes, err := q.ListWorkflowNodes(ctx, workflowID)
	if err != nil {
		return nil, fmt.Errorf("list workflow nodes: %w", err)
	}
	edges, err := q.ListWorkflowEdges(ctx, workflowID)
	if err != nil {
		return nil, fmt.Errorf("list workflow edges: %w", err)
	}
	topoNodes := make([]gitea.TopoNode, len(nodes))
	for i, n := range nodes {
		topoNodes[i] = gitea.TopoNode{
			ID:        util.UUIDToString(n.ID),
			SortOrder: n.SortOrder,
			Title:     n.Title,
		}
	}
	topoEdges := make([]gitea.TopoEdge, len(edges))
	for i, e := range edges {
		topoEdges[i] = gitea.TopoEdge{
			From: util.UUIDToString(e.SourceNodeID),
			To:   util.UUIDToString(e.TargetNodeID),
		}
	}
	return gitea.NodeTopoOrder(topoNodes, topoEdges), nil
}

// RunNodeTopoOrder returns stable positions keyed by node-run ID. Runtime
// edges determine dependencies while the immutable definition snapshot only
// supplies the captured sort order.
func RunNodeTopoOrder(ctx context.Context, q *db.Queries, runID pgtype.UUID) (map[string]int, error) {
	nodeRuns, err := q.ListWorkflowNodeRunsByRun(ctx, runID)
	if err != nil {
		return nil, fmt.Errorf("list workflow node runs: %w", err)
	}
	edges, err := q.ListWorkflowRunEdges(ctx, runID)
	if err != nil {
		return nil, fmt.Errorf("list workflow run edges: %w", err)
	}
	sortOrderBySource := make(map[string]int32, len(nodeRuns))
	if snapshot, snapshotErr := (WorkflowRuntimeRepository{Queries: q}).GetRunDefinitionSnapshot(ctx, runID); snapshotErr == nil {
		for _, node := range snapshot.Nodes {
			sortOrderBySource[node.ID] = node.SortOrder
		}
	}
	topoNodes := make([]gitea.TopoNode, len(nodeRuns))
	for i, nodeRun := range nodeRuns {
		topoNodes[i] = gitea.TopoNode{
			ID:        util.UUIDToString(nodeRun.ID),
			SortOrder: sortOrderBySource[util.UUIDToString(nodeRun.SourceWorkflowNodeID)],
			Title:     nodeRun.NodeTitle,
		}
	}
	topoEdges := make([]gitea.TopoEdge, len(edges))
	for i, edge := range edges {
		topoEdges[i] = gitea.TopoEdge{
			From: util.UUIDToString(edge.SourceNodeRunID),
			To:   util.UUIDToString(edge.TargetNodeRunID),
		}
	}
	return gitea.NodeTopoOrder(topoNodes, topoEdges), nil
}

// workflowDAGHasCycle reports whether the directed graph contains a cycle.
// Unknown edge endpoints are ignored because callers validate references
// separately before using this topology result.
func workflowDAGHasCycle(nodes []gitea.TopoNode, edges []gitea.TopoEdge) bool {
	inDegree := make(map[string]int, len(nodes))
	adjacency := make(map[string][]string, len(nodes))
	for _, node := range nodes {
		inDegree[node.ID] = 0
	}
	for _, edge := range edges {
		if _, ok := inDegree[edge.From]; !ok {
			continue
		}
		if _, ok := inDegree[edge.To]; !ok {
			continue
		}
		adjacency[edge.From] = append(adjacency[edge.From], edge.To)
		inDegree[edge.To]++
	}
	ready := make([]string, 0, len(nodes))
	for id, degree := range inDegree {
		if degree == 0 {
			ready = append(ready, id)
		}
	}
	slices.Sort(ready)
	emitted := 0
	for len(ready) > 0 {
		id := ready[0]
		ready = ready[1:]
		emitted++
		for _, target := range adjacency[id] {
			inDegree[target]--
			if inDegree[target] == 0 {
				ready = append(ready, target)
				slices.Sort(ready)
			}
		}
	}
	return emitted != len(inDegree)
}

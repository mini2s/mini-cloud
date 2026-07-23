package service

import (
	"context"
	"fmt"

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

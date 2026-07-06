package service

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestHasCycle_NoEdges(t *testing.T) {
	nodeIDs := map[string]bool{"a": true, "b": true}
	inDegree := map[string]int{"a": 0, "b": 0}
	outDegree := map[string]int{"a": 0, "b": 0}
	var edges []db.MulticaWorkflowEdge

	if hasCycle(nodeIDs, inDegree, outDegree, edges) {
		t.Error("expected no cycle for disconnected nodes")
	}
}

func TestHasCycle_SimpleCycle(t *testing.T) {
	nodeIDs := map[string]bool{"00000000-0000-0000-0000-000000000001": true, "00000000-0000-0000-0000-000000000002": true}
	inDegree := map[string]int{"00000000-0000-0000-0000-000000000001": 1, "00000000-0000-0000-0000-000000000002": 1}
	outDegree := map[string]int{"00000000-0000-0000-0000-000000000001": 1, "00000000-0000-0000-0000-000000000002": 1}

	aUUID := pgtype.UUID{Bytes: [16]byte{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1}, Valid: true}
	bUUID := pgtype.UUID{Bytes: [16]byte{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2}, Valid: true}
	edges := []db.MulticaWorkflowEdge{
		{SourceNodeID: aUUID, TargetNodeID: bUUID},
		{SourceNodeID: bUUID, TargetNodeID: aUUID},
	}

	if !hasCycle(nodeIDs, inDegree, outDegree, edges) {
		t.Error("expected cycle for A->B->A")
	}
}

func TestHasCycle_ValidDAG(t *testing.T) {
	nodeIDs := map[string]bool{"00000000-0000-0000-0000-000000000001": true, "00000000-0000-0000-0000-000000000002": true, "00000000-0000-0000-0000-000000000003": true}
	inDegree := map[string]int{"00000000-0000-0000-0000-000000000001": 0, "00000000-0000-0000-0000-000000000002": 1, "00000000-0000-0000-0000-000000000003": 1}
	outDegree := map[string]int{"00000000-0000-0000-0000-000000000001": 2, "00000000-0000-0000-0000-000000000002": 0, "00000000-0000-0000-0000-000000000003": 0}

	aUUID := pgtype.UUID{Bytes: [16]byte{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1}, Valid: true}
	bUUID := pgtype.UUID{Bytes: [16]byte{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2}, Valid: true}
	cUUID := pgtype.UUID{Bytes: [16]byte{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3}, Valid: true}
	edges := []db.MulticaWorkflowEdge{
		{SourceNodeID: aUUID, TargetNodeID: bUUID},
		{SourceNodeID: aUUID, TargetNodeID: cUUID},
	}

	if hasCycle(nodeIDs, inDegree, outDegree, edges) {
		t.Error("expected no cycle for valid DAG A->B, A->C")
	}
}

func TestHasCycle_SelfLoop(t *testing.T) {
	nodeIDs := map[string]bool{"00000000-0000-0000-0000-000000000001": true}
	inDegree := map[string]int{"00000000-0000-0000-0000-000000000001": 1}
	outDegree := map[string]int{"00000000-0000-0000-0000-000000000001": 1}

	aUUID := pgtype.UUID{Bytes: [16]byte{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1}, Valid: true}
	edges := []db.MulticaWorkflowEdge{
		{SourceNodeID: aUUID, TargetNodeID: aUUID},
	}

	if !hasCycle(nodeIDs, inDegree, outDegree, edges) {
		t.Error("expected cycle for self-loop")
	}
}

func TestHasCycle_EmptyNodes(t *testing.T) {
	nodeIDs := map[string]bool{}
	inDegree := map[string]int{}
	outDegree := map[string]int{}
	var edges []db.MulticaWorkflowEdge

	if hasCycle(nodeIDs, inDegree, outDegree, edges) {
		t.Error("expected no cycle for empty node set")
	}
}

func TestHasCycle_TwoParentDAG(t *testing.T) {
	nodeIDs := map[string]bool{"00000000-0000-0000-0000-000000000001": true, "00000000-0000-0000-0000-000000000002": true, "00000000-0000-0000-0000-000000000003": true}
	inDegree := map[string]int{"00000000-0000-0000-0000-000000000001": 0, "00000000-0000-0000-0000-000000000002": 0, "00000000-0000-0000-0000-000000000003": 2}
	outDegree := map[string]int{"00000000-0000-0000-0000-000000000001": 1, "00000000-0000-0000-0000-000000000002": 1, "00000000-0000-0000-0000-000000000003": 0}

	aUUID := pgtype.UUID{Bytes: [16]byte{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1}, Valid: true}
	bUUID := pgtype.UUID{Bytes: [16]byte{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2}, Valid: true}
	cUUID := pgtype.UUID{Bytes: [16]byte{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3}, Valid: true}
	edges := []db.MulticaWorkflowEdge{
		{SourceNodeID: aUUID, TargetNodeID: cUUID},
		{SourceNodeID: bUUID, TargetNodeID: cUUID},
	}

	if hasCycle(nodeIDs, inDegree, outDegree, edges) {
		t.Error("expected no cycle for valid DAG with multiple parents")
	}
}

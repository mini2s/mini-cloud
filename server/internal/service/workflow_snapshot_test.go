package service

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestBuildWorkflowDefinitionSnapshotProducesStableTypedJSON(t *testing.T) {
	rows := workflowDefinitionRowsFixture()
	first, err := BuildWorkflowDefinitionSnapshot(rows)
	if err != nil {
		t.Fatal(err)
	}
	second, err := BuildWorkflowDefinitionSnapshot(rows)
	if err != nil {
		t.Fatal(err)
	}
	a, err := json.Marshal(first)
	if err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(second)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(a, b) {
		t.Fatalf("snapshot is not stable:\n%s\n%s", a, b)
	}
	if first.SchemaVersion != 1 || first.SnapshotOrigin != "native" {
		t.Fatalf("unexpected header: %#v", first)
	}
	if got := []string{first.Stages[0].ID, first.Stages[1].ID}; !equalStrings(got, []string{"stage-a", "stage-b"}) {
		t.Fatalf("stage order=%v", got)
	}
	if got := []string{first.Nodes[0].ID, first.Nodes[1].ID, first.Nodes[2].ID}; !equalStrings(got, []string{"node-a", "node-b", "node-c"}) {
		t.Fatalf("node order=%v", got)
	}
	if got := []string{first.Edges[0].ID, first.Edges[1].ID}; !equalStrings(got, []string{"edge-a", "edge-b"}) {
		t.Fatalf("edge order=%v", got)
	}
	if got := []string{first.Deliverables[0].ID, first.Deliverables[1].ID}; !equalStrings(got, []string{"deliverable-a", "deliverable-b"}) {
		t.Fatalf("deliverable order=%v", got)
	}
}

func workflowDefinitionRowsFixture() WorkflowDefinitionRows {
	return WorkflowDefinitionRows{
		Workflow: WorkflowSnapshotWorkflow{
			ID: "workflow-1", WorkspaceID: "workspace-1", Title: "Stable workflow",
			Description: "Snapshot fixture", MaxRetries: 3,
			RuntimeSelectionPolicy: "idle_first", ConfigRevision: 7,
		},
		Stages: []WorkflowSnapshotStage{
			{ID: "stage-b", Name: "Build", SortOrder: 2},
			{ID: "stage-a", Name: "Plan", SortOrder: 1},
		},
		Nodes: []WorkflowSnapshotNode{
			{ID: "node-c", Title: "End", Kind: WorkflowSnapshotNodeKindEnd, SortOrder: 3},
			{ID: "node-a", Title: "Start", Kind: WorkflowSnapshotNodeKindStart, SortOrder: 1},
			{
				ID: "node-b", Title: "Implement", Kind: WorkflowSnapshotNodeKindTask,
				Description: "Build it", SortOrder: 2, StageID: "stage-a",
				WorkerType: "agent", WorkerID: "agent-1", WorkerName: "Builder",
				CriticType: "human", CriticID: "user-1", CriticName: "Reviewer",
				FormatSchema: json.RawMessage(`{"type":"object","required":["result"]}`),
			},
		},
		Edges: []WorkflowSnapshotEdge{
			{ID: "edge-b", SourceNodeID: "node-b", TargetNodeID: "node-c", CreatedOrder: 2},
			{ID: "edge-a", SourceNodeID: "node-a", TargetNodeID: "node-b", CreatedOrder: 1},
		},
		Roles: []WorkflowSnapshotRole{
			{ID: "role-b", Name: "QA", Description: "Review"},
			{ID: "role-a", Name: "Developer", Description: "Build"},
		},
		Deliverables: []WorkflowSnapshotDeliverable{
			{ID: "deliverable-b", WorkflowNodeID: "node-b", Kind: "pull_request", Title: "PR", Required: true, SortOrder: 2},
			{ID: "deliverable-a", WorkflowNodeID: "node-b", Kind: "document", Title: "Report", Required: true, SortOrder: 1},
		},
	}
}

func equalStrings(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

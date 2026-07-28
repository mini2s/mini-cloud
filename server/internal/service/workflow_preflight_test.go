package service

import (
	"slices"
	"testing"
)

func TestSnapshotNodeCreatesRunExcludesDisplayOnlyNodes(t *testing.T) {
	tests := []struct {
		kind string
		want bool
	}{
		{kind: WorkflowSnapshotNodeKindTask, want: true},
		{kind: WorkflowSnapshotNodeKindGateway, want: true},
		{kind: WorkflowSnapshotNodeKindSplit, want: true},
		{kind: WorkflowSnapshotNodeKindStart, want: false},
		{kind: WorkflowSnapshotNodeKindEnd, want: false},
		{kind: WorkflowSnapshotNodeKindAnnotation, want: false},
	}
	for _, tt := range tests {
		t.Run(tt.kind, func(t *testing.T) {
			if got := snapshotNodeCreatesRun(tt.kind); got != tt.want {
				t.Fatalf("snapshotNodeCreatesRun(%q)=%v, want %v", tt.kind, got, tt.want)
			}
		})
	}
}

func TestValidateWorkflowDefinitionReturnsStructuredIssues(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*WorkflowDefinitionSnapshot)
		code   string
	}{
		{
			name: "empty graph",
			mutate: func(snapshot *WorkflowDefinitionSnapshot) {
				snapshot.Nodes = nil
				snapshot.Edges = nil
			},
			code: "workflow_empty",
		},
		{name: "cycle", mutate: addSnapshotCycle, code: "dag_cycle"},
		{name: "unreachable node", mutate: addUnreachableSnapshotNode, code: "node_unreachable"},
		{name: "missing worker", mutate: clearSnapshotWorker, code: "worker_missing"},
		{name: "missing role", mutate: pointAtMissingWorkerRole, code: "worker_role_missing"},
		{name: "missing critic", mutate: clearSnapshotCritic, code: "critic_missing"},
		{name: "missing stage", mutate: pointAtMissingSnapshotStage, code: "stage_missing"},
		{name: "invalid split", mutate: invalidateSnapshotSplitConfig, code: "split_config_invalid"},
		{name: "invalid gateway", mutate: invalidateSnapshotGateway, code: "gateway_kind_invalid"},
		{name: "invalid boundary direction", mutate: reverseSnapshotStartEdge, code: "boundary_edge_direction"},
		{name: "invalid deliverable", mutate: invalidateSnapshotDeliverable, code: "deliverable_invalid"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			snapshot := validWorkflowDefinitionSnapshot()
			tt.mutate(&snapshot)
			issues := ValidateWorkflowDefinition(snapshot)
			if !slices.ContainsFunc(issues, func(issue WorkflowConfigIssue) bool {
				return issue.Code == tt.code
			}) {
				t.Fatalf("issues %#v do not contain %q", issues, tt.code)
			}
		})
	}
}

func TestValidateWorkflowDefinitionAcceptsSplitWithoutDefaultIssueWorkflow(t *testing.T) {
	snapshot := validWorkflowDefinitionSnapshot()
	node := snapshotNode(&snapshot, "work")
	node.Kind = WorkflowSnapshotNodeKindSplit
	node.SplitConfig = &WorkflowSnapshotSplitConfig{
		Mode:           SplitModeBarrier,
		MaxConcurrency: 5,
		MaxFailures:    0,
	}

	issues := ValidateWorkflowDefinition(snapshot)
	if slices.ContainsFunc(issues, func(issue WorkflowConfigIssue) bool {
		return issue.Code == "split_config_invalid"
	}) {
		t.Fatalf("valid split without a default issue workflow was rejected: %#v", issues)
	}
}

func TestValidateWorkflowDefinitionReturnsStableIssueOrder(t *testing.T) {
	snapshot := validWorkflowDefinitionSnapshot()
	clearSnapshotWorker(&snapshot)
	pointAtMissingSnapshotStage(&snapshot)
	invalidateSnapshotDeliverable(&snapshot)

	first := ValidateWorkflowDefinition(snapshot)
	second := ValidateWorkflowDefinition(snapshot)
	if len(first) < 3 || !slices.Equal(first, second) {
		t.Fatalf("unstable issues:\nfirst=%#v\nsecond=%#v", first, second)
	}
	for i := 1; i < len(first); i++ {
		previous := first[i-1]
		current := first[i]
		if previous.Code > current.Code || (previous.Code == current.Code && previous.NodeID > current.NodeID) {
			t.Fatalf("issues are not sorted: %#v", first)
		}
	}
}

func validWorkflowDefinitionSnapshot() WorkflowDefinitionSnapshot {
	return WorkflowDefinitionSnapshot{
		SchemaVersion:  WorkflowDefinitionSchemaVersion,
		SnapshotOrigin: "native",
		Workflow: WorkflowSnapshotWorkflow{
			ID: "workflow-1", WorkspaceID: "workspace-1", Title: "Valid workflow",
			MaxRetries: 3, RuntimeSelectionPolicy: "idle_first",
		},
		Stages: []WorkflowSnapshotStage{{ID: "stage-1", Name: "Build", SortOrder: 1}},
		Nodes: []WorkflowSnapshotNode{
			{ID: "start", Title: "Start", Kind: WorkflowSnapshotNodeKindStart, SortOrder: 1},
			{
				ID: "work", Title: "Work", Kind: WorkflowSnapshotNodeKindTask,
				StageID: "stage-1", SortOrder: 2,
				WorkerType: "agent", WorkerID: "agent-1",
				CriticType: "human", CriticID: "user-1",
			},
			{ID: "end", Title: "End", Kind: WorkflowSnapshotNodeKindEnd, SortOrder: 3},
		},
		Edges: []WorkflowSnapshotEdge{
			{ID: "edge-start", SourceNodeID: "start", TargetNodeID: "work", CreatedOrder: 1},
			{ID: "edge-end", SourceNodeID: "work", TargetNodeID: "end", CreatedOrder: 2},
		},
		Deliverables: []WorkflowSnapshotDeliverable{{
			ID: "deliverable-1", WorkflowNodeID: "work", Kind: "document",
			Title: "Report", Required: true, SortOrder: 1,
		}},
	}
}

func addSnapshotCycle(snapshot *WorkflowDefinitionSnapshot) {
	snapshot.Edges = append(snapshot.Edges, WorkflowSnapshotEdge{
		ID: "edge-cycle", SourceNodeID: "end", TargetNodeID: "start", CreatedOrder: 3,
	})
}

func addUnreachableSnapshotNode(snapshot *WorkflowDefinitionSnapshot) {
	snapshot.Nodes = append(snapshot.Nodes, WorkflowSnapshotNode{
		ID: "orphan", Title: "Orphan", Kind: WorkflowSnapshotNodeKindTask,
		WorkerType: "agent", WorkerID: "agent-2", CriticType: "human", CriticID: "user-2",
	})
}

func clearSnapshotWorker(snapshot *WorkflowDefinitionSnapshot) {
	node := snapshotNode(snapshot, "work")
	node.WorkerType = ""
	node.WorkerID = ""
}

func pointAtMissingWorkerRole(snapshot *WorkflowDefinitionSnapshot) {
	node := snapshotNode(snapshot, "work")
	node.WorkerType = "role"
	node.WorkerID = ""
	node.WorkerRoleID = "missing-role"
}

func clearSnapshotCritic(snapshot *WorkflowDefinitionSnapshot) {
	node := snapshotNode(snapshot, "work")
	node.CriticType = ""
	node.CriticID = ""
}

func pointAtMissingSnapshotStage(snapshot *WorkflowDefinitionSnapshot) {
	snapshotNode(snapshot, "work").StageID = "missing-stage"
}

func invalidateSnapshotSplitConfig(snapshot *WorkflowDefinitionSnapshot) {
	node := snapshotNode(snapshot, "work")
	node.Kind = WorkflowSnapshotNodeKindSplit
	node.SplitConfig = &WorkflowSnapshotSplitConfig{
		Mode: "invalid", MaxConcurrency: 0, MaxFailures: -1,
	}
}

func invalidateSnapshotGateway(snapshot *WorkflowDefinitionSnapshot) {
	node := snapshotNode(snapshot, "work")
	node.Kind = WorkflowSnapshotNodeKindGateway
	node.GatewayKind = "invalid"
}

func reverseSnapshotStartEdge(snapshot *WorkflowDefinitionSnapshot) {
	snapshot.Edges[0].SourceNodeID = "work"
	snapshot.Edges[0].TargetNodeID = "start"
}

func invalidateSnapshotDeliverable(snapshot *WorkflowDefinitionSnapshot) {
	snapshot.Deliverables[0].Title = ""
}

func snapshotNode(snapshot *WorkflowDefinitionSnapshot, id string) *WorkflowSnapshotNode {
	for i := range snapshot.Nodes {
		if snapshot.Nodes[i].ID == id {
			return &snapshot.Nodes[i]
		}
	}
	panic("snapshot node not found: " + id)
}

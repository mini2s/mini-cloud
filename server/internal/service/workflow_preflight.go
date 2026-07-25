package service

import (
	"fmt"
	"slices"
	"strings"

	"github.com/multica-ai/multica/server/internal/gitea"
)

type WorkflowConfigIssue struct {
	Code      string `json:"code"`
	NodeID    string `json:"node_id,omitempty"`
	NodeTitle string `json:"node_title,omitempty"`
	Detail    string `json:"detail"`
}

func ValidateWorkflowDefinition(snapshot WorkflowDefinitionSnapshot) []WorkflowConfigIssue {
	issues := make([]WorkflowConfigIssue, 0)
	issues = append(issues, validateSnapshotTopology(snapshot.Nodes, snapshot.Edges)...)
	issues = append(issues, validateSnapshotActors(snapshot.Nodes, snapshot.Roles)...)
	issues = append(issues, validateSnapshotStages(snapshot.Nodes, snapshot.Stages)...)
	issues = append(issues, validateSnapshotSplit(snapshot.Nodes)...)
	issues = append(issues, validateSnapshotDeliverables(snapshot.Nodes, snapshot.Deliverables)...)
	slices.SortFunc(issues, compareWorkflowConfigIssue)
	return issues
}

func validateSnapshotTopology(nodes []WorkflowSnapshotNode, edges []WorkflowSnapshotEdge) []WorkflowConfigIssue {
	if len(nodes) == 0 {
		return []WorkflowConfigIssue{{Code: "workflow_empty", Detail: "Workflow has no nodes"}}
	}
	issues := make([]WorkflowConfigIssue, 0)
	nodeByID := make(map[string]WorkflowSnapshotNode, len(nodes))
	topoNodes := make([]gitea.TopoNode, 0, len(nodes))
	for _, node := range nodes {
		if strings.TrimSpace(node.ID) == "" {
			issues = append(issues, workflowIssue("node_invalid", node, "Node ID is required"))
			continue
		}
		if _, exists := nodeByID[node.ID]; exists {
			issues = append(issues, workflowIssue("node_invalid", node, "Node ID must be unique"))
			continue
		}
		nodeByID[node.ID] = node
		topoNodes = append(topoNodes, gitea.TopoNode{ID: node.ID, SortOrder: node.SortOrder, Title: node.Title})
	}

	incoming := make(map[string][]string, len(nodes))
	outgoing := make(map[string][]string, len(nodes))
	topoEdges := make([]gitea.TopoEdge, 0, len(edges))
	for _, edge := range edges {
		source, sourceExists := nodeByID[edge.SourceNodeID]
		target, targetExists := nodeByID[edge.TargetNodeID]
		if !sourceExists || !targetExists || edge.SourceNodeID == edge.TargetNodeID {
			detail := fmt.Sprintf("Edge %q must reference two different workflow nodes", edge.ID)
			issues = append(issues, WorkflowConfigIssue{Code: "edge_invalid", Detail: detail})
			continue
		}
		incoming[target.ID] = append(incoming[target.ID], source.ID)
		outgoing[source.ID] = append(outgoing[source.ID], target.ID)
		topoEdges = append(topoEdges, gitea.TopoEdge{From: source.ID, To: target.ID})
		if source.Kind == WorkflowSnapshotNodeKindEnd || target.Kind == WorkflowSnapshotNodeKindStart {
			issues = append(issues, workflowIssue("boundary_edge_direction", target, "Edges cannot enter start nodes or leave end nodes"))
		}
	}

	if workflowDAGHasCycle(topoNodes, topoEdges) {
		issues = append(issues, WorkflowConfigIssue{Code: "dag_cycle", Detail: "Workflow graph contains a cycle"})
	}

	startIDs := make([]string, 0, 1)
	for _, node := range nodes {
		switch node.Kind {
		case WorkflowSnapshotNodeKindStart:
			startIDs = append(startIDs, node.ID)
			if len(outgoing[node.ID]) == 0 {
				issues = append(issues, workflowIssue("boundary_start_outgoing", node, "Start node needs an outgoing edge"))
			}
		case WorkflowSnapshotNodeKindEnd:
			if len(incoming[node.ID]) == 0 {
				issues = append(issues, workflowIssue("boundary_end_incoming", node, "End node needs an incoming edge"))
			}
		case WorkflowSnapshotNodeKindGateway:
			switch node.GatewayKind {
			case "fork":
				if len(outgoing[node.ID]) < 2 {
					issues = append(issues, workflowIssue("gateway_fork_outgoing", node, "Fork gateway needs at least two outgoing edges"))
				}
			case "join":
				if len(incoming[node.ID]) < 2 {
					issues = append(issues, workflowIssue("gateway_join_incoming", node, "Join gateway needs at least two incoming edges"))
				}
				if len(outgoing[node.ID]) > 1 {
					issues = append(issues, workflowIssue("gateway_join_outgoing", node, "Join gateway can have at most one outgoing edge"))
				}
			default:
				issues = append(issues, workflowIssue("gateway_kind_invalid", node, "Gateway kind must be fork or join"))
			}
		}
	}

	if len(startIDs) > 0 {
		reachable := reachableSnapshotNodes(startIDs, outgoing)
		for _, node := range nodes {
			if node.Kind != WorkflowSnapshotNodeKindAnnotation && !reachable[node.ID] {
				issues = append(issues, workflowIssue("node_unreachable", node, "Node is not reachable from the start node"))
			}
		}
	} else if len(nodes) > 1 {
		for _, node := range nodes {
			if node.Kind != WorkflowSnapshotNodeKindAnnotation && len(incoming[node.ID]) == 0 && len(outgoing[node.ID]) == 0 {
				issues = append(issues, workflowIssue("node_unreachable", node, "Node is isolated from the workflow graph"))
			}
		}
	}
	return issues
}

func validateSnapshotActors(nodes []WorkflowSnapshotNode, roles []WorkflowSnapshotRole) []WorkflowConfigIssue {
	roleIDs := make(map[string]bool, len(roles))
	for _, role := range roles {
		roleIDs[role.ID] = true
	}
	issues := make([]WorkflowConfigIssue, 0)
	for _, node := range nodes {
		if !snapshotNodeExecutesActors(node.Kind) {
			continue
		}
		switch node.WorkerType {
		case "human":
		case "agent", "squad":
			if node.WorkerID == "" {
				issues = append(issues, workflowIssue("worker_missing", node, "Worker actor is required"))
			}
		case "role":
			if node.WorkerRoleID == "" || !roleIDs[node.WorkerRoleID] {
				issues = append(issues, workflowIssue("worker_role_missing", node, "Worker role is missing"))
			}
		default:
			issues = append(issues, workflowIssue("worker_missing", node, "Worker type is required"))
		}

		switch node.CriticType {
		case "human":
		case "agent", "squad":
			if node.CriticID == "" {
				issues = append(issues, workflowIssue("critic_missing", node, "Critic actor is required"))
			}
		case "api":
			if strings.TrimSpace(node.CriticAPIURL) == "" {
				issues = append(issues, workflowIssue("critic_missing", node, "Critic API URL is required"))
			}
		case "role":
			if node.CriticRoleID == "" || !roleIDs[node.CriticRoleID] {
				issues = append(issues, workflowIssue("critic_role_missing", node, "Critic role is missing"))
			}
		default:
			issues = append(issues, workflowIssue("critic_missing", node, "Critic type is required"))
		}
	}
	return issues
}

func validateSnapshotStages(nodes []WorkflowSnapshotNode, stages []WorkflowSnapshotStage) []WorkflowConfigIssue {
	stageIDs := make(map[string]bool, len(stages))
	for _, stage := range stages {
		stageIDs[stage.ID] = true
	}
	issues := make([]WorkflowConfigIssue, 0)
	for _, node := range nodes {
		if node.StageID != "" && !stageIDs[node.StageID] {
			issues = append(issues, workflowIssue("stage_missing", node, "Referenced stage is missing"))
		}
	}
	return issues
}

func validateSnapshotSplit(nodes []WorkflowSnapshotNode) []WorkflowConfigIssue {
	issues := make([]WorkflowConfigIssue, 0)
	for _, node := range nodes {
		if node.Kind != WorkflowSnapshotNodeKindSplit {
			continue
		}
		config := node.SplitConfig
		if config == nil || strings.TrimSpace(config.DefaultIssueWorkflowID) == "" ||
			(config.Mode != SplitModeBarrier && config.Mode != SplitModePipeline) ||
			config.MaxConcurrency < 1 || config.MaxConcurrency > 50 || config.MaxFailures < 0 {
			issues = append(issues, workflowIssue("split_config_invalid", node, "Split configuration is incomplete or invalid"))
		}
	}
	return issues
}

func validateSnapshotDeliverables(nodes []WorkflowSnapshotNode, deliverables []WorkflowSnapshotDeliverable) []WorkflowConfigIssue {
	nodeByID := make(map[string]WorkflowSnapshotNode, len(nodes))
	for _, node := range nodes {
		nodeByID[node.ID] = node
	}
	issues := make([]WorkflowConfigIssue, 0)
	for _, deliverable := range deliverables {
		node, nodeExists := nodeByID[deliverable.WorkflowNodeID]
		validKind := deliverable.Kind == "document" || deliverable.Kind == "pull_request"
		if !nodeExists || strings.TrimSpace(deliverable.ID) == "" || !validKind ||
			strings.TrimSpace(deliverable.Title) == "" || deliverable.SortOrder < 0 {
			issue := WorkflowConfigIssue{Code: "deliverable_invalid", Detail: "Deliverable requirement is incomplete or invalid"}
			if nodeExists {
				issue.NodeID = node.ID
				issue.NodeTitle = node.Title
			}
			issues = append(issues, issue)
		}
	}
	return issues
}

func snapshotNodeExecutesActors(kind string) bool {
	switch kind {
	case WorkflowSnapshotNodeKindStart, WorkflowSnapshotNodeKindEnd,
		WorkflowSnapshotNodeKindGateway, WorkflowSnapshotNodeKindAnnotation:
		return false
	default:
		return true
	}
}

func reachableSnapshotNodes(startIDs []string, outgoing map[string][]string) map[string]bool {
	reachable := make(map[string]bool)
	queue := slices.Clone(startIDs)
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		if reachable[id] {
			continue
		}
		reachable[id] = true
		queue = append(queue, outgoing[id]...)
	}
	return reachable
}

func workflowIssue(code string, node WorkflowSnapshotNode, detail string) WorkflowConfigIssue {
	return WorkflowConfigIssue{Code: code, NodeID: node.ID, NodeTitle: node.Title, Detail: detail}
}

func compareWorkflowConfigIssue(a, b WorkflowConfigIssue) int {
	if result := compareString(a.Code, b.Code); result != 0 {
		return result
	}
	if result := compareString(a.NodeID, b.NodeID); result != 0 {
		return result
	}
	if result := compareString(a.NodeTitle, b.NodeTitle); result != 0 {
		return result
	}
	return compareString(a.Detail, b.Detail)
}

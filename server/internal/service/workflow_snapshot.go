package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"slices"
)

const WorkflowDefinitionSchemaVersion = 1

const (
	WorkflowSnapshotNodeKindTask       = "task"
	WorkflowSnapshotNodeKindGateway    = "gateway"
	WorkflowSnapshotNodeKindAnnotation = "annotation"
	WorkflowSnapshotNodeKindSplit      = "split"
	WorkflowSnapshotNodeKindStart      = "start"
	WorkflowSnapshotNodeKindEnd        = "end"
)

type WorkflowDefinitionSnapshot struct {
	SchemaVersion  int                           `json:"schema_version"`
	SnapshotOrigin string                        `json:"snapshot_origin"`
	Workflow       WorkflowSnapshotWorkflow      `json:"workflow"`
	Nodes          []WorkflowSnapshotNode        `json:"nodes"`
	Edges          []WorkflowSnapshotEdge        `json:"edges"`
	Stages         []WorkflowSnapshotStage       `json:"stages"`
	Roles          []WorkflowSnapshotRole        `json:"roles"`
	Deliverables   []WorkflowSnapshotDeliverable `json:"deliverables"`
}

type WorkflowSnapshotWorkflow struct {
	ID                     string `json:"id"`
	WorkspaceID            string `json:"workspace_id"`
	Title                  string `json:"title"`
	Description            string `json:"description"`
	IsDefault              bool   `json:"is_default"`
	MaxRetries             int32  `json:"max_retries"`
	RuntimeSelectionPolicy string `json:"runtime_selection_policy"`
	RuntimeID              string `json:"runtime_id,omitempty"`
	ConfigRevision         int64  `json:"config_revision"`
}

type WorkflowSnapshotNode struct {
	ID           string                       `json:"id"`
	Title        string                       `json:"title"`
	Description  string                       `json:"description"`
	PositionX    float64                      `json:"position_x"`
	PositionY    float64                      `json:"position_y"`
	SortOrder    int32                        `json:"sort_order"`
	StageID      string                       `json:"stage_id,omitempty"`
	Kind         string                       `json:"kind"`
	GatewayKind  string                       `json:"gateway_kind,omitempty"`
	SplitConfig  *WorkflowSnapshotSplitConfig `json:"split_config,omitempty"`
	FormatSchema json.RawMessage              `json:"format_schema,omitempty"`
	WorkerType   string                       `json:"worker_type"`
	WorkerID     string                       `json:"worker_id,omitempty"`
	WorkerName   string                       `json:"worker_name,omitempty"`
	WorkerRoleID string                       `json:"worker_role_id,omitempty"`
	CriticType   string                       `json:"critic_type"`
	CriticID     string                       `json:"critic_id,omitempty"`
	CriticName   string                       `json:"critic_name,omitempty"`
	CriticAPIURL string                       `json:"critic_api_url,omitempty"`
	CriticRoleID string                       `json:"critic_role_id,omitempty"`
}

type WorkflowSnapshotSplitConfig struct {
	DefaultIssueWorkflowID string `json:"default_issue_workflow_id"`
	Mode                   string `json:"mode"`
	MaxConcurrency         int32  `json:"max_concurrency"`
	MaxFailures            int32  `json:"max_failures"`
}

type WorkflowSnapshotEdge struct {
	ID           string          `json:"id"`
	SourceNodeID string          `json:"source_node_id"`
	TargetNodeID string          `json:"target_node_id"`
	Condition    json.RawMessage `json:"condition,omitempty"`
	CreatedAt    string          `json:"created_at,omitempty"`
	CreatedOrder int64           `json:"-"`
}

type WorkflowSnapshotStage struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	SortOrder   int32  `json:"sort_order"`
}

type WorkflowSnapshotRole struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type WorkflowSnapshotDeliverable struct {
	ID             string `json:"id"`
	WorkflowNodeID string `json:"workflow_node_id"`
	Kind           string `json:"kind"`
	Title          string `json:"title"`
	Description    string `json:"description"`
	Required       bool   `json:"required"`
	SortOrder      int32  `json:"sort_order"`
}

type WorkflowDefinitionRows struct {
	Workflow     WorkflowSnapshotWorkflow
	Nodes        []WorkflowSnapshotNode
	Edges        []WorkflowSnapshotEdge
	Stages       []WorkflowSnapshotStage
	Roles        []WorkflowSnapshotRole
	Deliverables []WorkflowSnapshotDeliverable
}

func BuildWorkflowDefinitionSnapshot(rows WorkflowDefinitionRows) (WorkflowDefinitionSnapshot, error) {
	nodes := slices.Clone(rows.Nodes)
	for i := range nodes {
		if err := normalizeSnapshotNode(&nodes[i]); err != nil {
			return WorkflowDefinitionSnapshot{}, fmt.Errorf("normalize node %q: %w", nodes[i].ID, err)
		}
	}
	edges := slices.Clone(rows.Edges)
	for i := range edges {
		condition, err := compactSnapshotJSON(edges[i].Condition)
		if err != nil {
			return WorkflowDefinitionSnapshot{}, fmt.Errorf("normalize edge %q condition: %w", edges[i].ID, err)
		}
		edges[i].Condition = condition
	}
	stages := slices.Clone(rows.Stages)
	roles := slices.Clone(rows.Roles)
	deliverables := slices.Clone(rows.Deliverables)

	slices.SortFunc(stages, func(a, b WorkflowSnapshotStage) int {
		if a.SortOrder != b.SortOrder {
			return compareInt32(a.SortOrder, b.SortOrder)
		}
		return compareString(a.ID, b.ID)
	})
	slices.SortFunc(nodes, func(a, b WorkflowSnapshotNode) int {
		if a.SortOrder != b.SortOrder {
			return compareInt32(a.SortOrder, b.SortOrder)
		}
		return compareString(a.ID, b.ID)
	})
	slices.SortFunc(edges, func(a, b WorkflowSnapshotEdge) int {
		if a.CreatedAt != b.CreatedAt {
			return compareString(a.CreatedAt, b.CreatedAt)
		}
		if a.CreatedOrder != b.CreatedOrder {
			if a.CreatedOrder < b.CreatedOrder {
				return -1
			}
			return 1
		}
		return compareString(a.ID, b.ID)
	})
	slices.SortFunc(roles, func(a, b WorkflowSnapshotRole) int {
		return compareString(a.ID, b.ID)
	})
	slices.SortFunc(deliverables, func(a, b WorkflowSnapshotDeliverable) int {
		if a.SortOrder != b.SortOrder {
			return compareInt32(a.SortOrder, b.SortOrder)
		}
		return compareString(a.ID, b.ID)
	})

	return WorkflowDefinitionSnapshot{
		SchemaVersion:  WorkflowDefinitionSchemaVersion,
		SnapshotOrigin: "native",
		Workflow:       rows.Workflow,
		Nodes:          nonNilNodes(nodes),
		Edges:          nonNilEdges(edges),
		Stages:         nonNilStages(stages),
		Roles:          nonNilRoles(roles),
		Deliverables:   nonNilDeliverables(deliverables),
	}, nil
}

func normalizeSnapshotNode(node *WorkflowSnapshotNode) error {
	formatSchema, err := compactSnapshotJSON(node.FormatSchema)
	if err != nil {
		return fmt.Errorf("format schema: %w", err)
	}
	node.FormatSchema = formatSchema
	if len(formatSchema) == 0 {
		if node.Kind == "" {
			node.Kind = WorkflowSnapshotNodeKindTask
		}
		return nil
	}
	var format struct {
		Type        string                       `json:"type"`
		GatewayKind string                       `json:"gateway_kind"`
		SplitConfig *WorkflowSnapshotSplitConfig `json:"split_config"`
	}
	if err := json.Unmarshal(formatSchema, &format); err != nil {
		return err
	}
	if node.Kind == "" {
		switch format.Type {
		case WorkflowSnapshotNodeKindStart, WorkflowSnapshotNodeKindEnd,
			WorkflowSnapshotNodeKindAnnotation, WorkflowSnapshotNodeKindGateway,
			WorkflowSnapshotNodeKindSplit:
			node.Kind = format.Type
		default:
			node.Kind = WorkflowSnapshotNodeKindTask
		}
	}
	if node.GatewayKind == "" {
		node.GatewayKind = format.GatewayKind
	}
	if node.SplitConfig == nil {
		node.SplitConfig = format.SplitConfig
	}
	return nil
}

func compactSnapshotJSON(raw json.RawMessage) (json.RawMessage, error) {
	if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil, nil
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, raw); err != nil {
		return nil, err
	}
	return json.RawMessage(compact.Bytes()), nil
}

func compareInt32(a, b int32) int {
	if a < b {
		return -1
	}
	if a > b {
		return 1
	}
	return 0
}

func compareString(a, b string) int {
	if a < b {
		return -1
	}
	if a > b {
		return 1
	}
	return 0
}

func nonNilNodes(items []WorkflowSnapshotNode) []WorkflowSnapshotNode {
	if items == nil {
		return []WorkflowSnapshotNode{}
	}
	return items
}

func nonNilEdges(items []WorkflowSnapshotEdge) []WorkflowSnapshotEdge {
	if items == nil {
		return []WorkflowSnapshotEdge{}
	}
	return items
}

func nonNilStages(items []WorkflowSnapshotStage) []WorkflowSnapshotStage {
	if items == nil {
		return []WorkflowSnapshotStage{}
	}
	return items
}

func nonNilRoles(items []WorkflowSnapshotRole) []WorkflowSnapshotRole {
	if items == nil {
		return []WorkflowSnapshotRole{}
	}
	return items
}

func nonNilDeliverables(items []WorkflowSnapshotDeliverable) []WorkflowSnapshotDeliverable {
	if items == nil {
		return []WorkflowSnapshotDeliverable{}
	}
	return items
}

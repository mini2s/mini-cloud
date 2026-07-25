package service

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type RunNodeConfig struct {
	NodeRunID          pgtype.UUID
	WorkflowRunID      pgtype.UUID
	SourceNodeID       pgtype.UUID
	Title              string
	Description        string
	FormatSchema       json.RawMessage
	CriticAPIURL       pgtype.Text
	StageSnapshot      json.RawMessage
	WorkerRoleSnapshot json.RawMessage
	CriticRoleSnapshot json.RawMessage
	RuntimeConfig      json.RawMessage
	WorkerType         string
	WorkerID           pgtype.UUID
	WorkerName         string
	CriticType         string
	CriticID           pgtype.UUID
	CriticName         string
}

type WorkflowRuntimeRepository struct {
	Queries *db.Queries
}

func (r WorkflowRuntimeRepository) GetRunNodeConfig(ctx context.Context, nodeRunID pgtype.UUID) (RunNodeConfig, error) {
	nodeRun, err := r.Queries.GetWorkflowNodeRun(ctx, nodeRunID)
	if err != nil {
		return RunNodeConfig{}, fmt.Errorf("get runtime node config: %w", err)
	}
	return RunNodeConfig{
		NodeRunID: nodeRun.ID, WorkflowRunID: nodeRun.WorkflowRunID,
		SourceNodeID: nodeRun.SourceWorkflowNodeID,
		Title:        nodeRun.NodeTitle, Description: nodeRun.NodeDescription,
		FormatSchema: nodeRun.FormatSchema, CriticAPIURL: nodeRun.CriticApiUrl,
		StageSnapshot:      nodeRun.StageSnapshot,
		WorkerRoleSnapshot: nodeRun.WorkerRoleSnapshot,
		CriticRoleSnapshot: nodeRun.CriticRoleSnapshot,
		RuntimeConfig:      nodeRun.RuntimeConfig,
		WorkerType:         nodeRun.WorkerType, WorkerID: nodeRun.WorkerID,
		WorkerName: nodeRun.WorkerNameSnapshot,
		CriticType: nodeRun.CriticType, CriticID: nodeRun.CriticID,
		CriticName: nodeRun.CriticNameSnapshot,
	}, nil
}

func (r WorkflowRuntimeRepository) ListRunEdgesBySource(ctx context.Context, nodeRunID pgtype.UUID) ([]db.MulticaWorkflowRunEdge, error) {
	edges, err := r.Queries.ListWorkflowRunEdgesBySource(ctx, nodeRunID)
	if err != nil {
		return nil, fmt.Errorf("list runtime edges by source: %w", err)
	}
	return edges, nil
}

func (r WorkflowRuntimeRepository) ListRunEdgesByTarget(ctx context.Context, nodeRunID pgtype.UUID) ([]db.MulticaWorkflowRunEdge, error) {
	edges, err := r.Queries.ListWorkflowRunEdgesByTarget(ctx, nodeRunID)
	if err != nil {
		return nil, fmt.Errorf("list runtime edges by target: %w", err)
	}
	return edges, nil
}

func (r WorkflowRuntimeRepository) GetRunDefinitionSnapshot(ctx context.Context, runID pgtype.UUID) (WorkflowDefinitionSnapshot, error) {
	row, err := r.Queries.GetWorkflowRunDefinitionSnapshot(ctx, runID)
	if err != nil {
		return WorkflowDefinitionSnapshot{}, fmt.Errorf("get runtime definition snapshot: %w", err)
	}
	if row.DefinitionSchemaVersion != WorkflowDefinitionSchemaVersion {
		return WorkflowDefinitionSnapshot{}, fmt.Errorf("unsupported workflow definition schema version: %d", row.DefinitionSchemaVersion)
	}
	var snapshot WorkflowDefinitionSnapshot
	if err := json.Unmarshal(row.DefinitionSnapshot, &snapshot); err != nil {
		return WorkflowDefinitionSnapshot{}, fmt.Errorf("decode runtime definition snapshot: %w", err)
	}
	if snapshot.SchemaVersion != WorkflowDefinitionSchemaVersion {
		return WorkflowDefinitionSnapshot{}, fmt.Errorf("workflow definition snapshot schema mismatch: %d", snapshot.SchemaVersion)
	}
	return snapshot, nil
}

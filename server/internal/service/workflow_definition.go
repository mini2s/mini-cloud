package service

import (
	"context"
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type WorkflowDefinitionLockMode int

const (
	DefinitionLockWorkflowOnly WorkflowDefinitionLockMode = iota
	DefinitionLockRoleSensitive
)

func (s *WorkflowService) RunDefinitionWrite(
	ctx context.Context,
	workspaceID pgtype.UUID,
	workflowID pgtype.UUID,
	mode WorkflowDefinitionLockMode,
	mutate func(*db.Queries) error,
) error {
	return s.runInTx(ctx, func(qtx *db.Queries) error {
		if mode == DefinitionLockRoleSensitive {
			if err := qtx.LockWorkflowRoleDefinitionsExclusive(ctx, workspaceID); err != nil {
				return fmt.Errorf("lock workflow role definitions: %w", err)
			}
		}
		workflow, err := qtx.LockWorkflowDefinitionForUpdate(ctx, workflowID)
		if err != nil {
			return fmt.Errorf("lock workflow definition: %w", err)
		}
		if workflow.WorkspaceID != workspaceID {
			return pgx.ErrNoRows
		}
		if err := mutate(qtx); err != nil {
			return err
		}
		if err := qtx.IncrementWorkflowConfigRevision(ctx, workflowID); err != nil {
			return fmt.Errorf("increment workflow config revision: %w", err)
		}
		return nil
	})
}

func (s *WorkflowService) RunWorkspaceRoleWrite(
	ctx context.Context,
	workspaceID pgtype.UUID,
	loadAffectedWorkflowIDs func(*db.Queries) ([]pgtype.UUID, error),
	mutate func(*db.Queries) error,
) error {
	return s.runInTx(ctx, func(qtx *db.Queries) error {
		if err := qtx.LockWorkflowRoleDefinitionsExclusive(ctx, workspaceID); err != nil {
			return fmt.Errorf("lock workflow role definitions: %w", err)
		}
		workflowIDs, err := loadAffectedWorkflowIDs(qtx)
		if err != nil {
			return err
		}
		slices.SortFunc(workflowIDs, compareUUID)
		workflowIDs = slices.Compact(workflowIDs)
		for _, workflowID := range workflowIDs {
			workflow, err := qtx.LockWorkflowDefinitionForUpdate(ctx, workflowID)
			if err != nil {
				return fmt.Errorf("lock affected workflow definition: %w", err)
			}
			if workflow.WorkspaceID != workspaceID {
				return pgx.ErrNoRows
			}
		}
		if err := mutate(qtx); err != nil {
			return err
		}
		for _, workflowID := range workflowIDs {
			if err := qtx.IncrementWorkflowConfigRevision(ctx, workflowID); err != nil {
				return fmt.Errorf("increment affected workflow config revision: %w", err)
			}
		}
		return nil
	})
}

func compareUUID(a, b pgtype.UUID) int {
	for i := range a.Bytes {
		if a.Bytes[i] < b.Bytes[i] {
			return -1
		}
		if a.Bytes[i] > b.Bytes[i] {
			return 1
		}
	}
	return 0
}

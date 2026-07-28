package service

import (
	"context"
	"testing"
)

func TestWorkflowRuntimeIsolationSchema(t *testing.T) {
	f := newRoleResolutionFixture(t, []roleSlotSpec{{slotType: "worker", roleName: "developer"}})
	defer func() {
		_, _ = f.pool.Exec(context.Background(), `DELETE FROM multica_workflow_run WHERE id = $1`, f.runID)
		f.cleanup()
	}()

	ctx := context.Background()
	var sourceColumn string
	err := f.pool.QueryRow(ctx, `
		SELECT column_name
		FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name = 'multica_workflow_node_run'
		  AND column_name = 'source_workflow_node_id'
	`).Scan(&sourceColumn)
	if err != nil {
		t.Fatalf("source_workflow_node_id missing: %v", err)
	}

	var deleteRule string
	err = f.pool.QueryRow(ctx, `
		SELECT rc.delete_rule
		FROM information_schema.referential_constraints rc
		JOIN information_schema.table_constraints tc
		  ON tc.constraint_catalog = rc.constraint_catalog
		 AND tc.constraint_schema = rc.constraint_schema
		 AND tc.constraint_name = rc.constraint_name
		WHERE tc.table_schema = 'public'
		  AND tc.table_name = 'multica_workflow_run'
		  AND tc.constraint_name = 'workflow_run_workflow_id_fkey'
	`).Scan(&deleteRule)
	if err != nil || deleteRule != "RESTRICT" {
		t.Fatalf("workflow run delete rule = %q, err=%v", deleteRule, err)
	}
}

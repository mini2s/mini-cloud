package service

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// TestEnsureDefaultWorkflow_Idempotent verifies the workspace default workflow is
// created once (hidden, single node, one document deliverable, active) and that a
// second call returns the same row. Also verifies it never leaks into the
// user-facing list query (is_default filter).
func TestEnsureDefaultWorkflow_Idempotent(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()

	suffix := fmt.Sprintf("dw-%d-%d", os.Getpid(), time.Now().UnixNano())
	var wsID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, 'default wf test', 'DW')
		RETURNING id
	`, "Default WF WS "+suffix, "default-wf-"+suffix).Scan(&wsID); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	ws, _ := util.ParseUUID(wsID)
	t.Cleanup(func() {
		// workflow FK ON DELETE CASCADE removes nodes/runs/deliverables.
		pool.Exec(ctx, `DELETE FROM multica_workflow WHERE workspace_id = $1`, wsID)
		pool.Exec(ctx, `DELETE FROM multica_workspace WHERE id = $1`, wsID)
	})

	svc := &WorkflowService{Queries: db.New(pool)}

	wf1, err := svc.EnsureDefaultWorkflow(ctx, ws)
	if err != nil {
		t.Fatalf("first ensure: %v", err)
	}
	if !wf1.IsDefault {
		t.Fatalf("wf1.IsDefault = false, want true")
	}
	if wf1.Status != "active" {
		t.Fatalf("wf1.Status = %q, want active", wf1.Status)
	}

	nodes, err := svc.Queries.ListWorkflowNodes(ctx, wf1.ID)
	if err != nil {
		t.Fatalf("list nodes: %v", err)
	}
	if len(nodes) != 1 {
		t.Fatalf("want exactly 1 node, got %d", len(nodes))
	}
	dels, err := svc.Queries.ListWorkflowNodeDeliverables(ctx, nodes[0].ID)
	if err != nil {
		t.Fatalf("list deliverables: %v", err)
	}
	if len(dels) != 1 || dels[0].Kind != "document" {
		t.Fatalf("want 1 document deliverable, got %+v", dels)
	}

	// Idempotent: second call returns the same row, no duplicate.
	wf2, err := svc.EnsureDefaultWorkflow(ctx, ws)
	if err != nil {
		t.Fatalf("second ensure: %v", err)
	}
	if wf1.ID != wf2.ID {
		t.Fatalf("ensure not idempotent: wf1=%v wf2=%v", wf1.ID, wf2.ID)
	}

	// Hidden from the user-facing list (is_default filter).
	listed, err := svc.Queries.ListWorkflowsExcludingTemplates(ctx, db.ListWorkflowsExcludingTemplatesParams{
		WorkspaceID: ws,
		Limit:       100,
		Offset:      0,
	})
	if err != nil {
		t.Fatalf("list excluding templates: %v", err)
	}
	for _, w := range listed {
		if w.ID == wf1.ID {
			t.Fatalf("default workflow leaked into ListWorkflowsExcludingTemplates")
		}
	}
}

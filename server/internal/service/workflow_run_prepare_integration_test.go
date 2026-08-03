package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestPrepareWorkflowRunSnapshotMaterializesOneRevision(t *testing.T) {
	fixture := newWorkflowPrepareFixture(t, true)
	defer fixture.cleanup(t)

	prepared, err := fixture.service.PrepareWorkflowRunSnapshot(fixture.ctx, fixture.workflowID, PrepareWorkflowRunParams{
		TriggeredByType: "member",
		TriggeredByID:   fixture.userID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Run.SourceConfigRevision != 0 {
		t.Fatalf("source revision=%d, want 0", prepared.Run.SourceConfigRevision)
	}
	var snapshot WorkflowDefinitionSnapshot
	if err := json.Unmarshal(prepared.Run.DefinitionSnapshot, &snapshot); err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Nodes) != 1 || len(snapshot.Deliverables) != 1 {
		t.Fatalf("snapshot nodes/deliverables=%d/%d, want 1/1", len(snapshot.Nodes), len(snapshot.Deliverables))
	}
	fixture.assertRunEntityCounts(t, prepared.Run.ID, 1, 0, 1, 1)
}

func TestPrepareWorkflowRunSnapshotInvalidConfigCreatesOnlyFailedRun(t *testing.T) {
	fixture := newWorkflowPrepareFixture(t, false)
	defer fixture.cleanup(t)

	_, err := fixture.service.PrepareWorkflowRunSnapshot(fixture.ctx, fixture.workflowID, PrepareWorkflowRunParams{
		TriggeredByType:   "member",
		TriggeredByID:     fixture.userID,
		ResponsibleUserID: fixture.userID,
	})
	var invalid *WorkflowConfigInvalidError
	if !errors.As(err, &invalid) {
		t.Fatalf("error=%v, want WorkflowConfigInvalidError", err)
	}
	if len(invalid.Issues) == 0 {
		t.Fatal("invalid configuration returned no issues")
	}
	var status string
	var failureReason pgtype.Text
	var completedAt pgtype.Timestamptz
	if err := fixture.pool.QueryRow(fixture.ctx, `
		SELECT status, failure_reason, completed_at FROM multica_workflow_run WHERE id = $1
	`, invalid.RunID).Scan(&status, &failureReason, &completedAt); err != nil {
		t.Fatal(err)
	}
	if status != RunStatusFailed || !failureReason.Valid || failureReason.String != "config_invalid" {
		t.Fatalf("status=%q failure_reason=%v, want failed/config_invalid", status, failureReason)
	}
	if !completedAt.Valid {
		t.Fatal("config-invalid run has no completed_at")
	}
	fixture.assertRunEntityCounts(t, invalid.RunID, 0, 0, 0, 0)
	var notifications int
	if err := fixture.pool.QueryRow(fixture.ctx, `
		SELECT count(*) FROM multica_inbox_item
		WHERE workspace_id = $1 AND recipient_id = $2 AND type = 'workflow_config_invalid'
	`, fixture.workspaceID, fixture.userID).Scan(&notifications); err != nil {
		t.Fatal(err)
	}
	if notifications != 1 {
		t.Fatalf("config invalid notifications=%d, want 1", notifications)
	}
}

func TestPrepareWorkflowRunSnapshotDoesNotMaterializeAnnotationNodes(t *testing.T) {
	fixture := newWorkflowPrepareFixture(t, true)
	defer fixture.cleanup(t)

	if _, err := fixture.pool.Exec(fixture.ctx, `
		INSERT INTO multica_workflow_node (
			workflow_id, title, description, format_schema, worker_type, critic_type
		) VALUES ($1, 'Annotation', '', '{"type":"annotation"}'::jsonb, 'human', 'human')
	`, fixture.workflowID); err != nil {
		t.Fatal(err)
	}

	prepared, err := fixture.service.PrepareWorkflowRunSnapshot(fixture.ctx, fixture.workflowID, PrepareWorkflowRunParams{
		TriggeredByType: "member", TriggeredByID: fixture.userID,
	})
	if err != nil {
		t.Fatal(err)
	}
	fixture.assertRunEntityCounts(t, prepared.Run.ID, 1, 0, 1, 1)
}

func TestPrepareWorkflowRunSnapshotIgnoresDeprecatedSplitWorkflow(t *testing.T) {
	fixture := newWorkflowPrepareFixture(t, true)
	defer fixture.cleanup(t)

	var missingWorkflowID string
	if err := fixture.pool.QueryRow(fixture.ctx, `SELECT gen_random_uuid()::text`).Scan(&missingWorkflowID); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.pool.Exec(fixture.ctx, `
		UPDATE multica_workflow_node
		SET format_schema = jsonb_build_object(
			'type', 'split',
			'split_config', jsonb_build_object(
				'default_issue_workflow_id', $2::text,
				'mode', 'barrier',
				'max_concurrency', 1,
				'max_failures', 0
			)
		)
		WHERE workflow_id = $1
	`, fixture.workflowID, missingWorkflowID); err != nil {
		t.Fatal(err)
	}

	prepared, err := fixture.service.PrepareWorkflowRunSnapshot(fixture.ctx, fixture.workflowID, PrepareWorkflowRunParams{
		TriggeredByType: "member", TriggeredByID: fixture.userID,
	})
	if err != nil {
		t.Fatalf("deprecated split workflow field prevented run preparation: %v", err)
	}
	fixture.assertRunEntityCounts(t, prepared.Run.ID, 1, 0, 1, 1)
}

func TestPrepareWorkflowRunSnapshotDispatchKeyIsIdempotent(t *testing.T) {
	fixture := newWorkflowPrepareFixture(t, true)
	defer fixture.cleanup(t)
	params := PrepareWorkflowRunParams{
		TriggeredByType: "member", TriggeredByID: fixture.userID, DispatchKey: "prepare-idempotent",
	}
	first, err := fixture.service.PrepareWorkflowRunSnapshot(fixture.ctx, fixture.workflowID, params)
	if err != nil {
		t.Fatal(err)
	}
	second, err := fixture.service.PrepareWorkflowRunSnapshot(fixture.ctx, fixture.workflowID, params)
	if err != nil {
		t.Fatal(err)
	}
	if first.Run.ID != second.Run.ID {
		t.Fatalf("run IDs differ: %x != %x", first.Run.ID.Bytes, second.Run.ID.Bytes)
	}
	fixture.assertRunEntityCounts(t, first.Run.ID, 1, 0, 1, 1)
}

func TestSnapshotAndDefinitionWriteAreRevisionConsistent(t *testing.T) {
	fixture := newWorkflowPrepareFixture(t, true)
	defer fixture.cleanup(t)

	var nodeID, deliverableID pgtype.UUID
	if err := fixture.pool.QueryRow(fixture.ctx, `
		SELECT node.id, deliverable.id
		FROM multica_workflow_node node
		JOIN multica_workflow_node_deliverable deliverable ON deliverable.workflow_node_id = node.id
		WHERE node.workflow_id = $1
	`, fixture.workflowID).Scan(&nodeID, &deliverableID); err != nil {
		t.Fatal(err)
	}
	role, err := fixture.service.Queries.CreateWorkflowRole(fixture.ctx, db.CreateWorkflowRoleParams{
		WorkspaceID: fixture.workspaceID, Name: "Old role", NormalizedName: "old role",
		Description: "Old role description", CreatedBy: fixture.userID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.pool.Exec(fixture.ctx, `UPDATE multica_workflow_node SET worker_role_id = $2 WHERE id = $1`, nodeID, role.ID); err != nil {
		t.Fatal(err)
	}

	mutationEntered := make(chan struct{})
	releaseMutation := make(chan struct{})
	writeDone := make(chan error, 1)
	go func() {
		writeDone <- fixture.service.RunDefinitionWrite(
			fixture.ctx, fixture.workspaceID, fixture.workflowID, DefinitionLockRoleSensitive,
			func(qtx *db.Queries) error {
				if _, err := qtx.UpdateWorkflow(fixture.ctx, db.UpdateWorkflowParams{
					ID: fixture.workflowID, Title: pgtype.Text{String: "New workflow", Valid: true},
				}); err != nil {
					return err
				}
				if _, err := qtx.UpdateWorkflowNode(fixture.ctx, db.UpdateWorkflowNodeParams{
					ID: nodeID, Title: pgtype.Text{String: "New node", Valid: true},
				}); err != nil {
					return err
				}
				if _, err := qtx.UpdateWorkflowNodeDeliverable(fixture.ctx, db.UpdateWorkflowNodeDeliverableParams{
					ID: deliverableID, Title: pgtype.Text{String: "New deliverable", Valid: true},
				}); err != nil {
					return err
				}
				if _, err := qtx.UpdateWorkflowRole(fixture.ctx, db.UpdateWorkflowRoleParams{
					ID: role.ID, WorkspaceID: fixture.workspaceID,
					Name:           pgtype.Text{String: "New role", Valid: true},
					NormalizedName: pgtype.Text{String: "new role", Valid: true},
					Description:    pgtype.Text{String: "New role description", Valid: true},
				}); err != nil {
					return err
				}
				close(mutationEntered)
				<-releaseMutation
				return nil
			},
		)
	}()
	<-mutationEntered

	prepareDone := make(chan struct {
		prepared *PreparedWorkflowRun
		err      error
	}, 1)
	go func() {
		prepared, err := fixture.service.PrepareWorkflowRunSnapshot(fixture.ctx, fixture.workflowID, PrepareWorkflowRunParams{
			TriggeredByType: "member", TriggeredByID: fixture.userID,
		})
		prepareDone <- struct {
			prepared *PreparedWorkflowRun
			err      error
		}{prepared: prepared, err: err}
	}()
	select {
	case result := <-prepareDone:
		t.Fatalf("snapshot completed before definition commit: %v", result.err)
	case <-time.After(150 * time.Millisecond):
	}
	close(releaseMutation)
	if err := <-writeDone; err != nil {
		t.Fatal(err)
	}
	result := <-prepareDone
	if result.err != nil {
		t.Fatal(result.err)
	}
	var snapshot WorkflowDefinitionSnapshot
	if err := json.Unmarshal(result.prepared.Run.DefinitionSnapshot, &snapshot); err != nil {
		t.Fatal(err)
	}
	if result.prepared.Run.SourceConfigRevision != 1 || snapshot.Workflow.Title != "New workflow" ||
		snapshot.Nodes[0].Title != "New node" || snapshot.Deliverables[0].Title != "New deliverable" ||
		snapshot.Roles[0].Name != "New role" || snapshot.Roles[0].Description != "New role description" {
		t.Fatalf("mixed definition snapshot at revision %d: %#v", result.prepared.Run.SourceConfigRevision, snapshot)
	}
}

type workflowPrepareFixture struct {
	ctx         context.Context
	pool        *pgxpool.Pool
	service     *WorkflowService
	workspaceID pgtype.UUID
	workflowID  pgtype.UUID
	userID      pgtype.UUID
}

func newWorkflowPrepareFixture(t *testing.T, valid bool) *workflowPrepareFixture {
	t.Helper()
	pool := openTestPool(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("prepare-%d-%d", os.Getpid(), time.Now().UnixNano())
	fixture := &workflowPrepareFixture{ctx: ctx, pool: pool, service: NewWorkflowService(db.New(pool), pgxTxStarter{pool: pool}, nil, nil)}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_workspace (name, slug, description, issue_prefix) VALUES ($1, $2, '', 'WPR') RETURNING id`, "Prepare "+suffix, suffix).Scan(&fixture.workspaceID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO multica_user (name, email) VALUES ('Prepare User', $1) RETURNING id`, suffix+"@multica.test").Scan(&fixture.userID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow (workspace_id, title, description, status, max_retries, created_by_type, created_by_id)
		VALUES ($1, 'Prepared workflow', '', 'active', 3, 'member', $2) RETURNING id
	`, fixture.workspaceID, fixture.userID).Scan(&fixture.workflowID); err != nil {
		t.Fatal(err)
	}
	if valid {
		var nodeID pgtype.UUID
		if err := pool.QueryRow(ctx, `
			INSERT INTO multica_workflow_node (workflow_id, title, description, worker_type, critic_type)
			VALUES ($1, 'Prepared node', '', 'human', 'human') RETURNING id
		`, fixture.workflowID).Scan(&nodeID); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO multica_workflow_node_deliverable (workflow_node_id, title, description, required, sort_order)
			VALUES ($1, 'Result', '', true, 0)
		`, nodeID); err != nil {
			t.Fatal(err)
		}
	}
	return fixture
}

func (f *workflowPrepareFixture) assertRunEntityCounts(t *testing.T, runID pgtype.UUID, nodeRuns, edges, deliverables, jobs int) {
	t.Helper()
	queries := []struct {
		query string
		want  int
	}{
		{`SELECT count(*) FROM multica_workflow_node_run WHERE workflow_run_id = $1`, nodeRuns},
		{`SELECT count(*) FROM multica_workflow_run_edge WHERE workflow_run_id = $1`, edges},
		{`SELECT count(*) FROM multica_workflow_node_run_deliverable d JOIN multica_workflow_node_run n ON n.id = d.workflow_node_run_id WHERE n.workflow_run_id = $1`, deliverables},
		{`SELECT count(*) FROM multica_workflow_node_run_dispatch_job WHERE workflow_run_id = $1`, jobs},
	}
	for _, check := range queries {
		var got int
		if err := f.pool.QueryRow(f.ctx, check.query, runID).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != check.want {
			t.Fatalf("query %q count=%d, want %d", check.query, got, check.want)
		}
	}
}

func (f *workflowPrepareFixture) cleanup(t *testing.T) {
	t.Helper()
	_, _ = f.pool.Exec(context.Background(), `DELETE FROM multica_workspace WHERE id = $1`, f.workspaceID)
	_, _ = f.pool.Exec(context.Background(), `DELETE FROM multica_user WHERE id = $1`, f.userID)
	f.pool.Close()
}

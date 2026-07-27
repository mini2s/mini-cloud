package service

import (
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type activeRunDefinitionReferences struct {
	fixture       *workflowPrepareFixture
	runID         pgtype.UUID
	nodeID        pgtype.UUID
	deliverableID pgtype.UUID
	roleID        pgtype.UUID
}

func prepareActiveRunDefinitionReferences(t *testing.T) activeRunDefinitionReferences {
	t.Helper()
	fixture := newWorkflowPrepareFixture(t, true)
	var nodeID, deliverableID pgtype.UUID
	if err := fixture.pool.QueryRow(fixture.ctx, `
		SELECT node.id, deliverable.id
		FROM multica_workflow_node node
		JOIN multica_workflow_node_deliverable deliverable ON deliverable.workflow_node_id = node.id
		WHERE node.workflow_id = $1
	`, fixture.workflowID).Scan(&nodeID, &deliverableID); err != nil {
		fixture.cleanup(t)
		t.Fatal(err)
	}
	role, err := fixture.service.Queries.CreateWorkflowRole(fixture.ctx, db.CreateWorkflowRoleParams{
		WorkspaceID: fixture.workspaceID,
		Name:        "Captured role", NormalizedName: "captured role", Description: "Captured by the active run",
		CreatedBy: fixture.userID,
	})
	if err != nil {
		fixture.cleanup(t)
		t.Fatal(err)
	}
	if _, err := fixture.pool.Exec(fixture.ctx, `UPDATE multica_workflow_node SET worker_role_id = $2 WHERE id = $1`, nodeID, role.ID); err != nil {
		fixture.cleanup(t)
		t.Fatal(err)
	}
	prepared, err := fixture.service.PrepareWorkflowRunSnapshot(fixture.ctx, fixture.workflowID, PrepareWorkflowRunParams{
		TriggeredByType: "member", TriggeredByID: fixture.userID,
	})
	if err != nil {
		fixture.cleanup(t)
		t.Fatal(err)
	}
	if _, err := fixture.pool.Exec(fixture.ctx, `UPDATE multica_workflow_node SET worker_role_id = NULL WHERE id = $1`, nodeID); err != nil {
		fixture.cleanup(t)
		t.Fatal(err)
	}
	return activeRunDefinitionReferences{
		fixture: fixture, runID: prepared.Run.ID, nodeID: nodeID, deliverableID: deliverableID, roleID: role.ID,
	}
}

func (r activeRunDefinitionReferences) complete(t *testing.T) {
	t.Helper()
	if _, err := r.fixture.pool.Exec(r.fixture.ctx, `UPDATE multica_workflow_run SET status = 'completed', completed_at = now() WHERE id = $1`, r.runID); err != nil {
		t.Fatal(err)
	}
}

func TestDeleteWorkflowNodeWithActiveRunReturnsConflict(t *testing.T) {
	references := prepareActiveRunDefinitionReferences(t)
	defer references.fixture.cleanup(t)

	inUse, err := references.fixture.service.Queries.WorkflowNodeHasActiveRunReferences(references.fixture.ctx, references.nodeID)
	if err != nil || !inUse {
		t.Fatalf("active node reference=%v error=%v, want true", inUse, err)
	}
	references.complete(t)
	inUse, err = references.fixture.service.Queries.WorkflowNodeHasActiveRunReferences(references.fixture.ctx, references.nodeID)
	if err != nil || inUse {
		t.Fatalf("completed node reference=%v error=%v, want false", inUse, err)
	}
}

func TestDeleteWorkflowNodeDeliverableWithActiveRunReturnsConflict(t *testing.T) {
	references := prepareActiveRunDefinitionReferences(t)
	defer references.fixture.cleanup(t)

	inUse, err := references.fixture.service.Queries.WorkflowDeliverableHasActiveRunReferences(references.fixture.ctx, references.deliverableID)
	if err != nil || !inUse {
		t.Fatalf("active deliverable reference=%v error=%v, want true", inUse, err)
	}
	references.complete(t)
	inUse, err = references.fixture.service.Queries.WorkflowDeliverableHasActiveRunReferences(references.fixture.ctx, references.deliverableID)
	if err != nil || inUse {
		t.Fatalf("completed deliverable reference=%v error=%v, want false", inUse, err)
	}
}

func TestDeleteWorkflowRoleWithActiveRunReturnsConflict(t *testing.T) {
	references := prepareActiveRunDefinitionReferences(t)
	defer references.fixture.cleanup(t)

	inUse, err := references.fixture.service.Queries.WorkflowRoleHasActiveRunReferences(references.fixture.ctx, references.roleID)
	if err != nil || !inUse {
		t.Fatalf("active role reference=%v error=%v, want true", inUse, err)
	}
	references.complete(t)
	inUse, err = references.fixture.service.Queries.WorkflowRoleHasActiveRunReferences(references.fixture.ctx, references.roleID)
	if err != nil || inUse {
		t.Fatalf("completed role reference=%v error=%v, want false", inUse, err)
	}
}

func TestDeleteWorkflowWithAnyRunReturnsConflictAndPreservesHistory(t *testing.T) {
	fixture := newWorkflowPrepareFixture(t, true)
	defer fixture.cleanup(t)

	prepared, err := fixture.service.PrepareWorkflowRunSnapshot(fixture.ctx, fixture.workflowID, PrepareWorkflowRunParams{
		TriggeredByType: "member",
		TriggeredByID:   fixture.userID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.pool.Exec(fixture.ctx, `
		UPDATE multica_workflow_run SET status = 'completed', completed_at = now() WHERE id = $1
	`, prepared.Run.ID); err != nil {
		t.Fatal(err)
	}

	err = fixture.service.DeleteWorkflowDefinition(fixture.ctx, fixture.workflowID)
	if !errors.Is(err, ErrWorkflowHasRuns) {
		t.Fatalf("error=%v, want ErrWorkflowHasRuns", err)
	}

	var workflowExists, runExists bool
	if err := fixture.pool.QueryRow(fixture.ctx, `SELECT EXISTS (SELECT 1 FROM multica_workflow WHERE id = $1)`, fixture.workflowID).Scan(&workflowExists); err != nil {
		t.Fatal(err)
	}
	if err := fixture.pool.QueryRow(fixture.ctx, `SELECT EXISTS (SELECT 1 FROM multica_workflow_run WHERE id = $1)`, prepared.Run.ID).Scan(&runExists); err != nil {
		t.Fatal(err)
	}
	if !workflowExists || !runExists {
		t.Fatalf("workflow exists=%v run exists=%v, want both true", workflowExists, runExists)
	}
}

func TestDeleteWorkflowAndPrepareRunSerializeOnWorkflowLock(t *testing.T) {
	fixture := newWorkflowPrepareFixture(t, true)
	defer fixture.cleanup(t)

	deleteTx, err := fixture.pool.Begin(fixture.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer deleteTx.Rollback(fixture.ctx)
	deleteQueries := db.New(fixture.pool).WithTx(deleteTx)
	if _, err := deleteQueries.LockWorkflowDefinitionForUpdate(fixture.ctx, fixture.workflowID); err != nil {
		t.Fatal(err)
	}

	startDone := make(chan error, 1)
	go func() {
		_, err := fixture.service.PrepareWorkflowRunSnapshot(fixture.ctx, fixture.workflowID, PrepareWorkflowRunParams{
			TriggeredByType: "member",
			TriggeredByID:   fixture.userID,
		})
		startDone <- err
	}()

	select {
	case err := <-startDone:
		t.Fatalf("prepare completed before delete transaction: %v", err)
	case <-time.After(150 * time.Millisecond):
	}

	if err := deleteQueries.DeleteWorkflow(fixture.ctx, fixture.workflowID); err != nil {
		t.Fatal(err)
	}
	if err := deleteTx.Commit(fixture.ctx); err != nil {
		t.Fatal(err)
	}

	select {
	case err := <-startDone:
		if !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("prepare error=%v, want pgx.ErrNoRows", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("prepare did not complete after delete commit")
	}
}

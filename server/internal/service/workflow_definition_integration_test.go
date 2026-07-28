package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type workflowDefinitionFixture struct {
	ctx         context.Context
	service     *WorkflowService
	workspaceID pgtype.UUID
	workflowID  pgtype.UUID
	userID      pgtype.UUID
	slug        string
}

func TestRunDefinitionWriteIncrementsRevisionOnlyAfterSuccessfulMutation(t *testing.T) {
	fixture := newWorkflowDefinitionFixture(t)
	defer fixture.cleanup(t)

	err := fixture.service.RunDefinitionWrite(
		fixture.ctx,
		fixture.workspaceID,
		fixture.workflowID,
		DefinitionLockWorkflowOnly,
		func(q *db.Queries) error {
			_, err := q.UpdateWorkflow(fixture.ctx, db.UpdateWorkflowParams{
				ID:          fixture.workflowID,
				Description: pgtype.Text{String: "saved", Valid: true},
			})
			return err
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if got := fixture.configRevision(t); got != 1 {
		t.Fatalf("revision=%d", got)
	}

	err = fixture.service.RunDefinitionWrite(
		fixture.ctx,
		fixture.workspaceID,
		fixture.workflowID,
		DefinitionLockWorkflowOnly,
		func(*db.Queries) error { return errors.New("reject mutation") },
	)
	if err == nil {
		t.Fatal("expected mutation failure")
	}
	if got := fixture.configRevision(t); got != 1 {
		t.Fatalf("failed write incremented revision to %d", got)
	}
	workflow, err := fixture.service.Queries.GetWorkflow(fixture.ctx, fixture.workflowID)
	if err != nil {
		t.Fatal(err)
	}
	if workflow.Description != "saved" {
		t.Fatalf("description=%q", workflow.Description)
	}
}

func TestRoleUpdateAndSnapshotUseOneWorkspaceLockBoundary(t *testing.T) {
	fixture := newWorkflowDefinitionFixture(t)
	defer fixture.cleanup(t)

	sharedTx, err := fixture.service.TxStarter.Begin(fixture.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = sharedTx.Rollback(fixture.ctx) }()
	sharedQueries := fixture.service.Queries.WithTx(sharedTx)
	if err := sharedQueries.LockWorkflowRoleDefinitionsShared(fixture.ctx, fixture.workspaceID); err != nil {
		t.Fatal(err)
	}

	exclusiveStarted := make(chan struct{})
	exclusiveDone := make(chan error, 1)
	go func() {
		exclusiveTx, err := fixture.service.TxStarter.Begin(fixture.ctx)
		if err != nil {
			exclusiveDone <- err
			return
		}
		defer func() { _ = exclusiveTx.Rollback(fixture.ctx) }()
		close(exclusiveStarted)
		err = fixture.service.Queries.WithTx(exclusiveTx).LockWorkflowRoleDefinitionsExclusive(fixture.ctx, fixture.workspaceID)
		if err == nil {
			err = exclusiveTx.Commit(fixture.ctx)
		}
		exclusiveDone <- err
	}()
	<-exclusiveStarted

	select {
	case err := <-exclusiveDone:
		t.Fatalf("exclusive role lock did not wait for snapshot lock: %v", err)
	case <-time.After(150 * time.Millisecond):
	}
	if err := sharedTx.Commit(fixture.ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-exclusiveDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("exclusive role lock did not complete after shared lock released")
	}
}

func TestRunWorkspaceRoleWriteIncrementsEveryReferencedWorkflowAfterCommit(t *testing.T) {
	fixture := newWorkflowDefinitionFixture(t)
	defer fixture.cleanup(t)

	role, err := fixture.service.Queries.CreateWorkflowRole(fixture.ctx, db.CreateWorkflowRoleParams{
		WorkspaceID: fixture.workspaceID, Name: "Reviewer", NormalizedName: "reviewer",
		Description: "Reviews changes", CreatedBy: fixture.userID,
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := fixture.service.Queries.CreateWorkflow(fixture.ctx, db.CreateWorkflowParams{
		WorkspaceID: fixture.workspaceID, Title: "Second definition", Description: pgtype.Text{String: "", Valid: true},
		Status: "draft", MaxRetries: 3, CreatedByType: "member", CreatedByID: fixture.userID,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, workflowID := range []pgtype.UUID{fixture.workflowID, second.ID} {
		if _, err := fixture.service.Queries.CreateWorkflowNode(fixture.ctx, db.CreateWorkflowNodeParams{
			WorkflowID: workflowID, Title: "Role node", Description: pgtype.Text{String: "", Valid: true},
			WorkerType: "human", WorkerRoleID: role.ID, CriticType: "human",
		}); err != nil {
			t.Fatal(err)
		}
	}

	err = fixture.service.RunWorkspaceRoleWrite(
		fixture.ctx,
		fixture.workspaceID,
		func(qtx *db.Queries) ([]pgtype.UUID, error) {
			return qtx.ListWorkflowIDsReferencingRole(fixture.ctx, role.ID)
		},
		func(qtx *db.Queries) error {
			_, err := qtx.UpdateWorkflowRole(fixture.ctx, db.UpdateWorkflowRoleParams{
				ID: role.ID, WorkspaceID: fixture.workspaceID,
				Description: pgtype.Text{String: "Updated", Valid: true},
			})
			return err
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	for _, workflowID := range []pgtype.UUID{fixture.workflowID, second.ID} {
		workflow, err := fixture.service.Queries.GetWorkflow(fixture.ctx, workflowID)
		if err != nil {
			t.Fatal(err)
		}
		if workflow.ConfigRevision != 1 {
			t.Fatalf("workflow %x revision=%d, want 1", workflowID.Bytes, workflow.ConfigRevision)
		}
	}
}

func newWorkflowDefinitionFixture(t *testing.T) *workflowDefinitionFixture {
	t.Helper()
	pool := openTestPool(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("definition-%d-%d", os.Getpid(), time.Now().UnixNano())
	fixture := &workflowDefinitionFixture{
		ctx: ctx, service: NewWorkflowService(db.New(pool), pgxTxStarter{pool: pool}, nil, nil),
		slug: "workflow-" + suffix,
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, '', 'WDF') RETURNING id
	`, "Workflow "+suffix, fixture.slug).Scan(&fixture.workspaceID); err != nil {
		pool.Close()
		t.Fatalf("create workspace: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_user (name, email) VALUES ($1, $2) RETURNING id
	`, "Definition User", suffix+"@multica.test").Scan(&fixture.userID); err != nil {
		pool.Close()
		t.Fatalf("create user: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow (
			workspace_id, title, description, status, max_retries,
			created_by_type, created_by_id, is_template
		) VALUES ($1, 'Definition workflow', '', 'draft', 3, 'member', $2, false)
		RETURNING id
	`, fixture.workspaceID, fixture.userID).Scan(&fixture.workflowID); err != nil {
		pool.Close()
		t.Fatalf("create workflow: %v", err)
	}
	return fixture
}

func (f *workflowDefinitionFixture) configRevision(t *testing.T) int64 {
	t.Helper()
	workflow, err := f.service.Queries.GetWorkflow(f.ctx, f.workflowID)
	if err != nil {
		t.Fatal(err)
	}
	return workflow.ConfigRevision
}

func (f *workflowDefinitionFixture) cleanup(t *testing.T) {
	t.Helper()
	poolStarter, ok := f.service.TxStarter.(pgxTxStarter)
	if !ok {
		t.Fatal("unexpected transaction starter")
	}
	_, _ = poolStarter.pool.Exec(context.Background(), `DELETE FROM multica_workspace WHERE id = $1`, f.workspaceID)
	_, _ = poolStarter.pool.Exec(context.Background(), `DELETE FROM multica_user WHERE id = $1`, f.userID)
	poolStarter.pool.Close()
}

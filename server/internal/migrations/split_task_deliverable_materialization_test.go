package migrations

import (
	"context"
	"fmt"
	"testing"
	"time"
)

const splitTaskDeliverableMaterializationVersion = "158_split_task_deliverable_materialization"

func TestSplitTaskDeliverableMaterializationCancelsActiveLegacySplitRunAndIsIdempotent(t *testing.T) {
	database := newMigrationDatabaseAt(t, "157_fix_template_node_layout")
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())

	var workspaceID, userID, workflowID, nodeID, runID, nodeRunID, splitTaskID, dispatchJobID string
	if err := database.pool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, '', 'SPL') RETURNING id
	`, "Split migration "+suffix, "split-migration-"+suffix).Scan(&workspaceID); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	if err := database.pool.QueryRow(ctx, `
		INSERT INTO multica_user (name, email) VALUES ($1, $2) RETURNING id
	`, "Split Migration User", "split-migration-"+suffix+"@multica.test").Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if _, err := database.pool.Exec(ctx, `
		INSERT INTO multica_member (workspace_id, user_id, role, status)
		VALUES ($1, $2, 'owner', 'active')
	`, workspaceID, userID); err != nil {
		t.Fatalf("seed member: %v", err)
	}
	if err := database.pool.QueryRow(ctx, `
		INSERT INTO multica_workflow (
			workspace_id, title, description, status, max_retries,
			created_by_type, created_by_id, is_template
		) VALUES ($1, 'Legacy split workflow', '', 'active', 1, 'member', $2, false)
		RETURNING id
	`, workspaceID, userID).Scan(&workflowID); err != nil {
		t.Fatalf("seed workflow: %v", err)
	}
	if err := database.pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node (
			workflow_id, title, description, position_x, position_y,
			format_schema, worker_type, critic_type, sort_order
		) VALUES ($1, 'Split', '', 0, 0, '{"type":"split"}', 'human', 'human', 0)
		RETURNING id
	`, workflowID).Scan(&nodeID); err != nil {
		t.Fatalf("seed split node: %v", err)
	}
	if err := database.pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_run (
			workflow_id, workspace_id, workflow_title, status,
			triggered_by_type, triggered_by_id, input, runtime_selection_policy,
			responsible_user_id
		) VALUES ($1, $2, 'Legacy split workflow', 'running', 'member', $3, '{}', 'idle_first', $3)
		RETURNING id
	`, workflowID, workspaceID, userID).Scan(&runID); err != nil {
		t.Fatalf("seed workflow run: %v", err)
	}
	if err := database.pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node_run (
			workflow_run_id, workflow_node_id, source_workflow_node_id,
			node_title, status, worker_type, critic_type, format_schema
		) VALUES ($1, $2, $2, 'Split', 'awaiting_split_review', 'human', 'human', '{"type":"split"}')
		RETURNING id
	`, runID, nodeID).Scan(&nodeRunID); err != nil {
		t.Fatalf("seed split node run: %v", err)
	}
	if err := database.pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_split_task (
			node_run_id, workspace_id, title, description, status, draft_key
		) VALUES ($1, $2, 'Legacy draft', '', 'draft', 'legacy-draft')
		RETURNING id
	`, nodeRunID, workspaceID).Scan(&splitTaskID); err != nil {
		t.Fatalf("seed split task: %v", err)
	}
	if err := database.pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node_run_dispatch_job (
			workflow_run_id, workflow_node_run_id, phase, generation, status
		) VALUES ($1, $2, 'split', 1, 'pending')
		RETURNING id
	`, runID, nodeRunID).Scan(&dispatchJobID); err != nil {
		t.Fatalf("seed dispatch job: %v", err)
	}
	if _, err := database.pool.Exec(ctx, `
		INSERT INTO multica_workflow_role_resolution_job (
			workspace_id, workflow_run_id, status
		) VALUES ($1, $2, 'pending')
	`, workspaceID, runID); err != nil {
		t.Fatalf("seed role resolution job: %v", err)
	}
	if _, err := database.pool.Exec(ctx, `
		INSERT INTO multica_workflow_role_notification (
			workspace_id, workflow_run_id, workflow_node_run_id, slot_type,
			recipient_user_id, notification_type, status
		) VALUES ($1, $2, $3, 'worker', $4, 'execution', 'pending')
	`, workspaceID, runID, nodeRunID, userID); err != nil {
		t.Fatalf("seed role notification: %v", err)
	}

	if err := database.apply(t, splitTaskDeliverableMaterializationVersion+".up.sql"); err != nil {
		t.Fatal(err)
	}

	var runStatus, nodeStatus, failureReason, splitTaskStatus, dispatchStatus, dispatchError, roleJobStatus, notificationStatus string
	if err := database.pool.QueryRow(ctx, `
		SELECT wr.status, nr.status, nr.failure_reason, task.status,
		       job.status, job.last_error, role_job.status, notification.status
		FROM multica_workflow_run wr
		JOIN multica_workflow_node_run nr ON nr.workflow_run_id = wr.id
		JOIN multica_workflow_split_task task ON task.node_run_id = nr.id
		JOIN multica_workflow_node_run_dispatch_job job ON job.id = $2
		JOIN multica_workflow_role_resolution_job role_job ON role_job.workflow_run_id = wr.id
		JOIN multica_workflow_role_notification notification ON notification.workflow_run_id = wr.id
		WHERE wr.id = $1 AND task.id = $3
	`, runID, dispatchJobID, splitTaskID).Scan(
		&runStatus,
		&nodeStatus,
		&failureReason,
		&splitTaskStatus,
		&dispatchStatus,
		&dispatchError,
		&roleJobStatus,
		&notificationStatus,
	); err != nil {
		t.Fatalf("load migrated cancellation state: %v", err)
	}

	if runStatus != "cancelled" || nodeStatus != "cancelled" {
		t.Fatalf("run statuses=(%q,%q), want cancelled", runStatus, nodeStatus)
	}
	if failureReason != "migration_158_legacy_split_cancelled" {
		t.Fatalf("failure reason=%q", failureReason)
	}
	if splitTaskStatus != "discarded" {
		t.Fatalf("split task status=%q, want discarded", splitTaskStatus)
	}
	if dispatchStatus != "failed" || dispatchError != "migration_158_legacy_split_cancelled" {
		t.Fatalf("dispatch state=(%q,%q), want failed migration marker", dispatchStatus, dispatchError)
	}
	if roleJobStatus != "cancelled" {
		t.Fatalf("role resolution job status=%q, want cancelled", roleJobStatus)
	}
	if notificationStatus != "skipped_no_email" {
		t.Fatalf("notification status=%q, want skipped_no_email", notificationStatus)
	}

	var generationStatus string
	if err := database.pool.QueryRow(ctx, `
		SELECT status
		FROM multica_workflow_split_generation
		WHERE node_run_id = $1 AND generation = 1
	`, nodeRunID).Scan(&generationStatus); err != nil {
		t.Fatalf("load migrated split generation: %v", err)
	}
	if generationStatus != "cancelled" {
		t.Fatalf("split generation status=%q, want cancelled", generationStatus)
	}

	// The migration runner records schema_migrations after executing the SQL.
	// Simulate that bookkeeping write failing and verify the full SQL file can
	// safely execute again on an already-migrated schema. A generation-aware
	// split may legitimately use the same node status as a legacy split, so it
	// must not be cancelled during the retry.
	if _, err := database.pool.Exec(ctx, `
		UPDATE multica_workflow_run
		SET status = 'running', failure_reason = NULL, completed_at = NULL
		WHERE id = $1
	`, runID); err != nil {
		t.Fatalf("seed generation-aware workflow run: %v", err)
	}
	if _, err := database.pool.Exec(ctx, `
		UPDATE multica_workflow_node_run
		SET status = 'splitting', failure_reason = NULL, completed_at = NULL
		WHERE id = $1
	`, nodeRunID); err != nil {
		t.Fatalf("seed generation-aware node run: %v", err)
	}
	if _, err := database.pool.Exec(ctx, `
		UPDATE multica_workflow_split_generation
		SET status = 'splitting'
		WHERE node_run_id = $1 AND generation = 1
	`, nodeRunID); err != nil {
		t.Fatalf("seed generation-aware split generation: %v", err)
	}
	if _, err := database.pool.Exec(ctx, `
		DELETE FROM schema_migrations WHERE version = $1
	`, splitTaskDeliverableMaterializationVersion); err != nil {
		t.Fatalf("remove migration marker: %v", err)
	}
	if err := database.apply(t, splitTaskDeliverableMaterializationVersion+".up.sql"); err != nil {
		t.Fatalf("reapply migration: %v", err)
	}

	var reappliedRunStatus, reappliedNodeStatus string
	var generationCount, planDeliverableCount int
	if err := database.pool.QueryRow(ctx, `
		SELECT
			(SELECT status FROM multica_workflow_run WHERE id = $1),
			(SELECT status FROM multica_workflow_node_run WHERE id = $2),
			(SELECT count(*) FROM multica_workflow_split_generation
			 WHERE node_run_id = $2 AND generation = 1),
			(SELECT count(*) FROM multica_workflow_node_run_deliverable
			 WHERE workflow_node_run_id = $2 AND purpose = 'split_task_plan')
	`, runID, nodeRunID).Scan(&reappliedRunStatus, &reappliedNodeStatus, &generationCount, &planDeliverableCount); err != nil {
		t.Fatalf("count reapplied migration rows: %v", err)
	}
	if reappliedRunStatus != "running" || reappliedNodeStatus != "splitting" {
		t.Fatalf("reapplied statuses=(%q,%q), want generation-aware run unchanged", reappliedRunStatus, reappliedNodeStatus)
	}
	if generationCount != 1 || planDeliverableCount != 1 {
		t.Fatalf("reapplied row counts=(%d,%d), want one generation and deliverable", generationCount, planDeliverableCount)
	}
}

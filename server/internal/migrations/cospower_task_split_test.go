package migrations

import (
	"context"
	"testing"
)

const cospowerTaskSplitVersion = "148_fix_cospower_task_split"

func TestCosPowerTaskSplitMigrationConvergesLegacyTemplateNode(t *testing.T) {
	database := newMigrationDatabaseAt(t, "147_backfill_split_child_assignees")
	ctx := context.Background()

	if _, err := database.pool.Exec(ctx, `
		UPDATE multica_workflow_node
		SET format_schema = NULL,
		    critic_type = 'agent',
		    critic_id = 'a6f5d437-93c2-4623-ba0a-bcbb5cb8d1a6'
		WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000145'
		  AND title = '任务拆解'
	`); err != nil {
		t.Fatalf("restore legacy template node: %v", err)
	}

	if err := database.apply(t, cospowerTaskSplitVersion+".up.sql"); err != nil {
		t.Fatal(err)
	}

	var kind, templateID, mode, criticType string
	var maxConcurrency, maxFailures int
	var legacyDefaultWorkflowAbsent bool
	var criticID, criticRoleID, criticAPIURL *string
	if err := database.pool.QueryRow(ctx, `
		SELECT format_schema ->> 'type',
		       format_schema ->> 'template_id',
		       format_schema #>> '{split_config,mode}',
		       (format_schema #>> '{split_config,max_concurrency}')::int,
		       (format_schema #>> '{split_config,max_failures}')::int,
		       format_schema #> '{split_config,default_issue_workflow_id}' IS NULL,
		       critic_type,
		       critic_id::text,
		       critic_role_id::text,
		       critic_api_url
		FROM multica_workflow_node
		WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000145'
		  AND title = '任务拆解'
	`).Scan(
		&kind,
		&templateID,
		&mode,
		&maxConcurrency,
		&maxFailures,
		&legacyDefaultWorkflowAbsent,
		&criticType,
		&criticID,
		&criticRoleID,
		&criticAPIURL,
	); err != nil {
		t.Fatalf("load migrated template node: %v", err)
	}

	if kind != "split" || templateID != "task-splitter" || mode != "barrier" {
		t.Fatalf("split format = (%q, %q, %q), want (split, task-splitter, barrier)", kind, templateID, mode)
	}
	if maxConcurrency != 5 || maxFailures != 0 {
		t.Fatalf("split limits = (%d, %d), want (5, 0)", maxConcurrency, maxFailures)
	}
	if !legacyDefaultWorkflowAbsent {
		t.Fatal("obsolete split default_issue_workflow_id must be absent")
	}
	if criticType != "human" || criticID != nil || criticRoleID != nil || criticAPIURL != nil {
		t.Fatalf("reviewer = (%q, %v, %v, %v), want unassigned human", criticType, criticID, criticRoleID, criticAPIURL)
	}
}

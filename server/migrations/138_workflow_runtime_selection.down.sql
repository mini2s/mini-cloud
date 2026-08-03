DROP INDEX IF EXISTS idx_workflow_run_source_issue_id;

ALTER TABLE multica_workflow_node_run
    DROP CONSTRAINT IF EXISTS workflow_node_run_runtime_selection_reason_check,
    DROP COLUMN IF EXISTS failure_reason,
    DROP COLUMN IF EXISTS runtime_selection_reason;

ALTER TABLE multica_workflow_run
    DROP COLUMN IF EXISTS runtime_authorizer_id,
    DROP COLUMN IF EXISTS responsible_user_id,
    DROP COLUMN IF EXISTS source_issue_id;

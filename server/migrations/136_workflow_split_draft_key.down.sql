DROP INDEX IF EXISTS idx_workflow_split_task_node_run_draft_key;

ALTER TABLE multica_workflow_split_task
DROP COLUMN IF EXISTS draft_key;

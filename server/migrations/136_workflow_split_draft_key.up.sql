ALTER TABLE multica_workflow_split_task
ADD COLUMN IF NOT EXISTS draft_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_split_task_node_run_draft_key
ON multica_workflow_split_task(node_run_id, draft_key)
WHERE draft_key IS NOT NULL AND draft_key <> '';

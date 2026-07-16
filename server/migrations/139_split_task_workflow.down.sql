ALTER TABLE multica_workflow_node_run
  DROP COLUMN IF EXISTS split_initial_dispatch_completed,
  DROP COLUMN IF EXISTS split_config_version;

DROP INDEX IF EXISTS idx_workflow_split_task_dispatch_key;
DROP INDEX IF EXISTS idx_workflow_split_task_workflow;
DROP INDEX IF EXISTS idx_workflow_run_dispatch_key;

ALTER TABLE multica_workflow_run
  DROP COLUMN IF EXISTS dispatch_key;

ALTER TABLE multica_workflow_split_task
  DROP COLUMN IF EXISTS last_error,
  DROP COLUMN IF EXISTS dispatch_key,
  DROP COLUMN IF EXISTS version,
  DROP COLUMN IF EXISTS workflow_id;

ALTER TABLE multica_workflow_split_task
  DROP COLUMN IF EXISTS suggested_assignee_type,
  DROP COLUMN IF EXISTS suggested_assignee_id;

ALTER TABLE multica_workflow_node_run
  DROP COLUMN IF EXISTS split_initial_dispatch_completed;

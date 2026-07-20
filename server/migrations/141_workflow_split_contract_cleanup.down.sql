ALTER TABLE multica_workflow_split_task
  ADD COLUMN IF NOT EXISTS suggested_assignee_type TEXT,
  ADD COLUMN IF NOT EXISTS suggested_assignee_id UUID;

ALTER TABLE multica_workflow_node_run
  ADD COLUMN IF NOT EXISTS split_initial_dispatch_completed BOOLEAN NOT NULL DEFAULT false;

UPDATE multica_workflow_split_task
SET workflow_id = assignee_id
WHERE workflow_id IS NULL AND assignee_type = 'workflow';

DROP INDEX IF EXISTS idx_workflow_split_task_assignee;

ALTER TABLE multica_workflow_split_task
  DROP CONSTRAINT IF EXISTS workflow_split_task_assignee_type_check,
  DROP CONSTRAINT IF EXISTS workflow_split_task_assignee_pair_check,
  DROP COLUMN IF EXISTS assignee_id,
  DROP COLUMN IF EXISTS assignee_type;

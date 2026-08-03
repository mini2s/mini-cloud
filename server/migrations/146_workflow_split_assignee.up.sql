ALTER TABLE multica_workflow_split_task
  ADD COLUMN assignee_type TEXT,
  ADD COLUMN assignee_id UUID;

ALTER TABLE multica_workflow_split_task
  ALTER COLUMN workflow_id DROP NOT NULL;

UPDATE multica_workflow_split_task
SET assignee_type = 'workflow',
    assignee_id = workflow_id,
    workflow_id = NULL,
    updated_at = now()
WHERE status IN ('draft', 'discarded')
  AND issue_id IS NULL
  AND run_id IS NULL
  AND workflow_id IS NOT NULL;

ALTER TABLE multica_workflow_split_task
  ADD CONSTRAINT workflow_split_task_assignee_pair_check
    CHECK ((assignee_type IS NULL) = (assignee_id IS NULL)),
  ADD CONSTRAINT workflow_split_task_assignee_type_check
    CHECK (assignee_type IS NULL OR assignee_type IN ('member', 'agent', 'squad', 'workflow'));

CREATE INDEX idx_workflow_split_task_assignee
  ON multica_workflow_split_task(assignee_type, assignee_id)
  WHERE assignee_id IS NOT NULL;

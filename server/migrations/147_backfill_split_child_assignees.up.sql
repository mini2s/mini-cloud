UPDATE multica_issue AS issue
SET assignee_type = task.assignee_type,
    assignee_id = task.assignee_id,
    updated_at = now()
FROM multica_workflow_split_task AS task
WHERE issue.origin_type = 'workflow_split'
  AND issue.origin_id = task.id
  AND issue.assignee_type IS NULL
  AND issue.assignee_id IS NULL
  AND task.assignee_type IS NOT NULL
  AND task.assignee_id IS NOT NULL;

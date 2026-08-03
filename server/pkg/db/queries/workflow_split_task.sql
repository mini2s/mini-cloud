-- name: CreateMaterializationSplitTask :one
INSERT INTO multica_workflow_split_task (
    node_run_id, workspace_id, split_plan_generation, draft_key, title,
    description, depends_on, sort_order, status, workflow_id,
    assignee_type, assignee_id
) VALUES (
    $1, $2, $3, $4, $5,
    $6, '[]'::jsonb, $7, 'created', $8,
    'member', $9
)
RETURNING *;

-- name: SetMaterializationSplitTaskDependencies :one
UPDATE multica_workflow_split_task
SET depends_on = $2,
    updated_at = now()
WHERE id = $1
  AND status = 'created'
  AND issue_id IS NULL
RETURNING *;

-- name: ListSplitTasksByGeneration :many
SELECT * FROM multica_workflow_split_task
WHERE node_run_id = $1
  AND split_plan_generation = $2
ORDER BY sort_order ASC, id ASC;

-- name: ListDueSplitTasksForMaterialization :many
SELECT * FROM multica_workflow_split_task
WHERE node_run_id = $1
  AND split_plan_generation = $2
  AND issue_id IS NULL
  AND status = 'created'
  AND (materialize_next_attempt_at IS NULL OR materialize_next_attempt_at <= now())
ORDER BY sort_order ASC, id ASC;

-- name: GetSplitTaskForUpdate :one
SELECT * FROM multica_workflow_split_task
WHERE id = $1
FOR UPDATE;

-- name: ListSplitTasksByRunID :many
SELECT st.*
FROM multica_workflow_split_task st
JOIN multica_workflow_run wr ON wr.id = st.run_id
WHERE wr.id = $1
ORDER BY st.sort_order ASC, st.created_at ASC;

-- name: GetSplitTaskByIssueID :one
SELECT * FROM multica_workflow_split_task
WHERE issue_id = $1;

-- name: UpdateSplitTaskStatus :one
UPDATE multica_workflow_split_task
SET status = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpdateSplitTaskStatusWithError :one
UPDATE multica_workflow_split_task
SET status = $2,
    last_error = sqlc.arg('last_error')::jsonb,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: MarkSplitTaskRunningIfCreated :one
UPDATE multica_workflow_split_task
SET status = 'running',
    last_error = NULL,
    updated_at = now()
WHERE id = $1
  AND status = 'created'
RETURNING *;

-- name: SetSplitTaskTerminalByIssue :one
UPDATE multica_workflow_split_task
SET status = $2,
    updated_at = now()
WHERE issue_id = $1
  AND run_id IS NULL
  AND status IN ('created', 'running')
RETURNING *;

-- name: FailSplitTaskExecutionByIssue :one
UPDATE multica_workflow_split_task
SET status = 'failed',
    last_error = sqlc.arg('last_error')::jsonb,
    updated_at = now()
WHERE issue_id = sqlc.arg('issue_id')
  AND run_id IS NULL
  AND status IN ('created', 'running')
RETURNING *;

-- name: RetrySplitTaskExecutionByIssue :one
UPDATE multica_workflow_split_task AS st
SET status = 'running',
    last_error = NULL,
    updated_at = now()
FROM multica_issue AS i
WHERE st.issue_id = sqlc.arg('issue_id')
  AND i.id = st.issue_id
  AND st.run_id IS NULL
  AND st.status = 'failed'
  AND i.assignee_type IS NOT NULL
  AND i.assignee_id IS NOT NULL
  AND i.status NOT IN ('done', 'cancelled')
RETURNING st.*;

-- name: SetSplitTaskMaterializedIssue :one
UPDATE multica_workflow_split_task
SET issue_id = $2,
    status = 'created',
    materialize_next_attempt_at = NULL,
    last_error = NULL,
    updated_at = now()
WHERE id = $1
  AND issue_id IS NULL
RETURNING *;

-- name: SetSplitTaskMaterializationRetry :one
UPDATE multica_workflow_split_task
SET materialize_retry_count = $2,
    materialize_next_attempt_at = sqlc.narg('materialize_next_attempt_at'),
    last_error = sqlc.arg('last_error')::jsonb,
    status = $3,
    updated_at = now()
WHERE id = $1
  AND issue_id IS NULL
RETURNING *;

-- name: ResetSplitTaskMaterializationRetry :one
UPDATE multica_workflow_split_task
SET materialize_retry_count = 0,
    materialize_next_attempt_at = NULL,
    last_error = NULL,
    status = 'created',
    updated_at = now()
WHERE id = $1
  AND issue_id IS NULL
  AND status = 'failed'
RETURNING *;

-- name: CancelOpenSplitTask :execrows
UPDATE multica_workflow_split_task
SET status = CASE
      WHEN issue_id IS NULL THEN 'discarded'
      WHEN run_id IS NULL THEN 'skipped'
      ELSE 'cancelled'
    END,
    updated_at = now()
WHERE id = $1
  AND status NOT IN ('done', 'failed', 'cancelled', 'skipped', 'discarded');

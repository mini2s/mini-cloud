-- name: CreateSplitTask :one
INSERT INTO multica_workflow_split_task (
    node_run_id, workspace_id, title, description,
    suggested_assignee_type, suggested_assignee_id,
    depends_on, sort_order, status
) VALUES (
    $1, $2, $3, $4,
    sqlc.narg('suggested_assignee_type'), sqlc.narg('suggested_assignee_id'),
    $5, $6, $7
) RETURNING *;

-- name: GetSplitTask :one
SELECT * FROM multica_workflow_split_task
WHERE id = $1;

-- name: ListSplitTasksByNodeRun :many
SELECT * FROM multica_workflow_split_task
WHERE node_run_id = $1
ORDER BY sort_order ASC, created_at ASC;

-- name: ListSplitTasksByRunID :many
SELECT st.*
FROM multica_workflow_split_task st
JOIN multica_workflow_run wr ON wr.id = st.run_id
WHERE wr.id = $1
ORDER BY st.sort_order ASC, st.created_at ASC;

-- name: CountSplitTasksByNodeRun :one
SELECT count(*)::bigint
FROM multica_workflow_split_task
WHERE node_run_id = $1
  AND status <> 'discarded';

-- name: UpdateSplitTaskFields :one
UPDATE multica_workflow_split_task
SET title = COALESCE(sqlc.narg('title'), title),
    description = COALESCE(sqlc.narg('description'), description),
    suggested_assignee_type = sqlc.narg('suggested_assignee_type'),
    suggested_assignee_id = sqlc.narg('suggested_assignee_id'),
    depends_on = COALESCE(sqlc.narg('depends_on'), depends_on),
    sort_order = COALESCE(sqlc.narg('sort_order')::int, sort_order),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpdateSplitTaskStatus :one
UPDATE multica_workflow_split_task
SET status = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: MarkSplitTasksApproved :exec
UPDATE multica_workflow_split_task
SET status = 'approved',
    updated_at = now()
WHERE node_run_id = $1
  AND id = ANY($2::uuid[]);

-- name: MarkSplitTasksDiscardedExcept :exec
UPDATE multica_workflow_split_task
SET status = 'discarded',
    updated_at = now()
WHERE node_run_id = $1
  AND NOT (id = ANY($2::uuid[]))
  AND status = 'draft';

-- name: UpdateSplitTaskIssueID :exec
UPDATE multica_workflow_split_task
SET issue_id = $2,
    status = 'created',
    updated_at = now()
WHERE id = $1
  AND issue_id IS NULL;

-- name: UpdateSplitTaskRunID :exec
UPDATE multica_workflow_split_task
SET run_id = $2,
    status = 'running',
    updated_at = now()
WHERE id = $1
  AND run_id IS NULL;

-- name: CancelOpenSplitTasksByNodeRun :exec
UPDATE multica_workflow_split_task
SET status = 'cancelled',
    updated_at = now()
WHERE node_run_id = $1
  AND status NOT IN ('done', 'failed', 'cancelled', 'skipped', 'discarded');

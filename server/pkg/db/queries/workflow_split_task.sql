-- name: CreateSplitTask :one
INSERT INTO multica_workflow_split_task (
    node_run_id, workspace_id, title, description,
    workflow_id, depends_on, sort_order, status, draft_source
) VALUES (
    $1, $2, $3, $4,
    $5, $6, $7, $8, sqlc.narg('draft_source')
) RETURNING *;

-- name: UpsertSplitDraftTaskByKey :one
INSERT INTO multica_workflow_split_task (
    node_run_id, workspace_id, draft_key, title, description,
    workflow_id, depends_on, sort_order, status, draft_source
) VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8, 'draft', sqlc.narg('draft_source')
)
ON CONFLICT (node_run_id, draft_key)
WHERE draft_key IS NOT NULL AND draft_key <> ''
DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    workflow_id = EXCLUDED.workflow_id,
    depends_on = EXCLUDED.depends_on,
    sort_order = EXCLUDED.sort_order,
    status = 'draft',
    draft_source = EXCLUDED.draft_source,
    version = multica_workflow_split_task.version + 1,
    updated_at = now()
WHERE multica_workflow_split_task.status IN ('draft', 'discarded')
RETURNING *;

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
    depends_on = COALESCE(sqlc.narg('depends_on'), depends_on),
    sort_order = COALESCE(sqlc.narg('sort_order')::int, sort_order),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpdateSplitTaskDraftFields :one
UPDATE multica_workflow_split_task
SET title = COALESCE(sqlc.narg('title'), title),
    description = COALESCE(sqlc.narg('description'), description),
    workflow_id = COALESCE(sqlc.narg('workflow_id'), workflow_id),
    depends_on = COALESCE(sqlc.narg('depends_on'), depends_on),
    status = CASE
      WHEN sqlc.narg('discarded')::boolean IS TRUE THEN 'discarded'
      WHEN sqlc.narg('discarded')::boolean IS FALSE AND status = 'discarded' THEN 'draft'
      ELSE status
    END,
    version = version + 1,
    updated_at = now()
WHERE id = $1
  AND node_run_id = $2
  AND status IN ('draft', 'discarded')
  AND version = $3
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
  AND id = ANY($2::uuid[])
  AND status = 'draft';

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

-- name: UpdateSplitTaskRunIDWithDispatchKey :exec
UPDATE multica_workflow_split_task
SET run_id = $2,
    dispatch_key = $3,
    status = 'running',
    updated_at = now()
WHERE id = $1
  AND status = 'created'
  AND run_id IS NULL;

-- name: ResetSplitTaskForRetry :one
UPDATE multica_workflow_split_task
SET workflow_id = COALESCE(sqlc.narg('workflow_id'), workflow_id),
    run_id = NULL,
    dispatch_key = NULL,
    last_error = NULL,
    status = 'created',
    version = version + 1,
    updated_at = now()
WHERE id = $1
  AND node_run_id = $2
  AND status IN ('failed', 'cancelled', 'skipped')
  AND issue_id IS NOT NULL
RETURNING *;

-- name: ClaimSplitTaskForRunStart :one
UPDATE multica_workflow_split_task
SET status = 'running',
    updated_at = now()
WHERE id = $1
  AND status = 'created'
  AND run_id IS NULL
RETURNING *;

-- name: CancelOpenSplitTasksByNodeRun :exec
UPDATE multica_workflow_split_task
SET status = 'cancelled',
    updated_at = now()
WHERE node_run_id = $1
  AND status NOT IN ('done', 'failed', 'cancelled', 'skipped', 'discarded');

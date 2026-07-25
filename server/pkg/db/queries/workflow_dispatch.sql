-- =====================
-- Durable Workflow Dispatch
-- =====================

-- name: CreateWorkflowDispatchJob :one
INSERT INTO multica_workflow_node_run_dispatch_job (
    workflow_run_id,
    workflow_node_run_id,
    phase,
    generation,
    status,
    max_attempts,
    scheduled_at
) VALUES (
    $1, $2, $3, $4, 'pending', $5,
    COALESCE(sqlc.narg('scheduled_at')::timestamptz, now())
)
ON CONFLICT (workflow_node_run_id, phase, generation)
DO UPDATE SET workflow_node_run_id = EXCLUDED.workflow_node_run_id
RETURNING *;

-- name: ClaimWorkflowDispatchJob :one
WITH candidate AS (
    SELECT id
    FROM multica_workflow_node_run_dispatch_job
    WHERE status = 'pending'
      AND scheduled_at <= now()
    ORDER BY scheduled_at, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE multica_workflow_node_run_dispatch_job job
SET status = 'running',
    attempt_count = attempt_count + 1,
    locked_by = sqlc.arg('locked_by'),
    lease_expires_at = now() + sqlc.arg('lease_duration')::interval,
    updated_at = now()
FROM candidate
WHERE job.id = candidate.id
RETURNING job.*;

-- name: RenewWorkflowDispatchJobLease :one
UPDATE multica_workflow_node_run_dispatch_job
SET lease_expires_at = now() + sqlc.arg('lease_duration')::interval,
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND generation = sqlc.arg('generation')
  AND status = 'running'
  AND locked_by = sqlc.arg('locked_by')
RETURNING *;

-- name: RequeueExpiredWorkflowDispatchJobs :many
UPDATE multica_workflow_node_run_dispatch_job
SET status = 'pending',
    locked_by = NULL,
    lease_expires_at = NULL,
    scheduled_at = now(),
    updated_at = now()
WHERE status = 'running'
  AND lease_expires_at < now()
RETURNING *;

-- name: RequeueWorkflowDispatchJob :one
UPDATE multica_workflow_node_run_dispatch_job
SET status = 'pending',
    locked_by = NULL,
    lease_expires_at = NULL,
    scheduled_at = sqlc.arg('scheduled_at'),
    last_error = sqlc.arg('last_error'),
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND generation = sqlc.arg('generation')
  AND status = 'running'
RETURNING *;

-- name: CompleteWorkflowDispatchJob :one
UPDATE multica_workflow_node_run_dispatch_job
SET status = 'succeeded',
    locked_by = NULL,
    lease_expires_at = NULL,
    last_error = '',
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND generation = sqlc.arg('generation')
  AND status = 'running'
RETURNING *;

-- name: FailWorkflowDispatchJob :one
UPDATE multica_workflow_node_run_dispatch_job
SET status = 'failed',
    locked_by = NULL,
    lease_expires_at = NULL,
    last_error = sqlc.arg('last_error'),
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND generation = sqlc.arg('generation')
  AND status = 'running'
RETURNING *;

-- name: NextWorkflowDispatchGeneration :one
SELECT COALESCE(max(generation), 0)::int + 1
FROM multica_workflow_node_run_dispatch_job
WHERE workflow_node_run_id = $1
  AND phase = $2;

-- name: GetAgentTaskByWorkflowDispatchJob :one
SELECT *
FROM multica_agent_task_queue
WHERE workflow_dispatch_job_id = $1
LIMIT 1;

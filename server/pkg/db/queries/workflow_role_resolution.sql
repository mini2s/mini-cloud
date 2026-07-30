-- name: CreateWorkflowRoleResolution :one
INSERT INTO multica_workflow_role_resolution (
    workflow_run_id, workflow_node_run_id, slot_type, role_id,
    role_name_snapshot, role_description_snapshot, status,
    reason_code, reason_detail
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: ListWorkflowRoleResolutions :many
SELECT * FROM multica_workflow_role_resolution
WHERE workflow_run_id = $1
ORDER BY created_at, slot_type;

-- name: CountUnresolvedWorkflowRoleResolutions :one
SELECT count(*)::bigint FROM multica_workflow_role_resolution
WHERE workflow_run_id = $1 AND status <> 'resolved';

-- name: LockWorkflowRoleResolutionWorkspace :exec
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg('workspace_id')::uuid::text, 1469598103934665603));

-- name: CountActiveWorkflowRoleResolutionJobsForWorkspace :one
SELECT count(*)::bigint FROM multica_workflow_role_resolution_job
WHERE workspace_id = $1 AND status IN ('pending', 'running');

-- name: CreateWorkflowRoleResolutionJob :one
INSERT INTO multica_workflow_role_resolution_job (
    workspace_id, workflow_run_id, model, prompt_version
) VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: CancelWorkflowRoleResolutionJobs :exec
UPDATE multica_workflow_role_resolution_job
SET status = 'cancelled', finished_at = now(), updated_at = now(), generation = generation + 1
WHERE workflow_run_id = $1 AND status IN ('pending', 'running');

-- name: MarkPendingRoleResolutionsNeedsHuman :exec
UPDATE multica_workflow_role_resolution
SET status = 'needs_human', reason_code = $2, reason_detail = $3, updated_at = now(), version = version + 1
WHERE workflow_run_id = $1 AND status = 'pending';

-- name: GetWorkflowRoleResolution :one
SELECT * FROM multica_workflow_role_resolution WHERE id = $1;

-- name: UpdateWorkflowRoleResolutionManual :one
UPDATE multica_workflow_role_resolution
SET status = 'resolved', resolved_user_id = $3, source = 'manual',
    reason_code = 'manual_assignment', reason_detail = '', version = version + 1,
    resolved_by = $4, resolved_at = now(), updated_at = now()
WHERE id = $1 AND version = $2
RETURNING *;

-- name: AddWorkflowRoleResolutionEvent :one
INSERT INTO multica_workflow_role_resolution_event (
    workflow_run_id, workflow_role_resolution_id, event_type, slot_type,
    role_name_snapshot, resolved_user_id, source, reason_code, reason_detail,
    model, prompt_version, organization_version, actor_user_id
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
RETURNING *;

-- name: ClaimWorkflowRoleResolutionJob :one
WITH candidate AS (
    SELECT id FROM multica_workflow_role_resolution_job
    WHERE status = 'pending' AND scheduled_at <= now()
    ORDER BY scheduled_at, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE multica_workflow_role_resolution_job job
SET status = 'running', locked_by = $1,
    lease_expires_at = now() + sqlc.arg('lease_duration')::interval,
    heartbeat_at = now(), started_at = COALESCE(started_at, now()),
    attempt_count = attempt_count + 1, updated_at = now()
FROM candidate
WHERE job.id = candidate.id
RETURNING job.*;

-- name: RenewWorkflowRoleResolutionJobLease :execrows
UPDATE multica_workflow_role_resolution_job
SET lease_expires_at = now() + sqlc.arg('lease_duration')::interval,
    heartbeat_at = now(), updated_at = now()
WHERE id = $1 AND generation = $2 AND status = 'running' AND locked_by = $3;

-- name: RequeueExpiredWorkflowRoleResolutionJobs :execrows
UPDATE multica_workflow_role_resolution_job
SET status = 'pending', locked_by = NULL, lease_expires_at = NULL,
    generation = generation + 1, scheduled_at = now(), updated_at = now()
WHERE status = 'running' AND lease_expires_at < now();

-- name: FinishWorkflowRoleResolutionJob :execrows
UPDATE multica_workflow_role_resolution_job
SET status = $3, last_error_code = $4, last_error_detail = $5,
    locked_by = NULL, lease_expires_at = NULL, finished_at = now(), updated_at = now()
WHERE id = $1 AND generation = $2 AND status = 'running';

-- name: RescheduleWorkflowRoleResolutionJob :execrows
UPDATE multica_workflow_role_resolution_job
SET status = 'pending', scheduled_at = $3, last_error_code = $4,
    last_error_detail = $5, locked_by = NULL, lease_expires_at = NULL, updated_at = now()
WHERE id = $1 AND generation = $2 AND status = 'running';

-- name: IncrementWorkflowRoleResolutionOrgAttempt :one
UPDATE multica_workflow_role_resolution_job
SET org_attempt_count = org_attempt_count + 1, updated_at = now()
WHERE id = $1 AND generation = $2 AND status = 'running'
RETURNING org_attempt_count;

-- name: IncrementWorkflowRoleResolutionFormatAttempt :one
UPDATE multica_workflow_role_resolution_job
SET format_attempt_count = format_attempt_count + 1, updated_at = now()
WHERE id = $1 AND generation = $2 AND status = 'running'
RETURNING format_attempt_count;

-- name: IncrementWorkflowRoleResolutionLLMAttempt :one
UPDATE multica_workflow_role_resolution_job
SET llm_attempt_count = llm_attempt_count + 1, updated_at = now()
WHERE id = $1 AND generation = $2 AND status = 'running'
RETURNING llm_attempt_count;

-- name: AddWorkflowRoleResolutionCall :one
INSERT INTO multica_workflow_role_resolution_call (
    workflow_run_id, job_id, stage, attempt, model,
    input_tokens, output_tokens, total_tokens, duration_ms, result_code, error_detail
) VALUES (
    $1, $2, $3, $4, $5,
    sqlc.narg('input_tokens'), sqlc.narg('output_tokens'), sqlc.narg('total_tokens'),
    $6, $7, $8
)
RETURNING *;

-- name: DeleteExpiredWorkflowRoleResolutionCalls :execrows
DELETE FROM multica_workflow_role_resolution_call
WHERE created_at < now() - interval '180 days';

-- name: MarkWorkflowRoleResolutionNeedsHuman :one
UPDATE multica_workflow_role_resolution resolution
SET status = 'needs_human',
    resolved_user_id = NULL,
    source = NULL,
    reason_code = sqlc.arg('reason_code'),
    reason_detail = sqlc.arg('reason_detail'),
    version = resolution.version + 1,
    resolved_at = NULL,
    updated_at = now()
WHERE resolution.id = sqlc.arg('id')
  AND resolution.version = sqlc.arg('version')
  AND resolution.status = 'pending'
  AND EXISTS (
      SELECT 1
      FROM multica_workflow_role_resolution_job job
      WHERE job.id = sqlc.arg('job_id')
        AND job.generation = sqlc.arg('job_generation')
        AND job.status = 'running'
  )
RETURNING resolution.*;

-- name: ResolveWorkflowRoleResolutionLLM :one
UPDATE multica_workflow_role_resolution resolution
SET status = sqlc.arg('status'),
    resolved_user_id = sqlc.narg('resolved_user_id'),
    source = 'llm',
    reason_code = sqlc.arg('reason_code'),
    reason_detail = sqlc.arg('reason_detail'),
    version = resolution.version + 1,
    resolved_at = CASE WHEN sqlc.arg('status') = 'resolved' THEN now() ELSE NULL END,
    updated_at = now()
WHERE resolution.id = sqlc.arg('id')
  AND resolution.version = sqlc.arg('version')
  AND resolution.status = 'pending'
  AND EXISTS (
      SELECT 1
      FROM multica_workflow_role_resolution_job job
      WHERE job.id = sqlc.arg('job_id')
        AND job.generation = sqlc.arg('job_generation')
        AND job.status = 'running'
  )
RETURNING resolution.*;

-- name: SetWorkflowNodeRunResolvedWorker :execrows
UPDATE multica_workflow_node_run node_run
SET worker_type = 'human',
    worker_id = $2,
    worker_name_snapshot = COALESCE((SELECT app_user.name FROM multica_user app_user WHERE app_user.id = $2), ''),
    updated_at = now()
WHERE node_run.id = $1 AND node_run.status IN ('blocked', 'pending', 'format_checking', 'format_ok');

-- name: SetWorkflowNodeRunResolvedCritic :execrows
UPDATE multica_workflow_node_run node_run
SET critic_type = 'human',
    critic_id = $2,
    critic_name_snapshot = COALESCE((SELECT app_user.name FROM multica_user app_user WHERE app_user.id = $2), ''),
    updated_at = now()
WHERE node_run.id = $1 AND node_run.status IN (
    'blocked', 'pending', 'format_checking', 'format_ok',
    'worker_assigned', 'working', 'awaiting_input', 'awaiting_critic'
);

-- name: SetWorkflowRunWaitingForRoleAssignment :execrows
UPDATE multica_workflow_run
SET status = 'waiting_role_assignment'
WHERE id = $1 AND status IN ('resolving_roles', 'waiting_role_assignment');

-- name: PromoteWorkflowRunAfterRoleResolution :execrows
UPDATE multica_workflow_run run
SET status = 'running'
WHERE run.id = $1
  AND run.status IN ('resolving_roles', 'waiting_role_assignment')
  AND NOT EXISTS (
      SELECT 1 FROM multica_workflow_role_resolution resolution
      WHERE resolution.workflow_run_id = run.id AND resolution.status <> 'resolved'
  );

-- name: UnblockWorkflowNodeRunsAfterRoleResolution :many
UPDATE multica_workflow_node_run node_run
SET status = CASE WHEN EXISTS (
        SELECT 1 FROM multica_workflow_run_edge edge
        WHERE edge.workflow_run_id = node_run.workflow_run_id
          AND edge.target_node_run_id = node_run.id
    ) THEN 'pending' ELSE 'format_ok' END,
    updated_at = now()
WHERE node_run.workflow_run_id = $1 AND node_run.status = 'blocked'
RETURNING node_run.*;


-- name: LockWorkflowRoleResolutionRun :exec
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg('workflow_run_id')::uuid::text, 1099511628211));

-- name: LockWorkflowRoleResolutionForManual :one
SELECT resolution.*, node_run.status AS node_run_status
FROM multica_workflow_role_resolution resolution
JOIN multica_workflow_node_run node_run ON node_run.id = resolution.workflow_node_run_id
WHERE resolution.id = $1 AND resolution.workflow_run_id = $2
FOR UPDATE OF resolution, node_run;

-- name: GetLatestWorkflowRoleResolutionJob :one
SELECT * FROM multica_workflow_role_resolution_job
WHERE workflow_run_id = $1
ORDER BY created_at DESC
LIMIT 1;

-- name: CreateWorkflowRoleResolutionRetryJob :one
INSERT INTO multica_workflow_role_resolution_job (
    workspace_id, workflow_run_id, model, prompt_version, generation
) VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: MarkUnresolvedWorkflowRoleResolutionsPending :execrows
UPDATE multica_workflow_role_resolution
SET status = 'pending', resolved_user_id = NULL, source = NULL,
    reason_code = '', reason_detail = '', resolved_by = NULL, resolved_at = NULL,
    version = version + 1, updated_at = now()
WHERE workflow_run_id = $1 AND status IN ('needs_human', 'invalidated');

-- name: SetWorkflowRunResolvingRoles :execrows
UPDATE multica_workflow_run
SET status = 'resolving_roles'
WHERE id = $1 AND status = 'waiting_role_assignment';


-- name: GetWorkflowRoleResolutionByNodeRunSlot :one
SELECT * FROM multica_workflow_role_resolution
WHERE workflow_node_run_id = $1 AND slot_type = $2;

-- name: InvalidateWorkflowRoleResolution :one
UPDATE multica_workflow_role_resolution
SET status = 'invalidated', reason_code = 'member_inactive',
    reason_detail = '', version = version + 1, updated_at = now()
WHERE id = $1 AND version = $2 AND status = 'resolved' AND resolved_user_id = $3
RETURNING *;

-- name: BlockWorkflowNodeRunForInvalidRole :one
UPDATE multica_workflow_node_run
SET status = 'blocked', updated_at = now()
WHERE id = $1 AND status = $2
RETURNING *;


-- name: ResumeWorkflowNodeRunAfterRoleAssignment :one
UPDATE multica_workflow_node_run
SET status = $2, updated_at = now()
WHERE id = $1 AND status = 'blocked' AND $2 IN ('format_ok', 'awaiting_critic')
RETURNING *;

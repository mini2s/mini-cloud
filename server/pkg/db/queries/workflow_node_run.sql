-- =====================
-- Workflow Node Run State Machine
-- =====================

-- name: ListWorkflowNodeRuns :many
SELECT * FROM multica_workflow_node_run
WHERE workflow_run_id = $1
ORDER BY created_at ASC;

-- name: ListWorkflowNodeRunsByRun :many
SELECT * FROM multica_workflow_node_run
WHERE workflow_run_id = $1
ORDER BY created_at ASC;

-- name: ListWorkflowNodeRunsByRunAndNode :one
SELECT * FROM multica_workflow_node_run
WHERE workflow_run_id = $1 AND workflow_node_id = $2
LIMIT 1;

-- name: GetWorkflowNodeRun :one
SELECT * FROM multica_workflow_node_run
WHERE id = $1;

-- name: GetWorkflowNodeRunForUpdate :one
SELECT * FROM multica_workflow_node_run
WHERE id = $1
FOR UPDATE;

-- name: UpdateNodeRunRuntimeConfig :one
UPDATE multica_workflow_node_run
SET runtime_config = $2,
    split_config_version = split_config_version + 1,
    updated_at = now()
WHERE id = $1
  AND split_config_version = $3
RETURNING *;

-- name: BlockSplitNodeRunForReviewerResolution :one
UPDATE multica_workflow_node_run
SET status = 'blocked',
    failure_reason = 'split_reviewer_unresolved',
    updated_at = now()
WHERE id = $1
  AND status IN ('splitting', 'awaiting_split_review')
RETURNING *;

-- name: CreateWorkflowNodeRun :one
INSERT INTO multica_workflow_node_run (
    workflow_run_id, workflow_node_id, node_title, status,
    retry_count, worker_type, worker_id, critic_type, critic_id
) VALUES (
    $1, $2, $3, $4, $5, $6, sqlc.narg('worker_id'), $7, sqlc.narg('critic_id')
) RETURNING *;

-- name: UpdateWorkflowNodeRunAssignees :one
-- Override worker/critic on a node run. Used by the default-workflow path: the
-- single node-run's worker is set to the issue assignee and critic to the issue
-- creator, rather than inherited from the default workflow's placeholder node.
-- dispatch reads node-run assignees, so this is what drives agent/critic dispatch.
UPDATE multica_workflow_node_run SET
    worker_type = $2,
    worker_id   = $3,
    critic_type = $4,
    critic_id   = $5,
    updated_at  = now()
WHERE id = $1
RETURNING *;

-- name: UpdateWorkflowNodeRunStatus :one
UPDATE multica_workflow_node_run SET
    status = $2,
    started_at = CASE
        WHEN $2 IN ('format_checking', 'working', 'critic_reviewing', 'splitting')
             AND started_at IS NULL THEN now()
        ELSE started_at
    END,
    completed_at = CASE
        WHEN $2 IN ('format_failed', 'completed', 'failed', 'blocked', 'skipped', 'cancelled')
             THEN now()
        ELSE completed_at
    END,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: ReactivateWorkflowNodeRunStatus :one
UPDATE multica_workflow_node_run SET
    status = $2,
    completed_at = NULL,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpdateWorkflowNodeRunWorkerOutput :one
UPDATE multica_workflow_node_run SET
    worker_output = $2,
    status = 'awaiting_critic',
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: SetWorkflowNodeRunWorkerOutput :one
UPDATE multica_workflow_node_run SET
    worker_output = $2,
    status = $3,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: SetWorkflowNodeRunWorkerOutputIfWorkerPhase :one
-- Conditional advance used by the member upload paths: only fires while the
-- node run is still in its worker phase, so a concurrent upload that already
-- advanced the run loses the race silently (zero rows) instead of failing.
UPDATE multica_workflow_node_run SET
    worker_output = $2,
    status = $3,
    updated_at = now()
WHERE id = $1 AND status IN ('working', 'worker_assigned')
RETURNING *;

-- name: UpdateWorkflowNodeRunCriticReview :one
UPDATE multica_workflow_node_run SET
    critic_output = sqlc.narg('critic_output'),
    critic_comment = sqlc.narg('critic_comment'),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: SetWorkflowNodeRunCriticOutput :one
UPDATE multica_workflow_node_run SET
    critic_output = sqlc.narg('critic_output'),
    critic_comment = sqlc.narg('critic_comment'),
    status = $2,
    retry_count = COALESCE(sqlc.narg('retry_count')::int, retry_count),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpdateWorkflowNodeRunRework :one
UPDATE multica_workflow_node_run SET
    status = $2,
    retry_count = retry_count + 1,
    worker_output = NULL,
    critic_output = NULL,
    critic_comment = '',
    completed_at = NULL,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpdateWorkflowNodeRunAgentTask :one
UPDATE multica_workflow_node_run SET
    agent_task_id = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: BindWorkflowNodeRunSession :one
-- Writes the runtime/device/CSC-session binding for a node run (Design Two).
-- Idempotent: a re-dispatch overwrites with the latest session so Cloud Web
-- always attaches to the session currently executing the node.
UPDATE multica_workflow_node_run SET
    runtime_id = sqlc.narg('runtime_id'),
    device_id  = sqlc.narg('device_id'),
    session_id = sqlc.narg('session_id'),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: GetWorkflowNodeRunBySessionID :one
-- Resolves the node run bound to a given CSC session id. Used by Cloud Web /
-- cs-cloud to map an attached session back to its Multica node run.
SELECT * FROM multica_workflow_node_run
WHERE session_id = $1
LIMIT 1;

-- name: TakeoverWorkflowNodeRun :one
-- Human takeover: pause the node (working -> blocked) WITHOUT marking it
-- completed. completed_at stays NULL, which is what distinguishes a
-- paused/taken-over blocked from a rework-exhausted ("stuck") blocked
-- (the latter sets completed_at via UpdateWorkflowNodeRunStatus).
UPDATE multica_workflow_node_run SET
    status = 'blocked',
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: HandbackWorkflowNodeRun :one
-- Human handback: return control (blocked -> working) so the daemon resumes the
-- same CSC session. Clears any stale completed_at defensively; worker_output
-- is preserved (unlike rework, which clears it).
UPDATE multica_workflow_node_run SET
    status = 'working',
    completed_at = NULL,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: LinkNodeRunWorkerTask :one
UPDATE multica_workflow_node_run SET
    worker_agent_task_id = $2,
    runtime_id = $3,
    runtime_selection_reason = $4,
    failure_reason = NULL,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: LinkNodeRunCriticTask :one
UPDATE multica_workflow_node_run SET
    critic_agent_task_id = $2,
    runtime_id = $3,
    runtime_selection_reason = $4,
    failure_reason = NULL,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: FailWorkflowNodeRun :one
UPDATE multica_workflow_node_run SET
    status = $2,
    failure_reason = $3,
    completed_at = now(),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: LinkNodeRunAgentTask :one
UPDATE multica_workflow_node_run SET
    agent_task_id = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: CancelWorkflowNodeRuns :many
UPDATE multica_workflow_node_run SET
    status = 'cancelled',
    failure_reason = 'workflow_failed',
    completed_at = now(),
    updated_at = now()
WHERE workflow_run_id = $1
  AND status NOT IN ('format_failed', 'completed', 'failed', 'skipped', 'cancelled')
RETURNING *;

-- name: CancelWorkflowTasksByRun :many
UPDATE multica_agent_task_queue task SET
    status = 'cancelled',
    completed_at = now(),
    failure_reason = 'workflow_failed'
FROM multica_workflow_node_run node_run
WHERE node_run.id = task.workflow_node_run_id
  AND node_run.workflow_run_id = $1
  AND task.status IN ('queued', 'dispatched', 'running')
RETURNING task.*;

-- name: GetWorkflowNodeRunsByStatus :many
SELECT * FROM multica_workflow_node_run
WHERE workflow_run_id = $1 AND status = $2
ORDER BY created_at ASC;

-- name: GetDownstreamNodeRuns :many
-- Returns node runs whose node has an incoming edge from the given node.
-- Used to find downstream nodes that should be activated when an upstream completes.
SELECT wnr.*
FROM multica_workflow_node_run wnr
JOIN multica_workflow_edge we ON we.target_node_id = wnr.workflow_node_id
WHERE we.source_node_id = sqlc.arg('workflow_node_id')
  AND wnr.workflow_run_id = $1;

-- name: GetNodeRunUpstreamStatuses :many
-- For a given node run, returns the status of all upstream node runs.
-- Used to check if all upstreams are complete before activating a node.
SELECT up_wnr.status
FROM multica_workflow_node_run wnr
JOIN multica_workflow_edge we ON we.target_node_id = wnr.workflow_node_id
JOIN multica_workflow_node_run up_wnr ON up_wnr.workflow_node_id = we.source_node_id
    AND up_wnr.workflow_run_id = wnr.workflow_run_id
WHERE wnr.id = $1;

-- name: ListActiveNodeRuns :many
-- Returns all active (non-terminal) node runs for a multica_workflow run.
SELECT * FROM multica_workflow_node_run
WHERE workflow_run_id = $1
  AND status NOT IN ('format_failed', 'completed', 'failed', 'blocked', 'skipped', 'cancelled');

-- name: HasActiveSplitNodeRunForIssue :one
SELECT EXISTS (
  SELECT 1
  FROM multica_workflow_run wr
  JOIN multica_workflow_node_run wnr ON wnr.workflow_run_id = wr.id
  JOIN multica_workflow_node wn ON wn.id = wnr.workflow_node_id
  WHERE wr.workspace_id = sqlc.arg('workspace_id')
    AND (
      wr.input ->> 'issue_id' = sqlc.arg('issue_id')::uuid::text
      OR EXISTS (
        SELECT 1
        FROM multica_issue origin_issue
        WHERE origin_issue.id = sqlc.arg('issue_id')
          AND origin_issue.workflow_run_id = wr.id
      )
    )
    AND wn.format_schema ->> 'type' = 'split'
    AND wnr.status IN ('splitting', 'awaiting_split_review', 'split_active')
) AS active;

-- name: ListMyWorkflowTasks :many
-- Returns node runs assigned to the current user as human worker or critic.
SELECT wnr.*,
       wr.workflow_title,
       wr.workflow_id,
       wr.workspace_id
FROM multica_workflow_node_run wnr
JOIN multica_workflow_run wr ON wr.id = wnr.workflow_run_id
WHERE wr.workspace_id = $1
  AND (
    -- Human worker: node run is assigned to this multica_member via worker_id
    (wnr.worker_type = 'human' AND wnr.worker_id = sqlc.narg('member_id')::uuid AND wnr.status IN ('worker_assigned', 'working'))
    -- Human critic: node run is assigned to this multica_member via critic_id
    OR (wnr.critic_type = 'human' AND wnr.critic_id = sqlc.narg('member_id')::uuid AND wnr.status = 'awaiting_critic')
    -- Any human worker (worker_type=human, worker_id is null): anyone can claim
    OR (wnr.worker_type = 'human' AND wnr.worker_id IS NULL AND wnr.status = 'worker_assigned')
    -- Any human critic (critic_type=human, critic_id is null): anyone can claim
    OR (wnr.critic_type = 'human' AND wnr.critic_id IS NULL AND wnr.status = 'awaiting_critic')
  )
  AND wr.status = 'running'
ORDER BY wnr.created_at DESC
LIMIT $2 OFFSET $3;

-- name: CreateWorkflowAgentTask :one
INSERT INTO multica_agent_task_queue (
    agent_id, runtime_id, issue_id, status, priority, workflow_node_run_id,
    workflow_dispatch_job_id, chat_session_id, context
)
VALUES (
    $1, $2, sqlc.narg('issue_id'), 'queued', $3,
    sqlc.narg('workflow_node_run_id'), sqlc.narg('workflow_dispatch_job_id'),
    sqlc.narg('chat_session_id'), sqlc.narg('context')
)
ON CONFLICT (workflow_dispatch_job_id)
WHERE workflow_dispatch_job_id IS NOT NULL
DO UPDATE SET workflow_dispatch_job_id = EXCLUDED.workflow_dispatch_job_id
RETURNING *;

-- name: AcquireWorkflowRuntimeSelectionLock :one
SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0));

-- name: ListWorkflowRuntimeCandidates :many
SELECT
    runtime.*,
    COUNT(task.id)::bigint AS active_task_count
FROM multica_agent_runtime runtime
LEFT JOIN multica_agent_task_queue task
    ON task.runtime_id = runtime.id
   AND task.status IN ('queued', 'dispatched', 'running')
WHERE runtime.workspace_id = sqlc.arg('workspace_id')
  AND runtime.status = 'online'
  AND runtime.last_seen_at >= now() - make_interval(secs => sqlc.arg('stale_seconds')::double precision)
  AND (
      runtime.visibility = 'public'
      OR runtime.owner_id = sqlc.narg('authorizer_user_id')
      OR runtime.owner_id = sqlc.narg('responsible_user_id')
      OR EXISTS (
          SELECT 1
          FROM multica_member member
          WHERE member.workspace_id = runtime.workspace_id
            AND member.user_id = sqlc.narg('authorizer_user_id')
            AND member.role IN ('owner', 'admin')
      )
      OR EXISTS (
          SELECT 1
          FROM multica_runtime_permission permission
          WHERE permission.runtime_id = runtime.id
            AND permission.user_id = sqlc.narg('authorizer_user_id')
            AND permission.role IN ('admin', 'operator')
      )
  )
GROUP BY runtime.id
ORDER BY runtime.last_seen_at DESC, runtime.created_at ASC, runtime.id ASC;

-- name: SetNodeRunSplitReviewChatSession :one
UPDATE multica_workflow_node_run SET
    split_review_chat_session_id = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: GetNodeRunBySplitReviewChatSession :one
SELECT * FROM multica_workflow_node_run
WHERE split_review_chat_session_id = $1
LIMIT 1;

-- name: EnqueueWorkflowRoleNotification :one
INSERT INTO multica_workflow_role_notification (
    workspace_id, workflow_run_id, workflow_node_run_id, slot_type,
    recipient_user_id, notification_type
) VALUES ($1,$2,$3,$4,$5,$6)
ON CONFLICT (workflow_run_id, workflow_node_run_id, slot_type, notification_type, recipient_user_id)
DO NOTHING
RETURNING *;

-- name: ClaimWorkflowRoleNotification :one
WITH candidate AS (
    SELECT id FROM multica_workflow_role_notification
    WHERE status = 'pending' AND scheduled_at <= now()
    ORDER BY scheduled_at, created_at
    FOR UPDATE SKIP LOCKED LIMIT 1
)
UPDATE multica_workflow_role_notification notification
SET status = 'sending', attempt_count = attempt_count + 1,
    locked_by = $1, lease_expires_at = now() + sqlc.arg('lease_duration')::interval,
    updated_at = now()
FROM candidate
WHERE notification.id = candidate.id
RETURNING notification.*;

-- name: RequeueExpiredWorkflowRoleNotifications :execrows
UPDATE multica_workflow_role_notification
SET status = 'pending', locked_by = NULL, lease_expires_at = NULL,
    scheduled_at = now(), updated_at = now()
WHERE status = 'sending' AND lease_expires_at < now();

-- name: MarkWorkflowRoleNotificationSent :execrows
UPDATE multica_workflow_role_notification
SET status = 'sent', sent_at = now(), locked_by = NULL, lease_expires_at = NULL,
    last_error = '', updated_at = now()
WHERE id = $1 AND status = 'sending' AND locked_by = $2;

-- name: MarkWorkflowRoleNotificationSkippedNoEmail :execrows
UPDATE multica_workflow_role_notification
SET status = 'skipped_no_email', locked_by = NULL, lease_expires_at = NULL,
    last_error = '', updated_at = now()
WHERE id = $1 AND status = 'sending' AND locked_by = $2;

-- name: RescheduleWorkflowRoleNotification :execrows
UPDATE multica_workflow_role_notification
SET status = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'pending' END,
    scheduled_at = $3, locked_by = NULL, lease_expires_at = NULL,
    last_error = $4, updated_at = now()
WHERE id = $1 AND status = 'sending' AND locked_by = $2;

-- name: ListWorkflowRoleManualNotificationRecipients :many
SELECT DISTINCT u.id, u.email
FROM multica_workflow_run run
JOIN multica_member member ON member.workspace_id = run.workspace_id
JOIN multica_user u ON u.id = member.user_id
WHERE run.id = $1
  AND member.status = 'active'
  AND (
      member.role IN ('owner', 'admin')
      OR u.id = run.triggered_by_id
  );

-- name: ListWorkflowRoleNotificationsByRun :many
SELECT * FROM multica_workflow_role_notification
WHERE workflow_run_id = $1
ORDER BY created_at;

-- =====================
-- Workflow Deliverable Queries
-- =====================

-- name: ListWorkflowNodeDeliverables :many
SELECT * FROM multica_workflow_node_deliverable
WHERE workflow_node_id = $1
ORDER BY sort_order ASC, created_at ASC;

-- name: CreateWorkflowNodeDeliverable :one
INSERT INTO multica_workflow_node_deliverable (
    workflow_node_id, kind, title, description, required, sort_order
) VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: UpdateWorkflowNodeDeliverable :one
UPDATE multica_workflow_node_deliverable SET
    kind = COALESCE(sqlc.narg('kind'), kind),
    title = COALESCE(sqlc.narg('title'), title),
    description = COALESCE(sqlc.narg('description'), description),
    required = COALESCE(sqlc.narg('required')::boolean, required),
    sort_order = COALESCE(sqlc.narg('sort_order')::int, sort_order),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteWorkflowNodeDeliverable :exec
DELETE FROM multica_workflow_node_deliverable WHERE id = $1;

-- =====================
-- Deliverable Submission Queries
-- =====================

-- name: ListNodeRunDeliverableSubmissions :many
SELECT * FROM multica_workflow_node_deliverable_submission
WHERE workflow_node_run_id = $1
ORDER BY created_at ASC;

-- name: UpsertNodeRunDeliverableSubmission :one
INSERT INTO multica_workflow_node_deliverable_submission (
    workflow_node_run_id, deliverable_id, submitted_by_type, submitted_by_id,
    status, content, attachment_id, pull_request_url
) VALUES ($1, $2, $3, sqlc.narg('submitted_by_id'), 'submitted', $4, sqlc.narg('attachment_id'), $5)
ON CONFLICT (workflow_node_run_id, deliverable_id)
DO UPDATE SET
    submitted_by_type = EXCLUDED.submitted_by_type,
    submitted_by_id = EXCLUDED.submitted_by_id,
    status = 'submitted',
    content = EXCLUDED.content,
    attachment_id = EXCLUDED.attachment_id,
    pull_request_url = EXCLUDED.pull_request_url,
    submitted_at = now(),
    updated_at = now()
RETURNING *;

-- name: ReviewNodeRunDeliverableSubmission :one
UPDATE multica_workflow_node_deliverable_submission SET
    status = $2,
    review_comment = $3,
    reviewed_at = now(),
    updated_at = now()
WHERE id = $1
RETURNING *;

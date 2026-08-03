-- name: GetWorkflowSplitGeneration :one
SELECT * FROM multica_workflow_split_generation
WHERE node_run_id = $1 AND generation = $2;

-- name: GetWorkflowSplitGenerationForUpdate :one
SELECT * FROM multica_workflow_split_generation
WHERE node_run_id = $1 AND generation = $2
FOR UPDATE;

-- name: GetCurrentWorkflowSplitGeneration :one
SELECT generation.*
FROM multica_workflow_node_run node_run
JOIN multica_workflow_split_generation generation
  ON generation.node_run_id = node_run.id
 AND generation.generation = node_run.split_plan_generation
WHERE node_run.id = $1;

-- name: CreateWorkflowSplitGeneration :one
INSERT INTO multica_workflow_split_generation (
    node_run_id, generation, status, deliverable_id, review_comment,
    reviewed_content, review_head_commit_sha, review_blob_sha
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8
)
RETURNING *;

-- name: SetWorkflowNodeRunSplitGeneration :one
UPDATE multica_workflow_node_run
SET split_plan_generation = $2,
    status = $3,
    completed_at = NULL,
    failure_reason = NULL,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: BindWorkflowSplitGenerationPlannerTask :one
UPDATE multica_workflow_split_generation
SET planner_task_id = $3,
    updated_at = now()
WHERE node_run_id = $1
  AND generation = $2
  AND status = 'splitting'
RETURNING *;

-- name: BindWorkflowSplitGenerationSubmission :one
UPDATE multica_workflow_split_generation
SET submission_id = $3,
    pr_url = $4,
    status = 'awaiting_review',
    updated_at = now()
WHERE node_run_id = $1
  AND generation = $2
  AND status IN ('splitting', 'awaiting_review')
RETURNING *;

-- name: UpdateWorkflowSplitGenerationStatus :one
UPDATE multica_workflow_split_generation
SET status = $3,
    updated_at = now()
WHERE node_run_id = $1
  AND generation = $2
RETURNING *;

-- name: RejectWorkflowSplitGeneration :one
UPDATE multica_workflow_split_generation
SET status = 'rejected',
    review_comment = $3,
    reviewed_content = $4,
    review_head_commit_sha = $5,
    review_blob_sha = $6,
    review_archive_status = 'pending',
    updated_at = now()
WHERE node_run_id = $1
  AND generation = $2
RETURNING *;

-- name: UpdateWorkflowSplitGenerationReviewArchive :one
UPDATE multica_workflow_split_generation
SET review_archive_status = $3,
    review_archive_error = $4,
    updated_at = now()
WHERE node_run_id = $1
  AND generation = $2
RETURNING *;

-- name: CreateWorkflowSplitSnapshot :one
INSERT INTO multica_workflow_split_snapshot (
    node_run_id, generation, content, task_path, source_branch,
    head_commit_sha, blob_sha, pr_url
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (node_run_id, generation) DO NOTHING
RETURNING *;

-- name: GetWorkflowSplitSnapshot :one
SELECT * FROM multica_workflow_split_snapshot
WHERE node_run_id = $1 AND generation = $2;

-- name: UpdateWorkflowSplitSnapshotArchive :one
UPDATE multica_workflow_split_snapshot
SET archive_status = $3,
    archive_error = $4
WHERE node_run_id = $1
  AND generation = $2
RETURNING *;

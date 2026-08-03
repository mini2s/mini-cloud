-- =====================
-- Workflow CRUD
-- =====================

-- name: ListWorkflows :many
SELECT * FROM multica_workflow
WHERE workspace_id = $1
  AND is_default = FALSE
  AND (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status'))
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: GetWorkflow :one
SELECT * FROM multica_workflow
WHERE id = $1;

-- name: GetWorkflowInWorkspace :one
SELECT * FROM multica_workflow
WHERE id = $1 AND workspace_id = $2;

-- name: LockWorkflowDefinitionForUpdate :one
SELECT * FROM multica_workflow
WHERE id = $1
FOR UPDATE;

-- name: LockWorkflowDefinitionForShare :one
SELECT * FROM multica_workflow
WHERE id = $1
FOR SHARE;

-- name: IncrementWorkflowConfigRevision :exec
UPDATE multica_workflow
SET config_revision = config_revision + 1,
    updated_at = now()
WHERE id = $1;

-- name: CountWorkflowNodes :one
SELECT count(*)::bigint FROM multica_workflow_node
WHERE workflow_id = $1;

-- name: CreateWorkflow :one
INSERT INTO multica_workflow (
    workspace_id, title, description, status, max_retries,
    created_by_type, created_by_id
) VALUES (
    $1, $2, sqlc.narg('description'), $3, $4, $5, $6
) RETURNING *;

-- name: UpdateWorkflow :one
UPDATE multica_workflow SET
    title = COALESCE(sqlc.narg('title'), title),
    description = COALESCE(sqlc.narg('description'), description),
    status = COALESCE(sqlc.narg('status'), status),
    max_retries = COALESCE(sqlc.narg('max_retries')::int, max_retries),
    default_runtime_selection_policy = COALESCE(
        sqlc.narg('default_runtime_selection_policy')::text,
        default_runtime_selection_policy
    ),
    default_runtime_id = CASE
        WHEN sqlc.narg('default_runtime_selection_policy')::text IS NOT NULL
         AND sqlc.narg('default_runtime_selection_policy')::text <> 'specified_runtime_first'
            THEN NULL
        WHEN sqlc.narg('default_runtime_id')::uuid IS NOT NULL
            THEN sqlc.narg('default_runtime_id')::uuid
        ELSE default_runtime_id
    END,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteWorkflow :exec
DELETE FROM multica_workflow WHERE id = $1;

-- name: WorkflowHasRuns :one
SELECT EXISTS (
    SELECT 1 FROM multica_workflow_run WHERE workflow_id = $1
);

-- =====================
-- Workflow Node CRUD
-- =====================

-- name: ListWorkflowNodes :many
SELECT * FROM multica_workflow_node
WHERE workflow_id = $1
ORDER BY sort_order ASC, created_at ASC;

-- name: GetWorkflowNode :one
SELECT * FROM multica_workflow_node
WHERE id = $1;

-- name: GetWorkflowNodeInWorkflow :one
SELECT * FROM multica_workflow_node
WHERE id = $1 AND workflow_id = $2;

-- name: CreateWorkflowNode :one
INSERT INTO multica_workflow_node (
    workflow_id, title, description, position_x, position_y,
    format_schema, worker_type, worker_id, worker_role_id,
    critic_type, critic_id, critic_api_url, critic_role_id,
    sort_order, stage_id
) VALUES (
    $1, $2, sqlc.narg('description'), $3, $4,
    sqlc.narg('format_schema'), $5, sqlc.narg('worker_id'), sqlc.narg('worker_role_id'),
    $6, sqlc.narg('critic_id'), sqlc.narg('critic_api_url'), sqlc.narg('critic_role_id'),
    $7, sqlc.narg('stage_id')
) RETURNING *;

-- name: UpdateWorkflowNode :one
UPDATE multica_workflow_node SET
    title = COALESCE(sqlc.narg('title'), title),
    description = COALESCE(sqlc.narg('description'), description),
    position_x = COALESCE(sqlc.narg('position_x')::float, position_x),
    position_y = COALESCE(sqlc.narg('position_y')::float, position_y),
    format_schema = COALESCE(sqlc.narg('format_schema'), format_schema),
    worker_type = COALESCE(sqlc.narg('worker_type'), worker_type),
    worker_id = CASE
        WHEN sqlc.narg('worker_role_id')::uuid IS NOT NULL THEN NULL
        ELSE COALESCE(sqlc.narg('worker_id'), worker_id)
    END,
    worker_role_id = CASE
        WHEN sqlc.narg('worker_role_id')::uuid IS NOT NULL THEN sqlc.narg('worker_role_id')::uuid
        WHEN sqlc.narg('worker_id')::uuid IS NOT NULL OR sqlc.narg('worker_type')::text IS NOT NULL THEN NULL
        ELSE worker_role_id
    END,
    critic_type = COALESCE(sqlc.narg('critic_type'), critic_type),
    critic_id = CASE
        WHEN sqlc.narg('critic_role_id')::uuid IS NOT NULL THEN NULL
        ELSE COALESCE(sqlc.narg('critic_id'), critic_id)
    END,
    critic_api_url = CASE
        WHEN sqlc.narg('critic_role_id')::uuid IS NOT NULL THEN NULL
        ELSE COALESCE(sqlc.narg('critic_api_url'), critic_api_url)
    END,
    critic_role_id = CASE
        WHEN sqlc.narg('critic_role_id')::uuid IS NOT NULL THEN sqlc.narg('critic_role_id')::uuid
        WHEN sqlc.narg('critic_id')::uuid IS NOT NULL
          OR sqlc.narg('critic_type')::text IS NOT NULL
          OR sqlc.narg('critic_api_url')::text IS NOT NULL THEN NULL
        ELSE critic_role_id
    END,
    sort_order = COALESCE(sqlc.narg('sort_order')::int, sort_order),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteWorkflowNode :exec
DELETE FROM multica_workflow_node WHERE id = $1;

-- name: WorkflowNodeHasActiveRunReferences :one
SELECT EXISTS (
    SELECT 1
    FROM multica_workflow_node_run node_run
    JOIN multica_workflow_run run ON run.id = node_run.workflow_run_id
    WHERE node_run.source_workflow_node_id = $1
      AND run.status NOT IN ('completed', 'failed', 'cancelled')
);

-- name: DeleteWorkflowNodesByWorkflow :exec
DELETE FROM multica_workflow_node WHERE workflow_id = $1;

-- =====================
-- Workflow Edge CRUD
-- =====================

-- name: ListWorkflowEdges :many
SELECT * FROM multica_workflow_edge
WHERE workflow_id = $1
ORDER BY created_at ASC;

-- name: GetWorkflowEdge :one
SELECT * FROM multica_workflow_edge
WHERE id = $1;

-- name: GetWorkflowEdgeInWorkflow :one
SELECT * FROM multica_workflow_edge
WHERE id = $1 AND workflow_id = $2;

-- name: CreateWorkflowEdge :one
INSERT INTO multica_workflow_edge (
    workflow_id, source_node_id, target_node_id, condition
) VALUES (
    $1, $2, $3, sqlc.narg('condition')
) RETURNING *;

-- name: DeleteWorkflowEdge :exec
DELETE FROM multica_workflow_edge WHERE id = $1;

-- name: DeleteWorkflowEdgesByWorkflow :exec
DELETE FROM multica_workflow_edge WHERE workflow_id = $1;

-- name: ListWorkflowEdgesBySource :many
SELECT * FROM multica_workflow_edge
WHERE source_node_id = $1
ORDER BY created_at ASC;

-- name: ListWorkflowEdgesByTarget :many
SELECT * FROM multica_workflow_edge
WHERE target_node_id = $1
ORDER BY created_at ASC;

-- =====================
-- Workflow Run CRUD
-- =====================

-- name: ListWorkflowRuns :many
SELECT * FROM multica_workflow_run
WHERE workflow_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: ListWorkflowRunsByWorkspace :many
SELECT * FROM multica_workflow_run
WHERE workspace_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: GetWorkflowRun :one
SELECT * FROM multica_workflow_run
WHERE id = $1;

-- name: CreateWorkflowRun :one
INSERT INTO multica_workflow_run (
    workflow_id, workspace_id, workflow_title, status,
    triggered_by_type, triggered_by_id, input, runtime_selection_policy, runtime_id,
    source_issue_id, responsible_user_id, runtime_authorizer_id
) VALUES (
    $1, $2, $3, $4, $5, sqlc.narg('triggered_by_id'), sqlc.narg('input'), sqlc.arg('runtime_selection_policy'), sqlc.narg('runtime_id'),
    sqlc.narg('source_issue_id'), sqlc.narg('responsible_user_id'), sqlc.narg('runtime_authorizer_id')
) RETURNING *;

-- name: GetWorkflowRunByDispatchKey :one
SELECT *
FROM multica_workflow_run
WHERE workspace_id = $1
  AND dispatch_key = $2
LIMIT 1;

-- name: GetWorkflowRunBySourceIssue :one
SELECT * FROM multica_workflow_run
WHERE source_issue_id = $1
ORDER BY created_at DESC
LIMIT 1;

-- name: CreateWorkflowRunWithDispatchKey :one
INSERT INTO multica_workflow_run (
    workflow_id, workspace_id, workflow_title, status,
    triggered_by_type, triggered_by_id, input, runtime_selection_policy, runtime_id, dispatch_key,
    source_issue_id, responsible_user_id, runtime_authorizer_id
) VALUES (
    $1, $2, $3, $4,
    $5, sqlc.narg('triggered_by_id'), sqlc.narg('input'), sqlc.arg('runtime_selection_policy'), sqlc.narg('runtime_id'), sqlc.arg('dispatch_key'),
    sqlc.narg('source_issue_id'), sqlc.narg('responsible_user_id'), sqlc.narg('runtime_authorizer_id')
)
ON CONFLICT (dispatch_key)
WHERE dispatch_key IS NOT NULL AND dispatch_key <> ''
DO UPDATE SET dispatch_key = EXCLUDED.dispatch_key
RETURNING *;

-- name: UpdateWorkflowRunStatus :one
UPDATE multica_workflow_run SET
    status = $2,
    completed_at = CASE WHEN $2 IN ('completed', 'failed', 'cancelled') THEN now() ELSE completed_at END
WHERE id = $1
RETURNING *;

-- name: CompleteWorkflowRun :one
UPDATE multica_workflow_run SET
    status = 'completed',
    output = sqlc.narg('output'),
    completed_at = now()
WHERE id = $1
RETURNING *;

-- name: FailWorkflowRun :one
UPDATE multica_workflow_run SET
    status = 'failed',
    completed_at = now()
WHERE id = $1
RETURNING *;

-- name: ReviveWorkflowRunForRetry :one
UPDATE multica_workflow_run SET
    status = 'running',
    failure_reason = NULL,
    completed_at = NULL
WHERE id = $1
  AND status = 'failed'
RETURNING *;

-- name: CancelWorkflowRun :one
UPDATE multica_workflow_run SET
    status = 'cancelled',
    completed_at = now()
WHERE id = $1
RETURNING *;

-- =====================
-- Template queries
-- =====================

-- name: ListTemplates :many
SELECT * FROM multica_workflow
WHERE is_template = TRUE
ORDER BY created_at DESC;

-- name: ListWorkflowsExcludingTemplates :many
SELECT * FROM multica_workflow
WHERE workspace_id = $1 AND is_template = FALSE AND is_default = FALSE
  AND (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status'))
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: ListSplitIssueWorkflowOptions :many
SELECT wf.*,
       (
         SELECT count(*)::bigint
         FROM multica_workflow_node wn_count
         WHERE wn_count.workflow_id = wf.id
       ) AS node_count
FROM multica_workflow wf
WHERE wf.workspace_id = $1
  AND wf.status = 'active'
  AND wf.id <> $2
  AND NOT EXISTS (
    SELECT 1
    FROM multica_workflow_node wn
    WHERE wn.workflow_id = wf.id
      AND wn.format_schema ->> 'type' = 'split'
  )
ORDER BY lower(wf.title), wf.created_at DESC
LIMIT sqlc.arg('limit_count')::int
OFFSET sqlc.arg('offset_count')::int;

-- name: SetWorkflowTemplate :one
UPDATE multica_workflow SET
    is_template = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: CountWorkflowsBySourceTemplate :one
SELECT count(*)::bigint FROM multica_workflow
WHERE source_template_id = $1;

-- name: CreateWorkflowFromTemplate :one
INSERT INTO multica_workflow (
    workspace_id, title, description, status, max_retries,
    created_by_type, created_by_id, is_template, source_template_id
) VALUES (
    $1, $2, sqlc.narg('description'), $3, $4, $5, $6, FALSE, $7
) RETURNING *;

-- =====================
-- Default (system) workflow
-- =====================

-- name: GetDefaultWorkflow :one
SELECT * FROM multica_workflow
WHERE workspace_id = $1 AND is_default = TRUE;

-- name: CreateDefaultWorkflow :one
-- System-created default workflow (archive sink for agent/member/squad issues).
-- created_by_type='system', created_by_id NULL (migration 136 relaxed both).
INSERT INTO multica_workflow (
    workspace_id, title, status, max_retries, created_by_type, is_default
) VALUES (
    $1, $2, 'active', 3, 'system', TRUE
) RETURNING *;

-- =====================
-- Workflow admin management
-- =====================

-- name: ListWorkflowAdminUsers :many
SELECT * FROM multica_user
WHERE can_manage_workflows = TRUE
ORDER BY name ASC;

-- name: SetUserWorkflowAdmin :one
UPDATE multica_user SET
    can_manage_workflows = $2
WHERE id = $1
RETURNING *;

-- =====================
-- Workflow Stage CRUD
-- =====================

-- name: CreateWorkflowStage :one
INSERT INTO multica_workflow_stage (
    workflow_id, name, description, sort_order
) VALUES (
    $1, $2, sqlc.narg('description'), $3
) RETURNING *;

-- name: GetWorkflowStage :one
SELECT * FROM multica_workflow_stage WHERE id = $1;

-- name: GetWorkflowStageInWorkflow :one
SELECT * FROM multica_workflow_stage
WHERE id = $1 AND workflow_id = $2;

-- name: ListWorkflowStagesByWorkflow :many
SELECT * FROM multica_workflow_stage
WHERE workflow_id = $1
ORDER BY sort_order ASC, created_at ASC;

-- name: UpdateWorkflowStage :one
UPDATE multica_workflow_stage SET
    name = COALESCE(sqlc.narg('name'), name),
    description = COALESCE(sqlc.narg('description'), description),
    sort_order = COALESCE(sqlc.narg('sort_order')::int, sort_order),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteWorkflowStage :exec
DELETE FROM multica_workflow_stage WHERE id = $1;

-- name: CompactWorkflowStageOrders :exec
UPDATE multica_workflow_stage
SET sort_order = sort_order - 1, updated_at = now()
WHERE workflow_id = $1 AND sort_order > $2;

-- name: CountWorkflowStageNodes :one
SELECT count(*)::bigint FROM multica_workflow_node
WHERE stage_id = $1;

-- name: AssignNodeToStage :one
UPDATE multica_workflow_node SET
    stage_id = sqlc.narg('stage_id'),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UnassignNodeFromStage :one
UPDATE multica_workflow_node SET
    stage_id = NULL,
    updated_at = now()
WHERE id = $1
RETURNING *;

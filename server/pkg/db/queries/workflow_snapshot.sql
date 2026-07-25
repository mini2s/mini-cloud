-- =====================
-- Workflow Definition Snapshot
-- =====================

-- name: GetWorkflowForSnapshot :one
SELECT *
FROM multica_workflow
WHERE id = $1;

-- name: GetWorkflowWorkspaceID :one
SELECT workspace_id
FROM multica_workflow
WHERE id = $1;

-- name: LockWorkflowRolesForSnapshot :many
SELECT role.*
FROM multica_workflow_role role
WHERE EXISTS (
    SELECT 1
    FROM multica_workflow_node node
    WHERE node.workflow_id = sqlc.arg('workflow_id')
      AND (node.worker_role_id = role.id OR node.critic_role_id = role.id)
)
ORDER BY role.id
FOR SHARE OF role;

-- name: ListWorkflowDefinitionForSnapshot :one
SELECT
    workflow.id AS workflow_id,
    workflow.workspace_id,
    workflow.title,
    workflow.description,
    workflow.is_default,
    workflow.max_retries,
    workflow.default_runtime_selection_policy,
    workflow.default_runtime_id,
    workflow.config_revision,
    COALESCE((
        SELECT jsonb_agg(
            to_jsonb(node) || jsonb_build_object(
                'worker_name', COALESCE(CASE node.worker_type
                    WHEN 'human' THEN (SELECT member.name FROM multica_user member WHERE member.id = node.worker_id)
                    WHEN 'agent' THEN (SELECT agent.name FROM multica_agent agent WHERE agent.id = node.worker_id)
                    WHEN 'squad' THEN (SELECT squad.name FROM multica_squad squad WHERE squad.id = node.worker_id)
                    ELSE ''
                END, ''),
                'critic_name', COALESCE(CASE node.critic_type
                    WHEN 'human' THEN (SELECT member.name FROM multica_user member WHERE member.id = node.critic_id)
                    WHEN 'agent' THEN (SELECT agent.name FROM multica_agent agent WHERE agent.id = node.critic_id)
                    WHEN 'squad' THEN (SELECT squad.name FROM multica_squad squad WHERE squad.id = node.critic_id)
                    ELSE ''
                END, '')
            )
            ORDER BY node.sort_order, node.id
        )
        FROM multica_workflow_node node
        WHERE node.workflow_id = workflow.id
    ), '[]'::jsonb)::text AS nodes,
    COALESCE((
        SELECT jsonb_agg(to_jsonb(edge) ORDER BY edge.created_at, edge.id)
        FROM multica_workflow_edge edge
        WHERE edge.workflow_id = workflow.id
    ), '[]'::jsonb)::text AS edges,
    COALESCE((
        SELECT jsonb_agg(to_jsonb(stage) ORDER BY stage.sort_order, stage.id)
        FROM multica_workflow_stage stage
        WHERE stage.workflow_id = workflow.id
    ), '[]'::jsonb)::text AS stages,
    COALESCE((
        SELECT jsonb_agg(to_jsonb(role) ORDER BY role.id)
        FROM multica_workflow_role role
        WHERE EXISTS (
            SELECT 1
            FROM multica_workflow_node node
            WHERE node.workflow_id = workflow.id
              AND (node.worker_role_id = role.id OR node.critic_role_id = role.id)
        )
    ), '[]'::jsonb)::text AS roles,
    COALESCE((
        SELECT jsonb_agg(to_jsonb(deliverable) ORDER BY deliverable.sort_order, deliverable.id)
        FROM multica_workflow_node_deliverable deliverable
        JOIN multica_workflow_node node ON node.id = deliverable.workflow_node_id
        WHERE node.workflow_id = workflow.id
    ), '[]'::jsonb)::text AS deliverables
FROM multica_workflow workflow
WHERE workflow.id = $1;

-- name: CreateWorkflowRunSnapshot :one
INSERT INTO multica_workflow_run (
    workflow_id,
    workspace_id,
    workflow_title,
    status,
    triggered_by_type,
    triggered_by_id,
    input,
    runtime_selection_policy,
    runtime_id,
    dispatch_key,
    source_issue_id,
    responsible_user_id,
    runtime_authorizer_id,
    source_config_revision,
    definition_schema_version,
    definition_snapshot,
    max_retries,
    failure_reason,
    validation_errors
) VALUES (
    $1,
    $2,
    $3,
    $4,
    $5,
    sqlc.narg('triggered_by_id'),
    sqlc.narg('input'),
    sqlc.arg('runtime_selection_policy'),
    sqlc.narg('runtime_id'),
    sqlc.narg('dispatch_key'),
    sqlc.narg('source_issue_id'),
    sqlc.narg('responsible_user_id'),
    sqlc.narg('runtime_authorizer_id'),
    sqlc.arg('source_config_revision'),
    sqlc.arg('definition_schema_version'),
    sqlc.arg('definition_snapshot'),
    sqlc.arg('max_retries'),
    sqlc.narg('failure_reason'),
    sqlc.narg('validation_errors')
)
ON CONFLICT (dispatch_key)
WHERE dispatch_key IS NOT NULL AND dispatch_key <> ''
DO UPDATE SET dispatch_key = EXCLUDED.dispatch_key
RETURNING *;

-- name: CreateWorkflowNodeRunSnapshot :one
INSERT INTO multica_workflow_node_run (
    workflow_run_id,
    workflow_node_id,
    source_workflow_node_id,
    node_title,
    node_description,
    status,
    retry_count,
    format_schema,
    worker_type,
    worker_id,
    critic_type,
    critic_id,
    critic_api_url,
    stage_snapshot,
    worker_role_snapshot,
    critic_role_snapshot,
    runtime_config,
    worker_name_snapshot,
    critic_name_snapshot
) VALUES (
    $1,
    $2,
    $2,
    $3,
    $4,
    $5,
    $6,
    sqlc.narg('format_schema'),
    $7,
    sqlc.narg('worker_id'),
    $8,
    sqlc.narg('critic_id'),
    sqlc.narg('critic_api_url'),
    sqlc.narg('stage_snapshot'),
    sqlc.narg('worker_role_snapshot'),
    sqlc.narg('critic_role_snapshot'),
    sqlc.arg('runtime_config'),
    sqlc.arg('worker_name_snapshot'),
    sqlc.arg('critic_name_snapshot')
)
RETURNING *;

-- name: CreateRunEdge :one
INSERT INTO multica_workflow_run_edge (
    workflow_run_id, source_node_run_id, target_node_run_id, condition
) VALUES (
    $1, $2, $3, sqlc.narg('condition')
)
RETURNING *;

-- name: CreateNodeRunDeliverableRequirement :one
INSERT INTO multica_workflow_node_run_deliverable (
    workflow_node_run_id,
    source_deliverable_id,
    kind,
    title,
    description,
    required,
    sort_order
) VALUES (
    $1, $2, $3, $4, $5, $6, $7
)
RETURNING *;

-- =====================
-- Workflow Runtime Reads
-- =====================

-- name: GetWorkflowRunDefinitionSnapshot :one
SELECT definition_schema_version, definition_snapshot
FROM multica_workflow_run
WHERE id = $1;

-- name: GetWorkflowNodeRunBySource :one
SELECT *
FROM multica_workflow_node_run
WHERE workflow_run_id = $1
  AND source_workflow_node_id = $2
LIMIT 1;

-- name: ListWorkflowRunEdges :many
SELECT *
FROM multica_workflow_run_edge
WHERE workflow_run_id = $1
ORDER BY created_at, id;

-- name: ListWorkflowRunEdgesBySource :many
SELECT *
FROM multica_workflow_run_edge
WHERE source_node_run_id = $1
ORDER BY created_at, id;

-- name: ListWorkflowRunEdgesByTarget :many
SELECT *
FROM multica_workflow_run_edge
WHERE target_node_run_id = $1
ORDER BY created_at, id;

-- name: ListCompletedRuntimeUpstreamNodeRuns :many
WITH RECURSIVE upstream(node_run_id) AS (
    SELECT edge.source_node_run_id
    FROM multica_workflow_run_edge edge
    WHERE edge.target_node_run_id = sqlc.arg('node_run_id')
    UNION
    SELECT edge.source_node_run_id
    FROM multica_workflow_run_edge edge
    JOIN upstream ON upstream.node_run_id = edge.target_node_run_id
), current_node AS (
    SELECT workflow_run_id,
           COALESCE((stage_snapshot ->> 'sort_order')::int, -1) AS stage_sort_order
    FROM multica_workflow_node_run
    WHERE id = sqlc.arg('node_run_id')
)
SELECT
    node_run.id,
    node_run.source_workflow_node_id AS workflow_node_id,
    node_run.node_title,
    node_run.status,
    node_run.worker_output
FROM upstream
JOIN multica_workflow_node_run node_run ON node_run.id = upstream.node_run_id
JOIN current_node ON current_node.workflow_run_id = node_run.workflow_run_id
WHERE node_run.status = 'completed'
  AND COALESCE((node_run.stage_snapshot ->> 'sort_order')::int, -1) < current_node.stage_sort_order
ORDER BY COALESCE((node_run.stage_snapshot ->> 'sort_order')::int, -1), node_run.created_at, node_run.id
LIMIT sqlc.arg('result_limit');

-- name: ListNodeRunDeliverableRequirements :many
SELECT *
FROM multica_workflow_node_run_deliverable
WHERE workflow_node_run_id = $1
ORDER BY sort_order, created_at, id;

-- name: GetNodeRunDeliverableRequirement :one
SELECT *
FROM multica_workflow_node_run_deliverable
WHERE id = $1;

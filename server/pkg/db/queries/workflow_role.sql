-- =====================
-- Workflow Role Queries
-- =====================

-- name: ListWorkflowRoles :many
SELECT * FROM multica_workflow_role
WHERE workspace_id = $1
ORDER BY is_builtin DESC, name ASC;

-- name: CreateBuiltinWorkflowRoles :exec
INSERT INTO multica_workflow_role (
    workspace_id, name, normalized_name, description, is_builtin, needs_description
)
SELECT sqlc.arg('workspace_id')::uuid, builtin.name, builtin.name, builtin.description, true, false
FROM (VALUES
    ('developer', 'Implements, tests, and maintains product and engineering work.'),
    ('qa', 'Validates quality, verifies requirements, and identifies regressions.'),
    ('tech_lead', 'Owns technical direction, design review, and engineering quality.')
) AS builtin(name, description)
ON CONFLICT (workspace_id, normalized_name) DO NOTHING;

-- name: GetWorkflowRoleInWorkspace :one
SELECT * FROM multica_workflow_role
WHERE id = $1 AND workspace_id = $2;

-- name: CreateWorkflowRole :one
INSERT INTO multica_workflow_role (
    workspace_id, name, normalized_name, description,
    is_builtin, needs_description, created_by
)
VALUES ($1, $2, $3, $4, false, false, $5)
RETURNING *;

-- name: UpdateWorkflowRole :one
UPDATE multica_workflow_role SET
    name = COALESCE(sqlc.narg('name'), name),
    normalized_name = COALESCE(sqlc.narg('normalized_name'), normalized_name),
    description = COALESCE(sqlc.narg('description'), description),
    needs_description = false,
    updated_at = now()
WHERE id = $1 AND workspace_id = $2 AND is_builtin = false
RETURNING *;

-- name: CountWorkflowRoleReferences :one
SELECT count(*)::bigint
FROM multica_workflow_node node
WHERE node.worker_role_id = $1::uuid
   OR node.critic_role_id = $1::uuid;

-- name: DeleteWorkflowRole :execrows
DELETE FROM multica_workflow_role
WHERE id = $1 AND workspace_id = $2 AND is_builtin = false;

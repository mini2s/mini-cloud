-- =====================
-- Workflow Role Queries
-- =====================

-- name: ListWorkflowRoles :many
SELECT * FROM multica_workflow_role
WHERE workspace_id = $1
ORDER BY name ASC;

-- name: CreateWorkflowRole :one
INSERT INTO multica_workflow_role (workspace_id, name, description)
VALUES ($1, $2, $3)
RETURNING *;

-- name: UpdateWorkflowRole :one
UPDATE multica_workflow_role SET
    name = COALESCE(sqlc.narg('name'), name),
    description = COALESCE(sqlc.narg('description'), description),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteWorkflowRole :exec
DELETE FROM multica_workflow_role WHERE id = $1;

-- name: ListWorkflowRoleBindings :many
SELECT * FROM multica_workflow_role_binding
WHERE role_id = $1
ORDER BY priority ASC;

-- name: CreateWorkflowRoleBinding :one
INSERT INTO multica_workflow_role_binding (role_id, actor_type, actor_id, priority)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: DeleteWorkflowRoleBinding :exec
DELETE FROM multica_workflow_role_binding WHERE id = $1;

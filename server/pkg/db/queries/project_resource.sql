-- name: ListProjectResources :many
SELECT * FROM multica_project_resource
WHERE project_id = $1
ORDER BY position ASC, created_at ASC;

-- name: ListProjectResourcesForProjects :many
SELECT * FROM multica_project_resource
WHERE project_id = ANY(sqlc.arg('project_ids')::uuid[])
ORDER BY project_id, position ASC, created_at ASC;

-- name: GetProjectResource :one
SELECT * FROM multica_project_resource
WHERE id = $1;

-- name: GetProjectResourceInWorkspace :one
SELECT * FROM multica_project_resource
WHERE id = $1 AND workspace_id = $2;

-- name: CreateProjectResource :one
INSERT INTO multica_project_resource (
    project_id, workspace_id, resource_type, resource_ref, label, position, created_by
) VALUES (
    $1, $2, $3, $4, $5, $6, $7
) RETURNING *;

-- name: DeleteProjectResource :exec
DELETE FROM multica_project_resource WHERE id = $1;

-- name: CountProjectResources :one
SELECT count(*) FROM multica_project_resource WHERE project_id = $1;

-- name: GetProjectResourceCounts :many
SELECT project_id, count(*)::bigint AS resource_count
FROM multica_project_resource
WHERE project_id = ANY(sqlc.arg('project_ids')::uuid[])
GROUP BY project_id;

-- name: DeleteProjectResourcesByWorkspaceAndURL :execrows
-- Cascade: when a repo URL is removed from workspace.repos (Settings →
-- Repositories), detach it from every project in this workspace so the
-- project page and the settings page agree.
DELETE FROM multica_project_resource
WHERE workspace_id = $1 AND resource_type = 'github_repo' AND resource_ref->>'url' = sqlc.arg('url')::text;

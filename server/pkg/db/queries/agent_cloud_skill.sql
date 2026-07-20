-- name: ListAgentCloudSkills :many
SELECT * FROM multica_agent_cloud_skill
WHERE agent_id = $1
ORDER BY position ASC, name ASC, cloud_skill_id ASC;

-- name: DeleteAgentCloudSkills :exec
DELETE FROM multica_agent_cloud_skill WHERE agent_id = $1;

-- name: CreateAgentCloudSkill :one
INSERT INTO multica_agent_cloud_skill (agent_id, cloud_skill_id, slug, name, description, install, position)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

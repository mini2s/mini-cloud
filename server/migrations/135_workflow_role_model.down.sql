ALTER TABLE multica_workflow ADD COLUMN custom_roles JSONB NOT NULL DEFAULT '[]';

ALTER TABLE multica_workflow_node
    ADD COLUMN worker_role TEXT,
    ADD COLUMN critic_role TEXT;

UPDATE multica_workflow_node node
SET worker_role = role.name
FROM multica_workflow_role role
WHERE role.id = node.worker_role_id;

UPDATE multica_workflow_node node
SET critic_role = role.name
FROM multica_workflow_role role
WHERE role.id = node.critic_role_id;

UPDATE multica_workflow workflow
SET custom_roles = roles.value
FROM (
    SELECT workflow.id,
           COALESCE(jsonb_agg(DISTINCT role.name) FILTER (WHERE NOT role.is_builtin), '[]'::jsonb) AS value
    FROM multica_workflow workflow
    LEFT JOIN multica_workflow_node node ON node.workflow_id = workflow.id
    LEFT JOIN multica_workflow_role role
      ON role.id IN (node.worker_role_id, node.critic_role_id)
    GROUP BY workflow.id
) roles
WHERE roles.id = workflow.id;

ALTER TABLE multica_workflow_node
    DROP CONSTRAINT IF EXISTS multica_workflow_node_worker_role_assignment_check,
    DROP CONSTRAINT IF EXISTS multica_workflow_node_critic_role_assignment_check,
    DROP CONSTRAINT IF EXISTS multica_workflow_node_worker_role_fk,
    DROP CONSTRAINT IF EXISTS multica_workflow_node_critic_role_fk,
    DROP COLUMN worker_role_id,
    DROP COLUMN critic_role_id,
    ADD CONSTRAINT multica_workflow_node_worker_role_check
        CHECK (worker_role IS NULL OR worker_role <> ''),
    ADD CONSTRAINT multica_workflow_node_critic_role_check
        CHECK (critic_role IS NULL OR critic_role <> ''),
    ADD CONSTRAINT multica_workflow_node_worker_role_assignment_check
        CHECK (worker_role IS NULL OR worker_id IS NULL),
    ADD CONSTRAINT multica_workflow_node_critic_role_assignment_check
        CHECK (critic_role IS NULL OR (critic_id IS NULL AND critic_api_url IS NULL));

DROP INDEX IF EXISTS idx_workflow_node_worker_role_id;
DROP INDEX IF EXISTS idx_workflow_node_critic_role_id;
DROP INDEX IF EXISTS multica_workflow_role_workspace_normalized_name_key;

ALTER TABLE multica_workflow_role
    DROP CONSTRAINT IF EXISTS multica_workflow_role_name_length_check,
    DROP CONSTRAINT IF EXISTS multica_workflow_role_description_length_check,
    DROP COLUMN normalized_name,
    DROP COLUMN is_builtin,
    DROP COLUMN needs_description,
    DROP COLUMN created_by;

ALTER TABLE multica_workflow_role
    ADD CONSTRAINT multica_workflow_role_workspace_id_name_key UNIQUE(workspace_id, name);

CREATE TABLE multica_workflow_role_binding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES multica_workflow_role(id) ON DELETE CASCADE,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('member', 'agent', 'squad')),
    actor_id UUID NOT NULL,
    priority INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_workflow_role_binding_role
    ON multica_workflow_role_binding(role_id, priority);

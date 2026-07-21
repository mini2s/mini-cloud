-- Converge workflow roles on workspace-scoped records referenced by stable IDs.
-- Static bindings are intentionally not converted into runtime assignees. Emit
-- release-log statistics before removing the obsolete priority model.
DO $$
DECLARE
    binding RECORD;
BEGIN
    IF to_regclass('multica_workflow_role_binding') IS NOT NULL THEN
        RAISE NOTICE 'workflow role binding migration: intentionally removing % static bindings',
            (SELECT count(*) FROM multica_workflow_role_binding);
        FOR binding IN
            SELECT role.name AS role_name, old.actor_type, count(*) AS binding_count
            FROM multica_workflow_role_binding old
            JOIN multica_workflow_role role ON role.id = old.role_id
            GROUP BY role.name, old.actor_type
            ORDER BY role.name, old.actor_type
        LOOP
            RAISE NOTICE 'workflow role binding migration: role=%, actor_type=%, count=%',
                binding.role_name, binding.actor_type, binding.binding_count;
        END LOOP;
    END IF;
END $$;

DROP TABLE IF EXISTS multica_workflow_role_binding;

ALTER TABLE multica_workflow_role
    ADD COLUMN normalized_name TEXT,
    ADD COLUMN is_builtin BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN needs_description BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN created_by UUID REFERENCES multica_user(id) ON DELETE SET NULL;

UPDATE multica_workflow_role
SET name = btrim(name), normalized_name = lower(btrim(name));

-- Migration 134 allowed case-sensitive duplicates. No node referenced role IDs
-- yet, so retaining the oldest definition is lossless for current templates.
DELETE FROM multica_workflow_role duplicate
USING multica_workflow_role canonical
WHERE duplicate.workspace_id = canonical.workspace_id
  AND duplicate.normalized_name = canonical.normalized_name
  AND (duplicate.created_at, duplicate.id) > (canonical.created_at, canonical.id);

ALTER TABLE multica_workflow_role
    ALTER COLUMN normalized_name SET NOT NULL,
    ADD CONSTRAINT multica_workflow_role_name_length_check
        CHECK (char_length(name) BETWEEN 1 AND 100),
    ADD CONSTRAINT multica_workflow_role_description_length_check
        CHECK (char_length(description) <= 2000);

ALTER TABLE multica_workflow_role
    DROP CONSTRAINT IF EXISTS multica_workflow_role_workspace_id_name_key;

CREATE UNIQUE INDEX multica_workflow_role_workspace_normalized_name_key
    ON multica_workflow_role(workspace_id, normalized_name);

UPDATE multica_workflow_role
SET is_builtin = true,
    needs_description = false,
    description = CASE normalized_name
        WHEN 'developer' THEN 'Implements, tests, and maintains product and engineering work.'
        WHEN 'qa' THEN 'Validates quality, verifies requirements, and identifies regressions.'
        WHEN 'tech_lead' THEN 'Owns technical direction, design review, and engineering quality.'
        ELSE description
    END
WHERE normalized_name IN ('developer', 'qa', 'tech_lead');

INSERT INTO multica_workflow_role (
    workspace_id, name, normalized_name, description, is_builtin, needs_description
)
SELECT workspace.id, builtin.name, builtin.name, builtin.description, true, false
FROM multica_workspace workspace
CROSS JOIN (VALUES
    ('developer', 'Implements, tests, and maintains product and engineering work.'),
    ('qa', 'Validates quality, verifies requirements, and identifies regressions.'),
    ('tech_lead', 'Owns technical direction, design review, and engineering quality.')
) AS builtin(name, description)
ON CONFLICT (workspace_id, normalized_name) DO NOTHING;

-- Convert workflow-local custom role strings into workspace roles.
INSERT INTO multica_workflow_role (
    workspace_id, name, normalized_name, description, is_builtin, needs_description
)
SELECT DISTINCT workflow.workspace_id, role.name, lower(btrim(role.name)), '', false, true
FROM multica_workflow workflow
CROSS JOIN LATERAL jsonb_array_elements_text(workflow.custom_roles) AS role(name)
WHERE btrim(role.name) <> ''
ON CONFLICT (workspace_id, normalized_name) DO NOTHING;

-- Also recover role strings that were saved directly on nodes but omitted from
-- custom_roles.
INSERT INTO multica_workflow_role (
    workspace_id, name, normalized_name, description, is_builtin, needs_description
)
SELECT DISTINCT workflow.workspace_id, role.name, lower(btrim(role.name)), '', false,
       lower(btrim(role.name)) NOT IN ('developer', 'qa', 'tech_lead')
FROM multica_workflow_node node
JOIN multica_workflow workflow ON workflow.id = node.workflow_id
CROSS JOIN LATERAL (VALUES (node.worker_role), (node.critic_role)) AS role(name)
WHERE role.name IS NOT NULL AND btrim(role.name) <> ''
ON CONFLICT (workspace_id, normalized_name) DO NOTHING;

ALTER TABLE multica_workflow_node
    ADD COLUMN worker_role_id UUID,
    ADD COLUMN critic_role_id UUID;

UPDATE multica_workflow_node node
SET worker_role_id = role.id
FROM multica_workflow workflow
JOIN multica_workflow_role role ON role.workspace_id = workflow.workspace_id
WHERE workflow.id = node.workflow_id
  AND node.worker_role IS NOT NULL
  AND role.normalized_name = lower(btrim(node.worker_role));

UPDATE multica_workflow_node node
SET critic_role_id = role.id
FROM multica_workflow workflow
JOIN multica_workflow_role role ON role.workspace_id = workflow.workspace_id
WHERE workflow.id = node.workflow_id
  AND node.critic_role IS NOT NULL
  AND role.normalized_name = lower(btrim(node.critic_role));

ALTER TABLE multica_workflow_node
    ADD CONSTRAINT multica_workflow_node_worker_role_fk
        FOREIGN KEY (worker_role_id) REFERENCES multica_workflow_role(id) ON DELETE RESTRICT,
    ADD CONSTRAINT multica_workflow_node_critic_role_fk
        FOREIGN KEY (critic_role_id) REFERENCES multica_workflow_role(id) ON DELETE RESTRICT;

ALTER TABLE multica_workflow_node
    DROP CONSTRAINT IF EXISTS workflow_node_worker_type_check,
    ADD CONSTRAINT workflow_node_worker_type_check
        CHECK (worker_type IN ('human', 'agent', 'squad')),
    DROP CONSTRAINT IF EXISTS workflow_node_critic_type_check,
    ADD CONSTRAINT workflow_node_critic_type_check
        CHECK (critic_type IN ('human', 'agent', 'squad', 'api'));

ALTER TABLE multica_workflow_node
    DROP CONSTRAINT IF EXISTS multica_workflow_node_worker_role_check,
    DROP CONSTRAINT IF EXISTS multica_workflow_node_critic_role_check,
    DROP CONSTRAINT IF EXISTS multica_workflow_node_worker_role_assignment_check,
    DROP CONSTRAINT IF EXISTS multica_workflow_node_critic_role_assignment_check;

-- Re-add the ID-based assignment checks after removing the legacy constraints
-- that used the same names.
ALTER TABLE multica_workflow_node
    ADD CONSTRAINT multica_workflow_node_worker_role_assignment_check
        CHECK (worker_role_id IS NULL OR worker_id IS NULL),
    ADD CONSTRAINT multica_workflow_node_critic_role_assignment_check
        CHECK (critic_role_id IS NULL OR (critic_id IS NULL AND critic_api_url IS NULL)),
    DROP COLUMN worker_role,
    DROP COLUMN critic_role;

ALTER TABLE multica_workflow DROP COLUMN custom_roles;

CREATE INDEX idx_workflow_node_worker_role_id
    ON multica_workflow_node(worker_role_id) WHERE worker_role_id IS NOT NULL;
CREATE INDEX idx_workflow_node_critic_role_id
    ON multica_workflow_node(critic_role_id) WHERE critic_role_id IS NOT NULL;

ALTER TABLE multica_workflow_node
    DROP CONSTRAINT multica_workflow_node_worker_role_check,
    DROP CONSTRAINT multica_workflow_node_critic_role_check;

UPDATE multica_workflow_node
SET worker_role = NULL
WHERE worker_role IS NOT NULL
  AND worker_role NOT IN ('developer', 'qa', 'tech_lead');

UPDATE multica_workflow_node
SET critic_role = NULL
WHERE critic_role IS NOT NULL
  AND critic_role NOT IN ('developer', 'qa', 'tech_lead');

ALTER TABLE multica_workflow_node
    ADD CONSTRAINT multica_workflow_node_worker_role_check
        CHECK (worker_role IS NULL OR worker_role IN ('developer', 'qa', 'tech_lead')),
    ADD CONSTRAINT multica_workflow_node_critic_role_check
        CHECK (critic_role IS NULL OR critic_role IN ('developer', 'qa', 'tech_lead'));

ALTER TABLE multica_workflow
    DROP COLUMN custom_roles;

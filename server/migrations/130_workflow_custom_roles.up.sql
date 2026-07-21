ALTER TABLE multica_workflow
    ADD COLUMN custom_roles jsonb NOT NULL DEFAULT '[]';

-- Drop the old restrictive CHECK constraints that only allow 3 built-in roles
ALTER TABLE multica_workflow_node
    DROP CONSTRAINT multica_workflow_node_worker_role_check,
    DROP CONSTRAINT multica_workflow_node_critic_role_check;

-- Replace with relaxed constraints: only require non-empty string when set
ALTER TABLE multica_workflow_node
    ADD CONSTRAINT multica_workflow_node_worker_role_check
        CHECK (worker_role IS NULL OR worker_role != ''),
    ADD CONSTRAINT multica_workflow_node_critic_role_check
        CHECK (critic_role IS NULL OR critic_role != '');

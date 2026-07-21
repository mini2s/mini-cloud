ALTER TABLE multica_workflow_node
    DROP CONSTRAINT multica_workflow_node_critic_role_assignment_check,
    DROP CONSTRAINT multica_workflow_node_worker_role_assignment_check,
    DROP CONSTRAINT multica_workflow_node_critic_role_check,
    DROP CONSTRAINT multica_workflow_node_worker_role_check,
    DROP COLUMN critic_role,
    DROP COLUMN worker_role;

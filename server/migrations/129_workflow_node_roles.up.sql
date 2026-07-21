ALTER TABLE multica_workflow_node
    ADD COLUMN worker_role text,
    ADD COLUMN critic_role text,
    ADD CONSTRAINT multica_workflow_node_worker_role_check
        CHECK (worker_role IS NULL OR worker_role IN ('developer', 'qa', 'tech_lead')),
    ADD CONSTRAINT multica_workflow_node_critic_role_check
        CHECK (critic_role IS NULL OR critic_role IN ('developer', 'qa', 'tech_lead')),
    ADD CONSTRAINT multica_workflow_node_worker_role_assignment_check
        CHECK (worker_role IS NULL OR worker_id IS NULL),
    ADD CONSTRAINT multica_workflow_node_critic_role_assignment_check
        CHECK (critic_role IS NULL OR (critic_id IS NULL AND critic_api_url IS NULL));

ALTER TABLE multica_workflow_node DROP CONSTRAINT IF EXISTS workflow_node_worker_type_check;
ALTER TABLE multica_workflow_node ADD CONSTRAINT workflow_node_worker_type_check
    CHECK (worker_type IN ('human', 'agent', 'squad'));

ALTER TABLE multica_workflow_node DROP CONSTRAINT IF EXISTS workflow_node_critic_type_check;
ALTER TABLE multica_workflow_node ADD CONSTRAINT workflow_node_critic_type_check
    CHECK (critic_type IN ('human', 'agent', 'squad', 'api'));

DROP TABLE IF EXISTS multica_workflow_role_binding;
DROP TABLE IF EXISTS multica_workflow_role;

-- 131_drop_node_instructions.up.sql
-- Drop worker_instructions and critic_instructions from workflow_node.
-- These fields were originally added in 108_workflow but are no longer used —
-- agent instructions now come from the linked agent entity, not the node config.
ALTER TABLE multica_workflow_node
    DROP COLUMN IF EXISTS worker_instructions,
    DROP COLUMN IF EXISTS critic_instructions;

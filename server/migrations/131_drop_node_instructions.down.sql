-- 131_drop_node_instructions.down.sql
-- Re-add worker_instructions and critic_instructions to workflow_node.
ALTER TABLE multica_workflow_node
    ADD COLUMN IF NOT EXISTS worker_instructions TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS critic_instructions TEXT NOT NULL DEFAULT '';

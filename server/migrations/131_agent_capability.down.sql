-- 131_agent_capability.down.sql
ALTER TABLE multica_workflow_node
DROP COLUMN IF EXISTS agent_capability_config,
DROP COLUMN IF EXISTS instructions;

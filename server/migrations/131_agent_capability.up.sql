-- 131_agent_capability.up.sql
-- Add agent capability configuration (JSONB) and instructions to workflow nodes.
-- agent_capability_config stores plugin_id, skill_ids, runtime_id, model_id,
-- fallback_runtime_enabled, fallback_model_enabled.

ALTER TABLE multica_workflow_node
ADD COLUMN agent_capability_config JSONB DEFAULT NULL,
ADD COLUMN instructions TEXT NOT NULL DEFAULT '';

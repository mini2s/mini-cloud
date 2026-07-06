-- 132_node_run_recipe_snapshot.up.sql
-- Add recipe_snapshot JSONB to workflow_node_run.
-- Stores a frozen copy of the node's config (stage_id, development_stage_id,
-- deliverables, worker/critic refs, agent_capability_config, format_schema,
-- instructions) at run creation time. This ensures the issue panorama always
-- reflects the configuration at the time the run was created, not the current
-- definition which may have been edited since.

ALTER TABLE multica_workflow_node_run
ADD COLUMN recipe_snapshot JSONB DEFAULT NULL;

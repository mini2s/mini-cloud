-- 132_node_run_recipe_snapshot.down.sql
ALTER TABLE multica_workflow_node_run
DROP COLUMN IF EXISTS recipe_snapshot;

-- 129_development_stage.down.sql
ALTER TABLE multica_workflow_node DROP COLUMN IF EXISTS development_stage_id;
DROP TABLE IF EXISTS multica_workflow_development_stage;

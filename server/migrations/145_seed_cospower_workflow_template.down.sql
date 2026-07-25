-- 145_seed_cospower_workflow_template.down.sql
-- Remove the CosPower workflow template and the parking workspace that owns it.

DELETE FROM multica_workflow_edge  WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000145';
DELETE FROM multica_workflow_node  WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000145';
DELETE FROM multica_workflow_stage WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000145';
DELETE FROM multica_workflow       WHERE id         = 'c0c00000-0000-4000-8000-000000000145';
DELETE FROM multica_workspace      WHERE id         = 'c0c00001-0000-4000-8000-000000000145';

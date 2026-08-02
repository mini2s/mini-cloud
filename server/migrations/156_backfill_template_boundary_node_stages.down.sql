-- 156_backfill_template_boundary_node_stages.down.sql
-- Reverse 156: drop the stage assignment from the two templates' Start/End
-- boundary nodes, returning them to stage_id NULL.

UPDATE multica_workflow_node
SET stage_id = NULL
WHERE workflow_id IN (
    'c0c00000-0000-4000-8000-000000000152', -- 精简研发演示
    'c0c00000-0000-4000-8000-000000000145'  -- CosPower 全链路研发
)
  AND format_schema->>'type' IN ('start', 'end');

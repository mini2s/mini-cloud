-- 153_add_cospower_boundary_nodes.down.sql
-- Remove the start/end boundary nodes added by 153, plus any edges that touch
-- them (edges are deleted explicitly so this is safe whether or not the edge FK
-- cascades on node deletion).

WITH boundary AS (
    SELECT id FROM multica_workflow_node
    WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000145'
      AND format_schema->>'type' IN ('start', 'end')
)
DELETE FROM multica_workflow_edge
WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000145'
  AND (source_node_id IN (SELECT id FROM boundary)
       OR target_node_id IN (SELECT id FROM boundary));

DELETE FROM multica_workflow_node
WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000145'
  AND format_schema->>'type' IN ('start', 'end');

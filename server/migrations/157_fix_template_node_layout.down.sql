-- 157_fix_template_node_layout.down.sql
-- Revert 157: restore the original seeded position_x / sort_order values for
-- the two templates. (These were the pre-auto-layout values from migrations
-- 145/154/155.)

UPDATE multica_workflow_node SET position_x = -150, sort_order = 0
  WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000152' AND format_schema->>'type' = 'start';
UPDATE multica_workflow_node SET position_x = 150, sort_order = 1
  WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000152' AND title = '方案设计';
UPDATE multica_workflow_node SET position_x = 400, sort_order = 2
  WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000152' AND title = '任务拆解';
UPDATE multica_workflow_node SET position_x = 650, sort_order = 3
  WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000152' AND title = '编码开发';
UPDATE multica_workflow_node SET position_x = 900, sort_order = 4
  WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000152' AND format_schema->>'type' = 'end';

UPDATE multica_workflow_node SET position_x = -150, sort_order = -1
  WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000145' AND format_schema->>'type' = 'start';
UPDATE multica_workflow_node SET position_x = 200, sort_order = 0
  WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000145' AND title = '需求分析';
UPDATE multica_workflow_node SET position_x = 200, sort_order = 0
  WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000145' AND title = '方案设计';
UPDATE multica_workflow_node SET position_x = 450, sort_order = 1
  WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000145' AND title = '任务拆解';
UPDATE multica_workflow_node SET position_x = 200, sort_order = 0
  WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000145' AND title = 'TDD 编码';
UPDATE multica_workflow_node SET position_x = 450, sort_order = 1
  WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000145' AND title = '测试生成';
UPDATE multica_workflow_node SET position_x = 200, sort_order = 0
  WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000145' AND title = '集成验证';
UPDATE multica_workflow_node SET position_x = 700, sort_order = 100
  WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000145' AND format_schema->>'type' = 'end';

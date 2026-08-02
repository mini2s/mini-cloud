-- 157_fix_template_node_layout.up.sql
-- Persist the lane-based auto-layout positions for both seeded templates so
-- cloned workflows inherit good node positions without needing a runtime
-- re-layout. Mirrors computeLaneAutoLayout:
--   LANE_START_X = 120, LANE_SLOT_STEP = 392 (WORKER_WIDTH 296 + gap 96).
-- First node in each stage lane: x = 120; second: x = 512.
-- sort_order uses per-stage numbering: start = -1, first = 0, second = 1, end = 100.

DO $$
DECLARE
    c_demo UUID := 'c0c00000-0000-4000-8000-000000000152'; -- 精简研发演示
    c_cos  UUID := 'c0c00000-0000-4000-8000-000000000145'; -- CosPower 全链路研发
BEGIN
    -- ── Demo template ──
    -- 方案设计 lane: Start + 方案设计
    UPDATE multica_workflow_node SET position_x = 120, sort_order = -1
      WHERE workflow_id = c_demo AND format_schema->>'type' = 'start';
    UPDATE multica_workflow_node SET position_x = 512, sort_order = 0
      WHERE workflow_id = c_demo AND title = '方案设计';
    -- 任务拆解 lane (single node)
    UPDATE multica_workflow_node SET position_x = 120, sort_order = 0
      WHERE workflow_id = c_demo AND title = '任务拆解';
    -- 编码开发 lane: 编码开发 + End
    UPDATE multica_workflow_node SET position_x = 120, sort_order = 0
      WHERE workflow_id = c_demo AND title = '编码开发';
    UPDATE multica_workflow_node SET position_x = 512, sort_order = 100
      WHERE workflow_id = c_demo AND format_schema->>'type' = 'end';

    -- ── CosPower template ──
    -- 需求分析 lane: Start + 需求分析
    UPDATE multica_workflow_node SET position_x = 120, sort_order = -1
      WHERE workflow_id = c_cos AND format_schema->>'type' = 'start';
    UPDATE multica_workflow_node SET position_x = 512, sort_order = 0
      WHERE workflow_id = c_cos AND title = '需求分析';
    -- 方案设计 lane: 方案设计 + 任务拆解
    UPDATE multica_workflow_node SET position_x = 120, sort_order = 0
      WHERE workflow_id = c_cos AND title = '方案设计';
    UPDATE multica_workflow_node SET position_x = 512, sort_order = 1
      WHERE workflow_id = c_cos AND title = '任务拆解';
    -- TDD 编码 lane: TDD 编码 + 测试生成
    UPDATE multica_workflow_node SET position_x = 120, sort_order = 0
      WHERE workflow_id = c_cos AND title = 'TDD 编码';
    UPDATE multica_workflow_node SET position_x = 512, sort_order = 1
      WHERE workflow_id = c_cos AND title = '测试生成';
    -- 集成验证 lane: 集成验证 + End
    UPDATE multica_workflow_node SET position_x = 120, sort_order = 0
      WHERE workflow_id = c_cos AND title = '集成验证';
    UPDATE multica_workflow_node SET position_x = 512, sort_order = 100
      WHERE workflow_id = c_cos AND format_schema->>'type' = 'end';
END $$;

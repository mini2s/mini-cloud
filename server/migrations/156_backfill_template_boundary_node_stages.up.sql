-- 156_backfill_template_boundary_node_stages.up.sql
-- The two seeded workflow templates parked their Start/End boundary nodes
-- outside any stage (stage_id NULL). Group Start with the first task node's
-- stage and End with the last task node's stage so the canvas renders each
-- boundary inside its adjoining stage.
--
-- Idempotent: re-running reassigns the same stages; safe to apply again.

DO $$
DECLARE
    c_demo     UUID := 'c0c00000-0000-4000-8000-000000000152'; -- 精简研发演示
    c_cospower UUID := 'c0c00000-0000-4000-8000-000000000145'; -- CosPower 全链路研发
    v_stage    UUID;
BEGIN
    -- Demo template: Start -> 方案设计 (first task node's stage).
    SELECT stage_id INTO v_stage FROM multica_workflow_node
    WHERE workflow_id = c_demo AND title = '方案设计';
    UPDATE multica_workflow_node SET stage_id = v_stage
    WHERE workflow_id = c_demo AND format_schema->>'type' = 'start';

    -- Demo template: End -> 编码开发 (last task node's stage).
    SELECT stage_id INTO v_stage FROM multica_workflow_node
    WHERE workflow_id = c_demo AND title = '编码开发';
    UPDATE multica_workflow_node SET stage_id = v_stage
    WHERE workflow_id = c_demo AND format_schema->>'type' = 'end';

    -- CosPower template: Start -> 需求分析 (first task node's stage).
    SELECT stage_id INTO v_stage FROM multica_workflow_node
    WHERE workflow_id = c_cospower AND title = '需求分析';
    UPDATE multica_workflow_node SET stage_id = v_stage
    WHERE workflow_id = c_cospower AND format_schema->>'type' = 'start';

    -- CosPower template: End -> 集成验证 (last task node's stage).
    SELECT stage_id INTO v_stage FROM multica_workflow_node
    WHERE workflow_id = c_cospower AND title = '集成验证';
    UPDATE multica_workflow_node SET stage_id = v_stage
    WHERE workflow_id = c_cospower AND format_schema->>'type' = 'end';
END $$;

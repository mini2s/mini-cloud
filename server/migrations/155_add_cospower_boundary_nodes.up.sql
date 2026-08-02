-- 155_add_cospower_boundary_nodes.up.sql
-- The CosPower template (migration 145) was seeded without start/end boundary
-- nodes. Add them so the template satisfies the boundary topology preflight
-- (start must have an outgoing edge, end must have an incoming edge) the same
-- way API-created workflows do. Follows the 148 patch pattern: a follow-up
-- migration that touches the 145 template directly, without editing 145's file.
--
-- Existing cloned instances are unaffected; only new clones pick up the boundaries.

DO $$
DECLARE
    c_wf UUID := 'c0c00000-0000-4000-8000-000000000145';
    v_start UUID;
    v_end   UUID;
    v_first UUID;
    v_last  UUID;
BEGIN
    SELECT id INTO v_first FROM multica_workflow_node WHERE workflow_id = c_wf AND title = '需求分析';
    SELECT id INTO v_last  FROM multica_workflow_node WHERE workflow_id = c_wf AND title = '集成验证';
    IF v_first IS NULL OR v_last IS NULL THEN
        RAISE NOTICE 'cospower template (145) missing expected end nodes; skipping boundary seed';
        RETURN;
    END IF;

    -- Start boundary node (at most one per workflow; partial unique index on
    -- format_schema->>'type' guards it).
    INSERT INTO multica_workflow_node (workflow_id, title, description, position_x, position_y, format_schema, worker_type, critic_type, sort_order)
    SELECT c_wf, 'Start', '工作流起点', -150, 100,
           '{"type":"start","shape":"pill","template_id":"workflow-start","template_category":"trigger"}'::jsonb,
           'human', 'human', -1
    WHERE NOT EXISTS (
        SELECT 1 FROM multica_workflow_node WHERE workflow_id = c_wf AND format_schema->>'type' = 'start'
    );
    SELECT id INTO v_start FROM multica_workflow_node WHERE workflow_id = c_wf AND format_schema->>'type' = 'start';

    -- End boundary node.
    INSERT INTO multica_workflow_node (workflow_id, title, description, position_x, position_y, format_schema, worker_type, critic_type, sort_order)
    SELECT c_wf, 'End', '工作流终点', 700, 800,
           '{"type":"end","shape":"pill","template_id":"workflow-end","template_category":"trigger"}'::jsonb,
           'human', 'human', 100
    WHERE NOT EXISTS (
        SELECT 1 FROM multica_workflow_node WHERE workflow_id = c_wf AND format_schema->>'type' = 'end'
    );
    SELECT id INTO v_end FROM multica_workflow_node WHERE workflow_id = c_wf AND format_schema->>'type' = 'end';

    -- Wire start -> first and last -> end (idempotent).
    INSERT INTO multica_workflow_edge (workflow_id, source_node_id, target_node_id)
    SELECT c_wf, v_start, v_first
    WHERE NOT EXISTS (
        SELECT 1 FROM multica_workflow_edge WHERE workflow_id = c_wf AND source_node_id = v_start AND target_node_id = v_first
    );

    INSERT INTO multica_workflow_edge (workflow_id, source_node_id, target_node_id)
    SELECT c_wf, v_last, v_end
    WHERE NOT EXISTS (
        SELECT 1 FROM multica_workflow_edge WHERE workflow_id = c_wf AND source_node_id = v_last AND target_node_id = v_end
    );
END $$;

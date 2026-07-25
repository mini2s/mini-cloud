-- 145_seed_cospower_workflow_template.up.sql
-- Seed the "CosPower 全链路研发" workflow template (lean 4-stage version).
-- multica_workflow.workspace_id is NOT NULL, and ListTemplates lists templates
-- globally, so the template is parked under a dedicated __system_templates__
-- workspace and is visible from every workspace.
--
-- 4 stages map to 4 CosPower plugins / role agents (任务拆解 folded into 方案设计,
-- 测试生成 folded into TDD 编码); 技术负责人 is the critic on every stage.

DO $$
DECLARE
    c_template_ws UUID := 'c0c00001-0000-4000-8000-000000000145';
    c_workflow_id UUID := 'c0c00000-0000-4000-8000-000000000145';
    c_pm     UUID := 'dd0683f4-d72c-4b49-8030-827f5b15df2e'; -- 产品经理
    c_arch   UUID := '5e2fccac-6257-4ea5-ac7a-a5d8a4765917'; -- 架构师
    c_dev    UUID := 'c0bea924-c78f-43b1-8d50-449ec3c6b4cf'; -- 研发工程师
    c_devops UUID := '24a981c1-6ea6-4eab-9225-a5fe3da64477'; -- DevOps 工程师
    c_tl     UUID := 'a6f5d437-93c2-4623-ba0a-bcbb5cb8d1a6'; -- 技术负责人 (critic)
    v_s1 UUID; v_s2 UUID; v_s3 UUID; v_s4 UUID;
    v_n1 UUID; v_n2 UUID; v_n3 UUID; v_n4 UUID;
BEGIN
    INSERT INTO multica_workspace (id, name, slug, description)
    VALUES (c_template_ws, '系统模板库', '__system_templates__', '内置工作流模板归属库')
    ON CONFLICT (id) DO NOTHING;

    -- idempotent: clear any prior seed for this template
    DELETE FROM multica_workflow_edge  WHERE workflow_id = c_workflow_id;
    DELETE FROM multica_workflow_node  WHERE workflow_id = c_workflow_id;
    DELETE FROM multica_workflow_stage WHERE workflow_id = c_workflow_id;
    DELETE FROM multica_workflow       WHERE id = c_workflow_id;

    INSERT INTO multica_workflow (id, workspace_id, title, description, status, max_retries, created_by_type, created_by_id, is_template)
    VALUES (c_workflow_id, c_template_ws, 'CosPower 全链路研发',
        '基于 CosPower 插件的研发全链路：产品经理 → 架构师 → 研发工程师 → DevOps 工程师，技术负责人全程审核。',
        'active', 3, 'system', NULL, TRUE);

    INSERT INTO multica_workflow_stage (workflow_id, name, description, sort_order) VALUES
        (c_workflow_id, '需求分析', 'cospowers-requirements：梳理需求，产出 PRD', 0),
        (c_workflow_id, '方案设计', 'cospowers-solution-design：架构 / 接口设计（含任务拆解）', 1),
        (c_workflow_id, 'TDD 编码', 'cospowers-tdd-development：测试驱动编码（含测试生成）', 2),
        (c_workflow_id, '集成验证', 'cospowers-integration-verification：集成与发布验证', 3);

    SELECT id INTO v_s1 FROM multica_workflow_stage WHERE workflow_id = c_workflow_id AND sort_order = 0;
    SELECT id INTO v_s2 FROM multica_workflow_stage WHERE workflow_id = c_workflow_id AND sort_order = 1;
    SELECT id INTO v_s3 FROM multica_workflow_stage WHERE workflow_id = c_workflow_id AND sort_order = 2;
    SELECT id INTO v_s4 FROM multica_workflow_stage WHERE workflow_id = c_workflow_id AND sort_order = 3;

    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_id, sort_order)
    VALUES (c_workflow_id, v_s1, '需求分析', '梳理产品需求，产出 PRD 文档与用户故事', 200, 100, 'agent', c_pm, 'agent', c_tl, 0)
    RETURNING id INTO v_n1;

    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_id, sort_order)
    VALUES (c_workflow_id, v_s2, '方案设计', '架构设计、接口定义与任务拆解', 200, 300, 'agent', c_arch, 'agent', c_tl, 0)
    RETURNING id INTO v_n2;

    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_id, sort_order)
    VALUES (c_workflow_id, v_s3, 'TDD 编码', '测试驱动开发，产出代码与单元测试', 200, 500, 'agent', c_dev, 'agent', c_tl, 0)
    RETURNING id INTO v_n3;

    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_id, sort_order)
    VALUES (c_workflow_id, v_s4, '集成验证', '集成联调与发布前验证', 200, 700, 'agent', c_devops, 'agent', c_tl, 0)
    RETURNING id INTO v_n4;

    -- sequential: 需求 → 设计 → 编码 → 集成
    INSERT INTO multica_workflow_edge (workflow_id, source_node_id, target_node_id) VALUES
        (c_workflow_id, v_n1, v_n2),
        (c_workflow_id, v_n2, v_n3),
        (c_workflow_id, v_n3, v_n4);
END $$;

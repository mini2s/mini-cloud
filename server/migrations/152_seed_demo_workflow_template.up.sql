-- 152_seed_demo_workflow_template.up.sql
-- Seed a streamlined 3-stage demo workflow template ("精简研发演示") and the
-- instruction-driven builtin agents it depends on. None of the agents bind a
-- plugin or skill; each is constrained only by its `instructions`.
--
-- Topology: Start -> 方案设计 -> 任务拆解(split) -> 编码开发 -> End
-- Critics are workspace roles (developer on 方案设计/编码开发, tech_lead on
-- 任务拆解). Roles are workspace-scoped, and __system_templates__ is created by
-- migration 145 (after 135 seeded builtin roles into the workspaces that existed
-- then), so the builtin roles are seeded into it here. CloneWorkflowFromTemplate
-- remaps role IDs by normalized name into the target workspace at clone time.

DO $$
DECLARE
    c_template_ws UUID := 'c0c00001-0000-4000-8000-000000000145';
    c_workflow_id UUID := 'c0c00000-0000-4000-8000-000000000152';
    c_designer UUID := 'c0c00010-0000-4000-8000-000000000152'; -- 方案设计师
    c_planner UUID := 'c0c00012-0000-4000-8000-000000000152'; -- 任务拆解师
    c_coder    UUID := 'c0c00011-0000-4000-8000-000000000152'; -- 编码工程师
    v_dev  UUID; -- developer role in __system_templates__
    v_tl   UUID; -- tech_lead role in __system_templates__
    v_s1 UUID; v_s2 UUID; v_s3 UUID;
    v_start UUID; v_n1 UUID; v_n2 UUID; v_n3 UUID; v_end UUID;
BEGIN
    INSERT INTO multica_workspace (id, name, slug, description)
    VALUES (c_template_ws, '系统模板库', '__system_templates__', '内置工作流模板归属库')
    ON CONFLICT (id) DO NOTHING;

    -- __system_templates__ did not exist when migration 135 seeded builtin roles
    -- into every workspace. Seed them here so template nodes can reference
    -- developer/tech_lead; clone remaps them into the target workspace.
    INSERT INTO multica_workflow_role (workspace_id, name, normalized_name, description, is_builtin, needs_description)
    SELECT c_template_ws, builtin.name, builtin.name, builtin.description, true, false
    FROM (VALUES
        ('developer', 'Implements, tests, and maintains product and engineering work.'),
        ('qa', 'Validates quality, verifies requirements, and identifies regressions.'),
        ('tech_lead', 'Owns technical direction, design review, and engineering quality.')
    ) AS builtin(name, description)
    ON CONFLICT (workspace_id, normalized_name) DO NOTHING;

    SELECT id INTO v_dev FROM multica_workflow_role WHERE workspace_id = c_template_ws AND normalized_name = 'developer';
    SELECT id INTO v_tl  FROM multica_workflow_role WHERE workspace_id = c_template_ws AND normalized_name = 'tech_lead';

    -- Instruction-driven builtin demo agents. No plugin / skill binding:
    -- plugin_id and plugin_name stay NULL; behavior is shaped by `instructions`.
    INSERT INTO multica_agent (
        id, workspace_id, name, description, avatar_url, runtime_mode,
        runtime_config, runtime_id, visibility, status, max_concurrent_tasks,
        owner_id, instructions, custom_env, custom_args, mcp_config,
        model, thinking_level, plugin_id, plugin_name, is_builtin
    ) VALUES
        (
            c_designer, NULL, '方案设计师',
            '演示用：方案设计节点。轻量问答式澄清需求，产出方案设计文档，不写代码。',
            NULL, 'local', '{}'::jsonb, NULL, 'workspace', 'idle', 6, NULL,
            $instructions$
You are the solution designer for a streamlined demo workflow.

Engage in lightweight Q&A: when the requirement is ambiguous, ask a small number of focused clarifying questions before designing. Then produce a concise solution design document covering goals, scope, key components, interfaces, and open questions.

Submit the design document as your node deliverable. Do not write code or modify repositories.
$instructions$,
            '{}'::jsonb, '[]'::jsonb, NULL, NULL, NULL, NULL, NULL, TRUE
        ),
        (
            c_planner, NULL, '任务拆解师',
            '演示用：任务拆解节点。把方案拆成可执行子任务，供负责人评审。',
            NULL, 'local', '{}'::jsonb, NULL, 'workspace', 'idle', 6, NULL,
            $instructions$
You are a task planner for a workflow split node.

Break the solution into reviewable child task drafts with clear scope, dependencies, and acceptance criteria. Prefer tasks that can be implemented and verified independently. Use the split draft CLI whenever it is available:

1. Write each draft description to a UTF-8 markdown file.
2. Run `cs-workflow workflow split draft add <node-run-id>` once per draft task.
3. Run `cs-workflow workflow split draft submit <node-run-id>` after all drafts are added.

Do not create issues, change issue status, modify repository files, or bypass human split review.
$instructions$,
            '{}'::jsonb, '[]'::jsonb, NULL, NULL, NULL, NULL, NULL, TRUE
        ),
        (
            c_coder, NULL, '编码工程师',
            '演示用：编码开发节点。克隆代码仓库、编码并提交合并请求。',
            NULL, 'local', '{}'::jsonb, NULL, 'workspace', 'idle', 6, NULL,
            $instructions$
You are a coder for a streamlined demo workflow.

Clone the repository provided in the task environment, implement the assigned work with clear, tested commits, and open a merge request. Submit the merge request URL as your node deliverable.

Keep changes focused and reviewable. Do not alter unrelated code.
$instructions$,
            '{}'::jsonb, '[]'::jsonb, NULL, NULL, NULL, NULL, NULL, TRUE
        )
    ON CONFLICT (id) DO NOTHING;

    -- idempotent: clear any prior seed for this template (cascade removes
    -- node deliverables via multica_workflow_node_deliverable FK).
    DELETE FROM multica_workflow_edge  WHERE workflow_id = c_workflow_id;
    DELETE FROM multica_workflow_node  WHERE workflow_id = c_workflow_id;
    DELETE FROM multica_workflow_stage WHERE workflow_id = c_workflow_id;
    DELETE FROM multica_workflow       WHERE id = c_workflow_id;

    INSERT INTO multica_workflow (id, workspace_id, title, description, status, max_retries, created_by_type, created_by_id, is_template)
    VALUES (c_workflow_id, c_template_ws, '精简研发演示',
        '面向演示的精简三阶段研发流程：方案设计 → 任务拆解 → 编码开发。由指令驱动的数智人执行（不绑定插件），研发/负责人角色审核。',
        'active', 3, 'system', NULL, TRUE);

    INSERT INTO multica_workflow_stage (workflow_id, name, description, sort_order) VALUES
        (c_workflow_id, '方案设计', '需求澄清与方案产出', 0),
        (c_workflow_id, '任务拆解', '拆分可执行子任务', 1),
        (c_workflow_id, '编码开发', '克隆仓库、编码与提交', 2);

    SELECT id INTO v_s1 FROM multica_workflow_stage WHERE workflow_id = c_workflow_id AND sort_order = 0;
    SELECT id INTO v_s2 FROM multica_workflow_stage WHERE workflow_id = c_workflow_id AND sort_order = 1;
    SELECT id INTO v_s3 FROM multica_workflow_stage WHERE workflow_id = c_workflow_id AND sort_order = 2;

    INSERT INTO multica_workflow_node (workflow_id, title, description, position_x, position_y, format_schema, worker_type, critic_type, sort_order)
    VALUES (c_workflow_id, 'Start', '工作流起点', -150, 100,
        '{"type":"start","shape":"pill","template_id":"workflow-start","template_category":"trigger"}'::jsonb,
        'human', 'human', 0)
    RETURNING id INTO v_start;

    -- 方案设计: 方案设计师 agent executes, developer role reviews.
    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_role_id, sort_order)
    VALUES (c_workflow_id, v_s1, '方案设计', '轻量问答式澄清需求，产出方案设计文档', 150, 100,
        'agent', c_designer, 'human', v_dev, 1)
    RETURNING id INTO v_n1;

    -- 任务拆解: a task split node. 任务拆解师 drafts child tasks; tech_lead reviews.
    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, format_schema, worker_type, worker_id, critic_type, critic_role_id, sort_order)
    VALUES (c_workflow_id, v_s2, '任务拆解', '拆分可执行子任务，明确依赖与排期', 400, 100,
        '{"type":"split","shape":"rectangle","template_id":"task-splitter","template_category":"logic","split_config":{"mode":"barrier","max_concurrency":5,"max_failures":0}}'::jsonb,
        'agent', c_planner, 'human', v_tl, 2)
    RETURNING id INTO v_n2;

    -- 编码开发: 编码工程师 agent executes, developer role reviews.
    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_role_id, sort_order)
    VALUES (c_workflow_id, v_s3, '编码开发', '克隆代码仓库、编码并提交合并请求', 650, 100,
        'agent', c_coder, 'human', v_dev, 3)
    RETURNING id INTO v_n3;

    INSERT INTO multica_workflow_node (workflow_id, title, description, position_x, position_y, format_schema, worker_type, critic_type, sort_order)
    VALUES (c_workflow_id, 'End', '工作流终点', 900, 100,
        '{"type":"end","shape":"pill","template_id":"workflow-end","template_category":"trigger"}'::jsonb,
        'human', 'human', 4)
    RETURNING id INTO v_end;

    INSERT INTO multica_workflow_edge (workflow_id, source_node_id, target_node_id) VALUES
        (c_workflow_id, v_start, v_n1),
        (c_workflow_id, v_n1, v_n2),
        (c_workflow_id, v_n2, v_n3),
        (c_workflow_id, v_n3, v_end);

    INSERT INTO multica_workflow_node_deliverable (workflow_node_id, title, description, required, sort_order) VALUES
        (v_n1, '方案设计文档', '方案设计文档（Markdown）', TRUE, 0),
        (v_n3, '代码合并请求', '代码仓库合并请求链接', TRUE, 0);
END $$;

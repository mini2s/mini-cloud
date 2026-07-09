-- =============================================================================
-- 全量工作流执行数据种子脚本
-- 覆盖 /docs/workflows/企业编程协作平台-用户旅程-工作流.md 的全部场景
--
-- 工作流 UUID: 028f13ec-8d4d-49af-907d-7de306f6a2a2
-- 工作区: demo111 (060af83b-5958-478b-9656-b923bc965bc8)
--
-- 覆盖场景:
--   [3. 查看工作流执行情况]
--     3.2-a 阶段信息: 6个阶段
--     3.2-b 连线情况: 串行+并行
--     3.2-c 节点元数据: human/agent/squad/role worker + critic
--     3.2-c 运行状态: pending/working/awaiting_critic/completed/blocked/failed
--     3.2-c 交付物信号: green(yellow)/red
--     3.2-c 执行耗时: started_at/completed_at
--     3.2-d 进入会话(agent): session_id绑定
--     3.2-d 重试: retry_count>0
--     3.3 会话空间: chat_session + messages
--     3.4 节点Issue详情: 子issue
--   [4.1.1 人执行者] human worker处理+提交交付物
--   [4.1.2.1 agent正常执行] completed状态
--   [4.1.2.2 agent失败] failed/blocked状态
--   [4.1.2.3 agent纠偏] blocked+session接管交还
--   [4.1.2.4 头脑风暴] blocked+session+brainstorm
--   [4.1.2.5 任务分配] squad节点拆解
--   [4.1.2.6 代码提交] PR交付物
--   [4.1.3 小队执行者] squad worker + leader agent
--   [4.2.1 人评审者] human critic approve/reject
--   [4.2.2 agent评审者] agent auto-review
--   [4.2.3 小队评审者] squad critic
-- =============================================================================

DO $$
DECLARE
    -- ═══ 预定义常量 ═══
    c_workspace_id UUID := '060af83b-5958-478b-9656-b923bc965bc8';
    c_user_id UUID := 'db5dfe43-50ce-416d-9ff0-440ee7138534';
    c_member_id UUID := '3b91177b-06bc-43ba-ab51-1e34b2a3131a';
    c_workflow_id UUID := '028f13ec-8d4d-49af-907d-7de306f6a2a2';

    -- Runtimes
    c_rt_claude UUID := 'a6456987-922a-4703-b5c6-d1da74848300';
    c_rt_csc UUID := '22e0ddff-13f3-4aef-80c8-7681ee9778df';
    c_rt_codex UUID := '425e9ea6-9744-4dc3-88b0-1b43a1334a69';

    -- Agents
    c_ag_brain_stormer UUID := '38d8d56f-699c-434a-9137-995449f2b30d';
    c_ag_req_analyzer UUID := '0e5b5e66-aa0a-457f-9c4e-c65e50d800d2';
    c_ag_arch_designer UUID := '2e25710a-1ca5-4d1d-86db-435242b85367';
    c_ag_code_dev UUID := '320436db-37ef-4356-8e64-80d8ccb98850';
    c_ag_test_runner UUID := '78a22c64-6353-4de1-94c7-f205da96914b';
    c_ag_code_reviewer UUID := '16fe9aa6-8af2-48f5-bd50-846f3056fb59';
    c_ag_aireq_evaluator UUID := 'c9e49429-58d3-4e25-b60c-0cf05897c865';
    c_ag_sysreq_evaluator UUID := 'f045b15e-41e4-42cc-a7cd-dfb7d049722a';

    -- ═══ 阶段 ID ═══
    v_stage_intake UUID;
    v_stage_analysis UUID;
    v_stage_design UUID;
    v_stage_impl UUID;
    v_stage_testing UUID;
    v_stage_release UUID;

    -- ═══ 节点 ID ═══
    v_node_brainstorm UUID;        -- 1. agent worker, human critic → completed
    v_node_req_doc UUID;           -- 2. agent worker, agent critic → awaiting_critic
    v_node_req_analysis UUID;      -- 3. agent worker, agent evaluator → working
    v_node_sys_req UUID;           -- 4. agent worker, agent critic → blocked
    v_node_req_review UUID;        -- 5. CRITIC NODE → critic_reviewing
    v_node_arch_design UUID;       -- 6. agent worker, squad critic → pending
    v_node_api_design UUID;        -- 7. human worker, agent critic → completed
    v_node_db_design UUID;         -- 8. agent worker, human critic → pending
    v_node_frontend UUID;          -- 9. agent worker, agent critic → completed (PR deliverable)
    v_node_backend UUID;           -- 10. agent worker, agent critic → failed
    v_node_agent_dev UUID;         -- 11. agent worker, agent critic → working (retry)
    v_node_integration UUID;       -- 12. squad worker, human critic → pending
    v_node_unit_test UUID;         -- 13. agent worker, agent critic → completed
    v_node_e2e_test UUID;          -- 14. agent worker, agent reviewer → completed
    v_node_perf_test UUID;         -- 15. agent worker, api critic → awaiting_critic
    v_node_pre_release UUID;       -- 16. squad worker, human critic → pending
    v_node_prod_deploy UUID;       -- 17. human worker, human critic → pending

    -- ═══ Issue ID ═══
    v_parent_issue_id UUID;
    v_sub_issue_ids UUID[];

    -- ═══ Run ID ═══
    v_run_id UUID;

    -- ═══ Node Run ID ═══
    v_nr_brainstorm UUID;
    v_nr_req_doc UUID;
    v_nr_req_analysis UUID;
    v_nr_sys_req UUID;
    v_nr_req_review UUID;
    v_nr_arch_design UUID;
    v_nr_api_design UUID;
    v_nr_db_design UUID;
    v_nr_frontend UUID;
    v_nr_backend UUID;
    v_nr_agent_dev UUID;
    v_nr_integration UUID;
    v_nr_unit_test UUID;
    v_nr_e2e_test UUID;
    v_nr_perf_test UUID;
    v_nr_pre_release UUID;
    v_nr_prod_deploy UUID;

    -- ═══ Deliverable ID ═══
    v_deliv_brainstorm_doc UUID;
    v_deliv_req_doc_spec UUID;
    v_deliv_req_analysis_doc UUID;
    v_deliv_req_review_doc UUID;
    v_deliv_sys_req_spec UUID;
    v_deliv_arch_design_doc UUID;
    v_deliv_api_design_doc UUID;
    v_deliv_db_design_doc UUID;
    v_deliv_frontend_pr UUID;
    v_deliv_backend_pr UUID;
    v_deliv_agent_dev_pr UUID;
    v_deliv_integration_pr UUID;
    v_deliv_unit_test_report UUID;
    v_deliv_e2e_test_report UUID;
    v_deliv_perf_test_report UUID;
    v_deliv_pre_release_checklist UUID;
    v_deliv_prod_deploy_log UUID;

    -- ═══ Agent Task ID ═══
    v_task_brainstorm UUID;
    v_task_req_doc UUID;
    v_task_req_analysis UUID;
    v_task_sys_req UUID;
    v_task_frontend UUID;
    v_task_backend UUID;
    v_task_backend_retry UUID;
    v_task_agent_dev UUID;
    v_task_unit_test UUID;
    v_task_e2e_test UUID;
    v_task_perf_test UUID;

    -- ═══ Chat Session ID ═══
    v_chat_session_brainstorm UUID;
    v_chat_session_fix UUID;

    v_issue_seq INT;

BEGIN
    -- ═════════════════════════════════════════════════════════════════════
    -- 清理已有数据
    -- ═════════════════════════════════════════════════════════════════════
    DELETE FROM multica_activity_log WHERE issue_id IN (
        SELECT id FROM multica_issue WHERE workflow_id = c_workflow_id
    );
    DELETE FROM multica_comment WHERE issue_id IN (
        SELECT id FROM multica_issue WHERE workflow_id = c_workflow_id
    );
    DELETE FROM multica_agent_task_queue WHERE workflow_node_run_id IN (
        SELECT id FROM multica_workflow_node_run WHERE workflow_run_id IN (
            SELECT id FROM multica_workflow_run WHERE workflow_id = c_workflow_id
        )
    );
    DELETE FROM multica_chat_message WHERE chat_session_id IN (
        SELECT id FROM multica_chat_session WHERE workspace_id = c_workspace_id
        AND id IN (
            SELECT cs.id FROM multica_chat_session cs
            WHERE cs.workspace_id = c_workspace_id
        )
    );
    DELETE FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id IN (
        SELECT id FROM multica_workflow_node_run WHERE workflow_run_id IN (
            SELECT id FROM multica_workflow_run WHERE workflow_id = c_workflow_id
        )
    );
    DELETE FROM multica_workflow_node_deliverable WHERE workflow_node_id IN (
        SELECT id FROM multica_workflow_node WHERE workflow_id = c_workflow_id
    );
    DELETE FROM multica_workflow_node_run WHERE workflow_run_id IN (
        SELECT id FROM multica_workflow_run WHERE workflow_id = c_workflow_id
    );
    DELETE FROM multica_workflow_run WHERE workflow_id = c_workflow_id;
    DELETE FROM multica_issue WHERE workflow_id = c_workflow_id;
    DELETE FROM multica_workflow_edge WHERE workflow_id = c_workflow_id;
    DELETE FROM multica_workflow_node WHERE workflow_id = c_workflow_id;
    DELETE FROM multica_workflow_stage WHERE workflow_id = c_workflow_id;
    DELETE FROM multica_workflow WHERE id = c_workflow_id;

    -- ═════════════════════════════════════════════════════════════════════
    -- 1. 创建工作流
    -- ═════════════════════════════════════════════════════════════════════
    INSERT INTO multica_workflow (
        id, workspace_id, title, description, status, max_retries,
        created_by_type, created_by_id, is_template, source_template_id
    ) VALUES (
        c_workflow_id, c_workspace_id,
        '全栈研发工作流 (全量测试)',
        '覆盖用户旅程文档中所有工作流执行场景的测试工作流，包含人/智能体/小队执行者与评审者的全部组合',
        'active', 3,
        'member', c_user_id, FALSE, NULL
    );

    -- ═════════════════════════════════════════════════════════════════════
    -- 2. 创建阶段 (6个)
    -- ═════════════════════════════════════════════════════════════════════
    INSERT INTO multica_workflow_stage (workflow_id, name, description, sort_order)
    VALUES
        (c_workflow_id, '需求接入', '收集和整理初始需求，头脑风暴', 0),
        (c_workflow_id, '需求分析', '结构化需求分析，输出需求规格', 1),
        (c_workflow_id, '技术设计', '架构设计、API设计、数据库设计', 2),
        (c_workflow_id, '编码实现', '前后端与智能体开发、代码整合', 3),
        (c_workflow_id, '测试验证', '单元测试、E2E测试、性能测试', 4),
        (c_workflow_id, '发布上线', '预发布检查与生产部署', 5);

    SELECT id INTO v_stage_intake FROM multica_workflow_stage WHERE workflow_id = c_workflow_id AND sort_order = 0;
    SELECT id INTO v_stage_analysis FROM multica_workflow_stage WHERE workflow_id = c_workflow_id AND sort_order = 1;
    SELECT id INTO v_stage_design FROM multica_workflow_stage WHERE workflow_id = c_workflow_id AND sort_order = 2;
    SELECT id INTO v_stage_impl FROM multica_workflow_stage WHERE workflow_id = c_workflow_id AND sort_order = 3;
    SELECT id INTO v_stage_testing FROM multica_workflow_stage WHERE workflow_id = c_workflow_id AND sort_order = 4;
    SELECT id INTO v_stage_release FROM multica_workflow_stage WHERE workflow_id = c_workflow_id AND sort_order = 5;

    -- ═════════════════════════════════════════════════════════════════════
    -- 3. 创建节点 (17个，覆盖所有 worker/critic 组合)
    --
    -- worker_type: human / agent / squad
    -- critic_type: human / agent / squad / api
    -- ═════════════════════════════════════════════════════════════════════

    -- ── 阶段1: 需求接入 ──
    -- 节点1: agent worker + human critic (正常执行 → completed)
    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_id, sort_order)
    VALUES (c_workflow_id, v_stage_intake, '需求头脑风暴', '通过Brain Stormer智能体进行需求头脑风暴，收集和扩展早期想法', 150, 120, 'agent', c_ag_brain_stormer, 'human', c_user_id, 0)
    RETURNING id INTO v_node_brainstorm;

    -- 节点2: agent worker + agent critic (待评审 → awaiting_critic)
    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_id, sort_order)
    VALUES (c_workflow_id, v_stage_intake, '需求文档整理', '将头脑风暴结果整理为结构化需求文档', 450, 120, 'agent', c_ag_req_analyzer, 'agent', c_ag_code_reviewer, 1)
    RETURNING id INTO v_node_req_doc;

    -- ── 阶段2: 需求分析 ──
    -- 节点3: agent worker + agent evaluator (执行中 → working)
    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_id, sort_order)
    VALUES (c_workflow_id, v_stage_analysis, '需求分析', '深入分析需求，识别功能点和非功能需求', 150, 380, 'agent', c_ag_req_analyzer, 'agent', c_ag_aireq_evaluator, 0)
    RETURNING id INTO v_node_req_analysis;

    -- 节点4: agent worker + agent critic (已阻塞 → blocked - 头脑风暴场景)
    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_id, sort_order)
    VALUES (c_workflow_id, v_stage_analysis, '系统需求规格', '编写详细的系统需求规格说明书', 450, 380, 'agent', c_ag_req_analyzer, 'agent', c_ag_sysreq_evaluator, 1)
    RETURNING id INTO v_node_sys_req;

    -- 节点5: CRITIC NODE — agent worker (evaluator) + agent critic (reviewer) → critic_reviewing
    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_id, sort_order)
    VALUES (c_workflow_id, v_stage_analysis, 'AI需求评估', 'AI智能体对需求文档进行自动评估，检查完整性和一致性', 150, 600, 'agent', c_ag_aireq_evaluator, 'agent', c_ag_code_reviewer, 2)
    RETURNING id INTO v_node_req_review;

    -- ── 阶段3: 技术设计 ──
    -- 节点6: agent worker + squad critic (待办 → pending)
    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_id, sort_order)
    VALUES (c_workflow_id, v_stage_design, '架构设计', '设计系统整体架构，包括模块划分和技术选型', 150, 860, 'agent', c_ag_arch_designer, 'squad', NULL, 0)
    RETURNING id INTO v_node_arch_design;

    -- 节点7: human worker + agent critic (已完成 → completed - 人工执行场景)
    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_id, sort_order)
    VALUES (c_workflow_id, v_stage_design, 'API设计', '设计RESTful API接口，定义请求/响应格式', 450, 860, 'human', c_user_id, 'agent', c_ag_code_reviewer, 1)
    RETURNING id INTO v_node_api_design;

    -- 节点8: agent worker + human critic (待办 → pending)
    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_id, sort_order)
    VALUES (c_workflow_id, v_stage_design, '数据库设计', '设计数据库表结构和索引策略', 750, 860, 'agent', c_ag_arch_designer, 'human', c_user_id, 2)
    RETURNING id INTO v_node_db_design;

    -- ── 阶段4: 编码实现 ──
    -- 节点9: agent worker + agent critic (已完成 → completed - PR交付物)
    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_id, sort_order)
    VALUES (c_workflow_id, v_stage_impl, '前端开发', '实现前端UI组件和页面交互', 150, 1120, 'agent', c_ag_code_dev, 'agent', c_ag_code_reviewer, 0)
    RETURNING id INTO v_node_frontend;

    -- 节点10: agent worker + agent critic (失败 → failed)
    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_id, sort_order)
    VALUES (c_workflow_id, v_stage_impl, '后端开发', '实现后端API和业务逻辑', 450, 1120, 'agent', c_ag_code_dev, 'agent', c_ag_code_reviewer, 1)
    RETURNING id INTO v_node_backend;

    -- 节点11: agent worker + agent critic (进行中 → working + retry_count>0)
    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_id, sort_order)
    VALUES (c_workflow_id, v_stage_impl, '智能体开发', '开发AI智能体的工具和提示词', 750, 1120, 'agent', c_ag_code_dev, 'agent', c_ag_code_reviewer, 2)
    RETURNING id INTO v_node_agent_dev;

    -- 节点12: squad worker + human critic → pending (小队执行场景)
    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_id, sort_order)
    VALUES (c_workflow_id, v_stage_impl, '代码整合', '整合所有开发分支，解决合并冲突', 1050, 1120, 'squad', NULL, 'human', c_user_id, 3)
    RETURNING id INTO v_node_integration;

    -- ── 阶段5: 测试验证 ──
    -- 节点13: agent worker + agent critic (已完成 → completed)
    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_id, sort_order)
    VALUES (c_workflow_id, v_stage_testing, '单元测试', '编写和执行单元测试，确保代码质量', 150, 1380, 'agent', c_ag_test_runner, 'agent', c_ag_code_reviewer, 0)
    RETURNING id INTO v_node_unit_test;

    -- 节点14: agent worker + agent reviewer critic (已完成 → completed - agent评审场景)
    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_id, sort_order)
    VALUES (c_workflow_id, v_stage_testing, 'E2E测试', '端到端自动化测试，验证完整用户流程', 450, 1380, 'agent', c_ag_test_runner, 'agent', c_ag_code_reviewer, 1)
    RETURNING id INTO v_node_e2e_test;

    -- 节点15: agent worker + api critic (待评审 → awaiting_critic)
    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_id, critic_api_url, sort_order)
    VALUES (c_workflow_id, v_stage_testing, '性能测试', '性能基准测试和压力测试', 750, 1380, 'agent', c_ag_test_runner, 'api', NULL, 'https://api.example.com/perf-check', 2)
    RETURNING id INTO v_node_perf_test;

    -- ── 阶段6: 发布上线 ──
    -- 节点16: squad worker + human critic (待办 → pending)
    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_id, sort_order)
    VALUES (c_workflow_id, v_stage_release, '预发布检查', '检查发布清单，确认所有前置条件满足', 150, 1640, 'squad', NULL, 'human', c_user_id, 0)
    RETURNING id INTO v_node_pre_release;

    -- 节点17: human worker + human critic (待办 → pending - 人工执行+人工评审)
    INSERT INTO multica_workflow_node (workflow_id, stage_id, title, description, position_x, position_y, worker_type, worker_id, critic_type, critic_id, sort_order)
    VALUES (c_workflow_id, v_stage_release, '生产部署', '执行生产环境部署，监控上线状态', 450, 1640, 'human', c_user_id, 'human', c_user_id, 1)
    RETURNING id INTO v_node_prod_deploy;

    -- ═════════════════════════════════════════════════════════════════════
    -- 4. 创建连线 (串行+并行)
    -- ═════════════════════════════════════════════════════════════════════
    -- 需求接入阶段内: brainstorm → req_doc
    INSERT INTO multica_workflow_edge (workflow_id, source_node_id, target_node_id)
    VALUES (c_workflow_id, v_node_brainstorm, v_node_req_doc);

    -- 跨阶段: req_doc → req_analysis, sys_req
    INSERT INTO multica_workflow_edge (workflow_id, source_node_id, target_node_id)
    VALUES
        (c_workflow_id, v_node_req_doc, v_node_req_analysis),
        (c_workflow_id, v_node_req_doc, v_node_sys_req);  -- 并行

    -- 需求分析阶段内: req_analysis → sys_req
    INSERT INTO multica_workflow_edge (workflow_id, source_node_id, target_node_id)
    VALUES (c_workflow_id, v_node_req_analysis, v_node_req_review);

    -- 跨阶段: sys_req → arch_design, api_design, db_design (并行)
    INSERT INTO multica_workflow_edge (workflow_id, source_node_id, target_node_id)
    VALUES
        (c_workflow_id, v_node_sys_req, v_node_arch_design),
        (c_workflow_id, v_node_sys_req, v_node_api_design),
        (c_workflow_id, v_node_sys_req, v_node_db_design);

    -- 跨阶段: arch_design, api_design, db_design → frontend
    INSERT INTO multica_workflow_edge (workflow_id, source_node_id, target_node_id)
    VALUES
        (c_workflow_id, v_node_arch_design, v_node_frontend),
        (c_workflow_id, v_node_api_design, v_node_frontend),
        (c_workflow_id, v_node_db_design, v_node_frontend);

    -- 编码实现阶段内: frontend → backend → agent_dev → integration
    INSERT INTO multica_workflow_edge (workflow_id, source_node_id, target_node_id)
    VALUES
        (c_workflow_id, v_node_frontend, v_node_backend),
        (c_workflow_id, v_node_backend, v_node_agent_dev),
        (c_workflow_id, v_node_agent_dev, v_node_integration);

    -- 跨阶段: integration → unit_test, e2e_test, perf_test (并行)
    INSERT INTO multica_workflow_edge (workflow_id, source_node_id, target_node_id)
    VALUES
        (c_workflow_id, v_node_integration, v_node_unit_test),
        (c_workflow_id, v_node_integration, v_node_e2e_test),
        (c_workflow_id, v_node_integration, v_node_perf_test);

    -- 跨阶段: unit_test, e2e_test, perf_test → pre_release
    INSERT INTO multica_workflow_edge (workflow_id, source_node_id, target_node_id)
    VALUES
        (c_workflow_id, v_node_unit_test, v_node_pre_release),
        (c_workflow_id, v_node_e2e_test, v_node_pre_release),
        (c_workflow_id, v_node_perf_test, v_node_pre_release);

    -- 发布上线阶段内: pre_release → prod_deploy
    INSERT INTO multica_workflow_edge (workflow_id, source_node_id, target_node_id)
    VALUES (c_workflow_id, v_node_pre_release, v_node_prod_deploy);

    -- ═════════════════════════════════════════════════════════════════════
    -- 5. 创建交付物定义 (每个节点至少1个)
    -- ═════════════════════════════════════════════════════════════════════
    -- 需求接入
    INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order)
    VALUES (v_node_brainstorm, 'document', '头脑风暴记录', '需求头脑风暴的完整记录文档', TRUE, 0)
    RETURNING id INTO v_deliv_brainstorm_doc;

    INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order)
    VALUES (v_node_req_doc, 'document', '需求文档初稿', '结构化需求文档', TRUE, 0)
    RETURNING id INTO v_deliv_req_doc_spec;

    -- 需求分析
    INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order)
    VALUES (v_node_req_analysis, 'document', '需求分析报告', '详细的需求分析报告，包含功能点和验收标准', TRUE, 0)
    RETURNING id INTO v_deliv_req_analysis_doc;

    INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order)
    VALUES (v_node_sys_req, 'document', '系统需求规格说明书', '系统级需求规格', TRUE, 0)
    RETURNING id INTO v_deliv_sys_req_spec;

    INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order)
    VALUES (v_node_req_review, 'document', '需求评估报告', 'AI对需求的完整性和一致性评估', TRUE, 0)
    RETURNING id INTO v_deliv_req_review_doc;

    -- 技术设计
    INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order)
    VALUES (v_node_arch_design, 'document', '架构设计文档', '系统架构设计说明书', TRUE, 0)
    RETURNING id INTO v_deliv_arch_design_doc;

    INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order)
    VALUES (v_node_api_design, 'document', 'API设计文档', 'RESTful API接口规范', TRUE, 0)
    RETURNING id INTO v_deliv_api_design_doc;

    INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order)
    VALUES (v_node_db_design, 'document', '数据库设计文档', 'ER图和表结构设计', TRUE, 0)
    RETURNING id INTO v_deliv_db_design_doc;

    -- 编码实现 (PR类型交付物)
    INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order)
    VALUES (v_node_frontend, 'pull_request', '前端PR', '前端代码变更Pull Request', TRUE, 0)
    RETURNING id INTO v_deliv_frontend_pr;

    INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order)
    VALUES (v_node_backend, 'pull_request', '后端PR', '后端代码变更Pull Request', TRUE, 0)
    RETURNING id INTO v_deliv_backend_pr;

    INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order)
    VALUES (v_node_agent_dev, 'pull_request', '智能体PR', '智能体代码变更Pull Request', TRUE, 0)
    RETURNING id INTO v_deliv_agent_dev_pr;

    INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order)
    VALUES (v_node_integration, 'pull_request', '整合PR', '代码整合Pull Request', TRUE, 0)
    RETURNING id INTO v_deliv_integration_pr;

    -- 测试验证
    INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order)
    VALUES (v_node_unit_test, 'document', '单元测试报告', '单元测试覆盖率和结果报告', TRUE, 0)
    RETURNING id INTO v_deliv_unit_test_report;

    INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order)
    VALUES (v_node_e2e_test, 'document', 'E2E测试报告', '端到端测试结果报告', TRUE, 0)
    RETURNING id INTO v_deliv_e2e_test_report;

    INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order)
    VALUES (v_node_perf_test, 'document', '性能测试报告', '性能基准和压力测试结果', TRUE, 0)
    RETURNING id INTO v_deliv_perf_test_report;

    -- 发布上线
    INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order)
    VALUES (v_node_pre_release, 'document', '发布检查清单', '预发布检查项清单', TRUE, 0)
    RETURNING id INTO v_deliv_pre_release_checklist;

    INSERT INTO multica_workflow_node_deliverable (workflow_node_id, kind, title, description, required, sort_order)
    VALUES (v_node_prod_deploy, 'document', '部署日志', '生产部署执行日志', TRUE, 0)
    RETURNING id INTO v_deliv_prod_deploy_log;

    -- ═════════════════════════════════════════════════════════════════════
    -- 6. 创建父 Issue (用户视角的主 Issue)
    -- 注意: number 需显式赋值，因为 Go 应用负责分配编号，SQL直接插入需手动递增
    -- ═════════════════════════════════════════════════════════════════════

    -- 获取下一个可用的 issue number
    SELECT COALESCE(MAX(number), 0) + 1 INTO v_issue_seq
    FROM multica_issue WHERE workspace_id = c_workspace_id;

    INSERT INTO multica_issue (
            workspace_id, title, description, status, priority, number,
            assignee_type, assignee_id, creator_type, creator_id,
            workflow_id, start_date, due_date
        ) VALUES (
            c_workspace_id,
            '【全量测试】全栈Web应用研发 v3.0',
            '这是一个覆盖工作流执行全部场景的测试Issue。\n\n包含场景：\n- 所有运行状态（待规划/待办/进行中/审核中/已完成/已阻塞/已失败）\n- 所有执行者类型（人/智能体/小队）\n- 所有评审者类型（人/智能体/小队/API）\n- 交付物红绿灯状态\n- 智能体会话交互\n- 任务重试与失败',
            'in_progress', 'high', v_issue_seq,
            'workflow', c_workflow_id, 'member', c_user_id,
            c_workflow_id,
            NOW() - INTERVAL '7 days',
            NOW() + INTERVAL '7 days'
        ) RETURNING id INTO v_parent_issue_id;

    -- ═════════════════════════════════════════════════════════════════════
    -- 7. 创建 Workflow Run
    -- ═════════════════════════════════════════════════════════════════════
    INSERT INTO multica_workflow_run (
        workflow_id, workspace_id, workflow_title, status,
        triggered_by_type, triggered_by_id, input, runtime_id
    ) VALUES (
        c_workflow_id, c_workspace_id,
        '全栈研发工作流 (全量测试)',
        'running',
        'member', c_user_id,
        '{"title":"【全量测试】全栈Web应用研发 v3.0","description":"覆盖工作流执行全部场景"}',
        c_rt_claude
    ) RETURNING id INTO v_run_id;

    -- 更新父 Issue 的 workflow_run_id
    UPDATE multica_issue SET workflow_run_id = v_run_id WHERE id = v_parent_issue_id;

    -- ═════════════════════════════════════════════════════════════════════
    -- 8. 创建 Node Runs (覆盖所有状态)
    --
    -- 状态映射 (来自 docs/workflows/企业编程协作平台-用户旅程-工作流.md):
    --   待规划 → pending
    --   待办   → worker_assigned
    --   进行中 → working
    --   审核中 → awaiting_critic / critic_reviewing
    --   已完成 → completed / critic_approved
    --   已阻塞 → blocked
    --   已失败 → failed
    -- ═════════════════════════════════════════════════════════════════════

    -- ── 8.1 已完成节点 (completed) ──
    -- 节点1: 需求头脑风暴 — agent正常执行完成 [4.1.2.1]
    INSERT INTO multica_workflow_node_run (
        workflow_run_id, workflow_node_id, node_title, status,
        worker_type, worker_id, worker_output,
        critic_type, critic_id, critic_output, critic_comment,
        retry_count, runtime_id, device_id, session_id,
        started_at, completed_at
    ) VALUES (
        v_run_id, v_node_brainstorm, '需求头脑风暴', 'completed',
        'agent', c_ag_brain_stormer,
        '{"summary":"完成了需求头脑风暴，识别出5个核心功能模块","ideas":["用户认证","任务管理","AI协作","实时通知","数据报表"],"confidence":0.85}',
        'human', c_user_id,
        '{"approved":true,"score":4}', '思路清晰，覆盖面广，可以进入下一阶段',
        0, c_rt_claude, 'device-claude', 'session-brainstorm-001',
        NOW() - INTERVAL '6 days', NOW() - INTERVAL '5 days 23 hours'
    ) RETURNING id INTO v_nr_brainstorm;

    -- 节点9: 前端开发 — PR交付物已审批 [4.1.2.6 代码提交]
    INSERT INTO multica_workflow_node_run (
        workflow_run_id, workflow_node_id, node_title, status,
        worker_type, worker_id, worker_output,
        critic_type, critic_id, critic_output, critic_comment,
        retry_count, runtime_id, device_id, session_id,
        started_at, completed_at
    ) VALUES (
        v_run_id, v_node_frontend, '前端开发', 'completed',
        'agent', c_ag_code_dev,
        '{"pr_url":"https://github.com/demo/repo/pull/42","commits":12,"files_changed":24,"lines_added":1200,"lines_removed":340}',
        'agent', c_ag_code_reviewer,
        '{"approved":true,"issues_found":2,"issues_resolved":2}', '代码质量良好，所有review意见已处理',
        1, c_rt_codex, 'device-codex', 'session-frontend-001',
        NOW() - INTERVAL '4 days', NOW() - INTERVAL '3 days 12 hours'
    ) RETURNING id INTO v_nr_frontend;

    -- 节点13: 单元测试 — agent评审完成 [4.2.2 agent评审者]
    INSERT INTO multica_workflow_node_run (
        workflow_run_id, workflow_node_id, node_title, status,
        worker_type, worker_id, worker_output,
        critic_type, critic_id, critic_output, critic_comment,
        retry_count, runtime_id, device_id, session_id,
        started_at, completed_at
    ) VALUES (
        v_run_id, v_node_unit_test, '单元测试', 'completed',
        'agent', c_ag_test_runner,
        '{"coverage":92.5,"total":156,"passed":154,"failed":2,"skipped":0}',
        'agent', c_ag_code_reviewer,
        '{"approved":true}', '2个失败用例为非关键路径，已记录tech debt',
        0, c_rt_claude, 'device-claude', 'session-unit-test-001',
        NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day 20 hours'
    ) RETURNING id INTO v_nr_unit_test;

    -- 节点14: E2E测试 — agent评审通过 [4.2.2]
    INSERT INTO multica_workflow_node_run (
        workflow_run_id, workflow_node_id, node_title, status,
        worker_type, worker_id, worker_output,
        critic_type, critic_id, critic_output, critic_comment,
        retry_count, runtime_id, device_id, session_id,
        started_at, completed_at
    ) VALUES (
        v_run_id, v_node_e2e_test, 'E2E测试', 'completed',
        'agent', c_ag_test_runner,
        '{"total":28,"passed":28,"failed":0,"duration_seconds":342}',
        'agent', c_ag_code_reviewer,
        '{"approved":true}', '全部通过，E2E覆盖了核心用户旅程',
        0, c_rt_claude, 'device-claude', 'session-e2e-001',
        NOW() - INTERVAL '1 day 12 hours', NOW() - INTERVAL '1 day 8 hours'
    ) RETURNING id INTO v_nr_e2e_test;

    -- 节点7: API设计 — 人工执行完成 [4.1.1 人执行者]
    INSERT INTO multica_workflow_node_run (
        workflow_run_id, workflow_node_id, node_title, status,
        worker_type, worker_id, worker_output,
        critic_type, critic_id, critic_output, critic_comment,
        retry_count, runtime_id, device_id, session_id,
        started_at, completed_at
    ) VALUES (
        v_run_id, v_node_api_design, 'API设计', 'completed',
        'human', c_user_id,
        '{"api_count":18,"endpoints":["/auth/*","/issues/*","/workflows/*","/agents/*"],"spec_format":"OpenAPI 3.0"}',
        'agent', c_ag_code_reviewer,
        '{"approved":true,"suggestions":["建议对 /issues 增加分页参数文档"]}', 'API设计规范，接口定义清晰',
        0, NULL, NULL, NULL,
        NOW() - INTERVAL '5 days', NOW() - INTERVAL '4 days 12 hours'
    ) RETURNING id INTO v_nr_api_design;

    -- ── 8.2 审核中节点 (awaiting_critic / critic_reviewing) ──
    -- 节点2: 需求文档整理 — 等待 agent critic 审核
    INSERT INTO multica_workflow_node_run (
        workflow_run_id, workflow_node_id, node_title, status,
        worker_type, worker_id, worker_output,
        critic_type, critic_id,
        retry_count, runtime_id, device_id, session_id,
        started_at
    ) VALUES (
        v_run_id, v_node_req_doc, '需求文档整理', 'awaiting_critic',
        'agent', c_ag_req_analyzer,
        '{"document":"结构化需求文档v1.0","sections":["背景","功能需求","非功能需求","验收标准"],"word_count":3500}',
        'agent', c_ag_code_reviewer,
        0, c_rt_csc, 'device-csc', 'session-req-doc-001',
        NOW() - INTERVAL '5 days'
    ) RETURNING id INTO v_nr_req_doc;

    -- 节点15: 性能测试 — 等待 API critic
    INSERT INTO multica_workflow_node_run (
        workflow_run_id, workflow_node_id, node_title, status,
        worker_type, worker_id, worker_output,
        critic_type, critic_id,
        retry_count, runtime_id, device_id, session_id,
        started_at
    ) VALUES (
        v_run_id, v_node_perf_test, '性能测试', 'awaiting_critic',
        'agent', c_ag_test_runner,
        '{"avg_response_ms":45,"p99_ms":120,"throughput_rps":850,"concurrent_users":500}',
        'api', NULL,
        0, c_rt_claude, 'device-claude', 'session-perf-001',
        NOW() - INTERVAL '1 day'
    ) RETURNING id INTO v_nr_perf_test;

    -- 节点5: AI需求评估 — critic 正在评审中 [评审节点]
    INSERT INTO multica_workflow_node_run (
        workflow_run_id, workflow_node_id, node_title, status,
        worker_type, worker_id, worker_output,
        critic_type, critic_id,
        retry_count, runtime_id, device_id, session_id,
        started_at
    ) VALUES (
        v_run_id, v_node_req_review, 'AI需求评估', 'critic_reviewing',
        'agent', c_ag_aireq_evaluator,
        '{"completeness_score":78,"consistency_score":85,"issues_found":4,"recommendations":["需求#3缺少验收标准","非功能需求部分需要补充性能指标"]}',
        'agent', c_ag_code_reviewer,
        0, c_rt_claude, 'device-claude', 'session-req-review-001',
        NOW() - INTERVAL '4 days 6 hours'
    ) RETURNING id INTO v_nr_req_review;

    -- ── 8.3 进行中节点 (working) ──
    -- 节点3: 需求分析 — agent 正在执行
    INSERT INTO multica_workflow_node_run (
        workflow_run_id, workflow_node_id, node_title, status,
        worker_type, worker_id,
        critic_type, critic_id,
        retry_count, runtime_id, device_id, session_id,
        started_at
    ) VALUES (
        v_run_id, v_node_req_analysis, '需求分析', 'working',
        'agent', c_ag_req_analyzer,
        'agent', c_ag_aireq_evaluator,
        0, c_rt_csc, 'device-csc', 'session-req-analysis-001',
        NOW() - INTERVAL '5 days'
    ) RETURNING id INTO v_nr_req_analysis;

    -- 节点11: 智能体开发 — 正在执行(已重试过1次)
    INSERT INTO multica_workflow_node_run (
        workflow_run_id, workflow_node_id, node_title, status,
        worker_type, worker_id, worker_output,
        critic_type, critic_id,
        retry_count, runtime_id, device_id, session_id,
        started_at
    ) VALUES (
        v_run_id, v_node_agent_dev, '智能体开发', 'working',
        'agent', c_ag_code_dev,
        '{"progress":"正在实现agent工具函数","tools_completed":3,"tools_total":5}',
        'agent', c_ag_code_reviewer,
        1, c_rt_codex, 'device-codex', 'session-agent-dev-002',
        NOW() - INTERVAL '1 day 6 hours'
    ) RETURNING id INTO v_nr_agent_dev;

    -- ── 8.4 已阻塞节点 (blocked) ──
    -- 节点4: 系统需求规格 — 头脑风暴阻塞 [4.1.2.4]
    INSERT INTO multica_workflow_node_run (
        workflow_run_id, workflow_node_id, node_title, status,
        worker_type, worker_id, worker_output,
        critic_type, critic_id,
        retry_count, runtime_id, device_id, session_id,
        started_at
    ) VALUES (
        v_run_id, v_node_sys_req, '系统需求规格', 'blocked',
        'agent', c_ag_req_analyzer,
        '{"blocked_reason":"需要用户确认系统边界和第三方集成方案","questions":["是否需要支持SSO?","数据存储方案偏好?","并发用户数预估?"]}',
        'agent', c_ag_sysreq_evaluator,
        0, c_rt_csc, 'device-csc', 'session-sys-req-blocked-001',
        NOW() - INTERVAL '4 days 12 hours'
    ) RETURNING id INTO v_nr_sys_req;

    -- ── 8.5 已失败节点 (failed) ──
    -- 节点10: 后端开发 — 任务执行失败 [4.1.2.2]
    INSERT INTO multica_workflow_node_run (
        workflow_run_id, workflow_node_id, node_title, status,
        worker_type, worker_id, worker_output,
        critic_type, critic_id,
        retry_count, runtime_id, device_id, session_id,
        started_at, completed_at
    ) VALUES (
        v_run_id, v_node_backend, '后端开发', 'failed',
        'agent', c_ag_code_dev,
        '{"error":"依赖服务不可用","last_successful_step":"数据库迁移","failed_step":"集成测试","retry_exhausted":true}',
        'agent', c_ag_code_reviewer,
        3, c_rt_codex, 'device-codex', 'session-backend-failed-001',
        NOW() - INTERVAL '3 days', NOW() - INTERVAL '2 days 6 hours'
    ) RETURNING id INTO v_nr_backend;

    -- ── 8.6 待办/待规划节点 (pending) ──
    -- 节点6: 架构设计 — 待办
    INSERT INTO multica_workflow_node_run (
        workflow_run_id, workflow_node_id, node_title, status,
        worker_type, worker_id,
        critic_type, critic_id,
        retry_count
    ) VALUES (
        v_run_id, v_node_arch_design, '架构设计', 'pending',
        'agent', c_ag_arch_designer,
        'squad', NULL,
        0
    ) RETURNING id INTO v_nr_arch_design;

    -- 节点8: 数据库设计 — 待办
    INSERT INTO multica_workflow_node_run (
        workflow_run_id, workflow_node_id, node_title, status,
        worker_type, worker_id,
        critic_type, critic_id,
        retry_count
    ) VALUES (
        v_run_id, v_node_db_design, '数据库设计', 'pending',
        'agent', c_ag_arch_designer,
        'human', c_user_id,
        0
    ) RETURNING id INTO v_nr_db_design;

    -- 节点12: 代码整合 — squad待办 [4.1.3 小队执行者]
    INSERT INTO multica_workflow_node_run (
        workflow_run_id, workflow_node_id, node_title, status,
        worker_type, worker_id,
        critic_type, critic_id,
        retry_count
    ) VALUES (
        v_run_id, v_node_integration, '代码整合', 'pending',
        'squad', NULL,
        'human', c_user_id,
        0
    ) RETURNING id INTO v_nr_integration;

    -- 节点16: 预发布检查 — squad待办
    INSERT INTO multica_workflow_node_run (
        workflow_run_id, workflow_node_id, node_title, status,
        worker_type, worker_id,
        critic_type, critic_id,
        retry_count
    ) VALUES (
        v_run_id, v_node_pre_release, '预发布检查', 'pending',
        'squad', NULL,
        'human', c_user_id,
        0
    ) RETURNING id INTO v_nr_pre_release;

    -- 节点17: 生产部署 — 人工执行者待办 [4.1.1]
    INSERT INTO multica_workflow_node_run (
        workflow_run_id, workflow_node_id, node_title, status,
        worker_type, worker_id,
        critic_type, critic_id,
        retry_count
    ) VALUES (
        v_run_id, v_node_prod_deploy, '生产部署', 'pending',
        'human', c_user_id,
        'human', c_user_id,
        0
    ) RETURNING id INTO v_nr_prod_deploy;

    -- ═════════════════════════════════════════════════════════════════════
    -- 9. 创建子 Issues (每个节点一个, number 自动递增)
    -- ═════════════════════════════════════════════════════════════════════
    -- 已完成
    v_issue_seq := v_issue_seq + 1;
    INSERT INTO multica_issue (workspace_id, title, status, priority, number, assignee_type, assignee_id, creator_type, creator_id, parent_issue_id, workflow_id, workflow_run_id, origin_type, origin_id)
    VALUES (c_workspace_id, '需求头脑风暴', 'done', 'medium', v_issue_seq, 'agent', c_ag_brain_stormer, 'agent', c_ag_brain_stormer, v_parent_issue_id, c_workflow_id, v_run_id, 'workflow', v_nr_brainstorm);

    v_issue_seq := v_issue_seq + 1;
    INSERT INTO multica_issue (workspace_id, title, status, priority, number, assignee_type, assignee_id, creator_type, creator_id, parent_issue_id, workflow_id, workflow_run_id, origin_type, origin_id)
    VALUES (c_workspace_id, '前端开发', 'done', 'high', v_issue_seq, 'agent', c_ag_code_dev, 'agent', c_ag_code_dev, v_parent_issue_id, c_workflow_id, v_run_id, 'workflow', v_nr_frontend);

    v_issue_seq := v_issue_seq + 1;
    INSERT INTO multica_issue (workspace_id, title, status, priority, number, assignee_type, assignee_id, creator_type, creator_id, parent_issue_id, workflow_id, workflow_run_id, origin_type, origin_id)
    VALUES (c_workspace_id, '单元测试', 'done', 'medium', v_issue_seq, 'agent', c_ag_test_runner, 'agent', c_ag_test_runner, v_parent_issue_id, c_workflow_id, v_run_id, 'workflow', v_nr_unit_test);

    v_issue_seq := v_issue_seq + 1;
    INSERT INTO multica_issue (workspace_id, title, status, priority, number, assignee_type, assignee_id, creator_type, creator_id, parent_issue_id, workflow_id, workflow_run_id, origin_type, origin_id)
    VALUES (c_workspace_id, 'E2E测试', 'done', 'medium', v_issue_seq, 'agent', c_ag_test_runner, 'agent', c_ag_test_runner, v_parent_issue_id, c_workflow_id, v_run_id, 'workflow', v_nr_e2e_test);

    v_issue_seq := v_issue_seq + 1;
    INSERT INTO multica_issue (workspace_id, title, status, priority, number, assignee_type, assignee_id, creator_type, creator_id, parent_issue_id, workflow_id, workflow_run_id, origin_type, origin_id)
    VALUES (c_workspace_id, 'API设计', 'done', 'high', v_issue_seq, 'member', c_user_id, 'member', c_user_id, v_parent_issue_id, c_workflow_id, v_run_id, 'workflow', v_nr_api_design);

    -- 审核中
    v_issue_seq := v_issue_seq + 1;
    INSERT INTO multica_issue (workspace_id, title, status, priority, number, assignee_type, assignee_id, creator_type, creator_id, parent_issue_id, workflow_id, workflow_run_id, origin_type, origin_id)
    VALUES (c_workspace_id, '需求文档整理', 'in_review', 'medium', v_issue_seq, 'agent', c_ag_req_analyzer, 'agent', c_ag_req_analyzer, v_parent_issue_id, c_workflow_id, v_run_id, 'workflow', v_nr_req_doc);

    v_issue_seq := v_issue_seq + 1;
    INSERT INTO multica_issue (workspace_id, title, status, priority, number, assignee_type, assignee_id, creator_type, creator_id, parent_issue_id, workflow_id, workflow_run_id, origin_type, origin_id)
    VALUES (c_workspace_id, '性能测试', 'in_review', 'low', v_issue_seq, 'agent', c_ag_test_runner, 'agent', c_ag_test_runner, v_parent_issue_id, c_workflow_id, v_run_id, 'workflow', v_nr_perf_test);

    v_issue_seq := v_issue_seq + 1;
    INSERT INTO multica_issue (workspace_id, title, status, priority, number, assignee_type, assignee_id, creator_type, creator_id, parent_issue_id, workflow_id, workflow_run_id, origin_type, origin_id)
    VALUES (c_workspace_id, 'AI需求评估', 'in_review', 'medium', v_issue_seq, 'agent', c_ag_aireq_evaluator, 'agent', c_ag_aireq_evaluator, v_parent_issue_id, c_workflow_id, v_run_id, 'workflow', v_nr_req_review);

    -- 进行中
    v_issue_seq := v_issue_seq + 1;
    INSERT INTO multica_issue (workspace_id, title, status, priority, number, assignee_type, assignee_id, creator_type, creator_id, parent_issue_id, workflow_id, workflow_run_id, origin_type, origin_id)
    VALUES (c_workspace_id, '需求分析', 'in_progress', 'high', v_issue_seq, 'agent', c_ag_req_analyzer, 'agent', c_ag_req_analyzer, v_parent_issue_id, c_workflow_id, v_run_id, 'workflow', v_nr_req_analysis);

    v_issue_seq := v_issue_seq + 1;
    INSERT INTO multica_issue (workspace_id, title, status, priority, number, assignee_type, assignee_id, creator_type, creator_id, parent_issue_id, workflow_id, workflow_run_id, origin_type, origin_id)
    VALUES (c_workspace_id, '智能体开发', 'in_progress', 'high', v_issue_seq, 'agent', c_ag_code_dev, 'agent', c_ag_code_dev, v_parent_issue_id, c_workflow_id, v_run_id, 'workflow', v_nr_agent_dev);

    -- 已阻塞
    v_issue_seq := v_issue_seq + 1;
    INSERT INTO multica_issue (workspace_id, title, status, priority, number, assignee_type, assignee_id, creator_type, creator_id, parent_issue_id, workflow_id, workflow_run_id, origin_type, origin_id)
    VALUES (c_workspace_id, '系统需求规格', 'blocked', 'high', v_issue_seq, 'agent', c_ag_req_analyzer, 'agent', c_ag_req_analyzer, v_parent_issue_id, c_workflow_id, v_run_id, 'workflow', v_nr_sys_req);

    -- 已失败
    v_issue_seq := v_issue_seq + 1;
    INSERT INTO multica_issue (workspace_id, title, status, priority, number, assignee_type, assignee_id, creator_type, creator_id, parent_issue_id, workflow_id, workflow_run_id, origin_type, origin_id)
    VALUES (c_workspace_id, '后端开发', 'cancelled', 'urgent', v_issue_seq, 'agent', c_ag_code_dev, 'agent', c_ag_code_dev, v_parent_issue_id, c_workflow_id, v_run_id, 'workflow', v_nr_backend);

    -- 待办
    v_issue_seq := v_issue_seq + 1;
    INSERT INTO multica_issue (workspace_id, title, status, priority, number, assignee_type, assignee_id, creator_type, creator_id, parent_issue_id, workflow_id, workflow_run_id, origin_type, origin_id)
    VALUES (c_workspace_id, '架构设计', 'todo', 'high', v_issue_seq, 'agent', c_ag_arch_designer, 'agent', c_ag_arch_designer, v_parent_issue_id, c_workflow_id, v_run_id, 'workflow', v_nr_arch_design);

    v_issue_seq := v_issue_seq + 1;
    INSERT INTO multica_issue (workspace_id, title, status, priority, number, assignee_type, assignee_id, creator_type, creator_id, parent_issue_id, workflow_id, workflow_run_id, origin_type, origin_id)
    VALUES (c_workspace_id, '数据库设计', 'todo', 'medium', v_issue_seq, 'agent', c_ag_arch_designer, 'agent', c_ag_arch_designer, v_parent_issue_id, c_workflow_id, v_run_id, 'workflow', v_nr_db_design);

    v_issue_seq := v_issue_seq + 1;
    INSERT INTO multica_issue (workspace_id, title, status, priority, number, assignee_type, assignee_id, creator_type, creator_id, parent_issue_id, workflow_id, workflow_run_id, origin_type, origin_id)
    VALUES (c_workspace_id, '代码整合', 'todo', 'medium', v_issue_seq, 'squad', NULL, 'member', c_user_id, v_parent_issue_id, c_workflow_id, v_run_id, 'workflow', v_nr_integration);

    v_issue_seq := v_issue_seq + 1;
    INSERT INTO multica_issue (workspace_id, title, status, priority, number, assignee_type, assignee_id, creator_type, creator_id, parent_issue_id, workflow_id, workflow_run_id, origin_type, origin_id)
    VALUES (c_workspace_id, '预发布检查', 'todo', 'high', v_issue_seq, 'squad', NULL, 'member', c_user_id, v_parent_issue_id, c_workflow_id, v_run_id, 'workflow', v_nr_pre_release);

    v_issue_seq := v_issue_seq + 1;
    INSERT INTO multica_issue (workspace_id, title, status, priority, number, assignee_type, assignee_id, creator_type, creator_id, parent_issue_id, workflow_id, workflow_run_id, origin_type, origin_id)
    VALUES (c_workspace_id, '生产部署', 'todo', 'urgent', v_issue_seq, 'member', c_user_id, 'member', c_user_id, v_parent_issue_id, c_workflow_id, v_run_id, 'workflow', v_nr_prod_deploy);

    -- 更新 workspace issue_counter
    UPDATE multica_workspace SET issue_counter = v_issue_seq WHERE id = c_workspace_id;

    -- ═════════════════════════════════════════════════════════════════════
    -- 10. 交付物提交 (红绿灯信号)
    --
    -- green  = approved  (已审批通过)
    -- yellow = submitted (已提交待审批)
    -- red    = missing   (缺失)
    -- ═════════════════════════════════════════════════════════════════════

    -- Green: 头脑风暴文档已审批
    INSERT INTO multica_workflow_node_deliverable_submission (
        workflow_node_run_id, deliverable_id, submitted_by_type, submitted_by_id, status, content
    ) VALUES (v_nr_brainstorm, v_deliv_brainstorm_doc, 'agent', c_ag_brain_stormer, 'approved', '## 需求头脑风暴记录\n\n### 核心功能模块\n1. 用户认证与权限管理\n2. 任务管理系统\n3. AI智能体协作\n4. 实时通知推送\n5. 数据分析报表\n\n### 技术约束\n- 支持Web + Desktop双平台\n- API响应时间<200ms\n- 支持1000并发用户');

    -- Green: 前端PR已审批
    INSERT INTO multica_workflow_node_deliverable_submission (
        workflow_node_run_id, deliverable_id, submitted_by_type, submitted_by_id, status, content, pull_request_url, review_comment
    ) VALUES (v_nr_frontend, v_deliv_frontend_pr, 'agent', c_ag_code_dev, 'approved', '完成前端UI组件开发', 'https://github.com/demo/repo/pull/42', '代码审查通过，LGTM!');

    -- Green: 单元测试报告已审批
    INSERT INTO multica_workflow_node_deliverable_submission (
        workflow_node_run_id, deliverable_id, submitted_by_type, submitted_by_id, status, content, review_comment
    ) VALUES (v_nr_unit_test, v_deliv_unit_test_report, 'agent', c_ag_test_runner, 'approved', '覆盖率92.5%，154/156通过', '2个失败用例为非关键路径，记录tech debt后通过');

    -- Green: E2E测试全部通过
    INSERT INTO multica_workflow_node_deliverable_submission (
        workflow_node_run_id, deliverable_id, submitted_by_type, submitted_by_id, status, content, review_comment
    ) VALUES (v_nr_e2e_test, v_deliv_e2e_test_report, 'agent', c_ag_test_runner, 'approved', '28/28全部通过', 'E2E覆盖核心用户旅程，全部通过');

    -- Green: API设计文档已审批
    INSERT INTO multica_workflow_node_deliverable_submission (
        workflow_node_run_id, deliverable_id, submitted_by_type, submitted_by_id, status, content
    ) VALUES (v_nr_api_design, v_deliv_api_design_doc, 'member', c_user_id, 'approved', 'OpenAPI 3.0格式，18个endpoint，包含完整的请求/响应定义');

    -- Yellow: 需求文档待审批
    INSERT INTO multica_workflow_node_deliverable_submission (
        workflow_node_run_id, deliverable_id, submitted_by_type, submitted_by_id, status, content
    ) VALUES (v_nr_req_doc, v_deliv_req_doc_spec, 'agent', c_ag_req_analyzer, 'submitted', '结构化需求文档v1.0，包含4个主要章节');

    -- Yellow: 性能测试报告待审批
    INSERT INTO multica_workflow_node_deliverable_submission (
        workflow_node_run_id, deliverable_id, submitted_by_type, submitted_by_id, status, content
    ) VALUES (v_nr_perf_test, v_deliv_perf_test_report, 'agent', c_ag_test_runner, 'submitted', '平均响应45ms，P99=120ms，吞吐850rps');

    -- Yellow: 需求评估报告已提交
    INSERT INTO multica_workflow_node_deliverable_submission (
        workflow_node_run_id, deliverable_id, submitted_by_type, submitted_by_id, status, content
    ) VALUES (v_nr_req_review, v_deliv_req_review_doc, 'agent', c_ag_aireq_evaluator, 'submitted', '完整性78%，一致性85%，发现4个问题');

    -- Red: 系统需求规格交付物缺失(blocked)
    INSERT INTO multica_workflow_node_deliverable_submission (
        workflow_node_run_id, deliverable_id, submitted_by_type, submitted_by_id, status, content
    ) VALUES (v_nr_sys_req, v_deliv_sys_req_spec, 'agent', c_ag_req_analyzer, 'missing', '');

    -- Red: 后端PR缺失(failed)
    INSERT INTO multica_workflow_node_deliverable_submission (
        workflow_node_run_id, deliverable_id, submitted_by_type, submitted_by_id, status, content
    ) VALUES (v_nr_backend, v_deliv_backend_pr, 'agent', c_ag_code_dev, 'missing', '');

    -- ═════════════════════════════════════════════════════════════════════
    -- 11. Agent 任务队列
    -- ═════════════════════════════════════════════════════════════════════

    -- 11.1 已完成的任务
    INSERT INTO multica_agent_task_queue (agent_id, runtime_id, issue_id, status, priority, workflow_node_run_id, context, started_at, completed_at)
    VALUES (c_ag_brain_stormer, c_rt_claude, v_parent_issue_id, 'completed', 1, v_nr_brainstorm,
        '{"type":"workflow","phase":"worker","node_title":"需求头脑风暴"}',
        NOW() - INTERVAL '6 days', NOW() - INTERVAL '5 days 23 hours')
    RETURNING id INTO v_task_brainstorm;
    UPDATE multica_workflow_node_run SET worker_agent_task_id = v_task_brainstorm WHERE id = v_nr_brainstorm;

    INSERT INTO multica_agent_task_queue (agent_id, runtime_id, issue_id, status, priority, workflow_node_run_id, context, started_at, completed_at)
    VALUES (c_ag_code_dev, c_rt_codex, v_parent_issue_id, 'completed', 1, v_nr_frontend,
        '{"type":"workflow","phase":"worker","node_title":"前端开发"}',
        NOW() - INTERVAL '4 days', NOW() - INTERVAL '3 days 12 hours')
    RETURNING id INTO v_task_frontend;
    UPDATE multica_workflow_node_run SET worker_agent_task_id = v_task_frontend WHERE id = v_nr_frontend;

    INSERT INTO multica_agent_task_queue (agent_id, runtime_id, issue_id, status, priority, workflow_node_run_id, context, started_at, completed_at)
    VALUES (c_ag_test_runner, c_rt_claude, v_parent_issue_id, 'completed', 1, v_nr_unit_test,
        '{"type":"workflow","phase":"worker","node_title":"单元测试"}',
        NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day 20 hours')
    RETURNING id INTO v_task_unit_test;
    UPDATE multica_workflow_node_run SET worker_agent_task_id = v_task_unit_test WHERE id = v_nr_unit_test;

    INSERT INTO multica_agent_task_queue (agent_id, runtime_id, issue_id, status, priority, workflow_node_run_id, context, started_at, completed_at)
    VALUES (c_ag_test_runner, c_rt_claude, v_parent_issue_id, 'completed', 1, v_nr_e2e_test,
        '{"type":"workflow","phase":"worker","node_title":"E2E测试"}',
        NOW() - INTERVAL '1 day 12 hours', NOW() - INTERVAL '1 day 8 hours')
    RETURNING id INTO v_task_e2e_test;
    UPDATE multica_workflow_node_run SET worker_agent_task_id = v_task_e2e_test WHERE id = v_nr_e2e_test;

    -- 11.2 运行中的任务
    INSERT INTO multica_agent_task_queue (agent_id, runtime_id, issue_id, status, priority, workflow_node_run_id, context, session_id, started_at)
    VALUES (c_ag_req_analyzer, c_rt_csc, v_parent_issue_id, 'running', 1, v_nr_req_analysis,
        '{"type":"workflow","phase":"worker","node_title":"需求分析"}',
        'session-req-analysis-001', NOW() - INTERVAL '5 days')
    RETURNING id INTO v_task_req_analysis;
    UPDATE multica_workflow_node_run SET worker_agent_task_id = v_task_req_analysis WHERE id = v_nr_req_analysis;

    INSERT INTO multica_agent_task_queue (agent_id, runtime_id, issue_id, status, priority, workflow_node_run_id, context, session_id, started_at, attempt, max_attempts)
    VALUES (c_ag_code_dev, c_rt_codex, v_parent_issue_id, 'running', 1, v_nr_agent_dev,
        '{"type":"workflow","phase":"worker","node_title":"智能体开发","retry":1}',
        'session-agent-dev-002', NOW() - INTERVAL '1 day 6 hours', 2, 3)
    RETURNING id INTO v_task_agent_dev;
    UPDATE multica_workflow_node_run SET worker_agent_task_id = v_task_agent_dev WHERE id = v_nr_agent_dev;

    -- 11.3 已完成worker，等待critic
    INSERT INTO multica_agent_task_queue (agent_id, runtime_id, issue_id, status, priority, workflow_node_run_id, context, started_at, completed_at)
    VALUES (c_ag_req_analyzer, c_rt_csc, v_parent_issue_id, 'completed', 1, v_nr_req_doc,
        '{"type":"workflow","phase":"worker","node_title":"需求文档整理"}',
        NOW() - INTERVAL '5 days 6 hours', NOW() - INTERVAL '5 days 1 hour')
    RETURNING id INTO v_task_req_doc;
    UPDATE multica_workflow_node_run SET worker_agent_task_id = v_task_req_doc WHERE id = v_nr_req_doc;
    -- critic task 也排入队列
    INSERT INTO multica_agent_task_queue (agent_id, runtime_id, issue_id, status, priority, workflow_node_run_id, context)
    VALUES (c_ag_code_reviewer, c_rt_claude, v_parent_issue_id, 'queued', 2, v_nr_req_doc,
        '{"type":"workflow","phase":"critic","node_title":"需求文档整理"}');
    UPDATE multica_workflow_node_run SET critic_agent_task_id = (SELECT id FROM multica_agent_task_queue WHERE workflow_node_run_id = v_nr_req_doc AND context->>'phase' = 'critic' LIMIT 1) WHERE id = v_nr_req_doc;

    -- 11.4 性能测试 worker → 等待API critic
    INSERT INTO multica_agent_task_queue (agent_id, runtime_id, issue_id, status, priority, workflow_node_run_id, context, started_at, completed_at)
    VALUES (c_ag_test_runner, c_rt_claude, v_parent_issue_id, 'completed', 1, v_nr_perf_test,
        '{"type":"workflow","phase":"worker","node_title":"性能测试"}',
        NOW() - INTERVAL '1 day 2 hours', NOW() - INTERVAL '1 day 1 hour')
    RETURNING id INTO v_task_perf_test;
    UPDATE multica_workflow_node_run SET worker_agent_task_id = v_task_perf_test WHERE id = v_nr_perf_test;

    -- 11.5 失败的任务 [4.1.2.2]
    INSERT INTO multica_agent_task_queue (agent_id, runtime_id, issue_id, status, priority, workflow_node_run_id, context, error, failure_reason, attempt, max_attempts, started_at, completed_at)
    VALUES (c_ag_code_dev, c_rt_codex, v_parent_issue_id, 'failed', 1, v_nr_backend,
        '{"type":"workflow","phase":"worker","node_title":"后端开发"}',
        '集成测试失败：依赖服务不可用',
        'agent_error', 3, 3,
        NOW() - INTERVAL '3 days', NOW() - INTERVAL '2 days 6 hours')
    RETURNING id INTO v_task_backend;
    UPDATE multica_workflow_node_run SET worker_agent_task_id = v_task_backend WHERE id = v_nr_backend;

    -- 11.6 之前的失败重试任务
    INSERT INTO multica_agent_task_queue (agent_id, runtime_id, issue_id, status, priority, workflow_node_run_id, context, error, failure_reason, attempt, max_attempts, started_at, completed_at)
    VALUES (c_ag_code_dev, c_rt_codex, v_parent_issue_id, 'failed', 1, v_nr_backend,
        '{"type":"workflow","phase":"worker","node_title":"后端开发","retry":1}',
        '数据库迁移失败：schema冲突',
        'agent_error', 2, 3,
        NOW() - INTERVAL '2 days 18 hours', NOW() - INTERVAL '2 days 17 hours')
    RETURNING id INTO v_task_backend_retry;

    -- 11.7 阻塞任务(等待用户输入) [4.1.2.4]
    INSERT INTO multica_agent_task_queue (agent_id, runtime_id, issue_id, status, priority, workflow_node_run_id, context, session_id, started_at, failure_reason)
    VALUES (c_ag_req_analyzer, c_rt_csc, v_parent_issue_id, 'failed', 1, v_nr_sys_req,
        '{"type":"workflow","phase":"worker","node_title":"系统需求规格","awaiting_input":true}',
        'session-sys-req-blocked-001', NOW() - INTERVAL '4 days 12 hours',
        'awaiting_human_input')
    RETURNING id INTO v_task_sys_req;
    UPDATE multica_workflow_node_run SET worker_agent_task_id = v_task_sys_req WHERE id = v_nr_sys_req;

    -- ═════════════════════════════════════════════════════════════════════
    -- 12. 会话数据 (Chat Sessions + Messages)
    -- ═════════════════════════════════════════════════════════════════════

    -- 12.1 头脑风暴会话 (已完成) [4.1.2.4]
    INSERT INTO multica_chat_session (id, workspace_id, agent_id, creator_id, title, session_id, status)
    VALUES (gen_random_uuid(), c_workspace_id, c_ag_brain_stormer, c_user_id, '需求头脑风暴会话', 'session-brainstorm-001', 'archived')
    RETURNING id INTO v_chat_session_brainstorm;

    INSERT INTO multica_chat_message (chat_session_id, role, content, created_at) VALUES
        (v_chat_session_brainstorm, 'user', '请帮我对全栈Web应用进行需求头脑风暴，目标用户是企业研发团队', NOW() - INTERVAL '6 days'),
        (v_chat_session_brainstorm, 'assistant', '好的，我先识别核心用户场景。企业研发团队通常需要：1)项目管理 2)代码协作 3)CI/CD集成 4)知识管理', NOW() - INTERVAL '6 days'),
        (v_chat_session_brainstorm, 'user', '重点关注AI智能体协作能力，这是我们产品的差异化特性', NOW() - INTERVAL '5 days 23 hours'),
        (v_chat_session_brainstorm, 'assistant', '明白了。AI智能体协作需要：智能体任务分配、实时会话介入、交付物自动评审等功能。这些都已被纳入需求文档。', NOW() - INTERVAL '5 days 23 hours');

    -- 12.2 纠偏会话 [4.1.2.3] — 针对智能体开发节点的重试
    INSERT INTO multica_chat_session (id, workspace_id, agent_id, creator_id, title, session_id, status)
    VALUES (gen_random_uuid(), c_workspace_id, c_ag_code_dev, c_user_id, '智能体开发纠偏会话', 'session-agent-dev-002', 'active')
    RETURNING id INTO v_chat_session_fix;

    INSERT INTO multica_chat_message (chat_session_id, role, content, created_at) VALUES
        (v_chat_session_fix, 'assistant', '正在实现agent工具函数...tool-1已完成, tool-2进行中', NOW() - INTERVAL '1 day 6 hours'),
        (v_chat_session_fix, 'user', '注意，tool-2的设计方向有偏差，应该采用流式响应而非批量处理', NOW() - INTERVAL '1 day 5 hours'),
        (v_chat_session_fix, 'assistant', '明白，我重新调整tool-2的实现方案，改为流式处理。同时也检查tool-3~5是否需要相应调整', NOW() - INTERVAL '1 day 5 hours'),
        (v_chat_session_fix, 'user', '好的，调整后继续执行。遇到不确定的技术决策先和我确认', NOW() - INTERVAL '1 day 4 hours'),
        (v_chat_session_fix, 'assistant', '收到。tool-2已重构为流式响应模式，tool-3开始实现中。', NOW() - INTERVAL '1 day 3 hours');

    -- ═════════════════════════════════════════════════════════════════════
    -- 13. 评论数据
    -- ═════════════════════════════════════════════════════════════════════

    -- 父Issue评论
    INSERT INTO multica_comment (workspace_id, issue_id, author_type, author_id, content, type, created_at) VALUES
        (c_workspace_id, v_parent_issue_id, 'member', c_user_id, '启动全栈Web应用v3.0开发，已分配工作流执行', 'comment', NOW() - INTERVAL '6 days 12 hours'),
        (c_workspace_id, v_parent_issue_id, 'agent', c_ag_brain_stormer, '需求头脑风暴已完成，识别出5个核心功能模块', 'progress_update', NOW() - INTERVAL '5 days 22 hours'),
        (c_workspace_id, v_parent_issue_id, 'member', c_user_id, '头脑风暴结果已审核通过，进入需求文档整理阶段', 'status_change', NOW() - INTERVAL '5 days 20 hours');

    -- 已阻塞节点的评论 [4.1.2.4]
    INSERT INTO multica_comment (workspace_id, issue_id, author_type, author_id, content, type, created_at) VALUES
        (c_workspace_id, v_parent_issue_id, 'agent', c_ag_req_analyzer, '⚠️ 系统需求规格进入阻塞状态：需要用户确认系统边界和第三方集成方案', 'status_change', NOW() - INTERVAL '4 days 12 hours'),
        (c_workspace_id, v_parent_issue_id, 'member', c_user_id, '确认：需要SSO支持，数据库使用PostgreSQL，并发用户预估500-1000', 'comment', NOW() - INTERVAL '4 days 10 hours');

    -- 失败节点的评论 [4.1.2.2]
    INSERT INTO multica_comment (workspace_id, issue_id, author_type, author_id, content, type, created_at) VALUES
        (c_workspace_id, v_parent_issue_id, 'agent', c_ag_code_dev, '❌ 后端开发失败：集成测试阶段依赖服务不可用，已重试3次仍失败', 'status_change', NOW() - INTERVAL '2 days 6 hours'),
        (c_workspace_id, v_parent_issue_id, 'member', c_user_id, '检查依赖服务状态后重试，或者先将该节点转人工处理', 'comment', NOW() - INTERVAL '2 days 4 hours');

    -- 评审意见评论 [4.2.1 / 4.2.2]
    INSERT INTO multica_comment (workspace_id, issue_id, author_type, author_id, content, type, created_at) VALUES
        (c_workspace_id, v_parent_issue_id, 'agent', c_ag_code_reviewer, '✅ 前端开发代码审查通过，PR #42 LGTM! 2个建议问题已处理', 'comment', NOW() - INTERVAL '3 days 12 hours'),
        (c_workspace_id, v_parent_issue_id, 'agent', c_ag_code_reviewer, '✅ E2E测试全部通过(28/28)，覆盖核心用户旅程', 'comment', NOW() - INTERVAL '1 day 8 hours'),
        (c_workspace_id, v_parent_issue_id, 'member', c_user_id, '✅ API设计文档审核通过，接口定义清晰规范', 'comment', NOW() - INTERVAL '4 days 6 hours');

    -- ═════════════════════════════════════════════════════════════════════
    -- 14. 活动日志
    -- ═════════════════════════════════════════════════════════════════════
    INSERT INTO multica_activity_log (workspace_id, issue_id, actor_type, actor_id, action, details, created_at) VALUES
        (c_workspace_id, v_parent_issue_id, 'member', c_user_id, 'issue.created', '{"title":"全栈Web应用研发 v3.0"}', NOW() - INTERVAL '7 days'),
        (c_workspace_id, v_parent_issue_id, 'system', NULL, 'workflow.run.started', '{"workflow_id":"028f13ec-8d4d-49af-907d-7de306f6a2a2"}', NOW() - INTERVAL '6 days 12 hours'),
        (c_workspace_id, v_parent_issue_id, 'agent', c_ag_brain_stormer, 'node.completed', '{"node":"需求头脑风暴","status":"completed"}', NOW() - INTERVAL '5 days 23 hours'),
        (c_workspace_id, v_parent_issue_id, 'agent', c_ag_code_dev, 'node.completed', '{"node":"前端开发","status":"completed","pr":"#42"}', NOW() - INTERVAL '3 days 12 hours'),
        (c_workspace_id, v_parent_issue_id, 'agent', c_ag_code_dev, 'node.failed', '{"node":"后端开发","status":"failed","retries":3}', NOW() - INTERVAL '2 days 6 hours'),
        (c_workspace_id, v_parent_issue_id, 'agent', c_ag_req_analyzer, 'node.blocked', '{"node":"系统需求规格","reason":"awaiting_human_input"}', NOW() - INTERVAL '4 days 12 hours'),
        (c_workspace_id, v_parent_issue_id, 'agent', c_ag_code_dev, 'node.retry', '{"node":"智能体开发","retry_count":2}', NOW() - INTERVAL '1 day 6 hours');

    RAISE NOTICE '✅ 全量工作流执行数据创建完成!';
    RAISE NOTICE '   Workflow ID: %', c_workflow_id;
    RAISE NOTICE '   Parent Issue: %', v_parent_issue_id;
    RAISE NOTICE '   Run ID: %', v_run_id;
    RAISE NOTICE '   节点总数: 17';
    RAISE NOTICE '   状态分布: completed=5, awaiting_critic=2, critic_reviewing=1, working=2, blocked=1, failed=1, pending=5';
    RAISE NOTICE '   交付物信号: green=5, yellow=3, red=2';
END $$;

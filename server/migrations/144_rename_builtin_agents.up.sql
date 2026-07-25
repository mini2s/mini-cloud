-- 144_rename_builtin_agents.up.sql
-- Rename the built-in agents to internet-style role names (产品经理, 架构师,
-- 项目经理, 研发工程师, 测试工程师, DevOps 工程师, 代码评审) and consolidate the
-- four domain split planners into a single 技术负责人.
--
-- Built-in agents are read-only in the UI, so this must happen via migration.
-- 124/137 seeds only affect fresh deploys; this UPDATE/DELETE covers environments
-- that already ran those seeds, converging them on the same final roster.
-- Only display metadata changes; instructions are intentionally left untouched.

UPDATE multica_agent SET name = '产品经理'      WHERE id = 'dd0683f4-d72c-4b49-8030-827f5b15df2e';
UPDATE multica_agent SET name = '架构师'        WHERE id = '5e2fccac-6257-4ea5-ac7a-a5d8a4765917';
UPDATE multica_agent SET name = '项目经理'      WHERE id = '4348e20d-eadc-4095-ac7a-cd480e927375';
UPDATE multica_agent SET name = '研发工程师'    WHERE id = 'c0bea924-c78f-43b1-8d50-449ec3c6b4cf';
UPDATE multica_agent SET name = '测试工程师'    WHERE id = '67cdded4-c49f-4fc3-b7e0-52aa2038db91';
UPDATE multica_agent SET name = 'DevOps 工程师' WHERE id = '24a981c1-6ea6-4eab-9225-a5fe3da64477';
UPDATE multica_agent SET name = '代码评审'      WHERE id = 'a6f5d437-93c2-4623-ba0a-bcbb5cb8d1a6';

-- Split planners: consolidate four into one. General becomes 技术负责人;
-- the Code/Design/Test planners are removed.
UPDATE multica_agent SET name = '技术负责人', description = '工作流拆分节点的任务规划，把节点拆成可评审的子任务草稿' WHERE id = 'dd79d98e-3be1-4cb5-9cdd-aee809287741';
DELETE FROM multica_agent WHERE id IN (
    '3ef3f4fd-0de7-4a84-a03d-cb5d4df2f30c',
    '32fc6f0c-2f00-44d7-a6a2-36f1d75a144a',
    '6b3ea222-f3ee-44c5-b4c9-33a1674a1127'
);

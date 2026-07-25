-- 144_rename_builtin_agents.up.sql
-- Rename the built-in agents from function-based display names (e.g. 需求分析,
-- Split Planner (Code)) to identity/role-based names (e.g. 需求分析师, 研发规划师).
--
-- Built-in agents are read-only in the UI, so renaming must happen via
-- migration. The original seed files (124_seed_builtin_agents,
-- 137_seed_split_planner_agents) are INSERT ... ON CONFLICT (id) DO NOTHING,
-- which only affect fresh deploys. This UPDATE covers environments that
-- already ran those seeds, matching the names to what 124/137 now insert.
--
-- Only display metadata (name, and for the split planners also description)
-- changes; instructions / system prompts are intentionally left untouched.

UPDATE multica_agent SET name = '需求分析师' WHERE id = 'dd0683f4-d72c-4b49-8030-827f5b15df2e';
UPDATE multica_agent SET name = '架构师'     WHERE id = '5e2fccac-6257-4ea5-ac7a-a5d8a4765917';
UPDATE multica_agent SET name = '项目经理'   WHERE id = '4348e20d-eadc-4095-ac7a-cd480e927375';
UPDATE multica_agent SET name = '开发工程师' WHERE id = 'c0bea924-c78f-43b1-8d50-449ec3c6b4cf';
UPDATE multica_agent SET name = '测试工程师' WHERE id = '67cdded4-c49f-4fc3-b7e0-52aa2038db91';
UPDATE multica_agent SET name = '质量工程师' WHERE id = '24a981c1-6ea6-4eab-9225-a5fe3da64477';
UPDATE multica_agent SET name = '审核员'     WHERE id = 'a6f5d437-93c2-4623-ba0a-bcbb5cb8d1a6';

-- Split planners: localize name and description to Chinese (instructions untouched).
UPDATE multica_agent SET name = '通用规划师', description = '通用任务拆分草稿规划师，用于工作流拆分节点'  WHERE id = 'dd79d98e-3be1-4cb5-9cdd-aee809287741';
UPDATE multica_agent SET name = '研发规划师', description = '面向实现型工作流的代码拆分草稿规划师'      WHERE id = '3ef3f4fd-0de7-4a84-a03d-cb5d4df2f30c';
UPDATE multica_agent SET name = '设计规划师', description = '面向产品与 UI 工作流的设计拆分草稿规划师' WHERE id = '32fc6f0c-2f00-44d7-a6a2-36f1d75a144a';
UPDATE multica_agent SET name = '测试规划师', description = '面向 QA 与验证工作流的测试拆分草稿规划师' WHERE id = '6b3ea222-f3ee-44c5-b4c9-33a1674a1127';

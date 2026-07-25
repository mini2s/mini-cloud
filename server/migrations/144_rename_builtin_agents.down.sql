-- 144_rename_builtin_agents.down.sql
-- Revert the built-in agent display names and split-planner descriptions to
-- their pre-144 values.

UPDATE multica_agent SET name = '需求分析' WHERE id = 'dd0683f4-d72c-4b49-8030-827f5b15df2e';
UPDATE multica_agent SET name = '方案设计' WHERE id = '5e2fccac-6257-4ea5-ac7a-a5d8a4765917';
UPDATE multica_agent SET name = '任务拆解' WHERE id = '4348e20d-eadc-4095-ac7a-cd480e927375';
UPDATE multica_agent SET name = 'TDD 编码' WHERE id = 'c0bea924-c78f-43b1-8d50-449ec3c6b4cf';
UPDATE multica_agent SET name = '测试生成' WHERE id = '67cdded4-c49f-4fc3-b7e0-52aa2038db91';
UPDATE multica_agent SET name = '集成验证' WHERE id = '24a981c1-6ea6-4eab-9225-a5fe3da64477';
UPDATE multica_agent SET name = '审核师'   WHERE id = 'a6f5d437-93c2-4623-ba0a-bcbb5cb8d1a6';

UPDATE multica_agent SET name = 'Split Planner (General)', description = 'General-purpose split draft planner for workflow split nodes.'  WHERE id = 'dd79d98e-3be1-4cb5-9cdd-aee809287741';
UPDATE multica_agent SET name = 'Split Planner (Code)',    description = 'Code-focused split draft planner for implementation workflows.' WHERE id = '3ef3f4fd-0de7-4a84-a03d-cb5d4df2f30c';
UPDATE multica_agent SET name = 'Split Planner (Design)',  description = 'Design-focused split draft planner for product and UI workflows.' WHERE id = '32fc6f0c-2f00-44d7-a6a2-36f1d75a144a';
UPDATE multica_agent SET name = 'Split Planner (Test)',    description = 'Test-focused split draft planner for QA and verification workflows.' WHERE id = '6b3ea222-f3ee-44c5-b4c9-33a1674a1127';

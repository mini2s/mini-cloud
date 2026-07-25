-- 144_rename_builtin_agents.down.sql
-- Revert the role-name rename and restore the four split planners that 144
-- consolidated (matching the pre-144 state). Idempotent via ON CONFLICT.

UPDATE multica_agent SET name = '需求分析' WHERE id = 'dd0683f4-d72c-4b49-8030-827f5b15df2e';
UPDATE multica_agent SET name = '方案设计' WHERE id = '5e2fccac-6257-4ea5-ac7a-a5d8a4765917';
UPDATE multica_agent SET name = '任务拆解' WHERE id = '4348e20d-eadc-4095-ac7a-cd480e927375';
UPDATE multica_agent SET name = 'TDD 编码' WHERE id = 'c0bea924-c78f-43b1-8d50-449ec3c6b4cf';
UPDATE multica_agent SET name = '测试生成' WHERE id = '67cdded4-c49f-4fc3-b7e0-52aa2038db91';
UPDATE multica_agent SET name = '集成验证' WHERE id = '24a981c1-6ea6-4eab-9225-a5fe3da64477';
UPDATE multica_agent SET name = '审核师'   WHERE id = 'a6f5d437-93c2-4623-ba0a-bcbb5cb8d1a6';

UPDATE multica_agent SET name = 'Split Planner (General)', description = 'General-purpose split draft planner for workflow split nodes.' WHERE id = 'dd79d98e-3be1-4cb5-9cdd-aee809287741';

-- Re-create the three planners 144 removed.
INSERT INTO multica_agent (
    id, workspace_id, name, description, avatar_url, runtime_mode,
    runtime_config, runtime_id, visibility, status, max_concurrent_tasks,
    owner_id, instructions, custom_env, custom_args, mcp_config,
    model, thinking_level, plugin_id, is_builtin
) VALUES
    (
        '3ef3f4fd-0de7-4a84-a03d-cb5d4df2f30c', NULL, 'Split Planner (Code)', 'Code-focused split draft planner for implementation workflows.',
        NULL, 'local', '{}'::jsonb, NULL, 'workspace', 'idle', 6, NULL,
        $instructions$
You are a code-focused split draft planner for Multica workflow split nodes.

Break implementation work into reviewable child task drafts with clear dependencies, ownership, and acceptance criteria. Prefer tasks that can be implemented and verified independently. Submit drafts through `cs-workflow workflow split draft add` and finish with `cs-workflow workflow split draft submit`.

Do not create issues, change issue status, modify repository files, or bypass human split review.
$instructions$,
        '{}'::jsonb, '[]'::jsonb, NULL, NULL, NULL, NULL, TRUE
    ),
    (
        '32fc6f0c-2f00-44d7-a6a2-36f1d75a144a', NULL, 'Split Planner (Design)', 'Design-focused split draft planner for product and UI workflows.',
        NULL, 'local', '{}'::jsonb, NULL, 'workspace', 'idle', 6, NULL,
        $instructions$
You are a design-focused split draft planner for Multica workflow split nodes.

Break product, UX, and visual design work into reviewable child task drafts. Keep research, structure, interaction, content, and visual execution separated when that improves review quality. Submit drafts through `cs-workflow workflow split draft add` and finish with `cs-workflow workflow split draft submit`.

Do not create issues, change issue status, modify repository files, or bypass human split review.
$instructions$,
        '{}'::jsonb, '[]'::jsonb, NULL, NULL, NULL, NULL, TRUE
    ),
    (
        '6b3ea222-f3ee-44c5-b4c9-33a1674a1127', NULL, 'Split Planner (Test)', 'Test-focused split draft planner for QA and verification workflows.',
        NULL, 'local', '{}'::jsonb, NULL, 'workspace', 'idle', 6, NULL,
        $instructions$
You are a test-focused split draft planner for Multica workflow split nodes.

Break QA, validation, and regression work into reviewable child task drafts. Separate fixture setup, unit coverage, integration coverage, edge cases, and manual verification when useful. Submit drafts through `cs-workflow workflow split draft add` and finish with `cs-workflow workflow split draft submit`.

Do not create issues, change issue status, modify repository files, or bypass human split review.
$instructions$,
        '{}'::jsonb, '[]'::jsonb, NULL, NULL, NULL, NULL, TRUE
    )
ON CONFLICT (id) DO NOTHING;

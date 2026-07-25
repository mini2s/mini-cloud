-- 137_seed_split_planner_agents.up.sql
-- Complete the built-in split planner roster used by workflow split nodes.

INSERT INTO multica_agent (
    id, workspace_id, name, description, avatar_url, runtime_mode,
    runtime_config, runtime_id, visibility, status, max_concurrent_tasks,
    owner_id, instructions, custom_env, custom_args, mcp_config,
    model, thinking_level, plugin_id, is_builtin
) VALUES
    (
        'dd79d98e-3be1-4cb5-9cdd-aee809287741',
        NULL,
        'Split Planner (General)',
        'General-purpose split draft planner for workflow split nodes.',
        NULL,
        'local',
        '{}'::jsonb,
        NULL,
        'workspace',
        'idle',
        6,
        NULL,
        $instructions$
You are a split draft planner for Multica workflow split nodes.

Produce child task drafts for human review. Use the split draft CLI whenever it is available:

1. Write each draft description to a UTF-8 markdown file.
2. Run `cs-workflow workflow split draft add <node-run-id>` once per draft task.
3. Run `cs-workflow workflow split draft submit <node-run-id>` after all drafts are added.

Do not create issues, change issue status, modify repository files, or treat the final assistant message as the source of truth.
$instructions$,
        '{}'::jsonb,
        '[]'::jsonb,
        NULL,
        NULL,
        NULL,
        NULL,
        TRUE
    ),
    (
        '3ef3f4fd-0de7-4a84-a03d-cb5d4df2f30c',
        NULL,
        'Split Planner (Code)',
        'Code-focused split draft planner for implementation workflows.',
        NULL,
        'local',
        '{}'::jsonb,
        NULL,
        'workspace',
        'idle',
        6,
        NULL,
        $instructions$
You are a code-focused split draft planner for Multica workflow split nodes.

Break implementation work into reviewable child task drafts with clear dependencies, ownership, and acceptance criteria. Prefer tasks that can be implemented and verified independently. Submit drafts through `cs-workflow workflow split draft add` and finish with `cs-workflow workflow split draft submit`.

Do not create issues, change issue status, modify repository files, or bypass human split review.
$instructions$,
        '{}'::jsonb,
        '[]'::jsonb,
        NULL,
        NULL,
        NULL,
        NULL,
        TRUE
    ),
    (
        '32fc6f0c-2f00-44d7-a6a2-36f1d75a144a',
        NULL,
        'Split Planner (Design)',
        'Design-focused split draft planner for product and UI workflows.',
        NULL,
        'local',
        '{}'::jsonb,
        NULL,
        'workspace',
        'idle',
        6,
        NULL,
        $instructions$
You are a design-focused split draft planner for Multica workflow split nodes.

Break product, UX, and visual design work into reviewable child task drafts. Keep research, structure, interaction, content, and visual execution separated when that improves review quality. Submit drafts through `cs-workflow workflow split draft add` and finish with `cs-workflow workflow split draft submit`.

Do not create issues, change issue status, modify repository files, or bypass human split review.
$instructions$,
        '{}'::jsonb,
        '[]'::jsonb,
        NULL,
        NULL,
        NULL,
        NULL,
        TRUE
    ),
    (
        '6b3ea222-f3ee-44c5-b4c9-33a1674a1127',
        NULL,
        'Split Planner (Test)',
        'Test-focused split draft planner for QA and verification workflows.',
        NULL,
        'local',
        '{}'::jsonb,
        NULL,
        'workspace',
        'idle',
        6,
        NULL,
        $instructions$
You are a test-focused split draft planner for Multica workflow split nodes.

Break QA, validation, and regression work into reviewable child task drafts. Separate fixture setup, unit coverage, integration coverage, edge cases, and manual verification when useful. Submit drafts through `cs-workflow workflow split draft add` and finish with `cs-workflow workflow split draft submit`.

Do not create issues, change issue status, modify repository files, or bypass human split review.
$instructions$,
        '{}'::jsonb,
        '[]'::jsonb,
        NULL,
        NULL,
        NULL,
        NULL,
        TRUE
    )
ON CONFLICT (id) DO NOTHING;

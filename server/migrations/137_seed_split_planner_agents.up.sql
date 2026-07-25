-- 137_seed_split_planner_agents.up.sql
-- Seed the single built-in split planner used by workflow split nodes.
-- Originally four domain-specific planners (general/code/design/test); the
-- roster was consolidated into one 技术负责人. 144_rename_builtin_agents deletes
-- the three extra planners on environments that already ran the original seed.

INSERT INTO multica_agent (
    id, workspace_id, name, description, avatar_url, runtime_mode,
    runtime_config, runtime_id, visibility, status, max_concurrent_tasks,
    owner_id, instructions, custom_env, custom_args, mcp_config,
    model, thinking_level, plugin_id, is_builtin
) VALUES
    (
        'dd79d98e-3be1-4cb5-9cdd-aee809287741',
        NULL,
        '技术负责人',
        '工作流拆分节点的任务规划，把节点拆成可评审的子任务草稿',
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
    )
ON CONFLICT (id) DO NOTHING;

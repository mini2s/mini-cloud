-- Converge deployments that applied migration 145 before its task-split seed
-- definition was corrected. A cloned split reviewer is assigned to the
-- workflow creator by CloneWorkflowFromTemplate.
UPDATE multica_workflow_node
SET format_schema = '{"type":"split","shape":"rectangle","template_id":"task-splitter","template_category":"logic","split_config":{"mode":"barrier","max_concurrency":5,"max_failures":0}}'::jsonb,
    critic_type = 'human',
    critic_id = NULL,
    critic_role_id = NULL,
    critic_api_url = NULL
WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000145'
  AND title = '任务拆解';

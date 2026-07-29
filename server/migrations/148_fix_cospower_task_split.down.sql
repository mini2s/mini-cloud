UPDATE multica_workflow_node
SET format_schema = '{"type":"split","shape":"rectangle","template_id":"task-splitter","template_category":"logic","split_config":{"mode":"barrier","max_concurrency":5,"max_failures":0}}'::jsonb,
    critic_type = 'agent',
    critic_id = 'a6f5d437-93c2-4623-ba0a-bcbb5cb8d1a6',
    critic_role_id = NULL,
    critic_api_url = NULL
WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000145'
  AND title = '任务拆解';

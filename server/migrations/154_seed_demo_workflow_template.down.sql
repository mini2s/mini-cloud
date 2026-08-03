-- 154_seed_demo_workflow_template.down.sql
-- Reverse 154: remove the demo template (cascade drops its node deliverables),
-- the three instruction-driven builtin agents, and the builtin roles this
-- migration seeded into __system_templates__. The __system_templates__ workspace
-- itself is owned by migration 145 and is left intact.

DELETE FROM multica_workflow_edge  WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000152';
DELETE FROM multica_workflow_node  WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000152';
DELETE FROM multica_workflow_stage WHERE workflow_id = 'c0c00000-0000-4000-8000-000000000152';
DELETE FROM multica_workflow       WHERE id         = 'c0c00000-0000-4000-8000-000000000152';

DELETE FROM multica_agent WHERE id IN (
    'c0c00010-0000-4000-8000-000000000152', -- 方案设计师
    'c0c00012-0000-4000-8000-000000000152', -- 任务拆解师
    'c0c00011-0000-4000-8000-000000000152'  -- 编码工程师
);

DELETE FROM multica_workflow_role
WHERE workspace_id = 'c0c00001-0000-4000-8000-000000000145'
  AND is_builtin
  AND normalized_name IN ('developer', 'qa', 'tech_lead');

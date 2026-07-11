-- ═══════════════════════════════════════════════════
-- 全量数据一致性校验
-- ═══════════════════════════════════════════════════

\echo '=== 1. 外键引用完整性 ==='

-- 1.1 node_run → node 的 workflow 是否一致
SELECT 'node_run↔node workflow一致', COUNT(*) FILTER (WHERE wn.workflow_id != wr.workflow_id)
FROM multica_workflow_node_run wnr
JOIN multica_workflow_node wn ON wn.id = wnr.workflow_node_id
JOIN multica_workflow_run wr ON wr.id = wnr.workflow_run_id;

-- 1.2 submission → node_run 的 deliverable 是否对应同 node
SELECT 'submission↔deliverable同node',
  COUNT(*) FILTER (WHERE d.workflow_node_id != wnr.workflow_node_id)
FROM multica_workflow_node_deliverable_submission ds
JOIN multica_workflow_node_deliverable d ON d.id = ds.deliverable_id
JOIN multica_workflow_node_run wnr ON wnr.id = ds.workflow_node_run_id;

-- 1.3 sub_issue → origin_id (node_run) 都存在
SELECT 'sub_issue→origin_node_run',
  COUNT(*) FILTER (WHERE i.parent_issue_id IS NOT NULL AND i.origin_type='workflow' AND wnr.id IS NULL)
FROM multica_issue i
LEFT JOIN multica_workflow_node_run wnr ON wnr.id = i.origin_id
WHERE i.parent_issue_id IS NOT NULL;

-- 1.4 edge → node 同 workflow
SELECT 'edge端点同workflow',
  COUNT(*) FILTER (WHERE e.workflow_id != sn.workflow_id OR e.workflow_id != tn.workflow_id)
FROM multica_workflow_edge e
JOIN multica_workflow_node sn ON sn.id = e.source_node_id
JOIN multica_workflow_node tn ON tn.id = e.target_node_id;

-- 1.5 agent_task → node_run 对应
SELECT 'agent_task→node_run存在',
  COUNT(*) FILTER (WHERE t.workflow_node_run_id IS NOT NULL AND wnr.id IS NULL)
FROM multica_agent_task_queue t
LEFT JOIN multica_workflow_node_run wnr ON wnr.id = t.workflow_node_run_id
WHERE t.workflow_node_run_id IS NOT NULL;

\echo '=== 2. 时间戳一致性 ==='

-- 2.1 completed/failed 必须有 completed_at
SELECT 'completed/failed有completed_at',
  COUNT(*) FILTER (WHERE wnr.status IN ('completed','failed') AND wnr.completed_at IS NULL)
FROM multica_workflow_node_run wnr
JOIN multica_workflow_run wr ON wr.id = wnr.workflow_run_id
WHERE wr.workflow_id='028f13ec-8d4d-49af-907d-7de306f6a2a2';

-- 2.2 pending 不应有 started_at
SELECT 'pending无started_at',
  COUNT(*) FILTER (WHERE wnr.status='pending' AND wnr.started_at IS NOT NULL)
FROM multica_workflow_node_run wnr
JOIN multica_workflow_run wr ON wr.id = wnr.workflow_run_id
WHERE wr.workflow_id='028f13ec-8d4d-49af-907d-7de306f6a2a2';

-- 2.3 working/awaiting_critic 必须有 started_at
SELECT 'active状态有started_at',
  COUNT(*) FILTER (WHERE wnr.status IN ('working','critic_reviewing','awaiting_critic','blocked') AND wnr.started_at IS NULL)
FROM multica_workflow_node_run wnr
JOIN multica_workflow_run wr ON wr.id = wnr.workflow_run_id
WHERE wr.workflow_id='028f13ec-8d4d-49af-907d-7de306f6a2a2';

-- 2.4 started_at <= completed_at
SELECT 'started_at≤completed_at',
  COUNT(*) FILTER (WHERE wnr.started_at IS NOT NULL AND wnr.completed_at IS NOT NULL AND wnr.started_at > wnr.completed_at)
FROM multica_workflow_node_run wnr
JOIN multica_workflow_run wr ON wr.id = wnr.workflow_run_id
WHERE wr.workflow_id='028f13ec-8d4d-49af-907d-7de306f6a2a2';

\echo '=== 3. 状态逻辑一致性 ==='

-- 3.1 approved deliverable 的节点应该处于合理状态
SELECT 'approved交付物节点状态',
  COUNT(*) FILTER (WHERE ds.status='approved' AND wnr.status NOT IN ('completed','awaiting_critic','critic_reviewing'))
FROM multica_workflow_node_deliverable_submission ds
JOIN multica_workflow_node_run wnr ON wnr.id = ds.workflow_node_run_id;

-- 3.2 missing deliverable 的节点应该是 blocked 或 failed
SELECT 'missing交付物节点状态',
  COUNT(*) FILTER (WHERE ds.status='missing' AND wnr.status NOT IN ('blocked','failed'))
FROM multica_workflow_node_deliverable_submission ds
JOIN multica_workflow_node_run wnr ON wnr.id = ds.workflow_node_run_id;

-- 3.3 父Issue workflow_run_id 已设置
SELECT '父Issue有run_id',
  COUNT(*) FILTER (WHERE workflow_run_id IS NULL)
FROM multica_issue
WHERE workflow_id='028f13ec-8d4d-49af-907d-7de306f6a2a2' AND parent_issue_id IS NULL;

\echo '=== 4. 覆盖完整性 ==='

-- 4.1 每个 node 有对应 node_run
SELECT 'node→node_run 1:1',
  COUNT(*) FILTER (WHERE wnr.id IS NULL)
FROM multica_workflow_node wn
LEFT JOIN multica_workflow_node_run wnr ON wnr.workflow_node_id = wn.id
  AND wnr.workflow_run_id = (SELECT id FROM multica_workflow_run WHERE workflow_id='028f13ec-8d4d-49af-907d-7de306f6a2a2')
WHERE wn.workflow_id = '028f13ec-8d4d-49af-907d-7de306f6a2a2';

-- 4.2 每个 node 有对应 sub_issue
SELECT 'node→sub_issue 1:1',
  COUNT(*) FILTER (WHERE i.id IS NULL)
FROM multica_workflow_node wn
LEFT JOIN multica_workflow_node_run wnr ON wnr.workflow_node_id = wn.id
  AND wnr.workflow_run_id = (SELECT id FROM multica_workflow_run WHERE workflow_id='028f13ec-8d4d-49af-907d-7de306f6a2a2')
LEFT JOIN multica_issue i ON i.origin_id = wnr.id AND i.origin_type = 'workflow'
WHERE wn.workflow_id = '028f13ec-8d4d-49af-907d-7de306f6a2a2';

-- 4.3 每个 node 有交付物定义
SELECT 'node→deliverable定义',
  COUNT(*) FILTER (WHERE d.id IS NULL)
FROM multica_workflow_node wn
LEFT JOIN multica_workflow_node_deliverable d ON d.workflow_node_id = wn.id
WHERE wn.workflow_id = '028f13ec-8d4d-49af-907d-7de306f6a2a2';

-- 4.4 agent worker 有 worker_id
SELECT 'agent_worker有id',
  COUNT(*) FILTER (WHERE worker_type='agent' AND worker_id IS NULL)
FROM multica_workflow_node_run wnr
JOIN multica_workflow_run wr ON wr.id = wnr.workflow_run_id
WHERE wr.workflow_id='028f13ec-8d4d-49af-907d-7de306f6a2a2';

-- 4.5 human worker 有 worker_id
SELECT 'human_worker有id',
  COUNT(*) FILTER (WHERE worker_type='human' AND worker_id IS NULL)
FROM multica_workflow_node_run wnr
JOIN multica_workflow_run wr ON wr.id = wnr.workflow_run_id
WHERE wr.workflow_id='028f13ec-8d4d-49af-907d-7de306f6a2a2';

\echo '=== 5. DAG 连通性 ==='

-- 5.1 无自环
SELECT '无自环', COUNT(*) FILTER (WHERE source_node_id = target_node_id)
FROM multica_workflow_edge WHERE workflow_id='028f13ec-8d4d-49af-907d-7de306f6a2a2';

-- 5.2 孤立节点
WITH has_edge AS (
  SELECT DISTINCT unnest(ARRAY[source_node_id, target_node_id]) as node_id
  FROM multica_workflow_edge WHERE workflow_id='028f13ec-8d4d-49af-907d-7de306f6a2a2'
)
SELECT '孤立节点', COUNT(*),
  STRING_AGG(wn.title, ', ')
FROM multica_workflow_node wn
WHERE wn.workflow_id = '028f13ec-8d4d-49af-907d-7de306f6a2a2'
  AND wn.id NOT IN (SELECT node_id FROM has_edge);

\echo '=== 6. Task 与 Node Run 状态对应 ==='

-- 6.1 completed node → task completed
SELECT 'completed节点→task完成',
  COUNT(*) FILTER (WHERE wnr.status='completed' AND wnr.worker_agent_task_id IS NOT NULL AND t.status != 'completed')
FROM multica_workflow_node_run wnr
LEFT JOIN multica_agent_task_queue t ON t.id = wnr.worker_agent_task_id
JOIN multica_workflow_run wr ON wr.id = wnr.workflow_run_id
WHERE wr.workflow_id='028f13ec-8d4d-49af-907d-7de306f6a2a2'
  AND wnr.worker_agent_task_id IS NOT NULL;

-- 6.2 failed node → task failed
SELECT 'failed节点→task失败',
  COUNT(*) FILTER (WHERE wnr.status='failed' AND wnr.worker_agent_task_id IS NOT NULL AND t.status != 'failed')
FROM multica_workflow_node_run wnr
LEFT JOIN multica_agent_task_queue t ON t.id = wnr.worker_agent_task_id
JOIN multica_workflow_run wr ON wr.id = wnr.workflow_run_id
WHERE wr.workflow_id='028f13ec-8d4d-49af-907d-7de306f6a2a2'
  AND wnr.worker_agent_task_id IS NOT NULL;

-- 6.3 failed task 有 error 信息
SELECT 'failed_task有error',
  COUNT(*) FILTER (WHERE t.status='failed' AND (t.error IS NULL OR t.error=''))
FROM multica_agent_task_queue t
JOIN multica_workflow_node_run wnr ON wnr.id = t.workflow_node_run_id
JOIN multica_workflow_run wr ON wr.id = wnr.workflow_run_id
WHERE wr.workflow_id='028f13ec-8d4d-49af-907d-7de306f6a2a2';

\echo '=== 7. 评论与会话一致性 ==='

-- 7.1 comment issue 存在
SELECT 'comment→issue',
  COUNT(*) FILTER (WHERE i.id IS NULL)
FROM multica_comment c
LEFT JOIN multica_issue i ON i.id = c.issue_id
WHERE c.issue_id IN (SELECT id FROM multica_issue WHERE workflow_id='028f13ec-8d4d-49af-907d-7de306f6a2a2');

-- 7.2 chat_message → chat_session
SELECT 'message→session',
  COUNT(*) FILTER (WHERE cs.id IS NULL)
FROM multica_chat_message cm
LEFT JOIN multica_chat_session cs ON cs.id = cm.chat_session_id;

-- 7.3 activity_log → issue
SELECT 'activity→issue',
  COUNT(*) FILTER (WHERE i.id IS NULL)
FROM multica_activity_log al
LEFT JOIN multica_issue i ON i.id = al.issue_id
WHERE al.issue_id IN (SELECT id FROM multica_issue WHERE workflow_id='028f13ec-8d4d-49af-907d-7de306f6a2a2');

-- 7.4 worker_agent_task_id 与 task 的 node_run_id 互相对应
SELECT 'worker_task互相引用',
  COUNT(*) FILTER (WHERE wnr.worker_agent_task_id IS NOT NULL AND t.id IS NOT NULL AND t.workflow_node_run_id != wnr.id)
FROM multica_workflow_node_run wnr
LEFT JOIN multica_agent_task_queue t ON t.id = wnr.worker_agent_task_id
JOIN multica_workflow_run wr ON wr.id = wnr.workflow_run_id
WHERE wr.workflow_id='028f13ec-8d4d-49af-907d-7de306f6a2a2'
  AND wnr.worker_agent_task_id IS NOT NULL;

\echo '=== 8. Issue 编号连续 ==='

SELECT 'issue编号', COUNT(*), MIN(number), MAX(number),
  CASE WHEN MAX(number) - MIN(number) + 1 = COUNT(*) THEN 'PASS' ELSE 'FAIL: 有间隙' END
FROM multica_issue
WHERE workflow_id='028f13ec-8d4d-49af-907d-7de306f6a2a2';

\echo '=== DONE ==='

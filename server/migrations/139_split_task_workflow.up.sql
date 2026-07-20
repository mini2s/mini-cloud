ALTER TABLE multica_workflow_split_task
  ADD COLUMN IF NOT EXISTS workflow_id UUID REFERENCES multica_workflow(id),
  ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS dispatch_key TEXT,
  ADD COLUMN IF NOT EXISTS last_error JSONB;

ALTER TABLE multica_workflow_run
  ADD COLUMN IF NOT EXISTS dispatch_key TEXT;

CREATE INDEX IF NOT EXISTS idx_workflow_split_task_workflow
ON multica_workflow_split_task(workflow_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_split_task_dispatch_key
ON multica_workflow_split_task(dispatch_key)
WHERE dispatch_key IS NOT NULL AND dispatch_key <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_run_dispatch_key
ON multica_workflow_run(dispatch_key)
WHERE dispatch_key IS NOT NULL AND dispatch_key <> '';

WITH split_task_workflow_candidates AS (
  SELECT
    st.id,
    COALESCE(
      child_run.workflow_id,
      child_issue.workflow_id,
      CASE
        WHEN wn.format_schema #>> '{split_config,default_issue_workflow_id}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (wn.format_schema #>> '{split_config,default_issue_workflow_id}')::uuid
      END,
      CASE
        WHEN wn.format_schema #>> '{split_config,child_workflow_id}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (wn.format_schema #>> '{split_config,child_workflow_id}')::uuid
      END,
      CASE
        WHEN wn.format_schema #>> '{split_config,sub_template_id}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (wn.format_schema #>> '{split_config,sub_template_id}')::uuid
      END
    ) AS workflow_id
  FROM multica_workflow_split_task st
  JOIN multica_workflow_node_run wnr ON wnr.id = st.node_run_id
  JOIN multica_workflow_node wn ON wn.id = wnr.workflow_node_id
  LEFT JOIN multica_workflow_run child_run ON child_run.id = st.run_id
  LEFT JOIN multica_issue child_issue ON child_issue.id = st.issue_id
  WHERE st.workflow_id IS NULL
)
UPDATE multica_workflow_split_task st
SET workflow_id = candidates.workflow_id
FROM split_task_workflow_candidates candidates
JOIN multica_workflow wf ON wf.id = candidates.workflow_id
WHERE st.id = candidates.id
  AND st.workflow_id IS NULL;

ALTER TABLE multica_workflow_split_task
  ALTER COLUMN workflow_id SET NOT NULL;

ALTER TABLE multica_workflow_node_run
  ADD COLUMN IF NOT EXISTS split_config_version BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS split_initial_dispatch_completed BOOLEAN NOT NULL DEFAULT false;

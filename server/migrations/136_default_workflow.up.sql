-- 136_default_workflow.up.sql
-- Default (system) workflow per workspace: archive sink for issues assigned to
-- agent/member/squad that have no bound workflow. See
-- docs/superpowers/specs/2026-07-20-default-workflow-archive-design.md

ALTER TABLE multica_workflow
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

-- Allow system-created default workflows (created_by_type='system', no author).
-- The original CHECK was named against the pre-rename table `workflow`
-- (migration 108 created it; 114 only renamed the table, constraints keep their
-- original names), so the constraint name is workflow_created_by_type_check.
ALTER TABLE multica_workflow DROP CONSTRAINT IF EXISTS workflow_created_by_type_check;
ALTER TABLE multica_workflow
  ADD CONSTRAINT workflow_created_by_type_check CHECK (created_by_type IN ('member', 'agent', 'system'));
ALTER TABLE multica_workflow ALTER COLUMN created_by_id DROP NOT NULL;

-- At most one default workflow per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_workflow_default_per_workspace
  ON multica_workflow (workspace_id)
  WHERE is_default = TRUE;

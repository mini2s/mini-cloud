-- 136_default_workflow.down.sql
-- Drop default workflows first so created_by_id can be NOT NULL again.
DELETE FROM multica_workflow WHERE is_default = TRUE;
DROP INDEX IF EXISTS uniq_workflow_default_per_workspace;

ALTER TABLE multica_workflow ALTER COLUMN created_by_id SET NOT NULL;
ALTER TABLE multica_workflow DROP CONSTRAINT IF EXISTS workflow_created_by_type_check;
ALTER TABLE multica_workflow
  ADD CONSTRAINT workflow_created_by_type_check CHECK (created_by_type IN ('member', 'agent'));

ALTER TABLE multica_workflow DROP COLUMN IF EXISTS is_default;

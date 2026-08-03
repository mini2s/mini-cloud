-- Idempotent: this migration was previously shipped as 142_workflow_runtime_selection_policy
-- and renumbered to 143 to resolve a numbering collision with 142_workflow_boundary_nodes.
-- Environments that already ran the old 142 have these columns/constraints in place (and a
-- ghost `142_workflow_runtime_selection_policy` row in schema_migrations), so re-running 143
-- must be a no-op there. ADD COLUMN IF NOT EXISTS + guarded constraints make that safe.

ALTER TABLE multica_workflow
    ADD COLUMN IF NOT EXISTS default_runtime_selection_policy TEXT NOT NULL DEFAULT 'idle_first',
    ADD COLUMN IF NOT EXISTS default_runtime_id UUID REFERENCES multica_agent_runtime(id) ON DELETE SET NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'workflow_default_runtime_selection_policy_check'
    ) THEN
        ALTER TABLE multica_workflow
            ADD CONSTRAINT workflow_default_runtime_selection_policy_check
                CHECK (default_runtime_selection_policy IN (
                    'specified_runtime_first',
                    'idle_first',
                    'issue_creator_first'
                ));
    END IF;
END $$;

ALTER TABLE multica_workflow_run
    ADD COLUMN IF NOT EXISTS runtime_selection_policy TEXT NOT NULL DEFAULT 'idle_first';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'workflow_run_runtime_selection_policy_check'
    ) THEN
        ALTER TABLE multica_workflow_run
            ADD CONSTRAINT workflow_run_runtime_selection_policy_check
                CHECK (runtime_selection_policy IN (
                    'specified_runtime_first',
                    'idle_first',
                    'issue_creator_first'
                ));
    END IF;
END $$;

-- Backfill runs bound to a specific runtime to "specified_runtime_first". Guarded so a
-- re-run only touches rows that still differ, leaving any later manual override intact.
UPDATE multica_workflow_run
SET runtime_selection_policy = 'specified_runtime_first'
WHERE runtime_id IS NOT NULL
  AND runtime_selection_policy IS DISTINCT FROM 'specified_runtime_first';

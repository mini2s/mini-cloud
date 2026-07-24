ALTER TABLE multica_workflow_run
    DROP CONSTRAINT IF EXISTS workflow_run_runtime_selection_policy_check,
    DROP COLUMN IF EXISTS runtime_selection_policy;

ALTER TABLE multica_workflow
    DROP CONSTRAINT IF EXISTS workflow_default_runtime_selection_policy_check,
    DROP COLUMN IF EXISTS default_runtime_id,
    DROP COLUMN IF EXISTS default_runtime_selection_policy;

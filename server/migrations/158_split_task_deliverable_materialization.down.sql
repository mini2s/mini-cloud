UPDATE multica_workflow_node_run
SET status = 'failed',
    failure_reason = 'split_materialization_rollback',
    completed_at = COALESCE(completed_at, now()),
    updated_at = now()
WHERE status = 'materializing';

DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'multica_workflow_node_run'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%';

    IF FOUND THEN
        EXECUTE format('ALTER TABLE multica_workflow_node_run DROP CONSTRAINT %I', constraint_name);
    ELSE
        constraint_name := 'workflow_node_run_status_check';
    END IF;

    EXECUTE format('ALTER TABLE multica_workflow_node_run ADD CONSTRAINT %I CHECK (status IN (
        ''pending'', ''format_checking'', ''format_ok'', ''format_failed'',
        ''worker_assigned'', ''working'', ''awaiting_input'', ''awaiting_critic'',
        ''critic_reviewing'', ''critic_approved'', ''critic_rework'', ''splitting'',
        ''awaiting_split_review'', ''split_active'', ''completed'', ''failed'',
        ''blocked'', ''skipped'', ''cancelled''
    ))', constraint_name);
END $$;

DROP INDEX IF EXISTS uq_issue_workflow_split_origin;

ALTER TABLE multica_workflow_node_run_dispatch_job
    DROP CONSTRAINT IF EXISTS workflow_dispatch_split_generation_check,
    DROP CONSTRAINT IF EXISTS workflow_dispatch_split_generation_fkey,
    DROP COLUMN IF EXISTS split_plan_generation;

DROP INDEX IF EXISTS idx_workflow_split_task_generation_draft_key;
CREATE UNIQUE INDEX idx_workflow_split_task_node_run_draft_key
    ON multica_workflow_split_task(node_run_id, draft_key)
    WHERE draft_key IS NOT NULL AND draft_key <> '' AND status <> 'discarded';

ALTER TABLE multica_workflow_split_task
    DROP CONSTRAINT IF EXISTS workflow_split_task_generation_required_check,
    DROP CONSTRAINT IF EXISTS workflow_split_task_generation_fkey,
    DROP CONSTRAINT IF EXISTS multica_workflow_split_task_status_check;
ALTER TABLE multica_workflow_split_task
    ADD CONSTRAINT multica_workflow_split_task_status_check CHECK (status IN (
        'draft', 'approved', 'discarded', 'created', 'running', 'done', 'failed', 'cancelled', 'skipped'
    ));
ALTER TABLE multica_workflow_split_task
    DROP COLUMN IF EXISTS materialize_next_attempt_at,
    DROP COLUMN IF EXISTS materialize_retry_count,
    DROP COLUMN IF EXISTS split_plan_generation;

DROP TABLE IF EXISTS multica_workflow_split_snapshot;
DROP TABLE IF EXISTS multica_workflow_split_generation;

DROP INDEX IF EXISTS uq_workflow_node_run_split_task_plan_deliverable;
DELETE FROM multica_workflow_node_run_deliverable WHERE purpose = 'split_task_plan';
ALTER TABLE multica_workflow_node_run_deliverable DROP COLUMN IF EXISTS purpose;
ALTER TABLE multica_workflow_node_run DROP COLUMN IF EXISTS split_plan_generation;

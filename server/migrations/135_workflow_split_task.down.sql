DROP TABLE IF EXISTS multica_workflow_split_task;

DO $$
DECLARE
    cn text;
BEGIN
    SELECT conname INTO cn
    FROM pg_constraint
    WHERE conrelid = 'multica_workflow_node_run'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%';

    IF FOUND THEN
        EXECUTE format('ALTER TABLE multica_workflow_node_run DROP CONSTRAINT %I', cn);
    ELSE
        cn := 'workflow_node_run_status_check';
    END IF;

    EXECUTE format('ALTER TABLE multica_workflow_node_run ADD CONSTRAINT %I CHECK (status IN (
        ''pending'',
        ''format_checking'',
        ''format_ok'',
        ''format_failed'',
        ''worker_assigned'',
        ''working'',
        ''awaiting_input'',
        ''awaiting_critic'',
        ''critic_reviewing'',
        ''critic_approved'',
        ''critic_rework'',
        ''completed'',
        ''failed'',
        ''blocked'',
        ''skipped'',
        ''cancelled''
    ))', cn);
END $$;

ALTER TABLE multica_issue DROP CONSTRAINT IF EXISTS issue_origin_type_check;
ALTER TABLE multica_issue ADD CONSTRAINT issue_origin_type_check
    CHECK (origin_type IN ('autopilot', 'quick_create', 'workflow'));

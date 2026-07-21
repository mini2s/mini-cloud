CREATE TABLE IF NOT EXISTS multica_workflow_split_task (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_run_id UUID NOT NULL REFERENCES multica_workflow_node_run(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES multica_workspace(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    suggested_assignee_type TEXT,
    suggested_assignee_id UUID,
    depends_on JSONB NOT NULL DEFAULT '[]',
    sort_order INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft',
        'approved',
        'discarded',
        'created',
        'running',
        'done',
        'failed',
        'cancelled',
        'skipped'
    )),
    issue_id UUID REFERENCES multica_issue(id) ON DELETE SET NULL,
    run_id UUID REFERENCES multica_workflow_run(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_split_task_node_run ON multica_workflow_split_task(node_run_id);
CREATE INDEX IF NOT EXISTS idx_workflow_split_task_issue ON multica_workflow_split_task(issue_id);
CREATE INDEX IF NOT EXISTS idx_workflow_split_task_run ON multica_workflow_split_task(run_id);

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
        ''splitting'',
        ''awaiting_split_review'',
        ''split_active'',
        ''completed'',
        ''failed'',
        ''blocked'',
        ''skipped'',
        ''cancelled''
    ))', cn);
END $$;

ALTER TABLE multica_issue DROP CONSTRAINT IF EXISTS issue_origin_type_check;
ALTER TABLE multica_issue ADD CONSTRAINT issue_origin_type_check
    CHECK (origin_type IN ('autopilot', 'quick_create', 'workflow', 'workflow_split'));

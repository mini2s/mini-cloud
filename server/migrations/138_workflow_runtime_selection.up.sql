ALTER TABLE multica_workflow_run
    ADD COLUMN source_issue_id UUID REFERENCES multica_issue(id) ON DELETE SET NULL,
    ADD COLUMN responsible_user_id UUID REFERENCES multica_user(id) ON DELETE SET NULL,
    ADD COLUMN runtime_authorizer_id UUID REFERENCES multica_user(id) ON DELETE SET NULL;

ALTER TABLE multica_workflow_node_run
    ADD COLUMN runtime_selection_reason TEXT,
    ADD COLUMN failure_reason TEXT,
    ADD CONSTRAINT workflow_node_run_runtime_selection_reason_check
        CHECK (runtime_selection_reason IS NULL OR runtime_selection_reason IN (
            'manual', 'idle', 'issue_creator', 'agent_binding'
        ));

CREATE INDEX idx_workflow_run_source_issue_id
    ON multica_workflow_run(source_issue_id);

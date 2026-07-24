ALTER TABLE multica_workflow
    ADD COLUMN default_runtime_selection_policy TEXT NOT NULL DEFAULT 'idle_first',
    ADD COLUMN default_runtime_id UUID REFERENCES multica_agent_runtime(id) ON DELETE SET NULL,
    ADD CONSTRAINT workflow_default_runtime_selection_policy_check
        CHECK (default_runtime_selection_policy IN (
            'specified_runtime_first',
            'idle_first',
            'issue_creator_first'
        ));

ALTER TABLE multica_workflow_run
    ADD COLUMN runtime_selection_policy TEXT NOT NULL DEFAULT 'idle_first',
    ADD CONSTRAINT workflow_run_runtime_selection_policy_check
        CHECK (runtime_selection_policy IN (
            'specified_runtime_first',
            'idle_first',
            'issue_creator_first'
        ));

UPDATE multica_workflow_run
SET runtime_selection_policy = 'specified_runtime_first'
WHERE runtime_id IS NOT NULL;

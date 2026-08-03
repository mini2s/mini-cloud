ALTER TABLE multica_workflow_node_deliverable_submission
    ADD COLUMN IF NOT EXISTS pull_request_title text NOT NULL DEFAULT '';

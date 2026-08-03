ALTER TABLE multica_workflow_node_run_deliverable ADD COLUMN kind TEXT;
ALTER TABLE multica_workflow_node_deliverable
    ADD COLUMN kind TEXT NOT NULL DEFAULT 'document' CHECK (kind IN ('document', 'pull_request'));
ALTER TABLE multica_workflow_node_deliverable ALTER COLUMN kind DROP DEFAULT;

-- Allow multiple link submissions per deliverable: a pull_request deliverable
-- may carry several code links, each its own submission row keyed by its
-- review URL. Document/text submissions (pull_request_url = '') keep their
-- one-row-per-deliverable semantics because their key is unchanged.
-- (The old constraint name below is Postgres's 63-char truncation of the
-- inline UNIQUE(workflow_node_run_id, deliverable_id) from migration 133.)
ALTER TABLE multica_workflow_node_deliverable_submission
    DROP CONSTRAINT IF EXISTS multica_workflow_node_deliver_workflow_node_run_id_delivera_key;

ALTER TABLE multica_workflow_node_deliverable_submission
    ADD CONSTRAINT uq_node_run_deliverable_submission_url
    UNIQUE (workflow_node_run_id, deliverable_id, pull_request_url);

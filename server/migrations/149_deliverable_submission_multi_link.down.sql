-- Restore one submission row per (node_run, deliverable). Multi-link rows
-- created under migration 149 collapse to their latest row per pair first so
-- the stricter constraint can be re-added.
WITH ranked AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY workflow_node_run_id, deliverable_id
               ORDER BY created_at DESC, id DESC
           ) AS row_num
    FROM multica_workflow_node_deliverable_submission
)
DELETE FROM multica_workflow_node_deliverable_submission submission
USING ranked
WHERE submission.id = ranked.id
  AND ranked.row_num > 1;

ALTER TABLE multica_workflow_node_deliverable_submission
    DROP CONSTRAINT IF EXISTS uq_node_run_deliverable_submission_url;

-- NOTE: re-creates migration 133's constraint under Postgres's auto-truncated
-- name (63-char limit), matching the pre-149 schema.
ALTER TABLE multica_workflow_node_deliverable_submission
    ADD CONSTRAINT multica_workflow_node_deliver_workflow_node_run_id_delivera_key
    UNIQUE (workflow_node_run_id, deliverable_id);

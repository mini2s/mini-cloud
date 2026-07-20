DROP TABLE IF EXISTS multica_workflow_role_resolution_call;
DROP TABLE IF EXISTS multica_workflow_role_resolution_event;
DROP TABLE IF EXISTS multica_workflow_role_resolution_job;
DROP TABLE IF EXISTS multica_workflow_role_resolution;

UPDATE multica_workflow_run SET status = 'failed'
WHERE status IN ('resolving_roles', 'waiting_role_assignment');
ALTER TABLE multica_workflow_run
    DROP CONSTRAINT IF EXISTS workflow_run_status_check,
    ADD CONSTRAINT workflow_run_status_check CHECK (status IN ('running', 'completed', 'failed', 'cancelled'));

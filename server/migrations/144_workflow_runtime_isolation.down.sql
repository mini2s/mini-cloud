DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM multica_workflow_run WHERE definition_schema_version > 0
    ) THEN
        RAISE EXCEPTION 'cannot roll back after native snapshot runs exist';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM multica_workflow_node_run nr
        LEFT JOIN multica_workflow_node n ON n.id = nr.source_workflow_node_id
        WHERE n.id IS NULL
    ) THEN
        RAISE EXCEPTION 'cannot restore workflow_node_id: source node is missing';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM multica_workflow_node_deliverable_submission submission
        JOIN multica_workflow_node_run_deliverable requirement
          ON requirement.id = submission.deliverable_id
        LEFT JOIN multica_workflow_node_deliverable definition
          ON definition.id = requirement.source_deliverable_id
        WHERE definition.id IS NULL
    ) THEN
        RAISE EXCEPTION 'cannot restore deliverable_id: source deliverable is missing';
    END IF;
END $$;

ALTER TABLE multica_workflow_node_deliverable_submission
    DROP CONSTRAINT workflow_node_deliverable_submission_runtime_deliverable_fkey;

UPDATE multica_workflow_node_deliverable_submission submission
SET deliverable_id = requirement.source_deliverable_id
FROM multica_workflow_node_run_deliverable requirement
WHERE requirement.id = submission.deliverable_id;

ALTER TABLE multica_workflow_node_deliverable_submission
    ADD CONSTRAINT multica_workflow_node_deliverable_submissio_deliverable_id_fkey
    FOREIGN KEY (deliverable_id)
    REFERENCES multica_workflow_node_deliverable(id) ON DELETE CASCADE;

ALTER TABLE multica_workflow_run
    DROP CONSTRAINT workflow_run_workflow_id_fkey,
    ADD CONSTRAINT workflow_run_workflow_id_fkey
        FOREIGN KEY (workflow_id) REFERENCES multica_workflow(id) ON DELETE CASCADE;

DROP TRIGGER fill_source_workflow_node_id ON multica_workflow_node_run;
DROP FUNCTION multica_fill_source_workflow_node_id();

ALTER TABLE multica_workflow_node_run
    ADD CONSTRAINT workflow_node_run_workflow_node_id_fkey
    FOREIGN KEY (workflow_node_id) REFERENCES multica_workflow_node(id) ON DELETE CASCADE;

DROP INDEX idx_agent_task_workflow_dispatch_job;
ALTER TABLE multica_agent_task_queue DROP COLUMN workflow_dispatch_job_id;

DROP TABLE multica_workflow_node_run_dispatch_job;
DROP TABLE multica_workflow_run_edge;
DROP TABLE multica_workflow_node_run_deliverable;

ALTER TABLE multica_workflow_node_run
    DROP CONSTRAINT workflow_node_run_run_id_id_key,
    DROP COLUMN source_workflow_node_id,
    DROP COLUMN node_description,
    DROP COLUMN format_schema,
    DROP COLUMN critic_api_url,
    DROP COLUMN stage_snapshot,
    DROP COLUMN worker_role_snapshot,
    DROP COLUMN critic_role_snapshot,
    DROP COLUMN runtime_config,
    DROP COLUMN worker_name_snapshot,
    DROP COLUMN critic_name_snapshot;

ALTER TABLE multica_workflow_run
    DROP COLUMN source_config_revision,
    DROP COLUMN definition_schema_version,
    DROP COLUMN definition_snapshot,
    DROP COLUMN max_retries,
    DROP COLUMN failure_reason,
    DROP COLUMN validation_errors;

ALTER TABLE multica_workflow DROP COLUMN config_revision;

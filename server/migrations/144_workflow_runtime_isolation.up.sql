DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM multica_workflow_run
        WHERE status IN ('running', 'resolving_roles', 'waiting_role_assignment')
    ) THEN
        RAISE EXCEPTION 'workflow runtime isolation requires all legacy runs to be terminal';
    END IF;
END $$;

ALTER TABLE multica_workflow
    ADD COLUMN config_revision BIGINT NOT NULL DEFAULT 0;

ALTER TABLE multica_workflow_run
    ADD COLUMN source_config_revision BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN definition_schema_version INT NOT NULL DEFAULT 0,
    ADD COLUMN definition_snapshot JSONB NOT NULL
        DEFAULT '{"schema_version":0,"snapshot_origin":"legacy_backfill"}'::jsonb,
    ADD COLUMN max_retries INT NOT NULL DEFAULT 0,
    ADD COLUMN failure_reason TEXT,
    ADD COLUMN validation_errors JSONB;

ALTER TABLE multica_workflow_node_run
    ADD COLUMN source_workflow_node_id UUID,
    ADD COLUMN node_description TEXT NOT NULL DEFAULT '',
    ADD COLUMN format_schema JSONB,
    ADD COLUMN critic_api_url TEXT,
    ADD COLUMN stage_snapshot JSONB,
    ADD COLUMN worker_role_snapshot JSONB,
    ADD COLUMN critic_role_snapshot JSONB,
    ADD COLUMN runtime_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN worker_name_snapshot TEXT NOT NULL DEFAULT '',
    ADD COLUMN critic_name_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE multica_workflow_node_run
    ADD CONSTRAINT workflow_node_run_run_id_id_key UNIQUE (workflow_run_id, id);

CREATE TABLE multica_workflow_run_edge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_run_id UUID NOT NULL REFERENCES multica_workflow_run(id) ON DELETE CASCADE,
    source_node_run_id UUID NOT NULL,
    target_node_run_id UUID NOT NULL,
    condition JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workflow_run_id, source_node_run_id, target_node_run_id),
    FOREIGN KEY (workflow_run_id, source_node_run_id)
        REFERENCES multica_workflow_node_run(workflow_run_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_run_id, target_node_run_id)
        REFERENCES multica_workflow_node_run(workflow_run_id, id) ON DELETE CASCADE,
    CHECK (source_node_run_id <> target_node_run_id)
);

CREATE INDEX idx_workflow_run_edge_run
    ON multica_workflow_run_edge(workflow_run_id);
CREATE INDEX idx_workflow_run_edge_source
    ON multica_workflow_run_edge(source_node_run_id);
CREATE INDEX idx_workflow_run_edge_target
    ON multica_workflow_run_edge(target_node_run_id);

CREATE TABLE multica_workflow_node_run_deliverable (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_node_run_id UUID NOT NULL REFERENCES multica_workflow_node_run(id) ON DELETE CASCADE,
    source_deliverable_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('document', 'pull_request')),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    required BOOLEAN NOT NULL,
    sort_order INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workflow_node_run_id, source_deliverable_id)
);

CREATE INDEX idx_workflow_node_run_deliverable_node_run
    ON multica_workflow_node_run_deliverable(workflow_node_run_id, sort_order);

CREATE TABLE multica_workflow_node_run_dispatch_job (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_run_id UUID NOT NULL REFERENCES multica_workflow_run(id) ON DELETE CASCADE,
    workflow_node_run_id UUID NOT NULL,
    phase TEXT NOT NULL,
    generation INT NOT NULL CHECK (generation > 0),
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
    attempt_count INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_by TEXT,
    lease_expires_at TIMESTAMPTZ,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workflow_node_run_id, phase, generation),
    FOREIGN KEY (workflow_run_id, workflow_node_run_id)
        REFERENCES multica_workflow_node_run(workflow_run_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_workflow_dispatch_job_claim
    ON multica_workflow_node_run_dispatch_job(scheduled_at, created_at)
    WHERE status = 'pending';
CREATE INDEX idx_workflow_dispatch_job_run
    ON multica_workflow_node_run_dispatch_job(workflow_run_id);
CREATE INDEX idx_workflow_dispatch_job_node_run
    ON multica_workflow_node_run_dispatch_job(workflow_node_run_id);

ALTER TABLE multica_agent_task_queue
    ADD COLUMN workflow_dispatch_job_id UUID
        REFERENCES multica_workflow_node_run_dispatch_job(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX idx_agent_task_workflow_dispatch_job
    ON multica_agent_task_queue(workflow_dispatch_job_id)
    WHERE workflow_dispatch_job_id IS NOT NULL;

UPDATE multica_workflow_run wr
SET source_config_revision = w.config_revision,
    definition_schema_version = 0,
    max_retries = w.max_retries,
    definition_snapshot = jsonb_build_object(
        'schema_version', 0,
        'snapshot_origin', 'legacy_backfill',
        'workflow', jsonb_build_object(
            'id', w.id,
            'title', w.title,
            'description', w.description,
            'max_retries', w.max_retries,
            'runtime_selection_policy', wr.runtime_selection_policy,
            'runtime_id', wr.runtime_id
        ),
        'nodes', COALESCE((
            SELECT jsonb_agg(to_jsonb(n) ORDER BY n.sort_order, n.id)
            FROM multica_workflow_node n
            WHERE n.workflow_id = w.id
        ), '[]'::jsonb),
        'edges', COALESCE((
            SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at, e.id)
            FROM multica_workflow_edge e
            WHERE e.workflow_id = w.id
        ), '[]'::jsonb),
        'stages', COALESCE((
            SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_order, s.id)
            FROM multica_workflow_stage s
            WHERE s.workflow_id = w.id
        ), '[]'::jsonb)
    )
FROM multica_workflow w
WHERE w.id = wr.workflow_id;

UPDATE multica_workflow_run wr
SET definition_snapshot = wr.definition_snapshot || jsonb_build_object(
    'roles', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', r.id,
            'name', r.name,
            'description', r.description
        ) ORDER BY r.id)
        FROM multica_workflow_role r
        WHERE EXISTS (
            SELECT 1
            FROM multica_workflow_node n
            WHERE n.workflow_id = wr.workflow_id
              AND (n.worker_role_id = r.id OR n.critic_role_id = r.id)
        )
    ), '[]'::jsonb),
    'deliverables', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', d.id,
            'workflow_node_id', d.workflow_node_id,
            'kind', d.kind,
            'title', d.title,
            'description', d.description,
            'required', d.required,
            'sort_order', d.sort_order
        ) ORDER BY d.sort_order, d.id)
        FROM multica_workflow_node_deliverable d
        JOIN multica_workflow_node n ON n.id = d.workflow_node_id
        WHERE n.workflow_id = wr.workflow_id
    ), '[]'::jsonb)
);

UPDATE multica_workflow_node_run nr
SET source_workflow_node_id = nr.workflow_node_id,
    node_description = n.description,
    format_schema = n.format_schema,
    critic_api_url = n.critic_api_url,
    stage_snapshot = CASE WHEN stage.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', stage.id,
        'name', stage.name,
        'description', stage.description,
        'sort_order', stage.sort_order
    ) END,
    worker_role_snapshot = CASE WHEN worker_role.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', worker_role.id,
        'name', worker_role.name,
        'description', worker_role.description
    ) END,
    critic_role_snapshot = CASE WHEN critic_role.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', critic_role.id,
        'name', critic_role.name,
        'description', critic_role.description
    ) END,
    runtime_config = COALESCE(n.format_schema, '{}'::jsonb),
    worker_name_snapshot = COALESCE(CASE n.worker_type
        WHEN 'human' THEN (SELECT u.name FROM multica_user u WHERE u.id = n.worker_id)
        WHEN 'agent' THEN (SELECT a.name FROM multica_agent a WHERE a.id = n.worker_id)
        WHEN 'squad' THEN (SELECT s.name FROM multica_squad s WHERE s.id = n.worker_id)
        ELSE ''
    END, ''),
    critic_name_snapshot = COALESCE(CASE n.critic_type
        WHEN 'human' THEN (SELECT u.name FROM multica_user u WHERE u.id = n.critic_id)
        WHEN 'agent' THEN (SELECT a.name FROM multica_agent a WHERE a.id = n.critic_id)
        WHEN 'squad' THEN (SELECT s.name FROM multica_squad s WHERE s.id = n.critic_id)
        ELSE ''
    END, '')
FROM multica_workflow_node n
LEFT JOIN multica_workflow_stage stage ON stage.id = n.stage_id
LEFT JOIN multica_workflow_role worker_role ON worker_role.id = n.worker_role_id
LEFT JOIN multica_workflow_role critic_role ON critic_role.id = n.critic_role_id
WHERE n.id = nr.workflow_node_id;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM multica_workflow_node_run nr
        WHERE nr.source_workflow_node_id IS NULL
    ) THEN
        RAISE EXCEPTION 'cannot backfill workflow runtime: source node is missing';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM multica_workflow_node_run nr
        GROUP BY nr.workflow_run_id, nr.source_workflow_node_id
        HAVING count(*) <> 1
    ) THEN
        RAISE EXCEPTION 'cannot backfill workflow runtime: source node mapping is not one-to-one';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM multica_workflow_run wr
        JOIN multica_workflow_edge e ON e.workflow_id = wr.workflow_id
        LEFT JOIN multica_workflow_node_run source_nr
          ON source_nr.workflow_run_id = wr.id
         AND source_nr.source_workflow_node_id = e.source_node_id
        LEFT JOIN multica_workflow_node_run target_nr
          ON target_nr.workflow_run_id = wr.id
         AND target_nr.source_workflow_node_id = e.target_node_id
        WHERE source_nr.id IS NULL OR target_nr.id IS NULL
    ) THEN
        RAISE EXCEPTION 'cannot backfill workflow runtime: edge endpoint is missing';
    END IF;
END $$;

INSERT INTO multica_workflow_run_edge (
    workflow_run_id, source_node_run_id, target_node_run_id, condition, created_at
)
SELECT wr.id, source_nr.id, target_nr.id, e.condition, e.created_at
FROM multica_workflow_run wr
JOIN multica_workflow_edge e ON e.workflow_id = wr.workflow_id
JOIN multica_workflow_node_run source_nr
  ON source_nr.workflow_run_id = wr.id
 AND source_nr.source_workflow_node_id = e.source_node_id
JOIN multica_workflow_node_run target_nr
  ON target_nr.workflow_run_id = wr.id
 AND target_nr.source_workflow_node_id = e.target_node_id
ORDER BY wr.id, e.created_at, e.id;

INSERT INTO multica_workflow_node_run_deliverable (
    workflow_node_run_id, source_deliverable_id, kind, title,
    description, required, sort_order, created_at
)
SELECT nr.id, d.id, d.kind, d.title, d.description, d.required, d.sort_order, d.created_at
FROM multica_workflow_node_run nr
JOIN multica_workflow_node_deliverable d
  ON d.workflow_node_id = nr.source_workflow_node_id
ORDER BY nr.id, d.sort_order, d.id;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM multica_workflow_node_deliverable_submission submission
        LEFT JOIN multica_workflow_node_run_deliverable requirement
          ON requirement.workflow_node_run_id = submission.workflow_node_run_id
         AND requirement.source_deliverable_id = submission.deliverable_id
        WHERE requirement.id IS NULL
    ) THEN
        RAISE EXCEPTION 'cannot backfill workflow runtime: deliverable submission mapping is missing';
    END IF;
END $$;

ALTER TABLE multica_workflow_node_deliverable_submission
    DROP CONSTRAINT multica_workflow_node_deliverable_submissio_deliverable_id_fkey;

UPDATE multica_workflow_node_deliverable_submission submission
SET deliverable_id = requirement.id
FROM multica_workflow_node_run_deliverable requirement
WHERE requirement.workflow_node_run_id = submission.workflow_node_run_id
  AND requirement.source_deliverable_id = submission.deliverable_id;

ALTER TABLE multica_workflow_node_deliverable_submission
    ADD CONSTRAINT workflow_node_deliverable_submission_runtime_deliverable_fkey
    FOREIGN KEY (deliverable_id)
    REFERENCES multica_workflow_node_run_deliverable(id) ON DELETE CASCADE;

ALTER TABLE multica_workflow_node_run
    ALTER COLUMN source_workflow_node_id SET NOT NULL,
    DROP CONSTRAINT workflow_node_run_workflow_node_id_fkey;

CREATE FUNCTION multica_fill_source_workflow_node_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.source_workflow_node_id IS NULL THEN
        NEW.source_workflow_node_id := NEW.workflow_node_id;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER fill_source_workflow_node_id
BEFORE INSERT ON multica_workflow_node_run
FOR EACH ROW EXECUTE FUNCTION multica_fill_source_workflow_node_id();

ALTER TABLE multica_workflow_run
    DROP CONSTRAINT workflow_run_workflow_id_fkey,
    ADD CONSTRAINT workflow_run_workflow_id_fkey
        FOREIGN KEY (workflow_id) REFERENCES multica_workflow(id) ON DELETE RESTRICT;

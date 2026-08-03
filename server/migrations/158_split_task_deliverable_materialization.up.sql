CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM multica_workflow_node_run node_run
        JOIN multica_workflow_node node ON node.id = node_run.source_workflow_node_id
        WHERE node.format_schema ->> 'type' = 'split'
          AND node_run.status IN ('splitting', 'awaiting_split_review')
    ) THEN
        RAISE EXCEPTION 'split task.md migration blocked: cancel active legacy split review runs before rollout';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM multica_issue
        WHERE origin_type = 'workflow_split'
          AND origin_id IS NOT NULL
        GROUP BY origin_type, origin_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'split task.md migration blocked: duplicate workflow_split issue origins require repair';
    END IF;
END $$;

ALTER TABLE multica_workflow_node_run_deliverable
    ADD COLUMN purpose TEXT NOT NULL DEFAULT 'general'
        CHECK (purpose IN ('general', 'split_task_plan'));

ALTER TABLE multica_workflow_node_run
    ADD COLUMN split_plan_generation INT NOT NULL DEFAULT 0
        CHECK (split_plan_generation >= 0);

INSERT INTO multica_workflow_node_run_deliverable (
    workflow_node_run_id,
    source_deliverable_id,
    title,
    description,
    required,
    sort_order,
    purpose
)
SELECT
    node_run.id,
    uuid_generate_v5('7b6431f8-1b4e-51a9-9873-35c285bdb3e8'::uuid, node_run.source_workflow_node_id::text || ':split_task_plan'),
    'task',
    'Split task plan reviewed and materialized by Multica.',
    TRUE,
    -1,
    'split_task_plan'
FROM multica_workflow_node_run node_run
JOIN multica_workflow_node node ON node.id = node_run.source_workflow_node_id
WHERE node.format_schema ->> 'type' = 'split'
ON CONFLICT (workflow_node_run_id, source_deliverable_id) DO NOTHING;

CREATE UNIQUE INDEX uq_workflow_node_run_split_task_plan_deliverable
    ON multica_workflow_node_run_deliverable(workflow_node_run_id)
    WHERE purpose = 'split_task_plan';

CREATE TABLE multica_workflow_split_generation (
    node_run_id UUID NOT NULL REFERENCES multica_workflow_node_run(id) ON DELETE CASCADE,
    generation INT NOT NULL CHECK (generation > 0),
    status TEXT NOT NULL CHECK (status IN (
        'splitting', 'awaiting_review', 'materializing', 'active',
        'rejected', 'superseded', 'failed', 'cancelled'
    )),
    planner_task_id UUID REFERENCES multica_agent_task_queue(id) ON DELETE SET NULL,
    deliverable_id UUID NOT NULL REFERENCES multica_workflow_node_run_deliverable(id),
    submission_id UUID REFERENCES multica_workflow_node_deliverable_submission(id),
    review_comment TEXT NOT NULL DEFAULT '',
    pr_url TEXT NOT NULL DEFAULT '',
    reviewed_content TEXT NOT NULL DEFAULT '',
    review_head_commit_sha TEXT NOT NULL DEFAULT '',
    review_blob_sha TEXT NOT NULL DEFAULT '',
    review_archive_status TEXT NOT NULL DEFAULT 'not_started'
        CHECK (review_archive_status IN ('not_started', 'pending', 'archived', 'failed')),
    review_archive_error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (node_run_id, generation)
);

CREATE UNIQUE INDEX uq_workflow_split_generation_planner_task
    ON multica_workflow_split_generation(planner_task_id)
    WHERE planner_task_id IS NOT NULL;

INSERT INTO multica_workflow_split_generation (
    node_run_id, generation, status, deliverable_id
)
SELECT
    node_run.id,
    1,
    CASE node_run.status
        WHEN 'failed' THEN 'failed'
        WHEN 'cancelled' THEN 'cancelled'
        ELSE 'active'
    END,
    deliverable.id
FROM multica_workflow_node_run node_run
JOIN multica_workflow_node node ON node.id = node_run.source_workflow_node_id
JOIN multica_workflow_node_run_deliverable deliverable
  ON deliverable.workflow_node_run_id = node_run.id
 AND deliverable.purpose = 'split_task_plan'
WHERE node.format_schema ->> 'type' = 'split'
  AND (
      node_run.status IN ('split_active', 'completed', 'failed', 'cancelled')
      OR EXISTS (
          SELECT 1 FROM multica_workflow_split_task task WHERE task.node_run_id = node_run.id
      )
  );

UPDATE multica_workflow_node_run node_run
SET split_plan_generation = 1
WHERE EXISTS (
    SELECT 1
    FROM multica_workflow_split_generation generation
    WHERE generation.node_run_id = node_run.id
      AND generation.generation = 1
);

CREATE TABLE multica_workflow_split_snapshot (
    node_run_id UUID NOT NULL,
    generation INT NOT NULL,
    content TEXT NOT NULL,
    task_path TEXT NOT NULL,
    source_branch TEXT NOT NULL,
    head_commit_sha TEXT NOT NULL,
    blob_sha TEXT NOT NULL,
    pr_url TEXT NOT NULL,
    archive_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (archive_status IN ('pending', 'merged', 'manual_required', 'head_changed', 'failed')),
    archive_error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (node_run_id, generation),
    FOREIGN KEY (node_run_id, generation)
        REFERENCES multica_workflow_split_generation(node_run_id, generation)
        ON DELETE CASCADE
);

ALTER TABLE multica_workflow_split_task
    ADD COLUMN split_plan_generation INT,
    ADD COLUMN materialize_retry_count INT NOT NULL DEFAULT 0 CHECK (materialize_retry_count >= 0),
    ADD COLUMN materialize_next_attempt_at TIMESTAMPTZ;

UPDATE multica_workflow_split_task
SET status = 'discarded',
    last_error = jsonb_build_object(
        'code', 'legacy_split_draft_discarded',
        'message', 'Legacy split draft discarded by task.md migration',
        'retryable', false
    ),
    updated_at = now()
WHERE status IN ('draft', 'approved')
  AND issue_id IS NULL;

UPDATE multica_workflow_split_task task
SET split_plan_generation = 1
WHERE status <> 'discarded'
  AND EXISTS (
      SELECT 1
      FROM multica_workflow_split_generation generation
      WHERE generation.node_run_id = task.node_run_id
        AND generation.generation = 1
  );

ALTER TABLE multica_workflow_split_task
    ADD CONSTRAINT workflow_split_task_generation_fkey
    FOREIGN KEY (node_run_id, split_plan_generation)
    REFERENCES multica_workflow_split_generation(node_run_id, generation)
    ON DELETE CASCADE;

ALTER TABLE multica_workflow_split_task
    DROP CONSTRAINT IF EXISTS multica_workflow_split_task_status_check;
ALTER TABLE multica_workflow_split_task
    ADD CONSTRAINT multica_workflow_split_task_status_check CHECK (status IN (
        'discarded', 'created', 'running', 'done', 'failed', 'cancelled', 'skipped'
    ));
ALTER TABLE multica_workflow_split_task
    ADD CONSTRAINT workflow_split_task_generation_required_check
    CHECK (status = 'discarded' OR split_plan_generation IS NOT NULL);

DROP INDEX IF EXISTS idx_workflow_split_task_node_run_draft_key;
CREATE UNIQUE INDEX idx_workflow_split_task_generation_draft_key
    ON multica_workflow_split_task(node_run_id, split_plan_generation, draft_key)
    WHERE split_plan_generation IS NOT NULL AND draft_key IS NOT NULL AND draft_key <> '';

ALTER TABLE multica_workflow_node_run_dispatch_job
    ADD COLUMN split_plan_generation INT;

UPDATE multica_workflow_node_run_dispatch_job job
SET split_plan_generation = 1
WHERE phase = 'split'
  AND EXISTS (
      SELECT 1
      FROM multica_workflow_split_generation generation
      WHERE generation.node_run_id = job.workflow_node_run_id
        AND generation.generation = 1
  );

ALTER TABLE multica_workflow_node_run_dispatch_job
    ADD CONSTRAINT workflow_dispatch_split_generation_fkey
    FOREIGN KEY (workflow_node_run_id, split_plan_generation)
    REFERENCES multica_workflow_split_generation(node_run_id, generation)
    ON DELETE CASCADE,
    ADD CONSTRAINT workflow_dispatch_split_generation_check
    CHECK (
        (phase IN ('split', 'materialize') AND split_plan_generation IS NOT NULL)
        OR (phase NOT IN ('split', 'materialize') AND split_plan_generation IS NULL)
    );

CREATE UNIQUE INDEX uq_issue_workflow_split_origin
    ON multica_issue(origin_type, origin_id)
    WHERE origin_type = 'workflow_split';

DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'multica_workflow_node_run'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%';

    IF FOUND THEN
        EXECUTE format('ALTER TABLE multica_workflow_node_run DROP CONSTRAINT %I', constraint_name);
    ELSE
        constraint_name := 'workflow_node_run_status_check';
    END IF;

    EXECUTE format('ALTER TABLE multica_workflow_node_run ADD CONSTRAINT %I CHECK (status IN (
        ''pending'', ''format_checking'', ''format_ok'', ''format_failed'',
        ''worker_assigned'', ''working'', ''awaiting_input'', ''awaiting_critic'',
        ''critic_reviewing'', ''critic_approved'', ''critic_rework'', ''splitting'',
        ''awaiting_split_review'', ''materializing'', ''split_active'', ''completed'',
        ''failed'', ''blocked'', ''skipped'', ''cancelled''
    ))', constraint_name);
END $$;

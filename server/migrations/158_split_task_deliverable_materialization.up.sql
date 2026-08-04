CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Active split reviews cannot be reconstructed in the generation-aware model:
-- the legacy rows do not contain the reviewed task.md snapshot or generation
-- fence required by the new schema. Cancel the complete workflow run so the
-- migration leaves a coherent terminal state instead of blocking every new
-- backend pod during a rolling deployment.
LOCK TABLE multica_workflow_node_run IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE migration_158_legacy_split_run (
    workflow_run_id UUID PRIMARY KEY
) ON COMMIT DROP;

DO $$
BEGIN
    -- On a full retry the generation column already exists. Do not mistake a
    -- generation-aware split that started after the first execution for a
    -- legacy run and cancel it.
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'multica_workflow_node_run'
          AND column_name = 'split_plan_generation'
    ) THEN
        INSERT INTO migration_158_legacy_split_run (workflow_run_id)
        SELECT DISTINCT node_run.workflow_run_id
        FROM multica_workflow_node_run node_run
        JOIN multica_workflow_node node ON node.id = node_run.source_workflow_node_id
        WHERE node.format_schema ->> 'type' = 'split'
          AND node_run.status IN ('splitting', 'awaiting_split_review');
    END IF;
END $$;

UPDATE multica_agent_task_queue task
SET status = 'cancelled',
    completed_at = now(),
    failure_reason = 'migration_158_legacy_split_cancelled'
FROM multica_workflow_node_run node_run
JOIN migration_158_legacy_split_run affected
  ON affected.workflow_run_id = node_run.workflow_run_id
WHERE task.workflow_node_run_id = node_run.id
  AND task.status IN ('queued', 'dispatched', 'running');

-- Workflow node work may also be represented by an agent task attached to the
-- generated sub-issue rather than directly to the node run.
UPDATE multica_agent_task_queue task
SET status = 'cancelled',
    completed_at = now(),
    failure_reason = 'migration_158_legacy_split_cancelled'
FROM multica_issue issue
JOIN multica_workflow_node_run node_run
  ON issue.origin_type = 'workflow'
 AND issue.origin_id = node_run.id
JOIN migration_158_legacy_split_run affected
  ON affected.workflow_run_id = node_run.workflow_run_id
WHERE task.issue_id = issue.id
  AND task.status IN ('queued', 'dispatched', 'running');

UPDATE multica_workflow_split_task task
SET status = CASE
        WHEN task.issue_id IS NULL THEN 'discarded'
        WHEN task.run_id IS NULL THEN 'skipped'
        ELSE 'cancelled'
    END,
    last_error = jsonb_build_object(
        'code', 'migration_158_legacy_split_cancelled',
        'message', 'Legacy split review cancelled during task.md migration',
        'retryable', false
    ),
    updated_at = now()
FROM multica_workflow_node_run node_run
JOIN migration_158_legacy_split_run affected
  ON affected.workflow_run_id = node_run.workflow_run_id
WHERE task.node_run_id = node_run.id
  AND task.status NOT IN ('done', 'failed', 'cancelled', 'skipped', 'discarded');

UPDATE multica_workflow_node_run_dispatch_job job
SET status = 'failed',
    last_error = 'migration_158_legacy_split_cancelled',
    locked_by = NULL,
    lease_expires_at = NULL,
    updated_at = now()
FROM migration_158_legacy_split_run affected
WHERE job.workflow_run_id = affected.workflow_run_id
  AND job.status IN ('pending', 'running');

UPDATE multica_workflow_role_resolution_job job
SET status = 'cancelled',
    finished_at = now(),
    locked_by = NULL,
    lease_expires_at = NULL,
    updated_at = now(),
    generation = generation + 1
FROM migration_158_legacy_split_run affected
WHERE job.workflow_run_id = affected.workflow_run_id
  AND job.status IN ('pending', 'running');

UPDATE multica_workflow_role_notification notification
SET status = 'skipped_no_email',
    locked_by = NULL,
    lease_expires_at = NULL,
    last_error = 'migration_158_legacy_split_cancelled',
    updated_at = now()
FROM migration_158_legacy_split_run affected
WHERE notification.workflow_run_id = affected.workflow_run_id
  AND notification.status IN ('pending', 'sending');

UPDATE multica_issue issue
SET status = 'cancelled',
    updated_at = now()
FROM multica_workflow_node_run node_run
JOIN migration_158_legacy_split_run affected
  ON affected.workflow_run_id = node_run.workflow_run_id
WHERE issue.origin_type = 'workflow'
  AND issue.origin_id = node_run.id
  AND issue.status NOT IN ('done', 'cancelled');

UPDATE multica_issue issue
SET status = 'cancelled',
    updated_at = now()
FROM multica_workflow_split_task task
JOIN multica_workflow_node_run node_run ON node_run.id = task.node_run_id
JOIN migration_158_legacy_split_run affected
  ON affected.workflow_run_id = node_run.workflow_run_id
WHERE issue.origin_type = 'workflow_split'
  AND issue.origin_id = task.id
  AND issue.status NOT IN ('done', 'cancelled');

UPDATE multica_workflow_node_run node_run
SET status = 'cancelled',
    failure_reason = 'migration_158_legacy_split_cancelled',
    completed_at = COALESCE(completed_at, now()),
    updated_at = now()
FROM migration_158_legacy_split_run affected
WHERE node_run.workflow_run_id = affected.workflow_run_id
  AND node_run.status NOT IN ('format_failed', 'completed', 'failed', 'skipped', 'cancelled');

UPDATE multica_workflow_run workflow_run
SET status = 'cancelled',
    failure_reason = 'migration_158_legacy_split_cancelled',
    completed_at = COALESCE(completed_at, now())
FROM migration_158_legacy_split_run affected
WHERE workflow_run.id = affected.workflow_run_id
  AND workflow_run.status NOT IN ('completed', 'failed', 'cancelled');

DO $$
BEGIN
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
    ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'general'
        CHECK (purpose IN ('general', 'split_task_plan'));

ALTER TABLE multica_workflow_node_run
    ADD COLUMN IF NOT EXISTS split_plan_generation INT NOT NULL DEFAULT 0
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_node_run_split_task_plan_deliverable
    ON multica_workflow_node_run_deliverable(workflow_node_run_id)
    WHERE purpose = 'split_task_plan';

CREATE TABLE IF NOT EXISTS multica_workflow_split_generation (
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_split_generation_planner_task
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
  )
ON CONFLICT (node_run_id, generation) DO NOTHING;

UPDATE multica_workflow_node_run node_run
SET split_plan_generation = 1
WHERE EXISTS (
    SELECT 1
    FROM multica_workflow_split_generation generation
    WHERE generation.node_run_id = node_run.id
      AND generation.generation = 1
);

CREATE TABLE IF NOT EXISTS multica_workflow_split_snapshot (
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
    ADD COLUMN IF NOT EXISTS split_plan_generation INT,
    ADD COLUMN IF NOT EXISTS materialize_retry_count INT NOT NULL DEFAULT 0 CHECK (materialize_retry_count >= 0),
    ADD COLUMN IF NOT EXISTS materialize_next_attempt_at TIMESTAMPTZ;

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
    DROP CONSTRAINT IF EXISTS workflow_split_task_generation_fkey;
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
    DROP CONSTRAINT IF EXISTS workflow_split_task_generation_required_check;
ALTER TABLE multica_workflow_split_task
    ADD CONSTRAINT workflow_split_task_generation_required_check
    CHECK (status = 'discarded' OR split_plan_generation IS NOT NULL);

DROP INDEX IF EXISTS idx_workflow_split_task_node_run_draft_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_split_task_generation_draft_key
    ON multica_workflow_split_task(node_run_id, split_plan_generation, draft_key)
    WHERE split_plan_generation IS NOT NULL AND draft_key IS NOT NULL AND draft_key <> '';

ALTER TABLE multica_workflow_node_run_dispatch_job
    ADD COLUMN IF NOT EXISTS split_plan_generation INT;

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
    DROP CONSTRAINT IF EXISTS workflow_dispatch_split_generation_fkey,
    DROP CONSTRAINT IF EXISTS workflow_dispatch_split_generation_check;
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_issue_workflow_split_origin
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

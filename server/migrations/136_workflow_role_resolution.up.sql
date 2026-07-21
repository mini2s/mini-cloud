ALTER TABLE multica_workflow_run
    DROP CONSTRAINT IF EXISTS workflow_run_status_check,
    ADD CONSTRAINT workflow_run_status_check CHECK (status IN (
        'resolving_roles', 'waiting_role_assignment',
        'running', 'completed', 'failed', 'cancelled'
    ));

CREATE TABLE multica_workflow_role_resolution (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_run_id UUID NOT NULL REFERENCES multica_workflow_run(id) ON DELETE CASCADE,
    workflow_node_run_id UUID NOT NULL REFERENCES multica_workflow_node_run(id) ON DELETE CASCADE,
    slot_type TEXT NOT NULL CHECK (slot_type IN ('worker', 'critic')),
    role_id UUID REFERENCES multica_workflow_role(id) ON DELETE SET NULL,
    role_name_snapshot TEXT NOT NULL,
    role_description_snapshot TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'needs_human', 'invalidated')),
    resolved_user_id UUID REFERENCES multica_user(id) ON DELETE SET NULL,
    source TEXT CHECK (source IS NULL OR source IN ('llm', 'manual')),
    reason_code TEXT NOT NULL DEFAULT '',
    reason_detail TEXT NOT NULL DEFAULT '' CHECK (char_length(reason_detail) <= 500),
    version INTEGER NOT NULL DEFAULT 1,
    resolved_by UUID REFERENCES multica_user(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(workflow_node_run_id, slot_type)
);
CREATE INDEX idx_workflow_role_resolution_run ON multica_workflow_role_resolution(workflow_run_id);
CREATE INDEX idx_workflow_role_resolution_unresolved ON multica_workflow_role_resolution(workflow_run_id, status)
    WHERE status <> 'resolved';

CREATE TABLE multica_workflow_role_resolution_job (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES multica_workspace(id) ON DELETE CASCADE,
    workflow_run_id UUID NOT NULL REFERENCES multica_workflow_run(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'partial', 'failed', 'cancelled')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 6,
    org_attempt_count INTEGER NOT NULL DEFAULT 0,
    llm_attempt_count INTEGER NOT NULL DEFAULT 0,
    format_attempt_count INTEGER NOT NULL DEFAULT 0,
    generation INTEGER NOT NULL DEFAULT 1,
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_by TEXT,
    lease_expires_at TIMESTAMPTZ,
    heartbeat_at TIMESTAMPTZ,
    last_error_code TEXT NOT NULL DEFAULT '',
    last_error_detail TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    prompt_version TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_workflow_role_resolution_job_active_run
    ON multica_workflow_role_resolution_job(workflow_run_id)
    WHERE status IN ('pending', 'running');
CREATE INDEX idx_workflow_role_resolution_job_claim
    ON multica_workflow_role_resolution_job(scheduled_at, created_at)
    WHERE status = 'pending';
CREATE INDEX idx_workflow_role_resolution_job_workspace_active
    ON multica_workflow_role_resolution_job(workspace_id, status)
    WHERE status IN ('pending', 'running');

CREATE TABLE multica_workflow_role_resolution_event (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_run_id UUID NOT NULL REFERENCES multica_workflow_run(id) ON DELETE CASCADE,
    workflow_role_resolution_id UUID REFERENCES multica_workflow_role_resolution(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    slot_type TEXT,
    role_name_snapshot TEXT NOT NULL DEFAULT '',
    resolved_user_id UUID REFERENCES multica_user(id) ON DELETE SET NULL,
    source TEXT,
    reason_code TEXT NOT NULL DEFAULT '',
    reason_detail TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    prompt_version TEXT NOT NULL DEFAULT '',
    organization_version TEXT NOT NULL DEFAULT '',
    actor_user_id UUID REFERENCES multica_user(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_workflow_role_resolution_event_run ON multica_workflow_role_resolution_event(workflow_run_id, created_at);

CREATE TABLE multica_workflow_role_resolution_call (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_run_id UUID NOT NULL REFERENCES multica_workflow_run(id) ON DELETE CASCADE,
    job_id UUID REFERENCES multica_workflow_role_resolution_job(id) ON DELETE CASCADE,
    stage TEXT NOT NULL CHECK (stage IN ('organization', 'llm')),
    attempt INTEGER NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    duration_ms BIGINT NOT NULL DEFAULT 0,
    result_code TEXT NOT NULL DEFAULT '',
    error_detail TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_workflow_role_resolution_call_created_at ON multica_workflow_role_resolution_call(created_at);

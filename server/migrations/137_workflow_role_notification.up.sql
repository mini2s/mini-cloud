CREATE TABLE multica_workflow_role_notification (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES multica_workspace(id) ON DELETE CASCADE,
    workflow_run_id UUID NOT NULL REFERENCES multica_workflow_run(id) ON DELETE CASCADE,
    workflow_node_run_id UUID NOT NULL REFERENCES multica_workflow_node_run(id) ON DELETE CASCADE,
    slot_type TEXT NOT NULL CHECK (slot_type IN ('worker', 'critic')),
    recipient_user_id UUID NOT NULL REFERENCES multica_user(id) ON DELETE CASCADE,
    notification_type TEXT NOT NULL CHECK (notification_type IN ('execution', 'review', 'manual_required')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped_no_email')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_by TEXT,
    lease_expires_at TIMESTAMPTZ,
    last_error TEXT NOT NULL DEFAULT '',
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(workflow_run_id, workflow_node_run_id, slot_type, notification_type, recipient_user_id)
);
CREATE INDEX idx_workflow_role_notification_claim
    ON multica_workflow_role_notification(scheduled_at, created_at)
    WHERE status = 'pending';

-- Workflow deliverable definitions per node (document / pull_request)
-- Drop old deliverable tables from a prior schema iteration (migration 130 on
-- another branch) and recreate with the correct column names.
DROP TABLE IF EXISTS multica_workflow_node_deliverable_submission CASCADE;
DROP TABLE IF EXISTS multica_workflow_node_deliverable CASCADE;

CREATE TABLE multica_workflow_node_deliverable (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_node_id UUID NOT NULL REFERENCES multica_workflow_node(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('document', 'pull_request')),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    required BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_node_deliverable_node
    ON multica_workflow_node_deliverable(workflow_node_id, sort_order);

-- Deliverable submissions: one per (node_run, deliverable) pair
CREATE TABLE IF NOT EXISTS multica_workflow_node_deliverable_submission (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_node_run_id UUID NOT NULL REFERENCES multica_workflow_node_run(id) ON DELETE CASCADE,
    deliverable_id UUID NOT NULL REFERENCES multica_workflow_node_deliverable(id) ON DELETE CASCADE,
    submitted_by_type TEXT NOT NULL CHECK (submitted_by_type IN ('member', 'agent', 'system')),
    submitted_by_id UUID,
    status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('missing', 'submitted', 'approved', 'rejected')),
    content TEXT NOT NULL DEFAULT '',
    attachment_id UUID REFERENCES multica_attachment(id) ON DELETE SET NULL,
    pull_request_url TEXT NOT NULL DEFAULT '',
    review_comment TEXT NOT NULL DEFAULT '',
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(workflow_node_run_id, deliverable_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_node_deliverable_submission_run
    ON multica_workflow_node_deliverable_submission(workflow_node_run_id);

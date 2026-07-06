-- 130_node_deliverable.up.sql
-- Per-node deliverable definitions.
-- type is constrained to 'document' | 'pull_request' for initial release.

CREATE TABLE multica_workflow_node_deliverable (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id UUID NOT NULL REFERENCES multica_workflow_node(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('document', 'pull_request')),
    name TEXT NOT NULL,
    requirements TEXT NOT NULL DEFAULT '',
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_node_deliverable_node_id ON multica_workflow_node_deliverable(node_id);

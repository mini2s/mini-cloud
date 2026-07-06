-- 129_development_stage.up.sql
-- Workspace-level development stages for workflow nodes.
-- scope='builtin' stages have workspace_id=NULL and are available to all workspaces.
-- scope='custom' stages are workspace-scoped.

CREATE TABLE multica_workflow_development_stage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES multica_workspace(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    scope TEXT NOT NULL DEFAULT 'custom' CHECK (scope IN ('builtin', 'custom')),
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT dev_stage_workspace_scope CHECK (
        (scope = 'builtin' AND workspace_id IS NULL) OR
        (scope = 'custom' AND workspace_id IS NOT NULL)
    )
);

CREATE INDEX idx_dev_stage_workspace_id ON multica_workflow_development_stage(workspace_id);
CREATE INDEX idx_dev_stage_scope ON multica_workflow_development_stage(scope);

-- Add development_stage_id to workflow_node
ALTER TABLE multica_workflow_node
ADD COLUMN development_stage_id UUID REFERENCES multica_workflow_development_stage(id) ON DELETE SET NULL;

CREATE INDEX idx_workflow_node_dev_stage_id ON multica_workflow_node(development_stage_id);

-- Seed built-in development stages
INSERT INTO multica_workflow_development_stage (id, workspace_id, name, description, scope, sort_order) VALUES
    (gen_random_uuid(), NULL, 'Planning', 'Initial planning and requirements gathering', 'builtin', 1),
    (gen_random_uuid(), NULL, 'Implementation', 'Active development and coding', 'builtin', 2),
    (gen_random_uuid(), NULL, 'Review', 'Code review and quality assurance', 'builtin', 3),
    (gen_random_uuid(), NULL, 'Testing', 'Testing and validation', 'builtin', 4),
    (gen_random_uuid(), NULL, 'Done', 'Completed work items', 'builtin', 5);

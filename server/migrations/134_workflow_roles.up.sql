-- Workflow role definitions — built-in R&D role abstractions that dynamically
-- map to concrete actors (members, agents, squads) via priority-ordered bindings.
CREATE TABLE IF NOT EXISTS multica_workflow_role (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES multica_workspace(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_workflow_role_workspace ON multica_workflow_role(workspace_id);

-- Role → actor bindings; higher-priority bindings are tried first at dispatch time.
CREATE TABLE IF NOT EXISTS multica_workflow_role_binding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES multica_workflow_role(id) ON DELETE CASCADE,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('member', 'agent', 'squad')),
    actor_id UUID NOT NULL,
    priority INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_role_binding_role ON multica_workflow_role_binding(role_id, priority);

-- Extend worker_type and critic_type CHECK constraints to include 'role'.
ALTER TABLE multica_workflow_node DROP CONSTRAINT IF EXISTS workflow_node_worker_type_check;
ALTER TABLE multica_workflow_node ADD CONSTRAINT workflow_node_worker_type_check
    CHECK (worker_type IN ('human', 'agent', 'squad', 'role'));

ALTER TABLE multica_workflow_node DROP CONSTRAINT IF EXISTS workflow_node_critic_type_check;
ALTER TABLE multica_workflow_node ADD CONSTRAINT workflow_node_critic_type_check
    CHECK (critic_type IN ('human', 'agent', 'squad', 'api', 'role'));

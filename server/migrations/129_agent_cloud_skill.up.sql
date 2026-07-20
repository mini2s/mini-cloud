CREATE TABLE multica_agent_cloud_skill (
    agent_id UUID NOT NULL REFERENCES multica_agent(id) ON DELETE CASCADE,
    cloud_skill_id TEXT NOT NULL,
    slug TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    install JSONB NOT NULL DEFAULT '{}'::jsonb,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_id, cloud_skill_id),
    CONSTRAINT multica_agent_cloud_skill_id_not_empty CHECK (btrim(cloud_skill_id) <> ''),
    CONSTRAINT multica_agent_cloud_skill_name_not_empty CHECK (btrim(name) <> ''),
    CONSTRAINT multica_agent_cloud_skill_install_object CHECK (jsonb_typeof(install) = 'object')
);

CREATE INDEX idx_multica_agent_cloud_skill_agent_position
    ON multica_agent_cloud_skill(agent_id, position, name, cloud_skill_id);

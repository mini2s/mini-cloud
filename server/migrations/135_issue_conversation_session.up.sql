CREATE TABLE multica_issue_conversation (
    issue_id            UUID PRIMARY KEY REFERENCES multica_issue(id) ON DELETE CASCADE,
    conversation_id     TEXT NOT NULL,
    workspace_directory TEXT NOT NULL,
    device_id           TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_issue_conversation_issue_id ON multica_issue_conversation(issue_id);
ALTER TABLE multica_project ADD COLUMN local_directory TEXT;

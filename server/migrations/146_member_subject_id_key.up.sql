ALTER TABLE multica_member
    ADD COLUMN IF NOT EXISTS subject_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_multica_member_workspace_subject
    ON multica_member (workspace_id, subject_id)
    WHERE subject_id IS NOT NULL AND subject_id <> '';

ALTER TABLE multica_user ADD COLUMN IF NOT EXISTS casdoor_universal_id TEXT UNIQUE;

ALTER TABLE multica_member ADD COLUMN IF NOT EXISTS external_user_id TEXT;
ALTER TABLE multica_member ADD COLUMN IF NOT EXISTS external_universal_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_multica_member_workspace_external_universal
    ON multica_member (workspace_id, external_universal_id)
    WHERE external_universal_id IS NOT NULL AND external_universal_id <> '';

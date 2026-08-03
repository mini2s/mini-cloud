DROP INDEX IF EXISTS idx_multica_member_workspace_subject;

ALTER TABLE multica_member
    DROP COLUMN IF EXISTS subject_id;

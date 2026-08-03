DROP INDEX IF EXISTS idx_issue_responsible_user;
ALTER TABLE multica_issue DROP COLUMN IF EXISTS responsible_user_id;

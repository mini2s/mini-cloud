ALTER TABLE multica_issue
  ADD COLUMN responsible_user_id UUID REFERENCES multica_user(id) ON DELETE SET NULL;

CREATE INDEX idx_issue_responsible_user
  ON multica_issue(workspace_id, responsible_user_id)
  WHERE responsible_user_id IS NOT NULL;

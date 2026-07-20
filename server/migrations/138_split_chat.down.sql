-- 138_split_chat.down.sql

DROP INDEX IF EXISTS idx_workflow_node_run_split_review_chat_session;

ALTER TABLE multica_workflow_node_run
DROP COLUMN IF EXISTS split_review_chat_session_id;

ALTER TABLE multica_workflow_split_task
DROP CONSTRAINT IF EXISTS workflow_split_task_draft_source_check;

ALTER TABLE multica_workflow_split_task
DROP COLUMN IF EXISTS draft_source;

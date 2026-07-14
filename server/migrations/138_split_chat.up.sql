-- 138_split_chat.up.sql

-- Add draft_source column to track where split drafts came from.
ALTER TABLE multica_workflow_split_task
ADD COLUMN IF NOT EXISTS draft_source TEXT NOT NULL DEFAULT 'agent';

-- Add check constraint for valid draft_source values.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'multica_workflow_split_task'::regclass
          AND conname = 'workflow_split_task_draft_source_check'
    ) THEN
        ALTER TABLE multica_workflow_split_task
        ADD CONSTRAINT workflow_split_task_draft_source_check
        CHECK (draft_source IN ('agent', 'chat', 'recovered'));
    END IF;
END $$;

-- Add split_review_chat_session_id to node runs so each split node run
-- can bind to a single persistent chat session for NL review.
ALTER TABLE multica_workflow_node_run
ADD COLUMN IF NOT EXISTS split_review_chat_session_id UUID
REFERENCES multica_chat_session(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_node_run_split_review_chat_session
ON multica_workflow_node_run(split_review_chat_session_id);

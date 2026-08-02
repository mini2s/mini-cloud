ALTER TABLE multica_issue_subscriber
    DROP CONSTRAINT IF EXISTS issue_subscriber_reason_check;

ALTER TABLE multica_issue_subscriber
    ADD CONSTRAINT issue_subscriber_reason_check
    CHECK (reason IN ('creator', 'assignee', 'responsible', 'commenter', 'mentioned', 'manual'));

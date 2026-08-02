UPDATE multica_issue_subscriber
SET reason = 'assignee'
WHERE reason = 'responsible';

ALTER TABLE multica_issue_subscriber
    DROP CONSTRAINT IF EXISTS issue_subscriber_reason_check;

ALTER TABLE multica_issue_subscriber
    ADD CONSTRAINT issue_subscriber_reason_check
    CHECK (reason IN ('creator', 'assignee', 'commenter', 'mentioned', 'manual'));

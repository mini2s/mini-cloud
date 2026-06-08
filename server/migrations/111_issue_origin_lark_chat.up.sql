-- Extend multica_issue.origin_type to allow the Lark `/multica_issue` command path to stamp
-- issues with origin_type='lark_chat' + origin_id=<multica_chat_session.id>. Without
-- this entry in the CHECK list, every /multica_issue dispatch on Lark fails with
-- SQLSTATE 23514 and the connector exits with infra error — see Bohan's
-- live-env repro in MUL-2671 review where one /multica_issue in a row tripped the
-- check three times, each crash dragging the WS connector down + Lark
-- retrying the same event into the next crash.
ALTER TABLE multica_issue DROP CONSTRAINT IF EXISTS issue_origin_type_check;
ALTER TABLE multica_issue ADD CONSTRAINT issue_origin_type_check
    CHECK (origin_type IN ('multica_autopilot', 'quick_create', 'lark_chat'));

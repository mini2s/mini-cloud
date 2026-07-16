-- name: GetIssueConversation :one
SELECT issue_id, conversation_id, workspace_directory, device_id, created_at, updated_at
FROM multica_issue_conversation
WHERE issue_id = $1;

-- name: CreateIssueConversation :one
INSERT INTO multica_issue_conversation (
    issue_id, conversation_id, workspace_directory, device_id
) VALUES ($1, $2, $3, $4)
ON CONFLICT (issue_id) DO UPDATE SET
    conversation_id = EXCLUDED.conversation_id,
    workspace_directory = EXCLUDED.workspace_directory,
    device_id = EXCLUDED.device_id,
    updated_at = now()
RETURNING issue_id, conversation_id, workspace_directory, device_id, created_at, updated_at;

-- name: DeleteIssueConversation :exec
DELETE FROM multica_issue_conversation WHERE issue_id = $1;

-- name: LockIssueConversation :exec
SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0));

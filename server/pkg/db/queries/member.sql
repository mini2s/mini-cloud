-- name: ListMembers :many
SELECT * FROM multica_member
WHERE workspace_id = $1
ORDER BY created_at ASC;

-- name: GetMember :one
SELECT * FROM multica_member
WHERE id = $1;

-- name: GetMemberByUserAndWorkspace :one
SELECT * FROM multica_member
WHERE user_id = $1 AND workspace_id = $2;

-- name: GetMemberByWorkspaceAndSubject :one
SELECT * FROM multica_member
WHERE workspace_id = $1 AND subject_id = $2;

-- name: CreateMember :one
INSERT INTO multica_member (workspace_id, user_id, role)
VALUES ($1, $2, $3)
RETURNING *;

-- name: UpdateMemberRole :one
UPDATE multica_member SET role = $2
WHERE id = $1
RETURNING *;

-- name: DeleteMember :exec
DELETE FROM multica_member WHERE id = $1;

-- name: ListMembersWithUser :many
SELECT m.id, m.workspace_id, m.user_id, m.role, m.created_at,
       m.source, m.status, m.external_user_id, m.external_universal_id,
       m.employee_id, m.org_display_name, m.dept_id, m.dept_name,
       m.dept_path, m.position, m.is_main_department, m.dept_user_status,
       m.last_synced_at,
       u.name as user_name, u.email as user_email, u.avatar_url as user_avatar_url
FROM multica_member m
LEFT JOIN multica_user u ON u.id = m.user_id
WHERE m.workspace_id = $1
ORDER BY m.created_at ASC;

-- name: ListActiveWorkflowRoleCandidateMembers :many
-- Keep the automatic role-resolution candidate boundary local: organization
-- data may enrich these rows, but it must never add users outside this set.
SELECT
    m.id AS member_id,
    m.user_id,
    m.external_universal_id,
    m.external_user_id,
    COALESCE(NULLIF(m.org_display_name, ''), u.name) AS display_name
FROM multica_member m
JOIN multica_user u ON u.id = m.user_id
WHERE m.workspace_id = $1
  AND m.status = 'active'
  AND m.user_id IS NOT NULL
ORDER BY m.created_at ASC;

-- name: ListDeptMemberSnapshots :many
SELECT id, user_id, source, status, subject_id, external_user_id, external_universal_id,
       employee_id, org_display_name, dept_id, dept_name, dept_path,
       position, is_main_department, dept_user_status, last_synced_at
FROM multica_member
WHERE workspace_id = $1;

-- name: UpsertDeptMember :one
INSERT INTO multica_member (
    workspace_id, user_id, role, source, status, subject_id,
    employee_id, org_display_name, dept_id, dept_name, dept_path,
    position, is_main_department, dept_user_status, last_synced_at
)
VALUES (
    $1, $2, 'member', 'dept', $3, $4,
    $5, $6, $7, $8, $9,
    $10, $11, $12, NOW()
)
ON CONFLICT (workspace_id, subject_id)
WHERE subject_id IS NOT NULL AND subject_id <> ''
DO UPDATE SET
    user_id = EXCLUDED.user_id,
    status = EXCLUDED.status,
    subject_id = EXCLUDED.subject_id,
    employee_id = EXCLUDED.employee_id,
    org_display_name = EXCLUDED.org_display_name,
    dept_id = EXCLUDED.dept_id,
    dept_name = EXCLUDED.dept_name,
    dept_path = EXCLUDED.dept_path,
    position = EXCLUDED.position,
    is_main_department = EXCLUDED.is_main_department,
    dept_user_status = EXCLUDED.dept_user_status,
    last_synced_at = NOW()
RETURNING *;

-- name: ActivatePendingDeptMembersByUniversalID :many
UPDATE multica_member m
SET user_id = $2,
    status = 'active'
WHERE m.external_universal_id = $1
  AND m.status = 'pending_activation'
  AND m.user_id IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM multica_member existing
      WHERE existing.workspace_id = m.workspace_id
        AND existing.user_id = $2
  )
RETURNING *;

-- name: RefreshUserMembershipDeptOrg :exec
-- Rewrites the dept org snapshot (name / department / position) on every
-- membership bound to this user — both dept-sourced rows and pre-existing
-- manual / email-invite rows — AND links each row to the dept identity
-- (external_universal_id / external_user_id). Keying on user_id (not
-- external_universal_id) means login also backfills a membership that existed
-- before Casdoor binding (where ActivatePending's no-duplicate guard blocked
-- the separate dept row from activating). Linking the identity there too is
-- what lets the member-picker recognise the row as already-added (it matches
-- dept-sync results by universal_id) instead of offering to re-add the user.
-- Call DeleteOrphanPendingDeptMembers first so no pending dept row holds the
-- same universal_id in a workspace (would violate the
-- (workspace_id, external_universal_id) unique index).
UPDATE multica_member
SET external_universal_id = $2,
    external_user_id = $3,
    org_display_name = $4,
    employee_id = $5,
    dept_id = $6,
    dept_name = $7,
    dept_path = $8,
    position = $9,
    is_main_department = $10,
    dept_user_status = $11,
    last_synced_at = $12
WHERE user_id = $1;

-- name: DeleteOrphanPendingDeptMembers :execrows
-- Removes pending_activation dept member rows for a universal_id that did not
-- get activated because the user already held a membership in that workspace
-- (ActivatePending's no-duplicate guard). Without this they linger as orphan
-- duplicates next to the backfilled existing membership.
DELETE FROM multica_member
WHERE external_universal_id = $1
  AND status = 'pending_activation'
  AND user_id IS NULL;

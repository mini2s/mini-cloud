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
       m.source, m.status,
       m.employee_id, m.org_display_name, m.dept_id, m.dept_name,
       m.dept_path, m.position, m.is_main_department, m.dept_user_status,
       m.last_synced_at, m.subject_id,
       u.name as user_name, u.email as user_email, u.avatar_url as user_avatar_url,
       u.subject_id as user_subject_id
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
    m.subject_id,
    COALESCE(NULLIF(m.org_display_name, ''), u.name) AS display_name
FROM multica_member m
JOIN multica_user u ON u.id = m.user_id
WHERE m.workspace_id = $1
  AND m.status = 'active'
  AND m.user_id IS NOT NULL
ORDER BY m.created_at ASC;

-- name: ListDeptMemberSnapshots :many
SELECT id, user_id, source, status, subject_id,
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

-- name: RefreshUserMembershipDeptOrg :exec
-- Rewrites the dept org snapshot (display name / department / position) on
-- every membership bound to this user. universal_id is used only transiently
-- (to fetch the snapshot from dept-sync) and is NOT persisted.
UPDATE multica_member
SET org_display_name = $2,
    employee_id = $3,
    dept_id = $4,
    dept_name = $5,
    dept_path = $6,
    position = $7,
    is_main_department = $8,
    dept_user_status = $9,
    last_synced_at = $10
WHERE user_id = $1;

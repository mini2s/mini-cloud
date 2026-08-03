-- Read-only queries against costrict-web's user_system_roles table (external,
-- see pkg/db/schema_external.sql). Present only in costrict-integrated
-- deployments; the platformadmin.Checker probes existence at startup.

-- name: PlatformAdminTableExists :one
SELECT (to_regclass('public.user_system_roles') IS NOT NULL)::bool AS exists;

-- name: IsPlatformAdminBySubjectID :one
SELECT EXISTS (
    SELECT 1 FROM user_system_roles
    WHERE user_id = $1::text
      AND role = 'platform_admin'
      AND deleted_at IS NULL
) AS is_platform_admin;

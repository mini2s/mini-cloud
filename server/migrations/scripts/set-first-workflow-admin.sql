-- Set the first global workflow administrator (standalone/fallback deployments
-- only — costrict-integrated deployments use the platform_admin role instead).
UPDATE multica_user SET can_manage_workflows = TRUE WHERE email = 'admin@example.com';

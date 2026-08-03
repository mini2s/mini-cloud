-- 158_backfill_platform_admin_workflow_perm.up.sql
-- Backfill multica_user.subject_id and can_manage_workflows so that costrict
-- platform admins are recognised by multica's workflow-admin permission gate.
--
-- Context: in costrict-integrated deployments the platformadmin.Checker
-- resolves the effective permission by looking up user_system_roles.role =
-- 'platform_admin' keyed by multica_user.subject_id. Users provisioned by
-- older login paths may have subject_id = NULL (or a stale value), so the
-- Checker denies them even though they hold the platform_admin role in
-- costrict. This migration repairs that linkage for existing users.
--
-- It is a no-op in standalone deployments (user_system_roles absent): the
-- local can_manage_workflows flag remains the source of truth there and is
-- left untouched.
--
-- Idempotent: safe to re-run. Only UPDATEs; never deletes or inserts.

DO $$
BEGIN
    -- Standalone deployment: shared costrict tables are absent. Nothing to do.
    IF to_regclass('public.user_system_roles') IS NULL THEN
        RAISE NOTICE '158: user_system_roles absent (standalone deployment); skipping backfill';
        RETURN;
    END IF;

    -- 1. Backfill subject_id from the costrict users table.
    --    Targets Casdoor-provisioned multica users whose email follows the
    --    <casdoor_id>@casdoor.local synthetic pattern (email was unknown at
    --    provisioning time). The casdoor_id local-part is matched to
    --    users.casdoor_id to recover the stable usr_* subject_id.
    --    IS DISTINCT FROM repairs both NULL and stale/wrong subject_id values.
    IF to_regclass('public.users') IS NOT NULL THEN
        UPDATE multica_user m
        SET subject_id = u.subject_id
        FROM users u
        WHERE u.casdoor_id IS NOT NULL
          AND u.casdoor_id <> ''
          AND m.email LIKE '%@casdoor.local'
          AND split_part(m.email, '@', 1) = u.casdoor_id
          AND m.subject_id IS DISTINCT FROM u.subject_id;

        RAISE NOTICE '158: subject_id backfill complete (rows updated = %)',
            (SELECT count(*) FROM multica_user m JOIN users u
              ON u.casdoor_id IS NOT NULL AND u.casdoor_id <> ''
             WHERE m.email LIKE '%@casdoor.local'
               AND split_part(m.email, '@', 1) = u.casdoor_id
               AND m.subject_id IS DISTINCT FROM u.subject_id);
    ELSE
        RAISE NOTICE '158: costrict users table absent; skipped subject_id backfill';
    END IF;

    -- 2. Grant can_manage_workflows to every platform admin.
    --    In platform mode the Checker ignores this column (it reads the role
    --    table live), but setting it TRUE keeps the local/fallback mode
    --    consistent and is belt-and-suspenders for deployments that later
    --    switch to standalone. Non-admins are NOT revoked: the column is
    --    ignored in platform mode, and revoking could strip legitimately
    --    granted local admins.
    UPDATE multica_user m
    SET can_manage_workflows = TRUE
    FROM user_system_roles r
    WHERE m.subject_id IS NOT NULL
      AND m.subject_id <> ''
      AND r.user_id = m.subject_id
      AND r.role = 'platform_admin'
      AND r.deleted_at IS NULL
      AND m.can_manage_workflows = FALSE;

    RAISE NOTICE '158: can_manage_workflows granted to platform admins (rows updated = %)',
        (SELECT count(*) FROM multica_user m
          JOIN user_system_roles r
            ON r.user_id = m.subject_id
           AND r.role = 'platform_admin'
           AND r.deleted_at IS NULL
         WHERE m.can_manage_workflows = FALSE);
END $$;

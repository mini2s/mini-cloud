-- 158_backfill_platform_admin_workflow_perm.up.sql
-- Backfill multica_user.subject_id and can_manage_workflows so that costrict
-- platform admins are recognised by multica's workflow-admin permission gate.
--
-- Context: in costrict-integrated deployments the platformadmin.Checker
-- resolves the effective permission by looking up user_system_roles.role =
-- 'platform_admin' keyed by multica_user.subject_id (the usr_* form). An
-- earlier login path stored casdoor_universal_id (a raw UUID) into
-- multica_user.subject_id instead of the usr_* subject_id, so the Checker
-- denied users who actually hold the platform_admin role in costrict. This
-- migration repairs that linkage for existing users.
--
-- Match path: multica_user.subject_id (raw UUID) = users.casdoor_universal_id
--             -> recover users.subject_id (usr_* form). A secondary email
--             match covers the NULL-subject_id case where multica and
--             costrict share the same real email.
--
-- No-op in standalone deployments (user_system_roles absent): the local
-- can_manage_workflows flag stays the source of truth and is untouched.
--
-- Idempotent: safe to re-run. Only UPDATEs; never deletes or inserts.

DO $$
BEGIN
    -- Standalone deployment: shared costrict tables are absent. Nothing to do.
    IF to_regclass('public.user_system_roles') IS NULL THEN
        RAISE NOTICE '158: user_system_roles absent (standalone deployment); skipping backfill';
        RETURN;
    END IF;

    -- 1a. Repair subject_id where multica stored casdoor_universal_id (raw
    --     UUID) instead of the usr_* subject_id. The join key is the raw
    --     UUID itself: multica_user.subject_id = users.casdoor_universal_id.
    --     Only touches rows that are NOT already in usr_* form and that
    --     resolve to a different, real subject_id.
    --
    --     Collision guard: if another multica_user already holds the target
    --     usr_* subject_id (duplicate accounts from an earlier provisioning
    --     path - same costrict user, two multica rows), skip. The canonical
    --     account already has the correct subject_id; forcing the duplicate
    --     onto it would violate the subject_id UNIQUE constraint. Duplicate
    --     deduplication is out of scope for this migration.
    IF to_regclass('public.users') IS NOT NULL THEN
        UPDATE multica_user m
        SET subject_id = u.subject_id
        FROM users u
        WHERE u.casdoor_universal_id IS NOT NULL
          AND u.casdoor_universal_id <> ''
          AND m.subject_id IS NOT NULL
          AND m.subject_id NOT LIKE 'usr\_%' ESCAPE '\'
          AND m.subject_id = u.casdoor_universal_id
          AND m.subject_id <> u.subject_id
          AND NOT EXISTS (
              SELECT 1 FROM multica_user m2
              WHERE m2.subject_id = u.subject_id AND m2.id <> m.id
          );

        -- 1b. Backfill subject_id for users where it is NULL, by exact email
        --     match against costrict users. Only hits users whose real email
        --     is identical in both systems (synthetic @casdoor.local emails
        --     never match, so this is a safe, narrow fix).
        UPDATE multica_user m
        SET subject_id = u.subject_id
        FROM users u
        WHERE m.subject_id IS NULL
          AND u.email IS NOT NULL
          AND u.email <> ''
          AND m.email = u.email;

        RAISE NOTICE '158: subject_id backfill complete';
    ELSE
        RAISE NOTICE '158: costrict users table absent; skipped subject_id backfill';
    END IF;

    -- 2. Grant can_manage_workflows to every platform admin now that
    --    subject_id is repaired. In platform mode the Checker ignores this
    --    column (it reads the role table live), but setting it TRUE keeps
    --    local/fallback mode consistent. Non-admins are NOT revoked: the
    --    column is ignored in platform mode and revoking could strip
    --    legitimately granted local admins.
    UPDATE multica_user m
    SET can_manage_workflows = TRUE
    FROM user_system_roles r
    WHERE m.subject_id IS NOT NULL
      AND m.subject_id <> ''
      AND r.user_id = m.subject_id
      AND r.role = 'platform_admin'
      AND r.deleted_at IS NULL
      AND m.can_manage_workflows = FALSE;

    RAISE NOTICE '158: can_manage_workflows granted to platform admins';
END $$;

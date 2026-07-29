-- One-shot data migration: converge member identity to cs-user subject_id.
--
-- RUN ORDER (production): migrate-up to 146 → run THIS script → migrate-up to 147.
--   - 146 adds multica_member.subject_id (and the old external_*/casdoor_universal_id
--     columns still exist, so the backfill joins below work).
--   - 147 drops those old columns, so this script MUST run in the window between
--     146 and 147. It is idempotent within that window.
--
-- What it does:
--   1. Backfill multica_member.subject_id from the linked user's subject_id
--      (cs-user subject_id, usr_<uuid>).
--   2. Backfill members with no user_id but a matching external_universal_id
--      (pre-linking dept rows). Only possible before 147 drops the column.
--   3. Drop members that still have no subject_id and aren't active (the
--      pending_activation state is removed; such rows are obsolete).
--   4. Delete legacy Casdoor-sub accounts (provisioned under the local Casdoor
--      sub, never migrated to a cs-user subject_id) — members first, then users,
--      so FKs don't block. These users re-provision cleanly on next cs-user-SSO
--      login. DESTRUCTIVE: their old memberships/issue ownership orphan; this
--      targets dormant/legacy accounts and is intentional.

BEGIN;

-- 1. Linked members → their user's subject_id.
UPDATE multica_member m
SET subject_id = u.subject_id
FROM multica_user u
WHERE m.user_id = u.id
  AND u.subject_id LIKE 'usr\_%' ESCAPE '\'
  AND (m.subject_id IS NULL OR m.subject_id = '');

-- 2. Unlinked dept rows matched by universal_id (pre-147 only).
UPDATE multica_member m
SET subject_id = u.subject_id
FROM multica_user u
WHERE m.user_id IS NULL
  AND m.external_universal_id IS NOT NULL
  AND m.external_universal_id = u.casdoor_universal_id
  AND u.subject_id LIKE 'usr\_%' ESCAPE '\'
  AND (m.subject_id IS NULL OR m.subject_id = '');

-- 3. Drop obsolete non-active members with no subject_id.
DELETE FROM multica_member
WHERE (subject_id IS NULL OR subject_id = '')
  AND status <> 'active';

-- 4. Clean legacy Casdoor-sub accounts.
DELETE FROM multica_member
WHERE user_id IN (
    SELECT id FROM multica_user
    WHERE subject_id IS NULL OR subject_id NOT LIKE 'usr\_%' ESCAPE '\'
);
DELETE FROM multica_user
WHERE subject_id IS NULL OR subject_id NOT LIKE 'usr\_%' ESCAPE '\';

COMMIT;

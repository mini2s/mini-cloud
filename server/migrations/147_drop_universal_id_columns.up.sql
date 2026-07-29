-- universal_id / external identity columns are no longer stored: members are
-- keyed on cs-user subject_id, and universal_id is used only transiently (from
-- the Casdoor JWT / cs-user) to look up org identity in dept-sync. Dropping a
-- column cascades to its dependent indexes/constraints.
ALTER TABLE multica_member DROP COLUMN IF EXISTS external_universal_id;
ALTER TABLE multica_member DROP COLUMN IF EXISTS external_user_id;
ALTER TABLE multica_user DROP COLUMN IF EXISTS casdoor_universal_id;

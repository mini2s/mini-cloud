-- user_auth_identities is owned by the cs-user service (its own goose
-- migrations) and only exists in deployments where multica shares a database
-- with cs-user. It links a cloud-api subject id (usr_...) to the Casdoor
-- identities bound to that account, and is read at login time to resolve all
-- of a person's subjects to a single multica user. Callers must tolerate
-- SQLSTATE 42P01 (undefined_table) in standalone deployments.

-- name: ListAuthIdentitiesBySubjects :many
SELECT user_subject_id, external_subject
FROM user_auth_identities
WHERE deleted_at IS NULL
  AND explicitly_unbound = false
  AND (user_subject_id = ANY($1::text[]) OR external_subject = ANY($1::text[]));

-- name: ListUsersBySubjectIDs :many
SELECT * FROM multica_user
WHERE subject_id = ANY($1::text[]);

-- Generation-only schema stub for sqlc.
--
-- This table is NOT owned by multica's migrations and this file must never be
-- applied to a database. user_auth_identities is created and maintained by
-- the cs-user service in deployments where multica shares its database; the
-- DDL below exists solely so sqlc can type-check queries against it. Keep it
-- in sync with cs-user's goose migrations (column subset used by queries).

CREATE TABLE user_auth_identities (
    id                 bigint PRIMARY KEY,
    user_subject_id    text NOT NULL,
    provider           text NOT NULL,
    issuer             text,
    external_key       text NOT NULL,
    external_subject   text,
    external_user_id   text,
    provider_user_id   text,
    display_name       text,
    email              text,
    phone              text,
    avatar_url         text,
    organization       text,
    is_primary         boolean NOT NULL DEFAULT false,
    last_login_at      timestamptz,
    created_at         timestamptz,
    updated_at         timestamptz,
    deleted_at         timestamptz,
    explicitly_unbound boolean NOT NULL DEFAULT false
);

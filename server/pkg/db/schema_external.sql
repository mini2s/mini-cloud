-- Generation-only schema stub for sqlc.
--
-- These tables are NOT owned by multica's migrations and this file must never
-- be applied to a database. They are created and maintained by external
-- services (cs-user, costrict-web) in deployments where multica shares its
-- database; the DDL below exists solely so sqlc can type-check queries against
-- them. Keep each stub in sync with the owning service's migrations (column
-- subset used by queries).

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

-- user_system_roles is owned by the costrict-web main server (GORM-managed)
-- and exists in the same database in costrict-integrated deployments. The
-- DDL below is a column subset so sqlc can type-check read-only queries.
CREATE TABLE user_system_roles (
    id         text PRIMARY KEY,
    user_id    text NOT NULL,
    role       text NOT NULL,
    granted_by text,
    created_at timestamptz,
    updated_at timestamptz,
    deleted_at timestamptz
);

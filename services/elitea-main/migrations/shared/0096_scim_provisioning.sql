-- 0096_scim_provisioning.sql — the side table SCIM 2.0 user provisioning needs.
--
-- WHAT SCIM IS FOR HERE. An identity provider (Okta, Entra ID, OneLogin) that
-- federates logins can also PUSH the directory: create an account when a person
-- joins, update it when their name or address changes, and deactivate it when
-- they leave. Without it, an account is created on first login and never
-- removed — a person who leaves the company keeps a working account until
-- somebody remembers to suspend it by hand.
--
-- Nothing in this platform did SCIM before this migration, and neither did
-- pylon: `grep -ril scim legacy/plugins/` finds nothing. This is not a port.
--
-- WHY A SIDE TABLE AND NOT COLUMNS ON `auth_core__user`. That table is owned by
-- the pylon schema (internal/infra/db/migrations/001_initial.sql seeds it, and a
-- pylon-managed deployment creates it). Claiming a pylon-owned table in a shared
-- migration has broken this repository's seeds three times with a 42P07, and the
-- rule that came out of it is: read and UPDATE those rows, never change their
-- shape. So the SCIM-specific facts live here, keyed by the user id.
--
-- The person's identity itself stays where it already is:
--
--   * `auth_core__user.email`     is the SCIM `userName` and primary email.
--   * `auth_core__user.name`      is the SCIM `displayName`.
--   * `auth_core__user.suspended` is the inverse of the SCIM `active` flag.
--
-- Only `externalId` and the resource timestamps have nowhere to go, and they are
-- what this table holds.
--
-- EXTERNAL_ID IS THE IDENTITY PROVIDER'S OWN KEY, and it is UNIQUE. SCIM clients
-- use it to find the resource they created when they have lost the local id, and
-- two accounts claiming one external id would make that lookup ambiguous — the
-- client would update whichever the database returned first.
--
-- WHY SHARED, NOT TENANT. A directory is platform-wide: the identity provider
-- pushes people, not project members, and the accounts it creates exist before
-- any project selects them.
--
-- IDEMPOTENT throughout. No BEGIN/COMMIT: the ledgered runner executes each
-- file inside one transaction with its ledger row (migrate/runner.go apply).

CREATE SCHEMA IF NOT EXISTS elitea_auth;

CREATE TABLE IF NOT EXISTS elitea_auth.scim_users (
    -- user_id is the primary key: one SCIM record per account, and the account
    -- is the thing that already exists. ON DELETE CASCADE keeps this table from
    -- outliving the row it describes.
    user_id     integer     PRIMARY KEY
                REFERENCES auth_core__user(id) ON DELETE CASCADE,
    -- external_id is the identity provider's own identifier for the person. It
    -- is optional: a client MAY omit it, and RFC 7643 says a service provider
    -- must not require one.
    external_id text        NOT NULL DEFAULT '',
    -- created_at and updated_at are the SCIM `meta.created` and
    -- `meta.lastModified`. auth_core__user carries neither, and a resource with
    -- no timestamps cannot answer the conditional requests a client makes.
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One account per external id. An empty external_id is NOT constrained, because
-- an omitted identifier is legitimate and every such row would otherwise
-- collide with every other.
CREATE UNIQUE INDEX IF NOT EXISTS scim_users_external_id_uniq
    ON elitea_auth.scim_users (external_id)
    WHERE external_id <> '';

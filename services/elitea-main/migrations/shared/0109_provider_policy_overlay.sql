-- 0109_provider_policy_overlay.sql — the thing 0107 refused for want of.
--
-- 0107 wrote ADR-0012's "a missing overlay policy fails admission" as a CHECK:
--
--     CHECK (status <> 'active' OR overlay_revision IS NOT NULL)
--
-- and recorded, in its own header, that this deployment therefore "can RECORD
-- and SHOW a descriptor and physically CANNOT activate one, because it has no
-- way to issue an overlay yet". That was the honest state then. It is a
-- refusal, not an architecture, and this file is the part that lifts it: an
-- issuer for the thing the CHECK demands.
--
-- WHY A TABLE AND NOT A COLUMN. `overlay_revision` on the revision row was a
-- free TEXT column with nothing behind it. Any string satisfied the CHECK, so
-- the constraint that reads as "activation requires a reviewed policy" was
-- really "activation requires a non-empty string" — and the first caller in a
-- hurry would have written 'todo' into it and passed. The FOREIGN KEY added at
-- the bottom of this file is what makes `overlay_revision` TRUE: the value now
-- has to name a row that records a body, its digest, the manifest it was
-- reviewed against, who wrote it and who approved it. A fabricated revision id
-- is rejected by PostgreSQL, not by a Go branch someone can delete.
--
-- INSERT-ONLY, like provider_published_manifest and for the same reason. The
-- revision id is derived from the body's digest ('lpo_' || left(sha256(canonical
-- body), 32)), so the same reviewed facts issued twice are ONE row, and an
-- admission that cites an overlay cites bytes that cannot subsequently change.
-- There is no UPDATE path in internal/providerhub, and there is no column here
-- an UPDATE would be for: changing the policy means issuing a new revision and
-- activating against it, which is the supersession the specification describes.
--
-- WHAT v1 STORES, AND WHAT IT DOES NOT. The specification's
-- `LegacyProviderPolicyOverlayV1` (elitea-docs, spec-provider-service.mdx) lists
-- a dozen reviewed facts: per-tool effect classes, idempotency, cancellation,
-- timeouts, retry, event retention, secret requirement keys, egress and limits
-- profile references. `body` is JSONB and holds whatever of that the reviewer
-- recorded, verbatim — this migration does not pin a schema for it, because a
-- column shape frozen now would be a second, drifting copy of a schema that
-- lives in libs/jsonschema and is still being written. What IS pinned here is
-- the identity: the digest, the binding to a manifest, and the two actors.
--
-- ── THE CREATOR ≠ APPROVER RULE IS RECORDED, NOT ENFORCED, IN v1 ────────────
--
-- The specification says "the creator cannot approve the same revision", and
-- that is the right rule for a reviewed deployment. It is NOT a CHECK here, and
-- the omission is deliberate rather than forgotten.
--
-- A single-operator deployment — the standalone stack, an evaluation install,
-- every developer's laptop — has exactly one administrator. A CHECK
-- (created_by <> approved_by) would make activation IMPOSSIBLE on all of them,
-- which is precisely the failure 0107 already had and this migration exists to
-- end. Shipping a constraint that turns "cannot activate, no overlay issuer"
-- into "cannot activate, no second operator" would be motion, not progress.
--
-- So both columns are recorded, always, and a two-person deployment can already
-- see from the row whether one person did both. Enforcement is a LATER
-- DECISION: it wants a deployment-level posture (the way
-- ELITEA_PROVIDER_ADMISSION already distinguishes record from enforce) rather
-- than a constraint every install pays for, and it wants an approval step that
-- is a separate audited request instead of two columns filled in by one
-- handler. Neither exists yet. Recording the columns now is what makes that
-- later change a policy change rather than a schema migration over live rows.

-- ── the overlay ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS provider_hub.provider_policy_overlay (
    -- 'lpo_' || left(sha256(canonical body), 32). Content-derived, so the same
    -- reviewed facts are one row however many times they are issued.
    overlay_revision    TEXT        PRIMARY KEY,
    project_id          BIGINT      NOT NULL,
    provider_id         TEXT        NOT NULL,
    -- WHAT THE POLICY WAS REVIEWED AGAINST. An overlay is a statement about a
    -- specific published manifest's tools; carrying it to a different manifest
    -- would be applying reviewed limits to unreviewed bytes. The reference is
    -- what stops that silently.
    manifest_digest     TEXT        NOT NULL
        REFERENCES provider_hub.provider_published_manifest(digest),
    body                JSONB       NOT NULL,
    -- The full sha256 of the canonical body. `overlay_revision` truncates it to
    -- 32 hex characters for a readable id; this column keeps the whole thing,
    -- so a later verifier can re-digest the body and compare without having to
    -- know how the id was abbreviated.
    digest              TEXT        NOT NULL,
    created_by          TEXT        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    -- Recorded, never NULL. See the header: the rule that these two must differ
    -- is a later decision, and a NULLable approver would make "not yet
    -- approved" and "approved by the creator" the same absence.
    approved_by         TEXT        NOT NULL,
    approved_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT provider_policy_overlay_revision_shape
        CHECK (overlay_revision ~ '^lpo_[0-9a-f]{32}$'),
    CONSTRAINT provider_policy_overlay_digest_is_sha256
        CHECK (digest ~ '^[0-9a-f]{64}$'),
    -- The id must actually abbreviate the digest it sits beside. Without this a
    -- row could carry an id derived from one body and a digest from another,
    -- and every later verification would compare the wrong pair.
    CONSTRAINT provider_policy_overlay_revision_matches_digest
        CHECK (overlay_revision = 'lpo_' || left(digest, 32)),
    CONSTRAINT provider_policy_overlay_body_is_object
        CHECK (jsonb_typeof(body) = 'object'),
    CONSTRAINT provider_policy_overlay_actors_present
        CHECK (created_by <> '' AND approved_by <> ''),
    CONSTRAINT provider_policy_overlay_provider_id_bounded
        CHECK (provider_id <> '' AND length(provider_id) <= 128)
);

CREATE INDEX IF NOT EXISTS provider_policy_overlay_provider_idx
    ON provider_hub.provider_policy_overlay (project_id, provider_id, created_at DESC);

-- ── the reference that makes `overlay_revision` true ────────────────────────
--
-- ADD CONSTRAINT has no IF NOT EXISTS, and this corpus's migrations must be
-- re-runnable, so the catalogue is consulted first. `NOT VALID` is NOT used:
-- every existing row has overlay_revision NULL (nothing could activate before
-- this file), so there is nothing to validate and the table scan is over an
-- empty set.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'provider_admitted_revision_overlay_revision_fkey'
           AND conrelid = 'provider_hub.provider_admitted_revision'::regclass
    ) THEN
        ALTER TABLE provider_hub.provider_admitted_revision
            ADD CONSTRAINT provider_admitted_revision_overlay_revision_fkey
            FOREIGN KEY (overlay_revision)
            REFERENCES provider_hub.provider_policy_overlay(overlay_revision)
            ON DELETE RESTRICT;
    END IF;
END
$$;

-- ── the permission that gates the new verb ──────────────────────────────────
--
-- `provider_hub.descriptor.activate`, and it is a NEW string rather than a
-- reuse of `provider_hub.descriptor.register`.
--
-- Registering records what this deployment KNOWS about a provider; activating
-- decides that agents may call it. A facade's boot-time registrar files a
-- registration on every start, so `.register` is a permission a deployment is
-- comfortable handing out. Activation is the switch, and the two must be
-- separately grantable or the operator who may record a descriptor is
-- automatically the operator who may put it in force. internal/api/router.go
-- gates the activate/deactivate routes on this string alone, and a holder of
-- `.register` gets 403 there — pinned by a test, because a split that nothing
-- asserts is a split that the next composition quietly loses.
--
-- Granted to the administration-mode `super_admin` and `admin` only. No editor,
-- and no per-project override delivery: activation is a fact about the
-- DEPLOYMENT (the registration it acts on is filed under the public project,
-- not the caller's), so a per-project grant would describe an authority that
-- does not exist. 0060's VIRGIN-mode guard is not reproduced, for the reason
-- 0082 gives: this permission never existed on a Go deployment, so no operator
-- can have revoked it, and a guard that skips configured deployments would
-- leave exactly those unable to activate anything.
DO $$
BEGIN

IF to_regclass('public.auth_core__role') IS NULL
   OR to_regclass('public.auth_core__role_permission') IS NULL THEN
    RAISE NOTICE '0109: auth_core tables absent, nothing to grant';
    RETURN;
END IF;

INSERT INTO public.auth_core__role_permission (role_id, permission)
SELECT role.id, 'provider_hub.descriptor.activate'
FROM public.auth_core__role AS role
WHERE role.mode = 'administration' AND role.name IN ('super_admin', 'admin')
ON CONFLICT (role_id, permission) DO NOTHING;

END
$$;

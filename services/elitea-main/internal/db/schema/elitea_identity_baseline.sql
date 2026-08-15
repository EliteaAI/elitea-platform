-- SQLC compiler projection for the Go-owned elitea_identity schema
-- (ADR-0018, spec-llm-project-scope §3).
--
-- This file is NOT a runtime migration.
-- migrations/shared/0070_token_project_binding.sql remains the only
-- target-schema authority. The migration guards the foreign key with
-- to_regclass, because elitea-migrate can run before auth_core exists. The
-- projection below declares the same shape unguarded, because sqlc type-checks
-- against a complete catalog.

CREATE SCHEMA elitea_identity;

CREATE TABLE elitea_identity.token_project_binding (
    token_id   integer PRIMARY KEY
        REFERENCES public.auth_core__token (id) ON DELETE CASCADE,
    project_id integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_token_project_binding_project
    ON elitea_identity.token_project_binding (project_id);

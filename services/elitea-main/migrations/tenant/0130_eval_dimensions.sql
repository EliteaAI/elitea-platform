-- The evaluation DIMENSION LIBRARY: one reusable scoring criterion, per tenant.
--
-- WHAT THIS IS THE FIRST SLICE OF, AND WHAT IT DELIBERATELY IS NOT.
--
-- Agent Evaluation in the baseline UI (frontends/EliteaUI, `src/[fsd]/widgets/
-- evaluation/`) is 38 operations over 19 `eval_*` path families: dimensions,
-- suites, bindings, datasets, cases, runs, results, human scores, a platform
-- catalogue and an AI dimension generator. This file creates ONE of those
-- tables and no other.
--
-- The reason is that the library is the only part with no run engine behind
-- it. A suite binds dimensions to an agent; a dataset feeds cases to a run; a
-- run needs an orchestrator, a judge model and a code sandbox. None of those
-- exist in this service. A dimension, on the other hand, is authored, stored
-- and read back on its own — so it can ship, be used, and be correct while the
-- rest is still unbuilt. `eval_suites`, `eval_bindings`, `eval_datasets`,
-- `eval_dataset_cases`, `eval_runs`, `eval_results` and `eval_human_scores`
-- are NOT created here and must arrive with the code that reads them.
--
-- WHY TENANT AND NOT SHARED.
--
-- A dimension is a project's own authored content, exactly like an agent, a
-- skill or a dataset would be. It is addressed through `{projectID}` on every
-- route, and the repository resolves `p_<projectID>` from that segment, so its
-- rows are per-tenant by construction. The shared history holds cross-project
-- objects — the RBAC corpus, gateway prices, identity providers — and a
-- dimension is none of those. The one tier that IS cross-project by intent,
-- `platform`, is a REGISTRY the baseline materialises INTO a project's own
-- table on first use (`materializePlatformDimension`,
-- widgets/evaluation/api/evaluationApi.js:74-81); that registry is not built
-- here, and `tier = 'platform'` is accepted only so a materialised row can be
-- stored and rendered read-only later.
--
-- Note the split from the permissions: the four
-- `models.applications.evaluation.dimension.*` grants are central RBAC and so
-- live in shared/0100_evaluation_dimension_permissions.sql. Table here, grants
-- there, and both are needed for a single working route.
--
-- WHY THE CONSTRAINTS ARE IN THE DATABASE AND NOT ONLY IN THE HANDLER.
--
-- Every rule below is also enforced in
-- internal/api/v2/evaluation/dimension.go, and that is where a caller gets a
-- readable 400. The duplicate is deliberate. These columns are the input to a
-- future `normalize_score` (the baseline's client-side mirror is
-- widgets/evaluation/lib/helpers/scorecard.helpers.js, whose own comment says
-- it "mirrors the server's normalize_score exactly — same clamp-then-flip
-- order, same 2dp rounding"). A row with `scale_min >= scale_max` divides by
-- zero there; a row with no `polarity` silently scores an inverse metric
-- backwards. A scorer reading a stored row cannot re-run the handler's
-- validation, so the row itself has to be unable to hold those shapes — the
-- second writer this table will eventually have (an import, a seed, a
-- generator) gets the same refusal.
--
--   * `allowed_engines` is a subset of {ai, human, code} and is non-empty, and
--     `['code']` is MUTUALLY EXCLUSIVE with ai/human. That exclusivity is the
--     baseline's own rule (DimensionEditorDialog.jsx:92-104 replaces the whole
--     set rather than adding to it, and the constants file records it as
--     "backend: allowed_engines == ['code'] cannot also contain ai/human").
--     It is not cosmetic: an AI judge grades against `description`, a code
--     validation executes `code`, and a dimension claiming both has two
--     different answers for one score with nothing to choose between them.
--   * A code-engine dimension REQUIRES `code`. Without it the row is a
--     validation that cannot validate.
--   * `default_target` and `default_target_operator` are required TOGETHER or
--     not at all. A target with no operator is not comparable, and an operator
--     with no target compares against nothing.
--
-- WHAT IS NOT CONSTRAINED, ON PURPOSE.
--
--   * There is NO unique constraint on `name`. The baseline's editor does not
--     claim one and its error surface has no duplicate-name branch; inventing
--     one here would refuse writes the reference accepts, and a UNIQUE added
--     later is a far smaller change than one removed after rows exist.
--   * `application_id` carries NO foreign key when `applications` is absent,
--     and a plain FK with no ON DELETE clause when it is present — the same
--     choice 0126 makes for `chat_conversations.folder_id`, for the same
--     reason: deleting an agent must not silently destroy authored library
--     rows, and `ON DELETE SET NULL` would quietly promote an agent-scoped
--     dimension into the project library. Deletion is the application's
--     decision to make explicitly.
--   * `tier = 'agent_adhoc' <-> application_id IS NOT NULL` is NOT a table
--     constraint. The handler enforces the pairing on write. Stating it here
--     would make the FK-less fixture schemas (where `application_id` cannot be
--     validated at all) reject rows they can otherwise hold, and the pairing
--     is an authoring rule rather than a storage invariant.
--
-- The `to_regclass` guard around the FK is 0126's: ALTER TABLE ... ADD
-- CONSTRAINT has no IF NOT EXISTS, so an unguarded ADD raises 42710 on a
-- re-run and 42P01 where `applications` was never created. Several integration
-- fixtures apply the tenant chain to a schema of their own making, and a raise
-- there fails the WHOLE chain rather than this file.
--
-- Table names are UNQUALIFIED: tenant migrations run with a transaction-local
-- search_path pinned to the tenant schema (internal/infra/db/migrate/
-- runner.go:83-96).
DO $$
BEGIN
    CREATE TABLE IF NOT EXISTS eval_dimensions (
        id serial PRIMARY KEY,
        uuid uuid UNIQUE DEFAULT gen_random_uuid(),
        name varchar(128) NOT NULL,
        description text,
        tier varchar(32) NOT NULL DEFAULT 'project',
        application_id integer,
        allowed_engines text[] NOT NULL,
        scale_type varchar(32) NOT NULL,
        scale_min double precision NOT NULL,
        scale_max double precision NOT NULL,
        polarity varchar(32) NOT NULL,
        default_weight double precision NOT NULL DEFAULT 1,
        default_target double precision,
        default_target_operator varchar(2),
        code text,
        return_contract varchar(16),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT eval_dimensions_tier_check
            CHECK (tier IN ('project', 'agent_adhoc', 'platform')),
        CONSTRAINT eval_dimensions_scale_type_check
            CHECK (scale_type IN ('binary', 'ordinal', 'continuous')),
        CONSTRAINT eval_dimensions_polarity_check
            CHECK (polarity IN ('higher_better', 'lower_better')),
        CONSTRAINT eval_dimensions_scale_bounds_check
            CHECK (scale_min < scale_max),
        CONSTRAINT eval_dimensions_engines_nonempty_check
            CHECK (array_length(allowed_engines, 1) >= 1),
        CONSTRAINT eval_dimensions_engines_known_check
            CHECK (allowed_engines <@ ARRAY['ai', 'human', 'code']::text[]),
        -- The mutual exclusion, written as an implication: if `code` is in the
        -- set then the set is exactly {code}.
        CONSTRAINT eval_dimensions_code_engine_exclusive_check
            CHECK (
                NOT ('code' = ANY (allowed_engines))
                OR allowed_engines = ARRAY['code']::text[]
            ),
        CONSTRAINT eval_dimensions_code_required_check
            CHECK (
                allowed_engines <> ARRAY['code']::text[]
                OR (code IS NOT NULL AND btrim(code) <> '')
            ),
        CONSTRAINT eval_dimensions_return_contract_check
            CHECK (return_contract IS NULL OR return_contract IN ('bool', 'number')),
        CONSTRAINT eval_dimensions_target_operator_check
            CHECK (default_target_operator IS NULL
                   OR default_target_operator IN ('>=', '>', '<=', '<', '==')),
        CONSTRAINT eval_dimensions_target_pair_check
            CHECK ((default_target IS NULL) = (default_target_operator IS NULL))
    );

    -- The library listing is "this project's dimensions, plus this agent's
    -- ad-hoc ones", ordered by name. Both halves read `tier`, so the index
    -- carries it first and `application_id` second.
    CREATE INDEX IF NOT EXISTS eval_dimensions_tier_application_idx
        ON eval_dimensions (tier, application_id);

    IF to_regclass('applications') IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM pg_constraint AS con
          JOIN pg_attribute AS att
            ON att.attrelid = con.conrelid
           AND att.attnum = ANY (con.conkey)
         WHERE con.conrelid = to_regclass('eval_dimensions')
           AND con.contype = 'f'
           AND att.attname = 'application_id'
    ) THEN
        ALTER TABLE eval_dimensions
            ADD CONSTRAINT eval_dimensions_application_id_fkey
            FOREIGN KEY (application_id) REFERENCES applications(id);
    END IF;
END
$$;

COMMENT ON TABLE eval_dimensions IS
    'Reusable evaluation scoring criteria authored inside one project. Slice 1 of Agent Evaluation: the library only — no suite, binding, dataset, run or result table exists yet.';
COMMENT ON COLUMN eval_dimensions.tier IS
    'project = the project library; agent_adhoc = scoped to application_id alone; platform = a row materialised from the (not yet built) platform registry and rendered read-only.';
COMMENT ON COLUMN eval_dimensions.allowed_engines IS
    'Subset of {ai, human, code}. ARRAY[''code''] is mutually exclusive with ai/human and requires `code`.';
COMMENT ON COLUMN eval_dimensions.polarity IS
    'higher_better | lower_better. Applied LAST in normalisation, so an unset polarity scores an inverse metric backwards — which is why it is NOT NULL rather than defaulted.';

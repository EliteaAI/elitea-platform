-- Bring `elitea_tools` up to the shape every toolkit query already assumes.
--
-- internal/db/schema/toolkit_baseline.sql is the sqlc projection of this table
-- and, like agent_chat_baseline.sql before #287, it says the table "already
-- exists in each p_<project_id> schema and is owned by the current
-- tenant-schema lifecycle" — pylon's. So the Go bootstrap schema
-- (internal/infra/db/migrations/001_initial.sql:435-447) created its own,
-- narrower version, and nothing reconciled the two.
--
-- Three columns are in the projection and not in the bootstrap table:
-- `updated_at`, `shared_owner_id`, `shared_id`. They are not decoration —
-- internal/db/queries/toolkits.sql selects all three by name, so on a
-- pylon-free deployment the very first toolkit read fails with
--
--     ERROR: column "updated_at" does not exist  (SQLSTATE 42703)
--
-- MEASURED on the standalone stack: POST /api/v2/elitea_core/test_toolkit_tool/
-- prompt_lib/1 (the #93 Surface A index-start route) answered
-- `500 {"error":"Failed to start index_data"}` for this reason and no other —
-- the toolkit was never read, so the request could not even reach the
-- `ErrToolkitNotVisible` 404 it deserved for naming a toolkit that did not
-- exist.
--
-- Additive and IF NOT EXISTS for the same reason as 0123: in a mixed
-- deployment pylon already created these columns and owns their shape, so
-- there this migration records itself and changes nothing. Nullability of the
-- existing columns is deliberately left alone — narrowing `settings`/`meta` to
-- NOT NULL would be a change to a shape this repository does not own.
--
-- (shared_owner_id, shared_id) mirrors 0122's skills columns: it points a
-- public-catalog toolkit at the project + toolkit it was published from.

ALTER TABLE elitea_tools
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

ALTER TABLE elitea_tools
    ADD COLUMN IF NOT EXISTS shared_owner_id INTEGER;

ALTER TABLE elitea_tools
    ADD COLUMN IF NOT EXISTS shared_id INTEGER;

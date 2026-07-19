-- Emit one deterministic, read-only JSON document describing the legacy
-- PostgreSQL catalog. The only application-table rows selected are the two
-- explicitly allowlisted migration ledgers at the end of this query.
-- `catalog_sha256` hashes the canonical JSONB text stored under `catalog`.
-- Update the fixed source identity/date below only when deliberately refreshing
-- the checked-in baseline from a different database snapshot.
--
-- Example:
--   docker exec -i centry-postgres-1 \
--     psql -U centry -d db -X -qAt -v ON_ERROR_STOP=1 \
--     < scripts/database/export_legacy_catalog.sql

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;

WITH user_schemas AS (
    SELECT namespace.oid, namespace.nspname
    FROM pg_catalog.pg_namespace AS namespace
    WHERE namespace.nspname <> 'information_schema'
      AND namespace.nspname !~ '^pg_'
),
schema_documents AS (
    SELECT
        schema.oid,
        schema.nspname,
        jsonb_build_object(
            'name', schema.nspname,
            'tables', COALESCE((
                SELECT jsonb_agg(table_entry.document ORDER BY table_entry.name)
                FROM (
                    SELECT
                        relation.relname AS name,
                        jsonb_build_object(
                            'name', relation.relname,
                            'kind', CASE relation.relkind
                                WHEN 'p' THEN 'partitioned_table'
                                ELSE 'table'
                            END,
                            'is_partition', relation.relispartition,
                            'row_security_enabled', relation.relrowsecurity,
                            'row_security_forced', relation.relforcerowsecurity,
                            'columns', COALESCE((
                                SELECT jsonb_agg(column_entry.document ORDER BY column_entry.position)
                                FROM (
                                    SELECT
                                        attribute.attnum AS position,
                                        jsonb_strip_nulls(jsonb_build_object(
                                            'name', attribute.attname,
                                            'data_type', pg_catalog.format_type(
                                                attribute.atttypid,
                                                attribute.atttypmod
                                            ),
                                            'nullable', NOT attribute.attnotnull,
                                            'default', pg_catalog.pg_get_expr(
                                                default_value.adbin,
                                                default_value.adrelid
                                            ),
                                            'identity', CASE attribute.attidentity
                                                WHEN 'a' THEN 'always'
                                                WHEN 'd' THEN 'by_default'
                                                ELSE NULL
                                            END,
                                            'generated', CASE attribute.attgenerated
                                                WHEN 's' THEN 'stored'
                                                WHEN 'v' THEN 'virtual'
                                                ELSE NULL
                                            END
                                        )) AS document
                                    FROM pg_catalog.pg_attribute AS attribute
                                    LEFT JOIN pg_catalog.pg_attrdef AS default_value
                                      ON default_value.adrelid = attribute.attrelid
                                     AND default_value.adnum = attribute.attnum
                                    WHERE attribute.attrelid = relation.oid
                                      AND attribute.attnum > 0
                                      AND NOT attribute.attisdropped
                                ) AS column_entry
                            ), '[]'::jsonb),
                            'constraints', COALESCE((
                                SELECT jsonb_agg(constraint_entry.document ORDER BY constraint_entry.name)
                                FROM (
                                    SELECT
                                        constraint_row.conname AS name,
                                        jsonb_strip_nulls(jsonb_build_object(
                                            'name', constraint_row.conname,
                                            'type', CASE constraint_row.contype
                                                WHEN 'c' THEN 'check'
                                                WHEN 'f' THEN 'foreign_key'
                                                WHEN 'p' THEN 'primary_key'
                                                WHEN 'n' THEN 'not_null'
                                                WHEN 'u' THEN 'unique'
                                                WHEN 'x' THEN 'exclusion'
                                                WHEN 't' THEN 'constraint_trigger'
                                                ELSE constraint_row.contype::text
                                            END,
                                            'columns', COALESCE((
                                                SELECT jsonb_agg(
                                                    constrained_attribute.attname
                                                    ORDER BY constrained_key.position
                                                )
                                                FROM unnest(constraint_row.conkey)
                                                    WITH ORDINALITY AS constrained_key(attnum, position)
                                                JOIN pg_catalog.pg_attribute AS constrained_attribute
                                                  ON constrained_attribute.attrelid = constraint_row.conrelid
                                                 AND constrained_attribute.attnum = constrained_key.attnum
                                            ), '[]'::jsonb),
                                            'definition', pg_catalog.pg_get_constraintdef(
                                                constraint_row.oid,
                                                true
                                            ),
                                            'deferrable', CASE
                                                WHEN constraint_row.condeferrable THEN true
                                            END,
                                            'initially_deferred', CASE
                                                WHEN constraint_row.condeferred THEN true
                                            END,
                                            'not_valid', CASE
                                                WHEN NOT constraint_row.convalidated THEN true
                                            END,
                                            'no_inherit', CASE
                                                WHEN constraint_row.connoinherit THEN true
                                            END
                                        )) AS document
                                    FROM pg_catalog.pg_constraint AS constraint_row
                                    WHERE constraint_row.conrelid = relation.oid
                                ) AS constraint_entry
                            ), '[]'::jsonb),
                            'indexes', COALESCE((
                                SELECT jsonb_agg(index_entry.document ORDER BY index_entry.name)
                                FROM (
                                    SELECT
                                        index_relation.relname AS name,
                                        jsonb_strip_nulls(jsonb_build_object(
                                            'name', index_relation.relname,
                                            'definition', pg_catalog.pg_get_indexdef(index_row.indexrelid),
                                            'valid', CASE WHEN NOT index_row.indisvalid THEN false END,
                                            'ready', CASE WHEN NOT index_row.indisready THEN false END,
                                            'live', CASE WHEN NOT index_row.indislive THEN false END
                                        )) AS document
                                    FROM pg_catalog.pg_index AS index_row
                                    JOIN pg_catalog.pg_class AS index_relation
                                      ON index_relation.oid = index_row.indexrelid
                                    WHERE index_row.indrelid = relation.oid
                                ) AS index_entry
                            ), '[]'::jsonb),
                            'triggers', COALESCE((
                                SELECT jsonb_agg(trigger_entry.document ORDER BY trigger_entry.name)
                                FROM (
                                    SELECT
                                        trigger_row.tgname AS name,
                                        jsonb_build_object(
                                            'name', trigger_row.tgname,
                                            'definition', pg_catalog.pg_get_triggerdef(trigger_row.oid, true),
                                            'enabled', CASE trigger_row.tgenabled
                                                WHEN 'O' THEN 'origin'
                                                WHEN 'D' THEN 'disabled'
                                                WHEN 'R' THEN 'replica'
                                                WHEN 'A' THEN 'always'
                                                ELSE trigger_row.tgenabled::text
                                            END
                                        ) AS document
                                    FROM pg_catalog.pg_trigger AS trigger_row
                                    WHERE trigger_row.tgrelid = relation.oid
                                      AND NOT trigger_row.tgisinternal
                                ) AS trigger_entry
                            ), '[]'::jsonb),
                            'row_security_policies', COALESCE((
                                SELECT jsonb_agg(policy_entry.document ORDER BY policy_entry.name)
                                FROM (
                                    SELECT
                                        policy.polname AS name,
                                        jsonb_build_object(
                                            'name', policy.polname,
                                            'permissive', policy.polpermissive,
                                            'command', CASE policy.polcmd
                                                WHEN '*' THEN 'all'
                                                WHEN 'r' THEN 'select'
                                                WHEN 'a' THEN 'insert'
                                                WHEN 'w' THEN 'update'
                                                WHEN 'd' THEN 'delete'
                                                ELSE policy.polcmd::text
                                            END,
                                            'roles', COALESCE((
                                                SELECT jsonb_agg(
                                                    COALESCE(role.rolname, 'PUBLIC')
                                                    ORDER BY COALESCE(role.rolname, 'PUBLIC')
                                                )
                                                FROM unnest(policy.polroles) AS policy_role(role_oid)
                                                LEFT JOIN pg_catalog.pg_roles AS role
                                                  ON role.oid = policy_role.role_oid
                                            ), '[]'::jsonb),
                                            'using', pg_catalog.pg_get_expr(
                                                policy.polqual,
                                                policy.polrelid
                                            ),
                                            'with_check', pg_catalog.pg_get_expr(
                                                policy.polwithcheck,
                                                policy.polrelid
                                            )
                                        ) AS document
                                    FROM pg_catalog.pg_policy AS policy
                                    WHERE policy.polrelid = relation.oid
                                ) AS policy_entry
                            ), '[]'::jsonb)
                        ) AS document
                    FROM pg_catalog.pg_class AS relation
                    WHERE relation.relnamespace = schema.oid
                      AND relation.relkind IN ('r', 'p')
                ) AS table_entry
            ), '[]'::jsonb),
            'views', COALESCE((
                SELECT jsonb_agg(view_entry.document ORDER BY view_entry.name)
                FROM (
                    SELECT
                        relation.relname AS name,
                        jsonb_build_object(
                            'name', relation.relname,
                            'kind', CASE relation.relkind
                                WHEN 'm' THEN 'materialized_view'
                                ELSE 'view'
                            END,
                            'columns', COALESCE((
                                SELECT jsonb_agg(
                                    jsonb_build_object(
                                        'name', attribute.attname,
                                        'data_type', pg_catalog.format_type(
                                            attribute.atttypid,
                                            attribute.atttypmod
                                        ),
                                        'nullable', NOT attribute.attnotnull
                                    )
                                    ORDER BY attribute.attnum
                                )
                                FROM pg_catalog.pg_attribute AS attribute
                                WHERE attribute.attrelid = relation.oid
                                  AND attribute.attnum > 0
                                  AND NOT attribute.attisdropped
                            ), '[]'::jsonb),
                            'definition', pg_catalog.pg_get_viewdef(relation.oid, true)
                        ) AS document
                    FROM pg_catalog.pg_class AS relation
                    WHERE relation.relnamespace = schema.oid
                      AND relation.relkind IN ('v', 'm')
                ) AS view_entry
            ), '[]'::jsonb),
            'sequences', COALESCE((
                SELECT jsonb_agg(sequence_entry.document ORDER BY sequence_entry.name)
                FROM (
                    SELECT
                        relation.relname AS name,
                        jsonb_strip_nulls(jsonb_build_object(
                            'name', relation.relname,
                            'data_type', pg_catalog.format_type(sequence_row.seqtypid, NULL),
                            'start', sequence_row.seqstart::text,
                            'minimum', sequence_row.seqmin::text,
                            'maximum', sequence_row.seqmax::text,
                            'increment', sequence_row.seqincrement::text,
                            'cycle', sequence_row.seqcycle,
                            'cache', sequence_row.seqcache::text,
                            'owned_by', (
                                SELECT jsonb_build_object(
                                    'schema', owning_schema.nspname,
                                    'table', owning_relation.relname,
                                    'column', owning_attribute.attname
                                )
                                FROM pg_catalog.pg_depend AS dependency
                                JOIN pg_catalog.pg_class AS owning_relation
                                  ON owning_relation.oid = dependency.refobjid
                                JOIN pg_catalog.pg_namespace AS owning_schema
                                  ON owning_schema.oid = owning_relation.relnamespace
                                JOIN pg_catalog.pg_attribute AS owning_attribute
                                  ON owning_attribute.attrelid = dependency.refobjid
                                 AND owning_attribute.attnum = dependency.refobjsubid
                                WHERE dependency.classid = 'pg_catalog.pg_class'::regclass
                                  AND dependency.objid = relation.oid
                                  AND dependency.deptype IN ('a', 'i')
                                ORDER BY owning_schema.nspname,
                                         owning_relation.relname,
                                         owning_attribute.attname
                                LIMIT 1
                            )
                        )) AS document
                    FROM pg_catalog.pg_class AS relation
                    JOIN pg_catalog.pg_sequence AS sequence_row
                      ON sequence_row.seqrelid = relation.oid
                    WHERE relation.relnamespace = schema.oid
                      AND relation.relkind = 'S'
                ) AS sequence_entry
            ), '[]'::jsonb)
        ) AS document
    FROM user_schemas AS schema
),
migration_ledger_tables(schema_name, table_name) AS (
    VALUES
        ('centry'::text, 'db_version__elitea_core_trace'::text),
        ('public'::text, 'db_version__auth_core'::text)
),
migration_ledger_rows AS (
    SELECT
        'centry'::text AS schema_name,
        'db_version__elitea_core_trace'::text AS table_name,
        version_num::text
    FROM centry.db_version__elitea_core_trace
    UNION ALL
    SELECT
        'public'::text AS schema_name,
        'db_version__auth_core'::text AS table_name,
        version_num::text
    FROM public.db_version__auth_core
),
catalog_document AS (
    SELECT jsonb_build_object(
        'schemas', COALESCE((
            SELECT jsonb_agg(schema_documents.document ORDER BY schema_documents.nspname)
            FROM schema_documents
        ), '[]'::jsonb),
        'migration_ledgers', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'schema', ledger.schema_name,
                    'table', ledger.table_name,
                    'rows', COALESCE((
                        SELECT jsonb_agg(
                            jsonb_build_object('version_num', row.version_num)
                            ORDER BY row.version_num
                        )
                        FROM migration_ledger_rows AS row
                        WHERE row.schema_name = ledger.schema_name
                          AND row.table_name = ledger.table_name
                    ), '[]'::jsonb)
                )
                ORDER BY ledger.schema_name, ledger.table_name
            )
            FROM migration_ledger_tables AS ledger
        ), '[]'::jsonb)
    ) AS document
)
SELECT jsonb_pretty(jsonb_build_object(
    'format_version', 1,
    'source', jsonb_build_object(
        'identity', 'centry-postgres-1/db',
        'container', 'centry-postgres-1',
        'database', current_database(),
        'captured_on', '2026-07-19',
        'server_version_num', current_setting('server_version_num'),
        'database_timezone', current_setting('TimeZone'),
        'schema_scope', 'all non-system schemas'
    ),
    'catalog_sha256', pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(catalog.document::text, 'UTF8')),
        'hex'
    ),
    'sanitization', jsonb_build_object(
        'application_row_values', 'excluded',
        'allowed_row_values', 'explicit migration ledger version rows only'
    ),
    'catalog', catalog.document
))
FROM catalog_document AS catalog;

COMMIT;

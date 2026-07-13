-- fix-uuid-defaults.sql
-- Adds DEFAULT gen_random_uuid() to the uuid column of four tables
-- in every project schema (p_1 through p_78, with gaps).
-- Idempotent: safe to run multiple times; skips columns that already
-- have a default set.

DO $$
DECLARE
    schemas TEXT[] := ARRAY[
        'p_1','p_2','p_3','p_4','p_5','p_6','p_7','p_8','p_9','p_10',
        'p_11','p_12','p_13','p_14','p_15','p_16','p_17','p_18','p_19','p_20',
        'p_21','p_22','p_23','p_24','p_25','p_26','p_27','p_28','p_29','p_30',
        'p_31','p_32','p_33','p_34','p_35','p_36','p_37','p_38','p_39','p_40',
        'p_41','p_42','p_43','p_44','p_47','p_48','p_49','p_50','p_51','p_52',
        'p_53','p_54','p_55','p_56','p_57','p_58','p_59','p_63','p_64','p_65',
        'p_66','p_67','p_68','p_70','p_71','p_72','p_74','p_75','p_76','p_77',
        'p_78'
    ];
    tables TEXT[] := ARRAY[
        'applications',
        'application_versions',
        'configuration',
        'chat_conversations'
    ];
    s TEXT;
    t TEXT;
    already_has_default BOOLEAN;
    table_exists BOOLEAN;
BEGIN
    -- Ensure pgcrypto / gen_random_uuid is available (built-in since PG 13).
    -- No explicit CREATE EXTENSION needed for PG 13+; the function lives in pg_catalog.

    FOREACH s IN ARRAY schemas LOOP
        FOREACH t IN ARRAY tables LOOP
            -- Check the table exists in this schema
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = s
                  AND table_name   = t
            ) INTO table_exists;

            IF NOT table_exists THEN
                RAISE NOTICE 'SKIP %.% — table does not exist', s, t;
                CONTINUE;
            END IF;

            -- Check whether the uuid column already has a default
            SELECT (column_default IS NOT NULL)
            INTO already_has_default
            FROM information_schema.columns
            WHERE table_schema  = s
              AND table_name    = t
              AND column_name   = 'uuid';

            IF already_has_default IS NULL THEN
                RAISE NOTICE 'SKIP %.%.uuid — column does not exist', s, t;
                CONTINUE;
            END IF;

            IF already_has_default THEN
                RAISE NOTICE 'SKIP %.%.uuid — default already set', s, t;
                CONTINUE;
            END IF;

            -- Apply the default
            EXECUTE format(
                'ALTER TABLE %I.%I ALTER COLUMN uuid SET DEFAULT gen_random_uuid()',
                s, t
            );
            RAISE NOTICE 'FIXED %.%.uuid — DEFAULT gen_random_uuid() applied', s, t;
        END LOOP;
    END LOOP;
END;
$$;

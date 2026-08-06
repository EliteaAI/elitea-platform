-- 001_initial.sql
-- Drop-in compatible schema for the pylon platform.
-- Shared schema: "centry" (projects, users, groups)
-- Tenant schema: "p_{project_id}" (per-project data)

BEGIN;

-- =============================================================================
-- SHARED SCHEMA (centry)
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS centry;

-- Projects
CREATE TABLE IF NOT EXISTS centry.project (
    id SERIAL PRIMARY KEY,
    name VARCHAR(256) NOT NULL,
    owner_id INTEGER NOT NULL,
    secrets_json JSONB DEFAULT '{}'::jsonb,
    plugins TEXT[] DEFAULT '{}',
    keycloak_groups JSONB NOT NULL DEFAULT '{}'::jsonb,
    create_success BOOLEAN NOT NULL DEFAULT false,
    suspended BOOLEAN NOT NULL DEFAULT false
);

-- Project groups
CREATE TABLE IF NOT EXISTS centry.project_group (
    id SERIAL PRIMARY KEY,
    name VARCHAR(256) NOT NULL UNIQUE
);

-- Project <-> Group association
CREATE TABLE IF NOT EXISTS centry.project_group_association (
    project_id INTEGER REFERENCES centry.project(id) ON DELETE CASCADE,
    group_id INTEGER REFERENCES centry.project_group(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, group_id)
);

-- Social users (author profiles)
CREATE TABLE IF NOT EXISTS centry.social_users (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE,
    avatar VARCHAR,
    title VARCHAR,
    description VARCHAR,
    personalization JSONB,
    default_context_management JSONB,
    default_summarization JSONB
);

-- =============================================================================
-- TENANT SCHEMA FUNCTION
-- Creates all per-project tables in a given schema (e.g. "p_1")
-- =============================================================================
CREATE OR REPLACE FUNCTION create_tenant_schema(schema_name TEXT) RETURNS void AS $$
BEGIN
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', schema_name);

    -- Tags
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.tags (
            id SERIAL PRIMARY KEY,
            name VARCHAR NOT NULL UNIQUE,
            data JSONB
        )', schema_name);

    -- Applications
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.applications (
            id SERIAL PRIMARY KEY,
            name VARCHAR(128) NOT NULL,
            description VARCHAR(2304),
            icon VARCHAR,
            owner_id INTEGER NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            shared_owner_id INTEGER,
            shared_id INTEGER,
            uuid UUID UNIQUE DEFAULT gen_random_uuid(),
            webhook_secret VARCHAR,
            meta JSONB DEFAULT ''{}''::jsonb,
            CONSTRAINT application_shared_origin UNIQUE (shared_owner_id, shared_id)
        )', schema_name);

    -- Application versions
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.application_versions (
            id SERIAL PRIMARY KEY,
            application_id INTEGER NOT NULL REFERENCES %I.applications(id) ON DELETE CASCADE,
            name VARCHAR(128) NOT NULL,
            status VARCHAR NOT NULL DEFAULT ''draft'',
            author_id INTEGER NOT NULL,
            uuid UUID UNIQUE DEFAULT gen_random_uuid(),
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            shared_owner_id INTEGER,
            shared_id INTEGER,
            llm_settings JSONB DEFAULT ''{}''::jsonb,
            instructions TEXT,
            conversation_starters JSONB DEFAULT ''[]''::jsonb,
            welcome_message TEXT DEFAULT '''',
            agent_type VARCHAR NOT NULL DEFAULT ''openai'',
            meta JSONB DEFAULT ''{}''::jsonb,
            pipeline_settings JSONB DEFAULT ''{}''::jsonb,
            CONSTRAINT application_version_shared_origin UNIQUE (shared_owner_id, shared_id),
            CONSTRAINT _application_version_name_uc UNIQUE (application_id, name)
        )', schema_name, schema_name);

    -- Application variables
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.application_variables (
            id SERIAL PRIMARY KEY,
            application_version_id INTEGER NOT NULL REFERENCES %I.application_versions(id) ON DELETE CASCADE,
            name VARCHAR NOT NULL,
            value VARCHAR,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            updated_at TIMESTAMP,
            CONSTRAINT _application_version_variable_name_uc UNIQUE (application_version_id, name)
        )', schema_name, schema_name);

    -- Application version <-> Tag association
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.application_version_tag_association (
            version_id INTEGER REFERENCES %I.application_versions(id) ON DELETE CASCADE,
            tag_id INTEGER REFERENCES %I.tags(id) ON DELETE CASCADE,
            PRIMARY KEY (version_id, tag_id)
        )', schema_name, schema_name, schema_name);

    -- Skills
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.skills (
            id SERIAL PRIMARY KEY,
            name VARCHAR(128) NOT NULL,
            description VARCHAR(2304) NOT NULL,
            owner_id INTEGER NOT NULL,
            author_id INTEGER NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            uuid UUID UNIQUE DEFAULT gen_random_uuid(),
            meta JSONB DEFAULT ''{}''::jsonb
        )', schema_name);

    -- Skill versions
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.skill_versions (
            id SERIAL PRIMARY KEY,
            skill_id INTEGER NOT NULL REFERENCES %I.skills(id) ON DELETE CASCADE,
            name VARCHAR(128) NOT NULL DEFAULT ''base'',
            instructions TEXT NOT NULL,
            author_id INTEGER NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            uuid UUID UNIQUE DEFAULT gen_random_uuid(),
            meta JSONB DEFAULT ''{}''::jsonb,
            CONSTRAINT _skill_version_name_uc UNIQUE (skill_id, name)
        )', schema_name, schema_name);

    -- Skill version <-> Tag association
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.skill_version_tag_association (
            version_id INTEGER REFERENCES %I.skill_versions(id) ON DELETE CASCADE,
            tag_id INTEGER REFERENCES %I.tags(id) ON DELETE CASCADE,
            PRIMARY KEY (version_id, tag_id)
        )', schema_name, schema_name, schema_name);

    -- Entity <-> Skill mapping
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.entity_skill_mapping (
            id SERIAL PRIMARY KEY,
            entity_version_id INTEGER NOT NULL,
            entity_type VARCHAR(50) NOT NULL,
            skill_id INTEGER NOT NULL REFERENCES %I.skills(id) ON DELETE CASCADE,
            skill_version_id INTEGER REFERENCES %I.skill_versions(id),
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            updated_at TIMESTAMP,
            CONSTRAINT _entity_skill_unique UNIQUE (entity_version_id, skill_id, entity_type)
        )', schema_name, schema_name, schema_name);

    -- EliteA Tools (toolkits)
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.elitea_tools (
            id SERIAL PRIMARY KEY,
            name VARCHAR(128) NOT NULL,
            type VARCHAR(64) NOT NULL,
            description TEXT,
            owner_id INTEGER NOT NULL,
            author_id INTEGER NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            uuid UUID UNIQUE DEFAULT gen_random_uuid(),
            meta JSONB DEFAULT ''{}''::jsonb,
            settings JSONB DEFAULT ''{}''::jsonb,
            env_vars JSONB DEFAULT ''{}''::jsonb
        )', schema_name);

    -- Entity <-> Tool mapping
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.entity_tool_mapping (
            id SERIAL PRIMARY KEY,
            entity_version_id INTEGER NOT NULL,
            entity_type VARCHAR(50) NOT NULL,
            tool_id INTEGER NOT NULL REFERENCES %I.elitea_tools(id) ON DELETE CASCADE,
            selected_tools JSONB DEFAULT ''[]''::jsonb,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            updated_at TIMESTAMP,
            CONSTRAINT _entity_tool_unique UNIQUE (entity_version_id, tool_id, entity_type)
        )', schema_name, schema_name);

    -- Chat conversation folders
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.chat_conversation_folders (
            id SERIAL PRIMARY KEY,
            uuid UUID UNIQUE DEFAULT gen_random_uuid(),
            name VARCHAR NOT NULL,
            owner_id INTEGER NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            meta JSONB NOT NULL DEFAULT ''{}''::jsonb,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            updated_at TIMESTAMP
        )', schema_name);

    -- Chat conversations
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.chat_conversations (
            id SERIAL PRIMARY KEY,
            uuid UUID UNIQUE DEFAULT gen_random_uuid(),
            name VARCHAR NOT NULL,
            is_private BOOLEAN NOT NULL DEFAULT true,
            author_id INTEGER NOT NULL,
            meta JSONB NOT NULL DEFAULT ''{}''::jsonb,
            source VARCHAR(64) NOT NULL DEFAULT ''elitea'',
            instructions TEXT,
            attachment_participant_id INTEGER,
            folder_id INTEGER REFERENCES %I.chat_conversation_folders(id),
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            updated_at TIMESTAMP
        )', schema_name, schema_name);

    -- Chat participants
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.chat_participants (
            id SERIAL PRIMARY KEY,
            uuid UUID UNIQUE DEFAULT gen_random_uuid(),
            entity_name VARCHAR NOT NULL,
            entity_meta JSONB NOT NULL DEFAULT ''{}''::jsonb,
            meta JSONB NOT NULL DEFAULT ''{}''::jsonb
        )', schema_name);

    -- Chat participant <-> conversation mapping
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.chat_participant_mapping (
            id SERIAL PRIMARY KEY,
            conversation_id INTEGER REFERENCES %I.chat_conversations(id) ON DELETE CASCADE,
            participant_id INTEGER REFERENCES %I.chat_participants(id) ON DELETE CASCADE,
            entity_settings JSONB NOT NULL DEFAULT ''{}''::jsonb,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            updated_at TIMESTAMP,
            CONSTRAINT _participant_conversation_uc UNIQUE (participant_id, conversation_id)
        )', schema_name, schema_name, schema_name);

    -- Chat message groups
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.chat_message_group (
            id SERIAL PRIMARY KEY,
            uuid UUID UNIQUE DEFAULT gen_random_uuid(),
            author_participant_id INTEGER REFERENCES %I.chat_participants(id),
            conversation_id INTEGER REFERENCES %I.chat_conversations(id) ON DELETE CASCADE,
            sent_to_id INTEGER REFERENCES %I.chat_participants(id),
            reply_to_id INTEGER REFERENCES %I.chat_message_group(id) ON DELETE SET NULL,
            meta JSONB NOT NULL DEFAULT ''{}''::jsonb,
            is_streaming BOOLEAN NOT NULL DEFAULT false,
            task_id VARCHAR(64),
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            updated_at TIMESTAMP
        )', schema_name, schema_name, schema_name, schema_name, schema_name);

    -- Chat message items
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.chat_message_items (
            id SERIAL PRIMARY KEY,
            uuid UUID UNIQUE DEFAULT gen_random_uuid(),
            item_type VARCHAR(50) NOT NULL,
            order_index INTEGER NOT NULL,
            meta JSONB NOT NULL DEFAULT ''{}''::jsonb,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            updated_at TIMESTAMP,
            message_group_id INTEGER REFERENCES %I.chat_message_group(id) ON DELETE CASCADE
        )', schema_name, schema_name);

    -- Selected conversations (per-user pinned)
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.chat_selected_conversations (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            conversation_id INTEGER REFERENCES %I.chat_conversations(id) ON DELETE CASCADE
        )', schema_name, schema_name);

    -- Configuration (integrations/credentials)
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.configuration (
            id SERIAL PRIMARY KEY,
            uuid UUID UNIQUE DEFAULT gen_random_uuid(),
            project_id INTEGER NOT NULL,
            label VARCHAR,
            elitea_title VARCHAR NOT NULL UNIQUE,
            type VARCHAR NOT NULL,
            section VARCHAR NOT NULL,
            data JSONB NOT NULL DEFAULT ''{}''::jsonb,
            meta JSONB NOT NULL DEFAULT ''{}''::jsonb,
            shared BOOLEAN NOT NULL DEFAULT false,
            status_ok BOOLEAN NOT NULL DEFAULT false,
            status_logs TEXT,
            source VARCHAR NOT NULL DEFAULT ''user'',
            author_id INTEGER,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            updated_at TIMESTAMP
        )', schema_name);

    -- Likes
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.social_likes (
            id SERIAL PRIMARY KEY,
            entity_name VARCHAR NOT NULL,
            entity_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT _like_unique UNIQUE (entity_name, entity_id, user_id)
        )', schema_name);

    -- Pins
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.social_pins (
            id SERIAL PRIMARY KEY,
            entity_name VARCHAR NOT NULL,
            entity_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT _pin_unique UNIQUE (entity_name, entity_id, user_id)
        )', schema_name);

    -- Feedbacks
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.social_feedbacks (
            id SERIAL PRIMARY KEY,
            entity_name VARCHAR NOT NULL,
            entity_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            rating INTEGER,
            comment TEXT,
            meta JSONB DEFAULT ''{}''::jsonb,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )', schema_name);

END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- AUTH TABLES (pylon_auth owns these; we create them for standalone dev mode)
-- In production, pylon_auth creates and manages these tables.
-- =============================================================================
CREATE TABLE IF NOT EXISTS auth_core__user (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE,
    name TEXT,
    last_login TIMESTAMP,
    suspended BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_auth_core_user_email ON auth_core__user(email);

CREATE TABLE IF NOT EXISTS auth_core__user_provider (
    user_id INTEGER REFERENCES auth_core__user(id) ON DELETE CASCADE,
    provider_ref TEXT UNIQUE,
    PRIMARY KEY (user_id, provider_ref)
);

CREATE TABLE IF NOT EXISTS auth_core__role (
    id SERIAL PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    mode VARCHAR(64) NOT NULL,
    UNIQUE (name, mode)
);

CREATE TABLE IF NOT EXISTS auth_core__role_permission (
    id SERIAL PRIMARY KEY,
    role_id INTEGER NOT NULL REFERENCES auth_core__role(id) ON DELETE CASCADE,
    permission VARCHAR(64),
    UNIQUE (role_id, permission)
);

CREATE TABLE IF NOT EXISTS auth_core__user_role (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES auth_core__user(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES auth_core__role(id) ON DELETE CASCADE,
    UNIQUE (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS auth_core__scope (
    id SERIAL PRIMARY KEY,
    parent_id INTEGER REFERENCES auth_core__scope(id) ON DELETE SET NULL,
    name TEXT
);

CREATE TABLE IF NOT EXISTS auth_core__user_permission (
    user_id INTEGER REFERENCES auth_core__user(id) ON DELETE CASCADE,
    scope_id INTEGER REFERENCES auth_core__scope(id) ON DELETE CASCADE,
    permission TEXT,
    PRIMARY KEY (user_id, scope_id, permission)
);

CREATE TABLE IF NOT EXISTS auth_core__token (
    id SERIAL PRIMARY KEY,
    uuid VARCHAR(36) UNIQUE,
    expires TIMESTAMP,
    user_id INTEGER REFERENCES auth_core__user(id) ON DELETE CASCADE,
    name TEXT
);

CREATE TABLE IF NOT EXISTS auth_core__project_role (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS auth_core__project_role_permission (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL,
    role_id INTEGER REFERENCES auth_core__project_role(id) ON DELETE CASCADE,
    permission TEXT NOT NULL,
    UNIQUE (project_id, role_id, permission)
);

CREATE TABLE IF NOT EXISTS auth_core__project_user_role (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL REFERENCES auth_core__user(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES auth_core__project_role(id) ON DELETE CASCADE,
    UNIQUE (project_id, user_id, role_id)
);

-- =============================================================================
-- SEED DATA
-- =============================================================================

-- Default auth scope
INSERT INTO auth_core__scope (id, name, parent_id)
VALUES (1, 'Global', NULL)
ON CONFLICT (id) DO NOTHING;

-- Default roles
INSERT INTO auth_core__role (id, name, mode) VALUES
    (1, 'admin', 'default'),
    (2, 'editor', 'default'),
    (3, 'viewer', 'default')
ON CONFLICT (id) DO NOTHING;

-- Default dev user
INSERT INTO auth_core__user (id, email, name)
VALUES (1, 'dev@elitea.ai', 'Dev User')
ON CONFLICT (id) DO NOTHING;

-- Give dev user admin role
INSERT INTO auth_core__user_role (user_id, role_id)
VALUES (1, 1)
ON CONFLICT (user_id, role_id) DO NOTHING;

-- Default project
INSERT INTO centry.project (id, name, owner_id, create_success)
VALUES (1, 'Default Project', 1, true)
ON CONFLICT (id) DO NOTHING;

-- Default project group
INSERT INTO centry.project_group (id, name)
VALUES (1, 'Default')
ON CONFLICT (id) DO NOTHING;

INSERT INTO centry.project_group_association (project_id, group_id)
VALUES (1, 1)
ON CONFLICT DO NOTHING;

-- Default social user (dev user)
INSERT INTO centry.social_users (id, user_id, title, description)
VALUES (1, 1, 'Dev User', '')
ON CONFLICT (id) DO NOTHING;

-- Create tenant schema for default project
SELECT create_tenant_schema('p_1');

-- Reset sequences
SELECT setval('centry.project_id_seq', (SELECT COALESCE(MAX(id), 0) FROM centry.project) + 1, false);
SELECT setval('centry.project_group_id_seq', (SELECT COALESCE(MAX(id), 0) FROM centry.project_group) + 1, false);
SELECT setval('centry.social_users_id_seq', (SELECT COALESCE(MAX(id), 0) FROM centry.social_users) + 1, false);

COMMIT;

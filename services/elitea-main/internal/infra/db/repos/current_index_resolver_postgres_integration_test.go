package repos

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
)

// TestPostgresCurrentIndexResolverParity crosses the fixed Go resolver, SQLC,
// the tenant search_path executor and real PostgreSQL current-table shapes. It
// uses reference-only synthetic credentials; no secret is redeemed here.
func TestPostgresCurrentIndexResolverParity(t *testing.T) {
	pool := newPostgresIntegrationPool(t)
	applyPostgresIntegrationMigrations(t, pool)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	if _, err := pool.Exec(ctx, `
INSERT INTO centry.project (id) VALUES (2);

CREATE TABLE p_1.elitea_tools (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP,
    type VARCHAR NOT NULL,
    name VARCHAR(128),
    description VARCHAR(1024),
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    author_id INTEGER NOT NULL DEFAULT 0,
    shared_owner_id INTEGER,
    shared_id INTEGER,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE SCHEMA p_2;
CREATE TABLE p_2.configuration (LIKE p_1.configuration INCLUDING ALL);
CREATE TABLE p_2.elitea_tools (LIKE p_1.elitea_tools INCLUDING ALL);

INSERT INTO p_1.elitea_tools (id, type, name, settings, author_id, meta)
VALUES (41, 'confluence', 'Public collision', '{}'::jsonb, 1, '{}'::jsonb);

INSERT INTO p_2.elitea_tools (id, type, name, settings, author_id, meta)
VALUES (
    41,
    'github',
    'Git Hub.One /',
    '{
      "selected_tools":["search_index","index_data"],
      "repository":"EliteaAI/example",
      "embedding_model":"embedding-small",
      "github_configuration":{"elitea_title":"github-source","private":false},
      "pgvector_configuration":{"elitea_title":"pgvector-public","private":false}
    }'::jsonb,
    7,
    '{}'::jsonb
);

INSERT INTO p_2.configuration (
    id, uuid, project_id, label, elitea_title, type, section, data, meta,
    shared, status_ok, status_logs, source, author_id
) VALUES
(
    20, '00000000-0000-0000-0000-000000000020', 2, 'GitHub source',
    'github-source', 'github', 'credentials',
    '{"base_url":"https://api.github.test","access_token":"{{secret.GITHUB_TOKEN}}"}'::jsonb,
    '{}'::jsonb, false, false, NULL, 'user', 7
),
(
    21, '00000000-0000-0000-0000-000000000021', 2, 'LLM',
    'llm-gpt-test', 'llm_model', 'llm',
    '{
      "name":"gpt-test",
      "max_output_tokens":4096,
      "supports_reasoning":false,
      "openai_compatible":true
    }'::jsonb,
    '{}'::jsonb, false, true, NULL, 'user', 7
);

INSERT INTO p_1.configuration (
    id, uuid, project_id, label, elitea_title, type, section, data, meta,
    shared, status_ok, status_logs, source, author_id
) VALUES
(
    2, '00000000-0000-0000-0000-000000000002', 1, 'Public GitHub collision',
    'github-source', 'github', 'credentials',
    '{"access_token":"{{secret.PUBLIC_GITHUB_TOKEN}}"}'::jsonb,
    '{}'::jsonb, true, false, NULL, 'user', 1
),
(
    3, '00000000-0000-0000-0000-000000000003', 1, 'Public PGVector',
    'pgvector-public', 'pgvector', 'vectorstorage',
    '{"connection_string":"{{secret.PGVECTOR_DSN}}"}'::jsonb,
    '{}'::jsonb, true, false, NULL, 'user', 1
),
(
    4, '00000000-0000-0000-0000-000000000004', 1, 'Public embedding',
    'embedding-small', 'embedding_model', 'embedding',
    '{"name":"embedding-small"}'::jsonb,
    '{}'::jsonb, true, true, NULL, 'user', 1
);`); err != nil {
		t.Fatalf("seed current index resolver schemas: %v", err)
	}

	repository, err := NewCurrentIndexResolverRepository(pool)
	if err != nil {
		t.Fatal(err)
	}
	resolver, err := indexingapp.NewFixedGitHubResolver(repository, 1)
	if err != nil {
		t.Fatal(err)
	}
	model := "gpt-test"
	inputs, err := resolver.Resolve(ctx, indexingapp.StartRequest{
		ProjectID:            2,
		ActorUserID:          7,
		ToolkitID:            41,
		ToolParameters:       json.RawMessage(`{"index_name":"docs","clean_index":false}`),
		RequestedLLMModel:    &model,
		RequestedLLMSettings: json.RawMessage(`{"max_tokens":-1,"model_name":"gpt-test","model_project_id":2,"openai_compatible":false,"temperature":0.6}`),
		StreamID:             "postgres-conversation",
		MessageID:            "postgres-message",
	})
	if err != nil {
		t.Fatal(err)
	}

	encoded := string(inputs.ToolkitConfiguration)
	for _, expected := range []string{
		`"type":"github"`,
		`"toolkit_name":"GitHub_One"`,
		`"configuration_project_id":2`,
		`"configuration_project_id":1`,
		`"configuration_type":"github"`,
		`"configuration_type":"pgvector"`,
		`{{secret.GITHUB_TOKEN}}`,
		`{{secret.PGVECTOR_DSN}}`,
	} {
		if !strings.Contains(encoded, expected) {
			t.Fatalf("resolved toolkit is missing %q: %s", expected, encoded)
		}
	}
	if strings.Contains(encoded, "PUBLIC_GITHUB_TOKEN") {
		t.Fatalf("public collision replaced the same-project GitHub configuration: %s", encoded)
	}
	if got, want := string(inputs.LLMConfiguration), `{"max_tokens":-1,"model_name":"gpt-test","model_project_id":2,"openai_compatible":true,"temperature":0.6}`; got != want {
		t.Fatalf("LLM configuration=%s, want %s", got, want)
	}

	publicCollision, err := repository.LoadIndexToolkit(ctx, 1, 41)
	if err != nil {
		t.Fatal(err)
	}
	if publicCollision.Type != "confluence" {
		t.Fatalf("tenant search_path leaked project-2 toolkit into project 1: %+v", publicCollision)
	}
}

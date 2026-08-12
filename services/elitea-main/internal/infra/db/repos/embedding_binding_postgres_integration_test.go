package repos

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/litellm"
)

type embeddingIntegrationMasterKey struct{}

func (embeddingIntegrationMasterKey) MasterKey(context.Context) (string, error) {
	return "integration-master-key", nil
}

func TestCurrentEmbeddingBindingResolvesFromTenantPostgresAndLiteLLM(t *testing.T) {
	pool := newPostgresIntegrationPool(t)
	applyPostgresIntegrationMigrations(t, pool)
	configurations, err := NewCurrentConfigurationsRepository(pool)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if _, err := pool.Exec(ctx, `
INSERT INTO centry.project (id, create_success, suspended)
VALUES (2, TRUE, FALSE);
CREATE SCHEMA p_2;
CREATE TABLE p_2.configuration (LIKE p_1.configuration INCLUDING ALL);
INSERT INTO p_1.configuration (
    id, uuid, project_id, label, elitea_title, type, section, data, meta,
    shared, status_ok, source
) VALUES (
    3, '00000000-0000-0000-0000-000000000107', 1, 'Embedding', 'embedding_current',
    'embedding_model', 'embedding',
    '{"name":"text-embedding-current","ai_credentials":{"elitea_title":"credential-current","private":true}}'::jsonb,
    '{}'::jsonb, true, true, 'user'
), (
    4, '00000000-0000-0000-0000-000000000108', 1, 'Private embedding', 'embedding_private',
    'embedding_model', 'embedding',
    '{"name":"private-embedding","ai_credentials":{"elitea_title":"credential-private","private":true}}'::jsonb,
    '{}'::jsonb, false, true, 'user'
)`); err != nil {
		t.Fatal(err)
	}

	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer integration-master-key" {
			t.Errorf("missing LiteLLM administration identity")
		}
		writer.Header().Set("Content-Type", "application/json")
		switch calls.Add(1) {
		case 1:
			if request.URL.Path != "/model_group/info" ||
				request.URL.Query().Get("model_group") != "2_text-embedding-current" {
				t.Errorf("group request=%s", request.URL.String())
			}
			_, _ = io.WriteString(writer, `{"data":[]}`)
		case 2:
			if request.URL.Path != "/model_group/info" ||
				request.URL.Query().Get("model_group") != "1_text-embedding-current" {
				t.Errorf("group request=%s", request.URL.String())
			}
			_, _ = io.WriteString(writer, `{"data":[{"model_group":"1_text-embedding-current","providers":["openai"]}]}`)
		case 3, 4:
			_, _ = io.WriteString(writer, `{"data":[]}`)
		default:
			t.Errorf("unexpected LiteLLM request %s", request.URL.String())
			writer.WriteHeader(http.StatusInternalServerError)
		}
	}))
	defer server.Close()
	client, err := litellm.NewClient(
		litellm.ClientConfig{BaseURL: server.URL},
		embeddingIntegrationMasterKey{},
		server.Client(),
	)
	if err != nil {
		t.Fatal(err)
	}
	resolver, err := indexingapp.NewCurrentEmbeddingBindingResolver(
		configurations,
		client,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}

	binding, err := resolver.Resolve(ctx, 2, "text-embedding-current", nil)
	if err != nil {
		t.Fatal(err)
	}
	if binding.ModelName != "text-embedding-current" ||
		binding.ResolvedModelGroup != "1_text-embedding-current" ||
		binding.Route != "public" ||
		binding.ConfigurationProjectID != 1 ||
		binding.ConfigurationUUID != "00000000-0000-0000-0000-000000000107" ||
		binding.ConfigurationDigest.IsZero() {
		t.Fatalf("binding=%#v", binding)
	}
	if calls.Load() != 2 {
		t.Fatalf("LiteLLM calls=%d", calls.Load())
	}
	preferredPublicProject := int32(1)
	if _, err := resolver.Resolve(ctx, 2, "private-embedding", &preferredPublicProject); !errors.Is(
		err,
		indexingapp.ErrCurrentEmbeddingBindingUnavailable,
	) {
		t.Fatalf("private public-project binding escaped tenant scope: %v", err)
	}
	if calls.Load() != 4 {
		t.Fatalf("unexpected LiteLLM calls=%d", calls.Load())
	}
}

func TestPostgresServiceBackedCurrentModelCatalogBoundsBeforeJSONProjection(t *testing.T) {
	pool := newPostgresIntegrationPool(t)
	applyPostgresIntegrationMigrations(t, pool)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if _, err := pool.Exec(ctx, `
INSERT INTO centry.project (id, create_success, suspended)
VALUES (2, TRUE, FALSE);
CREATE SCHEMA p_2;
CREATE TABLE p_2.configuration (LIKE p_1.configuration INCLUDING ALL);
INSERT INTO p_2.configuration (
    uuid, project_id, label, elitea_title, type, section, data, meta,
    shared, status_ok, source
)
SELECT gen_random_uuid(),
       2,
       'Embedding ' || value,
       'embedding_' || value,
       'embedding_model',
       'embedding',
       jsonb_build_object(
           'name', 'embedding-' || value,
           'padding', repeat('x', 220 * 1024)
       ),
       '{}'::jsonb,
       false,
       true,
       'user'
FROM generate_series(1, 40) AS value`); err != nil {
		t.Fatal(err)
	}
	repository, err := NewCurrentModelsRepository(pool)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repository.List(
		ctx,
		2,
		configurationapp.CurrentModelSectionEmbedding,
		false,
	); !errors.Is(err, errCurrentModelCatalogTooLarge) {
		t.Fatalf("oversized projected catalog error=%v", err)
	}

	if _, err := pool.Exec(ctx, `
TRUNCATE p_2.configuration RESTART IDENTITY;
INSERT INTO p_2.configuration (
    uuid, project_id, label, elitea_title, type, section, data, meta,
    shared, status_ok, source
)
SELECT gen_random_uuid(),
       2,
       'Embedding ' || value,
       'embedding_' || value,
       'embedding_model',
       'embedding',
       jsonb_build_object('name', 'embedding-' || value),
       '{}'::jsonb,
       false,
       true,
       'user'
FROM generate_series(1, 10001) AS value`); err != nil {
		t.Fatal(err)
	}
	if _, err := repository.List(
		ctx,
		2,
		configurationapp.CurrentModelSectionEmbedding,
		false,
	); !errors.Is(err, errCurrentModelCatalogTooLarge) {
		t.Fatalf("oversized row-count catalog error=%v", err)
	}

	if _, err := pool.Exec(ctx, `
TRUNCATE p_2.configuration RESTART IDENTITY;
INSERT INTO p_2.configuration (
    uuid, project_id, label, elitea_title, type, section, data, meta,
    shared, status_ok, source
) VALUES (
    gen_random_uuid(),
    2,
    'Large but admitted embedding',
    'large_but_admitted_embedding',
    'embedding_model',
    'embedding',
    jsonb_build_object(
        'name', 'large-but-admitted',
        'padding', repeat('x', 300 * 1024)
    ),
    '{}'::jsonb,
    false,
    true,
    'user'
)`); err != nil {
		t.Fatal(err)
	}
	items, err := repository.List(
		ctx,
		2,
		configurationapp.CurrentModelSectionEmbedding,
		false,
	)
	if err != nil || len(items) != 1 || items[0].Name != "large-but-admitted" {
		t.Fatalf("parity-preserved large model item=%#v err=%v", items, err)
	}
}

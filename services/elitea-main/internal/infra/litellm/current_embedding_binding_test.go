package litellm

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync/atomic"
	"testing"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
)

func TestCurrentEmbeddingRuntimeGroupProjectsOnlyCurrentStableNonSecretFields(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch calls.Add(1) {
		case 1:
			if request.URL.Path != "/model_group/info" ||
				request.URL.Query().Get("model_group") != "7_text-embedding-3-small" {
				t.Errorf("group request=%s", request.URL.String())
			}
			_, _ = io.WriteString(writer, `{"data":[{"model_group":"7_text-embedding-3-small","providers":["openai"]}]}`)
		case 2:
			if request.URL.Path != "/model/info" {
				t.Errorf("model request=%s", request.URL.String())
			}
			_, _ = io.WriteString(writer, `{"data":[
				{"model_name":"7_text-embedding-3-small",
				 "litellm_params":{"custom_llm_provider":"openai","model":"text-embedding-3-small","api_key":"must-not-escape","dimensions":1536},
				 "model_info":{"id":"deployment-id-is-not-a-version","centry_configuration_uuid":"00000000-0000-0000-0000-000000000107"}},
				{"model_name":"8_unrelated",
				 "litellm_params":{"custom_llm_provider":"azure","api_key":"unrelated-secret"},
				 "model_info":{"centry_configuration_uuid":"00000000-0000-0000-0000-000000000108"}}
			]}`)
		default:
			t.Errorf("unexpected request %s", request.URL.String())
			writer.WriteHeader(http.StatusInternalServerError)
		}
	}))
	defer server.Close()

	client := newTestClient(
		t,
		server.URL,
		&testMasterKeyProvider{key: "master-key"},
		server.Client(),
		ClientConfig{},
	)
	group, found, err := client.GetCurrentEmbeddingRuntimeGroup(
		context.Background(),
		"7_text-embedding-3-small",
	)
	if err != nil || !found {
		t.Fatalf("group=%#v found=%t err=%v", group, found, err)
	}
	want := indexingapp.CurrentEmbeddingRuntimeGroup{
		Name:      "7_text-embedding-3-small",
		Providers: []string{"openai"},
		Deployments: []indexingapp.CurrentEmbeddingRuntimeDeployment{{
			ConfigurationUUID: "00000000-0000-0000-0000-000000000107",
			Provider:          "openai",
		}},
	}
	if !reflect.DeepEqual(group, want) {
		t.Fatalf("group=%#v want=%#v", group, want)
	}
	if calls.Load() != 2 {
		t.Fatalf("calls=%d", calls.Load())
	}
}

func TestCurrentEmbeddingRuntimeGroupRejectsMalformedManagedDeployment(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		if calls.Add(1) == 1 {
			_, _ = io.WriteString(writer, `{"data":[{"model_group":"7_embedding","providers":["openai"]}]}`)
			return
		}
		_, _ = io.WriteString(writer, `{"data":[{"model_name":"7_embedding","litellm_params":{"api_key":"secret"},"model_info":{"centry_configuration_uuid":"00000000-0000-0000-0000-000000000107"}}]}`)
	}))
	defer server.Close()
	client := newTestClient(t, server.URL, &testMasterKeyProvider{key: "master-key"}, server.Client(), ClientConfig{})

	if _, _, err := client.GetCurrentEmbeddingRuntimeGroup(
		context.Background(),
		"7_embedding",
	); err != ErrInvalidResponse {
		t.Fatalf("error=%v", err)
	}
}

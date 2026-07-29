package litellm

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type testMasterKeyProvider struct {
	key   string
	err   error
	calls atomic.Int32
}

func (p *testMasterKeyProvider) MasterKey(ctx context.Context) (string, error) {
	p.calls.Add(1)
	if err := ctx.Err(); err != nil {
		return "", err
	}
	return p.key, p.err
}

func TestClientUsesCurrentLiteLLMAdminContracts(t *testing.T) {
	provider := &testMasterKeyProvider{key: "master-key"}
	var calls atomic.Int32
	expected := []struct {
		method   string
		path     string
		query    string
		body     string
		response string
	}{
		{
			method: http.MethodPost, path: "/credentials",
			body:     `{"credential_name":"7_credential","credential_values":{"api_key":"provider-key"},"credential_info":{"custom_llm_provider":"OpenAI"}}`,
			response: `{"success":true,"message":"Credential created successfully"}`,
		},
		{
			method: http.MethodGet, path: "/credentials",
			response: `{"success":true,"credentials":[{"credential_name":"7_credential","credential_values":{"api_key":"****"},"credential_info":{"custom_llm_provider":"OpenAI"}}]}`,
		},
		{
			method: http.MethodDelete, path: "/credentials/7_credential",
			response: `{"success":true,"message":"Credential deleted successfully"}`,
		},
		{
			method: http.MethodPost, path: "/model/new",
			body:     `{"model_name":"7_embedding","litellm_params":{"model":"text-embedding-3-small"},"model_info":{"centry_configuration_uuid":"model-uuid"}}`,
			response: `{"model_id":"deployment-id"}`,
		},
		{
			method: http.MethodGet, path: "/model/info",
			response: `{"data":[{"model_name":"7_embedding","litellm_params":{"model":"text-embedding-3-small"},"model_info":{"id":"deployment-id","centry_configuration_uuid":"model-uuid"}}]}`,
		},
		{
			method: http.MethodPost, path: "/model/delete",
			body:     `{"id":"deployment-id"}`,
			response: `{"deleted_model":"deployment-id"}`,
		},
		{
			method: http.MethodGet, path: "/model_group/info", query: "model_group=7_embedding",
			response: `{"data":[{"model_group":"7_embedding","providers":["openai"],"supports_vision":false}]}`,
		},
	}

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		call := int(calls.Add(1)) - 1
		if call < 0 || call >= len(expected) {
			t.Errorf("unexpected call %d: %s %s", call, request.Method, request.URL.String())
			writer.WriteHeader(http.StatusInternalServerError)
			return
		}
		want := expected[call]
		if request.Method != want.method || request.URL.Path != want.path || request.URL.RawQuery != want.query {
			t.Errorf("call %d = %s %s?%s, want %s %s?%s", call, request.Method, request.URL.Path, request.URL.RawQuery, want.method, want.path, want.query)
		}
		if got := request.Header.Get("Authorization"); got != "Bearer master-key" {
			t.Errorf("call %d Authorization = %q", call, got)
		}
		if got := request.Header.Get("Accept"); got != "application/json" {
			t.Errorf("call %d Accept = %q", call, got)
		}
		if got := request.Header.Get("Content-Type"); got != "application/json" {
			t.Errorf("call %d Content-Type = %q", call, got)
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Errorf("call %d read body: %v", call, err)
		}
		if want.body == "" {
			if len(body) != 0 {
				t.Errorf("call %d body = %q, want empty", call, body)
			}
		} else {
			assertClientJSONEqual(t, body, []byte(want.body))
		}
		writer.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = io.WriteString(writer, want.response)
	}))
	defer server.Close()

	client := newTestClient(t, server.URL, provider, server.Client(), ClientConfig{})
	ctx := context.Background()
	credential := CredentialProjection{
		CredentialName:   "7_credential",
		CredentialValues: map[string]any{"api_key": "provider-key"},
		CredentialInfo:   map[string]any{"custom_llm_provider": "OpenAI"},
	}
	if err := client.CreateCredential(ctx, credential); err != nil {
		t.Fatalf("create credential: %v", err)
	}
	credentials, err := client.ListCredentials(ctx)
	if err != nil || len(credentials) != 1 || credentials[0].CredentialName != "7_credential" || credentials[0].CredentialValues["api_key"] != "****" {
		t.Fatalf("list credentials = %#v, %v", credentials, err)
	}
	if err := client.DeleteCredential(ctx, "7_credential"); err != nil {
		t.Fatalf("delete credential: %v", err)
	}

	model := ModelProjection{
		ModelName:     "7_embedding",
		LiteLLMParams: map[string]any{"model": "text-embedding-3-small"},
		ModelInfo:     map[string]any{"centry_configuration_uuid": "model-uuid"},
	}
	if err := client.CreateModel(ctx, model); err != nil {
		t.Fatalf("create model: %v", err)
	}
	models, err := client.ListModels(ctx)
	if err != nil || len(models) != 1 || models[0].ModelName != "7_embedding" || models[0].ModelInfo["id"] != "deployment-id" {
		t.Fatalf("list models = %#v, %v", models, err)
	}
	if err := client.DeleteModel(ctx, "deployment-id"); err != nil {
		t.Fatalf("delete model: %v", err)
	}
	groups, err := client.LookupModelGroup(ctx, "7_embedding")
	if err != nil || len(groups) != 1 || groups[0].ModelGroup != "7_embedding" || !reflect.DeepEqual(groups[0].Providers, []string{"openai"}) {
		t.Fatalf("lookup model group = %#v, %v", groups, err)
	}
	if got := int(calls.Load()); got != len(expected) {
		t.Fatalf("calls = %d, want %d", got, len(expected))
	}
	if got := int(provider.calls.Load()); got != len(expected) {
		t.Fatalf("master-key resolutions = %d, want one per call", got)
	}
}

func TestClientSanitizesDependencyAndSecretProviderErrors(t *testing.T) {
	t.Run("non-2xx response", func(t *testing.T) {
		provider := &testMasterKeyProvider{key: "master-secret"}
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			writer.Header().Set("Content-Type", "application/json")
			writer.WriteHeader(http.StatusBadGateway)
			_, _ = io.WriteString(writer, `{"detail":"master-secret provider-secret private-body"}`)
		}))
		defer server.Close()
		client := newTestClient(t, server.URL, provider, server.Client(), ClientConfig{})

		err := client.CreateCredential(context.Background(), CredentialProjection{
			CredentialName: "7_credential", CredentialValues: map[string]any{"api_key": "provider-secret"}, CredentialInfo: map[string]any{},
		})
		if !errors.Is(err, ErrUnexpectedStatus) || !strings.Contains(err.Error(), "status 502") {
			t.Fatalf("error = %v", err)
		}
		for _, secret := range []string{"master-secret", "provider-secret", "private-body"} {
			if strings.Contains(err.Error(), secret) {
				t.Fatalf("error leaked %q: %v", secret, err)
			}
		}
	})

	t.Run("secret provider", func(t *testing.T) {
		provider := &testMasterKeyProvider{err: errors.New("master-secret from vault")}
		client := newTestClient(t, "http://litellm.invalid", provider, http.DefaultClient, ClientConfig{})
		_, err := client.ListModels(context.Background())
		if !errors.Is(err, ErrMasterKeyUnavailable) || strings.Contains(err.Error(), "master-secret") {
			t.Fatalf("error = %v", err)
		}
	})
}

func TestClientBoundsRequestAndResponseBodies(t *testing.T) {
	t.Run("request", func(t *testing.T) {
		provider := &testMasterKeyProvider{key: "master-key"}
		var calls atomic.Int32
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			calls.Add(1)
			writer.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(writer, `{}`)
		}))
		defer server.Close()
		client := newTestClient(t, server.URL, provider, server.Client(), ClientConfig{MaxRequestBytes: minAdminRequestBytes})

		err := client.CreateCredential(context.Background(), CredentialProjection{
			CredentialName:   "7_credential",
			CredentialValues: map[string]any{"api_key": strings.Repeat("x", int(minAdminRequestBytes))},
			CredentialInfo:   map[string]any{},
		})
		if !errors.Is(err, ErrRequestTooLarge) {
			t.Fatalf("error = %v", err)
		}
		if calls.Load() != 0 || provider.calls.Load() != 0 {
			t.Fatalf("oversized request reached dependency: HTTP=%d key=%d", calls.Load(), provider.calls.Load())
		}
	})

	t.Run("response", func(t *testing.T) {
		provider := &testMasterKeyProvider{key: "master-key"}
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			writer.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(writer, strings.Repeat("x", int(minAdminResponseBytes)+1))
		}))
		defer server.Close()
		client := newTestClient(t, server.URL, provider, server.Client(), ClientConfig{MaxResponseBytes: minAdminResponseBytes})

		_, err := client.ListCredentials(context.Background())
		if !errors.Is(err, ErrResponseTooLarge) {
			t.Fatalf("error = %v", err)
		}
	})
}

func TestClientPreservesInFlightCancellation(t *testing.T) {
	provider := &testMasterKeyProvider{key: "master-key"}
	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		close(started)
		<-request.Context().Done()
	}))
	defer server.Close()
	client := newTestClient(t, server.URL, provider, server.Client(), ClientConfig{})

	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, err := client.ListCredentials(ctx)
		result <- err
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("request did not start")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("canceled request did not return")
	}
}

func TestClientRejectsCrossOriginRedirectWithoutForwardingAuthorization(t *testing.T) {
	provider := &testMasterKeyProvider{key: "master-secret"}
	var targetCalls atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		targetCalls.Add(1)
		writer.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(writer, `{"credentials":[]}`)
	}))
	defer target.Close()

	source := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Location", target.URL+"/credentials")
		writer.WriteHeader(http.StatusTemporaryRedirect)
	}))
	defer source.Close()
	client := newTestClient(t, source.URL, provider, source.Client(), ClientConfig{})

	_, err := client.ListCredentials(context.Background())
	if !errors.Is(err, ErrRedirectRejected) {
		t.Fatalf("error = %v", err)
	}
	if targetCalls.Load() != 0 {
		t.Fatal("cross-origin redirect reached target")
	}
	if strings.Contains(err.Error(), target.URL) || strings.Contains(err.Error(), "master-secret") {
		t.Fatalf("redirect error leaked target or key: %v", err)
	}
}

func TestNewClientRejectsUnboundedOrNonOriginConfiguration(t *testing.T) {
	provider := &testMasterKeyProvider{key: "master-key"}
	tests := []ClientConfig{
		{},
		{BaseURL: "ftp://litellm.example"},
		{BaseURL: "https://user:pass@litellm.example"},
		{BaseURL: "https://litellm.example/admin"},
		{BaseURL: "https://litellm.example?key=value"},
		{BaseURL: "https://litellm.example", RequestTimeout: minAdminRequestTimeout - time.Nanosecond},
		{BaseURL: "https://litellm.example", RequestTimeout: maxAdminRequestTimeout + time.Nanosecond},
		{BaseURL: "https://litellm.example", MaxRequestBytes: minAdminRequestBytes - 1},
		{BaseURL: "https://litellm.example", MaxResponseBytes: maxAdminResponseBytes + 1},
	}
	for _, config := range tests {
		if client, err := NewClient(config, provider, http.DefaultClient); client != nil || !errors.Is(err, ErrInvalidClientConfiguration) {
			t.Fatalf("config %#v = %#v, %v", config, client, err)
		}
	}
	if client, err := NewClient(ClientConfig{BaseURL: "https://litellm.example"}, nil, http.DefaultClient); client != nil || !errors.Is(err, ErrInvalidClientConfiguration) {
		t.Fatalf("nil provider = %#v, %v", client, err)
	}
	if client, err := NewClient(ClientConfig{BaseURL: "https://litellm.example"}, provider, nil); client != nil || !errors.Is(err, ErrInvalidClientConfiguration) {
		t.Fatalf("nil HTTP client = %#v, %v", client, err)
	}
}

func newTestClient(
	t *testing.T,
	baseURL string,
	provider MasterKeyProvider,
	httpClient *http.Client,
	config ClientConfig,
) *Client {
	t.Helper()
	config.BaseURL = baseURL
	client, err := NewClient(config, provider, httpClient)
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	return client
}

func assertClientJSONEqual(t *testing.T, got, want []byte) {
	t.Helper()
	var gotValue any
	if err := json.Unmarshal(got, &gotValue); err != nil {
		t.Errorf("invalid request JSON %q: %v", got, err)
		return
	}
	var wantValue any
	if err := json.Unmarshal(want, &wantValue); err != nil {
		t.Fatalf("invalid expected JSON %q: %v", want, err)
	}
	if !reflect.DeepEqual(gotValue, wantValue) {
		t.Errorf("request JSON = %s, want %s", got, want)
	}
}

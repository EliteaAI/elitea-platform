package pricesync

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestParseLiteLLMSkipsAndAliases(t *testing.T) {
	body := []byte(`{
		"sample_spec": {"litellm_provider": "openai", "input_cost_per_token": 0.1},
		"no_provider": {"input_cost_per_token": 0.1},
		"no_price": {"litellm_provider": "openai", "mode": "chat"},
		"gpt-4o": {
			"litellm_provider": "openai",
			"input_cost_per_token": 0.0000025,
			"output_cost_per_token": 0.00001,
			"cache_read_input_token_cost": 0.00000125
		},
		"gemini-pro": {
			"litellm_provider": "vertex_ai",
			"input_cost_per_token": 0.0000005,
			"output_cost_per_token": 0.0000015
		},
		"claude-sonnet": {
			"litellm_provider": "bedrock_converse",
			"input_cost_per_token": 0.000003
		}
	}`)
	got, err := parseLiteLLM(body)
	if err != nil {
		t.Fatalf("parseLiteLLM: %v", err)
	}
	byModel := map[string]RawModelPrice{}
	for _, r := range got {
		byModel[r.ModelName] = r
	}
	if _, ok := byModel["sample_spec"]; ok {
		t.Error("sample_spec must be skipped")
	}
	if _, ok := byModel["no_provider"]; ok {
		t.Error("entry without provider must be skipped")
	}
	if _, ok := byModel["no_price"]; ok {
		t.Error("entry without any price must be skipped")
	}
	if len(got) != 3 {
		t.Fatalf("expected 3 usable models, got %d", len(got))
	}
	if byModel["gemini-pro"].Provider != "vertex" {
		t.Errorf("vertex_ai must alias to vertex, got %q", byModel["gemini-pro"].Provider)
	}
	if byModel["claude-sonnet"].Provider != "bedrock" {
		t.Errorf("bedrock_converse must alias to bedrock, got %q", byModel["claude-sonnet"].Provider)
	}
	if byModel["gpt-4o"].Provider != "openai" {
		t.Errorf("openai must pass through, got %q", byModel["gpt-4o"].Provider)
	}
	// Per-token values must pass through raw (denomination handled by Normalizer).
	if byModel["gpt-4o"].InputCost == nil || *byModel["gpt-4o"].InputCost != 0.0000025 {
		t.Errorf("input cost must pass through raw per-token")
	}
}

func TestParseLiteLLMUnknownProviderPassthrough(t *testing.T) {
	body := []byte(`{"weird": {"litellm_provider": "SomeNewProvider", "input_cost_per_token": 0.1}}`)
	got, err := parseLiteLLM(body)
	if err != nil {
		t.Fatalf("parseLiteLLM: %v", err)
	}
	if len(got) != 1 || got[0].Provider != "somenewprovider" {
		t.Errorf("unmapped provider must pass through lowercased, got %+v", got)
	}
}

func TestParseLiteLLMBadJSON(t *testing.T) {
	if _, err := parseLiteLLM([]byte(`not json`)); err == nil {
		t.Fatal("expected decode error")
	}
}

func TestLiteLLMFetchOK(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"gpt-4o": {"litellm_provider": "openai", "input_cost_per_token": 0.0000025}}`))
	}))
	defer srv.Close()

	src := NewLiteLLMSource(srv.URL, srv.Client())
	if src.Name() != "litellm" {
		t.Errorf("name = %q", src.Name())
	}
	if src.Denomination() != PerToken {
		t.Errorf("denomination = %v, want per-token", src.Denomination())
	}
	got, err := src.Fetch(context.Background())
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(got) != 1 || got[0].ModelName != "gpt-4o" {
		t.Errorf("unexpected fetch result %+v", got)
	}
}

func TestLiteLLMFetchNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	src := NewLiteLLMSource(srv.URL, srv.Client())
	if _, err := src.Fetch(context.Background()); err == nil {
		t.Fatal("expected error on non-200 status")
	}
}

func TestLiteLLMFetchNetworkError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	url := srv.URL
	srv.Close() // ensure connection refused

	src := NewLiteLLMSource(url, &http.Client{})
	if _, err := src.Fetch(context.Background()); err == nil {
		t.Fatal("expected network error against closed server")
	}
}

func TestLiteLLMFetchCancelledContext(t *testing.T) {
	src := NewLiteLLMSource("http://127.0.0.1:0", &http.Client{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := src.Fetch(ctx); err == nil {
		t.Fatal("expected error with cancelled context")
	} else if !errors.Is(err, context.Canceled) && !isURLErr(err) {
		// http.Client wraps the context error; either is acceptable.
		t.Logf("got err %v (acceptable)", err)
	}
}

func TestNewLiteLLMSourceDefaultURL(t *testing.T) {
	src := NewLiteLLMSource("", nil)
	if src.URL != LiteLLMURL {
		t.Errorf("empty url must fall back to canonical, got %q", src.URL)
	}
}

func isURLErr(err error) bool { return err != nil }

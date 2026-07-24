package account

import (
	"context"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
)

func TestValidateProjectID(t *testing.T) {
	valid := []string{"1", "42", "1000000"}
	for _, id := range valid {
		if err := validateProjectID(id); err != nil {
			t.Errorf("validateProjectID(%q) = %v, want nil", id, err)
		}
	}
	invalid := []string{"", "0abc", "1; DROP TABLE", "p_1", "-1", "1.0", " 1"}
	for _, id := range invalid {
		if err := validateProjectID(id); err == nil {
			t.Errorf("validateProjectID(%q) = nil, want error", id)
		}
	}
}

func TestCredentialData_KeyRef(t *testing.T) {
	cases := []struct {
		name string
		d    credentialData
		want string
	}{
		{"prefers api_key", credentialData{APIKey: "k", APIToken: "t"}, "k"},
		{"falls back to api_token", credentialData{APIToken: "t"}, "t"},
		{"empty", credentialData{}, ""},
	}
	for _, tc := range cases {
		if got := tc.d.credentialKeyRef(); got != tc.want {
			t.Errorf("%s: credentialKeyRef() = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestLoadCredentials_UnmappedProvider(t *testing.T) {
	a := newTestAccount(t, &fakeDB{}, &fakeVault{})
	creds, err := a.loadCredentials(context.Background(), "1", schemas.Cohere)
	if err != nil {
		t.Fatalf("loadCredentials: %v", err)
	}
	if creds != nil {
		t.Fatalf("expected nil creds for unmapped provider, got %+v", creds)
	}
}

func TestLoadCredentials_InvalidProjectID(t *testing.T) {
	a := newTestAccount(t, &fakeDB{}, &fakeVault{})
	if _, err := a.loadCredentials(context.Background(), "bad", schemas.OpenAI); err == nil {
		t.Fatal("expected error for non-numeric project id")
	}
}

func TestLoadCredentials_DecodesRows(t *testing.T) {
	db := &fakeDB{rows: [][]any{
		{"id-1", "prod", []byte(`{"api_base":"https://api.openai.com/v1","api_key":"sk"}`)},
		{"id-2", "", []byte(``)}, // empty data → zero-value credential, still returned
	}}
	a := newTestAccount(t, db, &fakeVault{})
	creds, err := a.loadCredentials(context.Background(), "5", schemas.OpenAI)
	if err != nil {
		t.Fatalf("loadCredentials: %v", err)
	}
	if len(creds) != 2 {
		t.Fatalf("got %d creds, want 2", len(creds))
	}
	if creds[0].configID != "id-1" || creds[0].apiBase != "https://api.openai.com/v1" || creds[0].apiKeyRef != "sk" {
		t.Fatalf("unexpected first credential: %+v", creds[0])
	}
	if creds[1].configID != "id-2" || creds[1].apiKeyRef != "" {
		t.Fatalf("unexpected second credential: %+v", creds[1])
	}
}

func TestProviderConfigTypes_CoverSupportedProviders(t *testing.T) {
	// Every supported provider except those routed without configuration rows
	// should have at least one config type. Bedrock/Vertex/Anthropic/OpenAI/
	// Azure/Ollama all map; assert the whole supported set is covered.
	for _, p := range supportedProviders {
		if len(providerConfigTypes[p]) == 0 {
			t.Errorf("provider %s has no config types mapped", p)
		}
	}
}

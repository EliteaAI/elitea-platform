package configurations

import "testing"

// selfref_test.go — upsert-time circular-routing guard #1 (spec §2.6).
// The evasion cases mirror the gateway account package's test matrix so the
// two guards provably enforce the same boundary.

func origins() []string {
	return buildSelfOrigins("https://dev.elitea.ai/llm/v1,http://elitea-main:8080/llm/v1", "")
}

func TestSelfRef_RejectsExactOrigin(t *testing.T) {
	data := map[string]any{"api_base": "https://dev.elitea.ai/llm/v1"}
	if err := validateNotSelfReferential(data, origins()); err == nil {
		t.Fatal("exact self origin must be rejected")
	}
}

func TestSelfRef_RejectsEvasions(t *testing.T) {
	cases := map[string]string{
		"trailing slash":    "https://dev.elitea.ai/llm/v1/",
		"uppercase host":    "https://DEV.ELITEA.AI/llm/v1",
		"uppercase path":    "https://dev.elitea.ai/LLM/V1",
		"default port":      "https://dev.elitea.ai:443/llm/v1",
		"trailing dot fqdn": "https://dev.elitea.ai./llm/v1",
		"deeper path":       "https://dev.elitea.ai/llm/v1/chat/completions",
		"shorter segment":   "https://dev.elitea.ai/llm",
		"second origin":     "http://elitea-main:8080/llm/v1",
		"second origin @80": "http://elitea-main:8080/llm/v1/",
	}
	for name, apiBase := range cases {
		if err := validateNotSelfReferential(map[string]any{"api_base": apiBase}, origins()); err == nil {
			t.Errorf("%s (%q): must be rejected", name, apiBase)
		}
	}
}

func TestSelfRef_AllowsLegitimateProviders(t *testing.T) {
	cases := map[string]string{
		"openai":          "https://api.openai.com/v1",
		"azure":           "https://myres.openai.azure.com",
		"partial segment": "https://dev.elitea.ai/llm2/v1", // NOT a segment prefix of /llm/v1
		"different host":  "https://other.elitea.ai/llm/v1",
		"empty api_base":  "",
		"unparsable":      "::::not-a-url",
		"different port":  "http://elitea-main:9090/llm/v1",
	}
	for name, apiBase := range cases {
		data := map[string]any{}
		if apiBase != "" {
			data["api_base"] = apiBase
		}
		if err := validateNotSelfReferential(data, origins()); err != nil {
			t.Errorf("%s (%q): must be allowed, got %v", name, apiBase, err)
		}
	}
}

func TestSelfRef_NoOriginsConfigured_NoOp(t *testing.T) {
	data := map[string]any{"api_base": "https://dev.elitea.ai/llm/v1"}
	if err := validateNotSelfReferential(data, nil); err != nil {
		t.Fatalf("guard must be inert with no configured origins, got %v", err)
	}
}

func TestSelfRef_BuildSelfOrigins_DeploymentURL(t *testing.T) {
	got := buildSelfOrigins("", "https://dev.elitea.ai/")
	if len(got) != 1 || got[0] != "https://dev.elitea.ai/llm" {
		t.Fatalf("buildSelfOrigins from DEPLOYMENT_URL = %v, want [https://dev.elitea.ai/llm]", got)
	}
	// /llm derived from DEPLOYMENT_URL must catch /llm/v1 credentials.
	if err := validateNotSelfReferential(map[string]any{"api_base": "https://dev.elitea.ai/llm/v1"}, got); err == nil {
		t.Fatal("credential under DEPLOYMENT_URL-derived /llm origin must be rejected")
	}
}

func TestSelfRef_BuildSelfOrigins_SkipsGarbage(t *testing.T) {
	got := buildSelfOrigins("not-a-url,,https://ok.example/llm", "")
	if len(got) != 1 || got[0] != "https://ok.example/llm" {
		t.Fatalf("buildSelfOrigins = %v, want the single valid origin", got)
	}
}

func TestSelfRef_ErrorCarriesReason(t *testing.T) {
	err := validateNotSelfReferential(map[string]any{"api_base": "https://dev.elitea.ai/llm/v1"}, origins())
	if err == nil {
		t.Fatal("expected rejection")
	}
	if got := err.Error(); len(got) == 0 || got[:len(SelfReferentialCredentialReason)] != SelfReferentialCredentialReason {
		t.Errorf("error must lead with %s, got %q", SelfReferentialCredentialReason, got)
	}
}

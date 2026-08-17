package configurations

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

type admissionResolverStub struct {
	calls []CurrentProviderConfigurationResolution
	err   error
}

func (stub *admissionResolverStub) ResolveCurrentProviderConfiguration(
	_ context.Context,
	resolution CurrentProviderConfigurationResolution,
) error {
	stub.calls = append(stub.calls, resolution)
	return stub.err
}

func admissionSnapshot(configType, section string, data map[string]any) CurrentConfigurationLifecycleSnapshot {
	if data == nil {
		data = map[string]any{}
	}
	return CurrentConfigurationLifecycleSnapshot{
		ID:          11,
		UUID:        "3f3f1f2e-0000-4000-8000-000000000001",
		ProjectID:   7,
		EliteaTitle: "Credential",
		Type:        configType,
		Section:     section,
		Data:        data,
	}
}

func TestCurrentProviderAdmissionRequiresCompleteDependencies(t *testing.T) {
	if _, err := NewCurrentProviderAdmission(nil, CurrentProviderProjectPolicy{PublicProjectID: 1}); err == nil {
		t.Fatal("nil resolver was accepted")
	}
	if _, err := NewCurrentProviderAdmission(&admissionResolverStub{}, CurrentProviderProjectPolicy{}); err == nil {
		t.Fatal("missing public project was accepted")
	}
}

// A credential row that resolves is the whole point of #457: the gateway reads
// only status_ok = true, and the write route is the only component in a
// shipped stack that can set it.
func TestCurrentProviderAdmissionAdmitsResolvedCredential(t *testing.T) {
	resolver := &admissionResolverStub{}
	admission, err := NewCurrentProviderAdmission(
		resolver,
		CurrentProviderProjectPolicy{AllowProjectOwnLLMs: true, PublicProjectID: 1},
	)
	if err != nil {
		t.Fatal(err)
	}

	snapshot := admissionSnapshot("open_ai", "ai_credentials", map[string]any{"api_key": "{{secret.openai}}"})
	decision, err := admission.AdmitCurrentProviderConfiguration(context.Background(), snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if !decision.Managed || !decision.StatusOK {
		t.Fatalf("decision = %#v, want managed and usable", decision)
	}
	if len(resolver.calls) != 1 {
		t.Fatalf("resolver calls = %d, want 1", len(resolver.calls))
	}
	call := resolver.calls[0]
	if call.ProjectID != 7 || call.Section != "ai_credentials" || call.ConfigurationUUID != snapshot.UUID {
		t.Fatalf("resolution = %#v", call)
	}
}

// The negative direction. A row whose references or hidden secrets do not
// resolve must be stored and must stay refused. Storing it as usable would
// move the failure to the user's first completion request.
func TestCurrentProviderAdmissionRefusesUnresolvedCredential(t *testing.T) {
	resolver := &admissionResolverStub{err: errors.New("secret reference does not resolve")}
	admission, err := NewCurrentProviderAdmission(
		resolver,
		CurrentProviderProjectPolicy{AllowProjectOwnLLMs: true, PublicProjectID: 1},
	)
	if err != nil {
		t.Fatal(err)
	}

	decision, err := admission.AdmitCurrentProviderConfiguration(
		context.Background(),
		admissionSnapshot("open_ai", "ai_credentials", map[string]any{"api_key": "{{secret.absent}}"}),
	)
	if err != nil {
		t.Fatalf("a failed resolution must be an answer, not an error: %v", err)
	}
	if !decision.Managed || decision.StatusOK {
		t.Fatalf("decision = %#v, want managed and refused", decision)
	}
}

// ELITEA_ALLOW_PROJECT_OWN_LLMS is enforced through this decision and nowhere
// else. A project the policy refuses must never be resolved and must never be
// marked usable.
func TestCurrentProviderAdmissionAppliesProjectPolicy(t *testing.T) {
	resolver := &admissionResolverStub{}
	admission, err := NewCurrentProviderAdmission(
		resolver,
		CurrentProviderProjectPolicy{AllowProjectOwnLLMs: false, PublicProjectID: 1},
	)
	if err != nil {
		t.Fatal(err)
	}

	refused, err := admission.AdmitCurrentProviderConfiguration(
		context.Background(),
		admissionSnapshot("open_ai", "ai_credentials", map[string]any{"api_key": "literal"}),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !refused.Managed || refused.StatusOK {
		t.Fatalf("private project decision = %#v, want managed and refused", refused)
	}
	if len(resolver.calls) != 0 {
		t.Fatalf("a refused project was resolved: %#v", resolver.calls)
	}

	public := admissionSnapshot("open_ai", "ai_credentials", map[string]any{"api_key": "literal"})
	public.ProjectID = 1
	admitted, err := admission.AdmitCurrentProviderConfiguration(context.Background(), public)
	if err != nil {
		t.Fatal(err)
	}
	if !admitted.Managed || !admitted.StatusOK {
		t.Fatalf("public project decision = %#v, want managed and usable", admitted)
	}
}

func TestCurrentProviderAdmissionModelRows(t *testing.T) {
	for _, test := range []struct {
		name        string
		snapshot    CurrentConfigurationLifecycleSnapshot
		wantManaged bool
		wantStatus  bool
	}{
		{
			name: "linked model resolves",
			snapshot: admissionSnapshot("llm_model", "llm", map[string]any{
				"name":           "gpt-4o",
				"ai_credentials": map[string]any{"elitea_title": "OpenAI"},
			}),
			wantManaged: true,
			wantStatus:  true,
		},
		{
			name: "linked model without a wire name is unusable",
			snapshot: admissionSnapshot("llm_model", "llm", map[string]any{
				"ai_credentials": map[string]any{"elitea_title": "OpenAI"},
			}),
			wantManaged: true,
			wantStatus:  false,
		},
		{
			// An imported model declares no reference and holds no secret, so
			// this decision owns nothing about it and the writer keeps its own
			// value. The lifecycle reconciler makes the same choice.
			name:        "imported model is not managed",
			snapshot:    admissionSnapshot("llm_model", "llm", map[string]any{"name": "gpt-4o"}),
			wantManaged: false,
			wantStatus:  false,
		},
		{
			name:        "generic SDK configuration is not managed",
			snapshot:    admissionSnapshot("github", "credentials", map[string]any{"token": "literal"}),
			wantManaged: false,
			wantStatus:  false,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			admission, err := NewCurrentProviderAdmission(
				&admissionResolverStub{},
				CurrentProviderProjectPolicy{AllowProjectOwnLLMs: true, PublicProjectID: 1},
			)
			if err != nil {
				t.Fatal(err)
			}
			decision, err := admission.AdmitCurrentProviderConfiguration(context.Background(), test.snapshot)
			if err != nil {
				t.Fatal(err)
			}
			if decision.Managed != test.wantManaged || decision.StatusOK != test.wantStatus {
				t.Fatalf("decision = %#v, want managed=%v status=%v", decision, test.wantManaged, test.wantStatus)
			}
		})
	}
}

func TestCurrentProviderAdmissionReportsContextFailure(t *testing.T) {
	admission, err := NewCurrentProviderAdmission(
		&admissionResolverStub{},
		CurrentProviderProjectPolicy{AllowProjectOwnLLMs: true, PublicProjectID: 1},
	)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := admission.AdmitCurrentProviderConfiguration(
		ctx,
		admissionSnapshot("open_ai", "ai_credentials", map[string]any{"api_key": "literal"}),
	); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled context error = %v", err)
	}
}

// The credential type table decides which rows this platform can mark usable.
// The LLM data plane is the Bifrost gateway, and the gateway holds its own
// table. The two must agree, or a credential type the gateway can serve stays
// at status_ok = false for ever and the gateway never sees it.
//
// The gateway is a separate Go module, so this test reads its source instead of
// importing it. A missing file is a failure, not a skip: a check that cannot
// find its subject has not passed.
func TestCurrentProviderCredentialTypeCoversGatewayProviderTable(t *testing.T) {
	source := filepath.Join(
		"..", "..", "..", "..",
		"elitea-llm-gateway", "internal", "account", "credentials.go",
	)
	content, err := os.ReadFile(source)
	if err != nil {
		t.Fatalf("read the gateway credential source %s: %v", source, err)
	}

	table := regexp.MustCompile(`(?s)var providerConfigTypes = map\[schemas\.ModelProvider\]\[\]string\{(.*?)\n\}`)
	block := table.FindSubmatch(content)
	if block == nil {
		t.Fatalf("providerConfigTypes is no longer declared in %s", source)
	}
	quoted := regexp.MustCompile(`"([a-z0-9_]+)"`).FindAllSubmatch(block[1], -1)
	if len(quoted) == 0 {
		t.Fatalf("providerConfigTypes in %s lists no configuration type", source)
	}
	for _, match := range quoted {
		configType := string(match[1])
		if !currentProviderCredentialType(configType) {
			t.Fatalf(
				"the gateway serves credential type %q, but this platform never marks such a row usable",
				configType,
			)
		}
	}
}

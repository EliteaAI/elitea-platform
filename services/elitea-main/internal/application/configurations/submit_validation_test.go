package configurations

import (
	"context"
	"errors"
	"strings"
	"testing"

	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
)

type targetResolverStub struct {
	target   ValidationTarget
	identity executionapp.AdmissionIdentity
	revision string
}

func (s *targetResolverStub) ResolveValidationTarget(_ context.Context, identity executionapp.AdmissionIdentity, revision string) (ValidationTarget, error) {
	s.identity = identity
	s.revision = revision
	return s.target, nil
}

type bundleFactoryStub struct {
	settings []byte
}

func (s *bundleFactoryStub) BuildValidationInput(_ context.Context, _ string, entryID, entryVersion string, settings []byte) (executiondomain.InputBundle, error) {
	s.settings = settings
	manifest := []byte(`{"entries":["settings"]}`)
	return executiondomain.InputBundle{
		ID:        "bundle-1",
		Version:   "bundle-v1",
		MediaType: executiondomain.InputBundleManifestMediaType,
		Digest:    runtimedomain.SHA256(manifest),
		Manifest:  manifest,
		Entries: []executiondomain.InputEntry{{
			ID:                    entryID,
			Version:               entryVersion,
			SemanticRole:          "configuration.settings",
			ContentID:             "content-1",
			MediaType:             executiondomain.SettingsJSONMediaType,
			Classification:        "synthetic",
			RequiredGrantAudience: "elitea.runtime.input.read.v1",
			ContentDigest:         runtimedomain.SHA256(settings),
			ContentLength:         int64(len(settings)),
			Content:               append([]byte(nil), settings...),
		}},
	}, nil
}

type jobSubmitterStub struct {
	request executionapp.SubmitValidationRequest
}

func (s *jobSubmitterStub) SubmitValidation(_ context.Context, request executionapp.SubmitValidationRequest) (executionapp.AdmissionOutcome, error) {
	s.request = request
	return executionapp.AdmissionOutcome{ExecutionID: "execution-1", CommandID: "command-1", Created: true}, nil
}

func TestSubmitValidationSelectsTrustedCatalogAndPreservesSettingsBytes(t *testing.T) {
	targets := &targetResolverStub{target: ValidationTarget{
		ConfigurationType:      "openapi",
		CatalogRevision:        "sdk-commit",
		CatalogDigest:          runtimedomain.SHA256([]byte("catalog")),
		SchemaID:               "openapi",
		SchemaRevision:         "schema-v1",
		SchemaDigest:           runtimedomain.SHA256([]byte("schema")),
		SettingsEntryID:        "settings",
		SettingsVersion:        "revision-1",
		ExpectedSettingsDigest: runtimedomain.SHA256([]byte(`{"auth_type":"Digest"}`)),
	}}
	bundles := &bundleFactoryStub{}
	jobs := &jobSubmitterStub{}
	service, err := NewSubmitValidationService(targets, bundles, jobs)
	if err != nil {
		t.Fatal(err)
	}
	identity := executionapp.AdmissionIdentity{
		TenantID:            "tenant-1",
		ResourceProjectID:   "project-1",
		ProjectionProjectID: "project-1",
		ActorID:             "actor-1",
	}
	settings := []byte(`{"auth_type":"Digest"}`)
	outcome, err := service.Submit(context.Background(), SubmitValidationRequest{
		Identity:                identity,
		ConfigurationRevisionID: "revision-1",
		IdempotencyKey:          "key-1",
		Settings:                settings,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !outcome.Created || jobs.request.Command.ConfigurationType != "openapi" || jobs.request.Command.CatalogRevision != "sdk-commit" {
		t.Fatalf("unexpected admitted command: %+v", jobs.request.Command)
	}
	if targets.identity != identity || targets.revision != "revision-1" {
		t.Fatal("target resolution did not bind trusted identity and revision")
	}
	settings[0] = '['
	if got := string(bundles.settings); got != `{"auth_type":"Digest"}` {
		t.Fatalf("bundle factory input aliased public request bytes: %q", got)
	}
}

func TestSubmitValidationRejectsSettingsThatDoNotMatchImmutableRevision(t *testing.T) {
	targets := &targetResolverStub{target: ValidationTarget{
		ConfigurationType:      "openapi",
		CatalogRevision:        "sdk-commit",
		CatalogDigest:          runtimedomain.SHA256([]byte("catalog")),
		SchemaID:               "openapi",
		SchemaRevision:         "schema-v1",
		SchemaDigest:           runtimedomain.SHA256([]byte("schema")),
		SettingsEntryID:        "settings",
		SettingsVersion:        "revision-1",
		ExpectedSettingsDigest: runtimedomain.SHA256([]byte(`{}`)),
	}}
	bundles := &bundleFactoryStub{}
	jobs := &jobSubmitterStub{}
	service, err := NewSubmitValidationService(targets, bundles, jobs)
	if err != nil {
		t.Fatal(err)
	}

	_, err = service.Submit(context.Background(), SubmitValidationRequest{
		Identity: executionapp.AdmissionIdentity{
			TenantID:            "tenant-1",
			ResourceProjectID:   "project-1",
			ProjectionProjectID: "project-1",
			ActorID:             "actor-1",
		},
		ConfigurationRevisionID: "revision-1",
		IdempotencyKey:          "key-1",
		Settings:                []byte(`{ }`),
	})
	if !errors.Is(err, ErrInvalidValidationAdmission) {
		t.Fatalf("expected immutable settings mismatch, got %v", err)
	}
	if bundles.settings != nil || jobs.request.Command.ConfigurationRevisionID != "" {
		t.Fatal("immutable settings mismatch reached bundle construction or job submission")
	}
}

func TestSubmitValidationRejectsSettingsAboveBoundBeforeDependencies(t *testing.T) {
	targets := &targetResolverStub{}
	service, err := NewSubmitValidationService(targets, &bundleFactoryStub{}, &jobSubmitterStub{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.Submit(context.Background(), SubmitValidationRequest{
		Identity: executionapp.AdmissionIdentity{
			TenantID:            "tenant-1",
			ResourceProjectID:   "project-1",
			ProjectionProjectID: "project-1",
			ActorID:             "actor-1",
		},
		ConfigurationRevisionID: "revision-1",
		IdempotencyKey:          "key-1",
		Settings:                make([]byte, MaxValidationSettingsBytes+1),
	})
	if err == nil {
		t.Fatal("oversized settings admitted")
	}
	if targets.revision != "" {
		t.Fatal("oversized settings reached target resolver")
	}
}

func TestSubmitValidationCredentialFreeBoundaryIsExplicit(t *testing.T) {
	tests := []struct {
		name     string
		settings string
		wantErr  error
	}{
		{name: "known string", settings: `{"auth_type":"Bearer"}`},
		{name: "known null", settings: `{"scope":null}`},
		{name: "known number reaches SDK", settings: `{"custom_header_name":123}`},
		{name: "known boolean reaches SDK", settings: `{"method":false}`},
		{name: "custom header name is a value", settings: `{"auth_type":"Custom","custom_header_name":"X-API-Key"}`},
		{name: "unknown extra", settings: `{"custom_option":"legacy-extra"}`, wantErr: ErrUnknownValidationProfileField},
		{name: "duplicate key", settings: `{"auth_type":"Basic","auth_type":"Bearer"}`, wantErr: ErrInvalidValidationAdmission},
		{name: "non object", settings: `[]`, wantErr: ErrInvalidValidationAdmission},
		{name: "non finite", settings: `{"scope":NaN}`, wantErr: ErrInvalidValidationAdmission},
		{name: "api key", settings: `{"api_key":"not-persisted"}`, wantErr: ErrCredentialBearingValidationInput},
		{name: "oauth client secret", settings: `{"client_secret":"not-persisted"}`, wantErr: ErrCredentialBearingValidationInput},
		{name: "empty credential string", settings: `{"api_key":""}`, wantErr: ErrCredentialBearingValidationInput},
		{name: "null credential", settings: `{"client_secret":null}`, wantErr: ErrCredentialBearingValidationInput},
		{name: "legacy nested X API key bypass", settings: `{"extension":{"X-API-Key":"not-persisted"}}`, wantErr: ErrUnknownValidationProfileField},
		{name: "container under allowed field", settings: `{"scope":{"note":"not-persisted"}}`, wantErr: ErrValidationProfileContainerValue},
		{name: "array under allowed field", settings: `{"scope":["read"]}`, wantErr: ErrValidationProfileContainerValue},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateCredentialFreeSettings([]byte(test.settings))
			if test.wantErr == nil && err != nil {
				t.Fatalf("known bounded scalar rejected: %v", err)
			}
			if test.wantErr != nil && !errors.Is(err, test.wantErr) {
				t.Fatalf("expected %v, got %v", test.wantErr, err)
			}
		})
	}
}

func TestCredentialFreeJSONStructuralLimitsMatchWorkerPolicy(t *testing.T) {
	deep := `{"scope":` + strings.Repeat(`{"value":`, maxValidationJSONDepth) + `null` + strings.Repeat(`}`, maxValidationJSONDepth)
	tests := []struct {
		name     string
		settings string
		wantErr  error
	}{
		{name: "depth", settings: deep, wantErr: ErrValidationInputLimitExceeded},
		{name: "long key", settings: `{"` + strings.Repeat("k", maxValidationJSONString+1) + `":null}`, wantErr: ErrValidationInputLimitExceeded},
		{name: "long string", settings: `{"scope":"` + strings.Repeat("v", maxValidationJSONString+1) + `"}`, wantErr: ErrValidationInputLimitExceeded},
		{name: "non finite exponent", settings: `{"scope":1e9999}`, wantErr: ErrInvalidValidationAdmission},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateCredentialFreeSettings([]byte(test.settings))
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("expected %v, got %v", test.wantErr, err)
			}
		})
	}
}

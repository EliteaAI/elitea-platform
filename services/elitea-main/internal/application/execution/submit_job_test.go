package execution

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	configurationdomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/configurations"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
)

type memoryAdmissionStore struct {
	byKey map[string]ValidationAdmission
}

func (s *memoryAdmissionStore) AdmitValidation(_ context.Context, admission ValidationAdmission) (AdmissionOutcome, error) {
	key := admission.Record.IdempotencyScope + "\x00" + admission.Record.IdempotencyKey
	if existing, ok := s.byKey[key]; ok {
		if existing.Record.RequestDigest != admission.Record.RequestDigest {
			return AdmissionOutcome{}, ErrIdempotencyConflict
		}
		return AdmissionOutcome{
			ExecutionID: existing.Record.Job.ID,
			CommandID:   existing.Record.Job.CommandID,
			Created:     false,
		}, nil
	}
	admission.Record.InputBundle = admission.Record.InputBundle.Clone()
	s.byKey[key] = admission
	return AdmissionOutcome{
		ExecutionID: admission.Record.Job.ID,
		CommandID:   admission.Record.Job.CommandID,
		Created:     true,
	}, nil
}

func TestSubmitValidationIsAtomicIdempotentAndCopiesInput(t *testing.T) {
	store := &memoryAdmissionStore{byKey: make(map[string]ValidationAdmission)}
	ids := 0
	service, err := NewSubmitJobService(store, func() time.Time {
		return time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	}, func() (string, error) {
		ids++
		return fmt.Sprintf("id-%d", ids), nil
	})
	if err != nil {
		t.Fatal(err)
	}

	request := validSubmitValidationRequest([]byte(`{}`))
	first, err := service.SubmitValidation(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if !first.Created || first.ExecutionID != "id-1" || first.CommandID != "id-2" {
		t.Fatalf("unexpected first outcome: %+v", first)
	}

	request.InputBundle.Entry.Content[0] = '['
	stored := onlyAdmission(t, store)
	if got := string(stored.Record.InputBundle.Entry.Content); got != `{}` {
		t.Fatalf("stored immutable content changed through caller alias: %q", got)
	}

	retry := validSubmitValidationRequest([]byte(`{}`))
	second, err := service.SubmitValidation(context.Background(), retry)
	if err != nil {
		t.Fatal(err)
	}
	if second.Created || second.ExecutionID != first.ExecutionID || second.CommandID != first.CommandID {
		t.Fatalf("idempotent retry created a second job: %+v", second)
	}
	if len(store.byKey) != 1 {
		t.Fatalf("expected one atomic admission, got %d", len(store.byKey))
	}
}

func TestSubmitValidationRejectsIdempotencyKeyReuseWithDifferentSettings(t *testing.T) {
	store := &memoryAdmissionStore{byKey: make(map[string]ValidationAdmission)}
	service, err := NewSubmitJobService(store, time.Now, func() (string, error) { return "new-id", nil })
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SubmitValidation(context.Background(), validSubmitValidationRequest([]byte(`{}`))); err != nil {
		t.Fatal(err)
	}
	_, err = service.SubmitValidation(context.Background(), validSubmitValidationRequest([]byte(`{"auth_type":"Digest"}`)))
	if !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("expected idempotency conflict, got %v", err)
	}
}

func TestSubmitValidationRetryIgnoresOnlyGeneratedBundleIdentity(t *testing.T) {
	store := &memoryAdmissionStore{byKey: make(map[string]ValidationAdmission)}
	ids := 0
	service, err := NewSubmitJobService(store, time.Now, func() (string, error) {
		ids++
		return fmt.Sprintf("generated-%d", ids), nil
	})
	if err != nil {
		t.Fatal(err)
	}

	firstRequest := validSubmitValidationRequest([]byte(`{}`))
	first, err := service.SubmitValidation(context.Background(), firstRequest)
	if err != nil {
		t.Fatal(err)
	}

	retry := validSubmitValidationRequest([]byte(`{}`))
	retry.InputBundle.ID = "bundle-generated-by-retry"
	retry.InputBundle.Entry.ContentID = "content-generated-by-retry"
	retry.InputBundle.Manifest = []byte(`{"entries":["settings"],"storage_ids":"retry"}`)
	retry.InputBundle.Digest = runtimedomain.SHA256(retry.InputBundle.Manifest)
	second, err := service.SubmitValidation(context.Background(), retry)
	if err != nil {
		t.Fatalf("generated storage identity changed idempotency semantics: %v", err)
	}
	if second.Created || second.ExecutionID != first.ExecutionID || second.CommandID != first.CommandID {
		t.Fatalf("retry did not replay the durable admission: first=%+v second=%+v", first, second)
	}

	changedPolicy := retry
	changedPolicy.InputBundle.Entry.Classification = "different-policy"
	if _, err := service.SubmitValidation(context.Background(), changedPolicy); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("semantic input policy change did not conflict: %v", err)
	}
}

func validSubmitValidationRequest(settings []byte) SubmitValidationRequest {
	manifest := []byte(`{"entries":["settings"]}`)
	return SubmitValidationRequest{
		Identity: AdmissionIdentity{
			TenantID:            "tenant-1",
			ResourceProjectID:   "project-1",
			ProjectionProjectID: "project-1",
			ActorID:             "actor-1",
		},
		IdempotencyKey: "validation-key",
		InputBundle: executiondomain.InputBundle{
			ID:        "bundle-1",
			Version:   "bundle-v1",
			MediaType: executiondomain.InputBundleManifestMediaType,
			Digest:    runtimedomain.SHA256(manifest),
			Manifest:  manifest,
			Entry: executiondomain.InputEntry{
				ID:                    "settings",
				Version:               "revision-1",
				SemanticRole:          "configuration.settings",
				ContentID:             "content-1",
				MediaType:             executiondomain.SettingsJSONMediaType,
				Classification:        "synthetic",
				RequiredGrantAudience: "elitea.runtime.input.read.v1",
				ContentDigest:         runtimedomain.SHA256(settings),
				ContentLength:         int64(len(settings)),
				Content:               settings,
			},
		},
		Command: configurationdomain.ValidationCommand{
			ConfigurationRevisionID: "revision-1",
			ConfigurationType:       "openapi",
			CatalogRevision:         "sdk-commit",
			CatalogDigest:           runtimedomain.SHA256([]byte("catalog")),
			SchemaID:                "openapi",
			SchemaRevision:          "schema-v1",
			SchemaDigest:            runtimedomain.SHA256([]byte("schema")),
			SettingsEntryID:         "settings",
		},
	}
}

func onlyAdmission(t *testing.T, store *memoryAdmissionStore) ValidationAdmission {
	t.Helper()
	for _, admission := range store.byKey {
		return admission
	}
	t.Fatal("no admission stored")
	return ValidationAdmission{}
}

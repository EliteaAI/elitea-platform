package repos

import (
	"context"
	"errors"
	"testing"
	"time"

	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	configurationdomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/configurations"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
)

func TestExecutionJobsRepositoryReplaysMatchingIdempotencyWithoutWriting(t *testing.T) {
	admission := testValidationAdmission()
	store := &scriptedStore{scriptedExecutor: &scriptedExecutor{rowResults: []scriptedRow{{values: []any{
		"durable-execution", "durable-command", admission.Record.RequestDigest[:],
	}}}}}
	repository, err := newExecutionJobsRepository(store, testDispatchPolicy())
	if err != nil {
		t.Fatal(err)
	}
	outcome, err := repository.AdmitValidation(context.Background(), admission)
	if err != nil {
		t.Fatal(err)
	}
	if outcome.ExecutionID != "durable-execution" || outcome.CommandID != "durable-command" || outcome.Created {
		t.Fatalf("unexpected replay outcome: %+v", outcome)
	}
	if len(store.execCalls) != 0 || len(store.rowCalls) != 1 {
		t.Fatalf("idempotent replay wrote data: rows=%d execs=%d", len(store.rowCalls), len(store.execCalls))
	}
}

func TestExecutionJobsRepositoryRejectsIdempotencyDigestConflict(t *testing.T) {
	admission := testValidationAdmission()
	other := runtimedomain.SHA256([]byte("different request"))
	store := &scriptedStore{scriptedExecutor: &scriptedExecutor{rowResults: []scriptedRow{{values: []any{
		"durable-execution", "durable-command", other[:],
	}}}}}
	repository, err := newExecutionJobsRepository(store, testDispatchPolicy())
	if err != nil {
		t.Fatal(err)
	}
	_, err = repository.AdmitValidation(context.Background(), admission)
	if !errors.Is(err, executionapp.ErrIdempotencyConflict) {
		t.Fatalf("expected idempotency conflict, got %v", err)
	}
	if len(store.execCalls) != 0 {
		t.Fatal("conflicting replay wrote data")
	}
}

func testDispatchPolicy() ValidationDispatchPolicy {
	return ValidationDispatchPolicy{
		StreamName:        "runtime:commands",
		CapabilityVersion: "1.0.0",
		GrantTemplateID:   "input-read-v1",
		ResourceClass:     "validation-small",
		IsolationClass:    "tenant",
		Priority:          1,
		DeadlineTTL:       time.Minute,
		LimitsRevision:    "limits-v1",
	}
}

func testValidationAdmission() executionapp.ValidationAdmission {
	manifest := []byte("deterministic manifest")
	settings := []byte("{}\n")
	createdAt := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	command := configurationdomain.ValidationCommand{
		ConfigurationRevisionID: "revision-1",
		ConfigurationType:       "openapi",
		CatalogRevision:         "catalog-v1",
		CatalogDigest:           runtimedomain.SHA256([]byte("catalog")),
		SchemaID:                "openapi",
		SchemaRevision:          "schema-v1",
		SchemaDigest:            runtimedomain.SHA256([]byte("schema")),
		SettingsEntryID:         "settings",
	}
	return executionapp.ValidationAdmission{
		Command: command,
		Record: executiondomain.Admission{
			IdempotencyScope: "tenant-1/1/actor-1",
			IdempotencyKey:   "request-1",
			RequestDigest:    runtimedomain.SHA256([]byte("request")),
			InputBundle: executiondomain.InputBundle{
				ID:        "bundle-1",
				Version:   "revision-1",
				MediaType: executiondomain.InputBundleManifestMediaType,
				Digest:    runtimedomain.SHA256(manifest),
				Manifest:  manifest,
				Entry: executiondomain.InputEntry{
					ID:                    "settings",
					Version:               "revision-1",
					SemanticRole:          "configuration.settings",
					ContentID:             "content-1",
					MediaType:             executiondomain.SettingsJSONMediaType,
					Classification:        "tenant-confidential",
					RequiredGrantAudience: "elitea.runtime.input.read.v1",
					ContentDigest:         runtimedomain.SHA256(settings),
					ContentLength:         int64(len(settings)),
					Content:               settings,
				},
			},
			Job: executiondomain.Job{
				ID:                  "execution-1",
				CommandID:           "command-1",
				TenantID:            "tenant-1",
				ResourceProjectID:   "1",
				ProjectionProjectID: "1",
				ActorID:             "actor-1",
				CapabilityID:        executiondomain.ConfigurationValidationCapability,
				Generation:          1,
				State:               executiondomain.JobPending,
				CreatedAt:           createdAt,
			},
			Outbox: executiondomain.OutboxRecord{
				ID:          "outbox-1",
				CommandID:   "command-1",
				ExecutionID: "execution-1",
				Generation:  1,
				CreatedAt:   createdAt,
			},
		},
	}
}

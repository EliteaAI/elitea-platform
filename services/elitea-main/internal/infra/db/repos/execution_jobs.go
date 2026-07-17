package repos

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	maxStoredInputManifestBytes = 64 * 1024
	maxStoredInputContentBytes  = 256 * 1024
)

type ValidationDispatchPolicy struct {
	StreamName        string
	CapabilityVersion string
	GrantTemplateID   string
	ResourceClass     string
	IsolationClass    string
	Priority          uint32
	DeadlineTTL       time.Duration
	LimitsRevision    string
}

func (p ValidationDispatchPolicy) validate() error {
	if p.StreamName == "" || p.CapabilityVersion == "" || p.GrantTemplateID == "" || p.ResourceClass == "" || p.IsolationClass == "" || p.Priority == 0 || p.Priority > math.MaxInt32 || p.DeadlineTTL <= 0 || p.LimitsRevision == "" {
		return errors.New("validation dispatch policy is incomplete")
	}
	for _, value := range []string{p.StreamName, p.CapabilityVersion, p.GrantTemplateID, p.ResourceClass, p.IsolationClass, p.LimitsRevision} {
		if len(value) > 256 || strings.ContainsRune(value, '\x00') {
			return errors.New("validation dispatch policy exceeds storage bounds")
		}
	}
	return nil
}

type ExecutionJobsRepository struct {
	store  sharedStore
	policy ValidationDispatchPolicy
}

func NewExecutionJobsRepository(pool *pgxpool.Pool, policy ValidationDispatchPolicy) (*ExecutionJobsRepository, error) {
	store, err := newPostgresSharedStore(pool)
	if err != nil {
		return nil, err
	}
	return newExecutionJobsRepository(store, policy)
}

func newExecutionJobsRepository(store sharedStore, policy ValidationDispatchPolicy) (*ExecutionJobsRepository, error) {
	if store == nil {
		return nil, errors.New("execution database is required")
	}
	if err := policy.validate(); err != nil {
		return nil, err
	}
	return &ExecutionJobsRepository{store: store, policy: policy}, nil
}

func (r *ExecutionJobsRepository) AdmitValidation(ctx context.Context, admission executionapp.ValidationAdmission) (executionapp.AdmissionOutcome, error) {
	if err := admission.Record.Validate(); err != nil {
		return executionapp.AdmissionOutcome{}, err
	}
	if err := admission.Command.Validate(); err != nil {
		return executionapp.AdmissionOutcome{}, err
	}
	if admission.Record.InputBundle.Entry.ID != admission.Command.SettingsEntryID || len(admission.Record.InputBundle.Manifest) > maxStoredInputManifestBytes || len(admission.Record.InputBundle.Entry.Content) > maxStoredInputContentBytes {
		return executionapp.AdmissionOutcome{}, executionapp.ErrInvalidAdmission
	}
	if !boundedAdmissionStrings(admission) {
		return executionapp.AdmissionOutcome{}, executionapp.ErrInvalidAdmission
	}
	resourceProjectID, err := parseProjectID(admission.Record.Job.ResourceProjectID)
	if err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("resource project: %w", err)
	}
	projectionProjectID, err := parseProjectID(admission.Record.Job.ProjectionProjectID)
	if err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("projection project: %w", err)
	}

	var outcome executionapp.AdmissionOutcome
	err = r.store.WithinTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadWrite}, func(tx sqlExecutor) error {
		existing, requestDigest, err := loadAdmissionByIdempotency(ctx, tx, admission.Record.IdempotencyScope, admission.Record.IdempotencyKey)
		switch {
		case err == nil:
			if requestDigest != admission.Record.RequestDigest {
				return executionapp.ErrIdempotencyConflict
			}
			outcome = existing
			return nil
		case !errors.Is(err, pgx.ErrNoRows):
			return fmt.Errorf("load validation idempotency binding: %w", err)
		}

		if err := insertInputBundle(ctx, tx, resourceProjectID, admission.Record.Job.ActorID, admission.Record.InputBundle); err != nil {
			return err
		}
		created, err := insertExecutionJob(ctx, tx, resourceProjectID, projectionProjectID, r.policy, admission)
		if errors.Is(err, pgx.ErrNoRows) {
			// A concurrent transaction won the unique idempotency key. Returning a
			// private replay error forces this transaction to roll back its newly
			// generated input bundle before returning the durable winner.
			existing, requestDigest, loadErr := loadAdmissionByIdempotency(ctx, tx, admission.Record.IdempotencyScope, admission.Record.IdempotencyKey)
			if loadErr != nil {
				return fmt.Errorf("load concurrent validation admission: %w", loadErr)
			}
			if requestDigest != admission.Record.RequestDigest {
				return executionapp.ErrIdempotencyConflict
			}
			return admissionReplay{outcome: existing}
		}
		if err != nil {
			return err
		}
		if !created {
			return errors.New("execution job insert did not report creation")
		}
		if err := insertCommandOutbox(ctx, tx, r.policy, admission.Record); err != nil {
			return err
		}
		outcome = executionapp.AdmissionOutcome{
			ExecutionID: admission.Record.Job.ID,
			CommandID:   admission.Record.Job.CommandID,
			Created:     true,
		}
		return nil
	})
	var replay admissionReplay
	if errors.As(err, &replay) {
		return replay.outcome, nil
	}
	if err != nil {
		return executionapp.AdmissionOutcome{}, err
	}
	return outcome, nil
}

func boundedAdmissionStrings(admission executionapp.ValidationAdmission) bool {
	record := admission.Record
	command := admission.Command
	values := []string{
		record.IdempotencyScope, record.IdempotencyKey,
		record.InputBundle.ID, record.InputBundle.Version, record.InputBundle.MediaType,
		record.InputBundle.Entry.ID, record.InputBundle.Entry.Version,
		record.InputBundle.Entry.SemanticRole, record.InputBundle.Entry.ContentID,
		record.InputBundle.Entry.MediaType, record.InputBundle.Entry.Classification,
		record.InputBundle.Entry.RequiredGrantAudience,
		record.Job.ID, record.Job.CommandID, record.Job.TenantID,
		record.Job.ResourceProjectID, record.Job.ProjectionProjectID,
		record.Job.ActorID, record.Job.CapabilityID, record.Outbox.ID,
		command.ConfigurationRevisionID, command.ConfigurationType,
		command.CatalogRevision, command.SchemaID, command.SchemaRevision,
		command.SettingsEntryID,
	}
	for _, value := range values {
		if value == "" || len(value) > 256 || strings.ContainsRune(value, '\x00') {
			return false
		}
	}
	return true
}

type admissionReplay struct {
	outcome executionapp.AdmissionOutcome
}

func (e admissionReplay) Error() string { return "concurrent admission replay" }

func loadAdmissionByIdempotency(ctx context.Context, db sqlExecutor, scope, key string) (executionapp.AdmissionOutcome, runtimedomain.Digest, error) {
	var outcome executionapp.AdmissionOutcome
	var digestBytes []byte
	err := db.QueryRow(ctx, `
SELECT execution_id, command_id, request_digest
FROM elitea_runtime.execution_jobs
WHERE idempotency_scope = $1 AND idempotency_key = $2`, scope, key).Scan(
		&outcome.ExecutionID,
		&outcome.CommandID,
		&digestBytes,
	)
	if err != nil {
		return executionapp.AdmissionOutcome{}, runtimedomain.Digest{}, err
	}
	digest, err := storedDigest(digestBytes)
	if err != nil {
		return executionapp.AdmissionOutcome{}, runtimedomain.Digest{}, fmt.Errorf("invalid stored request digest: %w", err)
	}
	outcome.Created = false
	return outcome, digest, nil
}

func insertExecutionJob(ctx context.Context, tx sqlExecutor, resourceProjectID, projectionProjectID int64, policy ValidationDispatchPolicy, admission executionapp.ValidationAdmission) (bool, error) {
	record := admission.Record
	command := admission.Command
	var executionID string
	err := tx.QueryRow(ctx, `
INSERT INTO elitea_runtime.execution_jobs (
    execution_id, generation, command_id, tenant_id, resource_project_id,
    projection_project_id, actor_id, principal_ref, grant_template_id,
    capability_id, capability_version, input_bundle_id, request_digest,
    idempotency_scope, idempotency_key, configuration_revision_id,
    configuration_type, catalog_revision, catalog_digest, schema_id,
    schema_revision, schema_digest, settings_entry_id, state, desired_state,
    admitted_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11, $12, $13,
    $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, 'RUNNING', $24
)
ON CONFLICT (idempotency_scope, idempotency_key) DO NOTHING
RETURNING execution_id`,
		record.Job.ID,
		int64(record.Job.Generation),
		record.Job.CommandID,
		record.Job.TenantID,
		resourceProjectID,
		projectionProjectID,
		record.Job.ActorID,
		policy.GrantTemplateID,
		record.Job.CapabilityID,
		policy.CapabilityVersion,
		record.InputBundle.ID,
		record.RequestDigest[:],
		record.IdempotencyScope,
		record.IdempotencyKey,
		command.ConfigurationRevisionID,
		command.ConfigurationType,
		command.CatalogRevision,
		command.CatalogDigest[:],
		command.SchemaID,
		command.SchemaRevision,
		command.SchemaDigest[:],
		command.SettingsEntryID,
		string(record.Job.State),
		record.Job.CreatedAt,
	).Scan(&executionID)
	if err != nil {
		return false, fmt.Errorf("insert execution job: %w", err)
	}
	return executionID == record.Job.ID, nil
}

func storedDigest(value []byte) (runtimedomain.Digest, error) {
	var digest runtimedomain.Digest
	if len(value) != len(digest) {
		return digest, runtimedomain.ErrInvalidDigest
	}
	copy(digest[:], value)
	return digest, nil
}

var _ executionapp.AtomicAdmissionStore = (*ExecutionJobsRepository)(nil)

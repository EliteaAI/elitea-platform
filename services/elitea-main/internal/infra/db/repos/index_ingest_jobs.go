package repos

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	runtimev1 "github.com/EliteaAI/elitea-platform/libs/proto/gen/go/elitea/runtime/v1"
	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/proto"
)

type IndexIngestJobsRepository struct {
	pool   *pgxpool.Pool
	policy IndexIngestDispatchPolicy
}

func NewIndexIngestJobsRepository(pool *pgxpool.Pool, policy IndexIngestDispatchPolicy) (*IndexIngestJobsRepository, error) {
	if pool == nil {
		return nil, errors.New("index admission database is required")
	}
	if err := policy.validate(); err != nil {
		return nil, err
	}
	return &IndexIngestJobsRepository{pool: pool, policy: policy}, nil
}

func (r *IndexIngestJobsRepository) AdmitIndexIngest(ctx context.Context, admission indexingapp.Admission) (executionapp.AdmissionOutcome, error) {
	if err := admission.Record.Validate(); err != nil {
		return executionapp.AdmissionOutcome{}, err
	}
	if admission.Record.Job.CapabilityID != executiondomain.IndexIngestCapability {
		return executionapp.AdmissionOutcome{}, executionapp.ErrInvalidAdmission
	}
	if err := admission.Binding.Validate(admission.Record.InputBundle); err != nil {
		return executionapp.AdmissionOutcome{}, err
	}
	if err := validateIndexInputManifest(admission.Record.InputBundle); err != nil {
		return executionapp.AdmissionOutcome{}, err
	}
	if len(admission.Record.InputBundle.Manifest) > maxStoredInputManifestBytes || len(admission.Record.InputBundle.Entries) > executiondomain.MaxInputBundleEntries {
		return executionapp.AdmissionOutcome{}, executionapp.ErrInvalidAdmission
	}
	for _, entry := range admission.Record.InputBundle.Entries {
		if len(entry.Content) > executiondomain.MaxInputEntryContentBytes {
			return executionapp.AdmissionOutcome{}, executionapp.ErrInvalidAdmission
		}
	}
	if !boundedIndexAdmissionStrings(admission) || admission.Record.Job.Generation > math.MaxInt64 || admission.Record.Outbox.Generation > math.MaxInt64 {
		return executionapp.AdmissionOutcome{}, executionapp.ErrInvalidAdmission
	}
	resourceProject, err := parseProjectID(admission.Record.Job.ResourceProjectID)
	if err != nil || resourceProject > math.MaxInt32 {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("resource project: %w", errors.New("project ID must fit the current integer schema"))
	}
	projectionProject, err := parseProjectID(admission.Record.Job.ProjectionProjectID)
	if err != nil || projectionProject > math.MaxInt32 {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("projection project: %w", errors.New("project ID must fit the current integer schema"))
	}

	queries := sqlcgen.New(r.pool)
	existing, digest, err := loadIndexAdmission(ctx, queries, admission.Record.IdempotencyScope, admission.Record.IdempotencyKey)
	switch {
	case err == nil:
		if digest != admission.Record.RequestDigest {
			return executionapp.AdmissionOutcome{}, executionapp.ErrIdempotencyConflict
		}
		return existing, nil
	case !errors.Is(err, pgx.ErrNoRows):
		return executionapp.AdmissionOutcome{}, fmt.Errorf("load index idempotency binding: %w", err)
	}

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadWrite})
	if err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("begin index admission transaction: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(context.WithoutCancel(ctx))
		}
	}()
	txQueries := sqlcgen.New(tx)
	if err := txQueries.EnsureRuntimeAdmissionPolicy(ctx, sqlcgen.EnsureRuntimeAdmissionPolicyParams{
		CapabilityID:   executiondomain.IndexIngestCapability,
		MaxOutstanding: r.policy.MaxOutstanding,
	}); err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("ensure index admission policy: %w", err)
	}
	persistedMax, err := txQueries.LockRuntimeAdmissionPolicy(ctx, executiondomain.IndexIngestCapability)
	if err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("lock index admission policy: %w", err)
	}
	if persistedMax != r.policy.MaxOutstanding {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("%w: capability %q configured=%d persisted=%d", ErrAdmissionPolicyMismatch, executiondomain.IndexIngestCapability, r.policy.MaxOutstanding, persistedMax)
	}

	existing, digest, err = loadIndexAdmission(ctx, txQueries, admission.Record.IdempotencyScope, admission.Record.IdempotencyKey)
	switch {
	case err == nil:
		if digest != admission.Record.RequestDigest {
			return executionapp.AdmissionOutcome{}, executionapp.ErrIdempotencyConflict
		}
		if err := tx.Commit(ctx); err != nil {
			return executionapp.AdmissionOutcome{}, fmt.Errorf("commit index admission replay: %w", err)
		}
		committed = true
		return existing, nil
	case !errors.Is(err, pgx.ErrNoRows):
		return executionapp.AdmissionOutcome{}, fmt.Errorf("reload index idempotency binding: %w", err)
	}

	active, err := txQueries.CountActiveRuntimeExecutionsUpTo(ctx, sqlcgen.CountActiveRuntimeExecutionsUpToParams{
		CapabilityID:   executiondomain.IndexIngestCapability,
		MaxOutstanding: r.policy.MaxOutstanding,
	})
	if err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("count active index executions: %w", err)
	}
	if active >= r.policy.MaxOutstanding {
		if err := tx.Commit(ctx); err != nil {
			return executionapp.AdmissionOutcome{}, fmt.Errorf("commit index admission capacity observation: %w", err)
		}
		committed = true
		return executionapp.AdmissionOutcome{}, &executionapp.AdmissionCapacityError{
			CapabilityID:   executiondomain.IndexIngestCapability,
			MaxOutstanding: r.policy.MaxOutstanding,
		}
	}

	timingRow, err := txQueries.LoadRuntimeAdmissionTiming(ctx, r.policy.DeadlineTTL.Milliseconds())
	if err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("load index admission timing: %w", err)
	}
	timing, err := decodeIndexAdmissionTiming(timingRow, r.policy.DeadlineTTL)
	if err != nil {
		return executionapp.AdmissionOutcome{}, err
	}
	if err := insertIndexInputBundle(ctx, txQueries, int32(resourceProject), admission.Record, timing.AdmittedAt); err != nil {
		return executionapp.AdmissionOutcome{}, err
	}
	createdID, err := txQueries.InsertIndexIngestExecutionJob(ctx, sqlcgen.InsertIndexIngestExecutionJobParams{
		ExecutionID:         admission.Record.Job.ID,
		Generation:          int64(admission.Record.Job.Generation),
		CommandID:           admission.Record.Job.CommandID,
		TenantID:            admission.Record.Job.TenantID,
		ResourceProjectID:   int32(resourceProject),
		ProjectionProjectID: int32(projectionProject),
		ActorID:             admission.Record.Job.ActorID,
		PrincipalRef:        admission.Record.Job.ActorID,
		CapabilityVersion:   r.policy.CapabilityVersion,
		InputBundleID:       admission.Record.InputBundle.ID,
		RequestDigest:       append([]byte(nil), admission.Record.RequestDigest[:]...),
		IdempotencyScope:    admission.Record.IdempotencyScope,
		IdempotencyKey:      admission.Record.IdempotencyKey,
		State:               string(admission.Record.Job.State),
		AdmittedAt:          timestamp(timing.AdmittedAt),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		existing, digest, loadErr := loadIndexAdmission(ctx, txQueries, admission.Record.IdempotencyScope, admission.Record.IdempotencyKey)
		if loadErr != nil {
			return executionapp.AdmissionOutcome{}, fmt.Errorf("load concurrent index admission: %w", loadErr)
		}
		if digest != admission.Record.RequestDigest {
			return executionapp.AdmissionOutcome{}, executionapp.ErrIdempotencyConflict
		}
		if rollbackErr := tx.Rollback(context.WithoutCancel(ctx)); rollbackErr != nil && !errors.Is(rollbackErr, pgx.ErrTxClosed) {
			return executionapp.AdmissionOutcome{}, fmt.Errorf("rollback concurrent index admission: %w", rollbackErr)
		}
		committed = true
		return existing, nil
	}
	if err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("insert index execution job: %w", err)
	}
	if createdID != admission.Record.Job.ID {
		return executionapp.AdmissionOutcome{}, errors.New("index execution job insert changed identity")
	}
	if err := txQueries.InsertIndexIngestJob(ctx, sqlcgen.InsertIndexIngestJobParams{
		ExecutionID:                 admission.Record.Job.ID,
		Generation:                  int64(admission.Record.Job.Generation),
		InputBundleID:               admission.Record.InputBundle.ID,
		ToolkitConfigurationEntryID: admission.Binding.ToolkitConfigurationEntryID,
		ToolParametersEntryID:       admission.Binding.ToolParametersEntryID,
		LlmModelEntryID:             optionalString(admission.Binding.LLMModelEntryID),
		LlmConfigurationEntryID:     optionalString(admission.Binding.LLMConfigurationEntryID),
		McpTokensEntryID:            optionalString(admission.Binding.MCPTokensEntryID),
		ToolkitID:                   admission.Binding.ToolkitID,
		IndexName:                   admission.Binding.IndexName,
		Initiator:                   string(admission.Binding.Initiator),
	}); err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("insert index capability job: %w", err)
	}
	if err := txQueries.InsertRuntimeCommandOutbox(ctx, sqlcgen.InsertRuntimeCommandOutboxParams{
		OutboxID:       admission.Record.Outbox.ID,
		ExecutionID:    admission.Record.Outbox.ExecutionID,
		Generation:     int64(admission.Record.Outbox.Generation),
		StreamName:     r.policy.StreamName,
		ResourceClass:  r.policy.ResourceClass,
		IsolationClass: r.policy.IsolationClass,
		Priority:       int32(r.policy.Priority),
		Deadline:       timestamp(timing.Deadline),
		LimitsRevision: r.policy.LimitsRevision,
		CreatedAt:      timestamp(timing.AdmittedAt),
	}); err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("insert index command outbox: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("commit index admission: %w", err)
	}
	committed = true
	return executionapp.AdmissionOutcome{
		ExecutionID: admission.Record.Job.ID,
		CommandID:   admission.Record.Job.CommandID,
		Created:     true,
		AdmittedAt:  timing.AdmittedAt,
		Deadline:    timing.Deadline,
	}, nil
}

func loadIndexAdmission(ctx context.Context, queries *sqlcgen.Queries, scope, key string) (executionapp.AdmissionOutcome, runtimedomain.Digest, error) {
	row, err := queries.GetRuntimeAdmissionByIdempotency(ctx, sqlcgen.GetRuntimeAdmissionByIdempotencyParams{
		IdempotencyScope: scope,
		IdempotencyKey:   key,
	})
	if err != nil {
		return executionapp.AdmissionOutcome{}, runtimedomain.Digest{}, err
	}
	digest, err := storedDigest(row.RequestDigest)
	if err != nil {
		return executionapp.AdmissionOutcome{}, runtimedomain.Digest{}, fmt.Errorf("invalid stored index request digest: %w", err)
	}
	if !row.AdmittedAt.Valid || !row.Deadline.Valid || row.AdmittedAt.Time.IsZero() || !row.Deadline.Time.After(row.AdmittedAt.Time) {
		return executionapp.AdmissionOutcome{}, runtimedomain.Digest{}, errors.New("stored index admission timing is invalid")
	}
	return executionapp.AdmissionOutcome{
		ExecutionID: row.ExecutionID,
		CommandID:   row.CommandID,
		Created:     false,
		AdmittedAt:  row.AdmittedAt.Time.UTC(),
		Deadline:    row.Deadline.Time.UTC(),
	}, digest, nil
}

func decodeIndexAdmissionTiming(row sqlcgen.LoadRuntimeAdmissionTimingRow, deadlineTTL time.Duration) (admissionTiming, error) {
	if !row.AdmittedAt.Valid || !row.Deadline.Valid {
		return admissionTiming{}, errors.New("database returned invalid index admission timing")
	}
	admittedAt := row.AdmittedAt.Time.UTC()
	deadline := row.Deadline.Time.UTC()
	if admittedAt.IsZero() || !deadline.After(admittedAt) || deadline.Sub(admittedAt) != deadlineTTL {
		return admissionTiming{}, errors.New("database returned invalid index admission timing")
	}
	return admissionTiming{AdmittedAt: admittedAt, Deadline: deadline}, nil
}

func insertIndexInputBundle(ctx context.Context, queries *sqlcgen.Queries, resourceProjectID int32, record executiondomain.Admission, admittedAt time.Time) error {
	bundle := record.InputBundle
	if err := queries.InsertRuntimeInputBundle(ctx, sqlcgen.InsertRuntimeInputBundleParams{
		InputBundleID:     bundle.ID,
		ImmutableVersion:  bundle.Version,
		MediaType:         bundle.MediaType,
		ResourceProjectID: resourceProjectID,
		ManifestDigest:    append([]byte(nil), bundle.Digest[:]...),
		ManifestSize:      int64(len(bundle.Manifest)),
		ManifestBytes:     append([]byte(nil), bundle.Manifest...),
		CreatedBy:         record.Job.ActorID,
		CreatedAt:         timestamp(admittedAt),
	}); err != nil {
		return fmt.Errorf("insert index input bundle: %w", err)
	}
	for _, entry := range bundle.Entries {
		if err := queries.InsertRuntimeInputBundleEntry(ctx, sqlcgen.InsertRuntimeInputBundleEntryParams{
			InputBundleID:         bundle.ID,
			EntryID:               entry.ID,
			EntryVersion:          entry.Version,
			SemanticRole:          entry.SemanticRole,
			MediaType:             entry.MediaType,
			ContentDigest:         append([]byte(nil), entry.ContentDigest[:]...),
			ContentSize:           entry.ContentLength,
			ContentReference:      entry.ContentID,
			Classification:        entry.Classification,
			RequiredGrantAudience: entry.RequiredGrantAudience,
			ContentBytes:          append([]byte(nil), entry.Content...),
		}); err != nil {
			return fmt.Errorf("insert index input bundle entry: %w", err)
		}
	}
	return nil
}

func boundedIndexAdmissionStrings(admission indexingapp.Admission) bool {
	record := admission.Record
	binding := admission.Binding
	values := []string{
		record.IdempotencyScope, record.IdempotencyKey,
		record.InputBundle.ID, record.InputBundle.Version, record.InputBundle.MediaType,
		record.Job.ID, record.Job.CommandID, record.Job.TenantID,
		record.Job.ResourceProjectID, record.Job.ProjectionProjectID,
		record.Job.ActorID, record.Job.CapabilityID, record.Outbox.ID,
		binding.ToolkitConfigurationEntryID, binding.ToolParametersEntryID,
		binding.IndexName, string(binding.Initiator),
	}
	for _, entry := range record.InputBundle.Entries {
		values = append(values, entry.ID, entry.Version, entry.SemanticRole, entry.ContentID, entry.MediaType, entry.Classification, entry.RequiredGrantAudience)
	}
	for _, value := range values {
		if value == "" || len(value) > 256 || strings.ContainsRune(value, '\x00') {
			return false
		}
	}
	for _, optional := range []string{binding.LLMModelEntryID, binding.LLMConfigurationEntryID, binding.MCPTokensEntryID} {
		if len(optional) > 256 || strings.ContainsRune(optional, '\x00') {
			return false
		}
	}
	return true
}

func validateIndexInputManifest(bundle executiondomain.InputBundle) error {
	var manifest runtimev1.ExecutionInputBundleV1
	if err := (proto.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(bundle.Manifest, &manifest); err != nil {
		return fmt.Errorf("%w: index input manifest is not decodable", executiondomain.ErrInvalidInputBundle)
	}
	if manifest.GetInputBundleId() != bundle.ID || manifest.GetImmutableVersion() != bundle.Version || len(manifest.GetEntries()) != len(bundle.Entries) {
		return fmt.Errorf("%w: index input manifest identity mismatch", executiondomain.ErrInvalidInputBundle)
	}
	for index, wireEntry := range manifest.GetEntries() {
		entry := bundle.Entries[index]
		content := wireEntry.GetContent()
		if content == nil || wireEntry.GetEntryId() != entry.ID || wireEntry.GetImmutableVersion() != entry.Version || wireEntry.GetSemanticRole() != entry.SemanticRole || content.GetContentId() != entry.ContentID || content.GetImmutableVersion() != entry.Version || content.GetMediaType() != entry.MediaType || content.GetByteLength() != uint64(entry.ContentLength) || content.GetClassification() != entry.Classification || content.GetRequiredGrantAudience() != entry.RequiredGrantAudience || content.GetDigest().GetAlgorithm() != runtimev1.DigestAlgorithmV1_DIGEST_ALGORITHM_V1_SHA256 || len(content.GetDigest().GetValue()) != len(entry.ContentDigest) || string(content.GetDigest().GetValue()) != string(entry.ContentDigest[:]) {
			return fmt.Errorf("%w: index input manifest entry mismatch", executiondomain.ErrInvalidInputBundle)
		}
	}
	return nil
}

func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func timestamp(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: value, Valid: true}
}

var _ indexingapp.AtomicAdmissionStore = (*IndexIngestJobsRepository)(nil)

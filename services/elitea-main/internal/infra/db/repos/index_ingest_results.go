package repos

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"mime"
	"strconv"
	"strings"

	outputapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/output"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const replayEventIndexIngest = "index.ingest.completed"

type IndexIngestOutputPolicy struct {
	LimitsRevision    string
	ArtifactMediaType string
	MaxArtifactBytes  uint64
}

func (p IndexIngestOutputPolicy) validate() error {
	if p.LimitsRevision == "" || len(p.LimitsRevision) > 256 || strings.ContainsRune(p.LimitsRevision, '\x00') || p.ArtifactMediaType == "" || len(p.ArtifactMediaType) > 256 || p.MaxArtifactBytes == 0 || p.MaxArtifactBytes > math.MaxInt64 {
		return errors.New("index output policy is incomplete")
	}
	if _, _, err := mime.ParseMediaType(p.ArtifactMediaType); err != nil {
		return errors.New("index output artifact media type is invalid")
	}
	return nil
}

type indexIngestReadQueries interface {
	GetExpectedIndexIngestHeader(context.Context, sqlcgen.GetExpectedIndexIngestHeaderParams) (sqlcgen.GetExpectedIndexIngestHeaderRow, error)
	ListExpectedIndexIngestEntries(context.Context, sqlcgen.ListExpectedIndexIngestEntriesParams) ([]sqlcgen.ListExpectedIndexIngestEntriesRow, error)
	GetDurableIndexResultArtifact(context.Context, sqlcgen.GetDurableIndexResultArtifactParams) (sqlcgen.GetDurableIndexResultArtifactRow, error)
}

type IndexIngestResultsRepository struct {
	queries  indexIngestReadQueries
	projects projectStore
	policy   IndexIngestOutputPolicy
}

func NewIndexIngestResultsRepository(pool *pgxpool.Pool, policy IndexIngestOutputPolicy) (*IndexIngestResultsRepository, error) {
	if pool == nil {
		return nil, errors.New("index output database is required")
	}
	projects, err := newPostgresProjectStore(pool)
	if err != nil {
		return nil, err
	}
	return newIndexIngestResultsRepository(sqlcgen.New(pool), projects, policy)
}

func newIndexIngestResultsRepository(queries indexIngestReadQueries, projects projectStore, policy IndexIngestOutputPolicy) (*IndexIngestResultsRepository, error) {
	if queries == nil || projects == nil {
		return nil, errors.New("index output query and project stores are required")
	}
	if err := policy.validate(); err != nil {
		return nil, err
	}
	return &IndexIngestResultsRepository{queries: queries, projects: projects, policy: policy}, nil
}

func (r *IndexIngestResultsRepository) ExpectedIndexIngest(ctx context.Context, executionID string, generation uint64) (outputapp.ExpectedIndexIngest, error) {
	if executionID == "" || generation == 0 || generation > math.MaxInt64 {
		return outputapp.ExpectedIndexIngest{}, outputapp.ErrInvalidIndexIngestOutput
	}
	params := sqlcgen.GetExpectedIndexIngestHeaderParams{ExecutionID: executionID, Generation: int64(generation)}
	header, err := r.queries.GetExpectedIndexIngestHeader(ctx, params)
	if errors.Is(err, pgx.ErrNoRows) {
		return outputapp.ExpectedIndexIngest{}, outputapp.ErrInvalidIndexIngestOutput
	}
	if err != nil {
		return outputapp.ExpectedIndexIngest{}, fmt.Errorf("load index output header: %w", err)
	}
	if header.LimitsRevision != r.policy.LimitsRevision {
		return outputapp.ExpectedIndexIngest{}, fmt.Errorf("index output limits revision %q is not configured", header.LimitsRevision)
	}
	entries, err := r.queries.ListExpectedIndexIngestEntries(ctx, sqlcgen.ListExpectedIndexIngestEntriesParams(params))
	if err != nil {
		return outputapp.ExpectedIndexIngest{}, fmt.Errorf("load index output entries: %w", err)
	}
	expected, err := r.mapExpectedIndexIngest(header, entries)
	if err != nil {
		return outputapp.ExpectedIndexIngest{}, err
	}
	return expected, nil
}

func (r *IndexIngestResultsRepository) mapExpectedIndexIngest(header sqlcgen.GetExpectedIndexIngestHeaderRow, entries []sqlcgen.ListExpectedIndexIngestEntriesRow) (outputapp.ExpectedIndexIngest, error) {
	if header.Generation <= 0 || header.ResourceProjectID <= 0 || header.ProjectionProjectID <= 0 || len(entries) < 2 || len(entries) > executiondomain.MaxInputBundleEntries {
		return outputapp.ExpectedIndexIngest{}, errors.New("stored index output binding is invalid")
	}
	bundleDigest, err := storedDigest(header.InputBundleDigest)
	if err != nil {
		return outputapp.ExpectedIndexIngest{}, fmt.Errorf("stored index input bundle digest: %w", err)
	}
	expected := outputapp.ExpectedIndexIngest{
		TenantID:            header.TenantID,
		ResourceProjectID:   strconv.FormatInt(int64(header.ResourceProjectID), 10),
		ProjectionProjectID: strconv.FormatInt(int64(header.ProjectionProjectID), 10),
		CapabilityID:        header.CapabilityID,
		CommandID:           header.CommandID,
		ExecutionID:         header.ExecutionID,
		Generation:          uint64(header.Generation),
		LogicalOutputID:     "index-ingest:" + header.ExecutionID,
		InputBundleID:       header.InputBundleID,
		InputBundleDigest:   bundleDigest,
	}
	if header.LlmModelEntryID != nil {
		expected.Bindings.LLMModel.Present = true
	}
	if header.LlmConfigurationEntryID != nil {
		expected.Bindings.LLMConfiguration.Present = true
	}
	if header.McpTokensEntryID != nil {
		expected.Bindings.MCPTokens.Present = true
	}

	classification := ""
	for _, entry := range entries {
		binding, err := storedIndexInputBinding(entry)
		if err != nil {
			return outputapp.ExpectedIndexIngest{}, err
		}
		if classification == "" {
			classification = entry.Classification
		} else if classification != entry.Classification {
			return outputapp.ExpectedIndexIngest{}, errors.New("stored index inputs have inconsistent classifications")
		}
		switch {
		case entry.EntryID == header.ToolkitConfigurationEntryID && entry.SemanticRole == executiondomain.IndexToolkitConfigurationRole:
			if expected.Bindings.ToolkitConfiguration != (outputapp.IndexInputBinding{}) {
				return outputapp.ExpectedIndexIngest{}, errors.New("stored toolkit configuration binding is duplicated")
			}
			expected.Bindings.ToolkitConfiguration = binding
		case entry.EntryID == header.ToolParametersEntryID && entry.SemanticRole == executiondomain.IndexToolParametersRole:
			if expected.Bindings.ToolParameters != (outputapp.IndexInputBinding{}) {
				return outputapp.ExpectedIndexIngest{}, errors.New("stored tool parameters binding is duplicated")
			}
			expected.Bindings.ToolParameters = binding
		case header.LlmModelEntryID != nil && entry.EntryID == *header.LlmModelEntryID && entry.SemanticRole == executiondomain.IndexLLMModelRole:
			if expected.Bindings.LLMModel.Binding != (outputapp.IndexInputBinding{}) {
				return outputapp.ExpectedIndexIngest{}, errors.New("stored LLM model binding is duplicated")
			}
			expected.Bindings.LLMModel.Binding = binding
		case header.LlmConfigurationEntryID != nil && entry.EntryID == *header.LlmConfigurationEntryID && entry.SemanticRole == executiondomain.IndexLLMConfigurationRole:
			if expected.Bindings.LLMConfiguration.Binding != (outputapp.IndexInputBinding{}) {
				return outputapp.ExpectedIndexIngest{}, errors.New("stored LLM configuration binding is duplicated")
			}
			expected.Bindings.LLMConfiguration.Binding = binding
		case header.McpTokensEntryID != nil && entry.EntryID == *header.McpTokensEntryID && entry.SemanticRole == executiondomain.IndexMCPTokensRole:
			if expected.Bindings.MCPTokens.Binding != (outputapp.IndexInputBinding{}) {
				return outputapp.ExpectedIndexIngest{}, errors.New("stored MCP token binding is duplicated")
			}
			expected.Bindings.MCPTokens.Binding = binding
		default:
			return outputapp.ExpectedIndexIngest{}, errors.New("stored index input entry is unbound or has the wrong semantic role")
		}
	}
	expected.ArtifactContract = outputapp.IndexArtifactContract{
		MediaType:      r.policy.ArtifactMediaType,
		Classification: classification,
		MaxByteLength:  r.policy.MaxArtifactBytes,
	}
	if err := expected.Validate(); err != nil {
		return outputapp.ExpectedIndexIngest{}, fmt.Errorf("invalid stored index output binding: %w", err)
	}
	return expected, nil
}

func storedIndexInputBinding(entry sqlcgen.ListExpectedIndexIngestEntriesRow) (outputapp.IndexInputBinding, error) {
	digest, err := storedDigest(entry.ContentDigest)
	if err != nil {
		return outputapp.IndexInputBinding{}, fmt.Errorf("stored index input digest: %w", err)
	}
	binding := outputapp.IndexInputBinding{EntryID: entry.EntryID, ImmutableVersion: entry.EntryVersion, ContentDigest: digest}
	if err := binding.Validate(); err != nil {
		return outputapp.IndexInputBinding{}, fmt.Errorf("invalid stored index input binding: %w", err)
	}
	return binding, nil
}

func (r *IndexIngestResultsRepository) VerifyDurable(ctx context.Context, request outputapp.ArtifactVerificationRequest) (outputapp.DurableIndexArtifact, error) {
	if err := request.Validate(); err != nil {
		return outputapp.DurableIndexArtifact{}, err
	}
	if request.Generation > math.MaxInt64 {
		return outputapp.DurableIndexArtifact{}, outputapp.ErrInvalidIndexIngestOutput
	}
	resourceProjectID, err := parseProjectID(request.ResourceProjectID)
	if err != nil || resourceProjectID > math.MaxInt32 {
		return outputapp.DurableIndexArtifact{}, outputapp.ErrInvalidIndexIngestOutput
	}
	projectionProjectID, err := parseProjectID(request.ProjectionProjectID)
	if err != nil || projectionProjectID > math.MaxInt32 {
		return outputapp.DurableIndexArtifact{}, outputapp.ErrInvalidIndexIngestOutput
	}
	row, err := r.queries.GetDurableIndexResultArtifact(ctx, sqlcgen.GetDurableIndexResultArtifactParams{
		ArtifactID:          request.Artifact.ArtifactID,
		ImmutableVersion:    request.Artifact.ImmutableVersion,
		ExecutionID:         request.ExecutionID,
		Generation:          int64(request.Generation),
		ResourceProjectID:   int32(resourceProjectID),
		TenantID:            request.TenantID,
		ProjectionProjectID: int32(projectionProjectID),
		CommandID:           request.CommandID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return outputapp.DurableIndexArtifact{}, outputapp.ErrIndexIngestArtifactUnavailable
	}
	if err != nil {
		return outputapp.DurableIndexArtifact{}, fmt.Errorf("load durable index artifact: %w", err)
	}
	if row.ByteLength <= 0 || !row.BytesVerifiedAt.Valid || row.BytesVerifiedAt.Time.IsZero() {
		return outputapp.DurableIndexArtifact{}, outputapp.ErrIndexIngestArtifactUnavailable
	}
	digest, err := storedDigest(row.Digest)
	if err != nil {
		return outputapp.DurableIndexArtifact{}, outputapp.ErrIndexIngestArtifactMismatch
	}
	verified := outputapp.DurableIndexArtifact{
		Reference: outputapp.IndexArtifactReference{
			ArtifactID:       row.ArtifactID,
			ImmutableVersion: row.ImmutableVersion,
			MediaType:        row.MediaType,
			ByteLength:       uint64(row.ByteLength),
			Digest:           digest,
			Classification:   row.Classification,
		},
		StorageRecordID: row.StorageRecordID,
		VerifiedAt:      row.BytesVerifiedAt.Time.UTC(),
	}
	if err := verified.Validate(); err != nil {
		return outputapp.DurableIndexArtifact{}, outputapp.ErrIndexIngestArtifactUnavailable
	}
	return verified, nil
}

func (r *IndexIngestResultsRepository) ProjectIndexIngest(ctx context.Context, projection outputapp.IndexIngestProjection) (outputapp.ProjectionOutcome, error) {
	if err := projection.Frame.Validate(); err != nil {
		return outputapp.ProjectionOutcome{}, err
	}
	hasArtifact := projection.Frame.Result.ResultArtifact != (outputapp.IndexArtifactReference{})
	if hasArtifact {
		if err := projection.VerifiedArtifact.Validate(); err != nil || projection.VerifiedArtifact.Reference != projection.Frame.Result.ResultArtifact || projection.VerifiedArtifact.Reference.ByteLength > math.MaxInt64 {
			return outputapp.ProjectionOutcome{}, outputapp.ErrIndexIngestArtifactMismatch
		}
	} else if projection.VerifiedArtifact != (outputapp.DurableIndexArtifact{}) {
		return outputapp.ProjectionOutcome{}, outputapp.ErrIndexIngestArtifactMismatch
	}
	record, projectID, err := indexOutputRecord(projection.Frame)
	if err != nil {
		return outputapp.ProjectionOutcome{}, err
	}
	browserData, err := indexReplayData(projection.Frame.Result)
	if err != nil {
		return outputapp.ProjectionOutcome{}, err
	}

	var outcome outputapp.ProjectionOutcome
	cancellationWon := false
	err = r.projects.WithinProjectTx(ctx, projectID, pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadWrite}, func(tx sqlExecutor) error {
		existing, err := loadExistingOutput(ctx, tx, record)
		if err == nil {
			switch {
			case sameDurableOutput(existing, record):
				cursor, cursorErr := replayCursor(ctx, tx, record.EventID)
				if cursorErr != nil {
					return fmt.Errorf("load replayed index cursor: %w", cursorErr)
				}
				outcome = outputapp.ProjectionOutcome{Inserted: false, Cursor: cursor, CommittedSequence: record.Sequence}
				return nil
			case sameCanonicalCancellation(existing, record):
				if err := persistCurrentIndexMetaTerminalIntent(ctx, tx, existing); err != nil {
					return indexProjectionError(err)
				}
				if _, cursorErr := replayCursor(ctx, tx, record.EventID); cursorErr != nil {
					return fmt.Errorf("load materialized index cancellation cursor: %w", cursorErr)
				}
				cancellationWon = true
				return nil
			default:
				return outputapp.ErrIndexIngestOutputConflict
			}
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return indexProjectionError(err)
		}

		insertResult, err := insertOutputInbox(ctx, tx, record)
		if err != nil {
			return indexProjectionError(err)
		}
		if !insertResult.Inserted {
			existing, loadErr := loadExistingOutput(ctx, tx, record)
			if loadErr == nil {
				switch {
				case sameDurableOutput(existing, record):
					cursor, cursorErr := replayCursor(ctx, tx, record.EventID)
					if cursorErr != nil {
						return cursorErr
					}
					outcome = outputapp.ProjectionOutcome{Inserted: false, Cursor: cursor, CommittedSequence: record.Sequence}
					return nil
				case sameCanonicalCancellation(existing, record):
					if err := persistCurrentIndexMetaTerminalIntent(ctx, tx, existing); err != nil {
						return indexProjectionError(err)
					}
					if _, cursorErr := replayCursor(ctx, tx, record.EventID); cursorErr != nil {
						return cursorErr
					}
					cancellationWon = true
					return nil
				default:
					return outputapp.ErrIndexIngestOutputConflict
				}
			}
			if errors.Is(loadErr, pgx.ErrNoRows) {
				if insertResult.CancellationRejected {
					if err := materializeCanonicalCancellation(ctx, tx, record); err != nil {
						return indexProjectionError(err)
					}
					cancellationWon = true
					return nil
				}
				if insertResult.DeadlineRejected {
					return outputapp.ErrOutputDeadlineExceeded
				}
				return runtimedomain.ErrStaleFence
			}
			return indexProjectionError(loadErr)
		}

		if err := insertIndexIngestProjection(ctx, tx, projection, record); err != nil {
			return err
		}
		cursor, err := appendReplayEvent(ctx, tx, record, replayEventIndexIngest, browserData)
		if err != nil {
			return err
		}
		if err := markOutputProjected(ctx, tx, record.EventID); err != nil {
			return err
		}
		outcome = outputapp.ProjectionOutcome{Inserted: true, Cursor: cursor, CommittedSequence: record.Sequence}
		return nil
	})
	if err != nil {
		return outputapp.ProjectionOutcome{}, err
	}
	if cancellationWon {
		return outputapp.ProjectionOutcome{}, outputapp.ErrOutputCancelled
	}
	return outcome, nil
}

func indexOutputRecord(frame outputapp.IndexIngestFrame) (outputRecord, int64, error) {
	resourceProjectID, err := parseProjectID(frame.ResourceProjectID)
	if err != nil {
		return outputRecord{}, 0, outputapp.ErrInvalidIndexIngestOutput
	}
	projectionProjectID, err := parseProjectID(frame.ProjectionProjectID)
	if err != nil {
		return outputRecord{}, 0, outputapp.ErrInvalidIndexIngestOutput
	}
	return frameOutputRecord(
		frame.EventID, frame.LogicalOutputID, frame.StreamID, frame.TenantID,
		resourceProjectID, projectionProjectID, frame.Sequence,
		frame.ClaimHandoffWatermark, frame.OccurredAt, frame.Fence,
		payloadTypeIndexIngestResult, frame.PayloadDigest, frame.EncodedResult,
		frame.Settlement, frame.EncodedSettlement,
	), projectionProjectID, nil
}

func insertIndexIngestProjection(ctx context.Context, tx sqlExecutor, projection outputapp.IndexIngestProjection, record outputRecord) error {
	artifact := projection.VerifiedArtifact
	result := projection.Frame.Result
	if result.ResultSummary != (outputapp.IndexIngestSummary{}) {
		return insertIndexIngestSummaryProjection(ctx, tx, result, record)
	}
	var logicalOutputID string
	err := tx.QueryRow(ctx, `
INSERT INTO elitea_runtime.index_ingest_results (
    logical_output_id, execution_id, generation, input_bundle_id,
    input_bundle_digest, artifact_id, artifact_immutable_version,
    artifact_storage_record_id
)
SELECT $1, $2, $3, b.input_bundle_id, b.manifest_digest,
       a.artifact_id, a.immutable_version, a.storage_record_id
FROM elitea_runtime.input_bundles AS b
JOIN elitea_runtime.index_result_artifacts AS a
  ON a.artifact_id = $6
 AND a.immutable_version = $7
WHERE b.input_bundle_id = $4
  AND b.manifest_digest = $5
  AND a.execution_id = $2
  AND a.generation = $3
  AND a.resource_project_id = $8
  AND a.media_type = $9
  AND a.byte_length = $10
  AND a.digest = $11
  AND a.classification = $12
  AND a.storage_record_id = $13
  AND a.bytes_verified_at = $14
RETURNING logical_output_id`,
		record.LogicalOutputID,
		record.ExecutionID,
		int64(record.Generation),
		result.InputBundleID,
		result.InputBundleDigest[:],
		artifact.Reference.ArtifactID,
		artifact.Reference.ImmutableVersion,
		record.ResourceProjectID,
		artifact.Reference.MediaType,
		int64(artifact.Reference.ByteLength),
		artifact.Reference.Digest[:],
		artifact.Reference.Classification,
		artifact.StorageRecordID,
		artifact.VerifiedAt.UTC(),
	).Scan(&logicalOutputID)
	if errors.Is(err, pgx.ErrNoRows) {
		return outputapp.ErrIndexIngestArtifactUnavailable
	}
	if err != nil {
		return fmt.Errorf("insert index ingest projection: %w", err)
	}
	if logicalOutputID != record.LogicalOutputID {
		return outputapp.ErrIndexIngestOutputConflict
	}
	return nil
}

func insertIndexIngestSummaryProjection(ctx context.Context, tx sqlExecutor, result outputapp.IndexIngestResult, record outputRecord) error {
	var logicalOutputID string
	err := tx.QueryRow(ctx, `
INSERT INTO elitea_runtime.index_ingest_results (
    logical_output_id, execution_id, generation, input_bundle_id,
    input_bundle_digest, completion_status, completion_message
)
SELECT $1, $2, $3, b.input_bundle_id, b.manifest_digest, $6, $7
FROM elitea_runtime.input_bundles AS b
WHERE b.input_bundle_id = $4
  AND b.manifest_digest = $5
RETURNING logical_output_id`,
		record.LogicalOutputID,
		record.ExecutionID,
		int64(record.Generation),
		result.InputBundleID,
		result.InputBundleDigest[:],
		string(result.ResultSummary.Status),
		result.ResultSummary.Message,
	).Scan(&logicalOutputID)
	if errors.Is(err, pgx.ErrNoRows) {
		return outputapp.ErrIndexIngestBindingMismatch
	}
	if err != nil {
		return fmt.Errorf("insert index ingest summary projection: %w", err)
	}
	if logicalOutputID != record.LogicalOutputID {
		return outputapp.ErrIndexIngestOutputConflict
	}
	return nil
}

func indexReplayData(result outputapp.IndexIngestResult) ([]byte, error) {
	var value any
	if result.ResultSummary != (outputapp.IndexIngestSummary{}) {
		value = struct {
			Status  outputapp.IndexIngestStatus `json:"status"`
			Message string                      `json:"message"`
		}{Status: result.ResultSummary.Status, Message: result.ResultSummary.Message}
	} else {
		artifact := result.ResultArtifact
		value = struct {
			ArtifactID       string `json:"artifact_id"`
			ImmutableVersion string `json:"immutable_version"`
			MediaType        string `json:"media_type"`
			ByteLength       uint64 `json:"byte_length"`
			Digest           string `json:"digest"`
			Classification   string `json:"classification"`
		}{
			ArtifactID:       artifact.ArtifactID,
			ImmutableVersion: artifact.ImmutableVersion,
			MediaType:        artifact.MediaType,
			ByteLength:       artifact.ByteLength,
			Digest:           artifact.Digest.String(),
			Classification:   artifact.Classification,
		}
	}
	data, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("encode safe index replay event: %w", err)
	}
	if len(data) == 0 || len(data) > outputapp.MaxIndexIngestResultBytes {
		return nil, outputapp.ErrInvalidIndexIngestOutput
	}
	return data, nil
}

func indexProjectionError(err error) error {
	if errors.Is(err, outputapp.ErrValidationOutputConflict) {
		return outputapp.ErrIndexIngestOutputConflict
	}
	return err
}

var _ outputapp.IndexIngestBindingRepository = (*IndexIngestResultsRepository)(nil)
var _ outputapp.ArtifactVerifier = (*IndexIngestResultsRepository)(nil)
var _ outputapp.IndexIngestProjector = (*IndexIngestResultsRepository)(nil)

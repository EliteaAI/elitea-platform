package repos

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"time"

	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CurrentIndexMetaTaskRestampRepository owns only immutable restamp intents and
// their frozen admission binding. It never reads browser-event identity.
type CurrentIndexMetaTaskRestampRepository struct {
	store sqlExecutor
}

func NewCurrentIndexMetaTaskRestampRepository(
	pool *pgxpool.Pool,
) (*CurrentIndexMetaTaskRestampRepository, error) {
	store, err := newPostgresSharedStore(pool)
	if err != nil {
		return nil, err
	}
	return newCurrentIndexMetaTaskRestampRepository(store)
}

func newCurrentIndexMetaTaskRestampRepository(
	store sqlExecutor,
) (*CurrentIndexMetaTaskRestampRepository, error) {
	if store == nil {
		return nil, errors.New("current index metadata task restamp database is required")
	}
	return &CurrentIndexMetaTaskRestampRepository{store: store}, nil
}

func (r *CurrentIndexMetaTaskRestampRepository) LoadCurrentIndexMetaTaskRestampBinding(
	ctx context.Context,
	executionID string,
	generation uint64,
) (indexingapp.CurrentIndexMetaTaskRestampBinding, error) {
	if r == nil || r.store == nil || ctx == nil || executionID == "" ||
		generation == 0 || generation > math.MaxInt64 {
		return indexingapp.CurrentIndexMetaTaskRestampBinding{},
			indexingapp.ErrCurrentIndexMetaInitializationInvalid
	}
	var binding indexingapp.CurrentIndexMetaTaskRestampBinding
	var actorID string
	var storedGeneration, storedIndexGeneration int64
	err := r.store.QueryRow(ctx, `
SELECT j.resource_project_id,
       j.actor_id,
       i.toolkit_id,
       i.index_name,
       i.index_meta_id,
       j.execution_id,
       j.generation,
       i.index_generation,
       e.content_bytes
FROM elitea_runtime.execution_jobs AS j
JOIN elitea_runtime.index_ingest_jobs AS i
  ON i.execution_id = j.execution_id
 AND i.generation = j.generation
 AND i.capability_id = j.capability_id
JOIN elitea_runtime.input_bundle_entries AS e
  ON e.input_bundle_id = i.input_bundle_id
 AND e.entry_id = i.toolkit_configuration_entry_id
WHERE j.execution_id = $1
  AND j.generation = $2
  AND j.capability_id = 'index.ingest.v1'
  AND i.index_meta_initialized_at IS NOT NULL
  AND i.index_meta_task_restamp_status = 'PENDING'`,
		executionID,
		int64(generation),
	).Scan(
		&binding.ResourceProjectID,
		&actorID,
		&binding.ToolkitID,
		&binding.IndexName,
		&binding.MetaID,
		&binding.ExecutionID,
		&storedGeneration,
		&storedIndexGeneration,
		&binding.ToolkitConfiguration,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return indexingapp.CurrentIndexMetaTaskRestampBinding{},
			indexingapp.ErrCurrentIndexMetaConflict
	}
	if err != nil {
		return indexingapp.CurrentIndexMetaTaskRestampBinding{},
			fmt.Errorf("load current index metadata task restamp binding: %w", err)
	}
	parsedActorID, err := strconv.ParseInt(actorID, 10, 32)
	if err != nil || parsedActorID <= 0 ||
		storedGeneration <= 0 || storedIndexGeneration <= 0 {
		return indexingapp.CurrentIndexMetaTaskRestampBinding{},
			indexingapp.ErrCurrentIndexMetaInitializationInvalid
	}
	binding.ActorUserID = int32(parsedActorID)
	binding.Generation = uint64(storedGeneration)
	binding.IndexGeneration = uint64(storedIndexGeneration)
	if err := binding.Validate(); err != nil ||
		binding.ExecutionID != executionID ||
		binding.Generation != generation {
		return indexingapp.CurrentIndexMetaTaskRestampBinding{},
			indexingapp.ErrCurrentIndexMetaInitializationInvalid
	}
	return binding, nil
}

func (r *CurrentIndexMetaTaskRestampRepository) ClaimPendingTaskRestamps(
	ctx context.Context,
	claimToken string,
	limit int,
	lease time.Duration,
) ([]indexingapp.CurrentIndexMetaTaskRestampClaim, error) {
	if r == nil || r.store == nil || ctx == nil ||
		!validTerminalClaimToken(claimToken) ||
		limit <= 0 || limit > executionapp.MaxOutboxPublisherBatchSize ||
		lease <= 0 || lease > 10*time.Minute {
		return nil, executionapp.ErrInvalidPendingOutboxLimit
	}
	rows, err := r.store.Query(ctx, `
WITH candidates AS (
    SELECT i.execution_id,
           i.generation,
           i.index_meta_task_restamp_source_event_id,
           i.index_meta_task_restamp_occurred_at,
           i.index_meta_task_restamp_created_on
    FROM elitea_runtime.index_ingest_jobs AS i
    WHERE i.capability_id = 'index.ingest.v1'
      AND i.index_meta_initialized_at IS NOT NULL
      AND i.index_meta_task_restamp_status = 'PENDING'
      AND i.index_meta_task_restamp_next_attempt_at <= clock_timestamp()
      AND (
          i.index_meta_task_restamp_claim_expires_at IS NULL
          OR i.index_meta_task_restamp_claim_expires_at
                <= clock_timestamp()
      )
    ORDER BY i.index_meta_task_restamp_next_attempt_at,
             i.execution_id,
             i.generation
    LIMIT $1
    FOR UPDATE OF i SKIP LOCKED
),
claimed AS (
    UPDATE elitea_runtime.index_ingest_jobs AS i
    SET index_meta_task_restamp_claim_token = $2,
        index_meta_task_restamp_claim_expires_at =
            clock_timestamp() + ($3::bigint * interval '1 microsecond'),
        index_meta_task_restamp_attempt_count =
            LEAST(
                COALESCE(i.index_meta_task_restamp_attempt_count, 0)::bigint + 1,
                2147483647
            )::integer,
        index_meta_task_restamp_last_error_code = NULL
    FROM candidates
    WHERE i.execution_id = candidates.execution_id
      AND i.generation = candidates.generation
    RETURNING i.execution_id,
              i.generation,
              i.index_meta_task_restamp_source_event_id,
              i.index_meta_task_restamp_occurred_at,
              i.index_meta_task_restamp_created_on
)
SELECT execution_id,
       generation,
       index_meta_task_restamp_source_event_id,
       index_meta_task_restamp_occurred_at,
       index_meta_task_restamp_created_on
FROM claimed
ORDER BY index_meta_task_restamp_occurred_at,
         execution_id,
         generation`,
		int32(limit),
		claimToken,
		lease.Microseconds(),
	)
	if err != nil {
		return nil, fmt.Errorf("claim current index metadata task restamps: %w", err)
	}
	defer rows.Close()

	claims := make([]indexingapp.CurrentIndexMetaTaskRestampClaim, 0, limit)
	for rows.Next() {
		var claim indexingapp.CurrentIndexMetaTaskRestampClaim
		var generation int64
		if err := rows.Scan(
			&claim.ExecutionID,
			&generation,
			&claim.SourceEventID,
			&claim.OccurredAt,
			&claim.CreatedOn,
		); err != nil {
			return nil, fmt.Errorf("scan current index metadata task restamp: %w", err)
		}
		if generation <= 0 {
			return nil, indexingapp.ErrCurrentIndexMetaInitializationInvalid
		}
		claim.Generation = uint64(generation)
		claim.OccurredAt = claim.OccurredAt.UTC()
		claim.ClaimToken = claimToken
		if err := claim.Validate(); err != nil {
			return nil, err
		}
		claims = append(claims, claim)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate current index metadata task restamps: %w", err)
	}
	return claims, nil
}

func (r *CurrentIndexMetaTaskRestampRepository) SupersedeTaskRestampIfNewerInitialized(
	ctx context.Context,
	claim indexingapp.CurrentIndexMetaTaskRestampClaim,
) (bool, error) {
	if r == nil || r.store == nil || ctx == nil {
		return false, indexingapp.ErrCurrentIndexMetaInitializationInvalid
	}
	if err := claim.Validate(); err != nil {
		return false, err
	}
	var owned, superseded bool
	err := r.store.QueryRow(ctx, `
WITH stale AS MATERIALIZED (
    SELECT i.execution_id,
           i.generation,
           i.toolkit_id,
           i.index_name,
           i.index_generation,
           j.resource_project_id,
           j.admitted_at
    FROM elitea_runtime.index_ingest_jobs AS i
    JOIN elitea_runtime.execution_jobs AS j
      ON j.execution_id = i.execution_id
     AND j.generation = i.generation
     AND j.capability_id = i.capability_id
    WHERE i.execution_id = $1
      AND i.generation = $2
      AND i.capability_id = 'index.ingest.v1'
      AND i.index_meta_initialized_at IS NOT NULL
      AND i.index_meta_task_restamp_source_event_id = $3
      AND i.index_meta_task_restamp_occurred_at = $4
      AND i.index_meta_task_restamp_created_on = $5
      AND i.index_meta_task_restamp_status = 'PENDING'
      AND i.index_meta_task_restamp_claim_token = $6
),
resolved AS (
    UPDATE elitea_runtime.index_ingest_jobs AS i
    SET index_meta_task_restamp_status = 'SUPERSEDED',
        index_meta_task_restamp_claim_token = NULL,
        index_meta_task_restamp_claim_expires_at = NULL,
        index_meta_task_restamp_next_attempt_at = NULL,
        index_meta_task_restamp_last_error_code = NULL,
        index_meta_task_restamped_at =
            COALESCE(i.index_meta_task_restamped_at, clock_timestamp())
    FROM stale
    WHERE i.execution_id = stale.execution_id
      AND i.generation = stale.generation
      AND EXISTS (
          SELECT 1
          FROM elitea_runtime.execution_jobs AS newer_job
          JOIN elitea_runtime.index_ingest_jobs AS newer_index
            ON newer_index.execution_id = newer_job.execution_id
           AND newer_index.generation = newer_job.generation
           AND newer_index.capability_id = newer_job.capability_id
          WHERE newer_job.resource_project_id = stale.resource_project_id
            AND newer_job.capability_id = 'index.ingest.v1'
            AND newer_index.toolkit_id = stale.toolkit_id
            AND newer_index.index_name = stale.index_name
            AND newer_index.index_meta_initialized_at IS NOT NULL
            AND (
                newer_index.index_generation > stale.index_generation
                OR (
                    newer_index.index_generation = stale.index_generation
                    AND (newer_job.admitted_at, newer_job.execution_id)
                        > (stale.admitted_at, stale.execution_id)
                )
            )
      )
    RETURNING 1
)
SELECT EXISTS (SELECT 1 FROM stale),
       EXISTS (SELECT 1 FROM resolved)`,
		claim.ExecutionID,
		int64(claim.Generation),
		claim.SourceEventID,
		claim.OccurredAt.UTC(),
		claim.CreatedOn,
		claim.ClaimToken,
	).Scan(&owned, &superseded)
	if err != nil {
		return false, fmt.Errorf("supersede current index metadata task restamp: %w", err)
	}
	if !owned {
		return false, indexingapp.ErrCurrentIndexMetaConflict
	}
	return superseded, nil
}

func (r *CurrentIndexMetaTaskRestampRepository) ResolveTaskRestamp(
	ctx context.Context,
	claim indexingapp.CurrentIndexMetaTaskRestampClaim,
	resolution indexingapp.CurrentIndexMetaTaskRestampResolution,
) error {
	if r == nil || r.store == nil || ctx == nil {
		return indexingapp.ErrCurrentIndexMetaInitializationInvalid
	}
	if err := claim.Validate(); err != nil ||
		(resolution != indexingapp.CurrentIndexMetaTaskRestampApplied &&
			resolution != indexingapp.CurrentIndexMetaTaskRestampSuperseded) {
		return indexingapp.ErrCurrentIndexMetaInitializationInvalid
	}
	tag, err := r.store.Exec(ctx, `
UPDATE elitea_runtime.index_ingest_jobs
SET index_meta_task_restamp_status = $7,
    index_meta_task_restamp_claim_token = NULL,
    index_meta_task_restamp_claim_expires_at = NULL,
    index_meta_task_restamp_next_attempt_at = NULL,
    index_meta_task_restamp_last_error_code = NULL,
    index_meta_task_restamped_at =
        COALESCE(index_meta_task_restamped_at, clock_timestamp())
WHERE execution_id = $1
  AND generation = $2
  AND capability_id = 'index.ingest.v1'
  AND index_meta_task_restamp_source_event_id = $3
  AND index_meta_task_restamp_occurred_at = $4
  AND index_meta_task_restamp_created_on = $5
  AND index_meta_task_restamp_status = 'PENDING'
  AND index_meta_task_restamp_claim_token = $6`,
		claim.ExecutionID,
		int64(claim.Generation),
		claim.SourceEventID,
		claim.OccurredAt.UTC(),
		claim.CreatedOn,
		claim.ClaimToken,
		string(resolution),
	)
	if err != nil {
		return fmt.Errorf("resolve current index metadata task restamp: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return indexingapp.ErrCurrentIndexMetaConflict
	}
	return nil
}

func (r *CurrentIndexMetaTaskRestampRepository) ReleaseTaskRestamp(
	ctx context.Context,
	claim indexingapp.CurrentIndexMetaTaskRestampClaim,
	errorCode string,
) error {
	if r == nil || r.store == nil || ctx == nil ||
		claim.Validate() != nil || !validTerminalErrorCode(errorCode) {
		return indexingapp.ErrCurrentIndexMetaInitializationInvalid
	}
	tag, err := r.store.Exec(ctx, `
UPDATE elitea_runtime.index_ingest_jobs
SET index_meta_task_restamp_claim_token = NULL,
    index_meta_task_restamp_claim_expires_at = NULL,
    index_meta_task_restamp_next_attempt_at =
        clock_timestamp()
        + (
            LEAST(
                30,
                (1::bigint <<
                    LEAST(index_meta_task_restamp_attempt_count, 5))
            ) * interval '1 second'
        ),
    index_meta_task_restamp_last_error_code = $4
WHERE execution_id = $1
  AND generation = $2
  AND capability_id = 'index.ingest.v1'
  AND index_meta_task_restamp_status = 'PENDING'
  AND index_meta_task_restamp_claim_token = $3`,
		claim.ExecutionID,
		int64(claim.Generation),
		claim.ClaimToken,
		errorCode,
	)
	if err != nil {
		return fmt.Errorf("release current index metadata task restamp: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return indexingapp.ErrCurrentIndexMetaConflict
	}
	return nil
}

var _ indexingapp.CurrentIndexMetaTaskRestampBindingRepository = (*CurrentIndexMetaTaskRestampRepository)(nil)

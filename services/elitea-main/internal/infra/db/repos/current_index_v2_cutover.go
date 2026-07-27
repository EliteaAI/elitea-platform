package repos

import (
	"context"
	"errors"
	"fmt"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/cutover"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CurrentIndexV2CutoverRepository reads the authoritative persisted version-1
// state. Terminal jobs are retained for audit, but an unretired outbox or
// unreleased claim still blocks the coordinated capability cutover.
type CurrentIndexV2CutoverRepository struct {
	pool *pgxpool.Pool
}

func NewCurrentIndexV2CutoverRepository(pool *pgxpool.Pool) (*CurrentIndexV2CutoverRepository, error) {
	if pool == nil {
		return nil, errors.New("index v2 cutover PostgreSQL pool is required")
	}
	return &CurrentIndexV2CutoverRepository{pool: pool}, nil
}

func (r *CurrentIndexV2CutoverRepository) ReadIndexV1CutoverState(
	ctx context.Context,
) (cutover.IndexV1PersistedState, error) {
	if ctx == nil {
		return cutover.IndexV1PersistedState{}, errors.New("index v2 cutover context is required")
	}
	if err := ctx.Err(); err != nil {
		return cutover.IndexV1PersistedState{}, err
	}
	var state cutover.IndexV1PersistedState
	err := r.pool.QueryRow(ctx, `
SELECT
    (
        SELECT count(*)
        FROM elitea_runtime.execution_jobs AS job
        WHERE job.capability_id = 'index.ingest.v1'
          AND job.capability_version = '1'
          AND job.state IN ('PENDING', 'DISPATCHED', 'CLAIMED', 'RUNNING', 'SETTLING')
    ) AS live_jobs,
    (
        SELECT count(*)
        FROM elitea_runtime.command_outbox AS outbox
        JOIN elitea_runtime.execution_jobs AS job
          ON job.execution_id = outbox.execution_id
         AND job.generation = outbox.generation
        WHERE job.capability_id = 'index.ingest.v1'
          AND job.capability_version = '1'
          AND outbox.retired_at IS NULL
    ) AS outstanding_outbox,
    (
        SELECT count(*)
        FROM elitea_runtime.execution_claims AS claim
        JOIN elitea_runtime.execution_jobs AS job
          ON job.execution_id = claim.execution_id
         AND job.generation = claim.generation
        WHERE job.capability_id = 'index.ingest.v1'
          AND job.capability_version = '1'
          AND claim.released_at IS NULL
    ) AS active_claims`,
	).Scan(
		&state.LiveJobs,
		&state.OutstandingOutbox,
		&state.ActiveClaims,
	)
	if err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return cutover.IndexV1PersistedState{}, contextErr
		}
		return cutover.IndexV1PersistedState{}, fmt.Errorf("query persisted index v1 cutover state: %w", err)
	}
	return state, nil
}

var _ cutover.IndexV1PersistedStateReader = (*CurrentIndexV2CutoverRepository)(nil)

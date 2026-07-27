package repos

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

type replayPruneCandidate struct {
	executionID         string
	generation          int64
	projectionProjectID int64
}

// PruneExpiredReplayProgress performs one bounded maintenance pass. It deletes
// only nonterminal browser progress and advances the same replay watermark used
// by reconnect reset events. Terminal outcomes remain in the durable replay log.
func (r *NodeEventsRepository) PruneExpiredReplayProgress(ctx context.Context) (int64, error) {
	rows, err := r.store.Query(ctx, `
SELECT execution_id, generation, projection_project_id
FROM elitea_runtime.execution_replay_events
WHERE event_type = $1
  AND created_at
      < clock_timestamp() - ($2::bigint * interval '1 millisecond')
GROUP BY execution_id, generation, projection_project_id
ORDER BY min(created_at), execution_id, generation
LIMIT $3`,
		replayEventNodeEvent,
		r.retention.maxProgressAge.Milliseconds(),
		r.retention.janitorBatchSize,
	)
	if err != nil {
		return 0, fmt.Errorf("query expired replay progress: %w", err)
	}
	candidates := make([]replayPruneCandidate, 0, r.retention.janitorBatchSize)
	for rows.Next() {
		var candidate replayPruneCandidate
		if err := rows.Scan(&candidate.executionID, &candidate.generation, &candidate.projectionProjectID); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan expired replay progress candidate: %w", err)
		}
		candidates = append(candidates, candidate)
	}
	rowsErr := rows.Err()
	rows.Close()
	if rowsErr != nil {
		return 0, fmt.Errorf("iterate expired replay progress candidates: %w", rowsErr)
	}

	var deletedTotal int64
	for _, candidate := range candidates {
		err := r.store.WithinTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadWrite}, func(tx sqlExecutor) error {
			if _, err := lockReplayExecutionState(
				ctx,
				tx,
				candidate.executionID,
				candidate.generation,
				candidate.projectionProjectID,
			); err != nil {
				return err
			}
			var deleted int64
			if err := tx.QueryRow(ctx, `
WITH deleted_progress AS (
    DELETE FROM elitea_runtime.execution_replay_events
    WHERE execution_id = $1
      AND generation = $2
      AND projection_project_id = $3
      AND event_type = $4
      AND created_at
          < clock_timestamp() - ($5::bigint * interval '1 millisecond')
    RETURNING cursor, octet_length(event_bytes) AS event_size
), deleted_summary AS MATERIALIZED (
    SELECT count(*) AS event_count,
           COALESCE(sum(event_size), 0) AS byte_count,
           COALESCE(max(cursor), 0) AS max_cursor
    FROM deleted_progress
), updated_state AS (
    UPDATE elitea_runtime.execution_replay_state AS s
    SET pruned_through_cursor = greatest(
            s.pruned_through_cursor,
            deleted_summary.max_cursor
        ),
        retained_progress_events =
            s.retained_progress_events - deleted_summary.event_count,
        retained_progress_bytes =
            s.retained_progress_bytes - deleted_summary.byte_count,
        updated_at = CASE
            WHEN deleted_summary.event_count > 0
                THEN clock_timestamp()
            ELSE s.updated_at
        END
    FROM deleted_summary
    WHERE s.execution_id = $1
      AND s.generation = $2
      AND s.projection_project_id = $3
    RETURNING deleted_summary.event_count
)
SELECT COALESCE((SELECT event_count FROM updated_state), 0)`,
				candidate.executionID,
				candidate.generation,
				candidate.projectionProjectID,
				replayEventNodeEvent,
				r.retention.maxProgressAge.Milliseconds(),
			).Scan(&deleted); err != nil {
				return fmt.Errorf("prune expired execution replay progress: %w", err)
			}
			if deleted < 0 {
				return fmt.Errorf("prune expired execution replay progress returned an invalid count")
			}
			deletedTotal += deleted
			return nil
		})
		if err != nil {
			return deletedTotal, err
		}
	}
	return deletedTotal, nil
}

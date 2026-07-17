package repos

import (
	"context"
	"encoding/json"
	"fmt"
	"math"

	executionsapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/executions"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
	"github.com/jackc/pgx/v5/pgxpool"
)

const maxReplayBatch = 100

type ReplayEventsRepository struct {
	store sqlExecutor
}

func NewReplayEventsRepository(pool *pgxpool.Pool) (*ReplayEventsRepository, error) {
	store, err := newPostgresSharedStore(pool)
	if err != nil {
		return nil, err
	}
	return &ReplayEventsRepository{store: store}, nil
}

func newReplayEventsRepository(store sqlExecutor) *ReplayEventsRepository {
	return &ReplayEventsRepository{store: store}
}

func (r *ReplayEventsRepository) Replay(ctx context.Context, projectID, executionID string, afterCursor uint64, limit int) ([]executionsapi.DurableEvent, error) {
	projectionProjectID, err := parseProjectID(projectID)
	if err != nil || executionID == "" || afterCursor > math.MaxInt64 || limit <= 0 || limit > maxReplayBatch {
		return nil, executionsapi.ErrInvalidEventStream
	}
	rows, err := r.store.Query(ctx, `
SELECT cursor, event_type, event_bytes, event_digest
FROM elitea_runtime.execution_replay_events
WHERE projection_project_id = $1
  AND execution_id = $2
  AND cursor > $3
ORDER BY cursor
LIMIT $4`, projectionProjectID, executionID, int64(afterCursor), limit)
	if err != nil {
		return nil, fmt.Errorf("query durable execution replay: %w", err)
	}
	defer rows.Close()

	events := make([]executionsapi.DurableEvent, 0, limit)
	for rows.Next() {
		var cursor int64
		var event executionsapi.DurableEvent
		var digestBytes []byte
		if err := rows.Scan(&cursor, &event.Type, &event.Data, &digestBytes); err != nil {
			return nil, fmt.Errorf("scan durable execution replay: %w", err)
		}
		if cursor <= 0 || len(event.Data) == 0 || len(event.Data) > 64*1024 || !json.Valid(event.Data) {
			return nil, executionsapi.ErrInvalidEventStream
		}
		digest, err := storedDigest(digestBytes)
		if err != nil || runtimedomain.SHA256(event.Data) != digest {
			return nil, executionsapi.ErrInvalidEventStream
		}
		event.Cursor = uint64(cursor)
		event.Data = append(json.RawMessage(nil), event.Data...)
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate durable execution replay: %w", err)
	}
	if events == nil {
		return []executionsapi.DurableEvent{}, nil
	}
	return events, nil
}

var _ executionsapi.EventRepository = (*ReplayEventsRepository)(nil)

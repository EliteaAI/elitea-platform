package repos

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"math"

	outputapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/output"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const replayEventNodeEvent = "execution.node_event"

// NodeEventsRepository appends current-NodeEvent JSON directly to the durable
// execution replay log. Redis is deliberately absent from this data path.
type NodeEventsRepository struct {
	store sharedStore
}

func NewNodeEventsRepository(pool *pgxpool.Pool) (*NodeEventsRepository, error) {
	store, err := newPostgresSharedStore(pool)
	if err != nil {
		return nil, err
	}
	return &NodeEventsRepository{store: store}, nil
}

func newNodeEventsRepository(store sharedStore) (*NodeEventsRepository, error) {
	if store == nil {
		return nil, errors.New("node event database is required")
	}
	return &NodeEventsRepository{store: store}, nil
}

type durableNodeEvent struct {
	Cursor              int64
	ExecutionID         string
	Generation          int64
	ProjectionProjectID int64
	EventType           string
	EventBytes          []byte
	EventDigest         runtimedomain.Digest
}

func (r *NodeEventsRepository) ProjectNodeEvent(ctx context.Context, frame outputapp.NodeEventFrame) (outputapp.ProjectionOutcome, error) {
	if err := frame.Validate(); err != nil || frame.Sequence > math.MaxInt64 || frame.Fence.Generation > math.MaxInt64 || frame.Fence.ClaimAttempt > math.MaxInt64 || frame.Fence.LeaseEpoch > math.MaxInt64 {
		return outputapp.ProjectionOutcome{}, outputapp.ErrInvalidNodeEventOutput
	}
	resourceProjectID, err := parseProjectID(frame.ResourceProjectID)
	if err != nil {
		return outputapp.ProjectionOutcome{}, outputapp.ErrInvalidNodeEventOutput
	}
	projectionProjectID, err := parseProjectID(frame.ProjectionProjectID)
	if err != nil {
		return outputapp.ProjectionOutcome{}, outputapp.ErrInvalidNodeEventOutput
	}
	eventDigest := runtimedomain.SHA256(frame.BrowserData)

	var outcome outputapp.ProjectionOutcome
	err = r.store.WithinTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadWrite}, func(tx sqlExecutor) error {
		existing, loadErr := loadDurableNodeEvent(ctx, tx, frame.EventID)
		if loadErr == nil {
			if !sameDurableNodeEvent(existing, frame, projectionProjectID, eventDigest) {
				return outputapp.ErrNodeEventOutputConflict
			}
			outcome = outputapp.ProjectionOutcome{Inserted: false, Cursor: uint64(existing.Cursor), CommittedSequence: frame.Sequence}
			return nil
		}
		if !errors.Is(loadErr, pgx.ErrNoRows) {
			return fmt.Errorf("load durable node event: %w", loadErr)
		}
		// Keep the authority lock in its own READ COMMITTED statement. A query
		// that waits for this lock retains its original statement snapshot; the
		// following statement must take a fresh snapshot of sequence/terminal rows.
		locked, lockErr := lockNodeEventAuthority(ctx, tx, frame, resourceProjectID, projectionProjectID)
		if lockErr != nil {
			return lockErr
		}
		if !locked {
			return runtimedomain.ErrStaleFence
		}

		var cursor int64
		var authorityClaimID, desiredState string
		var deadlineExpired, sequenceReady, terminalPresent bool
		err := tx.QueryRow(ctx, `
WITH authority AS MATERIALIZED (
    SELECT c.claim_id, j.desired_state,
           o.deadline <= clock_timestamp() AS deadline_expired
    FROM elitea_runtime.execution_claims AS c
    JOIN elitea_runtime.execution_jobs AS j
      ON j.execution_id = c.execution_id AND j.generation = c.generation
    JOIN elitea_runtime.command_outbox AS o
      ON o.execution_id = j.execution_id AND o.generation = j.generation
    WHERE c.execution_id = $2
      AND c.generation = $3
	  AND j.capability_id = 'index.ingest.v1'
      AND j.tenant_id = $8
      AND j.resource_project_id = $9
      AND j.projection_project_id = $4
      AND j.command_id = $10
      AND c.workload_identity = $11
      AND c.workload_session_id = $12
      AND c.producer_id = $13
      AND c.claim_attempt = $14
      AND c.lease_epoch = $15
      AND c.fence_token = $16
      AND c.initial_output_watermark = $18
      AND c.released_at IS NULL
      AND c.lease_expires_at > clock_timestamp()
      AND o.retired_at IS NULL
      AND o.authority_granted_at IS NOT NULL
), previous_sequence AS MATERIALIZED (
    SELECT TRUE AS present
    FROM elitea_runtime.execution_replay_events
    WHERE event_id = $10 || ':' || (($17::bigint - 1)::text)
      AND execution_id = $2
      AND generation = $3
      AND event_type = $5
    LIMIT 1
), terminal_output AS MATERIALIZED (
    SELECT TRUE AS present
    FROM elitea_runtime.output_inbox
    WHERE execution_id = $2 AND generation = $3
    LIMIT 1
), inserted AS (
    INSERT INTO elitea_runtime.execution_replay_events (
        event_id, execution_id, generation, projection_project_id,
        event_type, event_bytes, event_digest
    )
    SELECT $1, $2, $3, $4, $5, $6, $7
    FROM authority
    WHERE authority.desired_state = 'RUNNING'
      AND NOT authority.deadline_expired
      AND ($17::bigint = 1 OR EXISTS (SELECT 1 FROM previous_sequence))
      AND NOT EXISTS (SELECT 1 FROM terminal_output)
    ON CONFLICT DO NOTHING
    RETURNING cursor
)
SELECT COALESCE((SELECT cursor FROM inserted LIMIT 1), 0),
       COALESCE((SELECT claim_id FROM authority LIMIT 1), ''),
       COALESCE((SELECT desired_state FROM authority LIMIT 1), ''),
       COALESCE((SELECT deadline_expired FROM authority LIMIT 1), FALSE),
       ($17::bigint = 1 OR EXISTS (SELECT 1 FROM previous_sequence)),
       EXISTS (SELECT 1 FROM terminal_output)`,
			frame.EventID,
			frame.Fence.ExecutionID,
			int64(frame.Fence.Generation),
			projectionProjectID,
			replayEventNodeEvent,
			[]byte(frame.BrowserData),
			eventDigest[:],
			frame.TenantID,
			resourceProjectID,
			frame.Fence.CommandID,
			frame.Fence.WorkloadIdentity,
			frame.Fence.WorkloadSessionID,
			frame.Fence.ProducerID,
			int64(frame.Fence.ClaimAttempt),
			int64(frame.Fence.LeaseEpoch),
			frame.Fence.Token[:],
			int64(frame.Sequence),
			int64(frame.ClaimHandoffWatermark),
		).Scan(&cursor, &authorityClaimID, &desiredState, &deadlineExpired, &sequenceReady, &terminalPresent)
		if err != nil {
			return fmt.Errorf("append durable node event: %w", err)
		}
		if cursor > 0 {
			outcome = outputapp.ProjectionOutcome{Inserted: true, Cursor: uint64(cursor), CommittedSequence: frame.Sequence}
			return nil
		}

		// ON CONFLICT may have waited for a concurrent identical append. Reload
		// after the statement snapshot before classifying the rejection.
		existing, loadErr = loadDurableNodeEvent(ctx, tx, frame.EventID)
		if loadErr == nil {
			if !sameDurableNodeEvent(existing, frame, projectionProjectID, eventDigest) {
				return outputapp.ErrNodeEventOutputConflict
			}
			outcome = outputapp.ProjectionOutcome{Inserted: false, Cursor: uint64(existing.Cursor), CommittedSequence: frame.Sequence}
			return nil
		}
		if !errors.Is(loadErr, pgx.ErrNoRows) {
			return fmt.Errorf("reload durable node event: %w", loadErr)
		}
		if terminalPresent || !sequenceReady {
			return outputapp.ErrNodeEventOutputConflict
		}
		if authorityClaimID == "" {
			return runtimedomain.ErrStaleFence
		}
		if desiredState == string(runtimedomain.DesiredCancelled) {
			return outputapp.ErrOutputCancelled
		}
		if deadlineExpired {
			return outputapp.ErrOutputDeadlineExceeded
		}
		return runtimedomain.ErrStaleFence
	})
	if err != nil {
		return outputapp.ProjectionOutcome{}, err
	}
	return outcome, nil
}

func lockNodeEventAuthority(ctx context.Context, tx sqlExecutor, frame outputapp.NodeEventFrame, resourceProjectID, projectionProjectID int64) (bool, error) {
	var claimID string
	err := tx.QueryRow(ctx, `
SELECT c.claim_id
FROM elitea_runtime.execution_claims AS c
JOIN elitea_runtime.execution_jobs AS j
  ON j.execution_id = c.execution_id AND j.generation = c.generation
JOIN elitea_runtime.command_outbox AS o
  ON o.execution_id = j.execution_id AND o.generation = j.generation
WHERE c.execution_id = $1
  AND c.generation = $2
  AND j.capability_id = 'index.ingest.v1'
  AND j.tenant_id = $3
  AND j.resource_project_id = $4
  AND j.projection_project_id = $5
  AND j.command_id = $6
  AND c.workload_identity = $7
  AND c.workload_session_id = $8
  AND c.producer_id = $9
  AND c.claim_attempt = $10
  AND c.lease_epoch = $11
  AND c.fence_token = $12
  AND c.initial_output_watermark = $13
  AND c.released_at IS NULL
  AND c.lease_expires_at > clock_timestamp()
  AND o.retired_at IS NULL
  AND o.authority_granted_at IS NOT NULL
FOR UPDATE OF j, o, c`,
		frame.Fence.ExecutionID,
		int64(frame.Fence.Generation),
		frame.TenantID,
		resourceProjectID,
		projectionProjectID,
		frame.Fence.CommandID,
		frame.Fence.WorkloadIdentity,
		frame.Fence.WorkloadSessionID,
		frame.Fence.ProducerID,
		int64(frame.Fence.ClaimAttempt),
		int64(frame.Fence.LeaseEpoch),
		frame.Fence.Token[:],
		int64(frame.ClaimHandoffWatermark),
	).Scan(&claimID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("lock node event authority: %w", err)
	}
	if claimID == "" {
		return false, errors.New("lock node event authority returned an empty claim")
	}
	return true, nil
}

func loadDurableNodeEvent(ctx context.Context, tx sqlExecutor, eventID string) (durableNodeEvent, error) {
	var event durableNodeEvent
	var digest []byte
	err := tx.QueryRow(ctx, `
SELECT cursor, execution_id, generation, projection_project_id,
       event_type, event_bytes, event_digest
FROM elitea_runtime.execution_replay_events
WHERE event_id = $1`, eventID).Scan(
		&event.Cursor,
		&event.ExecutionID,
		&event.Generation,
		&event.ProjectionProjectID,
		&event.EventType,
		&event.EventBytes,
		&digest,
	)
	if err != nil {
		return durableNodeEvent{}, err
	}
	if event.Cursor <= 0 || event.Generation <= 0 {
		return durableNodeEvent{}, outputapp.ErrNodeEventOutputConflict
	}
	event.EventDigest, err = storedDigest(digest)
	if err != nil || runtimedomain.SHA256(event.EventBytes) != event.EventDigest {
		return durableNodeEvent{}, outputapp.ErrNodeEventOutputConflict
	}
	return event, nil
}

func sameDurableNodeEvent(existing durableNodeEvent, frame outputapp.NodeEventFrame, projectionProjectID int64, digest runtimedomain.Digest) bool {
	return existing.ExecutionID == frame.Fence.ExecutionID &&
		existing.Generation == int64(frame.Fence.Generation) &&
		existing.ProjectionProjectID == projectionProjectID &&
		existing.EventType == replayEventNodeEvent &&
		existing.EventDigest == digest &&
		bytes.Equal(existing.EventBytes, frame.BrowserData)
}

var _ outputapp.NodeEventProjector = (*NodeEventsRepository)(nil)

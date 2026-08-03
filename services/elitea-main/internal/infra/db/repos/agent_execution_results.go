package repos

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"

	outputapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/output"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AgentExecutionResultsRepository struct {
	projects projectStore
}

func NewAgentExecutionResultsRepository(pool *pgxpool.Pool) (*AgentExecutionResultsRepository, error) {
	projects, err := newPostgresProjectStore(pool)
	if err != nil {
		return nil, err
	}
	return newAgentExecutionResultsRepository(projects)
}

func newAgentExecutionResultsRepository(projects projectStore) (*AgentExecutionResultsRepository, error) {
	if projects == nil {
		return nil, errors.New("agent result project database is required")
	}
	return &AgentExecutionResultsRepository{projects: projects}, nil
}

type currentAgentFullMessage struct {
	Cursor           int64
	Content          string
	ThreadID         string
	References       json.RawMessage
	InvokedSkills    json.RawMessage
	ResponseMetadata json.RawMessage
}

type agentExecutionTerminalNodeEventQuerier interface {
	GetAgentExecutionTerminalNodeEvent(
		context.Context,
		sqlcgen.GetAgentExecutionTerminalNodeEventParams,
	) (sqlcgen.GetAgentExecutionTerminalNodeEventRow, error)
}

func (r *AgentExecutionResultsRepository) ProjectAgentExecution(ctx context.Context, projection outputapp.AgentExecutionProjection) (outputapp.ProjectionOutcome, error) {
	if err := projection.Frame.Validate(); err != nil || projection.Frame.Sequence > math.MaxInt64 {
		return outputapp.ProjectionOutcome{}, err
	}
	record, projectID, err := agentExecutionOutputRecord(projection.Frame)
	if err != nil {
		return outputapp.ProjectionOutcome{}, err
	}
	projectDatabaseID, ok := currentAgentDatabaseID(projectID)
	if !ok {
		return outputapp.ProjectionOutcome{}, outputapp.ErrInvalidAgentExecutionOutput
	}
	var outcome outputapp.ProjectionOutcome
	cancellationWon := false
	err = r.projects.WithinProjectTx(ctx, projectID, pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadWrite}, func(tx sqlExecutor) error {
		fullMessage, err := loadCurrentAgentFullMessage(ctx, tx, projectDatabaseID, projection)
		if err != nil {
			return err
		}
		existing, err := loadExistingOutput(ctx, tx, record)
		if err == nil {
			if sameDurableOutput(existing, record) {
				outcome = outputapp.ProjectionOutcome{Inserted: false, Cursor: uint64(fullMessage.Cursor), CommittedSequence: record.Sequence}
				return nil
			}
			if sameCanonicalCancellation(existing, record) {
				cancellationWon = true
				return nil
			}
			return outputapp.ErrAgentExecutionOutputConflict
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		inserted, err := insertOutputInbox(ctx, tx, record)
		if err != nil {
			return err
		}
		if !inserted.Inserted {
			existing, loadErr := loadExistingOutput(ctx, tx, record)
			if loadErr == nil {
				if sameDurableOutput(existing, record) {
					outcome = outputapp.ProjectionOutcome{Inserted: false, Cursor: uint64(fullMessage.Cursor), CommittedSequence: record.Sequence}
					return nil
				}
				if sameCanonicalCancellation(existing, record) {
					cancellationWon = true
					return nil
				}
				return outputapp.ErrAgentExecutionOutputConflict
			}
			if !errors.Is(loadErr, pgx.ErrNoRows) {
				return loadErr
			}
			if inserted.CancellationRejected {
				if err := materializeCanonicalCancellation(ctx, tx, record, false); err != nil {
					return err
				}
				cancellationWon = true
				return nil
			}
			if inserted.DeadlineRejected {
				return outputapp.ErrOutputDeadlineExceeded
			}
			return runtimedomain.ErrStaleFence
		}
		if err := persistCurrentAgentFullMessage(ctx, tx, projectID, projection.Expected, fullMessage); err != nil {
			return err
		}
		if err := markOutputProjected(ctx, tx, record.EventID); err != nil {
			return err
		}
		outcome = outputapp.ProjectionOutcome{Inserted: true, Cursor: uint64(fullMessage.Cursor), CommittedSequence: record.Sequence}
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

func agentExecutionOutputRecord(frame outputapp.AgentExecutionFrame) (outputRecord, int64, error) {
	resourceProjectID, err := parseProjectID(frame.ResourceProjectID)
	if err != nil {
		return outputRecord{}, 0, outputapp.ErrInvalidAgentExecutionOutput
	}
	projectionProjectID, err := parseProjectID(frame.ProjectionProjectID)
	if err != nil {
		return outputRecord{}, 0, outputapp.ErrInvalidAgentExecutionOutput
	}
	return frameOutputRecord(
		frame.EventID, frame.LogicalOutputID, frame.StreamID, frame.TenantID,
		resourceProjectID, projectionProjectID, frame.Sequence,
		frame.ClaimHandoffWatermark, frame.OccurredAt, frame.Fence,
		payloadTypeAgentExecutionResult, frame.PayloadDigest, frame.EncodedResult,
		frame.Settlement, frame.EncodedSettlement,
	), projectionProjectID, nil
}

func loadCurrentAgentFullMessage(ctx context.Context, tx sqlExecutor, projectID int32, projection outputapp.AgentExecutionProjection) (currentAgentFullMessage, error) {
	frame := projection.Frame
	artifact := frame.Result.ResultArtifact
	queries, ok := tx.(agentExecutionTerminalNodeEventQuerier)
	if !ok {
		return currentAgentFullMessage{}, errors.New("agent execution terminal query is unavailable")
	}
	row, err := queries.GetAgentExecutionTerminalNodeEvent(
		ctx,
		sqlcgen.GetAgentExecutionTerminalNodeEventParams{
			ExecutionID:         frame.Fence.ExecutionID,
			Generation:          int64(frame.Fence.Generation),
			ProjectionProjectID: projectID,
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return currentAgentFullMessage{}, outputapp.ErrAgentExecutionResultMismatch
	}
	if err != nil {
		return currentAgentFullMessage{}, fmt.Errorf("load durable agent full message: %w", err)
	}
	digest, err := storedDigest(row.LastNodeEventDigest)
	if err != nil || row.LastNodeCursor == nil || *row.LastNodeCursor <= 0 || row.LastNodeSequence != int64(frame.Sequence)-1 ||
		len(row.LastNodeEventBytes) != int(artifact.ByteLength) || runtimedomain.SHA256(row.LastNodeEventBytes) != digest || digest != artifact.Digest ||
		artifact.ArtifactID != "node-event:"+frame.Fence.ExecutionID+":full-message" ||
		artifact.ImmutableVersion != "sha256:"+hex.EncodeToString(digest[:]) {
		return currentAgentFullMessage{}, outputapp.ErrAgentExecutionResultMismatch
	}
	var event struct {
		Type                string          `json:"type"`
		StreamID            string          `json:"stream_id"`
		MessageID           string          `json:"message_id"`
		Content             json.RawMessage `json:"content"`
		References          json.RawMessage `json:"references"`
		SIOEvent            string          `json:"sio_event"`
		ExecutionGeneration string          `json:"execution_generation"`
		ResponseMetadata    json.RawMessage `json:"response_metadata"`
	}
	if json.Unmarshal(row.LastNodeEventBytes, &event) != nil || event.Type != "full_message" ||
		event.StreamID != projection.Expected.ClientStreamID || event.MessageID != projection.Expected.ClientMessageID ||
		event.SIOEvent != projection.Expected.SIOEvent || event.ExecutionGeneration != projection.Expected.ClientExecutionGeneration {
		return currentAgentFullMessage{}, outputapp.ErrAgentExecutionResultMismatch
	}
	var content string
	if json.Unmarshal(event.Content, &content) != nil {
		return currentAgentFullMessage{}, outputapp.ErrAgentExecutionResultMismatch
	}
	var metadata struct {
		ThreadID      string          `json:"thread_id"`
		InvokedSkills json.RawMessage `json:"invoked_skills"`
	}
	if json.Unmarshal(event.ResponseMetadata, &metadata) != nil || metadata.ThreadID == "" ||
		len(content) > 4*1024*1024 || strings.ContainsRune(content, '\x00') {
		return currentAgentFullMessage{}, outputapp.ErrAgentExecutionResultMismatch
	}
	return currentAgentFullMessage{
		Cursor:           *row.LastNodeCursor,
		Content:          content,
		ThreadID:         metadata.ThreadID,
		References:       cloneJSONOrDefault(event.References, []byte("[]")),
		InvokedSkills:    cloneJSONOrDefault(metadata.InvokedSkills, []byte("[]")),
		ResponseMetadata: append(json.RawMessage(nil), event.ResponseMetadata...),
	}, nil
}

func persistCurrentAgentFullMessage(ctx context.Context, tx sqlExecutor, projectID int64, expected outputapp.ExpectedAgentExecution, message currentAgentFullMessage) error {
	schema, err := currentProjectSchema(projectID)
	if err != nil {
		return err
	}
	var messageGroupID int64
	err = tx.QueryRow(ctx, fmt.Sprintf(`
SELECT message_group.id
FROM %s AS message_group
JOIN %s AS conversation ON conversation.id = message_group.conversation_id
WHERE message_group.uuid::text = $1
  AND conversation.uuid::text = $2
  AND message_group.task_id = $3
  AND message_group.meta->>'execution_generation' = $4
FOR UPDATE OF message_group`, schema+".chat_message_group", schema+".chat_conversations"),
		expected.ClientMessageID, expected.ClientStreamID, expected.ExecutionID,
		expected.ClientExecutionGeneration,
	).Scan(&messageGroupID)
	if errors.Is(err, pgx.ErrNoRows) {
		return errors.New("current agent response message group is unavailable")
	}
	if err != nil {
		return fmt.Errorf("lock current agent response message group: %w", err)
	}
	var itemID int64
	err = tx.QueryRow(ctx, fmt.Sprintf(`
INSERT INTO %s (uuid, item_type, order_index, meta, message_group_id)
SELECT gen_random_uuid(), 'text_message', count(*), '{}'::jsonb, $1
FROM %s
WHERE message_group_id = $1
RETURNING id`, schema+".chat_message_items", schema+".chat_message_items"), messageGroupID).Scan(&itemID)
	if err != nil {
		return fmt.Errorf("insert current agent text item: %w", err)
	}
	if _, err := tx.Exec(ctx, fmt.Sprintf(`INSERT INTO %s (id, content) VALUES ($1, $2)`, schema+".chat_messages_text"), itemID, message.Content); err != nil {
		return fmt.Errorf("insert current agent text content: %w", err)
	}
	if _, err := tx.Exec(ctx, fmt.Sprintf(`
UPDATE %s
SET is_streaming = FALSE,
    meta = meta || jsonb_build_object(
        'thread_id', $2::text,
        'references', $3::jsonb,
        'is_error', FALSE,
        'error', '',
        'invoked_skills', $4::jsonb
    ),
    updated_at = clock_timestamp()
WHERE id = $1`, schema+".chat_message_group"), messageGroupID, message.ThreadID, []byte(message.References), []byte(message.InvokedSkills)); err != nil {
		return fmt.Errorf("finalize current agent response message group: %w", err)
	}
	return nil
}

func cloneJSONOrDefault(value, fallback []byte) json.RawMessage {
	if len(value) == 0 || !json.Valid(value) {
		return append(json.RawMessage(nil), fallback...)
	}
	return append(json.RawMessage(nil), value...)
}

var _ outputapp.AgentExecutionProjector = (*AgentExecutionResultsRepository)(nil)

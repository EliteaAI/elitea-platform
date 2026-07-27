package repos

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	outputapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/output"
	"github.com/jackc/pgx/v5"
)

const (
	currentActivityMaxTextBytes = 48 * 1024
	currentActivityMaxAttrBytes = 8 * 1024
	currentActivityMaxNameBytes = 2 * 1024
)

type currentIndexActivityProjector interface {
	projectNodeEvent(context.Context, sqlExecutor, int64, outputapp.NodeEventFrame) error
	projectTerminal(context.Context, sqlExecutor, int64, currentIndexActivityTerminal) error
}

type currentIndexActivityTerminal struct {
	ExecutionID string
	Generation  uint64
	OccurredAt  time.Time
	Message     string
	IsError     bool
}

func currentIndexActivityCancellation(record outputRecord) currentIndexActivityTerminal {
	return currentIndexActivityTerminal{
		ExecutionID: record.ExecutionID,
		Generation:  record.Generation,
		OccurredAt:  record.OccurredAt,
		Message:     "Execution was cancelled.",
		IsError:     true,
	}
}

type noopCurrentIndexActivityProjector struct{}

func (noopCurrentIndexActivityProjector) projectNodeEvent(context.Context, sqlExecutor, int64, outputapp.NodeEventFrame) error {
	return nil
}

func (noopCurrentIndexActivityProjector) projectTerminal(context.Context, sqlExecutor, int64, currentIndexActivityTerminal) error {
	return nil
}

type postgresCurrentIndexActivityProjector struct{}

type currentIndexActivityNode struct {
	kind         string
	runID        string
	toolName     string
	text         string
	finishReason string
	stepType     string
	startedAt    time.Time
	finishedAt   *time.Time
	isError      bool
	attrs        []byte
}

func (postgresCurrentIndexActivityProjector) projectNodeEvent(
	ctx context.Context,
	tx sqlExecutor,
	projectID int64,
	frame outputapp.NodeEventFrame,
) error {
	node, ok, err := currentIndexActivityNodeFromFrame(frame)
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}
	groupID, ready, err := ensureCurrentIndexActivityGroup(
		ctx, tx, projectID, frame.Fence.ExecutionID, frame.Fence.Generation, frame.OccurredAt,
	)
	if err != nil || !ready {
		return err
	}
	return upsertCurrentIndexActivityTrace(ctx, tx, projectID, groupID, node)
}

func (postgresCurrentIndexActivityProjector) projectTerminal(
	ctx context.Context,
	tx sqlExecutor,
	projectID int64,
	terminal currentIndexActivityTerminal,
) error {
	if terminal.ExecutionID == "" || terminal.Generation == 0 ||
		terminal.OccurredAt.IsZero() || !validCurrentActivityText(terminal.Message, currentActivityMaxTextBytes) {
		return errors.New("invalid current index Activity terminal")
	}
	groupID, ready, err := ensureCurrentIndexActivityGroup(
		ctx, tx, projectID, terminal.ExecutionID, terminal.Generation, terminal.OccurredAt,
	)
	if err != nil || !ready {
		return err
	}
	schema, err := currentProjectSchema(projectID)
	if err != nil {
		return err
	}
	groupTable := schema + ".chat_message_group"
	itemTable := schema + ".chat_message_items"
	textTable := schema + ".chat_messages_text"
	meta, err := json.Marshal(map[string]any{
		"context":  map[string]any{"included": true, "priority": 1.0, "weight": 1.0},
		"is_error": terminal.IsError,
	})
	if err != nil {
		return fmt.Errorf("encode current index Activity terminal metadata: %w", err)
	}
	tag, err := tx.Exec(ctx, fmt.Sprintf(`
WITH target_group AS MATERIALIZED (
    UPDATE %s
    SET is_streaming = FALSE,
        meta = $2::jsonb,
        updated_at = $3
    WHERE id = $1
    RETURNING id, uuid
),
inserted_item AS (
    INSERT INTO %s (
        uuid, item_type, order_index, meta, created_at, updated_at, message_group_id
    )
    SELECT uuid, 'text_message', 0, '{}'::jsonb, $3, $3, id
    FROM target_group
    ON CONFLICT (uuid) DO NOTHING
    RETURNING id
),
selected_item AS MATERIALIZED (
    SELECT id
    FROM inserted_item
    UNION ALL
    SELECT item.id
    FROM %s AS item
    JOIN target_group AS target
      ON item.uuid = target.uuid
     AND item.message_group_id = target.id
     AND item.item_type = 'text_message'
     AND item.order_index = 0
    WHERE NOT EXISTS (SELECT 1 FROM inserted_item)
),
upserted_text AS (
    INSERT INTO %s (id, content)
    SELECT id, $4
    FROM selected_item
    ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content
    RETURNING id
)
SELECT 1`, groupTable, itemTable, itemTable, textTable),
		groupID,
		meta,
		terminal.OccurredAt.UTC(),
		terminal.Message,
	)
	if err != nil {
		return fmt.Errorf("project current index Activity terminal: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return errors.New("current index Activity terminal was not projected")
	}
	return nil
}

func ensureCurrentIndexActivityGroup(
	ctx context.Context,
	tx sqlExecutor,
	projectID int64,
	executionID string,
	generation uint64,
	occurredAt time.Time,
) (int64, bool, error) {
	if tx == nil || projectID <= 0 || executionID == "" || generation == 0 || occurredAt.IsZero() {
		return 0, false, errors.New("invalid current index Activity binding")
	}
	schema, err := currentProjectSchema(projectID)
	if err != nil {
		return 0, false, err
	}
	conversationTable := schema + ".chat_conversations"
	participantTable := schema + ".chat_participants"
	mappingTable := schema + ".chat_participant_mapping"
	groupTable := schema + ".chat_message_group"

	var indexExecution bool
	err = tx.QueryRow(ctx, `
SELECT EXISTS (
    SELECT 1
    FROM elitea_runtime.execution_jobs AS j
    JOIN elitea_runtime.index_ingest_jobs AS i
      ON i.execution_id = j.execution_id
     AND i.generation = j.generation
     AND i.capability_id = j.capability_id
    WHERE j.execution_id = $1
      AND j.generation = $2
      AND j.capability_id = 'index.ingest.v1'
      AND j.resource_project_id = $3
      AND j.projection_project_id = $3
)`, executionID, int64(generation), projectID).Scan(&indexExecution)
	if err != nil {
		return 0, false, fmt.Errorf("resolve current index Activity execution: %w", err)
	}
	// Configuration-validation failures share the typed runtime-failure
	// repository. Reject them here before touching a current chat schema.
	if !indexExecution {
		return 0, false, nil
	}

	var currentTables bool
	err = tx.QueryRow(ctx, `
SELECT to_regclass($1) IS NOT NULL
   AND to_regclass($2) IS NOT NULL
   AND to_regclass($3) IS NOT NULL
   AND to_regclass($4) IS NOT NULL`,
		conversationTable,
		participantTable,
		mappingTable,
		groupTable,
	).Scan(&currentTables)
	if err != nil {
		return 0, false, fmt.Errorf("inspect current index Activity schema: %w", err)
	}
	// A project without the current chat schema is not a compatible UI target.
	// It must not gain a second Activity store as a migration side effect.
	if !currentTables {
		return 0, false, nil
	}

	var groupID int64
	err = tx.QueryRow(ctx, fmt.Sprintf(`
WITH admitted AS MATERIALIZED (
    SELECT j.execution_id,
           j.generation,
           j.actor_id,
           i.toolkit_id,
           i.client_stream_id,
           i.client_message_id
    FROM elitea_runtime.execution_jobs AS j
    JOIN elitea_runtime.index_ingest_jobs AS i
      ON i.execution_id = j.execution_id
     AND i.generation = j.generation
     AND i.capability_id = j.capability_id
    WHERE j.execution_id = $1
      AND j.generation = $2
      AND j.capability_id = 'index.ingest.v1'
      AND j.resource_project_id = $3
      AND j.projection_project_id = $3
      AND i.client_stream_id IS NOT NULL
      AND i.client_message_id IS NOT NULL
),
target AS MATERIALIZED (
    SELECT conversation.id AS conversation_id,
           participant.id AS participant_id,
           admitted.client_message_id,
           admitted.execution_id
    FROM admitted
    JOIN %s AS conversation
      ON conversation.uuid::text = admitted.client_stream_id
     AND conversation.source = 'toolkit'
     AND conversation.author_id::text = admitted.actor_id
    JOIN %s AS mapping
      ON mapping.conversation_id = conversation.id
    JOIN %s AS participant
      ON participant.id = mapping.participant_id
     AND participant.entity_name = 'toolkit'
     AND participant.entity_meta->>'id' = admitted.toolkit_id::text
    WHERE admitted.client_message_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
),
inserted AS (
    INSERT INTO %s (
        uuid, author_participant_id, conversation_id, meta,
        is_streaming, created_at, updated_at, task_id
    )
    SELECT client_message_id::uuid,
           participant_id,
           conversation_id,
           '{"context":{"included":true,"priority":1.0,"weight":1.0}}'::jsonb,
           TRUE,
           $4,
           $4,
           execution_id
    FROM target
    ON CONFLICT (uuid) DO NOTHING
    RETURNING id
)
SELECT id
FROM inserted
UNION ALL
SELECT message_group.id
FROM %s AS message_group
JOIN target
  ON message_group.uuid = target.client_message_id::uuid
 AND message_group.conversation_id = target.conversation_id
 AND message_group.author_participant_id = target.participant_id
 AND message_group.task_id = target.execution_id
WHERE NOT EXISTS (SELECT 1 FROM inserted)
LIMIT 1`, conversationTable, mappingTable, participantTable, groupTable, groupTable),
		executionID,
		int64(generation),
		projectID,
		occurredAt.UTC(),
	).Scan(&groupID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Scheduled executions, removed conversations/participants, malformed
		// old correlation IDs, and cross-project bindings intentionally do not
		// materialize UI history.
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("resolve current index Activity group: %w", err)
	}
	if groupID <= 0 {
		return 0, false, errors.New("current index Activity group is invalid")
	}
	return groupID, true, nil
}

func upsertCurrentIndexActivityTrace(
	ctx context.Context,
	tx sqlExecutor,
	projectID int64,
	groupID int64,
	node currentIndexActivityNode,
) error {
	schema, err := currentProjectSchema(projectID)
	if err != nil {
		return err
	}
	traceTable := schema + ".chat_message_trace_step"
	var traceID int64
	err = tx.QueryRow(ctx, fmt.Sprintf(`
WITH updated AS (
    UPDATE %s
    SET tool_name = NULLIF($4, ''),
        started_at = $5,
        finished_at = $6,
        is_error = $7,
        has_visible_content = $8,
        finish_reason = NULLIF($9, ''),
        step_type = NULLIF($10, ''),
        text = NULLIF($11, ''),
        attrs = CASE
            WHEN $2 = 'tool_call'
                THEN COALESCE(attrs, '{}'::jsonb) || $12::jsonb
            ELSE $12::jsonb
        END
    WHERE id = (
        SELECT id
        FROM %s
        WHERE message_group_id = $1
          AND kind = $2
          AND run_id = $3
        ORDER BY id
        LIMIT 1
        FOR UPDATE
    )
    RETURNING id
),
inserted AS (
    INSERT INTO %s (
        message_group_id, kind, run_id, started_at, finished_at,
        is_error, has_visible_content, tool_name, finish_reason,
        step_type, text, attrs
    )
    SELECT $1, $2, $3, $5, $6, $7, $8, NULLIF($4, ''),
           NULLIF($9, ''), NULLIF($10, ''), NULLIF($11, ''), $12::jsonb
    WHERE NOT EXISTS (SELECT 1 FROM updated)
    RETURNING id
)
SELECT id FROM updated
UNION ALL
SELECT id FROM inserted
LIMIT 1`, traceTable, traceTable, traceTable),
		groupID,
		node.kind,
		node.runID,
		node.toolName,
		node.startedAt.UTC(),
		node.finishedAt,
		node.isError,
		node.kind == "tool_call" || node.text != "",
		node.finishReason,
		node.stepType,
		node.text,
		node.attrs,
	).Scan(&traceID)
	if err != nil {
		return fmt.Errorf("upsert current index Activity trace: %w", err)
	}
	if traceID <= 0 {
		return errors.New("current index Activity trace is invalid")
	}
	return nil
}

func currentIndexActivityNodeFromFrame(frame outputapp.NodeEventFrame) (currentIndexActivityNode, bool, error) {
	var event struct {
		Type             string          `json:"type"`
		ResponseMetadata json.RawMessage `json:"response_metadata"`
	}
	if json.Unmarshal(frame.BrowserData, &event) != nil {
		return currentIndexActivityNode{}, false, errors.New("decode current index Activity node event")
	}
	recognized := event.Type == "agent_tool_start" ||
		event.Type == "agent_tool_end" ||
		event.Type == "agent_tool_error" ||
		event.Type == "agent_thinking_step" ||
		event.Type == "agent_thinking_step_update"
	if !recognized {
		return currentIndexActivityNode{}, false, nil
	}
	if len(event.ResponseMetadata) == 0 {
		return currentIndexActivityNode{}, false, errors.New("current index Activity node metadata is required")
	}
	var metadata struct {
		RunID           string            `json:"run_id"`
		ToolRunID       string            `json:"tool_run_id"`
		ToolName        string            `json:"tool_name"`
		Message         string            `json:"message"`
		FinishReason    string            `json:"finish_reason"`
		TimestampStart  string            `json:"timestamp_start"`
		TimestampFinish string            `json:"timestamp_finish"`
		Datetime        string            `json:"datetime"`
		Metadata        map[string]string `json:"metadata"`
	}
	if json.Unmarshal(event.ResponseMetadata, &metadata) != nil {
		return currentIndexActivityNode{}, false, errors.New("decode current index Activity node metadata")
	}
	runID := metadata.ToolRunID
	if runID == "" {
		runID = metadata.RunID
	}
	if !validCurrentActivityText(runID, currentActivityMaxNameBytes) ||
		!validOptionalCurrentActivityText(metadata.ToolName, currentActivityMaxNameBytes) ||
		!validOptionalCurrentActivityText(metadata.Message, currentActivityMaxTextBytes) ||
		!validOptionalCurrentActivityText(metadata.FinishReason, currentActivityMaxNameBytes) {
		return currentIndexActivityNode{}, false, errors.New("current index Activity node metadata is invalid")
	}
	node := currentIndexActivityNode{
		runID:        runID,
		toolName:     metadata.ToolName,
		startedAt:    frame.OccurredAt.UTC(),
		finishReason: metadata.FinishReason,
	}
	switch event.Type {
	case "agent_tool_start":
		node.kind = "tool_call"
		node.startedAt = currentActivityTime(metadata.TimestampStart, node.startedAt)
	case "agent_tool_end", "agent_tool_error":
		node.kind = "tool_call"
		node.isError = event.Type == "agent_tool_error" || metadata.FinishReason == "error"
		node.startedAt = currentActivityTime(metadata.TimestampStart, node.startedAt)
		finished := currentActivityTime(metadata.TimestampFinish, frame.OccurredAt.UTC())
		node.finishedAt = &finished
	case "agent_thinking_step", "agent_thinking_step_update":
		node.kind = "thinking_step"
		node.stepType = "thinking_step"
		node.text = metadata.Message
		node.startedAt = currentActivityTime(metadata.Datetime, node.startedAt)
		finished := node.startedAt
		node.finishedAt = &finished
	}
	attrs := map[string]any{}
	if node.kind == "thinking_step" {
		attrs["response_metadata"] = map[string]string{"tool_name": metadata.ToolName}
	} else if safe := currentActivityMetadata(metadata.Metadata); len(safe) != 0 {
		attrs["metadata"] = safe
	}
	node.attrs, _ = json.Marshal(attrs)
	if len(node.attrs) == 0 || len(node.attrs) > currentActivityMaxAttrBytes {
		return currentIndexActivityNode{}, false, errors.New("current index Activity node attrs are invalid")
	}
	return node, true, nil
}

func currentActivityMetadata(value map[string]string) map[string]string {
	safe := make(map[string]string, 3)
	for _, key := range []string{"display_name", "initiator", "tool_name"} {
		if item := value[key]; validOptionalCurrentActivityText(item, currentActivityMaxNameBytes) && item != "" {
			safe[key] = item
		}
	}
	return safe
}

func currentActivityTime(value string, fallback time.Time) time.Time {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil || parsed.IsZero() {
		return fallback.UTC()
	}
	return parsed.UTC()
}

func currentProjectSchema(projectID int64) (string, error) {
	if projectID <= 0 {
		return "", errors.New("invalid current project schema")
	}
	return pgx.Identifier{"p_" + strconv.FormatInt(projectID, 10)}.Sanitize(), nil
}

func validCurrentActivityText(value string, maxBytes int) bool {
	return value != "" && validOptionalCurrentActivityText(value, maxBytes)
}

func validOptionalCurrentActivityText(value string, maxBytes int) bool {
	return len(value) <= maxBytes && utf8.ValidString(value) && !strings.ContainsRune(value, '\x00')
}

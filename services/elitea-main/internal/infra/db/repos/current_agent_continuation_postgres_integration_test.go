package repos

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/tenant"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresCurrentApplicationTurnAllowsASecondMessageOnTheSameConversation(t *testing.T) {
	pool := newPostgresIntegrationPool(t)
	applyPostgresIntegrationMigrations(t, pool)
	seedCurrentAgentContinuationSchema(t, pool)

	tx, err := pool.BeginTx(t.Context(), pgx.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	if err := tenant.BindProject(t.Context(), tx, tenant.Project{ID: 1}); err != nil {
		t.Fatal(err)
	}
	queries := sqlcgen.New(tx)
	conversationID, _ := currentPGUUID("10000000-0000-4000-8000-000000000031")
	resolve := sqlcgen.ResolveCurrentApplicationTurnParams{
		ActorUserID: 11, TargetParticipantID: 21,
		QuestionID: mustCurrentPGUUID(
			t,
			"20000000-0000-4000-8000-000000000031",
		),
		ConversationUuid: conversationID, ProjectID: 1,
	}
	firstTarget, err := queries.ResolveCurrentApplicationTurn(t.Context(), resolve)
	if err != nil {
		t.Fatal(err)
	}
	if firstTarget.ApplicationID != 31 || firstTarget.ApplicationVersionID != 41 {
		t.Fatalf("first target=%+v", firstTarget)
	}
	if firstTarget.ChatHistoryJson != "[]" {
		t.Fatalf("first chat history=%s", firstTarget.ChatHistoryJson)
	}

	firstResponse := insertPostgresCurrentApplicationTurn(
		t,
		queries,
		conversationID,
		"20000000-0000-4000-8000-000000000031",
		"30000000-0000-4000-8000-000000000031",
		"40000000-0000-4000-8000-000000000031",
		"first turn",
		"execution-agent-turn-1",
	)
	completePostgresCurrentApplicationTurn(
		t,
		tx,
		firstResponse,
		"first response",
	)
	resolve.QuestionID = mustCurrentPGUUID(
		t,
		"50000000-0000-4000-8000-000000000031",
	)
	secondTarget, err := queries.ResolveCurrentApplicationTurn(t.Context(), resolve)
	if err != nil {
		t.Fatalf("resolve after first persisted turn: %v", err)
	}
	if secondTarget.ApplicationID != firstTarget.ApplicationID ||
		secondTarget.ApplicationVersionID != firstTarget.ApplicationVersionID {
		t.Fatalf("target changed across turns: first=%+v second=%+v", firstTarget, secondTarget)
	}
	var history []struct {
		Role             string              `json:"role"`
		Content          []map[string]string `json:"content"`
		AdditionalKwargs map[string]any      `json:"additional_kwargs"`
	}
	if err := json.Unmarshal([]byte(secondTarget.ChatHistoryJson), &history); err != nil {
		t.Fatalf("decode second chat history: %v", err)
	}
	if len(history) != 2 || history[0].Role != "user" ||
		len(history[0].Content) != 1 || history[0].Content[0]["text"] != "first turn" ||
		history[1].Role != "assistant" || len(history[1].Content) != 1 ||
		history[1].Content[0]["text"] != "first response" {
		t.Fatalf("second chat history=%s", secondTarget.ChatHistoryJson)
	}
	secondResponse := insertPostgresCurrentApplicationTurn(
		t,
		queries,
		conversationID,
		"50000000-0000-4000-8000-000000000031",
		"60000000-0000-4000-8000-000000000031",
		"70000000-0000-4000-8000-000000000031",
		"second turn",
		"execution-agent-turn-2",
	)
	if firstResponse == secondResponse {
		t.Fatal("distinct turns reused one response message identity")
	}
	thirdQuestionID := mustCurrentPGUUID(
		t,
		"80000000-0000-4000-8000-000000000031",
	)
	thirdQuestionItemID := mustCurrentPGUUID(
		t,
		"90000000-0000-4000-8000-000000000031",
	)
	thirdResponseID := mustCurrentPGUUID(
		t,
		"a0000000-0000-4000-8000-000000000031",
	)
	_, err = queries.InsertCurrentApplicationTurn(
		t.Context(),
		sqlcgen.InsertCurrentApplicationTurnParams{
			ActorUserID: 11, TargetParticipantID: 21,
			ApplicationVersionID: 41, ApplicationID: 31,
			ConversationUuid: conversationID, ProjectID: 1,
			QuestionID: thirdQuestionID, QuestionMeta: []byte(`{}`),
			QuestionItemID: thirdQuestionItemID, UserInput: "overlap",
			ResponseMessageID:   thirdResponseID,
			ExecutionGeneration: "80000000-0000-4000-8000-000000000031",
			ExecutionID:         "execution-agent-overlap",
		},
	)
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("overlapping turn error=%v", err)
	}

	var groups, questions, responses int
	var contents []string
	if err := tx.QueryRow(t.Context(), `
SELECT count(*),
       count(*) FILTER (WHERE sent_to_id = 21),
       count(*) FILTER (WHERE reply_to_id IS NOT NULL),
       array_agg(text.content ORDER BY message_group.id)
           FILTER (WHERE text.content IS NOT NULL)
FROM chat_message_group AS message_group
LEFT JOIN chat_message_items AS item
  ON item.message_group_id = message_group.id
LEFT JOIN chat_messages_text AS text
  ON text.id = item.id`).Scan(&groups, &questions, &responses, &contents); err != nil {
		t.Fatal(err)
	}
	if groups != 4 || questions != 2 || responses != 2 ||
		len(contents) != 3 || contents[0] != "first turn" ||
		contents[1] != "first response" || contents[2] != "second turn" {
		t.Fatalf(
			"groups=%d questions=%d responses=%d contents=%v",
			groups,
			questions,
			responses,
			contents,
		)
	}
}

func completePostgresCurrentApplicationTurn(
	t *testing.T,
	tx pgx.Tx,
	responseID pgtype.UUID,
	content string,
) {
	t.Helper()
	if _, err := tx.Exec(t.Context(), `
WITH response_group AS (
    UPDATE chat_message_group
    SET is_streaming = FALSE,
        created_at = statement_timestamp()
    WHERE uuid = $1
    RETURNING id
), response_item AS (
    INSERT INTO chat_message_items (
        uuid, item_type, order_index, meta, message_group_id
    )
    SELECT gen_random_uuid(), 'text_message', 0, '{}'::jsonb, response_group.id
    FROM response_group
    RETURNING id
)
INSERT INTO chat_messages_text (id, content)
SELECT response_item.id, $2
FROM response_item`, responseID, content); err != nil {
		t.Fatal(err)
	}
}

func mustCurrentPGUUID(t *testing.T, value string) pgtype.UUID {
	t.Helper()
	result, err := currentPGUUID(value)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func insertPostgresCurrentApplicationTurn(
	t *testing.T,
	queries *sqlcgen.Queries,
	conversationID pgtype.UUID,
	questionIDRaw,
	questionItemIDRaw,
	responseIDRaw,
	input,
	executionID string,
) pgtype.UUID {
	t.Helper()
	questionID, _ := currentPGUUID(questionIDRaw)
	questionItemID, _ := currentPGUUID(questionItemIDRaw)
	responseID, _ := currentPGUUID(responseIDRaw)
	row, err := queries.InsertCurrentApplicationTurn(
		t.Context(),
		sqlcgen.InsertCurrentApplicationTurnParams{
			ActorUserID: 11, TargetParticipantID: 21,
			ApplicationVersionID: 41, ApplicationID: 31,
			ConversationUuid: conversationID, ProjectID: 1,
			QuestionID: questionID, QuestionMeta: []byte(`{}`),
			QuestionItemID: questionItemID, UserInput: input,
			ResponseMessageID: responseID, ExecutionGeneration: questionIDRaw,
			ExecutionID: executionID,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	return row.ResponseMessageID
}

func seedCurrentAgentContinuationSchema(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(t.Context(), `
ALTER TABLE p_1.application_versions
    ADD COLUMN application_id INTEGER NOT NULL,
    ADD COLUMN name VARCHAR(128) NOT NULL,
    ADD COLUMN status VARCHAR NOT NULL,
    ADD COLUMN author_id INTEGER NOT NULL,
    ADD COLUMN uuid UUID NOT NULL UNIQUE,
    ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT now(),
    ADD COLUMN instructions VARCHAR,
    ADD COLUMN conversation_starters JSON NOT NULL DEFAULT '[]'::json,
    ADD COLUMN welcome_message VARCHAR NOT NULL DEFAULT '',
    ADD COLUMN agent_type VARCHAR NOT NULL,
    ADD COLUMN meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN pipeline_settings JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE p_1.elitea_tools (
    id SERIAL PRIMARY KEY, created_at TIMESTAMP NOT NULL DEFAULT now(), updated_at TIMESTAMP,
    type VARCHAR NOT NULL, name VARCHAR(128), description VARCHAR(1024),
    settings JSONB NOT NULL, author_id INTEGER NOT NULL, meta JSONB NOT NULL
);
CREATE TABLE p_1.entity_tool_mapping (
    id SERIAL PRIMARY KEY, tool_id INTEGER NOT NULL, entity_id INTEGER NOT NULL,
    entity_version_id INTEGER NOT NULL, entity_type VARCHAR NOT NULL,
    selected_tools JSONB
);
CREATE TABLE p_1.chat_conversations (
    id SERIAL PRIMARY KEY, uuid UUID NOT NULL UNIQUE, name VARCHAR NOT NULL,
    is_private BOOLEAN NOT NULL DEFAULT TRUE, author_id INTEGER NOT NULL,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb, source VARCHAR NOT NULL DEFAULT 'elitea',
    instructions VARCHAR, created_at TIMESTAMP NOT NULL DEFAULT now(), updated_at TIMESTAMP
);
CREATE TABLE p_1.chat_participants (
    id SERIAL PRIMARY KEY, uuid UUID NOT NULL UNIQUE, entity_name VARCHAR NOT NULL,
    entity_meta JSONB NOT NULL DEFAULT '{}'::jsonb, meta JSON NOT NULL DEFAULT '{}'::json
);
CREATE TABLE p_1.chat_participant_mapping (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES p_1.chat_conversations(id),
    participant_id INTEGER NOT NULL REFERENCES p_1.chat_participants(id),
    entity_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT now(), updated_at TIMESTAMP,
    UNIQUE (participant_id, conversation_id)
);
CREATE TABLE p_1.chat_message_group (
    id SERIAL PRIMARY KEY, uuid UUID NOT NULL UNIQUE,
    author_participant_id INTEGER NOT NULL REFERENCES p_1.chat_participants(id),
    conversation_id INTEGER NOT NULL REFERENCES p_1.chat_conversations(id),
    sent_to_id INTEGER REFERENCES p_1.chat_participants(id),
    reply_to_id INTEGER REFERENCES p_1.chat_message_group(id),
    meta JSONB NOT NULL DEFAULT '{}'::jsonb, is_streaming BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT now(), updated_at TIMESTAMP, task_id VARCHAR(64)
);
CREATE TABLE p_1.chat_message_items (
    id SERIAL PRIMARY KEY, uuid UUID NOT NULL UNIQUE, item_type VARCHAR(50) NOT NULL,
    order_index INTEGER NOT NULL, meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT now(), updated_at TIMESTAMP,
    message_group_id INTEGER NOT NULL REFERENCES p_1.chat_message_group(id)
);
CREATE TABLE p_1.chat_messages_text (
    id INTEGER PRIMARY KEY REFERENCES p_1.chat_message_items(id), content TEXT NOT NULL
);
INSERT INTO p_1.application_versions (
    id, application_id, name, status, author_id, uuid, llm_settings, instructions,
    conversation_starters, welcome_message, agent_type, meta, pipeline_settings
) VALUES (
    41, 31, 'base', 'draft', 11, '80000000-0000-4000-8000-000000000031',
    '{"model_name":"test"}'::jsonb, 'Be concise', '[]'::json, '', 'agent',
    '{}'::jsonb, '{}'::jsonb
);
INSERT INTO p_1.chat_conversations (
    id, uuid, name, author_id, source
) VALUES (1, '10000000-0000-4000-8000-000000000031', 'continuation', 11, 'agent');
INSERT INTO p_1.chat_participants (id, uuid, entity_name, entity_meta) VALUES
    (20, '90000000-0000-4000-8000-000000000031', 'user', '{"id":11}'::jsonb),
    (21, 'a0000000-0000-4000-8000-000000000031', 'application', '{"id":31,"project_id":1}'::jsonb);
INSERT INTO p_1.chat_participant_mapping (
    conversation_id, participant_id, entity_settings
) VALUES
    (1, 20, '{}'::jsonb),
    (1, 21, '{"version_id":41,"variables":[]}'::jsonb);`); err != nil {
		t.Fatal(err)
	}
}

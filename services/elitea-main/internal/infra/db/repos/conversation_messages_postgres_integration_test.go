package repos

// DEFECT #599: ListMessages returned an empty transcript for every conversation
// the web client opened.
//
// `chat_message_group.conversation_id` is an `integer` FK to
// `chat_conversations.id`, but the route the transcript is fetched over —
// GET /messages/prompt_lib/{projectID}/{conversationID} — carries the
// conversation UUID (apps/elitea-web/src/entities/conversation/api/messageApi.ts).
// The repository passed that string straight into the comparison, so Postgres
// raised `invalid input syntax for type integer`, and the method answered
// `{"items":[],"total":0}` with a nil error. A failure was reported as an empty
// conversation.
//
// WHAT THE RED RUN SHOWS. Against the unchanged previous code
// TestListMessagesFindsTheTranscriptByConversationUUID fails with total 0 and 0
// items where 2 are seeded, and TestDeleteMessagesAcceptsTheConversationUUID
// fails with the raw SQLSTATE 22P02. The `...ByNumericID` test passes both
// before and after — which is the point: a test written against the numeric id
// exercises the form the defect never reached.
//
// Requires a PostgreSQL service (ELITEA_TEST_DATABASE_URL).

import (
	"context"
	"testing"
)

// seedTranscript writes a conversation with two message groups — one authored
// by the user participant, one by the agent — and returns both identifier
// forms the routes use for it.
func seedTranscript(t *testing.T, repo *ConversationsRepo) (numericID, conversationUUID string) {
	t.Helper()
	ctx := context.Background()

	if err := repo.pool.QueryRow(ctx, `
INSERT INTO p_1.chat_conversations (uuid, name, author_id, source)
VALUES (gen_random_uuid(), 'transcript', 7, 'agent')
RETURNING id::text, uuid::text`).Scan(&numericID, &conversationUUID); err != nil {
		t.Fatalf("seed conversation: %v", err)
	}

	for _, entityName := range []string{"user", "application"} {
		if _, err := repo.pool.Exec(ctx, `
WITH participant AS (
    INSERT INTO p_1.chat_participants (uuid, entity_name, entity_meta)
    VALUES (gen_random_uuid(), $1, '{"id": 42, "project_id": 1}'::jsonb)
    RETURNING id
), grp AS (
    INSERT INTO p_1.chat_message_group (uuid, author_participant_id, conversation_id)
    SELECT gen_random_uuid(), participant.id, $2::int FROM participant
    RETURNING id
), item AS (
    INSERT INTO p_1.chat_message_items (uuid, item_type, order_index, message_group_id)
    SELECT gen_random_uuid(), 'text_message', 0, grp.id FROM grp
    RETURNING id
)
INSERT INTO p_1.chat_messages_text (id, content)
SELECT item.id, $3 FROM item`,
			entityName, numericID, "said by "+entityName); err != nil {
			t.Fatalf("seed %s message group: %v", entityName, err)
		}
	}

	return numericID, conversationUUID
}

// The regression the issue names: the transcript must be reachable by the
// identifier the web client actually sends.
func TestListMessagesFindsTheTranscriptByConversationUUID(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	_, conversationUUID := seedTranscript(t, repo)

	resp, err := repo.ListMessages(context.Background(), "1", conversationUUID, wholeTranscript())
	if err != nil {
		t.Fatalf("list messages by UUID: %v", err)
	}
	if resp.Total != 2 || len(resp.Items) != 2 {
		t.Fatalf("listing by conversation UUID returned total %d and %d items, want 2 and 2",
			resp.Total, len(resp.Items))
	}
	roles := map[string]int{}
	for _, m := range resp.Items {
		roles[m.Role]++
		if m.Content == "" {
			t.Errorf("message %s came back with empty content", m.UUID)
		}
	}
	if roles["user"] != 1 || roles["assistant"] != 1 {
		t.Fatalf("roles %v, want one user and one assistant", roles)
	}
}

// The numeric form has to keep working: the same repository method is reached
// from routes that pass the id.
func TestListMessagesFindsTheTranscriptByNumericID(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	numericID, _ := seedTranscript(t, repo)

	resp, err := repo.ListMessages(context.Background(), "1", numericID, wholeTranscript())
	if err != nil {
		t.Fatalf("list messages by numeric id: %v", err)
	}
	if resp.Total != 2 || len(resp.Items) != 2 {
		t.Fatalf("listing by numeric id returned total %d and %d items, want 2 and 2",
			resp.Total, len(resp.Items))
	}
}

// An identifier no conversation carries is a 404, not a successful empty
// transcript — the distinction the old code could not express.
func TestListMessagesRejectsAnUnknownConversation(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	seedTranscript(t, repo)

	for _, identifier := range []string{
		"2147483000",
		"e0ac9d1e-06e4-4d3f-9e39-1f3a1c7f6d55",
		"not-an-identifier",
	} {
		if _, err := repo.ListMessages(context.Background(), "1", identifier, wholeTranscript()); err == nil {
			t.Errorf("listing messages for %q succeeded, want an error", identifier)
		}
	}
}

// DeleteMessages sits on the same route and took the same parameter, so it
// carried the same defect — it just failed loudly instead of silently. It also
// named `chat_messages`, a table this repository's migrations never create, so
// the fix has to be checked by reading the transcript back rather than by the
// absence of an error.
func TestDeleteMessagesClearsTheTranscriptByConversationUUID(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	ctx := context.Background()
	_, conversationUUID := seedTranscript(t, repo)

	if err := repo.DeleteMessages(ctx, "1", conversationUUID); err != nil {
		t.Fatalf("delete messages by conversation UUID: %v", err)
	}

	resp, err := repo.ListMessages(ctx, "1", conversationUUID, wholeTranscript())
	if err != nil {
		t.Fatalf("list messages after delete: %v", err)
	}
	if resp.Total != 0 || len(resp.Items) != 0 {
		t.Fatalf("after clearing, the transcript still reports total %d and %d items",
			resp.Total, len(resp.Items))
	}

	// The conversation itself survives; only its messages go.
	var conversations int
	if err := repo.pool.QueryRow(ctx,
		`SELECT count(*) FROM p_1.chat_conversations WHERE uuid = $1::uuid`, conversationUUID).
		Scan(&conversations); err != nil {
		t.Fatalf("count conversations: %v", err)
	}
	if conversations != 1 {
		t.Fatalf("clearing messages left %d conversation rows, want 1", conversations)
	}
}

// The sibling read paths take the same parameter and compared it the same way.
func TestConversationReadsAcceptTheConversationUUID(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	ctx := context.Background()
	_, conversationUUID := seedTranscript(t, repo)

	groups, err := repo.ListMessageGroups(ctx, "1", conversationUUID, 50, "asc")
	if err != nil {
		t.Fatalf("list message groups by UUID: %v", err)
	}
	if len(groups) != 2 {
		t.Errorf("list message groups by UUID returned %d groups, want 2", len(groups))
	}

	analytics, err := repo.GetContextAnalytics(ctx, "1", conversationUUID)
	if err != nil {
		t.Fatalf("context analytics by UUID: %v", err)
	}
	if got := analytics["message_groups_in_context"]; got != 2 {
		t.Errorf("context analytics counted %v message groups, want 2", got)
	}
}

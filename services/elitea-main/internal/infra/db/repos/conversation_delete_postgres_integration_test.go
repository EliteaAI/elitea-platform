package repos

// DEFECT #602: deleting a conversation, or a single message, answered 500 on
// EVERY deployment.
//
// `ConversationsRepo.Delete` and `ConversationsRepo.DeleteMessage` named two
// tables that exist in no schema anywhere:
//
//   * `chat_messages` — the bare name, not chat_messages_text. A dead legacy
//     artifact: an older flat one-row-per-message shape. Not created by
//     001_initial.sql, not by any tenant migration, and not declared in pylon
//     either. Its successor is the chat_message_group -> chat_message_items ->
//     chat_messages_text graph.
//   * `chat_conversation_summaries` — present in this repository exactly once,
//     in the DELETE that has now gone. Absent from pylon and from the
//     pg-catalog dump of the live legacy database.
//
// DeleteMessage was broken twice over: 42P01 where chat_messages is absent, and
// 42703 on a real legacy database, where the table exists but has no
// `group_uid` column.
//
// WHAT THE RED RUN SHOWS. Against the unchanged previous code every test here
// fails on `relation "p_1.chat_messages" does not exist (SQLSTATE 42P01)`,
// raised by the first offending statement each method reaches. Correct only the
// table names and the tests still fail on the FK from chat_message_items to
// chat_message_group, which is what the item-level DELETEs exist for.
//
// Requires a PostgreSQL service (ELITEA_TEST_DATABASE_URL).

import (
	"context"
	"testing"
)

// countConversationRows reports what survives a delete, per table.
func countConversationRows(t *testing.T, repo *ConversationsRepo) (conversations, groups, items, texts, mappings int) {
	t.Helper()
	if err := repo.pool.QueryRow(context.Background(), `
SELECT (SELECT count(*) FROM p_1.chat_conversations),
       (SELECT count(*) FROM p_1.chat_message_group),
       (SELECT count(*) FROM p_1.chat_message_items),
       (SELECT count(*) FROM p_1.chat_messages_text),
       (SELECT count(*) FROM p_1.chat_participant_mapping)`).
		Scan(&conversations, &groups, &items, &texts, &mappings); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	return
}

// seedConversationWithParticipant writes a conversation, a participant mapped
// into it, and one message group per content string — the shape a real
// conversation has, so that Delete has every child row to clear.
func seedConversationWithParticipant(t *testing.T, repo *ConversationsRepo, contents ...string) (numericID, conversationUUID string, groupUUIDs []string) {
	t.Helper()
	ctx := context.Background()

	if err := repo.pool.QueryRow(ctx, `
INSERT INTO p_1.chat_conversations (uuid, name, author_id, source)
VALUES (gen_random_uuid(), 'delete-me', 7, 'agent')
RETURNING id::text, uuid::text`).Scan(&numericID, &conversationUUID); err != nil {
		t.Fatalf("seed conversation: %v", err)
	}

	var participantID int
	if err := repo.pool.QueryRow(ctx, `
INSERT INTO p_1.chat_participants (uuid, entity_name, entity_meta)
VALUES (gen_random_uuid(), 'user', '{"id": 7}'::jsonb) RETURNING id`).Scan(&participantID); err != nil {
		t.Fatalf("seed participant: %v", err)
	}
	if _, err := repo.pool.Exec(ctx, `
INSERT INTO p_1.chat_participant_mapping (conversation_id, participant_id)
VALUES ($1::int, $2)`, numericID, participantID); err != nil {
		t.Fatalf("seed participant mapping: %v", err)
	}

	for _, content := range contents {
		var groupUUID string
		if err := repo.pool.QueryRow(ctx, `
WITH grp AS (
    INSERT INTO p_1.chat_message_group (uuid, author_participant_id, conversation_id)
    VALUES (gen_random_uuid(), $1, $2::int)
    RETURNING id, uuid
), item AS (
    INSERT INTO p_1.chat_message_items (uuid, item_type, order_index, message_group_id)
    SELECT gen_random_uuid(), 'text_message', 0, grp.id FROM grp
    RETURNING id
), txt AS (
    INSERT INTO p_1.chat_messages_text (id, content)
    SELECT item.id, $3 FROM item
    RETURNING id
)
SELECT grp.uuid::text FROM grp, txt`, participantID, numericID, content).Scan(&groupUUID); err != nil {
			t.Fatalf("seed message group %q: %v", content, err)
		}
		groupUUIDs = append(groupUUIDs, groupUUID)
	}

	return numericID, conversationUUID, groupUUIDs
}

// Deleting a conversation must remove the whole graph and report success.
func TestDeleteConversationRemovesTheWholeGraph(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	_, conversationUUID, _ := seedConversationWithParticipant(t, repo, "question", "answer")

	if err := repo.Delete(context.Background(), "1", conversationUUID); err != nil {
		t.Fatalf("delete conversation: %v", err)
	}

	conversations, groups, items, texts, mappings := countConversationRows(t, repo)
	if conversations != 0 || groups != 0 || items != 0 || texts != 0 || mappings != 0 {
		t.Fatalf("after deleting the conversation: %d conversations, %d groups, %d items, %d texts, %d mappings — want all zero",
			conversations, groups, items, texts, mappings)
	}
}

// The numeric id reaches the same row; #599's resolver has to hold here too.
func TestDeleteConversationAcceptsTheNumericID(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	numericID, _, _ := seedConversationWithParticipant(t, repo, "question")

	if err := repo.Delete(context.Background(), "1", numericID); err != nil {
		t.Fatalf("delete conversation by numeric id: %v", err)
	}
	if conversations, _, _, _, _ := countConversationRows(t, repo); conversations != 0 {
		t.Fatalf("%d conversations survived, want 0", conversations)
	}
}

func TestDeleteConversationRejectsAnUnknownConversation(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	seedConversationWithParticipant(t, repo, "question")

	for _, identifier := range []string{
		"2147483000",
		"e0ac9d1e-06e4-4d3f-9e39-1f3a1c7f6d55",
		"not-an-identifier",
	} {
		if err := repo.Delete(context.Background(), "1", identifier); err == nil {
			t.Errorf("deleting conversation %q succeeded, want an error", identifier)
		}
	}
	if conversations, _, _, _, _ := countConversationRows(t, repo); conversations != 1 {
		t.Fatalf("a failed delete removed rows: %d conversations left, want 1", conversations)
	}
}

// Deleting one message removes that group and its content, and NOTHING else —
// the conversation, its other groups and its participants all survive.
func TestDeleteMessageRemovesOnlyThatGroup(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	ctx := context.Background()
	_, conversationUUID, groupUUIDs := seedConversationWithParticipant(t, repo, "keep me", "delete me")

	if err := repo.DeleteMessage(ctx, "1", groupUUIDs[1]); err != nil {
		t.Fatalf("delete message: %v", err)
	}

	conversations, groups, items, texts, mappings := countConversationRows(t, repo)
	if conversations != 1 || groups != 1 || items != 1 || texts != 1 || mappings != 1 {
		t.Fatalf("after deleting one message: %d conversations, %d groups, %d items, %d texts, %d mappings — want 1 of each",
			conversations, groups, items, texts, mappings)
	}

	resp, err := repo.ListMessages(ctx, "1", conversationUUID, wholeTranscript())
	if err != nil {
		t.Fatalf("list messages after deleting one: %v", err)
	}
	if len(resp.Items) != 1 || resp.Items[0].Content != "keep me" {
		t.Fatalf("transcript after the delete is %+v, want the single message %q", resp.Items, "keep me")
	}
}

// A reply_to reference must not pin its target. The group being deleted is the
// one another group replies to, which is the ordinary chat shape.
func TestDeleteMessageDetachesReplyReferences(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	ctx := context.Background()
	_, _, groupUUIDs := seedConversationWithParticipant(t, repo, "question", "answer")

	if _, err := repo.pool.Exec(ctx, `
UPDATE p_1.chat_message_group SET reply_to_id = (SELECT id FROM p_1.chat_message_group WHERE uuid = $1::uuid)
WHERE uuid = $2::uuid`, groupUUIDs[0], groupUUIDs[1]); err != nil {
		t.Fatalf("link reply: %v", err)
	}

	if err := repo.DeleteMessage(ctx, "1", groupUUIDs[0]); err != nil {
		t.Fatalf("delete the group another group replies to: %v", err)
	}

	var replyTo *int
	if err := repo.pool.QueryRow(ctx,
		`SELECT reply_to_id FROM p_1.chat_message_group WHERE uuid = $1::uuid`, groupUUIDs[1]).
		Scan(&replyTo); err != nil {
		t.Fatalf("read the surviving group: %v", err)
	}
	if replyTo != nil {
		t.Fatalf("the surviving group still points at the deleted one (reply_to_id=%d)", *replyTo)
	}
}

// An unknown message is a 404, not a silent success — the old code reported
// success for every id because it deleted from a table that could not exist.
func TestDeleteMessageRejectsAnUnknownGroup(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	seedConversationWithParticipant(t, repo, "keep me")

	for _, identifier := range []string{
		"e0ac9d1e-06e4-4d3f-9e39-1f3a1c7f6d55",
		"not-a-uuid",
		"",
	} {
		if err := repo.DeleteMessage(context.Background(), "1", identifier); err == nil {
			t.Errorf("deleting message %q succeeded, want an error", identifier)
		}
	}
	if _, groups, _, _, _ := countConversationRows(t, repo); groups != 1 {
		t.Fatalf("a failed delete removed groups: %d left, want 1", groups)
	}
}

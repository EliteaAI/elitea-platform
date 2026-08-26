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

// conversationAuthorID owns every conversation these tests seed, and
// otherUserID owns none of them. They are distinct so an authorisation test
// cannot pass by accident: with one shared id, a DeleteMessage that skipped the
// author rule entirely would look identical to one that applied it.
const (
	conversationAuthorID = "7"
	otherUserID          = "8"
)

// seedConversationWithParticipant writes a conversation, a participant mapped
// into it, and one message group per content string — the shape a real
// conversation has, so that Delete has every child row to clear. Every group is
// authored by a 'user' participant whose entity_meta.id is
// conversationAuthorID.
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

	if err := repo.DeleteMessage(ctx, "1", groupUUIDs[1], conversationAuthorID); err != nil {
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

// The defensive detach: a reply_to reference must not pin its target.
//
// Under the last-only rule the ordinary backward link — an answer replying to
// the question before it — can never block a delete, because the group being
// removed is the newest one and nothing later points at it. This constructs the
// inverted link the FK permits but the chat flow does not normally produce, so
// that the UPDATE ... SET reply_to_id = NULL is actually exercised rather than
// merely present. Remove that statement and this test fails on SQLSTATE 23503.
func TestDeleteMessageDetachesReplyReferences(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	ctx := context.Background()
	_, _, groupUUIDs := seedConversationWithParticipant(t, repo, "question", "answer")

	if _, err := repo.pool.Exec(ctx, `
UPDATE p_1.chat_message_group SET reply_to_id = (SELECT id FROM p_1.chat_message_group WHERE uuid = $1::uuid)
WHERE uuid = $2::uuid`, groupUUIDs[1], groupUUIDs[0]); err != nil {
		t.Fatalf("link reply: %v", err)
	}

	if err := repo.DeleteMessage(ctx, "1", groupUUIDs[1], conversationAuthorID); err != nil {
		t.Fatalf("delete the last group while another group points at it: %v", err)
	}

	var replyTo *int
	if err := repo.pool.QueryRow(ctx,
		`SELECT reply_to_id FROM p_1.chat_message_group WHERE uuid = $1::uuid`, groupUUIDs[0]).
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
		if err := repo.DeleteMessage(context.Background(), "1", identifier, conversationAuthorID); err == nil {
			t.Errorf("deleting message %q succeeded, want an error", identifier)
		}
	}
	if _, groups, _, _, _ := countConversationRows(t, repo); groups != 1 {
		t.Fatalf("a failed delete removed groups: %d left, want 1", groups)
	}
}

// --- The three authorisation rules ported from pylon (message.py:91-122). ---
//
// Each test below fails with a successful delete against a DeleteMessage that
// only fixed the table name: an unconditional DELETE ... WHERE uuid = $1 lets
// any project member with `models.chat.messages.delete` remove anyone's message
// from anyone's conversation, and lets a message go from the middle of a
// transcript.

// authorUser makes `entityName` participant carrying `entityID` the author of a
// new last group in the seeded conversation, and returns that group's UUID.
func seedGroupAuthoredBy(t *testing.T, repo *ConversationsRepo, conversationID, entityName, entityID string) string {
	t.Helper()
	var groupUUID string
	if err := repo.pool.QueryRow(context.Background(), `
WITH participant AS (
    INSERT INTO p_1.chat_participants (uuid, entity_name, entity_meta)
    VALUES (gen_random_uuid(), $2, jsonb_build_object('id', $3::int))
    RETURNING id
), grp AS (
    INSERT INTO p_1.chat_message_group (uuid, author_participant_id, conversation_id)
    SELECT gen_random_uuid(), participant.id, $1::int FROM participant
    RETURNING uuid
)
SELECT grp.uuid::text FROM grp`, conversationID, entityName, entityID).Scan(&groupUUID); err != nil {
		t.Fatalf("seed group authored by %s %s: %v", entityName, entityID, err)
	}
	return groupUUID
}

func TestDeleteMessageRefusesANonAuthor(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	_, _, groupUUIDs := seedConversationWithParticipant(t, repo, "question", "answer")

	err := repo.DeleteMessage(context.Background(), "1", groupUUIDs[1], otherUserID)
	if err == nil {
		t.Fatal("a user who owns neither the conversation nor the message deleted it")
	}
	if _, groups, _, _, _ := countConversationRows(t, repo); groups != 2 {
		t.Fatalf("the refused delete still removed a group: %d left, want 2", groups)
	}
}

// The message's own author may delete it even in someone else's conversation.
func TestDeleteMessageAllowsTheMessageAuthor(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	numericID, _, _ := seedConversationWithParticipant(t, repo, "question")
	groupUUID := seedGroupAuthoredBy(t, repo, numericID, "user", otherUserID)

	if err := repo.DeleteMessage(context.Background(), "1", groupUUID, otherUserID); err != nil {
		t.Fatalf("the message's own author could not delete it: %v", err)
	}
}

// The entity_name guard. An 'application' participant's entity_meta.id is an
// AGENT id drawn from a different id space, so matching a user id against it
// would let user N delete the messages of agent N. Drop `entity_name = 'user'`
// from the predicate and this test passes a delete it should refuse.
func TestDeleteMessageDoesNotMistakeAnAgentIDForAUserID(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	numericID, _, _ := seedConversationWithParticipant(t, repo, "question")
	groupUUID := seedGroupAuthoredBy(t, repo, numericID, "application", otherUserID)

	if err := repo.DeleteMessage(context.Background(), "1", groupUUID, otherUserID); err == nil {
		t.Fatal("user 8 deleted a group authored by AGENT 8")
	}
}

func TestDeleteMessageRefusesAnUnauthenticatedCaller(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	_, _, groupUUIDs := seedConversationWithParticipant(t, repo, "question")

	if err := repo.DeleteMessage(context.Background(), "1", groupUUIDs[0], ""); err == nil {
		t.Fatal("an empty caller id deleted a message")
	}
}

// A group folded into a summary is already represented elsewhere in the context
// window, so removing the row would not remove the content.
func TestDeleteMessageRefusesASummarizedGroup(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	ctx := context.Background()
	_, _, groupUUIDs := seedConversationWithParticipant(t, repo, "question")

	if _, err := repo.pool.Exec(ctx, `
UPDATE p_1.chat_message_group SET meta = '{"context": {"included": false}}'::jsonb
WHERE uuid = $1::uuid`, groupUUIDs[0]); err != nil {
		t.Fatalf("mark summarized: %v", err)
	}

	if err := repo.DeleteMessage(ctx, "1", groupUUIDs[0], conversationAuthorID); err == nil {
		t.Fatal("a summarized message was deleted")
	}
}

// A group with no meta, or meta without a context key, is NOT summarized. The
// COALESCE default is what keeps every ordinary message deletable — read it as
// 'false' and the route refuses everything, which is the failure mode a
// too-clever null check would produce.
func TestDeleteMessageTreatsAbsentContextMetaAsIncluded(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	ctx := context.Background()
	_, _, groupUUIDs := seedConversationWithParticipant(t, repo, "question")

	for _, meta := range []string{`{}`, `{"context": {}}`, `{"other": 1}`} {
		if _, err := repo.pool.Exec(ctx,
			`UPDATE p_1.chat_message_group SET meta = $2::jsonb WHERE uuid = $1::uuid`,
			groupUUIDs[0], meta); err != nil {
			t.Fatalf("set meta %s: %v", meta, err)
		}
		if err := repo.DeleteMessage(ctx, "1", groupUUIDs[0], conversationAuthorID); err != nil {
			t.Fatalf("meta %s made an ordinary message undeletable: %v", meta, err)
		}
		// Re-seed for the next case: the delete above consumed the group.
		_, _, again := seedConversationWithParticipant(t, repo, "question")
		groupUUIDs = again
	}
}

// Only the newest group may go. Deleting from the middle leaves the model with
// a conversation that never happened.
func TestDeleteMessageRefusesAnythingButTheLastGroup(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	ctx := context.Background()
	_, _, groupUUIDs := seedConversationWithParticipant(t, repo, "first", "second", "third")

	for i, groupUUID := range groupUUIDs[:2] {
		if err := repo.DeleteMessage(ctx, "1", groupUUID, conversationAuthorID); err == nil {
			t.Errorf("group %d, which is not the last, was deleted", i)
		}
	}
	if err := repo.DeleteMessage(ctx, "1", groupUUIDs[2], conversationAuthorID); err != nil {
		t.Fatalf("the last group could not be deleted: %v", err)
	}
	// And now the one before it is the last, so it becomes deletable.
	if err := repo.DeleteMessage(ctx, "1", groupUUIDs[1], conversationAuthorID); err != nil {
		t.Fatalf("after removing the last group its predecessor stayed undeletable: %v", err)
	}
}

// The tiebreaker, which pylon did not have. created_at defaults to a
// transaction-scoped now(), so groups written by one transaction share a
// timestamp to the microsecond; ordering by created_at alone makes "the last
// message" whichever row Postgres happened to return first. Ordering by
// (created_at, id) makes it the same group ListMessages renders last.
func TestDeleteMessageBreaksCreatedAtTiesByID(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	ctx := context.Background()
	_, _, groupUUIDs := seedConversationWithParticipant(t, repo, "first", "second")

	if _, err := repo.pool.Exec(ctx,
		`UPDATE p_1.chat_message_group SET created_at = '2026-01-01 00:00:00'`); err != nil {
		t.Fatalf("flatten timestamps: %v", err)
	}

	if err := repo.DeleteMessage(ctx, "1", groupUUIDs[0], conversationAuthorID); err == nil {
		t.Error("with equal timestamps the LOWER-id group was accepted as the last one")
	}
	if err := repo.DeleteMessage(ctx, "1", groupUUIDs[1], conversationAuthorID); err != nil {
		t.Fatalf("with equal timestamps the higher-id group was refused: %v", err)
	}
}

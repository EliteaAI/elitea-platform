package repos

// #606 (option 1): an uploaded chat attachment never appeared inline in the
// transcript, because ListMessageGroups only ever joined chat_messages_text.
//
// The item row itself was returned — an `attachment_message` entry with an
// `id`, an `item_type` and an `order_index` — but with NO `item_details` at
// all, so the web client rendered it as the literal `[undefined]`
// (apps/elitea-web/src/widgets/chat-box/ui/hooks/useChatBoxHandlers.helpers.ts:265
// does `'[' + details?.name + ']'`) and had no `filepath` to download from.
// migrations/tenant/0127 gave the payload table an owner; this is the read
// path that finally surfaces it.
//
// WHY THESE TESTS AND NOT UNIT TESTS. Every defect here lives in the SQL and
// in the scan, not in a pure function: a missing LEFT JOIN, a COALESCE that
// erases the absent/empty distinction, a `json` column handed back as a string.
// A fake pool would have to restate the very join under test. These run the
// real query against the real ledgered schema.
//
// Requires a PostgreSQL service (ELITEA_TEST_DATABASE_URL).

import (
	"context"
	"encoding/json"
	"testing"
)

// seedAttachmentTranscript writes one conversation holding a single message
// group, and returns the conversation UUID plus the group's numeric id.
//
// Items are seeded by the caller afterwards rather than here, because the
// point of most of these tests is WHICH items a group holds and in what order.
func seedAttachmentTranscript(t *testing.T, repo *ConversationsRepo) (conversationUUID string, groupID int) {
	t.Helper()
	ctx := context.Background()

	if err := repo.pool.QueryRow(ctx, `
WITH conversation AS (
    INSERT INTO p_1.chat_conversations (uuid, name, author_id, source)
    VALUES (gen_random_uuid(), 'attachment transcript', 7, 'agent')
    RETURNING id, uuid
), participant AS (
    INSERT INTO p_1.chat_participants (uuid, entity_name, entity_meta)
    VALUES (gen_random_uuid(), 'user', '{"id": 42, "project_id": 1}'::jsonb)
    RETURNING id
)
INSERT INTO p_1.chat_message_group (uuid, author_participant_id, conversation_id)
SELECT gen_random_uuid(), participant.id, conversation.id FROM conversation, participant
RETURNING id, (SELECT uuid::text FROM conversation)`).Scan(&groupID, &conversationUUID); err != nil {
		t.Fatalf("seed conversation and message group: %v", err)
	}
	return conversationUUID, groupID
}

func seedAttachmentTextItem(t *testing.T, repo *ConversationsRepo, groupID, orderIndex int, content string) {
	t.Helper()
	if _, err := repo.pool.Exec(context.Background(), `
WITH item AS (
    INSERT INTO p_1.chat_message_items (uuid, item_type, order_index, message_group_id)
    VALUES (gen_random_uuid(), 'text_message', $1, $2)
    RETURNING id
)
INSERT INTO p_1.chat_messages_text (id, content) SELECT item.id, $3 FROM item`,
		orderIndex, groupID, content); err != nil {
		t.Fatalf("seed text item: %v", err)
	}
}

// seedAttachmentPayloadItem writes an `attachment_message` item and its
// chat_messages_attachment payload. `content` is passed as the raw JSON text
// the `json` column stores; the empty string writes SQL NULL, which is the
// "attachment with no content chunks" case.
func seedAttachmentPayloadItem(t *testing.T, repo *ConversationsRepo, groupID, orderIndex int, name, bucket, attachmentType, content string) int {
	t.Helper()
	var itemID int
	var contentArg any
	if content != "" {
		contentArg = content
	}
	if err := repo.pool.QueryRow(context.Background(), `
WITH item AS (
    INSERT INTO p_1.chat_message_items (uuid, item_type, order_index, message_group_id)
    VALUES (gen_random_uuid(), 'attachment_message', $1, $2)
    RETURNING id
)
INSERT INTO p_1.chat_messages_attachment (id, name, bucket, attachment_type, content)
SELECT item.id, $3, $4, $5, $6::json FROM item
RETURNING id`, orderIndex, groupID, name, bucket, attachmentType, contentArg).Scan(&itemID); err != nil {
		t.Fatalf("seed attachment item: %v", err)
	}
	return itemID
}

// singleAttachmentGroup asserts the repository returned exactly one group and hands it
// back, so each test's own assertions stay about the items.
func singleAttachmentGroup(t *testing.T, repo *ConversationsRepo, conversationUUID string) map[string]any {
	t.Helper()
	groups, err := repo.ListMessageGroups(context.Background(), "1", conversationUUID, 50, "asc")
	if err != nil {
		t.Fatalf("list message groups: %v", err)
	}
	if len(groups) != 1 {
		t.Fatalf("returned %d groups, want 1", len(groups))
	}
	return groups[0]
}

func attachmentGroupItems(t *testing.T, group map[string]any) []map[string]any {
	t.Helper()
	items, ok := group["message_items"].([]map[string]any)
	if !ok {
		t.Fatalf("message_items is %T, want []map[string]any", group["message_items"])
	}
	return items
}

func attachmentItemDetailsOf(t *testing.T, item map[string]any) map[string]any {
	t.Helper()
	details, ok := item["item_details"].(map[string]any)
	if !ok {
		t.Fatalf("item_details is %T, want map[string]any (item %v)", item["item_details"], item)
	}
	return details
}

// The whole point of #606 option 1: a group holding both a question and the
// file sent with it returns both items, in order_index order, and the
// attachment's item_details carries every key the web client reads.
func TestListMessageGroupsReturnsAttachmentItemAlongsideText(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	conversationUUID, groupID := seedAttachmentTranscript(t, repo)
	seedAttachmentTextItem(t, repo, groupID, 0, "look at this")
	attachmentID := seedAttachmentPayloadItem(t, repo, groupID, 1, "diagram.png", "chat-uploads", "image",
		`[{"type": "image_url", "image_url": {"url": "filepath:/chat-uploads/diagram.png"}}]`)

	items := attachmentGroupItems(t, singleAttachmentGroup(t, repo, conversationUUID))
	if len(items) != 2 {
		t.Fatalf("group returned %d items, want the text item and the attachment", len(items))
	}
	if items[0]["item_type"] != "text_message" || items[1]["item_type"] != "attachment_message" {
		t.Fatalf("items came back as %v then %v, want text_message then attachment_message (order_index order)",
			items[0]["item_type"], items[1]["item_type"])
	}

	details := attachmentItemDetailsOf(t, items[1])

	// `name` and `bucket` are a DELIBERATE divergence from pylon's own API
	// shape, which exposes neither (elitea_core/models/pd/attachment.py:32-43).
	// The client reads both directly — `name` for the transcript label and the
	// playback toolbar, `bucket` for imageAttachment.helpers.ts:78's
	// `!== '__undefined__'` download-path decision — so both are emitted. See
	// attachmentItemDetails' own doc comment.
	for key, want := range map[string]any{
		"id":              attachmentID,
		"item_type":       "attachment_message",
		"name":            "diagram.png",
		"bucket":          "chat-uploads",
		"filepath":        "/chat-uploads/diagram.png",
		"attachment_type": "image",
	} {
		if got := details[key]; got != want {
			t.Errorf("item_details[%q] = %#v, want %#v", key, got, want)
		}
	}
}

// The group-level `content` is the message's rendered TEXT. An attachment now
// carries an item_details of its own, so the newline-join must keep counting
// only text items — otherwise a filename or a base64 chunk silently becomes
// part of what the user reads as the message.
func TestListMessageGroupsContentCountsOnlyTextItems(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	conversationUUID, groupID := seedAttachmentTranscript(t, repo)
	seedAttachmentTextItem(t, repo, groupID, 0, "first line")
	seedAttachmentPayloadItem(t, repo, groupID, 1, "notes.txt", "chat-uploads", "document", `[{"type": "text", "text": "SHOULD NOT APPEAR"}]`)
	seedAttachmentTextItem(t, repo, groupID, 2, "second line")

	group := singleAttachmentGroup(t, repo, conversationUUID)
	if got, want := group["content"], "first line\nsecond line"; got != want {
		t.Errorf("group content = %#v, want only the two text items joined: %#v", got, want)
	}
}

// An attachment sent with no accompanying question. The item must still come
// back — this is the case that used to disappear entirely from the reader's
// point of view, since a group with no text renders nothing at all — and the
// group's content is legitimately empty because there is no text item.
func TestListMessageGroupsReturnsAttachmentOnlyGroup(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	conversationUUID, groupID := seedAttachmentTranscript(t, repo)
	seedAttachmentPayloadItem(t, repo, groupID, 0, "solo.pdf", "chat-uploads", "document", "")

	group := singleAttachmentGroup(t, repo, conversationUUID)
	items := attachmentGroupItems(t, group)
	if len(items) != 1 {
		t.Fatalf("group returned %d items, want the single attachment", len(items))
	}
	details := attachmentItemDetailsOf(t, items[0])
	if got, want := details["filepath"], "/chat-uploads/solo.pdf"; got != want {
		t.Errorf("item_details[\"filepath\"] = %#v, want %#v", got, want)
	}
	if got := group["content"]; got != "" {
		t.Errorf("group content = %#v, want empty: the group holds no text item", got)
	}

	// An absent `content` column emits `[]`, never null and never omitted. The
	// client's findContentByType (entities/attachment/model/selectors.ts:36-44)
	// tests `content === undefined`, then `Array.isArray(content)`, then falls
	// through to `content.type` — so a JSON null is neither undefined nor an
	// array and throws reading `type` of null, taking the message list down.
	chunks, ok := details["content"].([]any)
	if !ok || len(chunks) != 0 {
		t.Errorf("item_details[\"content\"] = %#v (%T), want an empty []any for a NULL content column",
			details["content"], details["content"])
	}
}

// The `content` column is `json` holding a LIST of content chunks, and the
// client walks that list looking for an `image_url` entry. Handing it back as
// a string would make the walk see one opaque scalar and every inline image
// would stop rendering, so this asserts on the ENCODED form the handler will
// actually put on the wire, not just on the in-memory type.
func TestListMessageGroupsAttachmentContentRoundTripsAsJSONArray(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	conversationUUID, groupID := seedAttachmentTranscript(t, repo)
	seedAttachmentPayloadItem(t, repo, groupID, 0, "photo.png", "chat-uploads", "image",
		`[{"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}]`)

	details := attachmentItemDetailsOf(t, attachmentGroupItems(t, singleAttachmentGroup(t, repo, conversationUUID))[0])

	chunks, ok := details["content"].([]any)
	if !ok {
		t.Fatalf("item_details[\"content\"] is %T, want []any — a JSON string here breaks every inline image", details["content"])
	}
	if len(chunks) != 1 {
		t.Fatalf("content decoded to %d chunks, want 1", len(chunks))
	}
	chunk, ok := chunks[0].(map[string]any)
	if !ok {
		t.Fatalf("content chunk is %T, want map[string]any", chunks[0])
	}
	if chunk["type"] != "image_url" {
		t.Errorf("content chunk type = %#v, want image_url", chunk["type"])
	}

	encoded, err := json.Marshal(details["content"])
	if err != nil {
		t.Fatalf("marshal content: %v", err)
	}
	if len(encoded) == 0 || encoded[0] != '[' {
		t.Errorf("content marshals to %s, want a JSON array", encoded)
	}
}

// The absent case, which the COALESCE pattern next door makes easy to get
// wrong: a text item has no attachment row, and must not gain empty
// `name`/`bucket`/`filepath`/`attachment_type` keys. A filepath of "//" would
// route the client's download straight at artifact storage
// (imageAttachment.helpers.ts:78) for a message that has no file at all.
func TestListMessageGroupsTextItemGainsNoAttachmentKeys(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repo := NewConversationsRepo(pool)
	conversationUUID, groupID := seedAttachmentTranscript(t, repo)
	seedAttachmentTextItem(t, repo, groupID, 0, "no file here")

	items := attachmentGroupItems(t, singleAttachmentGroup(t, repo, conversationUUID))
	if len(items) != 1 {
		t.Fatalf("group returned %d items, want the single text item", len(items))
	}
	details := attachmentItemDetailsOf(t, items[0])
	if got, want := details["content"], "no file here"; got != want {
		t.Errorf("item_details[\"content\"] = %#v, want %#v", got, want)
	}
	for _, key := range []string{"name", "bucket", "filepath", "attachment_type"} {
		if got, present := details[key]; present {
			t.Errorf("text item's item_details carries attachment key %q = %#v; it must be absent", key, got)
		}
	}
}

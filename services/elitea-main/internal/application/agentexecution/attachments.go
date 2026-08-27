package agentexecution

// #606 part 2: the WRITE side of `chat_messages_attachment`.
//
// Part 1 gave the table an owner (migrations/tenant/0127) and taught
// ConversationsRepo to READ and DELETE its rows. Nothing produced them, so the
// read path had nothing to render: an upload's bytes were durable
// (internal/api/v2/conversations/attachments.go) and listed in
// `chat_conversations.meta.attachments`, but no row associated a file with the
// message it was sent with, so it never appeared inline in the transcript and
// per-message cleanup had nothing to iterate.
//
// The producer is the ADMISSION transaction, not the worker: the worker writes
// no chat rows at all, and message groups are created in exactly two places
// (InsertCurrentApplicationTurn / InsertCurrentAdhocTurn). Attaching the items
// there is what makes "the question group and its attachments exist together
// or not at all" a property of the database rather than of a retry policy.

import (
	"bytes"
	"encoding/json"
	"mime"
	"path"
	"strconv"
	"strings"
)

const (
	// AttachmentKindImage / AttachmentKindDocument are two of pylon's three
	// `attachment_type` values. The third, "text", is deliberately not
	// reachable here — see AttachmentKind.
	AttachmentKindImage    = "image"
	AttachmentKindDocument = "document"

	// maxCurrentTurnAttachments bounds how many item+payload row pairs one
	// admission may add to its own transaction. It is NOT a pylon rule —
	// pylon iterates `attachments_info` unbounded — it is a bound on this
	// transaction's size: the start body cap is 512 KiB
	// (internal/api/v2/agentexecution/route.go), and a filepath costs ~20
	// bytes, so an unbounded loop would admit a request asking for ~25k
	// inserts inside the same transaction that holds the runtime
	// execution/outbox rows. 64 is far above anything the client produces
	// (one entry per file the user picked in the composer) and far below the
	// point where the transaction becomes a availability problem.
	maxCurrentTurnAttachments = 64

	// varchar(256) in migrations/tenant/0127. Rejecting here rather than
	// letting Postgres raise 22001 keeps a client-supplied value from turning
	// the whole admission into a 500.
	maxAttachmentFieldBytes = 256
)

// CurrentTurnAttachmentRef is one attachment exactly as the client addressed
// it: the (bucket, name) pair its `filepath` parsed into. The route parses;
// this package classifies, generates the item identity and builds the payload,
// so the HTTP layer never decides what goes in a column.
type CurrentTurnAttachmentRef struct {
	Bucket string
	Name   string
}

// CurrentTurnAttachment is one fully-formed `attachment_message` item: a
// chat_message_items row plus its 1:1 chat_messages_attachment payload.
//
// ItemID is caller-generated for the same reason QuestionItemID and
// ResponseMessageID are — the repository must be able to write the row without
// reading anything back to learn what it just wrote, and a retried admission
// must address the same rows.
type CurrentTurnAttachment struct {
	ItemID         string
	Name           string
	Bucket         string
	AttachmentType string
	Content        json.RawMessage
}

// ParseAttachmentFilepath splits `/{bucket}/{name}` the way pylon's
// parse_filepath does (legacy/plugins/elitea_core/utils/attachments.py:33-39):
// strip ONE leading slash, then split on the FIRST remaining slash.
//
// The consequence is load-bearing and is not a bug: the upload endpoint keys
// objects `{conversationUUID}/{sanitizedFilename}` (attachments.go's
// finalizeAttachment), so `/chat-attachments/<uuid>/report.pdf` yields bucket
// `chat-attachments` and name `<uuid>/report.pdf`. The name KEEPS the
// conversation-uuid prefix. That is what makes `name` address the stored
// object, and it is what ConversationsRepo.DeleteMessage feeds back to the
// object store, and what its ListMessageGroups reassembles into `filepath` as
// "/" + bucket + "/" + name. Trimming the prefix to a bare basename here would
// leave every attachment's bytes un-deletable and its filepath wrong.
func ParseAttachmentFilepath(filepath string) (CurrentTurnAttachmentRef, bool) {
	trimmed := strings.TrimPrefix(filepath, "/")
	bucket, name, found := strings.Cut(trimmed, "/")
	if !found || bucket == "" || name == "" ||
		len(bucket) > maxAttachmentFieldBytes || len(name) > maxAttachmentFieldBytes ||
		strings.ContainsAny(bucket, "\x00\r\n") || strings.ContainsAny(name, "\x00\r\n") {
		return CurrentTurnAttachmentRef{}, false
	}
	return CurrentTurnAttachmentRef{Bucket: bucket, Name: name}, true
}

// AttachmentKind is pylon's `attachment_type`, which is NOT a MIME type: the
// column holds one of exactly "text", "image" or "document"
// (utils/attachments.py:140-169 / :223 / :313 — the processor's own "type").
//
// "text" is unreachable from here on purpose, and that is a real difference
// from pylon rather than an omission. Pylon picks TextToModelProcessor only
// after it has already FETCHED the file's text (the processor raises without
// `text` in additional_params), i.e. the classification is a by-product of
// content extraction. This admission path extracts nothing (see
// attachmentContentScaffold), so a text/code file is classified "document" —
// the same value pylon gives it when extraction has not happened yet.
//
// The image/svg carve-out is shared with, not copied from, the upload path:
// internal/api/v2/conversations/attachments.go's isImageAttachment delegates
// here. Duplicating the rule would let the byte path's size ceiling and the
// item's attachment_type disagree about what an image is after any future
// edit to either copy.
func AttachmentKind(fileName string) string {
	mediaType := mime.TypeByExtension(path.Ext(fileName))
	if strings.HasPrefix(mediaType, "image/") &&
		!strings.HasSuffix(strings.ToLower(fileName), ".svg") {
		return AttachmentKindImage
	}
	return AttachmentKindDocument
}

// attachmentContentScaffold is the creation-time `content` chunk, in pylon's
// shape (utils/attachments.py:288-320, DocumentToModelProcessor.process): a
// JSON ARRAY of chunks, of which exactly one exists at creation time, naming
// the bucket, the filename and the filepath.
//
// WHAT IS DELIBERATELY MISSING, so that nothing downstream mistakes this for a
// complete payload:
//
//   - The extracted document TEXT. Pylon appends it as a SECOND chunk from a
//     separate processing step that runs after the items are created
//     (rpc/chat_all.py:369-377), reading each file through the SDK. That step
//     has no Go equivalent yet and belongs to the worker/SDK port, not to an
//     admission transaction that must not perform IO against object storage
//     while holding the runtime execution rows.
//   - For an image, pylon's ImageToModelProcessor also emits an `image_url`
//     chunk (utils/attachments.py:183-225) carrying base64 bytes. Producing it
//     requires reading the object, so an image gets the same single text chunk
//     here.
//
// The scaffold is NOT an empty array. An empty array is what a caller writes
// when it has computed the content and found none; this is a partial payload
// that names where the file lives, and a later extraction step appending to it
// is exactly what pylon does.
func attachmentContentScaffold(ref CurrentTurnAttachmentRef) json.RawMessage {
	filepath := "/" + ref.Bucket + "/" + ref.Name
	text := strings.Join([]string{
		"Bucket: " + ref.Bucket,
		"Filename: " + ref.Name,
		"filepath: " + filepath,
		"",
		"NOTE: File content may be EMBEDDED in the next message chunk.",
		"If embedded content is provided below, please review it first - the full text is already included.",
		"File reading tools are available if needed for specific operations (search, partial access), but prefer embedded content when available.",
	}, "\n")
	encoded, err := json.Marshal([]map[string]string{{"type": "text", "text": text}})
	if err != nil {
		// Unreachable: the value is a []map[string]string of finite strings.
		return json.RawMessage(`[]`)
	}
	return encoded
}

// currentTurnAttachments turns the client's refs into the items the admission
// transaction writes.
//
// Item ids are derived from the question id with the same namespaced-SHA1
// helper the question and response ids already use, rather than being random:
// a retried start for the same question_id must address the same rows, so the
// identity of an attachment item is a function of the turn, not of when the
// retry happened.
func currentTurnAttachments(
	questionID string,
	refs []CurrentTurnAttachmentRef,
) ([]CurrentTurnAttachment, error) {
	if len(refs) == 0 {
		return nil, nil
	}
	if len(refs) > maxCurrentTurnAttachments {
		return nil, ErrInvalidCurrentAgentStart
	}
	attachments := make([]CurrentTurnAttachment, 0, len(refs))
	for index, ref := range refs {
		if ref.Bucket == "" || ref.Name == "" ||
			len(ref.Bucket) > maxAttachmentFieldBytes || len(ref.Name) > maxAttachmentFieldBytes {
			return nil, ErrInvalidCurrentAgentStart
		}
		attachments = append(attachments, CurrentTurnAttachment{
			ItemID:         currentTurnUUID(questionID, "attachment-item-"+strconv.Itoa(index+1)),
			Name:           ref.Name,
			Bucket:         ref.Bucket,
			AttachmentType: AttachmentKind(ref.Name),
			Content:        attachmentContentScaffold(ref),
		})
	}
	return attachments, nil
}

// validCurrentTurnAttachments is the Validate() half, re-checked on the struct
// the repository is actually handed rather than on the request that produced
// it — every other field of a turn is validated the same way.
func validCurrentTurnAttachments(attachments []CurrentTurnAttachment) bool {
	if len(attachments) > maxCurrentTurnAttachments {
		return false
	}
	for _, attachment := range attachments {
		if !validUUID(attachment.ItemID) ||
			!validCurrentAgentText(attachment.Name, maxAttachmentFieldBytes) ||
			!validCurrentAgentText(attachment.Bucket, maxAttachmentFieldBytes) ||
			(attachment.AttachmentType != AttachmentKindImage &&
				attachment.AttachmentType != AttachmentKindDocument) ||
			!validJSONArray(attachment.Content) {
			return false
		}
	}
	return true
}

func cloneCurrentTurnAttachments(attachments []CurrentTurnAttachment) []CurrentTurnAttachment {
	if attachments == nil {
		return nil
	}
	clone := make([]CurrentTurnAttachment, len(attachments))
	for index, attachment := range attachments {
		clone[index] = attachment
		clone[index].Content = bytes.Clone(attachment.Content)
	}
	return clone
}

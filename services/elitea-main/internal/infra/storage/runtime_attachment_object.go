package storage

import (
	"context"
	"errors"
	"math"
	"strings"
	"unicode/utf8"
)

const (
	// RuntimeAttachmentObjectSchemaVersion is the exact discriminator the
	// worker compares before it will read the body at all
	// (ATTACHMENT_OBJECT_SCHEMA,
	// services/elitea-worker-rust/src/transport/runtime_context.rs).
	RuntimeAttachmentObjectSchemaVersion = "elitea.runtime.attachment-object.v1"

	// maxRuntimeAttachmentObjectBytes bounds the OBJECT, not the response.
	//
	// It is deliberately far below the 150 MiB an attachment upload accepts
	// (internal/api/v2/conversations/attachments.go). This route exists to put
	// a document's text in front of a model inside one turn's prompt, and the
	// prompt — not the disk — is the real ceiling: 128 KiB of text is already
	// ~32k tokens, more than most turns can afford, and the bytes are buffered
	// whole so the digest can be computed before anything is sent. A larger
	// file is REFUSED rather than truncated: half a document read as though it
	// were the whole one is worse than a file the model is only told about,
	// which is exactly what the worker falls back to.
	maxRuntimeAttachmentObjectBytes = 128 * 1024

	// maxRuntimeAttachmentObjectResponseBytes is the envelope's own ceiling,
	// restated here so this side REFUSES rather than sends a body the client
	// will reject after buffering it (MAX_ATTACHMENT_OBJECT_BYTES on the worker
	// side). It is 8x the object cap because the content travels as a JSON
	// STRING: a text file made entirely of control characters escapes to six
	// characters per byte, so an object at the cap can legitimately serialize
	// to ~768 KiB plus the identity envelope.
	maxRuntimeAttachmentObjectResponseBytes = 1024 * 1024

	runtimeContextStageAttachmentRead         = "attachment_object_read"
	runtimeContextStageAttachmentConversation = "attachment_conversation"

	// canonicalUUIDLength is 8-4-4-4-12 with its four separators. The claim's
	// conversation identity is compared against this shape before it is used
	// as an authorization prefix — see conversationScopedAttachmentKey.
	canonicalUUIDLength = 36
)

// AttachmentObjectRecord is one stored chat attachment exactly as object
// storage holds it, already bounded by the caller's cap.
//
// MediaType is the value the UPLOAD recorded (elitea_storage.objects.media_type),
// carried for the worker's diagnostics only. It is deliberately not the gate on
// what may be returned: it is whatever the browser put in the multipart part,
// so a .md arrives as application/octet-stream on one client and text/markdown
// on another. The bytes decide instead — see RuntimeAttachmentObjectService.
type AttachmentObjectRecord struct {
	Bucket     string
	Name       string
	MediaType  string
	ByteLength int64
	Content    []byte
}

// AttachmentObjectSource opens one stored chat attachment inside the project
// the CLAIM selected. Implementations must not accept a project from the
// request: the caller passes the authorized one, and must additionally refuse
// any object that the chat upload path did not write.
type AttachmentObjectSource interface {
	ReadAttachmentObject(
		ctx context.Context,
		projectID int64,
		bucket string,
		name string,
		maxBytes int64,
	) (AttachmentObjectRecord, error)
}

// RuntimeAttachmentObjectContext is the wire document. Its fields are the
// complete set the worker accepts: `AttachmentObjectResponse` is
// `deny_unknown_fields`, so one extra key here fails every attachment read with
// a malformed-response error that names nothing.
//
// Content is the object's bytes as TEXT. There is no base64 alternative and no
// binary branch on purpose: the only consumer splices this into a model prompt
// as a `{"type":"text"}` chunk, so bytes that are not text have no destination
// here. A PDF or a .docx is refused (422) and the worker falls back to
// announcing the file by name — the same outcome as before this route existed,
// which is why the runtime never has to grow an extractor to stay correct.
type RuntimeAttachmentObjectContext struct {
	SchemaVersion string `json:"schema_version"`
	ProjectID     int64  `json:"project_id"`
	Bucket        string `json:"bucket"`
	Name          string `json:"name"`
	MediaType     string `json:"media_type"`
	ByteLength    int64  `json:"byte_length"`
	Content       string `json:"content"`
}

// RuntimeAttachmentObjectService serves one stored chat attachment's TEXT to
// the native runtime, under the same durable claim that already authorized the
// turn the file was attached to.
//
// It exists because the native runtime has no other way to read those bytes:
// it holds no vault, materializes no `artifact` toolkit family, and its egress
// allowlist reaches the model gateway alone. Until this route existed a
// document chunk flagged `needs_content_extraction` reached the model as its
// FILENAME and nothing else (services/elitea-worker-rust/src/agents/attachments.rs).
//
// THE AUTHORIZATION IS THE WHOLE POINT, and it has three independent parts:
//
//   - WHICH CLAIM. The authorizer is the agent-scoped one, so an index.ingest.v1
//     claim — which carries a perfectly real resource_project_id — is refused
//     before any lookup happens. An index workload has no conversation and no
//     business reading chat attachments.
//   - WHICH PROJECT. Taken from the claimed execution row and passed to the
//     source, never read from the request. `storage.ObjectRef` is
//     project-scoped by construction, so the bytes of another tenant are not
//     addressable from here at all.
//   - WHICH CONVERSATION. The claim's own conversation (the agent execution
//     row's client_stream_id) must PREFIX the object key. That is the same
//     sentence admission enforces when it accepts the attachment in the first
//     place (internal/application/agentexecution/attachments.go,
//     currentTurnAttachments): the upload endpoint keys every chat object
//     `{conversationUUID}/{filename}`, so requiring the prefix is exactly
//     "this file was uploaded to this conversation". Without it, a live claim
//     for one conversation could read every attachment in the project — which
//     is the one thing a route that hands raw bytes to a model must not allow.
//
// The request selects only the (bucket, name) pair, and it selects INSIDE that
// project and that conversation.
type RuntimeAttachmentObjectService struct {
	authorizer AgentRuntimeContextAuthorizer
	objects    AttachmentObjectSource
	maxBytes   int64
}

func NewRuntimeAttachmentObjectService(
	authorizer AgentRuntimeContextAuthorizer,
	objects AttachmentObjectSource,
) (*RuntimeAttachmentObjectService, error) {
	if authorizer == nil || objects == nil {
		return nil, errors.New("runtime attachment object dependencies are required")
	}
	return &RuntimeAttachmentObjectService{
		authorizer: authorizer,
		objects:    objects,
		maxBytes:   maxRuntimeAttachmentObjectBytes,
	}, nil
}

// Resolve reads one stored attachment for the claimed execution.
//
// The order is the security boundary: authorize first, and take the project and
// the conversation ONLY from what the claim resolved.
//
// The error taxonomy is chosen so that an operator can tell the three failures
// apart, because they mean very different things:
//
//	ErrContentUnauthorized  the claim was rejected, OR it was good and named a
//	                        different conversation than the object does. Both
//	                        are 403: a caller must not be able to probe which
//	                        conversation an object belongs to by reading status
//	                        codes.
//	ErrContentNotFound      the claim was good, the conversation matched, and
//	                        there is no such object.
//	ErrContentRejected      the object exists and cannot be served as text —
//	                        too large, or not UTF-8. The worker treats this the
//	                        same as "no route": it announces the file and moves
//	                        on.
func (service *RuntimeAttachmentObjectService) Resolve(
	ctx context.Context,
	claim ContentClaim,
	bucket string,
	name string,
) (RuntimeAttachmentObjectContext, error) {
	if service == nil || service.authorizer == nil || service.objects == nil ||
		service.maxBytes <= 0 {
		return RuntimeAttachmentObjectContext{}, runtimeContextUnavailable(
			runtimeContextStageAttachmentRead,
		)
	}
	if err := ctx.Err(); err != nil {
		return RuntimeAttachmentObjectContext{}, err
	}
	if !addressableAttachmentBucket(bucket) || !addressableAttachmentKey(name) {
		return RuntimeAttachmentObjectContext{}, ErrContentNotFound
	}
	authorization, err := service.authorizer.AuthorizeAgentRuntimeContext(ctx, claim)
	if err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return RuntimeAttachmentObjectContext{}, contextErr
		}
		if errors.Is(err, ErrContentUnauthorized) {
			return RuntimeAttachmentObjectContext{}, ErrContentUnauthorized
		}
		return RuntimeAttachmentObjectContext{}, runtimeContextUnavailable(
			runtimeContextStageClaimAuthorize,
		)
	}
	if authorization.ResourceProjectID <= 0 ||
		authorization.ResourceProjectID > math.MaxInt32 {
		return RuntimeAttachmentObjectContext{}, runtimeContextUnavailable(
			runtimeContextStageProjectIdentity,
		)
	}
	// A claim with no usable conversation is an UNAVAILABLE, not a refusal:
	// every agent execution row carries a NOT NULL client_stream_id
	// (migrations/shared/0055_agent_execution_admission.sql), so an empty or
	// malformed one means this service and the admission path disagree about
	// the row's shape, which an operator has to see rather than read as a
	// caller's mistake.
	if !canonicalConversationIdentity(authorization.ConversationID) {
		return RuntimeAttachmentObjectContext{}, runtimeContextUnavailable(
			runtimeContextStageAttachmentConversation,
		)
	}
	if !conversationScopedAttachmentKey(authorization.ConversationID, name) {
		return RuntimeAttachmentObjectContext{}, ErrContentUnauthorized
	}

	record, err := service.objects.ReadAttachmentObject(
		ctx,
		authorization.ResourceProjectID,
		bucket,
		name,
		service.maxBytes,
	)
	if err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return RuntimeAttachmentObjectContext{}, contextErr
		}
		switch {
		case errors.Is(err, ErrContentNotFound):
			return RuntimeAttachmentObjectContext{}, ErrContentNotFound
		case errors.Is(err, ErrContentRejected):
			return RuntimeAttachmentObjectContext{}, ErrContentRejected
		}
		return RuntimeAttachmentObjectContext{}, runtimeContextUnavailable(
			runtimeContextStageAttachmentRead,
		)
	}
	// Repeated against what the URL asked for even though the source already
	// filtered on both. The duplication is deliberate and cheap: the worker
	// validates the same pair on its side and would reject a mismatched
	// document as an authorization failure with no diagnosis, so a
	// disagreement is worth naming here instead.
	if record.Bucket != bucket || record.Name != name {
		return RuntimeAttachmentObjectContext{}, ErrContentNotFound
	}
	if int64(len(record.Content)) > service.maxBytes ||
		record.ByteLength != int64(len(record.Content)) {
		return RuntimeAttachmentObjectContext{}, ErrContentRejected
	}
	// THE CONTENT DISCIPLINE. An empty file has no text to add and a
	// non-UTF-8 one has no text at all; both are refused rather than sent as an
	// empty or lossy chunk, because a model shown an empty "file content"
	// answers as though the file were empty, while a model shown only the
	// header knows it was not read.
	if len(record.Content) == 0 || !utf8.Valid(record.Content) {
		return RuntimeAttachmentObjectContext{}, ErrContentRejected
	}
	return RuntimeAttachmentObjectContext{
		SchemaVersion: RuntimeAttachmentObjectSchemaVersion,
		ProjectID:     authorization.ResourceProjectID,
		Bucket:        record.Bucket,
		Name:          record.Name,
		MediaType:     record.MediaType,
		ByteLength:    record.ByteLength,
		Content:       string(record.Content),
	}, nil
}

// conversationScopedAttachmentKey is the cross-conversation refusal.
//
// `name` is the object KEY, conversation prefix included — the upload endpoint
// keys every chat attachment `{conversationUUID}/{sanitised filename}` and the
// admission path refuses any reference without that prefix. This restates the
// same test against the conversation the CLAIM resolved, so the two ends cannot
// drift into disagreeing about which files a turn may read.
//
// The trailing segment must be non-empty: `{uuid}/` addresses no object, and
// admitting it would turn the prefix test into a bare "starts with a uuid".
func conversationScopedAttachmentKey(conversationID, name string) bool {
	prefix := conversationID + "/"
	return strings.HasPrefix(name, prefix) && len(name) > len(prefix)
}

// canonicalConversationIdentity accepts only a lowercase canonical UUID.
//
// Shape, not merely non-emptiness: this value becomes an authorization PREFIX,
// and a value that could be empty or could be a bare "1" would make the prefix
// test match keys it was never meant to. `chat_conversations.uuid` is a real
// uuid column and Postgres renders it lowercase-canonical, so nothing
// legitimate is excluded.
func canonicalConversationIdentity(value string) bool {
	if len(value) != canonicalUUIDLength {
		return false
	}
	for index := range len(value) {
		character := value[index]
		if index == 8 || index == 13 || index == 18 || index == 23 {
			if character != '-' {
				return false
			}
			continue
		}
		hexadecimal := (character >= '0' && character <= '9') ||
			(character >= 'a' && character <= 'f')
		if !hexadecimal {
			return false
		}
	}
	return true
}

// addressableAttachmentBucket / addressableAttachmentKey restate the rules
// NewObjectRef's own bucketPattern and validateKey apply, and the extra ones
// internal/application/agentexecution/attachments.go applies on the way in.
//
// They are restated rather than delegated because this is the REFUSAL boundary:
// a name that reaches NewObjectRef and fails there is an internal error at the
// bottom of a stack, while one refused here is a plain 404 with the claim never
// spent. Length and control characters are already checked by the route's own
// claimPathPart before either is called.
func addressableAttachmentBucket(bucket string) bool {
	if len(bucket) < 2 || len(bucket) > 63 {
		return false
	}
	if bucket[0] < 'a' || bucket[0] > 'z' {
		return false
	}
	for index := 1; index < len(bucket); index++ {
		character := bucket[index]
		valid := (character >= 'a' && character <= 'z') ||
			(character >= '0' && character <= '9') || character == '-'
		if !valid {
			return false
		}
	}
	return true
}

func addressableAttachmentKey(key string) bool {
	if key == "" || len(key) > maxAttachmentReferenceBytes ||
		strings.HasPrefix(key, "/") || strings.HasSuffix(key, "/") ||
		strings.Contains(key, "//") {
		return false
	}
	for _, segment := range strings.Split(key, "/") {
		if segment == "." || segment == ".." {
			return false
		}
	}
	return true
}

// maxAttachmentReferenceBytes is varchar(256) in migrations/tenant/0127, which
// is also what the admission path refuses beyond (maxAttachmentFieldBytes) and
// what the worker refuses beyond (MAX_ATTACHMENT_FIELD_BYTES). A reference
// longer than this could not have been stored, so serving it would mean
// serving something no attachment row can name.
const maxAttachmentReferenceBytes = 256

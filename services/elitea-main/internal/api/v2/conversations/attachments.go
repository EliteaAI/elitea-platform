package conversations

// S20a: chat attachment byte path. Legacy's chunked-upload contract
// (legacy/plugins/elitea_core/api/v2/attachments.py, utils/attachments.py) —
// form fields file_id/chunk_index (0-based)/total_chunks/file_name, one
// chunk per POST, disk-buffered under a per-file_id temp directory, "all
// chunks received" detected by counting files on disk, merged in
// chunk_index order once complete — is ported here with Postgres standing
// in for local disk (see migrations/shared/0059_attachment_chunks.sql):
// this file's own ADR-0016 standing constraint rules out any-replica local
// buffering, since chunk N and chunk N+1 of the same upload can land on two
// different pods with no sticky session.
//
// No claim/lock guards the merge step deliberately: if two concurrent
// requests both observe "all chunks present" (the last two chunks of one
// upload arriving on two different replicas within the same race window),
// both independently read the same committed chunk rows, both merge and
// storage.ObjectStore.Put the identical bytes to the identical deterministic
// key (last-writer-wins, not a torn write), and both call DeleteChunks
// (idempotent — the second delete just removes zero rows). Redundant work
// on that rare race, never corrupted output — the same trade-off S14's
// sweeper already accepts for its own duplicate-tick idempotency, not a new
// risk this stage introduces.
//
// Bytes are written through the S6/S9 metadata tables (a reserved
// project-scoped "system" bucket, elitea_storage.buckets/objects), not a
// bare storage.ObjectStore.Put with no metadata row — this is a deliberate
// choice over the simpler bypass: it makes S14's retention sweeper apply to
// attachments (legacy's chat_bucket_retention_days, 365 days by default,
// otherwise has no Go-side equivalent at all) and folds attachment bytes
// into the same SumProjectBytes aggregate every other artifact write
// already contributes to.
//
// One legacy DB write is deliberately NOT ported: legacy also inserts a
// chat_messages_attachment row (schema c.POSTGRES_TENANT_SCHEMA, polymorphic
// child of message_items) so a chat message can render its attachments
// inline. That table is not in this service's current migration baseline
// (internal/db/schema/current_agent_chat_baseline.sql has chat_conversations/
// chat_message_items/chat_messages_text/chat_messages_context — no
// chat_messages_attachment) — unlike centry.project/centry.notifications
// (externally-owned tables this service references but never creates),
// there is no existing "current baseline" doc establishing who owns this
// table's DDL today. Inventing a migration for it here risks colliding with
// whatever process (legacy's own Alembic history, most likely) already owns
// it in the real shared database. Left as an explicit open question for a
// human owner, the same treatment S13/S14/S18 give their own external-
// ownership gaps: does Go take over migration ownership of
// chat_messages_attachment, is it provisioned by a shared process this
// service should just start writing to, or does the chat UI's attachment
// rendering move onto elitea_storage.objects as a separate, later,
// consumer-side change (out of this plan's scope per "Any change to
// consumer code" in "Explicitly out of scope")? Until answered, an
// uploaded attachment's bytes are durable and downloadable through the
// generic artifact API, but does not yet appear inline in the chat
// transcript the way a legacy attachment does.

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

// Legacy defaults (vault secrets chat_max_upload_size_mb /
// chat_max_file_upload_size_mb / chat_max_image_upload_size_mb /
// chat_bucket_retention_days) — this service has no per-project vault-secret
// policy mechanism anywhere else, so these are env-overridable constants
// instead, matching objects.go's ARTIFACT_MAX_OBJECT_BYTES precedent exactly
// rather than inventing a new per-project override path for this one stage.
const (
	defaultAttachmentMaxTotalMB = 150
	defaultAttachmentMaxFileMB  = 150
	defaultAttachmentMaxImageMB = 3
	defaultAttachmentRetention  = 365
	defaultAttachmentBucketName = "chat-attachments"
	attachmentMaxChunkBytes     = 5 << 20 // wire contract: 5 MiB per chunk
	attachmentMultipartMemLimit = 8 << 20 // in-memory part threshold before ParseMultipartForm spills to temp files
)

// fileIDPattern matches legacy's ChunkUploadPayload.file_id validation — it
// is joined into a storage key, so the same traversal-guard shape legacy
// itself enforces before ever touching a filesystem path.
var fileIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// AttachmentChunk is one previously-received chunk, read back in
// chunk_index order for the merge step.
type AttachmentChunk struct {
	ChunkIndex int32
	Bytes      []byte
}

// AttachmentStore is the S6/S9/S20a Postgres metadata this handler needs,
// expressed without importing internal/infra/db/repos directly: that
// package's own conversations.go already imports this package (to satisfy
// the Repository interface above with wire-shape DTOs like Conversation/
// ListResponse), so importing it back here would be an import cycle.
// router.go, which imports both packages freely, supplies the concrete
// adapter wrapping the real repos.Artifact{Buckets,Objects}Repository and
// repos.AttachmentChunksRepository.
type AttachmentStore interface {
	// AttachmentBucketName resolves elitea_storage.project_storage_policy's
	// attachment_bucket for projectID, or "" when unset (the caller falls
	// back to defaultAttachmentBucketName).
	AttachmentBucketName(ctx context.Context, projectID int64) (string, error)
	// RequireAttachmentBucket returns the reserved system bucket's database
	// ID and its own ExpiresAt (stamped onto every object written into it),
	// creating the bucket row on first use.
	RequireAttachmentBucket(ctx context.Context, projectID int64, bucketName string, retentionDays int32) (bucketID int64, bucketExpiresAt *time.Time, err error)
	RecordAttachmentObject(ctx context.Context, bucketID int64, key string, byteLength int64, mediaType string, expiresAt *time.Time) error

	UpsertAttachmentChunk(ctx context.Context, projectID int64, conversationID, fileID string, chunkIndex, totalChunks int32, fileName, contentType string, body []byte) error
	CountAttachmentChunks(ctx context.Context, projectID int64, conversationID, fileID string) (int64, error)
	ListAttachmentChunksOrdered(ctx context.Context, projectID int64, conversationID, fileID string) ([]AttachmentChunk, error)
	DeleteAttachmentChunks(ctx context.Context, projectID int64, conversationID, fileID string) error
}

func attachmentMaxTotalBytes() int64 {
	return attachmentEnvMB("ARTIFACT_ATTACHMENT_MAX_TOTAL_MB", defaultAttachmentMaxTotalMB)
}
func attachmentMaxFileBytes() int64 {
	return attachmentEnvMB("ARTIFACT_ATTACHMENT_MAX_FILE_MB", defaultAttachmentMaxFileMB)
}
func attachmentMaxImageBytes() int64 {
	return attachmentEnvMB("ARTIFACT_ATTACHMENT_MAX_IMAGE_MB", defaultAttachmentMaxImageMB)
}

func attachmentRetentionDays() int32 {
	if raw := os.Getenv("ARTIFACT_ATTACHMENT_RETENTION_DAYS"); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			return int32(v)
		}
	}
	return defaultAttachmentRetention
}

func attachmentEnvMB(envVar string, defaultMB int64) int64 {
	if raw := os.Getenv(envVar); raw != "" {
		if v, err := strconv.ParseInt(raw, 10, 64); err == nil && v > 0 {
			return v << 20
		}
	}
	return defaultMB << 20
}

// attachmentCreated is legacy's AttachmentMessageItemCreated wire shape —
// preserved for whatever caller still expects it, even though the
// underlying metadata store below is now elitea_storage.*, not
// chat_messages_attachment.
type attachmentCreated struct {
	Filepath string `json:"filepath"`
	FileSize int64  `json:"file_size"`
}

// isImageAttachment mirrors process_uploaded_files' own is_image check:
// image/* by extension, except .svg (kept on the regular file limit,
// matching legacy exactly).
func isImageAttachment(fileName string) bool {
	mt := mime.TypeByExtension(path.Ext(fileName))
	return strings.HasPrefix(mt, "image/") && !strings.HasSuffix(strings.ToLower(fileName), ".svg")
}

// sanitizeAttachmentFilename strips any directory component and control
// characters a client-supplied file_name/filename could carry — the actual
// traversal guard is storage.NewObjectRef's own validateKey (S1), this just
// keeps an otherwise-legitimate filename with e.g. a leading path from
// being rejected outright.
func sanitizeAttachmentFilename(name string) string {
	name = path.Base(strings.ReplaceAll(name, "\\", "/"))
	var b strings.Builder
	for _, r := range name {
		if r < 0x20 || r == 0x7f {
			continue
		}
		b.WriteRune(r)
	}
	cleaned := b.String()
	if cleaned == "" || cleaned == "." || cleaned == ".." {
		return "attachment"
	}
	return cleaned
}

// writeAttachmentBytes is AddAttachments' multipart/form-data branch (S20a).
func (h *Handler) writeAttachmentBytes(w http.ResponseWriter, r *http.Request) {
	if h.store == nil || h.attachments == nil {
		apierr.Write(w, apierr.Internal("attachment storage is not configured"))
		return
	}

	projectIDStr := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	projectID, err := strconv.ParseInt(projectIDStr, 10, 64)
	if err != nil || projectID <= 0 {
		apierr.Write(w, apierr.BadRequest("invalid project id"))
		return
	}

	// A single request body can carry at most one chunk (bounded at
	// attachmentMaxChunkBytes) or one whole non-chunked file (bounded at
	// attachmentMaxFileBytes) — the larger of the two, plus slack for
	// multipart field/boundary overhead, bounds the request the same way
	// S12 bounds every other upload path (objects.go).
	limit := attachmentMaxFileBytes()
	if attachmentMaxChunkBytes > limit {
		limit = attachmentMaxChunkBytes
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit+1<<20)

	if err := r.ParseMultipartForm(attachmentMultipartMemLimit); err != nil {
		apierr.Write(w, apierr.BadRequest("request is not multipart/form-data or exceeds the upload limit"))
		return
	}
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()

	file, header, err := r.FormFile("file")
	if err != nil {
		apierr.Write(w, apierr.BadRequest("No chunk file provided"))
		return
	}
	defer func() { _ = file.Close() }()
	content, err := io.ReadAll(file)
	if err != nil {
		apierr.Write(w, apierr.BadRequest("read uploaded file: "+err.Error()))
		return
	}

	fileID := r.FormValue("file_id")
	chunkIndexStr := r.FormValue("chunk_index")
	totalChunksStr := r.FormValue("total_chunks")
	fileName := r.FormValue("file_name")
	if fileName == "" {
		fileName = header.Filename
	}
	contentType := header.Header.Get("Content-Type")

	// Chunked iff all three chunk-identifying fields are present — mirrors
	// handle_chunked_upload's own dispatch (`all([file_id, chunk_index is
	// not None, total_chunks, file_name])`).
	if fileID == "" || chunkIndexStr == "" || totalChunksStr == "" {
		h.finalizeAttachment(w, r.Context(), projectID, projectIDStr, conversationID, fileName, contentType, content)
		return
	}

	if !fileIDPattern.MatchString(fileID) {
		apierr.Write(w, apierr.BadRequest(fmt.Sprintf("Invalid chunk parameters: file_id must match %s", fileIDPattern.String())))
		return
	}
	chunkIndex, err := strconv.Atoi(chunkIndexStr)
	if err != nil || chunkIndex < 0 {
		apierr.Write(w, apierr.BadRequest("Invalid chunk parameters: chunk_index must be a non-negative integer"))
		return
	}
	totalChunks, err := strconv.Atoi(totalChunksStr)
	if err != nil || totalChunks <= 0 {
		apierr.Write(w, apierr.BadRequest("Invalid chunk parameters: total_chunks must be a positive integer"))
		return
	}
	if chunkIndex >= totalChunks {
		apierr.Write(w, apierr.BadRequest("Invalid chunk parameters: chunk_index must be less than total_chunks"))
		return
	}
	if len(content) > attachmentMaxChunkBytes {
		apierr.Write(w, apierr.BadRequest(fmt.Sprintf("Chunk exceeds the %d MB limit", attachmentMaxChunkBytes>>20)))
		return
	}

	if err := h.attachments.UpsertAttachmentChunk(r.Context(), projectID, conversationID, fileID, int32(chunkIndex), int32(totalChunks), fileName, contentType, content); err != nil {
		apierr.Write(w, apierr.Internal(err.Error()))
		return
	}

	received, err := h.attachments.CountAttachmentChunks(r.Context(), projectID, conversationID, fileID)
	if err != nil {
		apierr.Write(w, apierr.Internal(err.Error()))
		return
	}
	if received < int64(totalChunks) {
		writeJSON(w, http.StatusAccepted, map[string]any{
			"status":       "chunk_received",
			"file_id":      fileID,
			"chunk_index":  chunkIndex,
			"total_chunks": totalChunks,
			"message":      fmt.Sprintf("Chunk %d/%d received", chunkIndex+1, totalChunks),
		})
		return
	}

	chunks, err := h.attachments.ListAttachmentChunksOrdered(r.Context(), projectID, conversationID, fileID)
	if err != nil {
		apierr.Write(w, apierr.Internal(err.Error()))
		return
	}
	merged := make([]byte, 0, len(chunks)*attachmentMaxChunkBytes)
	for _, c := range chunks {
		merged = append(merged, c.Bytes...)
	}

	h.finalizeAttachment(w, r.Context(), projectID, projectIDStr, conversationID, fileName, contentType, merged)

	// Always runs, success or failure — matches legacy's own `finally:
	// cleanup_chunks(...)`. A failed delete just leaves harmless,
	// self-healing rows (DeleteAttachmentChunks' own doc comment).
	_ = h.attachments.DeleteAttachmentChunks(r.Context(), projectID, conversationID, fileID)
}

// finalizeAttachment validates size limits, writes the object through the
// S6/S9 metadata tables, and writes the response — the shared tail of both
// the chunked and the plain-multipart paths above, mirroring legacy's own
// process_uploaded_files, which both call identically.
func (h *Handler) finalizeAttachment(w http.ResponseWriter, ctx context.Context, projectID int64, projectIDStr, conversationID, fileName, contentType string, content []byte) {
	isImage := isImageAttachment(fileName)
	maxFileBytes := attachmentMaxFileBytes()
	kind := "File"
	if isImage {
		maxFileBytes = attachmentMaxImageBytes()
		kind = "Image"
	}
	if int64(len(content)) > maxFileBytes {
		apierr.Write(w, apierr.BadRequest(fmt.Sprintf("%s %q exceeds the %d MB limit", kind, fileName, maxFileBytes>>20)))
		return
	}
	if int64(len(content)) > attachmentMaxTotalBytes() {
		apierr.Write(w, apierr.BadRequest(fmt.Sprintf("Total upload size exceeds the limit of %d MB", attachmentMaxTotalBytes()>>20)))
		return
	}

	bucketName, err := h.attachments.AttachmentBucketName(ctx, projectID)
	if err != nil {
		apierr.Write(w, apierr.Internal("get project storage policy: "+err.Error()))
		return
	}
	if bucketName == "" {
		bucketName = defaultAttachmentBucketName
	}

	bucketID, bucketExpiresAt, err := h.attachments.RequireAttachmentBucket(ctx, projectID, bucketName, attachmentRetentionDays())
	if err != nil {
		apierr.Write(w, apierr.Internal("get or create attachment bucket: "+err.Error()))
		return
	}

	// Legacy prefixes the stored filename with the conversation's UUID
	// (f"{conversation.uuid}/{sanitized_filename}"); conversationID here is
	// already that identifier — chi.URLParam, not a database lookup.
	key := conversationID + "/" + sanitizeAttachmentFilename(fileName)
	ref, err := storage.NewObjectRef(projectIDStr, bucketName, key)
	if err != nil {
		apierr.Write(w, apierr.BadRequest("invalid attachment file name: "+err.Error()))
		return
	}

	info, err := h.store.Put(ctx, ref, bytes.NewReader(content), storage.PutOptions{
		ContentType:   contentType,
		ContentLength: int64(len(content)),
	})
	if err != nil {
		apierr.Write(w, apierr.Internal("store attachment: "+err.Error()))
		return
	}

	if err := h.attachments.RecordAttachmentObject(ctx, bucketID, info.Key, info.Size, contentType, bucketExpiresAt); err != nil {
		apierr.Write(w, apierr.Internal("record attachment metadata: "+err.Error()))
		return
	}

	writeJSON(w, http.StatusCreated, []attachmentCreated{{
		Filepath: fmt.Sprintf("/%s/%s", bucketName, info.Key),
		FileSize: info.Size,
	}})
}

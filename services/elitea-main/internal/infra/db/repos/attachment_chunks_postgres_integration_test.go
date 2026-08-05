package repos

import (
	"context"
	"testing"
)

func newAttachmentChunksTestRepo(t *testing.T) *AttachmentChunksRepository {
	t.Helper()
	pool := newPostgresIntegrationPool(t)
	applyPostgresIntegrationMigrations(t, pool)
	repo, err := NewAttachmentChunksRepository(pool)
	if err != nil {
		t.Fatalf("NewAttachmentChunksRepository: %v", err)
	}
	return repo
}

// TestArtifactAttachmentChunksRetryOverwritesNotDoubles proves the S20a
// design's core safety property against real Postgres: a retried
// chunk_index (client timeout, network retry — see the migration's own doc
// comment) overwrites the previous bytes for that index rather than being
// counted twice, so CountChunks never over-reports.
func TestArtifactAttachmentChunksRetryOverwritesNotDoubles(t *testing.T) {
	repo := newAttachmentChunksTestRepo(t)
	ctx := context.Background()
	const projectID, conversationID, fileID = int64(9001), "conv-1", "file-1"

	if err := repo.UpsertChunk(ctx, projectID, conversationID, fileID, 0, 2, "big.bin", "application/octet-stream", []byte("first-attempt")); err != nil {
		t.Fatalf("UpsertChunk (initial): %v", err)
	}
	// Retry of the same chunk_index, different bytes (simulating a
	// resend after a client timeout).
	if err := repo.UpsertChunk(ctx, projectID, conversationID, fileID, 0, 2, "big.bin", "application/octet-stream", []byte("retried")); err != nil {
		t.Fatalf("UpsertChunk (retry): %v", err)
	}

	count, err := repo.CountChunks(ctx, projectID, conversationID, fileID)
	if err != nil {
		t.Fatalf("CountChunks: %v", err)
	}
	if count != 1 {
		t.Fatalf("CountChunks after retry = %d, want 1 (overwrite, not double-count)", count)
	}

	if err := repo.UpsertChunk(ctx, projectID, conversationID, fileID, 1, 2, "big.bin", "application/octet-stream", []byte("second-chunk")); err != nil {
		t.Fatalf("UpsertChunk (second): %v", err)
	}
	count, err = repo.CountChunks(ctx, projectID, conversationID, fileID)
	if err != nil {
		t.Fatalf("CountChunks: %v", err)
	}
	if count != 2 {
		t.Fatalf("CountChunks after both chunks = %d, want 2", count)
	}

	chunks, err := repo.ListChunksOrdered(ctx, projectID, conversationID, fileID)
	if err != nil {
		t.Fatalf("ListChunksOrdered: %v", err)
	}
	if len(chunks) != 2 || chunks[0].ChunkIndex != 0 || string(chunks[0].Bytes) != "retried" || chunks[1].ChunkIndex != 1 || string(chunks[1].Bytes) != "second-chunk" {
		t.Fatalf("ListChunksOrdered = %+v, want [retried, second-chunk] in index order with the retried bytes winning", chunks)
	}

	if err := repo.DeleteChunks(ctx, projectID, conversationID, fileID); err != nil {
		t.Fatalf("DeleteChunks: %v", err)
	}
	count, err = repo.CountChunks(ctx, projectID, conversationID, fileID)
	if err != nil {
		t.Fatalf("CountChunks after delete: %v", err)
	}
	if count != 0 {
		t.Fatalf("CountChunks after delete = %d, want 0", count)
	}
}

// TestArtifactAttachmentChunksAreScopedPerProjectConversationFile proves the
// composite key correctly isolates chunk sets that share a file_id across
// different (project, conversation) pairs — a client-supplied identifier,
// not server-derived like S15's grant IDs, so a collision across tenants is
// a real possibility this schema must not conflate.
func TestArtifactAttachmentChunksAreScopedPerProjectConversationFile(t *testing.T) {
	repo := newAttachmentChunksTestRepo(t)
	ctx := context.Background()
	const sharedFileID = "shared-client-chosen-id"

	if err := repo.UpsertChunk(ctx, 100, "conv-a", sharedFileID, 0, 1, "a.bin", "", []byte("project-100-bytes")); err != nil {
		t.Fatalf("UpsertChunk (project 100): %v", err)
	}
	if err := repo.UpsertChunk(ctx, 200, "conv-a", sharedFileID, 0, 1, "a.bin", "", []byte("project-200-bytes")); err != nil {
		t.Fatalf("UpsertChunk (project 200): %v", err)
	}

	chunksA, err := repo.ListChunksOrdered(ctx, 100, "conv-a", sharedFileID)
	if err != nil {
		t.Fatalf("ListChunksOrdered (project 100): %v", err)
	}
	chunksB, err := repo.ListChunksOrdered(ctx, 200, "conv-a", sharedFileID)
	if err != nil {
		t.Fatalf("ListChunksOrdered (project 200): %v", err)
	}
	if len(chunksA) != 1 || string(chunksA[0].Bytes) != "project-100-bytes" {
		t.Fatalf("project 100 chunks = %+v, want its own isolated bytes", chunksA)
	}
	if len(chunksB) != 1 || string(chunksB[0].Bytes) != "project-200-bytes" {
		t.Fatalf("project 200 chunks = %+v, want its own isolated bytes", chunksB)
	}
}

-- name: UpsertAttachmentChunk :exec
-- ON CONFLICT DO UPDATE, not DO NOTHING: a retried chunk_index (client
-- timeout, network retry) must overwrite the previous bytes for that index,
-- matching legacy's own local-disk behavior (writing to the same filename
-- twice replaces it) — never double-counted, since the primary key already
-- de-duplicates by chunk_index.
INSERT INTO elitea_storage.attachment_chunks (
    project_id, conversation_id, file_id, chunk_index, total_chunks,
    file_name, content_type, bytes
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8
)
ON CONFLICT (project_id, conversation_id, file_id, chunk_index) DO UPDATE SET
    bytes = EXCLUDED.bytes,
    content_type = EXCLUDED.content_type,
    received_at = now();

-- name: CountAttachmentChunks :one
SELECT COUNT(*)::bigint
FROM elitea_storage.attachment_chunks
WHERE project_id = $1 AND conversation_id = $2 AND file_id = $3;

-- name: ListAttachmentChunksOrdered :many
-- Read by the merge step once CountAttachmentChunks reaches total_chunks —
-- ORDER BY chunk_index reconstructs the original byte stream regardless of
-- arrival order, matching legacy's merge_chunks reading 0..total_chunks-1.
SELECT chunk_index, bytes
FROM elitea_storage.attachment_chunks
WHERE project_id = $1 AND conversation_id = $2 AND file_id = $3
ORDER BY chunk_index;

-- name: DeleteAttachmentChunks :execrows
DELETE FROM elitea_storage.attachment_chunks
WHERE project_id = $1 AND conversation_id = $2 AND file_id = $3;

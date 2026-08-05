-- name: CreateArtifactTransferGrant :one
-- id::text/RETURNING id::text: transfer_grants.id is a native uuid column;
-- casting to text on both sides keeps the Go-side type a plain string,
-- matching this codebase's established convention (e.g.
-- InsertArtifactBucketExpiryNotification, S14) rather than pgtype.UUID.
INSERT INTO elitea_storage.transfer_grants (
    id, project_id, bucket_id, key, method, content_type, max_bytes,
    digest_alg, digest, expires_at
) VALUES (
    sqlc.arg('id')::text::uuid, sqlc.arg('project_id')::bigint, sqlc.arg('bucket_id')::bigint,
    sqlc.arg('key')::text, sqlc.arg('method')::text, sqlc.arg('content_type')::text,
    sqlc.arg('max_bytes')::bigint, sqlc.narg('digest_alg')::text, sqlc.narg('digest')::bytea,
    sqlc.arg('expires_at')::timestamptz
)
RETURNING id::text AS id, project_id, bucket_id, key, method, content_type, max_bytes,
    digest_alg, digest, expires_at, consumed_at, created_at;

-- name: GetArtifactTransferGrant :one
-- Scoped by project_id, not just id: grant IDs are unguessable UUIDs, but
-- every other artifact route requires a matching {projectID}, and this one
-- should not be the exception that lets a caller commit a grant belonging
-- to a project they only guessed the ID for.
SELECT id::text AS id, project_id, bucket_id, key, method, content_type, max_bytes,
    digest_alg, digest, expires_at, consumed_at, created_at
FROM elitea_storage.transfer_grants
WHERE id = sqlc.arg('id')::text::uuid AND project_id = sqlc.arg('project_id')::bigint;

-- name: MarkArtifactTransferGrantConsumed :execrows
-- consumed_at IS NULL in the WHERE clause, not just the SET, is the actual
-- single-use enforcement: 0 rows affected means either the grant does not
-- exist or was already consumed. The caller (commitTransferGrant) has
-- already fetched the row by this point, so 0 rows here unambiguously means
-- "already consumed" — see repository.go's MarkTransferGrantConsumed.
UPDATE elitea_storage.transfer_grants
SET consumed_at = now()
WHERE id = sqlc.arg('id')::text::uuid AND consumed_at IS NULL;

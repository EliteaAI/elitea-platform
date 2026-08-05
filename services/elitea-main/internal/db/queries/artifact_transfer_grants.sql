-- name: CreateArtifactTransferGrant :one
-- id::text/RETURNING id::text: transfer_grants.id is a native uuid column;
-- casting to text on both sides keeps the Go-side type a plain string,
-- matching this codebase's established convention (e.g.
-- InsertArtifactBucketExpiryNotification, S14) rather than pgtype.UUID.
-- upload_id (S16) is set only when CreateTransferGrant started a native
-- multipart upload; a normal single-shot grant passes it as NULL.
INSERT INTO elitea_storage.transfer_grants (
    id, project_id, bucket_id, key, method, content_type, max_bytes,
    digest_alg, digest, upload_id, expires_at
) VALUES (
    sqlc.arg('id')::text::uuid, sqlc.arg('project_id')::bigint, sqlc.arg('bucket_id')::bigint,
    sqlc.arg('key')::text, sqlc.arg('method')::text, sqlc.arg('content_type')::text,
    sqlc.arg('max_bytes')::bigint, sqlc.narg('digest_alg')::text, sqlc.narg('digest')::bytea,
    sqlc.narg('upload_id')::text, sqlc.arg('expires_at')::timestamptz
)
RETURNING id::text AS id, project_id, bucket_id, key, method, content_type, max_bytes,
    digest_alg, digest, upload_id, expires_at, consumed_at, created_at;

-- name: GetArtifactTransferGrant :one
-- Scoped by project_id, not just id: grant IDs are unguessable UUIDs, but
-- every other artifact route requires a matching {projectID}, and this one
-- should not be the exception that lets a caller commit a grant belonging
-- to a project they only guessed the ID for.
SELECT id::text AS id, project_id, bucket_id, key, method, content_type, max_bytes,
    digest_alg, digest, upload_id, expires_at, consumed_at, created_at
FROM elitea_storage.transfer_grants
WHERE id = sqlc.arg('id')::text::uuid AND project_id = sqlc.arg('project_id')::bigint;

-- name: GetArtifactTransferGrantByID :one
-- Unscoped by project_id, unlike GetArtifactTransferGrant above — used only
-- by S16's multipart continuation endpoints (part presign, complete,
-- abort), which must distinguish "grant does not exist" (404) from "grant
-- exists but belongs to a different project" (403 AccessDenied): the
-- plan's own S16 acceptance criterion ("a part call with another project's
-- grant returns 403") requires exactly that distinction, which a
-- project-scoped WHERE clause can't make — a wrong project and a
-- nonexistent id both return zero rows. See handler.go's
-- requireOwnedMultipartGrant for where the 403 decision actually happens.
SELECT id::text AS id, project_id, bucket_id, key, method, content_type, max_bytes,
    digest_alg, digest, upload_id, expires_at, consumed_at, created_at
FROM elitea_storage.transfer_grants
WHERE id = sqlc.arg('id')::text::uuid;

-- name: MarkArtifactTransferGrantConsumed :execrows
-- consumed_at IS NULL in the WHERE clause, not just the SET, is the actual
-- single-use enforcement: 0 rows affected means either the grant does not
-- exist or was already consumed. The caller (commitTransferGrant) has
-- already fetched the row by this point, so 0 rows here unambiguously means
-- "already consumed" — see repository.go's MarkTransferGrantConsumed.
-- S16 also uses this to mark an aborted multipart grant terminal — see
-- AbortMultipartUpload.
UPDATE elitea_storage.transfer_grants
SET consumed_at = now()
WHERE id = sqlc.arg('id')::text::uuid AND consumed_at IS NULL;

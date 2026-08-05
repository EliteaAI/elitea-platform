-- Required by S16 (native multipart upload). A transfer grant that was
-- started as a native-multipart PUT (CreateTransferGrant, when the backend
-- reports Capabilities().NativeMultipart and max_bytes exceeds the 64 MiB
-- threshold) carries the backend's own upload session id here; a normal
-- single-shot grant leaves it NULL. Part state itself is never stored in
-- Postgres — only this identifier, needed to re-address the provider-side
-- session on every subsequent part/complete/abort call.
ALTER TABLE elitea_storage.transfer_grants ADD COLUMN upload_id TEXT;

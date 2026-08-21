-- 0087_artifact_object_expiry_from_object_age.sql — re-derive every
-- elitea_storage.objects.expires_at from the object's OWN age.
--
-- THE DEFECT THIS REPAIRS. Both artifact write paths stamped a new object
-- with the BUCKET's expires_at:
--
--   internal/api/v2/artifacts/objects.go  storeObject
--   internal/api/v2/artifacts/grants.go   finalizeGrantCommit
--   internal/api/attachment_store.go      RequireAttachmentBucket
--
-- elitea_storage.buckets.expires_at is ONE absolute instant. 0057 gives the
-- column no default, and the API computes it exactly twice: when the bucket
-- is created, and when its retention_days is changed
-- (computeExpiresAt = now() + retention_days). Nothing re-derives it later.
--
-- So every object written after the bucket passed that instant was recorded
-- with a deadline already in the past. The upload answered 201 Created. The
-- retention sweeper runs every 15 minutes and selects
-- `expires_at IS NOT NULL AND expires_at < now()`, so it deleted the bytes
-- and the metadata row minutes after the upload. No error reached the
-- caller. Chat attachments have the same shape, through the system
-- attachment bucket.
--
-- WHAT THIS FILE DOES. It sets each row's deadline to `created_at +
-- retention_days`, the object's own age, which is also what the legacy S3
-- lifecycle rule expressed (Expiration.Days). It does NOT use now(): that
-- would extend the life of every existing object from the moment of the
-- migration, which breaks retention in the other direction.
--
-- A bucket with no retention_days means "keep forever", so its objects get
-- a NULL deadline.
--
-- ROWS STILL PAST THEIR DEADLINE AFTER THIS RUN ARE CORRECT. An object that
-- is genuinely older than its bucket's retention window stays expired, and
-- the sweeper reclaims it on the next tick. That is the intended policy.
--
-- The code fix must land with this file. Without the code fix, new uploads
-- keep writing the frozen bucket deadline and the corruption returns.
DO $$
BEGIN

IF to_regclass('elitea_storage.objects') IS NULL
   OR to_regclass('elitea_storage.buckets') IS NULL THEN
    RAISE NOTICE '0086: elitea_storage tables absent, nothing to re-derive';
    RETURN;
END IF;

UPDATE elitea_storage.objects AS o
SET expires_at = o.created_at + make_interval(days => b.retention_days),
    updated_at = now()
FROM elitea_storage.buckets AS b
WHERE b.id = o.bucket_id
  AND b.retention_days IS NOT NULL
  AND o.expires_at IS DISTINCT FROM o.created_at + make_interval(days => b.retention_days);

UPDATE elitea_storage.objects AS o
SET expires_at = NULL,
    updated_at = now()
FROM elitea_storage.buckets AS b
WHERE b.id = o.bucket_id
  AND b.retention_days IS NULL
  AND o.expires_at IS NOT NULL;

END
$$;

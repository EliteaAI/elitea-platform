-- The unqualified configuration relation is intentional. These queries run
-- only inside a tenant transaction whose local search_path was derived from an
-- already authorized positive project identity.

-- name: LockCurrentConfigurationForMutation :one
SELECT id,
       uuid::text AS configuration_uuid,
       project_id,
       label,
       elitea_title,
       type,
       section,
       data,
       meta,
       shared,
       status_ok,
       status_logs,
       source,
       author_id,
       created_at,
       updated_at,
       false AS is_pinned
FROM configuration
WHERE id = sqlc.arg('configuration_id')::integer
  AND project_id = sqlc.arg('project_id')::integer
FOR UPDATE;

-- The project vault row serializes configuration mutations for one project,
-- so selecting the last indexed revision is sufficient inside the same
-- transaction. The unique key remains the final integrity fence.
-- name: GetLatestConfigurationLifecycleRevision :one
SELECT revision
FROM elitea_runtime.configuration_lifecycle_outbox
WHERE resource_project_id = sqlc.arg('project_id')::integer
  AND configuration_uuid = sqlc.arg('configuration_uuid')::text::uuid
ORDER BY revision DESC
LIMIT 1;

-- name: InsertConfigurationLifecycleEvent :exec
INSERT INTO elitea_runtime.configuration_lifecycle_outbox (
    event_id,
    resource_project_id,
    configuration_uuid,
    revision,
    operation,
    actor_id,
    sanitized_snapshot,
    snapshot_digest
) VALUES (
    sqlc.arg('event_id')::text::uuid,
    sqlc.arg('project_id')::integer,
    sqlc.arg('configuration_uuid')::text::uuid,
    sqlc.arg('revision')::bigint,
    sqlc.arg('operation')::text,
    sqlc.arg('actor_id')::integer,
    sqlc.arg('sanitized_snapshot')::json,
    sqlc.arg('snapshot_digest')::bytea
);

-- Claim only the oldest unfinished revision for each configuration. A lower
-- pending, retrying, processing, or dead revision remains an explicit ordering
-- barrier. Expired processing rows are reclaimed with a new caller-owned lease
-- token. Expired rows already at the attempt cap are retired in a bounded
-- batch and remain dead ordering barriers. The transaction ends with this
-- statement; reconciliation happens outside the database transaction.
-- name: ClaimConfigurationLifecycleEvents :many
WITH authority_clock AS MATERIALIZED (
    SELECT clock_timestamp() AS observed_at
),
exhausted_locked AS MATERIALIZED (
    SELECT exhausted.event_id
    FROM elitea_runtime.configuration_lifecycle_outbox AS exhausted
    CROSS JOIN authority_clock
    WHERE exhausted.state = 'PROCESSING'
      AND exhausted.attempt_count = 1000
      AND exhausted.lease_expires_at <= authority_clock.observed_at
    ORDER BY exhausted.lease_expires_at, exhausted.event_id
    LIMIT sqlc.arg('claim_limit')::integer
    FOR UPDATE OF exhausted SKIP LOCKED
),
exhausted AS (
    UPDATE elitea_runtime.configuration_lifecycle_outbox AS outbox
    SET state = 'DEAD',
        lease_owner = NULL,
        lease_expires_at = NULL,
        delivered_at = NULL,
        dead_at = authority_clock.observed_at,
        last_error_code = 'ATTEMPTS_EXHAUSTED',
        updated_at = authority_clock.observed_at
    FROM exhausted_locked
    CROSS JOIN authority_clock
    WHERE outbox.event_id = exhausted_locked.event_id
    RETURNING outbox.event_id
),
exhaustion_barrier AS MATERIALIZED (
    SELECT count(*) AS retired_count
    FROM exhausted
),
locked AS MATERIALIZED (
    SELECT candidate.event_id
    FROM elitea_runtime.configuration_lifecycle_outbox AS candidate
    CROSS JOIN authority_clock
    CROSS JOIN exhaustion_barrier
    WHERE candidate.attempt_count < 1000
      AND (
          (
              candidate.state IN ('PENDING', 'RETRY')
              AND candidate.available_at <= authority_clock.observed_at
          )
          OR (
              candidate.state = 'PROCESSING'
              AND candidate.lease_expires_at <= authority_clock.observed_at
          )
      )
      AND NOT EXISTS (
          SELECT 1
          FROM elitea_runtime.configuration_lifecycle_outbox AS blocker
          WHERE blocker.resource_project_id = candidate.resource_project_id
            AND blocker.configuration_uuid = candidate.configuration_uuid
            AND blocker.revision < candidate.revision
            AND blocker.state IN ('PENDING', 'RETRY', 'PROCESSING', 'DEAD')
      )
    ORDER BY candidate.available_at, candidate.created_at, candidate.event_id
    LIMIT sqlc.arg('claim_limit')::integer
    FOR UPDATE OF candidate SKIP LOCKED
),
claimed AS (
    UPDATE elitea_runtime.configuration_lifecycle_outbox AS outbox
    SET state = 'PROCESSING',
        attempt_count = outbox.attempt_count + 1,
        last_attempt_at = authority_clock.observed_at,
        lease_owner = sqlc.arg('lease_token')::text,
        lease_expires_at = authority_clock.observed_at
            + (sqlc.arg('lease_ttl_millis')::bigint * interval '1 millisecond'),
        delivered_at = NULL,
        dead_at = NULL,
        last_error_code = NULL,
        updated_at = authority_clock.observed_at
    FROM locked
    CROSS JOIN authority_clock
    WHERE outbox.event_id = locked.event_id
    RETURNING outbox.event_id::text AS event_id,
              outbox.resource_project_id,
              outbox.configuration_uuid::text AS configuration_uuid,
              outbox.revision,
              outbox.operation,
              outbox.actor_id,
              outbox.sanitized_snapshot,
              outbox.snapshot_digest,
              outbox.attempt_count,
              COALESCE(outbox.lease_owner, '') AS lease_token,
              outbox.available_at,
              outbox.created_at
)
SELECT event_id,
       resource_project_id,
       configuration_uuid,
       revision,
       operation,
       actor_id,
       sanitized_snapshot,
       snapshot_digest,
       attempt_count,
       lease_token
FROM claimed
ORDER BY available_at, created_at, event_id;

-- name: MarkConfigurationLifecycleDelivered :execrows
UPDATE elitea_runtime.configuration_lifecycle_outbox AS outbox
SET state = 'DELIVERED',
    lease_owner = NULL,
    lease_expires_at = NULL,
    delivered_at = authority_clock.observed_at,
    dead_at = NULL,
    last_error_code = NULL,
    updated_at = authority_clock.observed_at
FROM (SELECT clock_timestamp() AS observed_at) AS authority_clock
WHERE outbox.event_id = sqlc.arg('event_id')::text::uuid
  AND outbox.state = 'PROCESSING'
  AND outbox.lease_owner = sqlc.arg('lease_token')::text
  AND outbox.lease_expires_at > authority_clock.observed_at;

-- name: MarkConfigurationLifecycleRetry :execrows
UPDATE elitea_runtime.configuration_lifecycle_outbox AS outbox
SET state = 'RETRY',
    available_at = authority_clock.observed_at
        + (sqlc.arg('retry_delay_millis')::bigint * interval '1 millisecond'),
    lease_owner = NULL,
    lease_expires_at = NULL,
    delivered_at = NULL,
    dead_at = NULL,
    last_error_code = sqlc.arg('error_code')::text,
    updated_at = authority_clock.observed_at
FROM (SELECT clock_timestamp() AS observed_at) AS authority_clock
WHERE outbox.event_id = sqlc.arg('event_id')::text::uuid
  AND outbox.state = 'PROCESSING'
  AND outbox.lease_owner = sqlc.arg('lease_token')::text
  AND outbox.lease_expires_at > authority_clock.observed_at;

-- name: MarkConfigurationLifecycleDead :execrows
UPDATE elitea_runtime.configuration_lifecycle_outbox AS outbox
SET state = 'DEAD',
    lease_owner = NULL,
    lease_expires_at = NULL,
    delivered_at = NULL,
    dead_at = authority_clock.observed_at,
    last_error_code = sqlc.arg('error_code')::text,
    updated_at = authority_clock.observed_at
FROM (SELECT clock_timestamp() AS observed_at) AS authority_clock
WHERE outbox.event_id = sqlc.arg('event_id')::text::uuid
  AND outbox.state = 'PROCESSING'
  AND outbox.lease_owner = sqlc.arg('lease_token')::text
  AND outbox.lease_expires_at > authority_clock.observed_at;

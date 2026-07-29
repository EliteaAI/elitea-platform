package repos

import (
	"os"
	"strings"
	"testing"
)

func TestIndexMetaInitializationRecoveryMigrationPersistsBoundedState(t *testing.T) {
	migration, err := os.ReadFile(
		"../../../../migrations/shared/0051_index_meta_initialization_recovery.sql",
	)
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	for _, fragment := range []string{
		"index_meta_initialization_status",
		"index_meta_initialization_claim_token",
		"index_meta_initialization_claim_expires_at",
		"index_meta_initialization_attempt_count",
		"index_meta_initialization_next_attempt_at",
		"index_meta_initialization_last_error_code",
		"index_meta_initialization_resolved_at",
		"index_meta_initialization_failed_at",
		"o.prepared_at IS NULL",
		"o.published_at IS NULL",
		"o.authority_granted_at IS NULL",
		"UNSAFE_PRE_RECOVERY_ADMISSION",
		"index metadata initialization recovery requires complete admission ownership",
		"LEFT JOIN elitea_runtime.execution_jobs AS j",
		"LEFT JOIN elitea_runtime.command_outbox AS o",
		"SET state = 'QUARANTINED'",
		"desired_state = 'CANCELLED'",
		"retirement_code = COALESCE(o.retirement_code, 'CANCELLED')",
		"'execution.failed'",
		`{"code":"INTERNAL","safe_message":"The runtime operation failed.","retryable":false}`,
		"56beddb414e183b1cece7ebc123a2e48f97a523477ee4cfce8275dd682ddc0ae",
		"o.authority_granted_at IS NOT NULL",
		"index_ingest_jobs_meta_initialization_pending_idx",
		"index_ingest_jobs_meta_initialization_lease_idx",
	} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("initialization recovery migration missing %q", fragment)
		}
	}
	for _, forbidden := range []string{
		"connection_string",
		"credential",
		"secret",
		"manifest_bytes",
		"content_bytes",
		"on conflict (event_id) do nothing",
	} {
		if strings.Contains(strings.ToLower(sql), forbidden) {
			t.Fatalf(
				"initialization recovery migration persists protected value %q",
				forbidden,
			)
		}
	}
}

func TestIndexMetaInitializationRecoveryQueriesFenceLeaseAndDispatch(t *testing.T) {
	queries, err := os.ReadFile(
		"../../../../internal/db/queries/runtime_index_ingest.sql",
	)
	if err != nil {
		t.Fatal(err)
	}
	sql := string(queries)
	for _, fragment := range []string{
		"-- name: QuarantineExpiredTerminalIndexMetaInitializations :one",
		"LIMIT sqlc.arg(quarantine_limit)::integer",
		"FOR UPDATE OF i, j, o SKIP LOCKED",
		"index_meta_initialization_claim_expires_at <= clock_timestamp()",
		"j.state = 'FAILED'",
		"j.terminal_error_code = 'DEADLINE_EXCEEDED'",
		"o.prepared_at IS NULL",
		"o.published_at IS NULL",
		"o.authority_granted_at IS NULL",
		"o.retired_at IS NOT NULL",
		"o.retirement_code = 'DEADLINE_EXCEEDED'",
		"'INITIALIZATION_DEADLINE_EXCEEDED'",
		"-- name: ClaimPendingIndexMetaInitializations :many",
		"FOR UPDATE OF i SKIP LOCKED",
		"LIMIT sqlc.arg(claim_limit)::integer",
		"index_meta_initialization_claim_expires_at <= clock_timestamp()",
		"-- name: LoadIndexMetaInitializationWork :one",
		"LEFT JOIN elitea_runtime.input_bundle_entries AS toolkit",
		"LEFT JOIN elitea_runtime.input_bundle_entries AS parameters",
		"toolkit.content_bytes AS toolkit_configuration",
		"parameters.content_bytes AS tool_parameters",
		"-- name: ResolveIndexMetaInitialization :one",
		"index_meta_initialized_at = authority.initialized_at",
		"o.prepared_at IS NULL",
		"o.published_at IS NULL",
		"o.authority_granted_at IS NULL",
		"-- name: QuarantineIndexMetaInitialization :one",
		"locked_triple AS MATERIALIZED",
		"FOR UPDATE OF i, j, o",
		"j.terminal_error_code = 'DEADLINE_EXCEEDED'",
		"o.retirement_code = 'DEADLINE_EXCEEDED'",
		"i.classification = 'ACTIVE_PRE_AUTHORITY'",
		"WHERE classification = 'TERMINAL_DEADLINE'",
		"SET state = 'QUARANTINED'",
		"retirement_code = 'CANCELLED'",
		"INSERT INTO elitea_runtime.execution_replay_events",
		"'execution.failed'",
		"sqlc.arg(failure_event_bytes)::bytea",
		"sqlc.arg(failure_event_digest)::bytea",
	} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("initialization recovery queries missing %q", fragment)
		}
	}
	if strings.Contains(
		sql,
		"sqlc.arg(last_error_code)::bytea",
	) {
		t.Fatal("internal initialization error code became browser event data")
	}
}

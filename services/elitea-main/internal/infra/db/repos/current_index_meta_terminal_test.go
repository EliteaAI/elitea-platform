package repos

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
)

func TestCurrentIndexMetaTerminalBindingUsesFrozenAdmissionEvidence(t *testing.T) {
	frozen := []byte(`{"id":19,"type":"github","settings":{"pgvector_configuration":{"__elitea_frozen_configuration_v1":true}}}`)
	store := &scriptedExecutor{rowResults: []scriptedRow{{values: []any{
		int32(7),
		"13",
		int32(19),
		"Docs",
		"meta-1",
		"execution-1",
		int64(3),
		frozen,
	}}}}
	repository, err := newCurrentIndexMetaTerminalBindingsRepository(store)
	if err != nil {
		t.Fatal(err)
	}
	binding, err := repository.LoadCurrentIndexMetaTerminalBinding(context.Background(), "execution-1", 3)
	if err != nil {
		t.Fatal(err)
	}
	if binding.ResourceProjectID != 7 || binding.ActorUserID != 13 ||
		binding.ToolkitID != 19 || binding.IndexName != "Docs" ||
		binding.MetaID != "meta-1" || binding.ExecutionID != "execution-1" ||
		binding.Generation != 3 || string(binding.ToolkitConfiguration) != string(frozen) {
		t.Fatalf("binding=%+v", binding)
	}
	if len(store.rowCalls) != 1 ||
		len(store.rowCalls[0].args) != 2 ||
		store.rowCalls[0].args[0] != "execution-1" ||
		store.rowCalls[0].args[1] != int64(3) {
		t.Fatalf("calls=%+v", store.rowCalls)
	}
	for _, predicate := range []string{
		"i.index_meta_id",
		"e.entry_id = i.toolkit_configuration_entry_id",
		"j.capability_id = 'index.ingest.v1'",
		"i.index_meta_initialized_at IS NOT NULL",
	} {
		if !strings.Contains(store.rowCalls[0].sql, predicate) {
			t.Fatalf("terminal binding SQL is missing %q", predicate)
		}
	}
}

func TestCurrentIndexMetaTerminalEffectClaimsOnlyBoundedPendingRows(t *testing.T) {
	cancelledAt := time.Date(2026, time.July, 26, 12, 13, 14, 0, time.UTC)
	deadlineAt := cancelledAt.Add(time.Minute)
	store := &scriptedExecutor{rowsResult: &scriptedRows{rows: []scriptedRow{
		{values: []any{
			"cancelled", int64(1), "cancelled", cancelledAt,
		}},
		{values: []any{
			"deadline",
			int64(2),
			"failed",
			deadlineAt,
		}},
	}}, rowResults: []scriptedRow{{values: []any{nil, "DEADLINE_EXCEEDED"}}}}
	repository, err := newCurrentIndexMetaTerminalBindingsRepository(store)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := repository.ClaimPendingTerminalEffects(
		context.Background(),
		"claim-1",
		8,
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(claims) != 2 ||
		claims[0].State != indexingapp.CurrentIndexMetaCancelled ||
		claims[0].SafeError != "" || claims[0].ClaimToken != "claim-1" ||
		claims[1].State != indexingapp.CurrentIndexMetaFailed ||
		claims[1].SafeError == "" || claims[1].ClaimToken != "claim-1" {
		t.Fatalf("claims=%+v", claims)
	}
	query := store.queryCalls[0]
	for _, predicate := range []string{
		"WITH candidates AS",
		"FROM elitea_runtime.index_ingest_jobs AS i",
		"i.capability_id = 'index.ingest.v1'",
		"i.index_meta_terminal_status = 'PENDING'",
		"i.index_meta_terminal_next_attempt_at <= clock_timestamp()",
		"LIMIT $1",
		"FOR UPDATE OF i SKIP LOCKED",
		"index_meta_terminal_claim_expires_at",
	} {
		if !strings.Contains(query.sql, predicate) {
			t.Fatalf("terminal effect claim is missing %q", predicate)
		}
	}
	for _, forbidden := range []string{
		"terminal_evidence",
		"terminal_sources",
		"output_inbox",
		"command_outbox",
		"index_meta_terminal_status IS NULL",
	} {
		if strings.Contains(query.sql, forbidden) {
			t.Fatalf("steady terminal claim scans source history via %q", forbidden)
		}
	}
	if len(store.rowCalls) != 1 {
		t.Fatalf("safe-error source lookups=%d, want one failed claim", len(store.rowCalls))
	}
	safeSource := store.rowCalls[0]
	for _, predicate := range []string{
		"o.execution_id = $1",
		"o.generation = $2",
		"o.occurred_at = $3",
		"o.retired_at = $3",
		"o.settlement_outcome = 'FAILED'",
		"o.retirement_code = 'DEADLINE_EXCEEDED'",
	} {
		if !strings.Contains(safeSource.sql, predicate) {
			t.Fatalf("exact safe-error lookup is missing %q", predicate)
		}
	}
	if len(safeSource.args) != 3 ||
		safeSource.args[0] != "deadline" ||
		safeSource.args[1] != int64(2) ||
		safeSource.args[2] != deadlineAt {
		t.Fatalf("safe-error lookup args=%#v", safeSource.args)
	}
}

func TestCurrentIndexMetaTerminalEffectResolutionOwnsClaimToken(t *testing.T) {
	store := &scriptedExecutor{rowResults: []scriptedRow{{values: []any{"APPLIED"}}}}
	repository, err := newCurrentIndexMetaTerminalBindingsRepository(store)
	if err != nil {
		t.Fatal(err)
	}
	claim := indexingapp.CurrentIndexMetaTerminalClaim{
		CurrentIndexMetaTerminalRequest: indexingapp.CurrentIndexMetaTerminalRequest{
			ExecutionID: "execution-1",
			Generation:  3,
			State:       indexingapp.CurrentIndexMetaFailed,
			OccurredAt:  time.Now(),
			SafeError:   "A dependency is unavailable.",
		},
		ClaimToken: "claim-1",
	}
	if err := repository.ResolveTerminalEffect(
		context.Background(),
		claim,
		indexingapp.CurrentIndexMetaTerminalApplied,
	); err != nil {
		t.Fatal(err)
	}
	for _, predicate := range []string{
		"index_meta_terminal_status = $5",
		"index_meta_terminal_claim_token = $6",
		"index_meta_terminalized_at = COALESCE",
	} {
		if !strings.Contains(store.rowCalls[0].sql, predicate) {
			t.Fatalf("terminal effect resolution is missing %q", predicate)
		}
	}
}

func TestIndexMetaTerminalEffectMigrationSeedsOldSourceBackedRows(t *testing.T) {
	migration, err := os.ReadFile("../../../../migrations/shared/0043_index_meta_terminal_effect.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	for _, fragment := range []string{
		"idempotent seed for the single-instance",
		"rolling",
		"mixed-version production rollout requires a separate rerunnable post-cutover",
		"ADD COLUMN index_meta_terminal_state TEXT",
		"ADD COLUMN index_meta_terminal_occurred_at TIMESTAMPTZ",
		"ADD COLUMN index_meta_terminal_status TEXT",
		"ADD COLUMN index_meta_terminal_claim_token TEXT",
		"ADD COLUMN index_meta_terminal_next_attempt_at TIMESTAMPTZ",
		"ADD COLUMN index_meta_terminalized_at TIMESTAMPTZ",
		"index_ingest_jobs_meta_terminal_identity",
		"index_ingest_jobs_meta_terminal_requires_initialization",
		"WITH terminal_evidence AS",
		"terminal_sources AS",
		"UPDATE elitea_runtime.index_ingest_jobs AS i",
		"o.projected_at IS NOT NULL",
		"o.authority_granted_at IS NULL",
		"i.capability_id = 'index.ingest.v1'",
		"i.index_meta_initialized_at IS NOT NULL",
		"i.index_meta_terminal_status IS NULL",
		"index_meta_terminal_status = 'PENDING'",
		"index_meta_terminal_attempt_count = 0",
		"WHERE index_meta_terminal_status = 'PENDING'",
	} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("terminal effect migration is missing %q", fragment)
		}
	}
	for _, forbidden := range []string{
		"command_outbox_retired_no_authority_terminal_idx",
		"output_inbox_projected_runtime_terminal_idx",
		"payload_bytes",
	} {
		if strings.Contains(sql, forbidden) {
			t.Fatalf("migration retains recurring source scan/index via %q", forbidden)
		}
	}
}

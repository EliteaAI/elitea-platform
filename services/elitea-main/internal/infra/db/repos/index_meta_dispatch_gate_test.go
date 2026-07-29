package repos

import (
	"os"
	"strings"
	"testing"
)

func TestIndexMetaDispatchGateMigrationFailsClosedWithoutInventingExternalState(t *testing.T) {
	migration, err := os.ReadFile("../../../../migrations/shared/0042_index_meta_dispatch_gate.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	for _, fragment := range []string{
		"ADD COLUMN index_meta_id TEXT",
		"ADD COLUMN index_meta_correlation_id TEXT",
		"ADD COLUMN index_meta_initialized_at TIMESTAMPTZ",
		"index_ingest_jobs_meta_identity_pair",
		"index_ingest_jobs_meta_initialization_identity",
		"index_ingest_jobs_dispatch_ready_idx",
		"WHERE index_meta_initialized_at IS NOT NULL",
	} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("metadata dispatch-gate migration is missing %q", fragment)
		}
	}
	if strings.Contains(sql, "UPDATE elitea_runtime.index_ingest_jobs") {
		t.Fatal("metadata dispatch-gate migration invents identity or initialization for existing work")
	}
}

func TestIndexMetaInitializationTransitionRejectsCancelledOrDispatchedWork(t *testing.T) {
	queries, err := os.ReadFile("../../../../internal/db/queries/runtime_index_ingest.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(queries)
	start := strings.Index(sql, "-- name: MarkIndexMetaInitialized :one")
	if start < 0 {
		t.Fatal("MarkIndexMetaInitialized query is missing")
	}
	end := strings.Index(sql[start:], "-- name: InsertRuntimeCommandOutbox")
	if end < 0 {
		t.Fatal("MarkIndexMetaInitialized query is missing")
	}
	transition := sql[start : start+end]
	for _, fragment := range []string{
		"FROM elitea_runtime.execution_jobs AS j",
		"j.execution_id = i.execution_id",
		"j.generation = i.generation",
		"j.state = 'PENDING'",
		"j.desired_state = 'RUNNING'",
	} {
		if !strings.Contains(transition, fragment) {
			t.Fatalf("metadata initialization transition is missing %q", fragment)
		}
	}
}

func TestActiveIndexTargetGuardUsesDurableNonterminalIdentity(t *testing.T) {
	queries, err := os.ReadFile("../../../../internal/db/queries/runtime_index_ingest.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(queries)
	start := strings.Index(sql, "-- name: ListActiveIndexIngestTarget :many")
	if start < 0 {
		t.Fatal("ListActiveIndexIngestTarget query is missing")
	}
	end := strings.Index(sql[start:], "-- name: CountActiveRuntimeExecutionsUpTo")
	if end < 0 {
		t.Fatal("ListActiveIndexIngestTarget query boundary is missing")
	}
	guard := sql[start : start+end]
	for _, fragment := range []string{
		"j.tenant_id = sqlc.arg(tenant_id)::text",
		"j.resource_project_id = sqlc.arg(resource_project_id)::integer",
		"j.projection_project_id = sqlc.arg(projection_project_id)::integer",
		"i.capability_id = j.capability_id",
		"i.toolkit_id = sqlc.arg(toolkit_id)::integer",
		"i.index_name = sqlc.arg(index_name)::text",
		"j.state IN ('PENDING', 'DISPATCHED', 'CLAIMED', 'RUNNING', 'SETTLING')",
		"LIMIT 2",
	} {
		if !strings.Contains(guard, fragment) {
			t.Fatalf("active index target guard is missing %q", fragment)
		}
	}
}

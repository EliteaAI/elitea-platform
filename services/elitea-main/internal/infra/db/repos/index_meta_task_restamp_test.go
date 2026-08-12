package repos

import (
	"context"
	"strings"
	"testing"
	"time"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	platformmigrations "github.com/EliteaAI/elitea-platform/services/elitea-main/migrations"
)

func TestCurrentIndexMetaTaskRestampBindingUsesFrozenAdmissionOnly(t *testing.T) {
	store := &scriptedExecutor{rowResults: []scriptedRow{{values: []any{
		int32(7),
		"13",
		int32(19),
		"Docs",
		"meta-1",
		"execution-1",
		int64(3),
		int64(8),
		[]byte(`{"id":19,"settings":{"secret":"frozen-ref"}}`),
	}}}}
	repository, err := newCurrentIndexMetaTaskRestampRepository(store)
	if err != nil {
		t.Fatal(err)
	}
	binding, err := repository.LoadCurrentIndexMetaTaskRestampBinding(
		context.Background(),
		"execution-1",
		3,
	)
	if err != nil {
		t.Fatal(err)
	}
	if binding.ResourceProjectID != 7 || binding.ActorUserID != 13 ||
		binding.ToolkitID != 19 || binding.IndexName != "Docs" ||
		binding.MetaID != "meta-1" || binding.ExecutionID != "execution-1" ||
		binding.Generation != 3 || binding.IndexGeneration != 8 {
		t.Fatalf("binding=%+v", binding)
	}
	query := store.rowCalls[0].sql
	for _, evidence := range []string{
		"j.resource_project_id",
		"j.actor_id",
		"i.toolkit_id",
		"i.index_name",
		"e.content_bytes",
		"i.index_meta_task_restamp_status = 'PENDING'",
	} {
		if !strings.Contains(query, evidence) {
			t.Fatalf("binding SQL missing %q", evidence)
		}
	}
	if strings.Contains(query, "event_bytes") ||
		strings.Contains(query, "response_metadata") {
		t.Fatal("binding SQL reads browser-event identity")
	}
}

func TestCurrentIndexMetaTaskRestampClaimsBoundedImmutableIntent(t *testing.T) {
	occurredAt := time.Date(2026, time.July, 27, 12, 0, 0, 0, time.UTC)
	store := &scriptedExecutor{rowsResult: &scriptedRows{rows: []scriptedRow{
		{values: []any{
			"execution-1",
			int64(3),
			"command-1:6",
			occurredAt,
			1_700_000_000.25,
		}},
	}}}
	repository, err := newCurrentIndexMetaTaskRestampRepository(store)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := repository.ClaimPendingTaskRestamps(
		context.Background(),
		"claim-1",
		8,
		time.Minute,
	)
	if err != nil || len(claims) != 1 {
		t.Fatalf("claims=%+v err=%v", claims, err)
	}
	want := indexingapp.CurrentIndexMetaTaskRestampClaim{
		CurrentIndexMetaTaskRestampRequest: indexingapp.CurrentIndexMetaTaskRestampRequest{
			ExecutionID:   "execution-1",
			Generation:    3,
			SourceEventID: "command-1:6",
			OccurredAt:    occurredAt,
			CreatedOn:     1_700_000_000.25,
		},
		ClaimToken: "claim-1",
	}
	if claims[0] != want {
		t.Fatalf("claim=%+v want=%+v", claims[0], want)
	}
	query := store.queryCalls[0]
	if query.args[0] != int32(8) || query.args[1] != "claim-1" ||
		!strings.Contains(query.sql, "LIMIT $1") ||
		!strings.Contains(query.sql, "FOR UPDATE OF i SKIP LOCKED") ||
		!strings.Contains(query.sql, "index_meta_task_restamp_created_on") {
		t.Fatalf("claim query=%s args=%#v", query.sql, query.args)
	}
}

func TestIndexMetaTaskRestampMigrationDefinesBoundedSourceDrivenEffect(t *testing.T) {
	migration, err := platformmigrations.Files.ReadFile(
		"shared/0049_index_meta_task_restamp.sql",
	)
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	for _, evidence := range []string{
		"index_meta_task_restamp_source_event_id",
		"index_meta_task_restamp_created_on",
		"index_meta_task_restamp_status",
		"index_meta_task_restamp_claim_token",
		"index_ingest_jobs_meta_task_restamp_pending_idx",
		"agent_index_data_status",
		"'{response_metadata,state}' = 'in_progress'",
		"i.index_meta_initialized_at IS NOT NULL",
	} {
		if !strings.Contains(sql, evidence) {
			t.Fatalf("task restamp migration missing %q", evidence)
		}
	}
}

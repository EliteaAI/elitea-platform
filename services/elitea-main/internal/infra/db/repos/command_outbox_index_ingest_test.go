package repos

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
)

func TestListPendingIndexIngestIDsIsCapabilityAndStreamScoped(t *testing.T) {
	executor := &scriptedExecutor{rowsResult: &scriptedRows{rows: []scriptedRow{
		{values: []any{"index-outbox-1"}},
	}}}
	repository, err := newCommandOutboxRepository(&scriptedStore{scriptedExecutor: executor}, "runtime:index:commands")
	if err != nil {
		t.Fatal(err)
	}
	ids, err := repository.ListPendingIndexIngestIDs(context.Background(), 1, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(ids, []string{"index-outbox-1"}) {
		t.Fatalf("unexpected pending index IDs: %v", ids)
	}
	if len(executor.queryCalls) != 1 {
		t.Fatalf("query calls = %d", len(executor.queryCalls))
	}
	call := executor.queryCalls[0]
	for _, fragment := range []string{
		"JOIN elitea_runtime.index_ingest_jobs AS i",
		"o.stream_name = $1",
		"j.capability_id = 'index.ingest.v1'",
		"j.generation = 1",
		"o.published_at IS NULL",
		"o.published_at IS NOT NULL",
		"COALESCE(o.last_visibility_at, o.published_at)",
	} {
		if !strings.Contains(call.sql, fragment) {
			t.Fatalf("index pending query is missing %q", fragment)
		}
	}
	if strings.Contains(call.sql, "configuration.validate.v1") || !reflect.DeepEqual(call.args, []any{"runtime:index:commands", int32(1), int64(time.Minute.Milliseconds())}) {
		t.Fatalf("index pending query crossed capability/stream boundary: args=%#v", call.args)
	}
}

func TestLoadPendingIndexIngestJoinsMetadataWithoutEntryContent(t *testing.T) {
	manifestDigest := runtimedomain.SHA256([]byte("index-manifest"))
	deadline := time.Date(2026, time.July, 22, 12, 0, 0, 0, time.UTC)
	executor := &scriptedExecutor{rowResults: []scriptedRow{{values: []any{
		"index-outbox-1", "index-command-1", "index-execution-1", int64(1), int64(1),
		"tenant-1", "1", "1", "actor-1",
		"index-bundle-1", "admission:index-bundle-1", "application/x-protobuf", int64(256), manifestDigest[:],
		"1", "indexing", "project", int32(1), deadline, "index-limits-v1", "", "",
		"toolkit-configuration", "tool-parameters", "llm-model", "llm-configuration", "mcp-credential-references",
	}}}}
	repository, err := newCommandOutboxRepository(&scriptedStore{scriptedExecutor: executor}, "runtime:index:commands")
	if err != nil {
		t.Fatal(err)
	}
	dispatch, err := repository.LoadPendingIndexIngest(context.Background(), "index-outbox-1")
	if err != nil {
		t.Fatal(err)
	}
	if dispatch.OutboxID != "index-outbox-1" || dispatch.InputBundleDigest != manifestDigest || dispatch.ToolkitConfigurationEntryID != "toolkit-configuration" || dispatch.MCPTokensEntryID != "mcp-credential-references" {
		t.Fatalf("unexpected index dispatch: %+v", dispatch)
	}
	query := executor.rowCalls[0].sql
	for _, fragment := range []string{
		"JOIN elitea_runtime.index_ingest_jobs AS i",
		"JOIN elitea_runtime.input_bundles AS b",
		"i.input_bundle_id = j.input_bundle_id",
		"j.capability_id = 'index.ingest.v1'",
	} {
		if !strings.Contains(query, fragment) {
			t.Fatalf("index dispatch query is missing %q", fragment)
		}
	}
	for _, forbidden := range []string{"manifest_bytes", "input_bundle_entries", "content_bytes"} {
		if strings.Contains(query, forbidden) {
			t.Fatalf("index dispatch query loads data-plane field %q", forbidden)
		}
	}
}

func TestStorePreparedIndexIngestReturnsCompetingCASWinner(t *testing.T) {
	candidate := repositoryPreparedEnvelope("index-candidate")
	winner := repositoryPreparedEnvelope("index-winner")
	executor := &scriptedExecutor{rowResults: []scriptedRow{{values: []any{
		winner.Bytes, winner.Digest[:], winner.SignatureProfile, winner.KeyID,
		false, false, false, false, "PENDING",
	}}}}
	store := &scriptedStore{scriptedExecutor: executor}
	repository, err := newCommandOutboxRepository(store, "runtime:index:commands")
	if err != nil {
		t.Fatal(err)
	}
	selected, err := repository.StorePreparedIndexIngest(context.Background(), "index-outbox-1", candidate)
	if err != nil {
		t.Fatal(err)
	}
	if selected.Envelope.Digest != winner.Digest || string(selected.Envelope.Bytes) != string(winner.Bytes) || selected.Envelope.KeyID != winner.KeyID {
		t.Fatalf("repository did not return index CAS winner: %+v", selected)
	}
	query := executor.rowCalls[0].sql
	if !strings.Contains(query, "j.capability_id = 'index.ingest.v1'") || !strings.Contains(query, "FOR UPDATE OF j, o") || strings.Contains(query, "configuration.validate.v1") {
		t.Fatal("prepared index CAS is not capability-scoped and locked")
	}
}

func TestStorePreparedIndexIngestDoesNotRedeliverWinnerAfterAuthority(t *testing.T) {
	winner := repositoryPreparedEnvelope("index-winner")
	executor := &scriptedExecutor{rowResults: []scriptedRow{{values: []any{
		winner.Bytes, winner.Digest[:], winner.SignatureProfile, winner.KeyID,
		true, false, false, true, "RUNNING",
	}}}}
	repository, err := newCommandOutboxRepository(&scriptedStore{scriptedExecutor: executor}, "runtime:index:commands")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repository.StorePreparedIndexIngest(
		context.Background(),
		"index-outbox-1",
		repositoryPreparedEnvelope("late-signer"),
	); !errors.Is(err, executionapp.ErrDispatchRetired) {
		t.Fatalf("late competing signer error=%v, want retired no-op", err)
	}
	if len(executor.execCalls) != 0 {
		t.Fatal("late competing signer mutated a command after authority")
	}
}

func TestLoadPreparedIndexIngestDoesNotRedeliverAfterAuthority(t *testing.T) {
	winner := repositoryPreparedEnvelope("index-winner")
	executor := &scriptedExecutor{rowResults: []scriptedRow{{values: []any{
		winner.Bytes, winner.Digest[:], winner.SignatureProfile, winner.KeyID,
		true, false, false, true, "RUNNING",
	}}}}
	repository, err := newCommandOutboxRepository(&scriptedStore{scriptedExecutor: executor}, "runtime:index:commands")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repository.LoadPreparedIndexIngest(context.Background(), "index-outbox-1"); !errors.Is(err, executionapp.ErrDispatchRetired) {
		t.Fatalf("authorized prepared command error=%v, want retired no-op", err)
	}
}

func TestRetireNoAuthorityIndexIngestUsesBoundedCapabilityScans(t *testing.T) {
	executor := &scriptedExecutor{rowsResults: []*scriptedRows{{}, {}}}
	repository, err := newCommandOutboxRepository(&scriptedStore{scriptedExecutor: executor}, "runtime:index:commands")
	if err != nil {
		t.Fatal(err)
	}
	retired, err := repository.RetireNoAuthorityIndexIngest(context.Background(), 3)
	if err != nil {
		t.Fatal(err)
	}
	if retired != 0 || len(executor.queryCalls) != 2 {
		t.Fatalf("unexpected index retirement: retired=%d queries=%d", retired, len(executor.queryCalls))
	}
	for _, call := range executor.queryCalls {
		if !strings.Contains(call.sql, "j.capability_id = 'index.ingest.v1'") || !strings.Contains(call.sql, "o.stream_name = $1") || !strings.Contains(call.sql, "LIMIT $2") || !strings.Contains(call.sql, "SKIP LOCKED") || strings.Contains(call.sql, "configuration.validate.v1") {
			t.Fatal("index retirement scan escaped its capability, stream or bound")
		}
		if !reflect.DeepEqual(call.args, []any{"runtime:index:commands", int32(3)}) {
			t.Fatalf("unexpected index retirement args: %#v", call.args)
		}
	}
}

func TestIndexIngestRepositoryRejectsInvalidBounds(t *testing.T) {
	repository, err := newCommandOutboxRepository(&scriptedStore{scriptedExecutor: &scriptedExecutor{}}, "runtime:index:commands")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repository.ListPendingIndexIngestIDs(context.Background(), executionapp.MaxOutboxPublisherBatchSize+1, time.Minute); err != executionapp.ErrInvalidPendingOutboxLimit {
		t.Fatalf("invalid index list bound error = %v", err)
	}
	if _, err := repository.RetireNoAuthorityIndexIngest(context.Background(), 0); err != executionapp.ErrInvalidPendingOutboxLimit {
		t.Fatalf("invalid index retirement bound error = %v", err)
	}
}

package pgvector

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
)

func TestPlanCurrentInitialIndexMetaCreatesStrictCurrentHistory(t *testing.T) {
	record := currentIndexMetaRecordForTest("meta-1", "execution-1", "message-1")
	plan, err := planCurrentInitialIndexMeta(record, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !plan.insert || plan.noop || plan.id != "meta-1" || plan.document != "index_meta_Docs" {
		t.Fatalf("plan=%+v", plan)
	}
	metadata := mustDecodeCurrentIndexMeta(t, plan.metadata)
	historyEncoded, ok := metadata["history"].(string)
	if !ok {
		t.Fatalf("history type=%T", metadata["history"])
	}
	history := currentIndexMetaHistory(historyEncoded)
	if len(history) != 1 {
		t.Fatalf("history=%#v", history)
	}
	delete(metadata, "history")
	if !reflect.DeepEqual(history[0], metadata) {
		t.Fatalf("history[0]=%#v metadata=%#v", history[0], metadata)
	}
}

func TestPlanCurrentInitialIndexMetaRecoversCommittedWriteWithoutAppendingHistory(t *testing.T) {
	record := currentIndexMetaRecordForTest("meta-1", "execution-1", "message-1")
	created, err := planCurrentInitialIndexMeta(record, nil)
	if err != nil {
		t.Fatal(err)
	}
	document := created.document
	stored := currentStoredIndexMeta{
		id:       created.id,
		document: &document,
		metadata: mustDecodeCurrentIndexMeta(t, created.metadata),
	}
	replayed, err := planCurrentInitialIndexMeta(record, []currentStoredIndexMeta{stored})
	if err != nil {
		t.Fatal(err)
	}
	if !replayed.noop || replayed.insert || replayed.id != "" || len(replayed.metadata) != 0 {
		t.Fatalf("replayed plan=%+v", replayed)
	}
	if history := currentIndexMetaHistory(stored.metadata["history"]); len(history) != 1 {
		t.Fatalf("retry changed history=%#v", history)
	}
}

func TestPlanCurrentInitialIndexMetaRejectsConflictingActiveExecution(t *testing.T) {
	first := currentIndexMetaRecordForTest("meta-1", "execution-1", "message-1")
	created, err := planCurrentInitialIndexMeta(first, nil)
	if err != nil {
		t.Fatal(err)
	}
	document := created.document
	existing := currentStoredIndexMeta{
		id:       created.id,
		document: &document,
		metadata: mustDecodeCurrentIndexMeta(t, created.metadata),
	}
	second := currentIndexMetaRecordForTest("meta-2", "execution-2", "message-2")
	if _, err := planCurrentInitialIndexMeta(second, []currentStoredIndexMeta{existing}); !errors.Is(err, indexingapp.ErrCurrentIndexMetaConflict) {
		t.Fatalf("conflict error=%v", err)
	}
}

func TestPlanCurrentInitialIndexMetaRejectsUnknownExistingState(t *testing.T) {
	record := currentIndexMetaRecordForTest("meta-2", "execution-2", "message-2")
	document := "index_meta_Docs"
	existing := currentStoredIndexMeta{
		id:       "existing",
		document: &document,
		metadata: map[string]any{
			"collection": "Docs",
			"type":       "index_meta",
			"state":      "unexpected-state",
			"history":    "[]",
		},
	}
	if _, err := planCurrentInitialIndexMeta(record, []currentStoredIndexMeta{existing}); !errors.Is(err, indexingapp.ErrCurrentIndexMetaConflict) {
		t.Fatalf("unknown state error=%v", err)
	}
}

func TestPlanCurrentInitialIndexMetaReindexPreservesAndAppendsObservableHistory(t *testing.T) {
	record := currentIndexMetaRecordForTest("meta-2", "execution-2", "message-2")
	document := "index_meta_Docs"
	existing := currentStoredIndexMeta{
		id:       "current-physical-row",
		document: &document,
		metadata: map[string]any{
			"collection": "Docs",
			"type":       "index_meta",
			"state":      "completed",
			"history": []any{
				map[string]any{"state": "created", "task_id": nil},
				map[string]any{"state": "completed", "task_id": "old"},
			},
		},
	}
	plan, err := planCurrentInitialIndexMeta(record, []currentStoredIndexMeta{existing})
	if err != nil {
		t.Fatal(err)
	}
	if plan.insert || plan.noop || plan.id != "current-physical-row" {
		t.Fatalf("plan=%+v", plan)
	}
	metadata := mustDecodeCurrentIndexMeta(t, plan.metadata)
	history, ok := metadata["history"].(string)
	if !ok {
		t.Fatalf("history type=%T", metadata["history"])
	}
	items := currentIndexMetaHistory(history)
	if len(items) != 3 {
		t.Fatalf("history=%#v", items)
	}
	last, ok := items[2].(map[string]any)
	if !ok || last["state"] != "in_progress" || last["index_meta_id"] != "meta-2" ||
		last["execution_id"] != "execution-2" || last["correlation_id"] != "message-2" {
		t.Fatalf("last history=%#v", items[2])
	}
	if metadata["history"] == existing.metadata["history"] ||
		metadata["state"] != "in_progress" ||
		metadata["task_id"] != "execution-2" {
		t.Fatalf("metadata=%#v", metadata)
	}
}

func currentIndexMetaRecordForTest(metaID, executionID, correlationID string) indexingapp.CurrentInitialIndexMeta {
	metadata, err := json.Marshal(map[string]any{
		"collection":           "Docs",
		"type":                 "index_meta",
		"indexed":              0,
		"updated":              0,
		"state":                "in_progress",
		"index_configuration":  map[string]any{"index_name": "Docs"},
		"created_on":           1_700_000_000.25,
		"updated_on":           1_700_000_000.25,
		"task_id":              executionID,
		"conversation_id":      nil,
		"toolkit_id":           19,
		"execution_id":         executionID,
		"execution_generation": 1,
		"index_meta_id":        metaID,
		"correlation_id":       correlationID,
	})
	if err != nil {
		panic(err)
	}
	return indexingapp.CurrentInitialIndexMeta{
		MetaID:          metaID,
		ExecutionID:     executionID,
		CorrelationID:   correlationID,
		Generation:      1,
		IndexName:       "Docs",
		ToolkitID:       19,
		Document:        "index_meta_Docs",
		InitialMetadata: metadata,
	}
}

func mustDecodeCurrentIndexMeta(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	metadata, err := decodeCurrentIndexMetaJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	return metadata
}

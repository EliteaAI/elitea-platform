package pgvector

import (
	"encoding/json"
	"errors"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
)

func TestPlanCurrentInitialIndexMetaCreatesPermanentHistoryMarker(t *testing.T) {
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
	assertCurrentIndexMetaCreatedMarker(t, history[0], "Docs")
	if metadata["state"] != "in_progress" ||
		metadata["task_id"] != record.ExecutionID ||
		metadata["execution_id"] != record.ExecutionID ||
		metadata["index_meta_id"] != record.MetaID {
		t.Fatalf("metadata=%#v", metadata)
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

func TestPlanCurrentInitialIndexMetaRecoversLegacyCommittedBootstrap(
	t *testing.T,
) {
	record := currentIndexMetaRecordForTest(
		"meta-1",
		"execution-1",
		"message-1",
	)
	initial := mustDecodeCurrentIndexMeta(t, record.InitialMetadata)
	encoded, err := encodeCurrentIndexMetaWithHistory(
		initial,
		[]any{cloneCurrentIndexMetaValue(initial)},
	)
	if err != nil {
		t.Fatal(err)
	}
	document := record.Document
	replayed, err := planCurrentInitialIndexMeta(
		record,
		[]currentStoredIndexMeta{{
			id:       record.MetaID,
			document: &document,
			metadata: mustDecodeCurrentIndexMeta(t, encoded),
		}},
	)
	if err != nil || !replayed.noop {
		t.Fatalf("replayed=%+v err=%v", replayed, err)
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

func TestPlanCurrentInitialIndexMetaReindexPreservesHistoryWithoutAppending(t *testing.T) {
	record := currentIndexMetaRecordWithGeneration(
		t,
		currentIndexMetaRecordForTest("meta-2", "execution-2", "message-2"),
		2,
	)
	document := "index_meta_Docs"
	existing := currentStoredIndexMeta{
		id:       "current-physical-row",
		document: &document,
		metadata: map[string]any{
			"collection":           "Docs",
			"type":                 "index_meta",
			"state":                "completed",
			"execution_generation": json.Number("1"),
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
	if len(items) != 2 {
		t.Fatalf("history=%#v", items)
	}
	if !reflect.DeepEqual(items, existing.metadata["history"]) {
		t.Fatalf(
			"history changed on reindex: got=%#v want=%#v",
			items,
			existing.metadata["history"],
		)
	}
	if metadata["state"] != "in_progress" ||
		metadata["task_id"] != "execution-2" {
		t.Fatalf("metadata=%#v", metadata)
	}
}

func TestPlanCurrentInitialIndexMetaAdoptsLiveHybridBaselineShape(t *testing.T) {
	record := currentIndexMetaRecordWithGeneration(
		t,
		currentIndexMetaRecordForTest("meta-16", "execution-16", "message-16"),
		16,
	)
	record = currentIndexMetaRecordWithIndexName(t, record, "new13")
	stored, baselineHistory := currentHybridLiveStoredForTest(t, record)
	raw, err := json.Marshal(stored.metadata)
	if err != nil {
		t.Fatal(err)
	}
	if len(baselineHistory) != 37 ||
		len(raw) != currentHybridLiveMetadataBytes {
		t.Fatalf("history entries=%d metadata bytes=%d", len(baselineHistory), len(raw))
	}

	plan, err := planCurrentInitialIndexMeta(
		record,
		[]currentStoredIndexMeta{stored},
	)
	if err != nil {
		t.Fatal(err)
	}
	if plan.insert || plan.noop || plan.id != stored.id ||
		plan.document != record.Document {
		t.Fatalf("plan=%+v", plan)
	}
	metadata := mustDecodeCurrentIndexMeta(t, plan.metadata)
	history := currentIndexMetaHistory(metadata["history"])
	if !reflect.DeepEqual(history, baselineHistory) {
		t.Fatalf(
			"history changed during adoption: got=%#v want=%#v",
			history,
			baselineHistory,
		)
	}
	if metadata["index_meta_id"] != record.MetaID ||
		metadata["execution_id"] != record.ExecutionID ||
		metadata["index_generation"] != json.Number("16") ||
		metadata["state"] != "in_progress" {
		t.Fatalf("metadata=%#v", metadata)
	}
}

func TestPlanCurrentInitialIndexMetaAdoptsEncodedBaselineConfiguration(
	t *testing.T,
) {
	record := currentIndexMetaRecordWithGeneration(
		t,
		currentIndexMetaRecordForTest(
			"meta-16",
			"execution-16",
			"message-16",
		),
		16,
	)
	stored, _ := currentHybridAdoptionStoredForTest(t, record)
	history := currentIndexMetaHistory(stored.metadata["history"])
	for _, position := range []int{len(history) - 2, len(history) - 1} {
		history[position].(map[string]any)["index_configuration"] =
			`{"index_name":"Docs"}`
	}
	setCurrentHybridAdoptionHistory(t, &stored, history)

	plan, err := planCurrentInitialIndexMeta(
		record,
		[]currentStoredIndexMeta{stored},
	)
	if err != nil {
		t.Fatal(err)
	}
	if plan.insert || plan.noop || plan.id != stored.id {
		t.Fatalf("plan=%+v", plan)
	}
}

func TestPlanCurrentInitialIndexMetaAdoptsPureBaselineOnlyAsFirstGeneration(
	t *testing.T,
) {
	record := currentIndexMetaRecordForTest(
		"meta-1",
		"execution-1",
		"message-1",
	)
	stored, history := currentPureBaselineStoredForTest(t, record)

	plan, err := planCurrentInitialIndexMeta(
		record,
		[]currentStoredIndexMeta{stored},
	)
	if err != nil {
		t.Fatal(err)
	}
	if plan.insert || plan.noop || plan.id != stored.id {
		t.Fatalf("plan=%+v", plan)
	}
	if actual := currentIndexMetaHistory(
		mustDecodeCurrentIndexMeta(t, plan.metadata)["history"],
	); !reflect.DeepEqual(actual, history) {
		t.Fatalf("history changed: got=%#v want=%#v", actual, history)
	}

	second := currentIndexMetaRecordWithGeneration(t, record, 2)
	if _, err := planCurrentInitialIndexMeta(
		second,
		[]currentStoredIndexMeta{stored},
	); !errors.Is(err, indexingapp.ErrCurrentIndexMetaConflict) {
		t.Fatalf("second-generation pure baseline error=%v", err)
	}
}

func TestPlanCurrentInitialIndexMetaRejectsNonSourcePureBaselineLifecycle(
	t *testing.T,
) {
	tests := []struct {
		name   string
		mutate func([]any) []any
	}{
		{
			name: "missing created marker",
			mutate: func(history []any) []any {
				return history[1:]
			},
		},
		{
			name: "created marker outside history zero",
			mutate: func(history []any) []any {
				return []any{
					cloneCurrentIndexMetaValue(history[1]),
					cloneCurrentIndexMetaValue(history[0]),
					cloneCurrentIndexMetaValue(history[1]),
				}
			},
		},
		{
			name: "multiple terminal runs",
			mutate: func(history []any) []any {
				return append(
					history,
					cloneCurrentIndexMetaValue(history[1]),
				)
			},
		},
		{
			name: "malformed created marker",
			mutate: func(history []any) []any {
				history[0].(map[string]any)["task_id"] = "unexpected"
				return history
			},
		},
		{
			name: "created marker missing configuration",
			mutate: func(history []any) []any {
				delete(
					history[0].(map[string]any),
					"index_configuration",
				)
				return history
			},
		},
		{
			name: "created marker has unexpected field",
			mutate: func(history []any) []any {
				history[0].(map[string]any)["unexpected"] = true
				return history
			},
		},
		{
			name: "created marker has non-source error",
			mutate: func(history []any) []any {
				history[0].(map[string]any)["error"] = "unexpected"
				return history
			},
		},
		{
			name: "created marker configuration drifts from lifecycle",
			mutate: func(history []any) []any {
				history[0].(map[string]any)["index_configuration"] =
					map[string]any{"index_name": "Other"}
				return history
			},
		},
		{
			name: "created terminal lifecycle drift",
			mutate: func(history []any) []any {
				history[1].(map[string]any)["created_on"] =
					json.Number("1700000001.25")
				return history
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			record := currentIndexMetaRecordForTest(
				"meta-1",
				"execution-1",
				"message-1",
			)
			stored, history := currentPureBaselineStoredForTest(t, record)
			history = test.mutate(history)
			setCurrentHybridAdoptionHistory(t, &stored, history)
			if _, err := planCurrentInitialIndexMeta(
				record,
				[]currentStoredIndexMeta{stored},
			); !errors.Is(err, indexingapp.ErrCurrentIndexMetaConflict) {
				t.Fatalf("error=%v", err)
			}
		})
	}
}

func TestPlanCurrentInitialIndexMetaRejectsUnsafeHybridAdoption(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*indexingapp.CurrentInitialIndexMeta, *currentStoredIndexMeta)
		want   error
	}{
		{
			name: "partial top-level fence",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				stored.metadata["execution_id"] = "partial"
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "wrong physical document",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				document := "index_meta_Other"
				stored.document = &document
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "missing physical row identity",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				stored.id = ""
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "wrong top-level index",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				stored.metadata["collection"] = "Other"
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "wrong top-level toolkit",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				stored.metadata["toolkit_id"] = json.Number("20")
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "wrong typed-history toolkit",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				history[2].(map[string]any)["toolkit_id"] = json.Number("20")
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "malformed typed generation",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				history[2].(map[string]any)["index_generation"] = "malformed"
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "partial legacy fence before typed history",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				delete(history[0].(map[string]any), "correlation_id")
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "unmatched legacy active before typed history",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				active := cloneCurrentIndexMetaObject(
					history[0].(map[string]any),
				)
				active["state"] = "in_progress"
				active["execution_id"] = "unmatched-legacy-execution"
				active["index_meta_id"] = "unmatched-legacy-meta"
				active["correlation_id"] = "unmatched-legacy-message"
				history = append(
					history[:1],
					append([]any{active}, history[1:]...)...,
				)
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "partial fence after typed history",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				history[3].(map[string]any)["execution_id"] = "partial"
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "equal generation",
			mutate: func(record *indexingapp.CurrentInitialIndexMeta, _ *currentStoredIndexMeta) {
				*record = currentIndexMetaRecordWithGeneration(t, *record, 15)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "newer stored generation",
			mutate: func(record *indexingapp.CurrentInitialIndexMeta, _ *currentStoredIndexMeta) {
				*record = currentIndexMetaRecordWithGeneration(t, *record, 14)
			},
			want: indexingapp.ErrCurrentIndexMetaSuperseded,
		},
		{
			name: "ambiguous highest generation",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				duplicate := cloneCurrentIndexMetaValue(history[2])
				history = append(
					history[:3],
					append([]any{duplicate}, history[3:]...)...,
				)
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "active highest generation",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				history = append(history[:2], history[3:]...)
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "active older typed generation",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				active := cloneCurrentIndexMetaObject(
					history[1].(map[string]any),
				)
				active["index_generation"] = json.Number("14")
				active["execution_id"] = "execution-14"
				active["index_meta_id"] = "meta-14"
				active["correlation_id"] = "message-14"
				history = append(
					history[:1],
					append([]any{active}, history[1:]...)...,
				)
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "arbitrary pure baseline entry after typed history",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				extra := cloneCurrentIndexMetaValue(history[len(history)-1])
				history = append(
					history[:len(history)-2],
					append([]any{extra}, history[len(history)-2:]...)...,
				)
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "typed entry after baseline suffix starts",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				typed := cloneCurrentIndexMetaValue(history[2])
				history = append(
					history[:len(history)-1],
					append([]any{typed}, history[len(history)-1:]...)...,
				)
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "baseline active missing configuration",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				delete(
					history[len(history)-2].(map[string]any),
					"index_configuration",
				)
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "baseline terminal missing configuration",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				delete(
					history[len(history)-1].(map[string]any),
					"index_configuration",
				)
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "baseline configuration drift",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				history[len(history)-1].(map[string]any)["index_configuration"] =
					map[string]any{"index_name": "Other"}
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "baseline active missing task",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				delete(history[len(history)-2].(map[string]any), "task_id")
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "baseline terminal missing task",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				delete(history[len(history)-1].(map[string]any), "task_id")
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "baseline terminal task identity drift",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				history[len(history)-1].(map[string]any)["task_id"] =
					"different-task"
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "baseline active missing conversation",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				delete(
					history[len(history)-2].(map[string]any),
					"conversation_id",
				)
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "baseline terminal missing conversation",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				delete(
					history[len(history)-1].(map[string]any),
					"conversation_id",
				)
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "baseline terminal conversation identity drift",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				history[len(history)-1].(map[string]any)["conversation_id"] =
					"different-conversation"
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "baseline active timestamp reversal",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				history[len(history)-2].(map[string]any)["updated_on"] =
					json.Number("1800000001.25")
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "baseline terminal timestamp reversal",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				history[len(history)-1].(map[string]any)["updated_on"] =
					json.Number("1700000000.25")
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "baseline active negative count",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				history[len(history)-2].(map[string]any)["indexed"] =
					json.Number("-1")
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "baseline terminal negative count",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				history[len(history)-1].(map[string]any)["updated"] =
					json.Number("-1")
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "baseline terminal nested history",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				history[len(history)-1].(map[string]any)["history"] = "[]"
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "execution identity reused across typed generations",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				insertCurrentHybridTypedGenerationForTest(
					t,
					stored,
					"execution_id",
				)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "metadata identity reused across typed generations",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				insertCurrentHybridTypedGenerationForTest(
					t,
					stored,
					"index_meta_id",
				)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "correlation identity reused across typed generations",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				insertCurrentHybridTypedGenerationForTest(
					t,
					stored,
					"correlation_id",
				)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "active baseline top",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				top := cloneCurrentIndexMetaObject(
					history[len(history)-1].(map[string]any),
				)
				top["state"] = "in_progress"
				history[len(history)-1] = top
				setCurrentHybridAdoptionHistory(t, stored, history)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "oversized history",
			mutate: func(_ *indexingapp.CurrentInitialIndexMeta, stored *currentStoredIndexMeta) {
				history := currentIndexMetaHistory(stored.metadata["history"])
				last := history[len(history)-1]
				oversized := make(
					[]any,
					maxCurrentIndexMetaAdoptionHistory+1,
				)
				for index := range oversized {
					oversized[index] = cloneCurrentIndexMetaValue(last)
				}
				setCurrentHybridAdoptionHistory(t, stored, oversized)
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			record := currentIndexMetaRecordWithGeneration(
				t,
				currentIndexMetaRecordForTest(
					"meta-16",
					"execution-16",
					"message-16",
				),
				16,
			)
			stored, _ := currentHybridAdoptionStoredForTest(t, record)
			test.mutate(&record, &stored)
			if _, err := planCurrentInitialIndexMeta(
				record,
				[]currentStoredIndexMeta{stored},
			); !errors.Is(err, test.want) {
				t.Fatalf("error=%v want=%v", err, test.want)
			}
		})
	}
}

func TestPlanCurrentTerminalIndexMetaFencesRetriesAndAllowsNextGeneration(t *testing.T) {
	for _, state := range []indexingapp.CurrentIndexMetaTerminalState{
		indexingapp.CurrentIndexMetaFailed,
		indexingapp.CurrentIndexMetaCancelled,
	} {
		t.Run(string(state), func(t *testing.T) {
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
			occurredAt := time.Date(2026, time.July, 26, 12, 13, 14, 567_000_000, time.UTC)
			terminal := indexingapp.CurrentTerminalIndexMeta{
				MetaID:          first.MetaID,
				ExecutionID:     first.ExecutionID,
				Generation:      first.Generation,
				IndexGeneration: first.IndexGeneration,
				IndexName:       first.IndexName,
				ToolkitID:       first.ToolkitID,
				State:           state,
				OccurredAt:      occurredAt,
			}
			if state == indexingapp.CurrentIndexMetaFailed {
				terminal.SafeError = "A dependency is unavailable."
			}
			terminalPlan, err := planCurrentTerminalIndexMeta(terminal, []currentStoredIndexMeta{existing})
			if err != nil {
				t.Fatal(err)
			}
			if terminalPlan.noop || terminalPlan.insert || terminalPlan.id != "meta-1" {
				t.Fatalf("terminal plan=%+v", terminalPlan)
			}
			terminalMetadata := mustDecodeCurrentIndexMeta(t, terminalPlan.metadata)
			if terminalMetadata["state"] != string(state) ||
				terminalMetadata["updated_on"] != currentIndexMetaUnixSeconds(occurredAt) {
				t.Fatalf("terminal metadata=%#v", terminalMetadata)
			}
			if state == indexingapp.CurrentIndexMetaCancelled && terminalMetadata["task_id"] != nil {
				t.Fatalf("cancelled metadata retained task_id=%#v", terminalMetadata["task_id"])
			}
			if state == indexingapp.CurrentIndexMetaFailed &&
				terminalMetadata["error"] != terminal.SafeError {
				t.Fatalf("failed metadata error=%#v", terminalMetadata["error"])
			}
			history := currentIndexMetaHistory(terminalMetadata["history"])
			if len(history) != 2 {
				t.Fatalf("terminal history=%#v", history)
			}
			assertCurrentIndexMetaCreatedMarker(t, history[0], "Docs")
			if !reflect.DeepEqual(history[1], func() map[string]any {
				current := cloneCurrentIndexMetaObject(terminalMetadata)
				delete(current, "history")
				return current
			}()) {
				t.Fatalf("terminal history=%#v", history)
			}

			// A compatible SDK/baseline terminal write may author a different
			// timestamp or safe failure text. Stable identity and outcome must
			// converge instead of requiring byte-identical metadata/history.
			compatibleMetadata := cloneCurrentIndexMetaObject(terminalMetadata)
			compatibleMetadata["updated_on"] = json.Number("1777777777.5")
			compatibleHistory := currentIndexMetaHistory(compatibleMetadata["history"])
			compatibleHistory[len(compatibleHistory)-1].(map[string]any)["updated_on"] = json.Number("1777777777.5")
			if state == indexingapp.CurrentIndexMetaFailed {
				compatibleMetadata["error"] = "SDK-compatible safe failure."
				compatibleHistory[len(compatibleHistory)-1].(map[string]any)["error"] = "SDK-compatible safe failure."
			}
			compatibleEncoded, err := encodeCurrentIndexMetaWithHistory(
				func() map[string]any {
					copy := cloneCurrentIndexMetaObject(compatibleMetadata)
					delete(copy, "history")
					return copy
				}(),
				compatibleHistory,
			)
			if err != nil {
				t.Fatal(err)
			}
			compatibleMetadata = mustDecodeCurrentIndexMeta(t, compatibleEncoded)
			replayed, err := planCurrentTerminalIndexMeta(terminal, []currentStoredIndexMeta{{
				id:       terminalPlan.id,
				document: &document,
				metadata: compatibleMetadata,
			}})
			if err != nil {
				t.Fatal(err)
			}
			if !replayed.noop || replayed.insert || len(replayed.metadata) != 0 {
				t.Fatalf("terminal replay=%+v", replayed)
			}

			next := currentIndexMetaRecordForTest("meta-2", "execution-2", "message-2")
			next = currentIndexMetaRecordWithGeneration(t, next, 2)
			nextPlan, err := planCurrentInitialIndexMeta(next, []currentStoredIndexMeta{{
				id:       terminalPlan.id,
				document: &document,
				metadata: terminalMetadata,
			}})
			if err != nil {
				t.Fatalf("next generation: %v", err)
			}
			if nextPlan.noop || nextPlan.insert || nextPlan.id != "meta-1" {
				t.Fatalf("next plan=%+v", nextPlan)
			}
		})
	}
}

func TestPlanCurrentTerminalIndexMetaRejectsDifferentGeneration(t *testing.T) {
	first := currentIndexMetaRecordForTest("meta-1", "execution-1", "message-1")
	created, err := planCurrentInitialIndexMeta(first, nil)
	if err != nil {
		t.Fatal(err)
	}
	document := created.document
	errRecord := indexingapp.CurrentTerminalIndexMeta{
		MetaID:          "meta-1",
		ExecutionID:     "execution-1",
		Generation:      2,
		IndexGeneration: first.IndexGeneration,
		IndexName:       "Docs",
		ToolkitID:       19,
		State:           indexingapp.CurrentIndexMetaFailed,
		OccurredAt:      time.Now(),
		SafeError:       "A dependency is unavailable.",
	}
	if _, err := planCurrentTerminalIndexMeta(errRecord, []currentStoredIndexMeta{{
		id:       created.id,
		document: &document,
		metadata: mustDecodeCurrentIndexMeta(t, created.metadata),
	}}); !errors.Is(err, indexingapp.ErrCurrentIndexMetaConflict) {
		t.Fatalf("error=%v", err)
	}
}

func TestPlanCurrentTerminalIndexMetaRejectsPartiallyMatchingHistoryRun(
	t *testing.T,
) {
	initial := currentIndexMetaRecordForTest(
		"meta-1",
		"execution-1",
		"message-1",
	)
	created, err := planCurrentInitialIndexMeta(initial, nil)
	if err != nil {
		t.Fatal(err)
	}
	document := created.document
	metadata := mustDecodeCurrentIndexMeta(t, created.metadata)
	history := currentIndexMetaHistory(metadata["history"])
	active := cloneCurrentIndexMetaObject(metadata)
	delete(active, "history")
	active["execution_generation"] = json.Number("2")
	history = append(history, active)
	encoded, err := encodeCurrentIndexMetaWithHistory(
		func() map[string]any {
			top := cloneCurrentIndexMetaObject(metadata)
			delete(top, "history")
			return top
		}(),
		history,
	)
	if err != nil {
		t.Fatal(err)
	}
	terminal := indexingapp.CurrentTerminalIndexMeta{
		MetaID:          initial.MetaID,
		ExecutionID:     initial.ExecutionID,
		Generation:      initial.Generation,
		IndexGeneration: initial.IndexGeneration,
		IndexName:       initial.IndexName,
		ToolkitID:       initial.ToolkitID,
		State:           indexingapp.CurrentIndexMetaFailed,
		OccurredAt:      time.Now(),
		SafeError:       "A dependency is unavailable.",
	}
	if _, err := planCurrentTerminalIndexMeta(
		terminal,
		[]currentStoredIndexMeta{{
			id:       created.id,
			document: &document,
			metadata: mustDecodeCurrentIndexMeta(t, encoded),
		}},
	); !errors.Is(err, indexingapp.ErrCurrentIndexMetaConflict) {
		t.Fatalf("error=%v", err)
	}
}

func TestPlanCurrentTerminalIndexMetaConvergesLegacyDualWriterHistory(
	t *testing.T,
) {
	for _, test := range []struct {
		name          string
		currentState  string
		terminalState indexingapp.CurrentIndexMetaTerminalState
		indexed       int64
	}{
		{
			name:          "SDK active",
			currentState:  "in_progress",
			terminalState: indexingapp.CurrentIndexMetaFailed,
		},
		{
			name:          "SDK completed",
			currentState:  "completed",
			terminalState: indexingapp.CurrentIndexMetaCancelled,
			indexed:       61,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			initial := currentIndexMetaRecordForTest(
				"meta-1",
				"execution-1",
				"message-1",
			)
			top := mustDecodeCurrentIndexMeta(t, initial.InitialMetadata)
			top["state"] = test.currentState
			top["indexed"] = test.indexed
			bootstrap := cloneCurrentIndexMetaObject(
				mustDecodeCurrentIndexMeta(t, initial.InitialMetadata),
			)
			sdkRun := cloneCurrentIndexMetaObject(top)
			encoded, err := encodeCurrentIndexMetaWithHistory(
				top,
				[]any{bootstrap, sdkRun},
			)
			if err != nil {
				t.Fatal(err)
			}
			document := initial.Document
			terminal := indexingapp.CurrentTerminalIndexMeta{
				MetaID:          initial.MetaID,
				ExecutionID:     initial.ExecutionID,
				Generation:      initial.Generation,
				IndexGeneration: initial.IndexGeneration,
				IndexName:       initial.IndexName,
				ToolkitID:       initial.ToolkitID,
				State:           test.terminalState,
				OccurredAt:      time.Now(),
			}
			if test.terminalState == indexingapp.CurrentIndexMetaFailed {
				terminal.SafeError = "A dependency is unavailable."
			}
			plan, err := planCurrentTerminalIndexMeta(
				terminal,
				[]currentStoredIndexMeta{{
					id:       initial.MetaID,
					document: &document,
					metadata: mustDecodeCurrentIndexMeta(t, encoded),
				}},
			)
			if err != nil {
				t.Fatal(err)
			}
			metadata := mustDecodeCurrentIndexMeta(t, plan.metadata)
			history := currentIndexMetaHistory(metadata["history"])
			if len(history) != 2 ||
				history[0].(map[string]any)["state"] != "in_progress" ||
				history[1].(map[string]any)["state"] !=
					string(test.terminalState) ||
				history[1].(map[string]any)["indexed"] !=
					json.Number(strconv.FormatInt(test.indexed, 10)) {
				t.Fatalf("metadata=%#v history=%#v", metadata, history)
			}
		})
	}
}

func TestPlanCurrentTerminalIndexMetaRejectsThreeMatchingHistoryRuns(
	t *testing.T,
) {
	initial := currentIndexMetaRecordForTest(
		"meta-1",
		"execution-1",
		"message-1",
	)
	top := mustDecodeCurrentIndexMeta(t, initial.InitialMetadata)
	active := cloneCurrentIndexMetaObject(top)
	encoded, err := encodeCurrentIndexMetaWithHistory(
		top,
		[]any{
			cloneCurrentIndexMetaValue(active),
			cloneCurrentIndexMetaValue(active),
			cloneCurrentIndexMetaValue(active),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	document := initial.Document
	if _, err := planCurrentTerminalIndexMeta(
		indexingapp.CurrentTerminalIndexMeta{
			MetaID:          initial.MetaID,
			ExecutionID:     initial.ExecutionID,
			Generation:      initial.Generation,
			IndexGeneration: initial.IndexGeneration,
			IndexName:       initial.IndexName,
			ToolkitID:       initial.ToolkitID,
			State:           indexingapp.CurrentIndexMetaFailed,
			OccurredAt:      time.Now(),
			SafeError:       "A dependency is unavailable.",
		},
		[]currentStoredIndexMeta{{
			id:       initial.MetaID,
			document: &document,
			metadata: mustDecodeCurrentIndexMeta(t, encoded),
		}},
	); !errors.Is(err, indexingapp.ErrCurrentIndexMetaConflict) {
		t.Fatalf("error=%v", err)
	}
}

func TestPlanCurrentCancellationConvergesLateSDKCompletionForSameExecution(t *testing.T) {
	initial := currentIndexMetaRecordForTest("meta-1", "execution-1", "message-1")
	created, err := planCurrentInitialIndexMeta(initial, nil)
	if err != nil {
		t.Fatal(err)
	}
	document := created.document
	completed := mustDecodeCurrentIndexMeta(t, created.metadata)
	completed["state"] = "completed"
	completed["indexed"] = json.Number("66")
	completed["skipped"] = `{"total_skipped":5}`
	completed["updated_on"] = json.Number("1777777777.5")
	history := currentIndexMetaHistory(completed["history"])
	history = append(history, func() map[string]any {
		copy := cloneCurrentIndexMetaObject(completed)
		delete(copy, "history")
		return copy
	}())
	completedBytes, err := encodeCurrentIndexMetaWithHistory(
		history[len(history)-1].(map[string]any),
		history,
	)
	if err != nil {
		t.Fatal(err)
	}
	completed = mustDecodeCurrentIndexMeta(t, completedBytes)

	cancelled := indexingapp.CurrentTerminalIndexMeta{
		MetaID:          initial.MetaID,
		ExecutionID:     initial.ExecutionID,
		Generation:      initial.Generation,
		IndexGeneration: initial.IndexGeneration,
		IndexName:       initial.IndexName,
		ToolkitID:       initial.ToolkitID,
		State:           indexingapp.CurrentIndexMetaCancelled,
		OccurredAt:      time.Date(2026, time.July, 26, 13, 45, 0, 0, time.UTC),
	}
	plan, err := planCurrentTerminalIndexMeta(cancelled, []currentStoredIndexMeta{{
		id:       created.id,
		document: &document,
		metadata: completed,
	}})
	if err != nil {
		t.Fatal(err)
	}
	if plan.noop || plan.insert || plan.id != created.id {
		t.Fatalf("plan=%+v", plan)
	}
	metadata := mustDecodeCurrentIndexMeta(t, plan.metadata)
	if metadata["state"] != "cancelled" || metadata["task_id"] != nil ||
		metadata["indexed"] != json.Number("66") ||
		metadata["skipped"] != `{"total_skipped":5}` {
		t.Fatalf("metadata=%#v", metadata)
	}
	history = currentIndexMetaHistory(metadata["history"])
	if len(history) != 2 ||
		history[0].(map[string]any)["state"] != "created" ||
		history[1].(map[string]any)["state"] != "cancelled" ||
		history[1].(map[string]any)["indexed"] != json.Number("66") {
		t.Fatalf("history=%#v", history)
	}

	replay, err := planCurrentTerminalIndexMeta(cancelled, []currentStoredIndexMeta{{
		id:       created.id,
		document: &document,
		metadata: metadata,
	}})
	if err != nil || !replay.noop {
		t.Fatalf("replay=%+v err=%v", replay, err)
	}
}

func TestPlanCurrentFailureConvergesCompatibleSDKTerminalStates(t *testing.T) {
	for _, sdkState := range []string{
		"completed",
		"partly_indexed",
		"scheduled_reindex",
	} {
		t.Run(sdkState, func(t *testing.T) {
			initial := currentIndexMetaRecordForTest(
				"meta-1",
				"execution-1",
				"message-1",
			)
			created, err := planCurrentInitialIndexMeta(initial, nil)
			if err != nil {
				t.Fatal(err)
			}
			document := created.document
			sdk := mustDecodeCurrentIndexMeta(t, created.metadata)
			sdk["state"] = sdkState
			sdk["indexed"] = json.Number("61")
			sdk["skipped"] = `{"total_skipped":5}`
			history := currentIndexMetaHistory(sdk["history"])
			history = append(history, func() map[string]any {
				copy := cloneCurrentIndexMetaObject(sdk)
				delete(copy, "history")
				return copy
			}())
			encoded, err := encodeCurrentIndexMetaWithHistory(
				history[len(history)-1].(map[string]any),
				history,
			)
			if err != nil {
				t.Fatal(err)
			}
			sdk = mustDecodeCurrentIndexMeta(t, encoded)

			failed := indexingapp.CurrentTerminalIndexMeta{
				MetaID:          initial.MetaID,
				ExecutionID:     initial.ExecutionID,
				Generation:      initial.Generation,
				IndexGeneration: initial.IndexGeneration,
				IndexName:       initial.IndexName,
				ToolkitID:       initial.ToolkitID,
				State:           indexingapp.CurrentIndexMetaFailed,
				OccurredAt:      time.Date(2026, time.July, 26, 13, 45, 0, 0, time.UTC),
				SafeError:       "Indexing failed before completion.",
			}
			plan, err := planCurrentTerminalIndexMeta(
				failed,
				[]currentStoredIndexMeta{{
					id:       created.id,
					document: &document,
					metadata: sdk,
				}},
			)
			if err != nil {
				t.Fatal(err)
			}
			metadata := mustDecodeCurrentIndexMeta(t, plan.metadata)
			if metadata["state"] != "failed" ||
				metadata["error"] != failed.SafeError ||
				metadata["indexed"] != json.Number("61") ||
				metadata["skipped"] != `{"total_skipped":5}` {
				t.Fatalf("metadata=%#v", metadata)
			}
			history = currentIndexMetaHistory(metadata["history"])
			if len(history) != 2 ||
				history[0].(map[string]any)["state"] != "created" ||
				history[1].(map[string]any)["state"] != "failed" ||
				history[1].(map[string]any)["indexed"] !=
					json.Number("61") {
				t.Fatalf("history=%#v", history)
			}
		})
	}
}

func TestPlanCurrentTerminalMarksOlderGenerationSuperseded(t *testing.T) {
	current := currentIndexMetaRecordWithGeneration(
		t,
		currentIndexMetaRecordForTest("meta-2", "execution-2", "message-2"),
		2,
	)
	created, err := planCurrentInitialIndexMeta(current, nil)
	if err != nil {
		t.Fatal(err)
	}
	document := created.document
	old := indexingapp.CurrentTerminalIndexMeta{
		MetaID:          "meta-1",
		ExecutionID:     "execution-1",
		Generation:      1,
		IndexGeneration: 1,
		IndexName:       current.IndexName,
		ToolkitID:       current.ToolkitID,
		State:           indexingapp.CurrentIndexMetaCancelled,
		OccurredAt:      time.Now(),
	}
	if _, err := planCurrentTerminalIndexMeta(
		old,
		[]currentStoredIndexMeta{{
			id:       created.id,
			document: &document,
			metadata: mustDecodeCurrentIndexMeta(t, created.metadata),
		}},
	); !errors.Is(err, indexingapp.ErrCurrentIndexMetaSuperseded) {
		t.Fatalf("error=%v", err)
	}
}

func TestPlanCurrentManualStopCleanupRequiresExactCancelledGeneration(
	t *testing.T,
) {
	initial := currentIndexMetaRecordForTest(
		"meta-1",
		"execution-1",
		"message-1",
	)
	created, err := planCurrentInitialIndexMeta(initial, nil)
	if err != nil {
		t.Fatal(err)
	}
	document := created.document
	existing := currentStoredIndexMeta{
		id:       created.id,
		document: &document,
		metadata: mustDecodeCurrentIndexMeta(t, created.metadata),
	}
	cleanup := indexingapp.CurrentManualStopCleanup{
		MetaID:          initial.MetaID,
		ExecutionID:     initial.ExecutionID,
		Generation:      initial.Generation,
		IndexGeneration: initial.IndexGeneration,
		IndexName:       initial.IndexName,
		ToolkitID:       initial.ToolkitID,
	}
	if err := planCurrentManualStopCleanup(
		cleanup,
		[]currentStoredIndexMeta{existing},
	); !errors.Is(err, indexingapp.ErrCurrentIndexMetaConflict) {
		t.Fatalf("active cleanup error=%v", err)
	}

	cancelled := indexingapp.CurrentTerminalIndexMeta{
		MetaID:          initial.MetaID,
		ExecutionID:     initial.ExecutionID,
		Generation:      initial.Generation,
		IndexGeneration: initial.IndexGeneration,
		IndexName:       initial.IndexName,
		ToolkitID:       initial.ToolkitID,
		State:           indexingapp.CurrentIndexMetaCancelled,
		OccurredAt:      time.Now(),
	}
	terminal, err := planCurrentTerminalIndexMeta(
		cancelled,
		[]currentStoredIndexMeta{existing},
	)
	if err != nil {
		t.Fatal(err)
	}
	existing.metadata = mustDecodeCurrentIndexMeta(t, terminal.metadata)
	if err := planCurrentManualStopCleanup(
		cleanup,
		[]currentStoredIndexMeta{existing},
	); err != nil {
		t.Fatalf("cancelled cleanup error=%v", err)
	}

	newer := currentIndexMetaRecordWithGeneration(
		t,
		currentIndexMetaRecordForTest(
			"meta-2",
			"execution-2",
			"message-2",
		),
		2,
	)
	next, err := planCurrentInitialIndexMeta(
		newer,
		[]currentStoredIndexMeta{existing},
	)
	if err != nil {
		t.Fatal(err)
	}
	existing.metadata = mustDecodeCurrentIndexMeta(t, next.metadata)
	if err := planCurrentManualStopCleanup(
		cleanup,
		[]currentStoredIndexMeta{existing},
	); !errors.Is(err, indexingapp.ErrCurrentIndexMetaSuperseded) {
		t.Fatalf("stale cleanup error=%v", err)
	}
}

func TestPlanCurrentManualStopCleanupRejectsToolkitOrHistoryDrift(t *testing.T) {
	initial := currentIndexMetaRecordForTest(
		"meta-1",
		"execution-1",
		"message-1",
	)
	created, err := planCurrentInitialIndexMeta(initial, nil)
	if err != nil {
		t.Fatal(err)
	}
	document := created.document
	terminal, err := planCurrentTerminalIndexMeta(
		indexingapp.CurrentTerminalIndexMeta{
			MetaID:          initial.MetaID,
			ExecutionID:     initial.ExecutionID,
			Generation:      initial.Generation,
			IndexGeneration: initial.IndexGeneration,
			IndexName:       initial.IndexName,
			ToolkitID:       initial.ToolkitID,
			State:           indexingapp.CurrentIndexMetaCancelled,
			OccurredAt:      time.Now(),
		},
		[]currentStoredIndexMeta{{
			id:       created.id,
			document: &document,
			metadata: mustDecodeCurrentIndexMeta(t, created.metadata),
		}},
	)
	if err != nil {
		t.Fatal(err)
	}
	cleanup := indexingapp.CurrentManualStopCleanup{
		MetaID:          initial.MetaID,
		ExecutionID:     initial.ExecutionID,
		Generation:      initial.Generation,
		IndexGeneration: initial.IndexGeneration,
		IndexName:       initial.IndexName,
		ToolkitID:       initial.ToolkitID,
	}
	for name, mutate := range map[string]func(map[string]any){
		"toolkit": func(value map[string]any) {
			value["toolkit_id"] = json.Number("20")
		},
		"history": func(value map[string]any) {
			items := currentIndexMetaHistory(value["history"])
			items[len(items)-1].(map[string]any)["execution_id"] = "other"
			historyBytes, marshalErr := json.Marshal(items)
			if marshalErr != nil {
				t.Fatal(marshalErr)
			}
			value["history"] = string(historyBytes)
		},
	} {
		t.Run(name, func(t *testing.T) {
			value := mustDecodeCurrentIndexMeta(t, terminal.metadata)
			mutate(value)
			if err := planCurrentManualStopCleanup(
				cleanup,
				[]currentStoredIndexMeta{{
					id:       created.id,
					document: &document,
					metadata: value,
				}},
			); !errors.Is(err, indexingapp.ErrCurrentIndexMetaConflict) {
				t.Fatalf("error=%v", err)
			}
		})
	}
}

func TestPlanCurrentInitialIndexMetaUsesLegacyGenerationFallback(t *testing.T) {
	next := currentIndexMetaRecordWithGeneration(
		t,
		currentIndexMetaRecordForTest("meta-2", "execution-2", "message-2"),
		2,
	)
	document := "index_meta_Docs"
	legacy := currentStoredIndexMeta{
		id:       "legacy-physical-row",
		document: &document,
		metadata: map[string]any{
			"collection":           "Docs",
			"type":                 "index_meta",
			"state":                "completed",
			"execution_generation": json.Number("1"),
			"history": []any{
				map[string]any{
					"state":                "completed",
					"execution_generation": json.Number("1"),
				},
			},
		},
	}
	plan, err := planCurrentInitialIndexMeta(next, []currentStoredIndexMeta{legacy})
	if err != nil {
		t.Fatal(err)
	}
	if plan.noop || plan.insert || plan.id != legacy.id {
		t.Fatalf("plan=%+v", plan)
	}
	metadata := mustDecodeCurrentIndexMeta(t, plan.metadata)
	if metadata["index_generation"] != json.Number("2") {
		t.Fatalf("metadata=%#v", metadata)
	}
}

func TestPlanCurrentInitialIndexMetaRetriesLegacyEmptyHistory(t *testing.T) {
	next := currentIndexMetaRecordWithGeneration(
		t,
		currentIndexMetaRecordForTest("meta-2", "execution-2", "message-2"),
		2,
	)
	document := "index_meta_Docs"
	legacy := currentStoredIndexMeta{
		id:       "legacy-physical-row",
		document: &document,
		metadata: map[string]any{
			"collection":           "Docs",
			"type":                 "index_meta",
			"state":                "completed",
			"execution_generation": json.Number("1"),
			"history":              []any{},
		},
	}
	planned, err := planCurrentInitialIndexMeta(
		next,
		[]currentStoredIndexMeta{legacy},
	)
	if err != nil {
		t.Fatal(err)
	}
	stored := currentStoredIndexMeta{
		id:       planned.id,
		document: &document,
		metadata: mustDecodeCurrentIndexMeta(t, planned.metadata),
	}
	retry, err := planCurrentInitialIndexMeta(
		next,
		[]currentStoredIndexMeta{stored},
	)
	if err != nil || !retry.noop {
		t.Fatalf("retry=%+v err=%v", retry, err)
	}
	if history := currentIndexMetaHistory(stored.metadata["history"]); len(history) != 0 {
		t.Fatalf("history=%#v", history)
	}
}

func TestPlanCurrentInitialIndexMetaRejectsMalformedPresentLogicalGeneration(t *testing.T) {
	next := currentIndexMetaRecordWithGeneration(
		t,
		currentIndexMetaRecordForTest("meta-2", "execution-2", "message-2"),
		2,
	)
	document := "index_meta_Docs"
	legacy := currentStoredIndexMeta{
		id:       "legacy-physical-row",
		document: &document,
		metadata: map[string]any{
			"state":                "completed",
			"execution_generation": json.Number("1"),
			"index_generation":     "malformed",
			"history":              []any{},
		},
	}
	if _, err := planCurrentInitialIndexMeta(
		next,
		[]currentStoredIndexMeta{legacy},
	); !errors.Is(err, indexingapp.ErrCurrentIndexMetaConflict) {
		t.Fatalf("error=%v", err)
	}
}

func TestPlanCurrentInitialIndexMetaRejectsDelayedOlderLogicalGeneration(t *testing.T) {
	current := currentIndexMetaRecordWithGeneration(
		t,
		currentIndexMetaRecordForTest("meta-2", "execution-2", "message-2"),
		2,
	)
	created, err := planCurrentInitialIndexMeta(current, nil)
	if err != nil {
		t.Fatal(err)
	}
	document := created.document
	delayed := currentIndexMetaRecordForTest("meta-1", "execution-1", "message-1")
	if _, err := planCurrentInitialIndexMeta(
		delayed,
		[]currentStoredIndexMeta{{
			id:       created.id,
			document: &document,
			metadata: mustDecodeCurrentIndexMeta(t, created.metadata),
		}},
	); !errors.Is(err, indexingapp.ErrCurrentIndexMetaSuperseded) {
		t.Fatalf("error=%v", err)
	}
}

func TestPlanCurrentTerminalIndexMetaUpgradesLegacyGenerationMetadata(t *testing.T) {
	initial := currentIndexMetaRecordForTest("meta-1", "execution-1", "message-1")
	created, err := planCurrentInitialIndexMeta(initial, nil)
	if err != nil {
		t.Fatal(err)
	}
	document := created.document
	legacy := mustDecodeCurrentIndexMeta(t, created.metadata)
	history := currentIndexMetaHistory(legacy["history"])
	history = append(history, func() map[string]any {
		active := cloneCurrentIndexMetaObject(legacy)
		delete(active, "history")
		return active
	}())
	delete(legacy, "index_generation")
	delete(history[len(history)-1].(map[string]any), "index_generation")
	legacyBytes, err := encodeCurrentIndexMetaWithHistory(
		func() map[string]any {
			value := cloneCurrentIndexMetaObject(legacy)
			delete(value, "history")
			return value
		}(),
		history,
	)
	if err != nil {
		t.Fatal(err)
	}
	terminal := indexingapp.CurrentTerminalIndexMeta{
		MetaID:          initial.MetaID,
		ExecutionID:     initial.ExecutionID,
		Generation:      initial.Generation,
		IndexGeneration: initial.IndexGeneration,
		IndexName:       initial.IndexName,
		ToolkitID:       initial.ToolkitID,
		State:           indexingapp.CurrentIndexMetaCancelled,
		OccurredAt:      time.Date(2026, time.July, 26, 14, 0, 0, 0, time.UTC),
	}
	plan, err := planCurrentTerminalIndexMeta(
		terminal,
		[]currentStoredIndexMeta{{
			id:       created.id,
			document: &document,
			metadata: mustDecodeCurrentIndexMeta(t, legacyBytes),
		}},
	)
	if err != nil {
		t.Fatal(err)
	}
	metadata := mustDecodeCurrentIndexMeta(t, plan.metadata)
	history = currentIndexMetaHistory(metadata["history"])
	if metadata["index_generation"] != json.Number("1") ||
		history[len(history)-1].(map[string]any)["index_generation"] != json.Number("1") {
		t.Fatalf("metadata=%#v history=%#v", metadata, history)
	}
}

func currentIndexMetaRecordWithGeneration(
	t *testing.T,
	record indexingapp.CurrentInitialIndexMeta,
	generation uint64,
) indexingapp.CurrentInitialIndexMeta {
	t.Helper()
	metadata := mustDecodeCurrentIndexMeta(t, record.InitialMetadata)
	metadata["index_generation"] = generation
	encoded, err := json.Marshal(metadata)
	if err != nil {
		t.Fatal(err)
	}
	record.IndexGeneration = generation
	record.InitialMetadata = encoded
	return record
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
		"index_generation":     1,
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
		IndexGeneration: 1,
		IndexName:       "Docs",
		ToolkitID:       19,
		Document:        "index_meta_Docs",
		InitialMetadata: metadata,
	}
}

const currentHybridLiveMetadataBytes = 203_317

func currentIndexMetaRecordWithIndexName(
	t *testing.T,
	record indexingapp.CurrentInitialIndexMeta,
	indexName string,
) indexingapp.CurrentInitialIndexMeta {
	t.Helper()
	metadata := mustDecodeCurrentIndexMeta(t, record.InitialMetadata)
	metadata["collection"] = indexName
	metadata["index_configuration"] = map[string]any{
		"index_name": indexName,
	}
	encoded, err := json.Marshal(metadata)
	if err != nil {
		t.Fatal(err)
	}
	record.IndexName = indexName
	record.Document = "index_meta_" + indexName
	record.InitialMetadata = encoded
	return record
}

func currentHybridLiveStoredForTest(
	t *testing.T,
	record indexingapp.CurrentInitialIndexMeta,
) (currentStoredIndexMeta, []any) {
	t.Helper()
	base := mustDecodeCurrentIndexMeta(t, record.InitialMetadata)
	legacy := func(group int, state string) map[string]any {
		entry := cloneCurrentIndexMetaObject(base)
		delete(entry, "index_generation")
		suffix := strconv.Itoa(group)
		entry["execution_id"] = "legacy-execution-" + suffix
		entry["execution_generation"] = json.Number("1")
		entry["index_meta_id"] = "legacy-meta-" + suffix
		entry["correlation_id"] = "legacy-message-" + suffix
		entry["task_id"] = entry["execution_id"]
		entry["state"] = state
		if state != "in_progress" {
			entry["task_id"] = nil
			entry["indexed"] = json.Number("61")
			entry["updated"] = json.Number("228")
		}
		return entry
	}
	typed := func(generation int, state string) map[string]any {
		entry := cloneCurrentIndexMetaObject(base)
		suffix := strconv.Itoa(generation)
		entry["execution_id"] = "typed-execution-" + suffix
		entry["execution_generation"] = json.Number("1")
		entry["index_generation"] = json.Number(suffix)
		entry["index_meta_id"] = "typed-meta-" + suffix
		entry["correlation_id"] = "typed-message-" + suffix
		entry["task_id"] = entry["execution_id"]
		entry["state"] = state
		if state != "in_progress" {
			entry["task_id"] = nil
			entry["indexed"] = json.Number("61")
			entry["updated"] = json.Number("228")
		}
		return entry
	}

	history := make([]any, 0, 37)
	history = append(
		history,
		legacy(1, "cancelled"),
		legacy(2, "failed"),
		legacy(3, "failed"),
		legacy(4, "in_progress"),
		legacy(4, "completed"),
		legacy(5, "in_progress"),
		legacy(5, "completed"),
	)
	terminalStates := []string{
		"completed",
		"completed",
		"cancelled",
		"cancelled",
		"cancelled",
		"completed",
		"cancelled",
		"completed",
		"cancelled",
		"completed",
		"cancelled",
		"completed",
		"cancelled",
		"completed",
	}
	for generation := 2; generation <= 15; generation++ {
		history = append(
			history,
			typed(generation, "in_progress"),
			typed(generation, terminalStates[generation-2]),
		)
	}

	baselineActive := cloneCurrentIndexMetaObject(base)
	for _, key := range []string{
		"execution_id",
		"execution_generation",
		"index_generation",
		"index_meta_id",
		"correlation_id",
	} {
		delete(baselineActive, key)
	}
	baselineActive["task_id"] = "baseline-task"
	baselineActive["created_on"] = json.Number("1785157250.6336453")
	baselineActive["updated_on"] = json.Number("1785157250.6336453")
	baselineTerminal := cloneCurrentIndexMetaObject(baselineActive)
	baselineTerminal["state"] = "cancelled"
	baselineTerminal["task_id"] = nil
	baselineTerminal["indexed"] = json.Number("61")
	baselineTerminal["updated"] = json.Number("0")
	baselineTerminal["created_on"] = json.Number("1785157251.6841214")
	baselineTerminal["updated_on"] = json.Number("1785157323.650178")
	configuration, err := json.Marshal(
		baselineTerminal["index_configuration"],
	)
	if err != nil {
		t.Fatal(err)
	}
	baselineTerminal["index_configuration"] = string(configuration)
	history = append(history, baselineActive, baselineTerminal)

	// The captured production row was approximately 203 KiB. A redacted
	// inert field preserves the exact parser/allocation boundary without
	// embedding source configuration or credentials in the fixture.
	history[0].(map[string]any)["fixture_padding"] = ""
	document := record.Document
	stored := currentStoredIndexMeta{
		id:       "physical-row",
		document: &document,
		metadata: cloneCurrentIndexMetaObject(baselineTerminal),
	}
	setCurrentHybridAdoptionHistory(t, &stored, history)
	encoded, err := json.Marshal(stored.metadata)
	if err != nil {
		t.Fatal(err)
	}
	paddingBytes := currentHybridLiveMetadataBytes - len(encoded)
	if paddingBytes < 0 {
		t.Fatalf("live fixture base bytes=%d", len(encoded))
	}
	history[0].(map[string]any)["fixture_padding"] =
		strings.Repeat("x", paddingBytes)
	setCurrentHybridAdoptionHistory(t, &stored, history)
	encoded, err = json.Marshal(stored.metadata)
	if err != nil || len(encoded) != currentHybridLiveMetadataBytes {
		t.Fatalf("live fixture bytes=%d err=%v", len(encoded), err)
	}
	return stored, currentIndexMetaHistory(stored.metadata["history"])
}

func currentPureBaselineStoredForTest(
	t *testing.T,
	record indexingapp.CurrentInitialIndexMeta,
) (currentStoredIndexMeta, []any) {
	t.Helper()
	active := mustDecodeCurrentIndexMeta(t, record.InitialMetadata)
	for _, key := range []string{
		"execution_id",
		"execution_generation",
		"index_generation",
		"index_meta_id",
		"correlation_id",
	} {
		delete(active, key)
	}
	active["task_id"] = nil
	active["conversation_id"] = nil
	active["indexed"] = json.Number("0")
	active["updated"] = json.Number("0")
	active["created_on"] = json.Number("1700000000.25")
	active["updated_on"] = json.Number("1700000000.25")
	active["error"] = nil
	marker := cloneCurrentIndexMetaObject(active)
	marker["state"] = "created"
	terminal := cloneCurrentIndexMetaObject(active)
	terminal["state"] = "completed"
	terminal["indexed"] = json.Number("61")
	terminal["updated"] = json.Number("228")
	terminal["updated_on"] = json.Number("1700000010.5")
	history := []any{marker, terminal}
	document := record.Document
	stored := currentStoredIndexMeta{
		id:       "baseline-physical-row",
		document: &document,
		metadata: cloneCurrentIndexMetaObject(terminal),
	}
	setCurrentHybridAdoptionHistory(t, &stored, history)
	return stored, currentIndexMetaHistory(stored.metadata["history"])
}

func currentHybridAdoptionStoredForTest(
	t *testing.T,
	record indexingapp.CurrentInitialIndexMeta,
) (currentStoredIndexMeta, []any) {
	t.Helper()
	typedActive := mustDecodeCurrentIndexMeta(t, record.InitialMetadata)
	typedActive["execution_id"] = "execution-15"
	typedActive["execution_generation"] = json.Number("1")
	typedActive["index_generation"] = json.Number("15")
	typedActive["index_meta_id"] = "meta-15"
	typedActive["correlation_id"] = "message-15"
	typedActive["task_id"] = "execution-15"
	typedTerminal := cloneCurrentIndexMetaObject(typedActive)
	typedTerminal["state"] = "completed"
	typedTerminal["task_id"] = nil
	typedTerminal["indexed"] = json.Number("61")
	typedTerminal["updated"] = json.Number("228")

	legacyTerminal := cloneCurrentIndexMetaObject(typedTerminal)
	delete(legacyTerminal, "index_generation")
	legacyTerminal["execution_id"] = "execution-1"
	legacyTerminal["index_meta_id"] = "physical-row"
	legacyTerminal["correlation_id"] = "message-1"

	baselineActive := cloneCurrentIndexMetaObject(typedActive)
	for _, key := range []string{
		"execution_id",
		"execution_generation",
		"index_generation",
		"index_meta_id",
		"correlation_id",
	} {
		delete(baselineActive, key)
	}
	baselineActive["task_id"] = nil
	baselineActive["created_on"] = json.Number("1800000000.25")
	baselineActive["updated_on"] = json.Number("1800000000.25")
	baselineTerminal := cloneCurrentIndexMetaObject(baselineActive)
	baselineTerminal["state"] = "cancelled"
	baselineTerminal["updated_on"] = json.Number("1800000010.5")

	history := []any{
		legacyTerminal,
		typedActive,
		typedTerminal,
		baselineActive,
		baselineTerminal,
	}
	document := record.Document
	stored := currentStoredIndexMeta{
		id:       "physical-row",
		document: &document,
		metadata: cloneCurrentIndexMetaObject(baselineTerminal),
	}
	setCurrentHybridAdoptionHistory(t, &stored, history)
	return stored, currentIndexMetaHistory(stored.metadata["history"])
}

func insertCurrentHybridTypedGenerationForTest(
	t *testing.T,
	stored *currentStoredIndexMeta,
	reusedIdentity string,
) {
	t.Helper()
	history := currentIndexMetaHistory(stored.metadata["history"])
	active := cloneCurrentIndexMetaObject(history[1].(map[string]any))
	terminal := cloneCurrentIndexMetaObject(history[2].(map[string]any))
	for _, entry := range []map[string]any{active, terminal} {
		entry["index_generation"] = json.Number("14")
		entry["execution_id"] = "execution-14"
		entry["index_meta_id"] = "meta-14"
		entry["correlation_id"] = "message-14"
		entry[reusedIdentity] =
			history[1].(map[string]any)[reusedIdentity]
	}
	history = append(
		history[:1],
		append([]any{active, terminal}, history[1:]...)...,
	)
	setCurrentHybridAdoptionHistory(t, stored, history)
}

func setCurrentHybridAdoptionHistory(
	t *testing.T,
	stored *currentStoredIndexMeta,
	history []any,
) {
	t.Helper()
	historyBytes, err := json.Marshal(history)
	if err != nil {
		t.Fatal(err)
	}
	stored.metadata["history"] = string(historyBytes)
	if len(history) == 0 {
		return
	}
	last, ok := history[len(history)-1].(map[string]any)
	if !ok {
		return
	}
	top := cloneCurrentIndexMetaObject(last)
	top["history"] = string(historyBytes)
	stored.metadata = top
}

func mustDecodeCurrentIndexMeta(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	metadata, err := decodeCurrentIndexMetaJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	return metadata
}

func assertCurrentIndexMetaCreatedMarker(
	t *testing.T,
	raw any,
	indexName string,
) {
	t.Helper()
	marker, ok := raw.(map[string]any)
	if !ok ||
		marker["collection"] != indexName ||
		marker["type"] != "index_meta" ||
		marker["state"] != "created" ||
		marker["task_id"] != nil ||
		marker["conversation_id"] != nil {
		t.Fatalf("created marker=%#v", raw)
	}
	for _, key := range []string{
		"execution_id",
		"execution_generation",
		"index_generation",
		"index_meta_id",
		"correlation_id",
	} {
		if _, present := marker[key]; present {
			t.Fatalf("created marker contains run field %q: %#v", key, marker)
		}
	}
}

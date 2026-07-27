package pgvector

import (
	"encoding/json"
	"errors"
	"reflect"
	"strconv"
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

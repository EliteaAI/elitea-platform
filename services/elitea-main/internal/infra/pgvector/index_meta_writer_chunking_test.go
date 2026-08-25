package pgvector

import (
	"encoding/json"
	"strconv"
	"testing"
	"time"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	indexscheduleapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexschedule"
)

// currentChunkingConfigForWriterTest reproduces the magnitude of the SDK's
// index_data chunking_config default: 65 top-level keys, one per file
// extension, verified directly against
// runtimecomposition/current_toolkit_schema_snapshot.json
// (artifact -> args_schemas.index_data.properties.chunking_config.default)
// at 3,091 bytes compact / 3,425 bytes with the JSON library's default
// separators. Most extensions default to the single-field shape used here;
// a handful carry extra per-format options, which only makes the real
// default larger than this fixture.
func currentChunkingConfigForWriterTest() map[string]any {
	configuration := make(map[string]any, 65)
	for extension := 0; extension < 65; extension++ {
		configuration[".extension"+strconv.Itoa(extension)] = map[string]any{
			"max_tokens": 512,
		}
	}
	return configuration
}

func currentIndexConfigurationForWriterTest() map[string]any {
	return map[string]any{
		"index_name":         "Docs",
		"folder":             "",
		"clean_index":        false,
		"progress_step":      10,
		"include_extensions": []any{},
		"chunking_config":    currentChunkingConfigForWriterTest(),
	}
}

// currentChunkingRecordForTest is currentIndexMetaRecordForTest with a
// full-size index_configuration, reproducing what MaterializeInitialIndexMeta
// actually stores: the create-index form's submitted chunking_config,
// verbatim, in the top-level index_configuration.
func currentChunkingRecordForTest(
	t *testing.T,
	metaID, executionID, correlationID string,
	indexGeneration uint64,
) indexingapp.CurrentInitialIndexMeta {
	t.Helper()
	metadata, err := json.Marshal(map[string]any{
		"collection":           "Docs",
		"type":                 "index_meta",
		"indexed":              0,
		"updated":              0,
		"state":                "in_progress",
		"index_configuration":  currentIndexConfigurationForWriterTest(),
		"created_on":           1_700_000_000.25,
		"updated_on":           1_700_000_000.25,
		"task_id":              executionID,
		"conversation_id":      nil,
		"toolkit_id":           19,
		"execution_id":         executionID,
		"execution_generation": 1,
		"index_generation":     indexGeneration,
		"index_meta_id":        metaID,
		"correlation_id":       correlationID,
	})
	if err != nil {
		t.Fatal(err)
	}
	return indexingapp.CurrentInitialIndexMeta{
		MetaID:          metaID,
		ExecutionID:     executionID,
		CorrelationID:   correlationID,
		Generation:      1,
		IndexGeneration: indexGeneration,
		IndexName:       "Docs",
		ToolkitID:       19,
		Document:        "index_meta_Docs",
		InitialMetadata: metadata,
	}
}

func currentIndexConfigurationOf(t *testing.T, entry any) map[string]any {
	t.Helper()
	object, ok := entry.(map[string]any)
	if !ok {
		t.Fatalf("entry is not an object: %#v", entry)
	}
	configuration, ok := object["index_configuration"].(map[string]any)
	if !ok {
		t.Fatalf("index_configuration is not an object: %#v", object["index_configuration"])
	}
	return configuration
}

// TestCurrentCreatedIndexMetaMarkerOmitsChunkingConfig is the one-time saving
// every index gets: the permanent "created" marker Main writes at index
// creation no longer repeats the top-level chunking_config it was cloned
// from. The source map passed in must be left untouched, since it also
// becomes the top-level metadata for the same write.
func TestCurrentCreatedIndexMetaMarkerOmitsChunkingConfig(t *testing.T) {
	record := currentChunkingRecordForTest(t, "meta-1", "execution-1", "message-1", 1)
	initial := mustDecodeCurrentIndexMeta(t, record.InitialMetadata)

	marker := currentCreatedIndexMetaMarker(initial)

	if _, present := currentIndexConfigurationOf(t, marker)["chunking_config"]; present {
		t.Fatal("created marker still carries chunking_config")
	}
	// index_name and the other configuration fields survive the trim.
	if currentIndexConfigurationOf(t, marker)["index_name"] != "Docs" {
		t.Fatalf("marker configuration lost fields: %#v", marker["index_configuration"])
	}
	// The source map is untouched: it becomes the top-level metadata for this
	// same write and must keep its own chunking_config.
	if _, present := currentIndexConfigurationOf(t, initial)["chunking_config"]; !present {
		t.Fatal("trimming the marker mutated the shared source map")
	}

	// Mirror currentCreatedIndexMetaMarker's own field deletions exactly, so
	// the only difference from the real marker is the chunking_config trim
	// this test measures.
	untrimmedMarker := cloneCurrentIndexMetaObject(initial)
	untrimmedMarker["state"] = "created"
	untrimmedMarker["task_id"] = nil
	untrimmedMarker["conversation_id"] = nil
	for _, key := range []string{
		"execution_id", "execution_generation", "index_generation",
		"index_meta_id", "correlation_id",
	} {
		delete(untrimmedMarker, key)
	}
	markerBytes, err := json.Marshal(marker)
	if err != nil {
		t.Fatal(err)
	}
	untrimmedBytes, err := json.Marshal(untrimmedMarker)
	if err != nil {
		t.Fatal(err)
	}
	saved := len(untrimmedBytes) - len(markerBytes)
	t.Logf("created marker: trimmed=%d untrimmed=%d saved=%d", len(markerBytes), len(untrimmedBytes), saved)
	// This fixture's single-field-per-extension shape (2,220 measured bytes
	// for the default) is a deliberately conservative stand-in: the real
	// snapshot default is 3,091 bytes compact / 3,425 with the encoder's
	// default separators, since roughly a third of its extensions carry
	// several additional fields (prompt, use_llm, mode, ...). Production
	// savings are therefore larger than this floor, never smaller.
	if saved < 2_000 {
		t.Fatalf("trim did not remove the chunking_config default: saved=%d", saved)
	}
}

// TestPlanCurrentInitialIndexMetaHistoryMarkerOmitsChunkingConfig proves the
// end-to-end insert path: the physical row's top-level index_configuration
// still carries the exact submitted chunking_config (reindex, the edit
// form's Configuration tab and the scheduler all read it from there), but
// the one history entry this call creates does not.
func TestPlanCurrentInitialIndexMetaHistoryMarkerOmitsChunkingConfig(t *testing.T) {
	record := currentChunkingRecordForTest(t, "meta-1", "execution-1", "message-1", 1)
	plan, err := planCurrentInitialIndexMeta(record, nil)
	if err != nil {
		t.Fatal(err)
	}
	metadata := mustDecodeCurrentIndexMeta(t, plan.metadata)

	topConfiguration, ok := metadata["index_configuration"].(map[string]any)
	if !ok {
		t.Fatalf("top-level index_configuration=%#v", metadata["index_configuration"])
	}
	if chunking, ok := topConfiguration["chunking_config"].(map[string]any); !ok || len(chunking) != 65 {
		t.Fatalf("top-level chunking_config=%#v", topConfiguration["chunking_config"])
	}

	history := currentIndexMetaHistory(metadata["history"])
	if len(history) != 1 {
		t.Fatalf("history=%#v", history)
	}
	if _, present := currentIndexConfigurationOf(t, history[0])["chunking_config"]; present {
		t.Fatal("inserted history marker still carries chunking_config")
	}
}

// TestPlanCurrentTerminalIndexMetaHistoryEntryOmitsChunkingConfigWhenMainOwnsTerminalization
// covers Main terminalizing a run the SDK never started (a stuck/orphaned
// execution). The appended history entry must not repeat the top-level
// chunking_config that survives in the new top-level metadata.
func TestPlanCurrentTerminalIndexMetaHistoryEntryOmitsChunkingConfigWhenMainOwnsTerminalization(t *testing.T) {
	record := currentChunkingRecordForTest(t, "meta-1", "execution-1", "message-1", 1)
	created, err := planCurrentInitialIndexMeta(record, nil)
	if err != nil {
		t.Fatal(err)
	}
	document := created.document
	existing := currentStoredIndexMeta{
		id:       created.id,
		document: &document,
		metadata: mustDecodeCurrentIndexMeta(t, created.metadata),
	}

	terminal := indexingapp.CurrentTerminalIndexMeta{
		MetaID:          record.MetaID,
		ExecutionID:     record.ExecutionID,
		Generation:      record.Generation,
		IndexGeneration: record.IndexGeneration,
		IndexName:       record.IndexName,
		ToolkitID:       record.ToolkitID,
		State:           indexingapp.CurrentIndexMetaFailed,
		OccurredAt:      time.Date(2026, time.August, 14, 12, 0, 0, 0, time.UTC),
		SafeError:       "A dependency is unavailable.",
	}
	plan, err := planCurrentTerminalIndexMeta(terminal, []currentStoredIndexMeta{existing})
	if err != nil {
		t.Fatal(err)
	}
	metadata := mustDecodeCurrentIndexMeta(t, plan.metadata)

	if chunking, ok := metadata["index_configuration"].(map[string]any)["chunking_config"].(map[string]any); !ok || len(chunking) != 65 {
		t.Fatalf("top-level chunking_config=%#v", metadata["index_configuration"])
	}
	history := currentIndexMetaHistory(metadata["history"])
	if len(history) != 2 {
		t.Fatalf("history=%#v", history)
	}
	if _, present := currentIndexConfigurationOf(t, history[1])["chunking_config"]; present {
		t.Fatal("appended failed-terminal history entry still carries chunking_config")
	}
}

// TestPlanCurrentTerminalIndexMetaHistoryEntryOmitsChunkingConfigWhenReplacingSDKEntry
// covers Main terminalizing a run the SDK did start: history[runIndex] is
// replaced in place. The replacement must be trimmed even though the entry
// it replaces (an SDK-authored active entry, out of this repo's control)
// still carried the full default.
func TestPlanCurrentTerminalIndexMetaHistoryEntryOmitsChunkingConfigWhenReplacingSDKEntry(t *testing.T) {
	record := currentChunkingRecordForTest(t, "meta-1", "execution-1", "message-1", 1)
	created, err := planCurrentInitialIndexMeta(record, nil)
	if err != nil {
		t.Fatal(err)
	}
	document := created.document
	stored := mustDecodeCurrentIndexMeta(t, created.metadata)

	// Simulate the SDK's own active history entry for this run: a full clone
	// of the top level, untouched by this repo, still carrying the default.
	sdkActive := cloneCurrentIndexMetaObject(stored)
	delete(sdkActive, "history")
	sdkActive["state"] = "in_progress"
	history := currentIndexMetaHistory(stored["history"])
	history = append(history, sdkActive)
	encodedHistory, err := json.Marshal(history)
	if err != nil {
		t.Fatal(err)
	}
	stored["history"] = string(encodedHistory)

	existing := currentStoredIndexMeta{id: created.id, document: &document, metadata: stored}
	terminal := indexingapp.CurrentTerminalIndexMeta{
		MetaID:          record.MetaID,
		ExecutionID:     record.ExecutionID,
		Generation:      record.Generation,
		IndexGeneration: record.IndexGeneration,
		IndexName:       record.IndexName,
		ToolkitID:       record.ToolkitID,
		State:           indexingapp.CurrentIndexMetaCancelled,
		OccurredAt:      time.Date(2026, time.August, 14, 12, 0, 0, 0, time.UTC),
	}
	plan, err := planCurrentTerminalIndexMeta(terminal, []currentStoredIndexMeta{existing})
	if err != nil {
		t.Fatal(err)
	}
	metadata := mustDecodeCurrentIndexMeta(t, plan.metadata)
	replayedHistory := currentIndexMetaHistory(metadata["history"])
	if len(replayedHistory) != 2 {
		t.Fatalf("history=%#v", replayedHistory)
	}
	if _, present := currentIndexConfigurationOf(t, replayedHistory[1])["chunking_config"]; present {
		t.Fatal("replaced history entry still carries chunking_config")
	}
}

// TestPlanCurrentScheduledFailureHistoryEntryOmitsChunkingConfig covers the
// pre-dispatch scheduler failure path.
func TestPlanCurrentScheduledFailureHistoryEntryOmitsChunkingConfig(t *testing.T) {
	stored := map[string]any{
		"type":                "index_meta",
		"collection":          "docs",
		"state":               "completed",
		"index_configuration": currentIndexConfigurationForWriterTest(),
		"history":             `[{"state":"completed","indexed":4}]`,
	}
	effect := indexscheduleapp.FailureEffect{
		EffectID:    "index-schedule-v1:effect",
		ProjectID:   7,
		UserID:      11,
		ToolkitID:   19,
		IndexMetaID: "docs",
		SafeReason:  "missing valid user token",
		OccurredAt:  time.Date(2026, 7, 30, 12, 13, 14, 500_000_000, time.UTC),
	}
	plan, err := planCurrentScheduledFailure(
		effect,
		[]currentStoredIndexMeta{{id: "row-1", metadata: stored}},
	)
	if err != nil {
		t.Fatal(err)
	}
	metadata := mustDecodeCurrentIndexMeta(t, plan.metadata)
	if chunking, ok := metadata["index_configuration"].(map[string]any)["chunking_config"].(map[string]any); !ok || len(chunking) != 65 {
		t.Fatalf("top-level chunking_config=%#v", metadata["index_configuration"])
	}
	history := currentIndexMetaHistory(metadata["history"])
	if len(history) != 2 {
		t.Fatalf("history=%#v", history)
	}
	if _, present := currentIndexConfigurationOf(t, history[1])["chunking_config"]; present {
		t.Fatal("appended scheduled-failure history entry still carries chunking_config")
	}
}

// TestCurrentIndexMetaHistoryGrowthIsBoundedAcrossMainAuthoredGenerations is
// the storage-side measurement issue #297 asks for. It replays 20
// reindex-then-fail generations - the case where the SDK never starts, so
// every history entry is authored by this writer - and asserts the stored
// row grows by a small per-generation constant instead of repeating the
// ~3.4 KB chunking_config default each time. It also reports, for issue
// #299's 1 MiB encode cap, how many more such generations now fit before the
// row becomes unwritable.
func TestCurrentIndexMetaHistoryGrowthIsBoundedAcrossMainAuthoredGenerations(t *testing.T) {
	const generations = 20

	record := currentChunkingRecordForTest(t, "meta-1", "execution-1", "message-1", 1)
	created, err := planCurrentInitialIndexMeta(record, nil)
	if err != nil {
		t.Fatal(err)
	}
	document := created.document
	rowID := created.id
	stored := mustDecodeCurrentIndexMeta(t, created.metadata)

	sizes := make([]int, 0, generations)
	for generation := uint64(1); generation <= generations; generation++ {
		existing := currentStoredIndexMeta{id: rowID, document: &document, metadata: stored}
		terminal := indexingapp.CurrentTerminalIndexMeta{
			MetaID:          stored["index_meta_id"].(string),
			ExecutionID:     stored["execution_id"].(string),
			Generation:      1,
			IndexGeneration: generation,
			IndexName:       "Docs",
			ToolkitID:       19,
			State:           indexingapp.CurrentIndexMetaFailed,
			OccurredAt:      time.Date(2026, time.August, 14, 12, 0, 0, 0, time.UTC),
			SafeError:       "A dependency is unavailable.",
		}
		termPlan, err := planCurrentTerminalIndexMeta(terminal, []currentStoredIndexMeta{existing})
		if err != nil {
			t.Fatalf("generation %d terminal: %v", generation, err)
		}
		stored = mustDecodeCurrentIndexMeta(t, termPlan.metadata)
		sizes = append(sizes, len(termPlan.metadata))

		if generation == generations {
			break
		}
		next := currentChunkingRecordForTest(
			t,
			"meta-"+strconv.FormatUint(generation+1, 10),
			"execution-"+strconv.FormatUint(generation+1, 10),
			"message-"+strconv.FormatUint(generation+1, 10),
			generation+1,
		)
		initPlan, err := planCurrentInitialIndexMeta(next, []currentStoredIndexMeta{{
			id: rowID, document: &document, metadata: stored,
		}})
		if err != nil {
			t.Fatalf("generation %d initial: %v", generation+1, err)
		}
		stored = mustDecodeCurrentIndexMeta(t, initPlan.metadata)
	}

	history := currentIndexMetaHistory(stored["history"])
	if len(history) != generations+1 { // +1 for the permanent created marker
		t.Fatalf("history length=%d", len(history))
	}
	for position, entry := range history {
		if _, present := currentIndexConfigurationOf(t, entry)["chunking_config"]; present {
			t.Fatalf("history[%d] still carries chunking_config", position)
		}
	}

	firstRunBytes := sizes[0]
	lastRunBytes := sizes[len(sizes)-1]
	perGenerationGrowth := (lastRunBytes - firstRunBytes) / (generations - 1)
	t.Logf(
		"stored row bytes: run 1=%d run %d=%d avg growth/generation=%d",
		firstRunBytes, generations, lastRunBytes, perGenerationGrowth,
	)
	// Before this change, every entry repeated the ~3.4 KB default; growth
	// per generation must now be a small fraction of that.
	if perGenerationGrowth > 700 {
		t.Fatalf("per-generation growth is not bounded: %d bytes/generation", perGenerationGrowth)
	}

	capacityNow := indexingapp.MaxCurrentInitialIndexMetaBytes / perGenerationGrowth
	// Reconstructed "before" per-generation cost: this generation's saving
	// (measured in TestCurrentCreatedIndexMetaMarkerOmitsChunkingConfig, at
	// least 2,000 bytes on this conservative fixture; the real default is
	// larger) added back on top of what a trimmed generation costs now.
	const perGenerationChunkingConfigCopy = 2_000
	capacityBefore := indexingapp.MaxCurrentInitialIndexMetaBytes /
		(perGenerationGrowth + perGenerationChunkingConfigCopy)
	t.Logf(
		"generations of Main-authored history before the 1 MiB cap: before~=%d after>=%d",
		capacityBefore, capacityNow,
	)
	if capacityNow <= capacityBefore*3 {
		t.Fatalf(
			"headroom gain is not substantial: before~=%d after=%d",
			capacityBefore, capacityNow,
		)
	}
}

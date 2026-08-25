package pgvector

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
)

// currentHistoryBoundChunkingConfigBytes is the measured size of the SDK's
// default chunking_config in the pinned toolkit schema snapshot: 65 keys and
// 3,091 bytes of compact JSON. Each history entry clones the top level, so each
// entry carries this constant. This is what puts the cliff at roughly 250
// entries.
const currentHistoryBoundChunkingConfigBytes = 3_091

// currentHistoryBoundFatConfiguration builds an index_configuration of the same
// magnitude as the SDK default. The test keeps its own fixture instead of
// reading the snapshot, so a later SDK re-pin cannot silently change what this
// test measures.
func currentHistoryBoundFatConfiguration(t *testing.T) map[string]any {
	t.Helper()
	configuration := map[string]any{"index_name": "Docs"}
	chunking := make(map[string]any, 65)
	for extension := range 65 {
		chunking["extension_"+strconv.Itoa(extension)] = map[string]any{
			"chunker": "md",
		}
	}
	encoded, err := json.Marshal(chunking)
	if err != nil {
		t.Fatal(err)
	}
	// Pad the last extension so the fixture matches the measured default.
	padding := currentHistoryBoundChunkingConfigBytes - len(encoded)
	if padding < 0 {
		t.Fatalf("chunking fixture is already %d bytes", len(encoded))
	}
	chunking["extension_64"] = map[string]any{
		"chunker": "md" + strings.Repeat("x", padding),
	}
	encoded, err = json.Marshal(chunking)
	if err != nil {
		t.Fatal(err)
	}
	if len(encoded) != currentHistoryBoundChunkingConfigBytes {
		t.Fatalf("chunking fixture is %d bytes", len(encoded))
	}
	configuration["chunking_config"] = chunking
	return configuration
}

// currentHistoryBoundRecord returns one initial record whose
// index_configuration carries a default-sized chunking_config.
func currentHistoryBoundRecord(
	t *testing.T,
	generation uint64,
) indexingapp.CurrentInitialIndexMeta {
	t.Helper()
	suffix := strconv.FormatUint(generation, 10)
	record := currentIndexMetaRecordForTest(
		"meta-"+suffix,
		"execution-"+suffix,
		"message-"+suffix,
	)
	metadata := mustDecodeCurrentIndexMeta(t, record.InitialMetadata)
	metadata["index_configuration"] = currentHistoryBoundFatConfiguration(t)
	metadata["index_generation"] = generation
	encoded, err := json.Marshal(metadata)
	if err != nil {
		t.Fatal(err)
	}
	record.IndexGeneration = generation
	record.InitialMetadata = encoded
	return record
}

// currentHistoryBoundEntry builds one stored history entry for a run.
func currentHistoryBoundEntry(
	t *testing.T,
	base map[string]any,
	generation int,
	state string,
) map[string]any {
	t.Helper()
	entry := cloneCurrentIndexMetaObject(base)
	suffix := strconv.Itoa(generation)
	entry["execution_id"] = "stored-execution-" + suffix
	entry["execution_generation"] = json.Number("1")
	entry["index_generation"] = json.Number(suffix)
	entry["index_meta_id"] = "stored-meta-" + suffix
	entry["correlation_id"] = "stored-message-" + suffix
	entry["state"] = state
	entry["task_id"] = entry["execution_id"]
	if state != "in_progress" {
		entry["task_id"] = nil
		entry["indexed"] = json.Number("61")
		entry["updated"] = json.Number("228")
	}
	return entry
}

// currentHistoryBoundStored builds one stored row whose history holds
// generations 1 to count, one terminal entry each. The top level repeats the
// newest entry, which is the shape the writer stores.
func currentHistoryBoundStored(
	t *testing.T,
	base map[string]any,
	count int,
) (currentStoredIndexMeta, []any) {
	t.Helper()
	history := make([]any, 0, count)
	for generation := 1; generation <= count; generation++ {
		history = append(
			history,
			currentHistoryBoundEntry(t, base, generation, "completed"),
		)
	}
	historyBytes, err := json.Marshal(history)
	if err != nil {
		t.Fatal(err)
	}
	top := cloneCurrentIndexMetaObject(history[len(history)-1].(map[string]any))
	top["history"] = string(historyBytes)
	document := "index_meta_Docs"
	return currentStoredIndexMeta{
		id:       "physical-row",
		document: &document,
		metadata: top,
	}, history
}

func currentHistoryBoundPlanHistory(
	t *testing.T,
	plan currentIndexMetaWritePlan,
) []any {
	t.Helper()
	metadata := mustDecodeCurrentIndexMeta(t, plan.metadata)
	history, ok := decodeCurrentIndexMetaHistory(metadata["history"])
	if !ok {
		t.Fatal("the plan stores no decodable history")
	}
	return history
}

// TestPlanCurrentInitialIndexMetaRecordsARunPastTheHistoryCliff is the
// discriminating test for issue #299. It builds a stored row whose history is
// already too large to encode, then starts the next generation. Before the
// bound, planCurrentInitialIndexMeta returned ErrCurrentIndexMetaConflict here
// and the index could no longer record any run.
func TestPlanCurrentInitialIndexMetaRecordsARunPastTheHistoryCliff(t *testing.T) {
	const storedGenerations = 400
	record := currentHistoryBoundRecord(t, storedGenerations+1)
	base := mustDecodeCurrentIndexMeta(t, record.InitialMetadata)
	stored, history := currentHistoryBoundStored(t, base, storedGenerations)

	// Prove the input is past the cliff: the stored history alone no longer
	// encodes under the write cap.
	full, err := json.Marshal(history)
	if err != nil {
		t.Fatal(err)
	}
	if len(full) <= indexingapp.MaxCurrentInitialIndexMetaBytes {
		t.Fatalf(
			"fixture is not past the cliff: history=%d bytes cap=%d bytes",
			len(full), indexingapp.MaxCurrentInitialIndexMetaBytes,
		)
	}

	plan, err := planCurrentInitialIndexMeta(
		record,
		[]currentStoredIndexMeta{stored},
	)
	if err != nil {
		t.Fatalf("the writer still refuses the run: %v", err)
	}
	if plan.noop || plan.insert || plan.id != stored.id {
		t.Fatalf("plan=%#v", currentIndexMetaWritePlan{
			id:     plan.id,
			insert: plan.insert,
			noop:   plan.noop,
		})
	}
	if len(plan.metadata) > indexingapp.MaxCurrentInitialIndexMetaBytes {
		t.Fatalf(
			"the plan stores %d bytes, over the %d byte cap",
			len(plan.metadata), indexingapp.MaxCurrentInitialIndexMetaBytes,
		)
	}

	planned := currentHistoryBoundPlanHistory(t, plan)
	if len(planned) == 0 ||
		len(planned) > indexingapp.MaxCurrentIndexMetaHistoryEntries {
		t.Fatalf(
			"the plan keeps %d entries, over the %d entry ceiling",
			len(planned), indexingapp.MaxCurrentIndexMetaHistoryEntries,
		)
	}
	// The bound discards the oldest runs and keeps the newest ones.
	newest, ok := planned[len(planned)-1].(map[string]any)
	if !ok || newest["index_meta_id"] !=
		"stored-meta-"+strconv.Itoa(storedGenerations) {
		t.Fatalf("the newest stored run did not survive: %#v", newest)
	}
	oldest, ok := planned[0].(map[string]any)
	if !ok || oldest["index_meta_id"] == "stored-meta-1" {
		t.Fatalf("the oldest stored run was not discarded: %#v", oldest)
	}
}

// TestPlanCurrentTerminalIndexMetaRecordsATerminalRunPastTheHistoryCliff
// covers the second write that every run makes.
func TestPlanCurrentTerminalIndexMetaRecordsATerminalRunPastTheHistoryCliff(
	t *testing.T,
) {
	const storedGenerations = 400
	record := currentHistoryBoundRecord(t, storedGenerations)
	base := mustDecodeCurrentIndexMeta(t, record.InitialMetadata)
	stored, _ := currentHistoryBoundStored(t, base, storedGenerations)
	// The newest entry is the active run that this terminal write closes.
	history := currentIndexMetaHistory(stored.metadata["history"])
	active := currentHistoryBoundEntry(
		t, base, storedGenerations, "in_progress",
	)
	history[len(history)-1] = active
	setCurrentHybridAdoptionHistory(t, &stored, history)

	plan, err := planCurrentTerminalIndexMeta(
		indexingapp.CurrentTerminalIndexMeta{
			MetaID: "stored-meta-" + strconv.Itoa(storedGenerations),
			ExecutionID: "stored-execution-" +
				strconv.Itoa(storedGenerations),
			Generation:      1,
			IndexGeneration: storedGenerations,
			IndexName:       "Docs",
			ToolkitID:       19,
			State:           indexingapp.CurrentIndexMetaCancelled,
			OccurredAt: time.Date(
				2026, time.July, 26, 14, 0, 0, 0, time.UTC,
			),
		},
		[]currentStoredIndexMeta{stored},
	)
	if err != nil {
		t.Fatalf("the writer still refuses the terminal write: %v", err)
	}
	if len(plan.metadata) > indexingapp.MaxCurrentInitialIndexMetaBytes {
		t.Fatalf(
			"the plan stores %d bytes, over the %d byte cap",
			len(plan.metadata), indexingapp.MaxCurrentInitialIndexMetaBytes,
		)
	}
	planned := currentHistoryBoundPlanHistory(t, plan)
	last, ok := planned[len(planned)-1].(map[string]any)
	if !ok || last["state"] != string(indexingapp.CurrentIndexMetaCancelled) {
		t.Fatalf("the terminal state was not recorded: %#v", last)
	}
}

// TestBoundCurrentIndexMetaHistoryAppliesTheEntryCeiling proves the entry
// ceiling binds when the entries are small.
func TestBoundCurrentIndexMetaHistoryAppliesTheEntryCeiling(t *testing.T) {
	history := make([]any, 0, 5_000)
	for entry := range 5_000 {
		history = append(history, map[string]any{
			"state": "completed",
			"order": json.Number(strconv.Itoa(entry)),
		})
	}
	bounded, err := boundCurrentIndexMetaHistory(history)
	if err != nil {
		t.Fatal(err)
	}
	if len(bounded) != indexingapp.MaxCurrentIndexMetaHistoryEntries {
		t.Fatalf("bounded=%d entries", len(bounded))
	}
	first := bounded[0].(map[string]any)
	last := bounded[len(bounded)-1].(map[string]any)
	if first["order"] != json.Number("4800") ||
		last["order"] != json.Number("4999") {
		t.Fatalf("first=%v last=%v", first["order"], last["order"])
	}
}

// TestBoundCurrentIndexMetaHistoryAppliesTheByteBudget proves the byte budget
// binds before the entry ceiling when the entries are large. An entry ceiling
// alone cannot hold the row under the cap, because entry size is
// data-dependent.
func TestBoundCurrentIndexMetaHistoryAppliesTheByteBudget(t *testing.T) {
	record := currentHistoryBoundRecord(t, 1)
	base := mustDecodeCurrentIndexMeta(t, record.InitialMetadata)
	history := make([]any, 0, indexingapp.MaxCurrentIndexMetaHistoryEntries)
	for generation := 1; generation <= indexingapp.MaxCurrentIndexMetaHistoryEntries; generation++ {
		history = append(
			history,
			currentHistoryBoundEntry(t, base, generation, "completed"),
		)
	}
	bounded, err := boundCurrentIndexMetaHistory(history)
	if err != nil {
		t.Fatal(err)
	}
	if len(bounded) >= len(history) {
		t.Fatalf(
			"the byte budget kept every one of %d entries",
			len(bounded),
		)
	}
	encoded, err := json.Marshal(bounded)
	if err != nil {
		t.Fatal(err)
	}
	if len(encoded) > maxCurrentIndexMetaHistoryBytes {
		t.Fatalf(
			"bounded history is %d bytes, over the %d byte budget",
			len(encoded), maxCurrentIndexMetaHistoryBytes,
		)
	}
}

// TestBoundCurrentIndexMetaHistoryKeepsTheNewestEntry proves the bound never
// discards the run the caller writes now, however large that entry is.
func TestBoundCurrentIndexMetaHistoryKeepsTheNewestEntry(t *testing.T) {
	huge := map[string]any{
		"state": "completed",
		"skipped": strings.Repeat(
			"x", maxCurrentIndexMetaHistoryBytes+1,
		),
	}
	bounded, err := boundCurrentIndexMetaHistory([]any{
		map[string]any{"state": "completed", "order": json.Number("0")},
		huge,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(bounded) != 1 {
		t.Fatalf("bounded=%d entries", len(bounded))
	}
	if bounded[0].(map[string]any)["state"] != "completed" ||
		bounded[0].(map[string]any)["skipped"] == nil {
		t.Fatalf("the newest entry was discarded: %#v", bounded[0])
	}
}

// TestEncodeCurrentIndexMetaWithHistoryFailsClosedOnOneOversizedEntry proves
// the writer still refuses a row it cannot store, rather than storing a
// truncated one.
func TestEncodeCurrentIndexMetaWithHistoryFailsClosedOnOneOversizedEntry(
	t *testing.T,
) {
	initial := map[string]any{"collection": "Docs", "type": "index_meta"}
	huge := map[string]any{
		"state": "completed",
		"skipped": strings.Repeat(
			"x", indexingapp.MaxCurrentInitialIndexMetaBytes,
		),
	}
	if _, err := encodeCurrentIndexMetaWithHistory(
		initial,
		[]any{huge},
	); err == nil {
		t.Fatal("the writer stored a row over the cap")
	}
}

// TestBoundCurrentIndexMetaHistoryDiscardsTheCreatedMarkerWithTheOldestRuns
// protects the legacy adoption fence. That fence compares the created marker
// with the first lifecycle entry, so a marker that outlived its own first run
// would fail it. The bound therefore discards one contiguous oldest prefix,
// marker included.
func TestBoundCurrentIndexMetaHistoryDiscardsTheCreatedMarkerWithTheOldestRuns(
	t *testing.T,
) {
	record := currentHistoryBoundRecord(t, 1)
	initial := mustDecodeCurrentIndexMeta(t, record.InitialMetadata)
	history := []any{currentCreatedIndexMetaMarker(initial)}
	for generation := 1; generation <= 5_000; generation++ {
		history = append(
			history,
			currentHistoryBoundEntry(t, initial, generation, "completed"),
		)
	}
	bounded, err := boundCurrentIndexMetaHistory(history)
	if err != nil {
		t.Fatal(err)
	}
	if len(bounded) >= len(history) {
		t.Fatal("the bound discarded nothing")
	}
	first, ok := bounded[0].(map[string]any)
	if !ok || first["state"] == "created" {
		t.Fatalf("the created marker outlived its own first run: %#v", first)
	}
}

// TestBoundedHistoryKeepsTheLegacyAdoptionFenceSatisfiable runs the real
// adoption walk over a history that the bound has trimmed. The issue names
// this fence as the constraint that trimming must not break.
func TestBoundedHistoryKeepsTheLegacyAdoptionFenceSatisfiable(t *testing.T) {
	const storedGenerations = 300
	record := currentHistoryBoundRecord(t, storedGenerations+1)
	base := mustDecodeCurrentIndexMeta(t, record.InitialMetadata)

	history := []any{currentCreatedIndexMetaMarker(base)}
	for generation := 1; generation <= storedGenerations; generation++ {
		history = append(
			history,
			currentHistoryBoundEntry(t, base, generation, "in_progress"),
			currentHistoryBoundEntry(t, base, generation, "completed"),
		)
	}
	// The unchanged SDK replaces the top level, which drops every fence field.
	// That is the exact shape the adoption walk recovers.
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
	baselineActive["state"] = "in_progress"
	baselineActive["indexed"] = json.Number("0")
	baselineActive["updated"] = json.Number("0")
	baselineActive["created_on"] = json.Number("1785157250.6336453")
	baselineActive["updated_on"] = json.Number("1785157250.6336453")
	baselineTerminal := cloneCurrentIndexMetaObject(baselineActive)
	baselineTerminal["state"] = "cancelled"
	baselineTerminal["task_id"] = nil
	baselineTerminal["indexed"] = json.Number("61")
	baselineTerminal["updated"] = json.Number("0")
	baselineTerminal["updated_on"] = json.Number("1785157323.650178")
	history = append(history, baselineActive, baselineTerminal)

	bounded, err := boundCurrentIndexMetaHistory(history)
	if err != nil {
		t.Fatal(err)
	}
	if len(bounded) >= len(history) {
		t.Fatal("the bound discarded nothing, so it proves nothing here")
	}
	boundedBytes, err := json.Marshal(bounded)
	if err != nil {
		t.Fatal(err)
	}
	stored := currentStoredIndexMeta{id: "physical-row"}
	document := record.Document
	stored.document = &document
	stored.metadata = cloneCurrentIndexMetaObject(baselineTerminal)
	stored.metadata["history"] = string(boundedBytes)

	generation, ok := currentIndexMetaAdoptionGeneration(stored, record)
	if !ok {
		t.Fatal("the adoption fence no longer recovers a trimmed history")
	}
	if generation != storedGenerations {
		t.Fatalf("adoption recovered generation %d", generation)
	}
}

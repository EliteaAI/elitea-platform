package indexmeta

import (
	"context"
	"encoding/json"
	"reflect"
	"strconv"
	"testing"
	"time"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
)

// currentChunkingConfigForTest is the shape that dominates a stored row: the
// SDK's index_data chunking_config default is one entry per file extension and
// serializes to roughly 3.4 KB. Sixty-five entries reproduce that magnitude
// without pinning the snapshot's exact contents into this test.
func currentChunkingConfigForTest() map[string]any {
	configuration := make(map[string]any, 65)
	for extension := 0; extension < 65; extension++ {
		configuration[".extension"+strconv.Itoa(extension)] = map[string]any{
			"max_tokens":         512,
			"prompt":             "",
			"use_default_prompt": true,
			"use_llm":            true,
		}
	}
	return configuration
}

func currentIndexConfigurationForTest() map[string]any {
	return map[string]any{
		"index_name":         "Docs",
		"folder":             "",
		"clean_index":        false,
		"progress_step":      10,
		"include_extensions": []any{},
		"chunking_config":    currentChunkingConfigForTest(),
	}
}

// currentRunHistoryRowForTest builds one stored row the way the SDK does: each
// run appends a clone of the whole top level, so every entry repeats the run's
// index_configuration.
func currentRunHistoryRowForTest(t *testing.T, runs int) json.RawMessage {
	t.Helper()
	top := map[string]any{
		"collection":          "Docs",
		"type":                "index_meta",
		"state":               "completed",
		"indexed":             61,
		"updated":             228,
		"updated_on":          19_990,
		"conversation_id":     "conversation-1",
		"index_configuration": currentIndexConfigurationForTest(),
	}
	history := make([]any, 0, runs+1)
	created := map[string]any{}
	for key, value := range top {
		created[key] = value
	}
	created["state"] = "created"
	created["indexed"] = 0
	created["updated"] = 0
	history = append(history, created)
	for run := 1; run <= runs; run++ {
		entry := map[string]any{}
		for key, value := range top {
			entry[key] = value
		}
		entry["index_meta_id"] = "meta-" + strconv.Itoa(run)
		entry["execution_id"] = "execution-" + strconv.Itoa(run)
		history = append(history, entry)
	}
	encodedHistory, err := json.Marshal(history)
	if err != nil {
		t.Fatal(err)
	}
	top["history"] = string(encodedHistory)
	encoded, err := json.Marshal(top)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func currentChunkingToolkitForTest() indexingapp.CurrentToolkitSnapshot {
	return indexingapp.CurrentToolkitSnapshot{
		ID:   42,
		Type: "artifact",
		Settings: map[string]any{
			"pgvector_configuration": map[string]any{
				"elitea_title": "elitea-pgvector",
				"private":      false,
			},
		},
	}
}

func currentChunkingServiceForTest(t *testing.T, records []RawRecord) *Service {
	t.Helper()
	return currentServiceForTest(
		t,
		&currentToolkitStub{found: true, toolkit: currentChunkingToolkitForTest()},
		&currentSettingsStub{result: map[string]any{
			"pgvector_configuration": map[string]any{
				"connection_string": "postgresql://pg/project",
			},
		}},
		&currentTimeoutStub{timeout: 2 * time.Hour},
		&currentReaderStub{records: records},
		func() time.Time { return time.Unix(20_000, 0) },
	)
}

// TestServiceListKeepsHistoryPayloadBoundedAcrossRuns is the measurement this
// change exists for: before it, twelve runs carried twelve copies of the
// chunking configuration and the response grew by one whole copy per run.
func TestServiceListKeepsHistoryPayloadBoundedAcrossRuns(t *testing.T) {
	t.Parallel()

	oneRun := currentRunHistoryRowForTest(t, 1)
	twelveRuns := currentRunHistoryRowForTest(t, 12)
	if len(twelveRuns)-len(oneRun) < 11*3_000 {
		t.Fatalf(
			"fixture does not reproduce the stored growth: one run=%d twelve runs=%d",
			len(oneRun),
			len(twelveRuns),
		)
	}
	service := currentChunkingServiceForTest(t, []RawRecord{
		{ID: "one", Metadata: oneRun},
		{ID: "twelve", Metadata: twelveRuns},
	})

	items, err := service.List(
		context.Background(),
		Request{ProjectID: 7, ActorUserID: 8, ToolkitID: 42},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("items=%d", len(items))
	}
	first, err := json.Marshal(items[0])
	if err != nil {
		t.Fatal(err)
	}
	twelfth, err := json.Marshal(items[1])
	if err != nil {
		t.Fatal(err)
	}
	// Eleven further runs may add their own per-run fields, but never another
	// copy of the chunking configuration.
	if growth := len(twelfth) - len(first); growth > 11*512 {
		t.Fatalf(
			"per-run growth is unbounded: one run=%d twelve runs=%d growth=%d",
			len(first),
			len(twelfth),
			growth,
		)
	}
	if len(twelfth) >= len(twelveRuns)/3 {
		t.Fatalf(
			"projection did not shrink the stored row: stored=%d projected=%d",
			len(twelveRuns),
			len(twelfth),
		)
	}
}

// TestServiceListKeepsEveryStoredFieldExceptHistoryChunkingConfig is the
// compatibility proof for rows written before this change: the projection must
// differ from the stored row by exactly the history entries' chunking_config
// and nothing else.
func TestServiceListKeepsEveryStoredFieldExceptHistoryChunkingConfig(t *testing.T) {
	t.Parallel()

	stored := currentRunHistoryRowForTest(t, 3)
	service := currentChunkingServiceForTest(t, []RawRecord{{ID: "stored", Metadata: stored}})

	items, err := service.List(
		context.Background(),
		Request{ProjectID: 7, ActorUserID: 8, ToolkitID: 42},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("items=%d", len(items))
	}
	metadata := items[0].Metadata

	// The top level is what reindex, the edit form and the scheduler read; it
	// must still carry the exact configuration a run would replay.
	configuration, ok := metadata["index_configuration"].(map[string]any)
	if !ok {
		t.Fatalf("index_configuration=%#v", metadata["index_configuration"])
	}
	chunking, ok := configuration["chunking_config"].(map[string]any)
	if !ok || len(chunking) != 65 {
		t.Fatalf("top-level chunking_config=%#v", configuration["chunking_config"])
	}
	expected, err := json.Marshal(currentChunkingConfigForTest())
	if err != nil {
		t.Fatal(err)
	}
	actual, err := json.Marshal(chunking)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(json.RawMessage(actual), json.RawMessage(expected)) {
		t.Fatalf("top-level chunking_config changed: %s", actual)
	}

	history, ok := metadata["history"].([]any)
	if !ok || len(history) != 4 {
		t.Fatalf("history=%#v", metadata["history"])
	}
	for position, value := range history {
		entry, ok := value.(map[string]any)
		if !ok {
			t.Fatalf("history[%d]=%#v", position, value)
		}
		entryConfiguration, ok := entry["index_configuration"].(map[string]any)
		if !ok {
			t.Fatalf("history[%d] index_configuration=%#v", position, entry["index_configuration"])
		}
		if _, present := entryConfiguration["chunking_config"]; present {
			t.Fatalf("history[%d] still carries chunking_config", position)
		}
		// Everything else the entry described is still there.
		if entryConfiguration["index_name"] != "Docs" ||
			entryConfiguration["progress_step"] != json.Number("10") ||
			entryConfiguration["clean_index"] != false ||
			entry["collection"] != "Docs" ||
			entry["conversation_id"] != "conversation-1" {
			t.Fatalf("history[%d]=%#v", position, entry)
		}
	}
	if history[0].(map[string]any)["state"] != "created" ||
		history[1].(map[string]any)["state"] != "completed" ||
		history[1].(map[string]any)["indexed"] != json.Number("61") ||
		history[1].(map[string]any)["execution_id"] != "execution-1" {
		t.Fatalf("history states=%#v", history)
	}
}

// TestServiceListTrimsPythonStringShapedHistoryConfiguration covers rows the
// earlier Python path wrote, where a history entry nests its configuration as
// a JSON string. The projected entry must keep that type.
func TestServiceListTrimsPythonStringShapedHistoryConfiguration(t *testing.T) {
	t.Parallel()

	encodedConfiguration, err := json.Marshal(currentIndexConfigurationForTest())
	if err != nil {
		t.Fatal(err)
	}
	history, err := json.Marshal([]any{
		map[string]any{"state": "completed", "index_configuration": string(encodedConfiguration)},
		map[string]any{"state": "completed", "index_configuration": nil},
		map[string]any{"state": "completed", "index_configuration": "{not json"},
		map[string]any{"state": "completed"},
	})
	if err != nil {
		t.Fatal(err)
	}
	stored, err := json.Marshal(map[string]any{
		"collection": "Docs",
		"state":      "completed",
		"updated_on": 19_990,
		"history":    string(history),
	})
	if err != nil {
		t.Fatal(err)
	}
	service := currentChunkingServiceForTest(t, []RawRecord{{ID: "legacy", Metadata: stored}})

	items, err := service.List(
		context.Background(),
		Request{ProjectID: 7, ActorUserID: 8, ToolkitID: 42},
	)
	if err != nil {
		t.Fatal(err)
	}
	entries, ok := items[0].Metadata["history"].([]any)
	if !ok || len(entries) != 4 {
		t.Fatalf("history=%#v", items[0].Metadata["history"])
	}
	trimmed, ok := entries[0].(map[string]any)["index_configuration"].(string)
	if !ok {
		t.Fatalf("string-shaped entry became %#v", entries[0])
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(trimmed), &decoded); err != nil {
		t.Fatal(err)
	}
	if _, present := decoded["chunking_config"]; present {
		t.Fatal("string-shaped entry still carries chunking_config")
	}
	if decoded["index_name"] != "Docs" || len(decoded) != 5 {
		t.Fatalf("string-shaped entry lost fields: %#v", decoded)
	}
	// Entries the projection cannot parse are returned exactly as stored.
	if entries[1].(map[string]any)["index_configuration"] != nil ||
		entries[2].(map[string]any)["index_configuration"] != "{not json" {
		t.Fatalf("unparseable entries changed: %#v", entries)
	}
	if _, present := entries[3].(map[string]any)["index_configuration"]; present {
		t.Fatalf("entry gained a configuration: %#v", entries[3])
	}
}

// TestExactServiceStillReturnsWholeHistoryConfiguration keeps the detail read —
// the scheduler's replay source — carrying every run's exact configuration.
func TestExactServiceStillReturnsWholeHistoryConfiguration(t *testing.T) {
	t.Parallel()

	stored := currentRunHistoryRowForTest(t, 2)
	var decoded map[string]any
	if err := json.Unmarshal(stored, &decoded); err != nil {
		t.Fatal(err)
	}
	decoded["type"] = "index_meta"
	decoded["collection"] = "Docs"
	encoded, err := json.Marshal(decoded)
	if err != nil {
		t.Fatal(err)
	}
	reader := &currentExactReaderStub{found: true, record: RawRecord{ID: "meta-1", Metadata: encoded}}
	service, err := NewExactService(
		&currentToolkitStub{found: true, toolkit: currentChunkingToolkitForTest()},
		&currentSettingsStub{result: map[string]any{
			"pgvector_configuration": map[string]any{
				"connection_string": "postgresql://pg/project",
			},
		}},
		reader,
	)
	if err != nil {
		t.Fatal(err)
	}

	item, found, err := service.Find(
		context.Background(),
		Request{ProjectID: 7, ActorUserID: 8, ToolkitID: 42},
		"Docs",
	)
	if err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}
	configuration, ok := item.Metadata["index_configuration"].(map[string]any)
	if !ok || len(configuration["chunking_config"].(map[string]any)) != 65 {
		t.Fatalf("configuration=%#v", item.Metadata["index_configuration"])
	}
	rawHistory, ok := item.Metadata["history"].(string)
	if !ok {
		t.Fatalf("history=%#v", item.Metadata["history"])
	}
	var entries []map[string]any
	if err := json.Unmarshal([]byte(rawHistory), &entries); err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 {
		t.Fatalf("entries=%d", len(entries))
	}
	for position, entry := range entries {
		entryConfiguration, ok := entry["index_configuration"].(map[string]any)
		if !ok || len(entryConfiguration["chunking_config"].(map[string]any)) != 65 {
			t.Fatalf("detail entry[%d]=%#v", position, entry["index_configuration"])
		}
	}
}

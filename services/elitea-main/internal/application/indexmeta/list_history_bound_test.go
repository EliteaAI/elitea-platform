package indexmeta

import (
	"context"
	"encoding/json"
	"testing"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
)

// TestServiceListReadsARowThatGrewPastTheWriteCap is the read side of issue
// #299. The Python SDK writes this row too and applies no cap, so a row can
// already exceed MaxCurrentInitialIndexMetaBytes. Before this change, one such
// row failed the whole toolkit's index list with ErrCurrentIndexMetaLimitExceeded.
// The list is where a user starts the reindex that repairs the row, so that
// failure left a broken index with no way back.
func TestServiceListReadsARowThatGrewPastTheWriteCap(t *testing.T) {
	t.Parallel()

	oversized := currentRunHistoryRowForTest(t, 400)
	if len(oversized) <= indexingapp.MaxCurrentInitialIndexMetaBytes {
		t.Fatalf(
			"fixture is not over the write cap: row=%d bytes cap=%d bytes",
			len(oversized), indexingapp.MaxCurrentInitialIndexMetaBytes,
		)
	}
	healthy := currentRunHistoryRowForTest(t, 2)
	service := currentChunkingServiceForTest(t, []RawRecord{
		{ID: "oversized", Metadata: oversized},
		{ID: "healthy", Metadata: healthy},
	})

	items, err := service.List(
		context.Background(),
		Request{ProjectID: 7, ActorUserID: 8, ToolkitID: 42},
	)
	if err != nil {
		t.Fatalf("one over-cap row still fails the whole list: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("items=%d", len(items))
	}
	history, ok := items[0].Metadata["history"].([]any)
	if !ok {
		t.Fatalf("history=%T", items[0].Metadata["history"])
	}
	if len(history) != indexingapp.MaxCurrentIndexMetaHistoryEntries {
		t.Fatalf(
			"the response carries %d entries, not the %d entry bound",
			len(history), indexingapp.MaxCurrentIndexMetaHistoryEntries,
		)
	}
	// The bound keeps the newest runs. The view shows the newest run first.
	newest, ok := history[len(history)-1].(map[string]any)
	if !ok || newest["execution_id"] != "execution-400" {
		t.Fatalf("the newest run did not survive: %#v", newest)
	}
	oldest, ok := history[0].(map[string]any)
	if !ok || oldest["execution_id"] == "execution-1" {
		t.Fatalf("the oldest run was not discarded: %#v", oldest)
	}
}

// TestServiceListLeavesAHistoryUnderTheBoundWhole proves the read bound is
// inert for every row that the writer already keeps in range.
func TestServiceListLeavesAHistoryUnderTheBoundWhole(t *testing.T) {
	t.Parallel()

	const runs = 12
	service := currentChunkingServiceForTest(t, []RawRecord{
		{ID: "healthy", Metadata: currentRunHistoryRowForTest(t, runs)},
	})
	items, err := service.List(
		context.Background(),
		Request{ProjectID: 7, ActorUserID: 8, ToolkitID: 42},
	)
	if err != nil {
		t.Fatal(err)
	}
	history, ok := items[0].Metadata["history"].([]any)
	if !ok {
		t.Fatalf("history=%T", items[0].Metadata["history"])
	}
	// One created marker plus one entry for each run.
	if len(history) != runs+1 {
		t.Fatalf("history=%d entries", len(history))
	}
	first, ok := history[0].(map[string]any)
	if !ok || first["state"] != "created" {
		t.Fatalf("the created marker did not survive: %#v", first)
	}
}

// TestServiceListStillRejectsARowOverTheReadCeiling proves the read ceiling is
// a ceiling, not the removal of one.
func TestServiceListStillRejectsARowOverTheReadCeiling(t *testing.T) {
	t.Parallel()

	huge, err := json.Marshal(map[string]any{
		"collection": "Docs",
		"type":       "index_meta",
		"state":      "completed",
		"updated_on": 19_990,
		"padding":    currentReadCeilingPaddingForTest(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(huge) <= indexingapp.MaxCurrentIndexMetaReadBytes {
		t.Fatalf("fixture is only %d bytes", len(huge))
	}
	service := currentChunkingServiceForTest(t, []RawRecord{
		{ID: "huge", Metadata: huge},
	})
	if _, err := service.List(
		context.Background(),
		Request{ProjectID: 7, ActorUserID: 8, ToolkitID: 42},
	); err == nil {
		t.Fatal("the list accepted a row over the read ceiling")
	}
}

func currentReadCeilingPaddingForTest() string {
	padding := make([]byte, indexingapp.MaxCurrentIndexMetaReadBytes+1)
	for index := range padding {
		padding[index] = 'x'
	}
	return string(padding)
}

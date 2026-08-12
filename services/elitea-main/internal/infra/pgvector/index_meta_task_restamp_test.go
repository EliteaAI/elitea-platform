package pgvector

import (
	"encoding/json"
	"errors"
	"testing"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
)

func TestPlanCurrentTaskRestampFencesGenerationCreatedOnAndTerminalRace(t *testing.T) {
	record := indexingapp.CurrentTaskRestampIndexMeta{
		MetaID:          "meta-1",
		ExecutionID:     "execution-1",
		Generation:      3,
		IndexGeneration: 7,
		IndexName:       "Docs",
		ToolkitID:       19,
		CreatedOn:       1_700_000_000.25,
	}
	history := `[{"state":"in_progress","task_id":null,"created_on":1700000000.25}]`
	stored := currentStoredIndexMeta{
		id: "physical-meta",
		metadata: map[string]any{
			"collection":           "Docs",
			"type":                 "index_meta",
			"state":                "in_progress",
			"task_id":              nil,
			"created_on":           json.Number("1700000000.25"),
			"execution_id":         "execution-1",
			"execution_generation": json.Number("3"),
			"index_generation":     json.Number("7"),
			"index_meta_id":        "meta-1",
			"history":              history,
		},
	}

	plan, err := planCurrentTaskRestampIndexMeta(
		record,
		[]currentStoredIndexMeta{stored},
	)
	if err != nil || plan.noop || plan.id != "physical-meta" {
		t.Fatalf("restamp plan=%+v err=%v", plan, err)
	}
	metadata := mustDecodeCurrentIndexMeta(t, plan.metadata)
	if metadata["task_id"] != record.ExecutionID {
		t.Fatalf("task_id=%#v", metadata["task_id"])
	}
	if metadata["history"] != history {
		t.Fatalf("restamp changed history: %#v", metadata["history"])
	}

	same := stored
	same.metadata = cloneCurrentIndexMetaObject(stored.metadata)
	same.metadata["task_id"] = record.ExecutionID
	plan, err = planCurrentTaskRestampIndexMeta(
		record,
		[]currentStoredIndexMeta{same},
	)
	if err != nil || !plan.noop {
		t.Fatalf("same task retry plan=%+v err=%v", plan, err)
	}

	for _, test := range []struct {
		name string
		edit func(map[string]any)
		want error
	}{
		{
			name: "different task",
			edit: func(metadata map[string]any) {
				metadata["task_id"] = "other-execution"
			},
			want: indexingapp.ErrCurrentIndexMetaConflict,
		},
		{
			name: "stale created_on",
			edit: func(metadata map[string]any) {
				metadata["created_on"] = json.Number("1700000001")
			},
			want: indexingapp.ErrCurrentIndexMetaSuperseded,
		},
		{
			name: "newer index generation",
			edit: func(metadata map[string]any) {
				metadata["index_generation"] = json.Number("8")
			},
			want: indexingapp.ErrCurrentIndexMetaSuperseded,
		},
		{
			name: "cancelled terminal won",
			edit: func(metadata map[string]any) {
				metadata["state"] = "cancelled"
			},
			want: indexingapp.ErrCurrentIndexMetaSuperseded,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			selected := stored
			selected.metadata = cloneCurrentIndexMetaObject(stored.metadata)
			test.edit(selected.metadata)
			if _, err := planCurrentTaskRestampIndexMeta(
				record,
				[]currentStoredIndexMeta{selected},
			); !errors.Is(err, test.want) {
				t.Fatalf("error=%v want=%v", err, test.want)
			}
		})
	}

	completed := stored
	completed.metadata = cloneCurrentIndexMetaObject(stored.metadata)
	completed.metadata["state"] = "completed"
	plan, err = planCurrentTaskRestampIndexMeta(
		record,
		[]currentStoredIndexMeta{completed},
	)
	if err != nil || plan.noop {
		t.Fatalf("completed same-generation restamp plan=%+v err=%v", plan, err)
	}
}

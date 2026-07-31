package pgvector

import (
	"bytes"
	"encoding/json"
	"errors"
	"testing"
	"time"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	indexscheduleapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexschedule"
)

func TestPlanCurrentScheduledFailureAppendsExactIdempotentHistory(t *testing.T) {
	effect := indexscheduleapp.FailureEffect{
		EffectID:    "index-schedule-v1:effect",
		ProjectID:   7,
		UserID:      11,
		ToolkitID:   19,
		IndexMetaID: "docs",
		SafeReason:  "missing valid user token",
		OccurredAt:  time.Date(2026, 7, 30, 12, 13, 14, 500_000_000, time.UTC),
	}
	existing := currentStoredIndexMeta{
		id: "row-1",
		metadata: map[string]any{
			"type":       "index_meta",
			"collection": "docs",
			"state":      "completed",
			"history":    `[{"state":"completed","indexed":4}]`,
		},
	}

	plan, err := planCurrentScheduledFailure(
		effect,
		[]currentStoredIndexMeta{existing},
	)
	if err != nil {
		t.Fatal(err)
	}
	if plan.noop || plan.id != existing.id {
		t.Fatalf("unexpected plan: %+v", plan)
	}
	var metadata map[string]any
	decoder := json.NewDecoder(bytes.NewReader(plan.metadata))
	decoder.UseNumber()
	if err := decoder.Decode(&metadata); err != nil {
		t.Fatal(err)
	}
	if metadata["state"] != "failed" ||
		metadata["error"] != effect.SafeReason ||
		metadata["collection"] != "docs" {
		t.Fatalf("unexpected failed metadata: %#v", metadata)
	}
	history, ok := decodeCurrentIndexMetaHistory(metadata["history"])
	if !ok || len(history) != 2 {
		t.Fatalf("unexpected history: %#v", metadata["history"])
	}
	last, ok := history[1].(map[string]any)
	if !ok ||
		last["schedule_effect_id"] != effect.EffectID ||
		last["state"] != "failed" ||
		last["error"] != effect.SafeReason {
		t.Fatalf("unexpected terminal history: %#v", history[1])
	}

	replay := currentStoredIndexMeta{id: plan.id, metadata: metadata}
	replayed, err := planCurrentScheduledFailure(
		effect,
		[]currentStoredIndexMeta{replay},
	)
	if err != nil || !replayed.noop {
		t.Fatalf("replay plan=%+v error=%v", replayed, err)
	}
}

func TestPlanCurrentScheduledFailurePreservesMissingAndRejectsAmbiguity(t *testing.T) {
	effect := indexscheduleapp.FailureEffect{
		EffectID:    "index-schedule-v1:effect",
		ProjectID:   7,
		UserID:      11,
		ToolkitID:   19,
		IndexMetaID: "docs",
		SafeReason:  "toolkit credentials resolving issue",
		OccurredAt:  time.Now().UTC(),
	}
	missing, err := planCurrentScheduledFailure(effect, nil)
	if err != nil || !missing.noop {
		t.Fatalf("missing plan=%+v error=%v", missing, err)
	}
	duplicate := currentStoredIndexMeta{
		id:       "row",
		metadata: map[string]any{"history": `[]`},
	}
	if _, err := planCurrentScheduledFailure(
		effect,
		[]currentStoredIndexMeta{duplicate, duplicate},
	); !errors.Is(err, indexingapp.ErrCurrentIndexMetaConflict) {
		t.Fatalf("duplicate error=%v", err)
	}
}

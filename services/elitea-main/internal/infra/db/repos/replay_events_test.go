package repos

import (
	"context"
	"errors"
	"testing"

	executionsapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/executions"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
)

func TestReplayEventsRepositoryVerifiesDurableDigestAndCopiesData(t *testing.T) {
	data := []byte(`{"valid":true}`)
	digest := runtimedomain.SHA256(data)
	executor := &scriptedExecutor{
		rowResults: []scriptedRow{{values: []any{int64(0), int64(7), true, true}}},
		rowsResult: &scriptedRows{rows: []scriptedRow{{values: []any{
			int64(7), "configuration.validation.completed", data, digest[:],
		}}}},
	}
	repository := newReplayEventsRepository(executor)
	events, err := repository.Replay(context.Background(), "42", "execution-1", 3, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Cursor != 7 || string(events[0].Data) != string(data) {
		t.Fatalf("unexpected replay: %+v", events)
	}
	data[0] = 'x'
	if string(events[0].Data) != `{"valid":true}` {
		t.Fatal("replay data aliases the database buffer")
	}
}

func TestReplayEventsRepositoryRejectsTamperedDurableData(t *testing.T) {
	data := []byte(`{"valid":true}`)
	wrong := runtimedomain.SHA256([]byte("other"))
	repository := newReplayEventsRepository(&scriptedExecutor{
		rowResults: []scriptedRow{{values: []any{int64(0), int64(7), true, true}}},
		rowsResult: &scriptedRows{rows: []scriptedRow{{values: []any{
			int64(7), "configuration.validation.completed", data, wrong[:],
		}}}},
	})
	_, err := repository.Replay(context.Background(), "42", "execution-1", 0, 10)
	if !errors.Is(err, executionsapi.ErrInvalidEventStream) {
		t.Fatalf("expected invalid event stream, got %v", err)
	}
}

func TestReplayEventsRepositoryEmitsResetThenRetainedTerminal(t *testing.T) {
	terminal := []byte(`{"status":"ok"}`)
	digest := runtimedomain.SHA256(terminal)
	executor := &scriptedExecutor{
		rowResults: []scriptedRow{{values: []any{int64(11), int64(15), true, false}}},
		rowsResult: &scriptedRows{rows: []scriptedRow{{values: []any{
			int64(15), "index.ingest.completed", terminal, digest[:],
		}}}},
	}
	events, err := newReplayEventsRepository(executor).Replay(context.Background(), "42", "execution-1", 3, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 ||
		events[0].Cursor != 11 ||
		events[0].Type != replayEventReset ||
		events[1].Cursor != 15 ||
		events[1].Type != "index.ingest.completed" {
		t.Fatalf("unexpected reset replay: %+v", events)
	}
	if got := executor.queryCalls[0].args[2]; got != int64(11) {
		t.Fatalf("durable replay did not resume at reset cursor: %v", got)
	}
}

func TestReplayEventsRepositoryRejectsUnknownOrCrossExecutionCursor(t *testing.T) {
	repository := newReplayEventsRepository(&scriptedExecutor{
		rowResults: []scriptedRow{{values: []any{int64(4), int64(12), true, false}}},
	})
	_, err := repository.Replay(context.Background(), "42", "execution-1", 9, 10)
	if !errors.Is(err, executionsapi.ErrInvalidEventStream) {
		t.Fatalf("expected invalid event stream, got %v", err)
	}
}

func TestReplayEventsRepositoryBoundsStaleReconnectStorm(t *testing.T) {
	const reconnects = 128
	terminal := []byte(`{"status":"ok"}`)
	digest := runtimedomain.SHA256(terminal)
	executor := &scriptedExecutor{
		rowResults:  make([]scriptedRow, 0, reconnects),
		rowsResults: make([]*scriptedRows, 0, reconnects),
	}
	for range reconnects {
		executor.rowResults = append(executor.rowResults, scriptedRow{
			values: []any{int64(11), int64(15), true, false},
		})
		executor.rowsResults = append(executor.rowsResults, &scriptedRows{rows: []scriptedRow{{values: []any{
			int64(15), "index.ingest.completed", terminal, digest[:],
		}}}})
	}
	repository := newReplayEventsRepository(executor)
	for reconnect := range reconnects {
		events, err := repository.Replay(context.Background(), "42", "execution-1", 3, 10)
		if err != nil {
			t.Fatalf("reconnect %d: %v", reconnect, err)
		}
		if len(events) != 2 || events[0].Type != replayEventReset || events[1].Type != "index.ingest.completed" {
			t.Fatalf("reconnect %d returned an unbounded or incomplete replay: %+v", reconnect, events)
		}
	}
	if len(executor.rowCalls) != reconnects || len(executor.queryCalls) != reconnects {
		t.Fatalf(
			"stale reconnects performed unexpected queries: bounds=%d replay=%d",
			len(executor.rowCalls),
			len(executor.queryCalls),
		)
	}
}

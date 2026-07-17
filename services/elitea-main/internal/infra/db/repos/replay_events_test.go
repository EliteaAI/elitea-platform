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
	executor := &scriptedExecutor{rowsResult: &scriptedRows{rows: []scriptedRow{{values: []any{
		int64(7), "configuration.validation.completed", data, digest[:],
	}}}}}
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
	repository := newReplayEventsRepository(&scriptedExecutor{rowsResult: &scriptedRows{rows: []scriptedRow{{values: []any{
		int64(7), "configuration.validation.completed", data, wrong[:],
	}}}}})
	_, err := repository.Replay(context.Background(), "42", "execution-1", 0, 10)
	if !errors.Is(err, executionsapi.ErrInvalidEventStream) {
		t.Fatalf("expected invalid event stream, got %v", err)
	}
}

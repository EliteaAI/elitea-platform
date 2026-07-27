package executions

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

type eventAuthorizerStub struct {
	err   error
	calls int
}

func (s *eventAuthorizerStub) AuthorizeExecutionEvents(_ context.Context, _, _ string) error {
	s.calls++
	return s.err
}

type eventRepositoryStub struct {
	events  map[uint64][]DurableEvent
	err     error
	cursors []uint64
}

func (s *eventRepositoryStub) Replay(_ context.Context, _, _ string, afterCursor uint64, _ int) ([]DurableEvent, error) {
	s.cursors = append(s.cursors, afterCursor)
	if s.err != nil {
		return nil, s.err
	}
	return append([]DurableEvent(nil), s.events[afterCursor]...), nil
}

type replayWaiterStub struct {
	calls []uint64
}

type oneWakeWaiter struct{}

func (oneWakeWaiter) Wait(context.Context, string, string, uint64) (bool, error) {
	return true, nil
}

type revokingEventAuthorizer struct {
	calls int
}

func (a *revokingEventAuthorizer) AuthorizeExecutionEvents(context.Context, string, string) error {
	a.calls++
	if a.calls > 1 {
		return ErrExecutionEventsForbidden
	}
	return nil
}

type streamingRecorder struct {
	*httptest.ResponseRecorder
	deadlines []time.Time
}

func newStreamingRecorder() *streamingRecorder {
	return &streamingRecorder{ResponseRecorder: httptest.NewRecorder()}
}

func (r *streamingRecorder) SetWriteDeadline(deadline time.Time) error {
	r.deadlines = append(r.deadlines, deadline)
	return nil
}

func (r *streamingRecorder) Flush() { r.ResponseRecorder.Flush() }

func (s *replayWaiterStub) Wait(_ context.Context, _, _ string, afterCursor uint64) (bool, error) {
	s.calls = append(s.calls, afterCursor)
	return false, context.Canceled
}

func TestEventHandlerReplaysFromDurableLastEventIDAndNeverAcceptsPayloadFromWaiter(t *testing.T) {
	authorizer := &eventAuthorizerStub{}
	repository := &eventRepositoryStub{events: map[uint64][]DurableEvent{
		4: {{Cursor: 5, Type: "configuration.validation.completed", Data: json.RawMessage(`{"valid":false}`)}},
	}}
	waiter := &replayWaiterStub{}
	handler, err := NewEventHandler(authorizer, repository, waiter)
	if err != nil {
		t.Fatal(err)
	}
	request := executionEventsRequest()
	request.Header.Set("Last-Event-ID", "4")
	response := newStreamingRecorder()
	handler.Stream(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("unexpected status %d: %s", response.Code, response.Body.String())
	}
	want := "id: 5\nevent: configuration.validation.completed\ndata: {\"valid\":false}\n\n"
	if response.Body.String() != want {
		t.Fatalf("unexpected SSE replay:\n%s", response.Body.String())
	}
	if !reflect.DeepEqual(repository.cursors, []uint64{4}) || !reflect.DeepEqual(waiter.calls, []uint64{5}) {
		t.Fatalf("cursor was not advanced from durable replay: repository=%v waiter=%v", repository.cursors, waiter.calls)
	}
	if len(response.deadlines) < 5 || response.deadlines[0] != (time.Time{}) || response.deadlines[len(response.deadlines)-1] != (time.Time{}) {
		t.Fatalf("SSE writes did not clear and bound write deadlines: %v", response.deadlines)
	}
	bounded := false
	for _, deadline := range response.deadlines {
		if !deadline.IsZero() {
			bounded = true
			break
		}
	}
	if !bounded {
		t.Fatal("SSE stream installed no bounded per-write deadline")
	}
}

func TestEventHandlerStreamsReplayResetInsteadOfRetryingExpiredCursor(t *testing.T) {
	t.Run("expired", func(t *testing.T) {
		authorizer := &eventAuthorizerStub{}
		repository := &eventRepositoryStub{events: map[uint64][]DurableEvent{
			9: {{
				Cursor: 12,
				Type:   "execution.replay_reset",
				Data:   json.RawMessage(`{"reason":"progress_retention_window_elapsed"}`),
			}, {
				Cursor: 13,
				Type:   "index.ingest.completed",
				Data:   json.RawMessage(`{"status":"ok"}`),
			}},
		}}
		handler, err := NewEventHandler(authorizer, repository, &replayWaiterStub{})
		if err != nil {
			t.Fatal(err)
		}
		request := executionEventsRequest()
		request.Header.Set("Last-Event-ID", "9")
		response := newStreamingRecorder()
		handler.Stream(response, request)
		if response.Code != http.StatusOK ||
			!strings.Contains(response.Body.String(), "id: 12\nevent: execution.replay_reset\ndata:") ||
			!strings.Contains(response.Body.String(), "id: 13\nevent: index.ingest.completed\ndata:") {
			t.Fatalf("unexpected expired-cursor reset %d %s", response.Code, response.Body.String())
		}
	})
}

func TestEventHandlerRejectsConflictingCursorSourcesBeforeStreaming(t *testing.T) {
	t.Run("conflicting", func(t *testing.T) {
		authorizer := &eventAuthorizerStub{}
		repository := &eventRepositoryStub{}
		handler, err := NewEventHandler(authorizer, repository, &replayWaiterStub{})
		if err != nil {
			t.Fatal(err)
		}
		request := executionEventsRequest()
		request.Header.Set("Last-Event-ID", "9")
		query := request.URL.Query()
		query.Set("cursor", "8")
		request.URL.RawQuery = query.Encode()
		response := newStreamingRecorder()
		handler.Stream(response, request)
		if response.Code != http.StatusBadRequest || len(repository.cursors) != 0 {
			t.Fatalf("conflicting cursor reached durable repository: status=%d cursors=%v", response.Code, repository.cursors)
		}
	})
}

func TestEventHandlerAuthorizesBeforeDurableLookup(t *testing.T) {
	authorizer := &eventAuthorizerStub{err: ErrExecutionEventsForbidden}
	repository := &eventRepositoryStub{}
	handler, err := NewEventHandler(authorizer, repository, &replayWaiterStub{})
	if err != nil {
		t.Fatal(err)
	}
	response := newStreamingRecorder()
	handler.Stream(response, executionEventsRequest())
	if response.Code != http.StatusForbidden || len(repository.cursors) != 0 {
		t.Fatalf("forbidden stream reached repository: status=%d cursors=%v", response.Code, repository.cursors)
	}
}

func TestEventHandlerReauthorizesAfterWakeAndWritesNothingAfterRevocation(t *testing.T) {
	authorizer := &revokingEventAuthorizer{}
	repository := &eventRepositoryStub{events: map[uint64][]DurableEvent{
		0: nil,
	}}
	handler, err := NewEventHandler(authorizer, repository, oneWakeWaiter{})
	if err != nil {
		t.Fatal(err)
	}
	response := newStreamingRecorder()
	handler.Stream(response, executionEventsRequest())
	if authorizer.calls != 2 {
		t.Fatalf("authorization calls = %d, want initial plus post-wake", authorizer.calls)
	}
	if len(repository.cursors) != 1 {
		t.Fatalf("revoked stream replayed after wake: cursors=%v", repository.cursors)
	}
	if response.Body.String() != ": connected\n\n" {
		t.Fatalf("revoked stream wrote data after wake: %q", response.Body.String())
	}
}

func TestSSEAdmissionGateBoundsGlobalPrincipalAndProjectStreams(t *testing.T) {
	gate := newSSEAdmissionGate(2, 1, 1)
	if gate == nil {
		t.Fatal("valid gate profile was rejected")
	}
	releaseFirst, ok := gate.acquire("principal-1", "project-1")
	if !ok {
		t.Fatal("first stream was rejected")
	}
	if _, ok := gate.acquire("principal-1", "project-2"); ok {
		t.Fatal("principal stream limit was bypassed")
	}
	if _, ok := gate.acquire("principal-2", "project-1"); ok {
		t.Fatal("project stream limit was bypassed")
	}
	releaseSecond, ok := gate.acquire("principal-2", "project-2")
	if !ok {
		t.Fatal("independent second stream was rejected")
	}
	if _, ok := gate.acquire("principal-3", "project-3"); ok {
		t.Fatal("global stream limit was bypassed")
	}

	releaseFirst()
	releaseFirst()
	if releaseReplacement, ok := gate.acquire("principal-3", "project-1"); !ok {
		t.Fatal("released stream capacity was not reusable")
	} else {
		releaseReplacement()
	}
	releaseSecond()
}

func TestValidateDurableEventRejectsInjectionAndOversize(t *testing.T) {
	tests := []DurableEvent{
		{Cursor: 1, Type: "bad\nevent", Data: json.RawMessage(`{}`)},
		{Cursor: 1, Type: "valid", Data: json.RawMessage(`not-json`)},
		{Cursor: 1, Type: "valid", Data: json.RawMessage(`"` + strings.Repeat("x", maxSSEEventBytes) + `"`)},
	}
	for _, event := range tests {
		if !errors.Is(validateDurableEvent(event), ErrInvalidEventStream) {
			t.Fatalf("unsafe event accepted: %+v", event)
		}
	}
}

func TestWriteDurableEventPreservesCompactJSONAndCompactsFallback(t *testing.T) {
	tests := []struct {
		name string
		data json.RawMessage
		want string
	}{
		{
			name: "compact object",
			data: json.RawMessage(`{"message":"space and escaped\nline","nested":{"ok":true}}`),
			want: `{"message":"space and escaped\nline","nested":{"ok":true}}`,
		},
		{
			name: "insignificant spaces",
			data: json.RawMessage(` { "message": "space in value", "ok": true } `),
			want: `{"message":"space in value","ok":true}`,
		},
		{
			name: "multiline",
			data: json.RawMessage("{\n\t\"ok\": true\n}"),
			want: `{"ok":true}`,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			err := writeDurableEvent(response, DurableEvent{
				Cursor: 7,
				Type:   "index.ingest.progress",
				Data:   test.data,
			})
			if err != nil {
				t.Fatal(err)
			}
			want := "id: 7\nevent: index.ingest.progress\ndata: " + test.want + "\n\n"
			if response.Body.String() != want {
				t.Fatalf("SSE event = %q, want %q", response.Body.String(), want)
			}
		})
	}
}

func TestWriteDurableEventRejectsInvalidJSONBeforeWriting(t *testing.T) {
	for _, data := range []json.RawMessage{
		json.RawMessage(`{"missing":"brace"`),
		json.RawMessage("{\n\"missing\":\"brace\""),
	} {
		response := httptest.NewRecorder()
		if err := writeDurableEvent(response, DurableEvent{
			Cursor: 7,
			Type:   "index.ingest.progress",
			Data:   data,
		}); err == nil {
			t.Fatalf("invalid JSON was accepted: %q", data)
		}
		if response.Body.Len() != 0 {
			t.Fatalf("invalid JSON wrote partial SSE data: %q", response.Body.String())
		}
	}
}

type discardEventResponseWriter struct{}

func (discardEventResponseWriter) Header() http.Header            { return nil }
func (discardEventResponseWriter) WriteHeader(int)                {}
func (discardEventResponseWriter) Write(data []byte) (int, error) { return len(data), nil }

func BenchmarkWriteDurableEvent(b *testing.B) {
	events := map[string]DurableEvent{
		"compact": {
			Cursor: 7,
			Type:   "index.ingest.progress",
			Data:   json.RawMessage(`{"type":"agent_thinking_step","message":"20 files processed","metadata":{"tool_name":"index_data"}}`),
		},
		"whitespace_fallback": {
			Cursor: 7,
			Type:   "index.ingest.progress",
			Data:   json.RawMessage(` { "type": "agent_thinking_step", "message": "20 files processed", "metadata": { "tool_name": "index_data" } } `),
		},
	}
	writer := discardEventResponseWriter{}
	for name, event := range events {
		b.Run(name, func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				if err := writeDurableEvent(writer, event); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func executionEventsRequest() *http.Request {
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	routeContext := chi.NewRouteContext()
	routeContext.URLParams.Add("projectID", "project-1")
	routeContext.URLParams.Add("executionID", "execution-1")
	return request.WithContext(context.WithValue(request.Context(), chi.RouteCtxKey, routeContext))
}

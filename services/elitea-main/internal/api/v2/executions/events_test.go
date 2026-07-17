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

func TestEventHandlerRejectsExpiredAndConflictingCursorsBeforeStreaming(t *testing.T) {
	t.Run("expired", func(t *testing.T) {
		authorizer := &eventAuthorizerStub{}
		repository := &eventRepositoryStub{err: ErrCursorExpired}
		handler, err := NewEventHandler(authorizer, repository, &replayWaiterStub{})
		if err != nil {
			t.Fatal(err)
		}
		request := executionEventsRequest()
		request.Header.Set("Last-Event-ID", "9")
		response := newStreamingRecorder()
		handler.Stream(response, request)
		if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "cursor expired") {
			t.Fatalf("unexpected expired-cursor response %d %s", response.Code, response.Body.String())
		}
	})

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

func executionEventsRequest() *http.Request {
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	routeContext := chi.NewRouteContext()
	routeContext.URLParams.Add("projectID", "project-1")
	routeContext.URLParams.Add("executionID", "execution-1")
	return request.WithContext(context.WithValue(request.Context(), chi.RouteCtxKey, routeContext))
}

package events

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/go-chi/chi/v5"
	goredis "github.com/redis/go-redis/v9"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/redis"
)

// fakeSource is an in-memory EventSource: it hands the test a send channel it
// can push decoded events onto, and records the channel it was asked to
// subscribe to. It lets the SSE Stream handler be exercised without a live
// Redis or NATS server.
type fakeSource struct {
	mu          sync.Mutex
	channel     string
	events      chan redis.Event
	err         error
	cancelCalls int
}

func newFakeSource() *fakeSource {
	return &fakeSource{events: make(chan redis.Event, 8)}
}

func (f *fakeSource) Raw(_ context.Context, channel string) (<-chan redis.Event, func(), error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.channel = channel
	if f.err != nil {
		return nil, nil, f.err
	}
	return f.events, func() {
		f.mu.Lock()
		f.cancelCalls++
		f.mu.Unlock()
	}, nil
}

func (f *fakeSource) cancelled() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.cancelCalls
}

func newRequestWithProjectID(ctx context.Context, projectID string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/", nil).WithContext(ctx)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("projectID", projectID)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

func TestStream_DeliversEventThenClosesOnCtxCancel(t *testing.T) {
	src := newFakeSource()
	h := NewHandlerFromSource(src)

	ctx, cancel := context.WithCancel(context.Background())
	rec := httptest.NewRecorder()
	req := newRequestWithProjectID(ctx, "42")

	done := make(chan struct{})
	go func() {
		h.Stream(rec, req)
		close(done)
	}()

	// Push an event, then cancel the request context to end the stream.
	src.events <- redis.Event{Type: "message.created", Payload: json.RawMessage(`{"n":1}`)}
	// Give the handler a moment to write it before we cancel.
	time.Sleep(50 * time.Millisecond)
	cancel()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Stream did not return after ctx cancel")
	}

	if src.channel != "project:42:events" {
		t.Errorf("subscribed channel = %q, want project:42:events", src.channel)
	}
	if src.cancelled() != 1 {
		t.Errorf("cancel func called %d times, want 1", src.cancelled())
	}

	body := rec.Body.String()
	if !strings.Contains(body, ": connected") {
		t.Errorf("missing connected comment; body=%q", body)
	}
	if !strings.Contains(body, "event: message.created") || !strings.Contains(body, `data: {"n":1}`) {
		t.Errorf("event not written; body=%q", body)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/event-stream" {
		t.Errorf("Content-Type = %q", ct)
	}
}

func TestStream_ReturnsWhenSourceChannelCloses(t *testing.T) {
	src := newFakeSource()
	h := NewHandlerFromSource(src)

	rec := httptest.NewRecorder()
	req := newRequestWithProjectID(context.Background(), "7")

	done := make(chan struct{})
	go func() {
		h.Stream(rec, req)
		close(done)
	}()

	close(src.events) // upstream gone → handler should return

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Stream did not return when source channel closed")
	}
	if src.cancelled() != 1 {
		t.Errorf("cancel func called %d times, want 1", src.cancelled())
	}
}

func TestStream_SourceError(t *testing.T) {
	src := newFakeSource()
	src.err = errors.New("source down")
	h := NewHandlerFromSource(src)

	rec := httptest.NewRecorder()
	req := newRequestWithProjectID(context.Background(), "1")
	h.Stream(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", rec.Code)
	}
}

func TestStream_StreamingUnsupported(t *testing.T) {
	src := newFakeSource()
	h := NewHandlerFromSource(src)

	// A plain writer with no Flush method → ssewriter.New fails.
	rec := &noFlushWriter{header: http.Header{}}
	req := newRequestWithProjectID(context.Background(), "1")
	h.Stream(rec, req)

	if rec.status != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", rec.status)
	}
}

// noFlushWriter is an http.ResponseWriter WITHOUT an http.Flusher, exercising
// the "streaming not supported" branch of Stream.
type noFlushWriter struct {
	header http.Header
	status int
}

func (n *noFlushWriter) Header() http.Header      { return n.header }
func (n *noFlushWriter) Write(b []byte) (int, error) { return len(b), nil }
func (n *noFlushWriter) WriteHeader(status int)   { n.status = status }

func TestRoutes(t *testing.T) {
	h := NewHandlerFromSource(newFakeSource())
	if h.Routes() == nil {
		t.Fatal("Routes returned nil")
	}
}

func TestNewHandler_WrapsRedisClient(t *testing.T) {
	// Construction only — no live server required. Confirms the Redis path
	// builds a redisSource-backed handler.
	rdb := goredis.NewClient(&goredis.Options{Addr: "127.0.0.1:0"})
	defer func() { _ = rdb.Close() }()
	h := NewHandler(rdb)
	if _, ok := h.source.(*redisSource); !ok {
		t.Errorf("NewHandler source = %T, want *redisSource", h.source)
	}
}

func TestRedisSource_RoundTripAndMalformedSkip(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	defer mr.Close()

	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	defer func() { _ = rdb.Close() }()
	rs := &redisSource{client: rdb}

	ctx := context.Background()
	out, cancel, err := rs.Raw(ctx, "project:5:events")
	if err != nil {
		t.Fatalf("Raw: %v", err)
	}
	defer cancel()

	// Wait for the goroutine's subscription to be live before publishing.
	deadline := time.After(2 * time.Second)
	for len(mr.PubSubChannels("*")) == 0 {
		select {
		case <-deadline:
			t.Fatal("subscription never registered")
		case <-time.After(5 * time.Millisecond):
		}
	}

	// A malformed message is skipped; a valid envelope is decoded and forwarded.
	mr.Publish("project:5:events", "{not json")
	valid, _ := json.Marshal(redis.Event{Type: "conversation.created", Payload: json.RawMessage(`{"id":"c1"}`)})
	mr.Publish("project:5:events", string(valid))

	select {
	case e := <-out:
		if e.Type != "conversation.created" {
			t.Errorf("type = %q, want conversation.created", e.Type)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("valid event not delivered")
	}
}

func TestRedisSource_CancelIsIdempotent(t *testing.T) {
	// Subscribe against a client pointed at an unroutable addr; we never
	// receive events, but the cancel func must close the channel exactly once
	// even when invoked twice.
	rdb := goredis.NewClient(&goredis.Options{Addr: "127.0.0.1:0"})
	defer func() { _ = rdb.Close() }()
	rs := &redisSource{client: rdb}

	out, cancel, err := rs.Raw(context.Background(), "project:1:events")
	if err != nil {
		t.Fatalf("Raw: %v", err)
	}
	cancel()
	cancel() // must not panic (double close guard)

	select {
	case _, ok := <-out:
		if ok {
			// Drain a possible buffered value, then expect close.
			<-out
		}
	case <-time.After(2 * time.Second):
		t.Fatal("channel not closed after cancel")
	}
}

package requestlog

// The recorder's decisions. Each test covers something that would be invisible
// in production if it regressed: a log that drops silently, one that blocks the
// request path, one that loses the last second before a crash, or one that
// breaks streaming by wrapping the ResponseWriter badly.

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

// captureSink records what it was asked to write.
type captureSink struct {
	mu      sync.Mutex
	batches [][]Record
	err     error
	pruned  []time.Time
}

func (s *captureSink) WriteBatch(_ context.Context, records []Record) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return s.err
	}
	batch := make([]Record, len(records))
	copy(batch, records)
	s.batches = append(s.batches, batch)
	return nil
}

func (s *captureSink) Prune(_ context.Context, olderThan time.Time) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruned = append(s.pruned, olderThan)
	return 0, nil
}

func (s *captureSink) records() []Record {
	s.mu.Lock()
	defer s.mu.Unlock()
	var all []Record
	for _, batch := range s.batches {
		all = append(all, batch...)
	}
	return all
}

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// TestRecordsSurviveAStopDrain — the buffered records describe the last second
// of traffic, which is exactly the window an operator investigating a
// crash-loop is looking for. Discarding them at shutdown would remove the most
// valuable rows in the table.
func TestRecordsSurviveAStopDrain(t *testing.T) {
	sink := &captureSink{}
	recorder := New(sink, quietLogger())

	for i := range 10 {
		recorder.Record(Record{Route: "/llm/v1/chat/completions", Status: 200 + i})
	}
	recorder.Stop(context.Background())

	if got := len(sink.records()); got != 10 {
		t.Fatalf("wrote %d records, want 10 — the shutdown drain lost some", got)
	}
	if recorder.Dropped() != 0 {
		t.Errorf("dropped %d records with an empty buffer", recorder.Dropped())
	}
}

// TestAFullBufferDropsAndCounts.
//
// Dropping is the least-bad option — blocking would couple request latency to
// database latency, which is the problem the queue exists to solve, and an
// unbounded buffer turns a database outage into an OOM kill of the gateway.
// What makes it acceptable is that the drop is COUNTED: a log with silent gaps
// invites an operator to conclude that traffic they cannot find never happened.
func TestAFullBufferDropsAndCounts(t *testing.T) {
	// A recorder with no reader: nothing drains the channel, so the buffer
	// fills and every record past it must be dropped rather than block.
	recorder := &Recorder{
		records: make(chan Record, 2),
		sink:    &captureSink{},
		logger:  quietLogger(),
		now:     time.Now,
		done:    make(chan struct{}),
		stopped: make(chan struct{}),
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		for range 100 {
			recorder.Record(Record{Route: "/llm/v1/chat/completions"})
		}
	}()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Record blocked on a full buffer; it must never block the request path")
	}

	if recorder.Dropped() != 98 {
		t.Errorf("dropped = %d, want 98 (100 sent, 2 buffered)", recorder.Dropped())
	}
}

// TestAFailedWriteIsCountedAndTheBatchIsNotRetried.
//
// Retrying in front of a database that is refusing writes is how the buffer
// fills and starts dropping the NEWER records — the ones describing the
// incident in progress. The failure is counted instead.
func TestAFailedWriteIsCountedAndTheBatchIsNotRetried(t *testing.T) {
	sink := &captureSink{err: errors.New("relation does not exist")}
	recorder := New(sink, quietLogger())

	recorder.Record(Record{Route: "/llm/v1/chat/completions"})
	recorder.Stop(context.Background())

	if recorder.Failed() != 1 {
		t.Errorf("failed = %d, want 1", recorder.Failed())
	}
	if recorder.Written() != 0 {
		t.Errorf("written = %d, want 0", recorder.Written())
	}
}

// TestANilRecorderIsAWorkingNoOp — the gateway supports running with no
// database, and every call site would otherwise need a branch.
func TestANilRecorderIsAWorkingNoOp(t *testing.T) {
	var recorder *Recorder
	recorder.Record(Record{Route: "/llm/v1/chat/completions"})
	recorder.Stop(context.Background())
	if recorder.Dropped() != 0 || recorder.Written() != 0 || recorder.Failed() != 0 {
		t.Error("a nil recorder reported activity")
	}
	if New(nil, quietLogger()) != nil {
		t.Error("New(nil sink) must yield a nil recorder")
	}
}

/* ── the middleware ────────────────────────────────────────────────────── */

// serveThrough runs one request through the middleware and returns the record.
func serveThrough(t *testing.T, handler http.HandlerFunc, request *http.Request) Record {
	t.Helper()
	sink := &captureSink{}
	recorder := New(sink, quietLogger())

	router := chi.NewRouter()
	router.Use(Middleware(recorder))
	router.Post("/llm/v1/chat/completions", handler)
	router.NotFound(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})

	router.ServeHTTP(httptest.NewRecorder(), request)
	recorder.Stop(context.Background())

	records := sink.records()
	if len(records) != 1 {
		t.Fatalf("recorded %d requests, want exactly 1", len(records))
	}
	return records[0]
}

// TestTheMiddlewareRecordsTheTransportFacts.
func TestTheMiddlewareRecordsTheTransportFacts(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions?key=SECRET", nil)
	request.Header.Set(headerProjectID, "7")
	request.Header.Set(headerUserID, "42")

	record := serveThrough(t, func(w http.ResponseWriter, r *http.Request) {
		FromContext(r.Context()).SetModel("openai", "gpt-4o")
		FromContext(r.Context()).SetTokens(100, 20)
		w.WriteHeader(http.StatusOK)
	}, request)

	if record.ProjectID != "7" || record.UserID != "42" {
		t.Errorf("identity = %q/%q, want 7/42", record.ProjectID, record.UserID)
	}
	if record.Status != http.StatusOK {
		t.Errorf("status = %d, want 200", record.Status)
	}
	if record.Provider != "openai" || record.Model != "gpt-4o" {
		t.Errorf("model = %q/%q, want openai/gpt-4o", record.Provider, record.Model)
	}
	if record.PromptToks != 100 || record.OutputToks != 20 {
		t.Errorf("tokens = %d/%d, want 100/20", record.PromptToks, record.OutputToks)
	}
	// THE ROUTE PATTERN, NOT THE URL. The raw URL carries a query string, which
	// is another place a caller can put a secret — here literally.
	if record.Route != "/llm/v1/chat/completions" {
		t.Errorf("route = %q, want the pattern", record.Route)
	}
	if record.Route == request.URL.RequestURI() {
		t.Error("the raw URL was stored")
	}
}

// TestAnImplicitOKIsRecordedAsTwoHundred — a handler that writes a body without
// calling WriteHeader. Recording 0 would make every successful buffered
// response look like a request that never answered.
func TestAnImplicitOKIsRecordedAsTwoHundred(t *testing.T) {
	record := serveThrough(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true}`))
	}, httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions", nil))

	if record.Status != http.StatusOK {
		t.Errorf("status = %d, want 200", record.Status)
	}
}

// TestAnUnmatchedRouteIsStillRecorded.
//
// The requests that never reach a handler are frequently the interesting ones —
// "something is hammering a route that does not exist" is a question a log
// exists to answer, and per-handler recording could not see it at all.
func TestAnUnmatchedRouteIsStillRecorded(t *testing.T) {
	record := serveThrough(t, func(http.ResponseWriter, *http.Request) {},
		httptest.NewRequest(http.MethodGet, "/llm/v1/nope", nil))

	if record.Status != http.StatusNotFound {
		t.Errorf("status = %d, want 404", record.Status)
	}
	// A column of blanks would make a 404 flood illegible as one thing.
	if record.Route != "(unmatched)" {
		t.Errorf("route = %q, want the unmatched marker", record.Route)
	}
}

// TestTheErrorClassificationIsResolvedInPrecedenceOrder.
func TestTheErrorClassificationIsResolvedInPrecedenceOrder(t *testing.T) {
	// The handler's explicit code wins.
	explicit := serveThrough(t, func(w http.ResponseWriter, r *http.Request) {
		FromContext(r.Context()).SetError("budget_exceeded")
		w.WriteHeader(http.StatusPaymentRequired)
	}, httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions", nil))
	if explicit.ErrorCode != "budget_exceeded" {
		t.Errorf("error_code = %q, want the handler's own", explicit.ErrorCode)
	}

	// Then whatever the error writer captured.
	captured := serveThrough(t, func(w http.ResponseWriter, _ *http.Request) {
		if sink, ok := w.(ErrorCodeSetter); ok {
			sink.SetErrorCode("permission_error")
		}
		w.WriteHeader(http.StatusForbidden)
	}, httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions", nil))
	if captured.ErrorCode != "permission_error" {
		t.Errorf("error_code = %q, want the writer's", captured.ErrorCode)
	}

	// A failure that took neither path is still legible AS a failure.
	bare := serveThrough(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}, httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions", nil))
	if bare.ErrorCode != "server_error" {
		t.Errorf("error_code = %q, want a status-derived bucket", bare.ErrorCode)
	}

	// And a success carries none.
	fine := serveThrough(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}, httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions", nil))
	if fine.ErrorCode != "" {
		t.Errorf("error_code = %q on a 200", fine.ErrorCode)
	}
}

// TestTheWrapperDoesNotBreakStreaming is the regression this middleware could
// most easily have caused.
//
// The gateway's SSE path reaches for http.Flusher through the writer it is
// handed. A wrapper that does not expose the original silently removes it, and
// the symptom is a chat that buffers to the end instead of streaming — on the
// product's most visible path, with no error anywhere.
func TestTheWrapperDoesNotBreakStreaming(t *testing.T) {
	var flushable, hijackable, unwrappable bool

	router := chi.NewRouter()
	router.Use(Middleware(New(&captureSink{}, quietLogger())))
	router.Post("/llm/v1/chat/completions", func(w http.ResponseWriter, _ *http.Request) {
		_, flushable = w.(http.Flusher)
		_, hijackable = w.(http.Hijacker)
		_, unwrappable = w.(interface{ Unwrap() http.ResponseWriter })
		w.WriteHeader(http.StatusOK)
	})

	router.ServeHTTP(httptest.NewRecorder(),
		httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions", nil))

	// http.Flusher is REQUIRED, not merely preferred, and an earlier version of
	// this test accepted Unwrap as a substitute — which is wrong and hid a real
	// break. `beginStream` asserts `w.(http.Flusher)` DIRECTLY and answers 500
	// "streaming unsupported" when it fails; a direct assertion never consults
	// Unwrap. Without Flush forwarded, every streamed chat request 500s.
	if !flushable {
		t.Error("the wrapper does not implement http.Flusher; beginStream would answer " +
			"500 'streaming unsupported' for every streamed request")
	}
	// The realtime route upgrades a WebSocket, and websocket.Accept reaches for
	// http.Hijacker the same way.
	if !hijackable {
		t.Error("the wrapper does not implement http.Hijacker; every realtime upgrade would fail")
	}
	if !unwrappable {
		t.Error("the wrapper does not expose Unwrap; ResponseController cannot reach the real writer")
	}
}

// TestTheWrapperSatisfiesTheGatewaysOwnStreamingPrecondition runs the exact
// check beginStream runs, rather than a paraphrase of it.
//
// The test above asserts the capability; this one asserts the CALL SITE's
// question, so a change to how the gateway tests for flushability is caught
// here rather than in production.
func TestTheWrapperSatisfiesTheGatewaysOwnStreamingPrecondition(t *testing.T) {
	var streamable bool

	router := chi.NewRouter()
	router.Use(Middleware(New(&captureSink{}, quietLogger())))
	router.Post("/llm/v1/chat/completions", func(w http.ResponseWriter, _ *http.Request) {
		// Verbatim from llmproxy.beginStream.
		if _, ok := w.(http.Flusher); !ok {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		streamable = true
		w.WriteHeader(http.StatusOK)
	})

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions", nil))

	if !streamable || response.Code != http.StatusOK {
		t.Fatalf("the gateway's own streaming precondition failed through the middleware "+
			"(status %d) — chat would break on every deployment", response.Code)
	}
}

// TestARecordIsWrittenEvenWhenTheHandlerPanics — a panic is when a log matters
// most, and the record is emitted from a defer so it survives one.
func TestARecordIsWrittenEvenWhenTheHandlerPanics(t *testing.T) {
	sink := &captureSink{}
	recorder := New(sink, quietLogger())

	router := chi.NewRouter()
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() { _ = recover() }()
			next.ServeHTTP(w, r)
		})
	})
	router.Use(Middleware(recorder))
	router.Post("/llm/v1/chat/completions", func(http.ResponseWriter, *http.Request) {
		panic("boom")
	})

	router.ServeHTTP(httptest.NewRecorder(),
		httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions", nil))
	recorder.Stop(context.Background())

	if len(sink.records()) != 1 {
		t.Fatalf("recorded %d requests through a panic, want 1", len(sink.records()))
	}
}

// TestNoRecorderMeansNoWrapper — a deployment without a log pays nothing, not
// even the wrapper's allocation.
func TestNoRecorderMeansNoWrapper(t *testing.T) {
	var handed http.ResponseWriter
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { handed = w })
	wrapped := Middleware(nil)(inner)

	original := httptest.NewRecorder()
	wrapped.ServeHTTP(original, httptest.NewRequest(http.MethodGet, "/", nil))

	if handed != http.ResponseWriter(original) {
		t.Error("a nil recorder still wrapped the ResponseWriter")
	}
}

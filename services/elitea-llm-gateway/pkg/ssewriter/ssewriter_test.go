package ssewriter

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNew_SetsSSEHeaders(t *testing.T) {
	rec := httptest.NewRecorder()
	sw, err := New(rec)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if sw == nil {
		t.Fatal("New returned nil writer")
	}
	h := rec.Header()
	checks := map[string]string{
		"Content-Type":      "text/event-stream",
		"Cache-Control":     "no-cache",
		"Connection":        "keep-alive",
		"X-Accel-Buffering": "no",
	}
	for k, want := range checks {
		if got := h.Get(k); got != want {
			t.Errorf("header %s = %q, want %q", k, got, want)
		}
	}
}

func TestData_Framing(t *testing.T) {
	rec := httptest.NewRecorder()
	sw, _ := New(rec)
	if err := sw.Data(`{"x":1}`); err != nil {
		t.Fatalf("Data: %v", err)
	}
	if got := rec.Body.String(); got != "data: {\"x\":1}\n\n" {
		t.Errorf("Data frame = %q", got)
	}
}

func TestEvent_Framing(t *testing.T) {
	rec := httptest.NewRecorder()
	sw, _ := New(rec)
	if err := sw.Event("message_start", `{"type":"message_start"}`); err != nil {
		t.Fatalf("Event: %v", err)
	}
	got := rec.Body.String()
	if !strings.HasPrefix(got, "event: message_start\n") {
		t.Errorf("missing event line: %q", got)
	}
	if !strings.HasSuffix(got, "data: {\"type\":\"message_start\"}\n\n") {
		t.Errorf("missing data line: %q", got)
	}
}

func TestEvent_EmptyNameIsDataOnly(t *testing.T) {
	rec := httptest.NewRecorder()
	sw, _ := New(rec)
	_ = sw.Event("", "payload")
	if got := rec.Body.String(); got != "data: payload\n\n" {
		t.Errorf("empty-event frame = %q, want data-only", got)
	}
}

func TestRaw_WritesVerbatim(t *testing.T) {
	rec := httptest.NewRecorder()
	sw, _ := New(rec)
	frame := "event: error\ndata: {\"type\":\"error\"}\n\n"
	if err := sw.Raw(frame); err != nil {
		t.Fatalf("Raw: %v", err)
	}
	if got := rec.Body.String(); got != frame {
		t.Errorf("Raw frame = %q, want %q", got, frame)
	}
}

func TestNew_FlushesEachWrite(t *testing.T) {
	fw := &flushCountWriter{ResponseRecorder: httptest.NewRecorder()}
	sw, err := New(fw)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	_ = sw.Data("a")
	_ = sw.Event("e", "b")
	_ = sw.Raw("raw\n\n")
	if fw.flushes != 3 {
		t.Errorf("flush count = %d, want 3 (one per write)", fw.flushes)
	}
}

func TestNew_NonFlusherErrors(t *testing.T) {
	if _, err := New(&plainWriter{}); err == nil {
		t.Error("New should error when writer does not implement http.Flusher")
	}
}

// flushCountWriter wraps a recorder and counts Flush calls, proving each SSE
// write flushes incrementally rather than buffering to end-of-response.
type flushCountWriter struct {
	*httptest.ResponseRecorder
	flushes int
}

func (f *flushCountWriter) Flush() { f.flushes++ }

// plainWriter implements http.ResponseWriter but NOT http.Flusher.
type plainWriter struct{ h http.Header }

func (p *plainWriter) Header() http.Header {
	if p.h == nil {
		p.h = http.Header{}
	}
	return p.h
}
func (p *plainWriter) Write(b []byte) (int, error) { return len(b), nil }
func (p *plainWriter) WriteHeader(int)             {}

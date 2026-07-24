package llmproxy

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
)

// disconnectWriter is an http.ResponseWriter + http.Flusher whose Write fails
// after the response headers are committed, simulating a client that hangs up
// mid-stream. The SSE loops must observe the write error and return without
// panicking or looping forever (the "client disconnected" branch).
type disconnectWriter struct {
	header  http.Header
	status  int
	writes  int
	flushes int
}

func (d *disconnectWriter) Header() http.Header {
	if d.header == nil {
		d.header = http.Header{}
	}
	return d.header
}

func (d *disconnectWriter) Write(p []byte) (int, error) {
	d.writes++
	return 0, errors.New("connection reset by peer")
}

func (d *disconnectWriter) WriteHeader(status int) { d.status = status }
func (d *disconnectWriter) Flush()                 { d.flushes++ }

// TestStreamOpenAI_ClientDisconnect drives streamOpenAI against a writer that
// errors on the first chunk write; the loop must return on the write error
// rather than continuing to marshal/write subsequent chunks.
//
// The channel is pre-filled and closed (no separate producer goroutine): c2 is
// buffered and never consumed because the loop exits after the first write error.
// This exercises the "client disconnected" early-return branch without needing a
// live goroutine, since the SSE loop (`for chunk := range ch`) ranges over the
// pre-filled closed channel and returns on the first write failure.
func TestStreamOpenAI_ClientDisconnect(t *testing.T) {
	// Two chunks in a buffered, pre-closed channel. The first write fails and the
	// loop returns; c2 is never consumed (remains buffered) — that is the expected
	// behaviour. `writes == 1` is the authoritative assertion.
	chunks := newChunkChan(
		&schemas.BifrostStreamChunk{BifrostChatResponse: &schemas.BifrostChatResponse{ID: "c1"}},
		&schemas.BifrostStreamChunk{BifrostChatResponse: &schemas.BifrostChatResponse{ID: "c2"}},
	)
	fake := &fakeRouter{streamChan: chunks}
	h := NewHandler(fake, nil, nil)

	w := &disconnectWriter{}
	req := httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions",
		strings.NewReader(`{"model":"gpt-4o","messages":[],"stream":true}`))
	req.Header.Set("Content-Type", "application/json")
	h.Chat(w, req)

	if w.writes != 1 {
		t.Fatalf("writes = %d, want 1 (loop must stop on the first write error)", w.writes)
	}
}

// TestStreamOpenAI_SkipsNilChunk feeds a nil chunk between two real chunks; the
// nil must be skipped and both real chunks + [DONE] delivered.
func TestStreamOpenAI_SkipsNilChunk(t *testing.T) {
	chunks := newChunkChan(
		&schemas.BifrostStreamChunk{BifrostChatResponse: &schemas.BifrostChatResponse{ID: "c1"}},
		nil,
		&schemas.BifrostStreamChunk{BifrostChatResponse: &schemas.BifrostChatResponse{ID: "c2"}},
	)
	fake := &fakeRouter{streamChan: chunks}
	h := NewHandler(fake, nil, nil)

	rec := postJSON(t, h.route(), "/llm/v1/chat/completions",
		`{"model":"gpt-4o","messages":[],"stream":true}`)
	body := rec.Body.String()
	for _, want := range []string{`"id":"c1"`, `"id":"c2"`, "data: [DONE]"} {
		if !strings.Contains(body, want) {
			t.Errorf("stream body missing %q; got:\n%s", want, body)
		}
	}
	// Exactly two data chunks + DONE — the nil contributed no frame.
	if n := strings.Count(body, "data: "); n != 3 {
		t.Errorf("data frame count = %d, want 3 (nil chunk must be skipped)", n)
	}
}

// TestStreamResponses_ClientDisconnect drives the OpenAI Responses SSE loop
// against a failing writer.
func TestStreamResponses_ClientDisconnect(t *testing.T) {
	chunks := newChunkChan(&schemas.BifrostStreamChunk{
		BifrostResponsesStreamResponse: &schemas.BifrostResponsesStreamResponse{
			Type:     schemas.ResponsesStreamResponseTypeCreated,
			Response: &schemas.BifrostResponsesResponse{ID: strPtr("resp-1")},
		},
	})
	fake := &fakeRouter{streamChan: chunks}
	h := NewHandler(fake, nil, nil)

	w := &disconnectWriter{}
	req := httptest.NewRequest(http.MethodPost, "/llm/v1/responses",
		strings.NewReader(`{"model":"gpt-4o","input":"hi","stream":true}`))
	req.Header.Set("Content-Type", "application/json")
	h.Responses(w, req)

	if w.writes != 1 {
		t.Fatalf("writes = %d, want 1 (loop must stop on write error)", w.writes)
	}
}

// TestStreamResponses_SkipsNilAndEmptyChunks covers the two continue branches:
// a nil chunk and a chunk whose BifrostResponsesStreamResponse is nil (neither
// an error nor a payload) must both be skipped, leaving only the real event.
func TestStreamResponses_SkipsNilAndEmptyChunks(t *testing.T) {
	chunks := newChunkChan(
		nil,
		&schemas.BifrostStreamChunk{}, // non-nil chunk, nil sub-response
		&schemas.BifrostStreamChunk{BifrostResponsesStreamResponse: &schemas.BifrostResponsesStreamResponse{
			Type:     schemas.ResponsesStreamResponseTypeCreated,
			Response: &schemas.BifrostResponsesResponse{ID: strPtr("resp-1")},
		}},
	)
	fake := &fakeRouter{streamChan: chunks}
	h := NewHandler(fake, nil, nil)

	rec := postJSON(t, h.route(), "/llm/v1/responses",
		`{"model":"gpt-4o","input":"hi","stream":true}`)
	body := rec.Body.String()
	if n := strings.Count(body, "event: "); n != 1 {
		t.Errorf("event frame count = %d, want 1 (nil + empty chunks must be skipped)", n)
	}
	if strings.Contains(body, "[DONE]") {
		t.Errorf("responses stream must not emit [DONE]; got:\n%s", body)
	}
}

// TestStreamAnthropic_ClientDisconnect drives the Anthropic SSE loop against a
// failing writer; the per-event write error must end the loop.
func TestStreamAnthropic_ClientDisconnect(t *testing.T) {
	chunks := newChunkChan(&schemas.BifrostStreamChunk{
		BifrostResponsesStreamResponse: &schemas.BifrostResponsesStreamResponse{
			Type:     schemas.ResponsesStreamResponseTypeCreated,
			Response: &schemas.BifrostResponsesResponse{ID: strPtr("resp-1"), Model: "claude-3-5-sonnet"},
		},
	})
	fake := &fakeRouter{streamChan: chunks}
	h := NewHandler(fake, nil, nil)

	w := &disconnectWriter{}
	req := httptest.NewRequest(http.MethodPost, "/llm/v1/messages",
		strings.NewReader(`{"model":"claude-3-5-sonnet","max_tokens":10,"messages":[],"stream":true}`))
	req.Header.Set("Content-Type", "application/json")
	h.Messages(w, req)

	if w.writes == 0 {
		t.Fatalf("writes = 0, want >=1 (a message_start event must be attempted)")
	}
}

// TestStreamAnthropic_SkipsNilAndNonEventChunks covers the skip branches: a nil
// chunk, and a chunk whose Responses type converts to zero Anthropic events
// (ResponsesStreamResponseTypeInProgress → no message_* event), must both be
// skipped without emitting a frame; the trailing Created chunk yields one
// message_start.
func TestStreamAnthropic_SkipsNilAndNonEventChunks(t *testing.T) {
	chunks := newChunkChan(
		nil,
		&schemas.BifrostStreamChunk{}, // nil sub-response
		&schemas.BifrostStreamChunk{BifrostResponsesStreamResponse: &schemas.BifrostResponsesStreamResponse{
			Type: schemas.ResponsesStreamResponseTypeInProgress, // converts to zero events
		}},
		&schemas.BifrostStreamChunk{BifrostResponsesStreamResponse: &schemas.BifrostResponsesStreamResponse{
			Type:     schemas.ResponsesStreamResponseTypeCreated,
			Response: &schemas.BifrostResponsesResponse{ID: strPtr("resp-1")},
		}},
	)
	fake := &fakeRouter{streamChan: chunks}
	h := NewHandler(fake, nil, nil)

	rec := postJSON(t, h.route(), "/llm/v1/messages",
		`{"model":"claude-3-5-sonnet","max_tokens":10,"messages":[],"stream":true}`)
	body := rec.Body.String()
	if !strings.Contains(body, "event: ") {
		t.Errorf("anthropic stream missing event frame; got:\n%s", body)
	}
	if strings.Contains(body, "[DONE]") {
		t.Errorf("anthropic stream must not emit [DONE]; got:\n%s", body)
	}
}

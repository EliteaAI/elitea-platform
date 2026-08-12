// Package ssewriter provides a helper for writing Server-Sent Events (SSE).
package ssewriter

import (
	"fmt"
	"net/http"
)

// maxUnwrapDepth bounds the Unwrap walk. A middleware chain that is 16 wrappers
// deep, or one that returns itself from Unwrap, is a bug — refuse rather than
// loop.
const maxUnwrapDepth = 16

// Writer wraps an http.ResponseWriter and provides SSE-specific write methods.
type Writer struct {
	w          http.ResponseWriter
	controller *http.ResponseController
}

// New returns a Writer for the given ResponseWriter. It sets the required SSE
// headers. Returns an error if the writer does not support flushing.
//
// Flushing goes through http.ResponseController rather than a direct
// `w.(http.Flusher)` assertion. That assertion is what made this package
// unusable behind the router's own middleware: apimw.OtelMiddleware wraps every
// response in a statusRecorder that embeds the http.ResponseWriter INTERFACE,
// so only ResponseWriter's three methods are promoted and the Flusher assertion
// fails — even though the underlying writer flushes fine and statusRecorder
// implements Unwrap() precisely so this would work. The observable was a 500
// "streaming not supported" on /api/v2/events/prompt_lib/{projectID} the moment
// that route was first mounted (#152). ResponseController follows Unwrap;
// notifications/events.go already streams this way.
func New(w http.ResponseWriter) (*Writer, error) {
	if w == nil || !supportsFlush(w) {
		return nil, fmt.Errorf("ssewriter: streaming not supported")
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	return &Writer{w: w, controller: http.NewResponseController(w)}, nil
}

// supportsFlush reports whether w, or anything it unwraps to, can flush. Kept as
// an explicit pre-flight so New still REFUSES a genuinely unflushable writer
// (e.g. httptest with a buffering wrapper) instead of accepting it and failing
// on the first event, which would leave the client holding an open, silent
// stream.
func supportsFlush(w http.ResponseWriter) bool {
	for depth := 0; depth < maxUnwrapDepth && w != nil; depth++ {
		if _, ok := w.(interface{ FlushError() error }); ok {
			return true
		}
		if _, ok := w.(http.Flusher); ok {
			return true
		}
		unwrapper, ok := w.(interface{ Unwrap() http.ResponseWriter })
		if !ok {
			return false
		}
		next := unwrapper.Unwrap()
		if next == w {
			return false
		}
		w = next
	}
	return false
}

// Event writes a named SSE event with data payload and flushes immediately.
func (s *Writer) Event(event, data string) error {
	if event != "" {
		if _, err := fmt.Fprintf(s.w, "event: %s\n", event); err != nil {
			return err
		}
	}
	if _, err := fmt.Fprintf(s.w, "data: %s\n\n", data); err != nil {
		return err
	}
	return s.controller.Flush()
}

// Data writes a data-only SSE event (no event: field) and flushes.
func (s *Writer) Data(data string) error {
	return s.Event("", data)
}

// Comment writes an SSE comment line (ignored by clients) and flushes.
// Useful as a heartbeat to keep connections alive.
func (s *Writer) Comment(comment string) error {
	if _, err := fmt.Fprintf(s.w, ": %s\n\n", comment); err != nil {
		return err
	}
	return s.controller.Flush()
}

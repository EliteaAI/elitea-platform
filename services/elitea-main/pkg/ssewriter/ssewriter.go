// Package ssewriter provides a helper for writing Server-Sent Events (SSE).
package ssewriter

import (
	"fmt"
	"net/http"
)

// Writer wraps an http.ResponseWriter and provides SSE-specific write methods.
type Writer struct {
	w       http.ResponseWriter
	flusher http.Flusher
}

// New returns a Writer for the given ResponseWriter. It sets the required SSE
// headers. Returns an error if the writer does not support flushing.
func New(w http.ResponseWriter) (*Writer, error) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return nil, fmt.Errorf("ssewriter: streaming not supported")
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	return &Writer{w: w, flusher: flusher}, nil
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
	s.flusher.Flush()
	return nil
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
	s.flusher.Flush()
	return nil
}

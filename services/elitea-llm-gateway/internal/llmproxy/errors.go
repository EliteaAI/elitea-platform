package llmproxy

import (
	"errors"
	"fmt"
)

// errStreamingUnsupported is returned by beginStream when the ResponseWriter
// does not implement http.Flusher, so the SSE loop cannot flush per chunk.
var errStreamingUnsupported = errors.New("streaming unsupported: response writer is not an http.Flusher")

// errRequired is returned when a required multipart field is missing or empty.
func errRequired(field string) error {
	return fmt.Errorf("%s field is required", field)
}

// wrapInvalid is returned when a multipart field cannot be parsed to its type.
func wrapInvalid(field string) error {
	return fmt.Errorf("invalid %s value", field)
}

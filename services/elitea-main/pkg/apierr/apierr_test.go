package apierr

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestWriteStatusLabelsTheBodyAsJSON gates the media type of an error response.
//
// THE DEFECT. 118 handler call sites wrote `{"error":"..."}` through
// http.Error, which hardcodes `Content-Type: text/plain; charset=utf-8`. A live
// deployment answered GET /api/v2/social/author with application/json and the
// 403 from /api/v2/configurations/configurations/1 with text/plain, so one API
// gave two media types for the same body shape.
func TestWriteStatusLabelsTheBodyAsJSON(t *testing.T) {
	recorder := httptest.NewRecorder()
	WriteStatus(recorder, http.StatusForbidden, "insufficient permissions")

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", got)
	}
	// http.Error sets nosniff. Losing it would let a browser sniff the body.
	if got := recorder.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", got)
	}

	var decoded Response
	if err := json.Unmarshal(recorder.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("body %q is not JSON: %v", recorder.Body.String(), err)
	}
	if decoded.Error != "insufficient permissions" {
		t.Fatalf("error = %q, want %q", decoded.Error, "insufficient permissions")
	}
}

// TestWriteStatusKeepsTheBodyBytesOfHTTPError proves the migration off
// http.Error changed no response body. http.Error appends one newline, and
// json.Encoder.Encode appends one too, so a caller that reads the body as text
// sees the same bytes it saw before.
func TestWriteStatusKeepsTheBodyBytesOfHTTPError(t *testing.T) {
	before := httptest.NewRecorder()
	http.Error(before, `{"error":"insufficient permissions"}`, http.StatusForbidden)

	after := httptest.NewRecorder()
	WriteStatus(after, http.StatusForbidden, "insufficient permissions")

	if before.Body.String() != after.Body.String() {
		t.Fatalf("body changed: http.Error = %q, WriteStatus = %q",
			before.Body.String(), after.Body.String())
	}
}

// TestWriteUsesTheSameMediaType keeps the two writers in this package agreed.
func TestWriteUsesTheSameMediaType(t *testing.T) {
	recorder := httptest.NewRecorder()
	Write(recorder, Forbidden("token belongs to another user"))

	if got := recorder.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", got)
	}
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
}

package audit

import (
	"strings"
	"testing"
	"time"
)

// A value longer than its column makes PostgreSQL refuse the whole INSERT with
// 22001 — and, batched, every row batched with it. Truncation here is what
// keeps one over-long action from losing 64 unrelated audit rows.
func TestNormalizeClampsEveryColumnToItsDeclaredWidth(t *testing.T) {
	event := normalize(Event{
		EventType:    strings.Repeat("e", 100),
		Action:       strings.Repeat("a", 900),
		HTTPMethod:   strings.Repeat("M", 30),
		HTTPRoute:    strings.Repeat("/", 900),
		UserEmail:    strings.Repeat("u", 400),
		EntityType:   strings.Repeat("t", 100),
		EntityName:   strings.Repeat("n", 400),
		TraceID:      strings.Repeat("f", 64),
		SpanID:       strings.Repeat("f", 32),
		ParentSpanID: strings.Repeat("f", 32),
	})

	for _, check := range []struct {
		column string
		value  string
		limit  int
	}{
		{"event_type", event.EventType, maxEventType},
		{"action", event.Action, maxAction},
		{"http_method", event.HTTPMethod, maxHTTPMethod},
		{"http_route", event.HTTPRoute, maxHTTPRoute},
		{"user_email", event.UserEmail, maxUserEmail},
		{"entity_type", event.EntityType, maxEntityType},
		{"entity_name", event.EntityName, maxEntityName},
		{"trace_id", event.TraceID, maxTraceID},
		{"span_id", event.SpanID, maxSpanID},
		{"parent_span_id", event.ParentSpanID, maxParentSpanID},
	} {
		if len(check.value) != check.limit {
			t.Errorf("%s clamped to %d bytes, want %d", check.column, len(check.value), check.limit)
		}
	}
}

// Cutting a multi-byte character in half produces invalid UTF-8, which
// PostgreSQL rejects outright — turning an over-long value into exactly the
// lost row the clamp exists to prevent.
func TestClampCutsOnRuneBoundaries(t *testing.T) {
	// 20 three-byte runes = 60 bytes, clamped to a 32-byte column.
	clamped := clamp(strings.Repeat("日", 20), maxEventType)
	if len(clamped) > maxEventType {
		t.Fatalf("clamped to %d bytes, want <= %d", len(clamped), maxEventType)
	}
	if !isValidUTF8(clamped) {
		t.Fatalf("clamp produced invalid UTF-8: %q", clamped)
	}
	if clamped != strings.Repeat("日", 10) {
		t.Fatalf("clamped = %q, want 10 whole runes", clamped)
	}
}

func isValidUTF8(value string) bool {
	for _, r := range value {
		if r == '�' {
			return false
		}
	}
	return true
}

// The two NOT NULL columns with no database default must never reach the
// INSERT empty: a NULL there fails the row, and an empty event_type would also
// be filtered out by every tab the SPA offers.
func TestNormalizeFillsTheNotNullColumns(t *testing.T) {
	event := normalize(Event{})
	if event.EventType != "api" {
		t.Errorf("event_type = %q, want the api default", event.EventType)
	}
	if event.Action == "" {
		t.Error("action is empty; the column is NOT NULL")
	}
	if event.Timestamp.IsZero() {
		t.Error("timestamp is zero")
	}
	if time.Since(event.Timestamp) > time.Minute {
		t.Errorf("timestamp = %v, want roughly now", event.Timestamp)
	}
}

// A nil recorder is a working no-op: a composition without a database must
// record nothing rather than panic on its first administrative request. This is
// the typed-nil shape that took /healthz down once already.
func TestNilRecorderIsAWorkingNoOp(t *testing.T) {
	recorder := NewPostgresRecorder(nil, nil)
	if recorder != nil {
		t.Fatal("NewPostgresRecorder(nil) returned a live recorder")
	}
	recorder.Record(t.Context(), Event{Action: "x"})
	if err := recorder.Flush(t.Context()); err != nil {
		t.Fatalf("Flush on a nil recorder: %v", err)
	}
	if err := recorder.Close(t.Context()); err != nil {
		t.Fatalf("Close on a nil recorder: %v", err)
	}
	if dropped := recorder.Dropped(); dropped != 0 {
		t.Fatalf("Dropped = %d on a nil recorder", dropped)
	}
}

// An unaudited request must reach a handler that annotates unconditionally,
// unchanged — and cost nothing.
func TestAnnotateWithoutASlotIsHarmless(t *testing.T) {
	Annotate(t.Context(), Annotation{Action: "x", EntityID: ID(1)})
}

func TestAnnotationOverwritesOnlyWhatItSets(t *testing.T) {
	ctx, slot := ContextWithAnnotationSlot(t.Context())
	Annotate(ctx, Annotation{Action: "user.suspend", EntityType: "user"})
	Annotate(ctx, Annotation{EntityID: ID(42)})

	annotation, present := slot.Read()
	if !present {
		t.Fatal("the slot reports no annotation after two writes")
	}
	if annotation.Action != "user.suspend" {
		t.Errorf("action = %q; the second call cleared it", annotation.Action)
	}
	if annotation.EntityType != "user" {
		t.Errorf("entity_type = %q; the second call cleared it", annotation.EntityType)
	}
	if annotation.EntityID == nil || *annotation.EntityID != 42 {
		t.Errorf("entity_id = %v, want 42", annotation.EntityID)
	}
}

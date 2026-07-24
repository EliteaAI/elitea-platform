package bifrostlog

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
)

func newTestAdapter(t *testing.T) (*Adapter, *bytes.Buffer, *slog.LevelVar) {
	t.Helper()
	var buf bytes.Buffer
	level := new(slog.LevelVar)
	level.Set(slog.LevelDebug)
	logger := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: level}))
	return New(logger, level), &buf, level
}

func TestAdapterSatisfiesLoggerInterface(t *testing.T) {
	var _ schemas.Logger = New(slog.Default(), new(slog.LevelVar))
}

func TestLevelMethodsEmit(t *testing.T) {
	cases := []struct {
		name string
		fn   func(a *Adapter)
		want string
	}{
		{"debug", func(a *Adapter) { a.Debug("d", "k", "v") }, "DEBUG"},
		{"info", func(a *Adapter) { a.Info("i") }, "INFO"},
		{"warn", func(a *Adapter) { a.Warn("w") }, "WARN"},
		{"error", func(a *Adapter) { a.Error("e") }, "ERROR"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a, buf, _ := newTestAdapter(t)
			tc.fn(a)
			if !strings.Contains(buf.String(), tc.want) {
				t.Errorf("output %q missing level %q", buf.String(), tc.want)
			}
		})
	}
}

func TestFatalDoesNotExitAndLogsError(t *testing.T) {
	// The whole point: Fatal must NOT terminate the process (unlike bifrost's
	// DefaultLogger). Reaching the assertion proves it returned.
	a, buf, _ := newTestAdapter(t)
	a.Fatal("boom", "reason", "test")

	var rec map[string]any
	if err := json.Unmarshal(buf.Bytes(), &rec); err != nil {
		t.Fatalf("log line is not JSON: %v (%q)", err, buf.String())
	}
	if rec["level"] != "ERROR" {
		t.Errorf("Fatal logged at level %v, want ERROR", rec["level"])
	}
	if rec["fatal"] != true {
		t.Errorf("Fatal record missing fatal=true marker: %v", rec)
	}
}

func TestSetLevelMutatesSharedLevelVar(t *testing.T) {
	a, buf, level := newTestAdapter(t)

	a.SetLevel(schemas.LogLevelError)
	if level.Level() != slog.LevelError {
		t.Fatalf("level = %v, want ERROR", level.Level())
	}
	// Below-threshold record must be suppressed by the handler.
	a.Info("suppressed")
	if strings.Contains(buf.String(), "suppressed") {
		t.Errorf("info logged despite error-only level: %q", buf.String())
	}
	// At-threshold record must appear.
	a.Error("shown")
	if !strings.Contains(buf.String(), "shown") {
		t.Errorf("error not logged at error level: %q", buf.String())
	}
}

func TestSetLevelAllMappings(t *testing.T) {
	a, _, level := newTestAdapter(t)
	for _, tc := range []struct {
		in   schemas.LogLevel
		want slog.Level
	}{
		{schemas.LogLevelDebug, slog.LevelDebug},
		{schemas.LogLevelInfo, slog.LevelInfo},
		{schemas.LogLevelWarn, slog.LevelWarn},
		{schemas.LogLevelError, slog.LevelError},
	} {
		a.SetLevel(tc.in)
		if level.Level() != tc.want {
			t.Errorf("SetLevel(%q) → %v, want %v", tc.in, level.Level(), tc.want)
		}
	}
}

func TestSetLevelNilLevelVarIsSafe(t *testing.T) {
	a := New(slog.Default(), nil)
	// Must not panic when no LevelVar was provided.
	a.SetLevel(schemas.LogLevelDebug)
}

func TestSetOutputTypeIsNoOp(t *testing.T) {
	a, buf, _ := newTestAdapter(t)
	a.SetOutputType(schemas.LoggerOutputTypePretty)
	if buf.Len() != 0 {
		t.Errorf("SetOutputType should not emit output, got %q", buf.String())
	}
}

func TestLogHTTPRequestBuildsStructuredRecord(t *testing.T) {
	a, buf, _ := newTestAdapter(t)

	a.LogHTTPRequest(schemas.LogLevelInfo, "req").
		Str("method", "POST").
		Int("status", 200).
		Int64("bytes", 1234).
		Send()

	var rec map[string]any
	if err := json.Unmarshal(buf.Bytes(), &rec); err != nil {
		t.Fatalf("not JSON: %v (%q)", err, buf.String())
	}
	if rec["msg"] != "req" {
		t.Errorf("msg = %v", rec["msg"])
	}
	if rec["method"] != "POST" {
		t.Errorf("method = %v", rec["method"])
	}
	if rec["status"] != float64(200) {
		t.Errorf("status = %v", rec["status"])
	}
	if rec["bytes"] != float64(1234) {
		t.Errorf("bytes = %v", rec["bytes"])
	}
	if rec["level"] != "INFO" {
		t.Errorf("level = %v", rec["level"])
	}
}

func TestLogHTTPRequestLevelMapping(t *testing.T) {
	for _, tc := range []struct {
		in   schemas.LogLevel
		want string
	}{
		{schemas.LogLevelDebug, "DEBUG"},
		{schemas.LogLevelInfo, "INFO"},
		{schemas.LogLevelWarn, "WARN"},
		{schemas.LogLevelError, "ERROR"},
	} {
		a, buf, _ := newTestAdapter(t)
		a.LogHTTPRequest(tc.in, "m").Send()
		if !strings.Contains(buf.String(), tc.want) {
			t.Errorf("LogHTTPRequest(%q) level %q missing in %q", tc.in, tc.want, buf.String())
		}
	}
}

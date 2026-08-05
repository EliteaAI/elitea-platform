package main

import (
	"net/http"
	"testing"
	"time"
)

// TestArtifactLimitHTTPServerHasNoBodyLevelTimeouts is S12's stand-in for
// "a 300-second download completes" and "a 100 MiB upload over a 30-second
// body succeeds": nothing in this package's test scope can drive a real
// multi-minute HTTP round trip, so this instead proves the server-level
// ReadTimeout/WriteTimeout — which bounded the ENTIRE request/response,
// body included, and previously capped uploads at 10s and downloads at
// 120s regardless of size — are gone. Per-request body deadlines are set
// by the artifact handlers themselves (internal/api/v2/artifacts/objects.go).
func TestArtifactLimitHTTPServerHasNoBodyLevelTimeouts(t *testing.T) {
	srv := newHTTPServer(":0", http.NotFoundHandler())

	if srv.ReadHeaderTimeout != 10*time.Second {
		t.Errorf("ReadHeaderTimeout = %v, want %v", srv.ReadHeaderTimeout, 10*time.Second)
	}
	if srv.ReadTimeout != 0 {
		t.Errorf("ReadTimeout = %v, want 0 (unset) — a nonzero value here bounds the request body again", srv.ReadTimeout)
	}
	if srv.WriteTimeout != 0 {
		t.Errorf("WriteTimeout = %v, want 0 (unset) — a nonzero value here caps every download again", srv.WriteTimeout)
	}
	if srv.IdleTimeout != 60*time.Second {
		t.Errorf("IdleTimeout = %v, want %v", srv.IdleTimeout, 60*time.Second)
	}
}

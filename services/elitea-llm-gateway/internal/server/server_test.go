package server

import (
	"context"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/schemas"

	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/config"
)

func testConfig() config.Config {
	return config.Config{
		HTTPAddr:            "127.0.0.1:0",
		ShutdownTimeout:     150 * time.Second,
		InitialPoolSize:     4,
		ProviderConcurrency: 3,
	}
}

func newTestServer(t *testing.T, account schemas.Account) *Server {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(&nopWriter{}, nil))
	level := new(slog.LevelVar)
	mux := http.NewServeMux()
	srv, err := New(context.Background(), testConfig(), logger, level, account, mux)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return srv
}

type nopWriter struct{}

func (nopWriter) Write(p []byte) (int, error) { return len(p), nil }

func TestNewInitialisesBifrostWithBootstrapAccount(t *testing.T) {
	srv := newTestServer(t, nil) // nil → bootstrap account
	if srv.Core() == nil {
		t.Fatal("Core() is nil after New")
	}
	// Clean up bifrost workers.
	_ = srv.Shutdown(context.Background())
}

func TestNewSetsSSESafeHTTPTimeouts(t *testing.T) {
	srv := newTestServer(t, nil)
	defer func() { _ = srv.Shutdown(context.Background()) }()

	// §9.5: WriteTimeout MUST be 0 (disabled) so SSE streams are not
	// hard-killed by a per-connection write deadline.
	if srv.http.WriteTimeout != 0 {
		t.Errorf("WriteTimeout = %v, want 0 (§9.5)", srv.http.WriteTimeout)
	}
	// A finite ReadHeaderTimeout is expected to bound slow-header attacks.
	if srv.http.ReadHeaderTimeout <= 0 {
		t.Errorf("ReadHeaderTimeout = %v, want > 0", srv.http.ReadHeaderTimeout)
	}
}

func TestShutdownAppliesConfiguredGrace(t *testing.T) {
	srv := newTestServer(t, nil)

	// Server never started ListenAndServe; Shutdown on an unstarted server is
	// a no-op that must still return promptly and release bifrost.
	done := make(chan error, 1)
	go func() { done <- srv.Shutdown(context.Background()) }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Shutdown: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Shutdown did not return promptly")
	}
}

func TestServeAndGracefulShutdown(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(&nopWriter{}, nil))
	level := new(slog.LevelVar)

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	cfg := testConfig()
	srv, err := New(context.Background(), cfg, logger, level, nil, mux)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	errCh := make(chan error, 1)
	go func() { errCh <- srv.ListenAndServe() }()

	// Shut down; ListenAndServe must return nil (graceful).
	time.Sleep(50 * time.Millisecond)
	if err := srv.Shutdown(context.Background()); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}
	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("ListenAndServe returned %v, want nil on graceful shutdown", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("ListenAndServe did not return after Shutdown")
	}
}

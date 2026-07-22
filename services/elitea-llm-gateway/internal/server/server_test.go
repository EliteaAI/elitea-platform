package server

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/schemas"

	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/config"
	natsinfra "github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/infra/nats"
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

// fakeNATS is a stand-in NATSClient recording only whether Close ran; the
// budget methods are unused by the wiring tests and return zero values.
type fakeNATS struct {
	mu     sync.Mutex
	closed bool
}

func (f *fakeNATS) IncrBudget(context.Context, string, int64) (int64, error) { return 0, nil }
func (f *fakeNATS) ReadBudget(context.Context, string) (int64, error)        { return 0, nil }
func (f *fakeNATS) TryAlertCooldown(context.Context, string) (bool, error)   { return false, nil }
func (f *fakeNATS) PublishDelta(context.Context, string, []byte) error       { return nil }
func (f *fakeNATS) Close() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed = true
}
func (f *fakeNATS) isClosed() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.closed
}

func newServerWithConnector(t *testing.T, cfg config.Config, conn natsConnector) *Server {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(&nopWriter{}, nil))
	level := new(slog.LevelVar)
	mux := http.NewServeMux()
	srv, err := New(context.Background(), cfg, logger, level, nil, mux, WithNATSConnector(conn))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return srv
}

func TestNATSDisabledWhenURLUnset(t *testing.T) {
	called := false
	conn := func(context.Context, natsinfra.Config) (NATSClient, error) {
		called = true
		return nil, nil
	}
	// testConfig has no NATSURL → connector must not be called and NATS() is nil.
	srv := newServerWithConnector(t, testConfig(), conn)
	defer func() { _ = srv.Shutdown(context.Background()) }()

	if called {
		t.Error("connector called despite empty NATSURL")
	}
	if srv.NATS() != nil {
		t.Error("NATS() non-nil when disabled")
	}
}

func TestNATSConnectedAndClosedOnShutdown(t *testing.T) {
	fake := &fakeNATS{}
	var gotCfg natsinfra.Config
	conn := func(_ context.Context, c natsinfra.Config) (NATSClient, error) {
		gotCfg = c
		return fake, nil
	}
	cfg := testConfig()
	cfg.NATSURL = "nats://nats:4222"
	cfg.ServiceName = "gw-test"
	cfg.NATSReplicas = 3
	cfg.CBFailureThreshold = 5
	cfg.CBOpenDuration = 20 * time.Second

	srv := newServerWithConnector(t, cfg, conn)

	if srv.NATS() == nil {
		t.Fatal("NATS() nil after successful connect")
	}
	// Config threads through to the nats client verbatim.
	if gotCfg.URL != "nats://nats:4222" || gotCfg.Name != "gw-test" ||
		gotCfg.Replicas != 3 || gotCfg.CBFailureThreshold != 5 || gotCfg.CBOpenDuration != 20*time.Second {
		t.Errorf("connector cfg = %+v, not threaded through", gotCfg)
	}

	if err := srv.Shutdown(context.Background()); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}
	if !fake.isClosed() {
		t.Error("NATS client not closed on shutdown")
	}
}

func TestNATSConnectErrorIsNonFatal(t *testing.T) {
	conn := func(context.Context, natsinfra.Config) (NATSClient, error) {
		return nil, errors.New("dial tcp: connection refused")
	}
	cfg := testConfig()
	cfg.NATSURL = "nats://unreachable:4222"

	// New MUST NOT fail when NATS is unreachable — the FSM owns degraded policy.
	srv := newServerWithConnector(t, cfg, conn)
	defer func() { _ = srv.Shutdown(context.Background()) }()

	if srv.NATS() != nil {
		t.Error("NATS() non-nil after connect error")
	}
}

func TestShutdownNilNATSDoesNotPanic(t *testing.T) {
	// testConfig disables NATS; Shutdown must not panic on the nil client.
	srv := newTestServer(t, nil)
	if err := srv.Shutdown(context.Background()); err != nil {
		t.Fatalf("Shutdown: %v", err)
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

// Command elitea-llm-gateway is the standalone LLM gateway service. It embeds
// bifrost/core and serves the /llm surface as N stateless replicas,
// coordinating shared state through NATS JetStream.
//
// This entrypoint stands up the module on Go 1.26.4 with the §9.5 deployment
// settings (long shutdown drain, disabled SSE write timeout, tuned pools). The
// /llm chi handler is mounted below, and server.New connects the hardened NATS
// budget-path client when GATEWAY_NATS_URL is set (design §8; the connection is
// non-fatal at startup — the tiered-hybrid FSM owns degraded-mode policy). The
// governance store that consumes srv.NATS() is a later BF0.4 subtask.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/api"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/config"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/llmproxy"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/server"
)

func main() {
	cfg := config.FromEnv()

	level := new(slog.LevelVar)
	level.Set(parseLevel(cfg.LogLevel))
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
	slog.SetDefault(logger)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// Base mux with a health endpoint. Passed to the server as its
	// http.Handler; the /llm chi router is mounted below once the embedded
	// bifrost client is available.
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	// account=nil → bootstrap account (zero providers). The vault-backed
	// Account is wired in by BF0.2-account.
	srv, err := server.New(ctx, cfg, logger, level, nil, mux)
	if err != nil {
		slog.Error("failed to initialise gateway", "err", err)
		os.Exit(1)
	}

	// Open the Postgres pool backing the synthetic /llm/v1/models resolver
	// (design §4.2). A configured-but-unreachable database is non-fatal — the
	// /v1/models surface then reports an empty set — so a DB blip cannot stop
	// the gateway from serving inference (which resolves credentials lazily).
	var modelResolver *llmproxy.ModelResolver
	if pool, perr := pgxpool.New(ctx, cfg.DatabaseURL); perr != nil {
		logger.Warn("models resolver disabled: database pool unavailable", "err", perr)
	} else {
		defer pool.Close()
		modelResolver = llmproxy.NewModelResolver(llmproxy.ModelResolverConfig{
			DB:     llmproxy.NewModelPoolQuerier(pool),
			Logger: logger,
		})
	}

	// Mount the /llm dialect surface over the embedded bifrost/core client.
	// ServeMux dispatches by longest-prefix match, so /healthz keeps its own
	// handler while everything under /llm/ routes into the chi router.
	handler := llmproxy.NewHandler(llmproxy.NewBifrostRouter(srv.Core()), logger, []byte(cfg.IdentitySecret),
		llmproxy.WithModelResolver(modelResolver))
	mux.Handle("/llm/", api.NewRouter(handler))

	errCh := make(chan error, 1)
	go func() { errCh <- srv.ListenAndServe() }()

	select {
	case err := <-errCh:
		if err != nil {
			slog.Error("gateway server error", "err", err)
			os.Exit(1)
		}
	case <-ctx.Done():
		slog.Info("shutdown signal received")
	}

	// Drain in-flight streams (§9.5: ≥150s ceiling applied inside Shutdown).
	if err := srv.Shutdown(context.Background()); err != nil {
		slog.Error("gateway shutdown error", "err", err)
		os.Exit(1)
	}
}

func parseLevel(s string) slog.Level {
	switch s {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

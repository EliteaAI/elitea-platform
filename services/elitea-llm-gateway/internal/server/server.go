// Package server wires bifrost/core into the gateway's HTTP server and owns
// the process lifecycle (Init, serve, graceful shutdown).
//
// The /llm chi handler, converter, and SSE loop are added in task BF0.3; this
// package provides the bifrost initialisation and the §9.5 server/shutdown
// settings that the rest of the gateway builds on.
package server

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"

	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/bifrostlog"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/config"
)

// Server owns the embedded bifrost/core client and the HTTP server that
// fronts the /llm surface.
type Server struct {
	cfg    config.Config
	core   *bifrost.Bifrost
	http   *http.Server
	logger *slog.Logger
}

// New initialises bifrost/core with the injected slog/OTel logger and the
// §9.5 pool/concurrency settings, then constructs the HTTP server with the
// SSE-safe timeout profile.
//
// account is the schemas.Account bifrost uses to resolve provider
// credentials. Passing nil falls back to a bootstrap account (zero configured
// providers) so the server can start before the vault-backed Account
// (BF0.2-account) is wired.
func New(ctx context.Context, cfg config.Config, logger *slog.Logger, level *slog.LevelVar, account schemas.Account, handler http.Handler) (*Server, error) {
	if account == nil {
		account = newBootstrapAccount(cfg.ProviderConcurrency)
	}

	// §6.1: a Logger MUST be injected or bifrost.Init overwrites the zerolog
	// global. §9.5: tune InitialPoolSize down to fit the memory limit.
	core, err := bifrost.Init(ctx, schemas.BifrostConfig{
		Account:         account,
		Logger:          bifrostlog.New(logger, level),
		InitialPoolSize: cfg.InitialPoolSize,
	})
	if err != nil {
		return nil, fmt.Errorf("bifrost.Init: %w", err)
	}

	srv := &http.Server{
		Addr:    cfg.HTTPAddr,
		Handler: handler,
		// A finite ReadHeaderTimeout is safe and bounds slow-header attacks;
		// the streaming request bodies themselves are not time-bounded here.
		ReadHeaderTimeout: 10 * time.Second,
		// §9.5: WriteTimeout MUST be 0 (disabled) for the /llm SSE path. A
		// finite per-connection write deadline hard-kills any active SSE
		// response in normal operation. Per-stream deadlines are cleared in
		// the handler via http.NewResponseController before the first Flush.
		WriteTimeout: 0,
	}

	return &Server{
		cfg:    cfg,
		core:   core,
		http:   srv,
		logger: logger,
	}, nil
}

// Core exposes the embedded bifrost client to handlers (request methods live
// in the llmproxy package added by BF0.3).
func (s *Server) Core() *bifrost.Bifrost { return s.core }

// ListenAndServe starts the HTTP server. It returns nil on graceful shutdown.
func (s *Server) ListenAndServe() error {
	s.logger.Info("gateway listening", "addr", s.cfg.HTTPAddr)
	if err := s.http.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

// Shutdown drains in-flight streams and releases resources.
//
// §9.5: the shutdown context timeout MUST be ≥150s — a harder ceiling on
// stream drain than terminationGracePeriodSeconds — so provider LLM streams
// (up to ~120s) are not truncated on rolling deploys. The caller passes a
// parent ctx; this method applies cfg.ShutdownTimeout on top of it.
func (s *Server) Shutdown(ctx context.Context) error {
	shutCtx, cancel := context.WithTimeout(ctx, s.cfg.ShutdownTimeout)
	defer cancel()

	s.logger.Info("gateway shutting down", "grace", s.cfg.ShutdownTimeout.String())
	err := s.http.Shutdown(shutCtx)
	// Release bifrost worker goroutines and pooled resources after the HTTP
	// server has stopped accepting and drained in-flight requests.
	s.core.Shutdown()
	return err
}

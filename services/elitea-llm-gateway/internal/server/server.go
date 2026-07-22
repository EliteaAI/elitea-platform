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
	natsinfra "github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/infra/nats"
)

// NATSClient is the budget-path surface the gateway server owns and hands to
// downstream governance wiring (the GovernanceStore + tiered-hybrid FSM added
// by later BF0.4 subtasks). *nats.Client satisfies it; defining it here as an
// interface is the seam that lets server tests inject a fake without a live
// NATS server, exactly like the nats package's own operation seams.
type NATSClient interface {
	IncrBudget(ctx context.Context, subject string, deltaNano int64) (int64, error)
	ReadBudget(ctx context.Context, subject string) (int64, error)
	TryAlertCooldown(ctx context.Context, key string) (bool, error)
	PublishDelta(ctx context.Context, eventID string, payload []byte) error
	Close()
}

// natsConnector opens a hardened NATS client. It defaults to nats.Connect and
// is overridable in tests via WithNATSConnector so the server lifecycle
// (connect on start, close on shutdown) is verifiable offline.
type natsConnector func(ctx context.Context, cfg natsinfra.Config) (NATSClient, error)

// defaultNATSConnector adapts nats.Connect to the NATSClient interface.
func defaultNATSConnector(ctx context.Context, cfg natsinfra.Config) (NATSClient, error) {
	return natsinfra.Connect(ctx, cfg)
}

// Option customises Server construction. It exists for the injectable NATS
// connector seam; production code passes none and gets the real connector.
type Option func(*options)

type options struct {
	natsConnect natsConnector
}

// WithNATSConnector overrides the NATS connector (tests inject a fake).
func WithNATSConnector(fn natsConnector) Option {
	return func(o *options) { o.natsConnect = fn }
}

// Server owns the embedded bifrost/core client and the HTTP server that
// fronts the /llm surface.
type Server struct {
	cfg    config.Config
	core   *bifrost.Bifrost
	http   *http.Server
	logger *slog.Logger
	nats   NATSClient // nil when GATEWAY_NATS_URL is unset (NATS disabled)
}

// New initialises bifrost/core with the injected slog/OTel logger and the
// §9.5 pool/concurrency settings, then constructs the HTTP server with the
// SSE-safe timeout profile.
//
// account is the schemas.Account bifrost uses to resolve provider
// credentials. Passing nil falls back to a bootstrap account (zero configured
// providers) so the server can start before the vault-backed Account
// (BF0.2-account) is wired.
func New(ctx context.Context, cfg config.Config, logger *slog.Logger, level *slog.LevelVar, account schemas.Account, handler http.Handler, opts ...Option) (*Server, error) {
	if account == nil {
		account = newBootstrapAccount(cfg.ProviderConcurrency)
	}

	o := options{natsConnect: defaultNATSConnector}
	for _, opt := range opts {
		opt(&o)
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

	// Connect the budget-path NATS client when configured. An unset URL
	// disables NATS wiring (dev/test). A configured-but-unreachable NATS at
	// startup is logged and left nil rather than aborting boot: the
	// tiered-hybrid fail-mode FSM (design §8.5, a later BF0.4 subtask) owns the
	// enforcement policy while NATS is unavailable, and a gateway that refuses
	// to start on a NATS blip cannot serve /llm at all. The bootstrap chart is
	// the authoritative owner of the KV/stream assets.
	var natsClient NATSClient
	if cfg.NATSURL != "" {
		nc, nerr := o.natsConnect(ctx, natsinfra.Config{
			URL:                cfg.NATSURL,
			Name:               cfg.ServiceName,
			CBFailureThreshold: cfg.CBFailureThreshold,
			CBOpenDuration:     cfg.CBOpenDuration,
			Replicas:           cfg.NATSReplicas,
		})
		if nerr != nil {
			logger.Warn("NATS budget path unavailable at startup; continuing without enforcement wiring",
				"err", nerr, "url", cfg.NATSURL)
		} else {
			natsClient = nc
			logger.Info("NATS budget path connected", "url", cfg.NATSURL, "replicas", cfg.NATSReplicas)
		}
	} else {
		logger.Info("NATS budget path disabled (GATEWAY_NATS_URL unset)")
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
		nats:   natsClient,
	}, nil
}

// Core exposes the embedded bifrost client to handlers (request methods live
// in the llmproxy package added by BF0.3).
func (s *Server) Core() *bifrost.Bifrost { return s.core }

// NATS exposes the budget-path client to downstream governance wiring (the
// GovernanceStore + tiered-hybrid FSM added by later BF0.4 subtasks). It is
// nil when NATS is disabled or was unreachable at startup; callers MUST nil-check.
func (s *Server) NATS() NATSClient { return s.nats }

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
	// Close the NATS connection last so any in-flight budget increments during
	// drain still have a live client.
	if s.nats != nil {
		s.nats.Close()
	}
	return err
}

package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/health"
	infradb "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/runtimecomposition"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		endpoint, err := healthcheckURL(os.LookupEnv)
		if err != nil {
			os.Exit(1)
		}
		client := &http.Client{Timeout: 2 * time.Second}
		resp, err := client.Get(endpoint)
		if err != nil || resp.StatusCode != 200 {
			os.Exit(1)
		}
		_ = resp.Body.Close()
		os.Exit(0)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, logger); err != nil {
		logger.Error("elitea-main stopped with an error", "err", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, logger *slog.Logger) (runErr error) {
	publicAddress, err := configuredHTTPAddress(os.LookupEnv)
	if err != nil {
		return err
	}
	devMode := os.Getenv("AUTH_DEV_MODE") == "true"
	bootstrapLegacySchema := os.Getenv("ELITEA_DEV_BOOTSTRAP_LEGACY_SCHEMA") == "true"
	if bootstrapLegacySchema && !devMode {
		return errors.New("ELITEA_DEV_BOOTSTRAP_LEGACY_SCHEMA requires AUTH_DEV_MODE=true")
	}

	// Database
	dbDSN := envOr("DATABASE_URL", "postgres://localhost:5432/elitea?sslmode=disable")
	pool, err := pgxpool.New(ctx, dbDSN)
	if err != nil {
		return fmt.Errorf("create database pool: %w", err)
	}
	defer pool.Close()

	// The unversioned legacy bootstrap exists only for an empty local developer
	// database. Production shared/tenant histories are owned by elitea-migrate.
	if bootstrapLegacySchema {
		if err := infradb.RunMigrations(ctx, pool); err != nil {
			return fmt.Errorf("bootstrap local legacy database schema: %w", err)
		}
	}

	runtimeConfig, err := runtimecomposition.ConfigFromEnv(os.LookupEnv)
	if err != nil {
		return fmt.Errorf("load optional runtime configuration: %w", err)
	}
	var runtimeRoot *runtimecomposition.Runtime
	if runtimeConfig.Enabled {
		runtimePools, openErr := openRuntimeDatabasePools(ctx, dbDSN, runtimecomposition.PhaseOneDatabasePoolLimits())
		if openErr != nil {
			return openErr
		}
		defer runtimePools.Close()
		runtimeRoot, err = runtimecomposition.New(ctx, runtimeConfig, runtimecomposition.Dependencies{
			AdmissionPool: runtimePools.Admission,
			ControlPool:   runtimePools.Control,
			OutputPool:    runtimePools.Output,
			ReplayPool:    runtimePools.Replay,
			ContentPool:   runtimePools.Content,
			Logger:        logger,
		})
		if err != nil {
			return fmt.Errorf("compose optional runtime: %w", err)
		}
		defer func() {
			if err := runtimeRoot.Close(); runErr == nil && err != nil {
				runErr = fmt.Errorf("close optional runtime: %w", err)
			}
		}()
		slog.Info("production runtime enabled", "control_addr", runtimeConfig.ControlAddress, "output_addr", runtimeConfig.OutputAddress, "content_addr", runtimeConfig.ContentAddress)
	}

	r := api.NewRouter(api.RouterConfig{
		HealthDeps: health.Deps{
			DB: &poolChecker{pool: pool},
		},
	})

	srv := &http.Server{
		Addr: publicAddress,
		// Socket.IO remains unmounted until its legacy connection
		// authentication, project-membership checks, room authorization, and
		// per-event permission contract are implemented. Mounting the current
		// prototype would expose cross-tenant rooms and execution events.
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	slog.Info("starting server", "addr", srv.Addr, "runtime_enabled", runtimeRoot != nil)
	var runtimeLifecycleRoot runtimeLifecycle
	if runtimeRoot != nil {
		runtimeLifecycleRoot = runtimeRoot
	}
	if err := serveApplication(ctx, srv, runtimeLifecycleRoot, 15*time.Second); err != nil {
		return err
	}
	slog.Info("server stopped")
	return nil
}

type publicServerLifecycle interface {
	ListenAndServe() error
	Shutdown(context.Context) error
}

type runtimeLifecycle interface {
	Run(context.Context) error
	Shutdown(context.Context) error
}

var ErrApplicationDrainTimeout = errors.New("application drain deadline exceeded")

func serveApplication(ctx context.Context, public publicServerLifecycle, runtime runtimeLifecycle, shutdownTimeout time.Duration) error {
	if ctx == nil || public == nil || shutdownTimeout <= 0 {
		return errors.New("application lifecycle dependencies are incomplete")
	}
	type result struct {
		name string
		err  error
	}
	componentCount := 1
	results := make(chan result, 2)
	go func() { results <- result{name: "public HTTP", err: public.ListenAndServe()} }()
	if runtime != nil {
		componentCount++
		// Runtime cancellation is owned by Shutdown below so the same drain
		// deadline reaches its publisher and private listeners before pools close.
		go func() { results <- result{name: "production runtime", err: runtime.Run(context.Background())} }()
	}

	var primary *result
	select {
	case first := <-results:
		primary = &first
	case <-ctx.Done():
	}
	causes := make([]error, 0, componentCount+1)
	if primary != nil {
		if primary.err == nil {
			causes = append(causes, fmt.Errorf("%s stopped unexpectedly", primary.name))
		} else {
			causes = append(causes, fmt.Errorf("%s failed: %w", primary.name, primary.err))
		}
	}

	drainCtx, drainCancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer drainCancel()
	shutdownResults := make(chan result, 2)
	go func() { shutdownResults <- result{name: "public HTTP", err: public.Shutdown(drainCtx)} }()
	shutdownPending := 1
	if runtime != nil {
		shutdownPending++
		go func() { shutdownResults <- result{name: "production runtime", err: runtime.Shutdown(drainCtx)} }()
	}
	remainingComponents := componentCount
	if primary != nil {
		remainingComponents--
	}
	drainDone := drainCtx.Done()
	deadlineObserved := false
	for remainingComponents > 0 || shutdownPending > 0 {
		select {
		case drained := <-results:
			remainingComponents--
			if drained.err == nil {
				causes = append(causes, fmt.Errorf("%s stopped unexpectedly", drained.name))
				continue
			}
			if errors.Is(drained.err, http.ErrServerClosed) || errors.Is(drained.err, context.Canceled) || errors.Is(drained.err, context.DeadlineExceeded) {
				continue
			}
			causes = append(causes, fmt.Errorf("%s failed during drain: %w", drained.name, drained.err))
		case stopped := <-shutdownResults:
			shutdownPending--
			if stopped.err != nil && !errors.Is(stopped.err, context.Canceled) && !errors.Is(stopped.err, context.DeadlineExceeded) {
				causes = append(causes, fmt.Errorf("shutdown %s: %w", stopped.name, stopped.err))
			}
		case <-drainDone:
			deadlineObserved = true
			drainDone = nil
			causes = append(causes, fmt.Errorf("%w after %s", ErrApplicationDrainTimeout, shutdownTimeout))
		}
	}
	if deadlineObserved && !errors.Is(errors.Join(causes...), ErrApplicationDrainTimeout) {
		causes = append(causes, fmt.Errorf("%w after %s", ErrApplicationDrainTimeout, shutdownTimeout))
	}
	return errors.Join(causes...)
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

type poolChecker struct {
	pool *pgxpool.Pool
}

func (p *poolChecker) Ping(ctx context.Context) error {
	return p.pool.Ping(ctx)
}

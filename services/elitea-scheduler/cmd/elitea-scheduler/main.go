package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"github.com/EliteaAI/elitea-platform/services/elitea-scheduler/internal/config"
	"github.com/EliteaAI/elitea-platform/services/elitea-scheduler/internal/health"
	"github.com/EliteaAI/elitea-platform/services/elitea-scheduler/internal/pricesync"
	"github.com/EliteaAI/elitea-platform/services/elitea-scheduler/internal/rpc"
	"github.com/EliteaAI/elitea-platform/services/elitea-scheduler/internal/scheduler"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	cfg := config.FromEnv()

	// Database
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("failed to create db pool", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		slog.Error("database unreachable", "err", err)
		os.Exit(1)
	}

	// Redis
	rdb := goredis.NewClient(&goredis.Options{Addr: cfg.RedisURL})
	if err := rdb.Ping(ctx).Err(); err != nil {
		slog.Error("redis unreachable", "err", err)
		os.Exit(1)
	}
	defer func() { _ = rdb.Close() }()

	rpcClient := rpc.New(rdb, cfg.RPCChannel, cfg.RPCHMACKey)
	sched := scheduler.New(pool, rdb, rpcClient, cfg)

	// Health server
	mux := http.NewServeMux()
	mux.Handle("/healthz", health.New(pool))

	srv := &http.Server{
		Addr:        cfg.HTTPAddr,
		Handler:     mux,
		ReadTimeout: 5 * time.Second,
	}

	go func() {
		slog.Info("starting health server", "addr", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("health server error", "err", err)
		}
	}()

	slog.Info("starting scheduler", "instance", cfg.InstanceID, "rpc_channel", cfg.RPCChannel)
	go sched.Run(ctx)

	// Price-catalog sync worker (design §8.8): refreshes gateway.gateway_models
	// from ordered PriceSources on a ~24h cadence, off the /llm hot path.
	if cfg.PriceSyncEnabled {
		var sources []pricesync.PriceSource
		if cfg.PriceSyncLiteLLM {
			sources = append(sources, pricesync.NewLiteLLMSource(cfg.PriceSyncURL, nil))
		}
		if cfg.PriceSyncSeed {
			sources = append(sources, pricesync.NewSeedSource())
		}
		if len(sources) == 0 {
			slog.Warn("price-sync enabled but no sources configured; skipping worker")
		} else {
			syncer := pricesync.NewSyncer(pricesync.NewPoolDB(pool), sources, logger)
			worker := pricesync.NewWorker(syncer, cfg.PriceSyncInterval, logger)
			slog.Info("starting price-sync worker", "interval", cfg.PriceSyncInterval, "sources", len(sources))
			go worker.Run(ctx)
		}
	}

	<-ctx.Done()
	slog.Info("shutting down")

	shutCtx, sc := context.WithTimeout(context.Background(), 10*time.Second)
	defer sc()
	if err := srv.Shutdown(shutCtx); err != nil {
		slog.Error("health server shutdown error", "err", err)
	}
	sched.Stop()
}

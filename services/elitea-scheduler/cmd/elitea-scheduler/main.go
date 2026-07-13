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
	defer rdb.Close()

	rpcClient := rpc.New(rdb)
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

	slog.Info("starting scheduler", "instance", cfg.InstanceID, "pipeline_scheduling", cfg.PipelineSchedulingEnabled)
	go sched.Run(ctx)

	<-ctx.Done()
	slog.Info("shutting down")

	shutCtx, sc := context.WithTimeout(context.Background(), 10*time.Second)
	defer sc()
	srv.Shutdown(shutCtx)
	sched.Stop()
}

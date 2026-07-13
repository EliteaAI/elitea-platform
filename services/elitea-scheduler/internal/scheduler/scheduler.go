package scheduler

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/robfig/cron/v3"

	"github.com/EliteaAI/elitea-platform/services/elitea-scheduler/internal/config"
	"github.com/EliteaAI/elitea-platform/services/elitea-scheduler/internal/rpc"
)

// Scheduler is the core scheduling daemon.
type Scheduler struct {
	pool      *pgxpool.Pool
	rdb       *redis.Client
	rpcClient *rpc.Client
	cfg       config.Config
	parser    cron.Parser
	stop      chan struct{}
}

// New creates a Scheduler.
func New(pool *pgxpool.Pool, rdb *redis.Client, rpcClient *rpc.Client, cfg config.Config) *Scheduler {
	return &Scheduler{
		pool:      pool,
		rdb:       rdb,
		rpcClient: rpcClient,
		cfg:       cfg,
		parser:    cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow),
		stop:      make(chan struct{}),
	}
}

// Run starts the scheduler loop. Blocks until ctx is cancelled or Stop is called.
func (s *Scheduler) Run(ctx context.Context) {
	// Align first tick to the start of the next minute
	now := time.Now()
	nextMinute := now.Truncate(time.Minute).Add(time.Minute)
	delay := time.Until(nextMinute)

	slog.Info("scheduler: waiting for first tick", "delay", delay.Round(time.Second))
	select {
	case <-time.After(delay):
	case <-ctx.Done():
		return
	case <-s.stop:
		return
	}

	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	s.tick(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-s.stop:
			return
		case <-ticker.C:
			s.tick(ctx)
		}
	}
}

// Stop signals the scheduler to shut down.
func (s *Scheduler) Stop() {
	select {
	case <-s.stop:
	default:
		close(s.stop)
	}
}

func (s *Scheduler) tick(ctx context.Context) {
	if s.cfg.PipelineSchedulingEnabled {
		lock := newLock(s.rdb, "pipeline_scheduling", s.cfg.InstanceID)
		ok, err := lock.TryAcquire(ctx)
		if err != nil {
			slog.Error("scheduler: lock acquire error", "err", err)
			return
		}
		if !ok {
			slog.Debug("scheduler: lock held by another instance, skipping")
			return
		}
		defer lock.Release(ctx)
		runPipelineScheduling(ctx, s.pool, s.rpcClient, s.parser)
	}
}

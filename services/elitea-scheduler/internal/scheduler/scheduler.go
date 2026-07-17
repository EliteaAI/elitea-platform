package scheduler

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/robfig/cron/v3"

	"github.com/EliteaAI/elitea-platform/services/elitea-scheduler/internal/config"
	"github.com/EliteaAI/elitea-platform/services/elitea-scheduler/internal/rpc"
)

// Schedule mirrors the centry.schedule table row.
type Schedule struct {
	ID        int
	Name      string
	ProjectID *int
	Cron      string
	Active    bool
	RPCFunc   string
	RPCKwargs map[string]any
	LastRun   *time.Time
}

// Scheduler is the core scheduling daemon that reads centry.schedule
// and dispatches RPC calls to pylon services.
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
	lock := newLock(s.rdb, "scheduler_tick", s.cfg.InstanceID)
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

	s.runSchedules(ctx)
}

func (s *Scheduler) runSchedules(ctx context.Context) {
	// Use FOR UPDATE SKIP LOCKED to prevent concurrent execution (matches pylon behavior)
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, project_id, cron, rpc_func, rpc_kwargs, last_run
		FROM centry.schedule
		WHERE active = true
		FOR UPDATE SKIP LOCKED`)
	if err != nil {
		slog.Error("scheduler: query schedules", "err", err)
		return
	}
	defer rows.Close()

	now := time.Now().UTC()
	var dispatched, skipped int

	for rows.Next() {
		var sc Schedule
		var kwargsRaw []byte
		err := rows.Scan(&sc.ID, &sc.Name, &sc.ProjectID, &sc.Cron, &sc.RPCFunc, &kwargsRaw, &sc.LastRun)
		if err != nil {
			slog.Error("scheduler: scan row", "err", err)
			continue
		}

		if kwargsRaw != nil {
			json.Unmarshal(kwargsRaw, &sc.RPCKwargs)
		}

		if !s.timeToRun(sc, now) {
			skipped++
			continue
		}

		// Dispatch RPC
		slog.Info("scheduler: dispatching", "id", sc.ID, "name", sc.Name, "rpc_func", sc.RPCFunc)
		if err := s.rpcClient.Call(ctx, sc.RPCFunc, sc.RPCKwargs); err != nil {
			slog.Error("scheduler: dispatch failed", "id", sc.ID, "name", sc.Name, "err", err)
			continue
		}

		// Update last_run
		_, err = s.pool.Exec(ctx, `UPDATE centry.schedule SET last_run = $1 WHERE id = $2`, now, sc.ID)
		if err != nil {
			slog.Error("scheduler: update last_run", "id", sc.ID, "err", err)
		}
		dispatched++
	}

	if dispatched > 0 || slog.Default().Enabled(ctx, slog.LevelDebug) {
		slog.Info("scheduler: tick complete", "dispatched", dispatched, "skipped", skipped)
	}
}

// timeToRun checks if a schedule is due, matching pylon's croniter logic:
// if last_run is nil, it's always due; otherwise next(last_run) <= now.
func (s *Scheduler) timeToRun(sc Schedule, now time.Time) bool {
	if sc.LastRun == nil {
		return true
	}

	sched, err := s.parser.Parse(sc.Cron)
	if err != nil {
		slog.Debug("scheduler: invalid cron", "id", sc.ID, "name", sc.Name, "cron", sc.Cron, "err", err)
		return false
	}

	nextRun := sched.Next(*sc.LastRun)
	return !nextRun.After(now)
}

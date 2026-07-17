package main

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/runtimecomposition"
	"github.com/jackc/pgx/v5/pgxpool"
)

type runtimeDatabasePools struct {
	Admission *pgxpool.Pool
	Control   *pgxpool.Pool
	Output    *pgxpool.Pool
	Replay    *pgxpool.Pool
	Content   *pgxpool.Pool

	resources []runtimePoolResource
	closeOnce sync.Once
}

type runtimePoolSpec struct {
	role     string
	maxConns int32
}

type runtimePoolResource struct {
	pool  *pgxpool.Pool
	close func()
}

type runtimePoolFactory func(context.Context, string, runtimePoolSpec) (runtimePoolResource, error)

func openRuntimeDatabasePools(ctx context.Context, dsn string, limits runtimecomposition.DatabasePoolLimits) (*runtimeDatabasePools, error) {
	return openRuntimeDatabasePoolsWithFactory(ctx, dsn, limits, openRuntimePostgresPool)
}

func openRuntimeDatabasePoolsWithFactory(ctx context.Context, dsn string, limits runtimecomposition.DatabasePoolLimits, factory runtimePoolFactory) (*runtimeDatabasePools, error) {
	if ctx == nil || dsn == "" || factory == nil {
		return nil, errors.New("runtime database pool dependencies are incomplete")
	}
	if err := limits.Validate(); err != nil {
		return nil, err
	}
	specs := []runtimePoolSpec{
		{role: "admission-publisher", maxConns: limits.AdmissionPublisher},
		{role: "control", maxConns: limits.Control},
		{role: "output", maxConns: limits.Output},
		{role: "sse-replay", maxConns: limits.Replay},
		{role: "content", maxConns: limits.Content},
	}
	resources := make([]runtimePoolResource, 0, len(specs))
	for _, spec := range specs {
		resource, err := factory(ctx, dsn, spec)
		if err != nil {
			closeRuntimePoolResources(resources)
			return nil, fmt.Errorf("open runtime %s database pool: %w", spec.role, err)
		}
		if resource.pool == nil || resource.close == nil {
			if resource.close != nil {
				resource.close()
			}
			closeRuntimePoolResources(resources)
			return nil, fmt.Errorf("open runtime %s database pool: incomplete resource", spec.role)
		}
		resources = append(resources, resource)
	}
	return &runtimeDatabasePools{
		Admission: resources[0].pool,
		Control:   resources[1].pool,
		Output:    resources[2].pool,
		Replay:    resources[3].pool,
		Content:   resources[4].pool,
		resources: resources,
	}, nil
}

func openRuntimePostgresPool(ctx context.Context, dsn string, spec runtimePoolSpec) (runtimePoolResource, error) {
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return runtimePoolResource{}, fmt.Errorf("parse PostgreSQL configuration: %w", err)
	}
	config.MaxConns = spec.maxConns
	config.MinConns = 0
	config.MaxConnIdleTime = 5 * time.Minute
	config.MaxConnLifetime = 30 * time.Minute
	config.MaxConnLifetimeJitter = 5 * time.Minute
	if config.ConnConfig.RuntimeParams == nil {
		config.ConnConfig.RuntimeParams = make(map[string]string)
	}
	config.ConnConfig.RuntimeParams["application_name"] = "elitea-runtime-" + spec.role
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return runtimePoolResource{}, fmt.Errorf("construct PostgreSQL pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return runtimePoolResource{}, fmt.Errorf("ping PostgreSQL: %w", err)
	}
	return runtimePoolResource{pool: pool, close: pool.Close}, nil
}

func (p *runtimeDatabasePools) Close() {
	if p == nil {
		return
	}
	p.closeOnce.Do(func() { closeRuntimePoolResources(p.resources) })
}

func closeRuntimePoolResources(resources []runtimePoolResource) {
	for index := len(resources) - 1; index >= 0; index-- {
		resources[index].close()
	}
}

package runtimecomposition

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

type currentIndexMetaTaskRestampProcessor struct {
	restamper         currentIndexMetaTaskRestamper
	store             currentIndexMetaTaskRestampStore
	newClaimID        executionapp.IDGenerator
	claimLease        time.Duration
	concurrency       int
	reportItemFailure func(error)
}

type currentIndexMetaTaskRestamper interface {
	Restamp(context.Context, indexingapp.CurrentIndexMetaTaskRestampRequest) error
}

type currentIndexMetaTaskRestampStore interface {
	ClaimPendingTaskRestamps(
		context.Context,
		string,
		int,
		time.Duration,
	) ([]indexingapp.CurrentIndexMetaTaskRestampClaim, error)
	SupersedeTaskRestampIfNewerInitialized(
		context.Context,
		indexingapp.CurrentIndexMetaTaskRestampClaim,
	) (bool, error)
	ResolveTaskRestamp(
		context.Context,
		indexingapp.CurrentIndexMetaTaskRestampClaim,
		indexingapp.CurrentIndexMetaTaskRestampResolution,
	) error
	ReleaseTaskRestamp(
		context.Context,
		indexingapp.CurrentIndexMetaTaskRestampClaim,
		string,
	) error
}

func newCurrentIndexMetaTaskRestampProcessor(
	effectPool *pgxpool.Pool,
	configurations *CurrentConfigurationsRuntime,
	writer indexingapp.CurrentIndexMetaTaskRestampWriter,
	reportItemFailure func(error),
) (*currentIndexMetaTaskRestampProcessor, error) {
	if effectPool == nil || configurations == nil || configurations.unsecreter == nil ||
		writer == nil || reportItemFailure == nil {
		return nil, errors.New(
			"current index metadata task restamp dependencies are required",
		)
	}
	concurrency, err := currentIndexMetaTaskRestampConcurrency(
		effectPool.Config().MaxConns,
	)
	if err != nil {
		return nil, err
	}
	store, err := repos.NewCurrentIndexMetaTaskRestampRepository(effectPool)
	if err != nil {
		return nil, fmt.Errorf(
			"construct current index metadata task restamp store: %w",
			err,
		)
	}
	materializer, err := storage.NewCurrentConfigurationsMaterializer(
		configurations.unsecreter,
	)
	if err != nil {
		return nil, err
	}
	toolkits, err := newCurrentFrozenToolkitConfigurationClaimer(materializer)
	if err != nil {
		return nil, err
	}
	restamper, err := indexingapp.NewCurrentIndexMetaTaskRestamper(
		store,
		toolkits,
		writer,
	)
	if err != nil {
		return nil, err
	}
	return &currentIndexMetaTaskRestampProcessor{
		restamper:         restamper,
		store:             store,
		newClaimID:        currentRuntimeID,
		claimLease:        2 * time.Minute,
		concurrency:       concurrency,
		reportItemFailure: reportItemFailure,
	}, nil
}

func currentIndexMetaTaskRestampConcurrency(
	maxConnections int32,
) (int, error) {
	if maxConnections <= 0 {
		return 0, errors.New(
			"current index metadata task restamp pool capacity is invalid",
		)
	}
	return min(
		int(maxConnections),
		maxCurrentIndexMetaTerminalConcurrency,
	), nil
}

func (p *currentIndexMetaTaskRestampProcessor) ReconcilePendingTaskRestamps(
	ctx context.Context,
	limit int,
) (int, error) {
	if p == nil || p.restamper == nil || p.store == nil ||
		p.newClaimID == nil || p.claimLease <= 0 || p.concurrency <= 0 ||
		p.reportItemFailure == nil || limit <= 0 ||
		limit > executionapp.MaxOutboxPublisherBatchSize {
		return 0, indexingapp.ErrCurrentIndexMetaMaterializationUnavailable
	}
	claimToken, err := p.newClaimID()
	if err != nil || claimToken == "" {
		return 0, indexingapp.ErrCurrentIndexMetaMaterializationUnavailable
	}
	claims, err := p.store.ClaimPendingTaskRestamps(
		ctx,
		claimToken,
		min(limit, 2*p.concurrency),
		p.claimLease,
	)
	if err != nil || len(claims) == 0 {
		return 0, err
	}

	type result struct {
		requeued bool
		err      error
	}
	results := make([]result, len(claims))
	jobs := make(chan int)
	workerCount := min(p.concurrency, len(claims))
	var workers sync.WaitGroup
	workers.Add(workerCount)
	for range workerCount {
		go func() {
			defer workers.Done()
			for index := range jobs {
				if ctx.Err() != nil {
					return
				}
				results[index].requeued, results[index].err =
					p.applyTaskRestampClaim(ctx, claims[index])
			}
		}()
	}
send:
	for index := range claims {
		select {
		case jobs <- index:
		case <-ctx.Done():
			break send
		}
	}
	close(jobs)
	workers.Wait()
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	itemErrors := make([]error, 0, len(results))
	for index, result := range results {
		if result.err == nil {
			continue
		}
		itemErr := fmt.Errorf(
			"reconcile index metadata task restamp %q generation %d: %w",
			claims[index].ExecutionID,
			claims[index].Generation,
			result.err,
		)
		if result.requeued {
			p.reportItemFailure(itemErr)
			continue
		}
		itemErrors = append(itemErrors, itemErr)
	}
	return len(claims), errors.Join(itemErrors...)
}

func (p *currentIndexMetaTaskRestampProcessor) applyTaskRestampClaim(
	ctx context.Context,
	claim indexingapp.CurrentIndexMetaTaskRestampClaim,
) (bool, error) {
	superseded, err :=
		p.store.SupersedeTaskRestampIfNewerInitialized(ctx, claim)
	if err != nil {
		releaseErr := p.store.ReleaseTaskRestamp(
			ctx,
			claim,
			terminalEffectErrorCode(err),
		)
		if releaseErr != nil {
			return false, errors.Join(err, releaseErr)
		}
		return true, err
	}
	if superseded {
		return false, nil
	}
	if err := p.restamper.Restamp(
		ctx,
		claim.CurrentIndexMetaTaskRestampRequest,
	); err != nil {
		if errors.Is(err, indexingapp.ErrCurrentIndexMetaSuperseded) {
			return false, p.store.ResolveTaskRestamp(
				ctx,
				claim,
				indexingapp.CurrentIndexMetaTaskRestampSuperseded,
			)
		}
		releaseErr := p.store.ReleaseTaskRestamp(
			ctx,
			claim,
			terminalEffectErrorCode(err),
		)
		if releaseErr != nil {
			return false, errors.Join(err, releaseErr)
		}
		return true, err
	}
	return false, p.store.ResolveTaskRestamp(
		ctx,
		claim,
		indexingapp.CurrentIndexMetaTaskRestampApplied,
	)
}

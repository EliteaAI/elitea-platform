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

type currentIndexMetaTerminalProcessor struct {
	terminalizer      currentIndexMetaTerminalizer
	store             currentIndexMetaTerminalEffectStore
	newClaimID        executionapp.IDGenerator
	claimLease        time.Duration
	concurrency       int
	reportItemFailure func(error)
}

type currentIndexMetaTerminalizer interface {
	Terminalize(context.Context, indexingapp.CurrentIndexMetaTerminalRequest) error
}

type currentIndexMetaTerminalEffectStore interface {
	ClaimPendingTerminalEffects(
		context.Context,
		string,
		int,
		time.Duration,
	) ([]indexingapp.CurrentIndexMetaTerminalClaim, error)
	ResolveTerminalEffect(
		context.Context,
		indexingapp.CurrentIndexMetaTerminalClaim,
		indexingapp.CurrentIndexMetaTerminalResolution,
	) error
	ReleaseTerminalEffect(
		context.Context,
		indexingapp.CurrentIndexMetaTerminalClaim,
		string,
	) error
}

func newCurrentIndexMetaTerminalProcessor(
	pool *pgxpool.Pool,
	configurations *CurrentConfigurationsRuntime,
	writer indexingapp.CurrentIndexMetaTerminalWriter,
	reportItemFailure func(error),
) (*currentIndexMetaTerminalProcessor, error) {
	if pool == nil || configurations == nil || configurations.unsecreter == nil ||
		writer == nil || reportItemFailure == nil {
		return nil, errors.New("current index metadata terminal effect dependencies are required")
	}
	bindings, err := repos.NewCurrentIndexMetaTerminalBindingsRepository(pool)
	if err != nil {
		return nil, fmt.Errorf("construct current index metadata terminal bindings: %w", err)
	}
	materializer, err := storage.NewCurrentConfigurationsMaterializer(configurations.unsecreter)
	if err != nil {
		return nil, err
	}
	toolkits, err := newCurrentFrozenToolkitConfigurationClaimer(materializer)
	if err != nil {
		return nil, err
	}
	terminalizer, err := indexingapp.NewCurrentIndexMetaTerminalizer(
		bindings,
		toolkits,
		writer,
	)
	if err != nil {
		return nil, err
	}
	return &currentIndexMetaTerminalProcessor{
		terminalizer:      terminalizer,
		store:             bindings,
		newClaimID:        currentRuntimeID,
		claimLease:        2 * time.Minute,
		concurrency:       4,
		reportItemFailure: reportItemFailure,
	}, nil
}

func (e *currentIndexMetaTerminalProcessor) ReconcilePendingIndexMetaTerminals(
	ctx context.Context,
	limit int,
) (int, error) {
	if e == nil || e.terminalizer == nil || e.store == nil || e.newClaimID == nil ||
		e.claimLease <= 0 || e.concurrency <= 0 || e.reportItemFailure == nil {
		return 0, indexingapp.ErrCurrentIndexMetaMaterializationUnavailable
	}
	claimToken, err := e.newClaimID()
	if err != nil || claimToken == "" {
		return 0, indexingapp.ErrCurrentIndexMetaMaterializationUnavailable
	}
	claimLimit := min(limit, 2*e.concurrency)
	claims, err := e.store.ClaimPendingTerminalEffects(
		ctx,
		claimToken,
		claimLimit,
		e.claimLease,
	)
	if err != nil {
		return 0, err
	}
	if len(claims) == 0 {
		return 0, nil
	}

	workerCount := min(e.concurrency, len(claims))
	jobs := make(chan int)
	type itemResult struct {
		requeued bool
		err      error
	}
	results := make([]itemResult, len(claims))
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
					e.applyClaim(ctx, claims[index])
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
			"reconcile index metadata terminal %q generation %d: %w",
			claims[index].ExecutionID,
			claims[index].Generation,
			result.err,
		)
		if result.requeued {
			e.reportItemFailure(itemErr)
		} else {
			itemErrors = append(itemErrors, fmt.Errorf(
				"reconcile index metadata terminal %q generation %d: %w",
				claims[index].ExecutionID,
				claims[index].Generation,
				result.err,
			))
		}
	}
	return len(claims), errors.Join(itemErrors...)
}

func (e *currentIndexMetaTerminalProcessor) applyClaim(
	ctx context.Context,
	claim indexingapp.CurrentIndexMetaTerminalClaim,
) (bool, error) {
	if err := e.terminalizer.Terminalize(ctx, claim.CurrentIndexMetaTerminalRequest); err != nil {
		if errors.Is(err, indexingapp.ErrCurrentIndexMetaSuperseded) {
			return false, e.store.ResolveTerminalEffect(
				ctx,
				claim,
				indexingapp.CurrentIndexMetaTerminalSuperseded,
			)
		}
		releaseErr := e.store.ReleaseTerminalEffect(ctx, claim, terminalEffectErrorCode(err))
		if releaseErr != nil {
			return false, errors.Join(err, releaseErr)
		}
		return true, err
	}
	return false, e.store.ResolveTerminalEffect(
		ctx,
		claim,
		indexingapp.CurrentIndexMetaTerminalApplied,
	)
}

func terminalEffectErrorCode(err error) string {
	switch {
	case errors.Is(err, context.Canceled):
		return "CONTEXT_CANCELLED"
	case errors.Is(err, context.DeadlineExceeded):
		return "CONTEXT_DEADLINE"
	case errors.Is(err, indexingapp.ErrCurrentIndexMetaConflict):
		return "CONFLICT"
	case errors.Is(err, indexingapp.ErrCurrentIndexMetaTargetUnavailable):
		return "TARGET_UNAVAILABLE"
	default:
		return "DEPENDENCY_UNAVAILABLE"
	}
}

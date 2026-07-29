package runtimecomposition

import (
	"context"
	"errors"
	"time"

	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
)

type currentIndexMetaTaskRestampReconciliationService interface {
	ReconcilePendingTaskRestamps(context.Context, int) (int, error)
}

type currentIndexMetaTaskRestampReconciler struct {
	service       currentIndexMetaTaskRestampReconciliationService
	pollInterval  time.Duration
	batchSize     int
	reportFailure func(error)
	wait          func(context.Context, time.Duration) error
}

func newCurrentIndexMetaTaskRestampReconciler(
	service currentIndexMetaTaskRestampReconciliationService,
	pollInterval time.Duration,
	batchSize int,
	reportFailure func(error),
) (*currentIndexMetaTaskRestampReconciler, error) {
	if service == nil || pollInterval <= 0 || batchSize <= 0 ||
		batchSize > executionapp.MaxOutboxPublisherBatchSize ||
		reportFailure == nil {
		return nil, errors.New(
			"current index metadata task restamp reconciler configuration is invalid",
		)
	}
	return &currentIndexMetaTaskRestampReconciler{
		service:       service,
		pollInterval:  pollInterval,
		batchSize:     batchSize,
		reportFailure: reportFailure,
		wait:          waitCurrentIndexMetaTerminalReconciler,
	}, nil
}

func (r *currentIndexMetaTaskRestampReconciler) RunOnce(
	ctx context.Context,
) error {
	if r == nil || r.service == nil || ctx == nil {
		return errors.New(
			"current index metadata task restamp reconciler is incomplete",
		)
	}
	_, err := r.service.ReconcilePendingTaskRestamps(ctx, r.batchSize)
	return err
}

func (r *currentIndexMetaTaskRestampReconciler) Run(
	ctx context.Context,
) error {
	if r == nil || r.service == nil || r.wait == nil || ctx == nil {
		return errors.New(
			"current index metadata task restamp reconciler is incomplete",
		)
	}
	failures := 0
	for {
		delay := r.pollInterval
		if err := r.RunOnce(ctx); err != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return ctxErr
			}
			failures++
			r.reportFailure(err)
			delay = currentIndexMetaTerminalFailureDelay(
				r.pollInterval,
				failures,
			)
		} else {
			failures = 0
		}
		if err := r.wait(ctx, delay); err != nil {
			return err
		}
	}
}

var _ publisherRunner = (*currentIndexMetaTaskRestampReconciler)(nil)

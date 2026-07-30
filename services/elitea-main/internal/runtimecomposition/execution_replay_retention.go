package runtimecomposition

import (
	"context"
	"errors"
	"time"
)

const executionReplayRetentionPollInterval = time.Minute

type executionReplayProgressPruner interface {
	PruneExpiredReplayProgress(context.Context) (int64, error)
}

// executionReplayRetentionJanitor owns exactly one synchronous maintenance
// loop. The repository bounds each pass; keeping the call inline prevents
// overlapping passes when PostgreSQL is slow.
type executionReplayRetentionJanitor struct {
	pruner        executionReplayProgressPruner
	pollInterval  time.Duration
	reportFailure func(error)
	wait          func(context.Context, time.Duration) error
}

func newExecutionReplayRetentionJanitor(
	pruner executionReplayProgressPruner,
	pollInterval time.Duration,
	reportFailure func(error),
) (*executionReplayRetentionJanitor, error) {
	if pruner == nil || pollInterval <= 0 || reportFailure == nil {
		return nil, errors.New("execution replay retention dependencies are incomplete")
	}
	return &executionReplayRetentionJanitor{
		pruner:        pruner,
		pollInterval:  pollInterval,
		reportFailure: reportFailure,
		wait:          waitExecutionReplayRetention,
	}, nil
}

func (j *executionReplayRetentionJanitor) RunOnce(ctx context.Context) error {
	if j == nil || j.pruner == nil || ctx == nil {
		return errors.New("execution replay retention janitor is incomplete")
	}
	_, err := j.pruner.PruneExpiredReplayProgress(ctx)
	return err
}

func (j *executionReplayRetentionJanitor) Run(ctx context.Context) error {
	if j == nil || j.pruner == nil || j.wait == nil || ctx == nil {
		return errors.New("execution replay retention janitor is incomplete")
	}
	for {
		if err := j.RunOnce(ctx); err != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return ctxErr
			}
			j.reportFailure(err)
		}
		if err := j.wait(ctx, j.pollInterval); err != nil {
			return err
		}
	}
}

func waitExecutionReplayRetention(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

var _ publisherRunner = (*executionReplayRetentionJanitor)(nil)

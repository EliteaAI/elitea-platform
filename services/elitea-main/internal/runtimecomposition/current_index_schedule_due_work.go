package runtimecomposition

import (
	"context"
	"errors"
	"time"

	indexscheduleapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexschedule"
)

const currentIndexScheduleCapability = "index.schedule.scan.v1"

// currentIndexScheduleDueWork is the typed indexing adapter behind the generic
// platform scheduler. It owns product-aware discovery and durable admission;
// it does not own a clock, replica claim, or occurrence ledger.
type currentIndexScheduleDueWork struct {
	indexes *indexscheduleapp.Runner
}

func newCurrentIndexScheduleDueWork(
	indexes *indexscheduleapp.Runner,
) (*currentIndexScheduleDueWork, error) {
	if indexes == nil {
		return nil, errors.New("current index schedule due work is required")
	}
	return &currentIndexScheduleDueWork{indexes: indexes}, nil
}

func (*currentIndexScheduleDueWork) Name() string {
	return currentIndexScheduleCapability
}

func (work *currentIndexScheduleDueWork) RunDue(
	ctx context.Context,
	occurrence time.Time,
) (indexscheduleapp.TickResult, error) {
	if work == nil || work.indexes == nil || ctx == nil || occurrence.IsZero() {
		return indexscheduleapp.TickResult{}, indexscheduleapp.ErrInvalidRequest
	}
	return work.indexes.RunDue(ctx, occurrence)
}

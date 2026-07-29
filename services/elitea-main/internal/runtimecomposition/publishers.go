package runtimecomposition

import (
	"context"
	"errors"
	"fmt"
)

// publisherSet gives a fixed set of durable publishers one lifecycle owner.
// The first unexpected stop cancels every sibling and is returned only after
// all publisher goroutines have exited.
type publisherSet struct {
	publishers []publisherRunner
}

func newConfiguredPublisherSet(indexEnabled bool, validation, index publisherRunner) (*publisherSet, error) {
	if validation == nil {
		return nil, errors.New("validation publisher is required")
	}
	if indexEnabled {
		if index == nil {
			return nil, errors.New("enabled index ingest publisher is required")
		}
		return newPublisherSet(validation, index)
	}
	if index != nil {
		return nil, errors.New("index ingest publisher requires explicit enablement")
	}
	return newPublisherSet(validation)
}

func newPublisherSet(publishers ...publisherRunner) (*publisherSet, error) {
	if len(publishers) == 0 {
		return nil, errors.New("at least one runtime publisher is required")
	}
	owned := make([]publisherRunner, len(publishers))
	copy(owned, publishers)
	for _, publisher := range owned {
		if publisher == nil {
			return nil, errors.New("runtime publisher is required")
		}
	}
	return &publisherSet{publishers: owned}, nil
}

func (s *publisherSet) Run(ctx context.Context) error {
	if ctx == nil || len(s.publishers) == 0 {
		return errors.New("runtime publisher lifecycle is incomplete")
	}
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	type result struct {
		position int
		err      error
	}
	results := make(chan result, len(s.publishers))
	for position, publisher := range s.publishers {
		go func() {
			results <- result{position: position, err: publisher.Run(runCtx)}
		}()
	}

	first := <-results
	ownerCancellation := ctx.Err()
	cancel()
	collected := make([]result, 0, len(s.publishers))
	collected = append(collected, first)
	for len(collected) < len(s.publishers) {
		collected = append(collected, <-results)
	}

	causes := make([]error, 0, len(collected))
	for _, outcome := range collected {
		if outcome.err == nil {
			if ownerCancellation == nil {
				causes = append(causes, fmt.Errorf("publisher %d stopped unexpectedly", outcome.position+1))
			}
			continue
		}
		if errors.Is(outcome.err, context.Canceled) || errors.Is(outcome.err, context.DeadlineExceeded) {
			continue
		}
		causes = append(causes, fmt.Errorf("publisher %d: %w", outcome.position+1, outcome.err))
	}
	if len(causes) != 0 {
		return errors.Join(causes...)
	}
	if ownerCancellation != nil {
		return ownerCancellation
	}
	return errors.New("runtime publisher stopped without an owning cancellation")
}

var _ publisherRunner = (*publisherSet)(nil)

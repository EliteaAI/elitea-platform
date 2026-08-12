package configurations

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

const (
	MaxCurrentConfigurationLifecycleBatchSize    = 128
	MaxCurrentConfigurationLifecycleConcurrency  = 16
	MaxCurrentConfigurationLifecycleAttempts     = 1000
	MaxCurrentConfigurationLifecycleLeaseTTL     = 10 * time.Minute
	MaxCurrentConfigurationLifecyclePollInterval = time.Minute
	MaxCurrentConfigurationLifecycleRetryDelay   = 5 * time.Minute
	minCurrentConfigurationLifecycleLeaseTTL     = 5 * time.Second
	minCurrentConfigurationLifecyclePollInterval = 10 * time.Millisecond
	currentConfigurationLifecycleSnapshotLimit   = 2 * 1024 * 1024
	currentConfigurationLifecycleGenericFailure  = "RECONCILE_FAILED"
	currentConfigurationLifecycleInvalidSnapshot = "SNAPSHOT_INVALID"
)

var (
	ErrInvalidCurrentConfigurationLifecycleProcessor = errors.New("invalid current configuration lifecycle processor")
	ErrCurrentConfigurationLifecycleBatchOverflow    = errors.New("current configuration lifecycle batch overflow")
)

// CurrentConfigurationLifecycleEvent is one leased durable outbox row. The
// lease token is unique to this claim and fences every completion transition.
// Snapshot remains the exact stored bytes until its digest is verified.
type CurrentConfigurationLifecycleEvent struct {
	EventID           string
	ProjectID         int32
	ConfigurationUUID string
	Revision          int64
	Operation         CurrentConfigurationLifecycleOperation
	ActorID           int32
	Snapshot          []byte
	SnapshotDigest    [32]byte
	AttemptCount      int
	LeaseToken        string
}

// CurrentConfigurationLifecycleStore owns short PostgreSQL operations only.
// Claim must return at most one currently processable revision per
// configuration, ordered deterministically, and must not hold a transaction
// while reconciliation performs external work.
type CurrentConfigurationLifecycleStore interface {
	ClaimCurrentConfigurationLifecycle(
		context.Context,
		string,
		int,
		time.Duration,
	) ([]CurrentConfigurationLifecycleEvent, error)
	MarkCurrentConfigurationLifecycleDelivered(context.Context, string, string) error
	MarkCurrentConfigurationLifecycleRetry(context.Context, string, string, string, time.Duration) error
	MarkCurrentConfigurationLifecycleDead(context.Context, string, string, string) error
}

type CurrentConfigurationLifecycleReconcileDisposition string

const (
	CurrentConfigurationLifecycleReconciled CurrentConfigurationLifecycleReconcileDisposition = "reconciled"
	CurrentConfigurationLifecycleRetry      CurrentConfigurationLifecycleReconcileDisposition = "retry"
	CurrentConfigurationLifecycleDead       CurrentConfigurationLifecycleReconcileDisposition = "dead"
)

// CurrentConfigurationLifecycleReconcileResult carries only a bounded safe
// code. It must never contain provider responses, configuration data, or
// credentials. A returned error is treated as a generic retry and is not
// included in processor output or durable state.
type CurrentConfigurationLifecycleReconcileResult struct {
	Disposition CurrentConfigurationLifecycleReconcileDisposition
	ErrorCode   string
}

type CurrentConfigurationLifecycleReconciler interface {
	ReconcileCurrentConfigurationLifecycle(
		context.Context,
		CurrentConfigurationLifecycleEvent,
		CurrentConfigurationLifecycleIntent,
	) (CurrentConfigurationLifecycleReconcileResult, error)
}

type CurrentConfigurationLifecycleLeaseTokenGenerator func() (string, error)

type CurrentConfigurationLifecycleProcessorConfig struct {
	PollInterval  time.Duration
	LeaseTTL      time.Duration
	RetryBase     time.Duration
	BatchSize     int
	MaxConcurrent int
	MaxAttempts   int
	ReportFailure func(error)
}

func (c CurrentConfigurationLifecycleProcessorConfig) validate() error {
	if c.PollInterval < minCurrentConfigurationLifecyclePollInterval ||
		c.PollInterval > MaxCurrentConfigurationLifecyclePollInterval ||
		c.LeaseTTL < minCurrentConfigurationLifecycleLeaseTTL ||
		c.LeaseTTL > MaxCurrentConfigurationLifecycleLeaseTTL ||
		c.RetryBase <= 0 || c.RetryBase > MaxCurrentConfigurationLifecycleRetryDelay ||
		c.BatchSize <= 0 || c.BatchSize > MaxCurrentConfigurationLifecycleBatchSize ||
		c.MaxConcurrent <= 0 || c.MaxConcurrent > MaxCurrentConfigurationLifecycleConcurrency ||
		c.MaxConcurrent > c.BatchSize || c.MaxAttempts <= 0 ||
		c.MaxAttempts > MaxCurrentConfigurationLifecycleAttempts || c.ReportFailure == nil {
		return ErrInvalidCurrentConfigurationLifecycleProcessor
	}
	return nil
}

// CurrentConfigurationLifecycleProcessor continuously reconciles the durable
// PostgreSQL outbox. It owns no hidden goroutine or in-memory retry queue; a
// caller starts Run and drains it by cancelling the supplied context.
type CurrentConfigurationLifecycleProcessor struct {
	store      CurrentConfigurationLifecycleStore
	reconciler CurrentConfigurationLifecycleReconciler
	newLease   CurrentConfigurationLifecycleLeaseTokenGenerator
	config     CurrentConfigurationLifecycleProcessorConfig
	wait       func(context.Context, time.Duration) error
}

func NewCurrentConfigurationLifecycleProcessor(
	store CurrentConfigurationLifecycleStore,
	reconciler CurrentConfigurationLifecycleReconciler,
	newLease CurrentConfigurationLifecycleLeaseTokenGenerator,
	config CurrentConfigurationLifecycleProcessorConfig,
) (*CurrentConfigurationLifecycleProcessor, error) {
	if store == nil || reconciler == nil || newLease == nil {
		return nil, ErrInvalidCurrentConfigurationLifecycleProcessor
	}
	if err := config.validate(); err != nil {
		return nil, err
	}
	return &CurrentConfigurationLifecycleProcessor{
		store: store, reconciler: reconciler, newLease: newLease, config: config,
		wait: waitCurrentConfigurationLifecycle,
	}, nil
}

func (p *CurrentConfigurationLifecycleProcessor) Run(ctx context.Context) error {
	if ctx == nil || p == nil {
		return ErrInvalidCurrentConfigurationLifecycleProcessor
	}
	consecutiveFailures := 0
	for {
		delay := p.config.PollInterval
		if err := p.RunOnce(ctx); err != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return ctxErr
			}
			if consecutiveFailures < MaxCurrentConfigurationLifecycleAttempts {
				consecutiveFailures++
			}
			p.config.ReportFailure(err)
			delay = currentConfigurationLifecycleRetryDelay(p.config.PollInterval, consecutiveFailures)
		} else {
			consecutiveFailures = 0
		}
		if err := p.wait(ctx, delay); err != nil {
			return err
		}
	}
}

func (p *CurrentConfigurationLifecycleProcessor) RunOnce(ctx context.Context) error {
	if ctx == nil || p == nil || p.store == nil || p.reconciler == nil || p.newLease == nil {
		return ErrInvalidCurrentConfigurationLifecycleProcessor
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	leaseToken, err := p.newLease()
	if err != nil || !validCurrentConfigurationLifecycleLeaseToken(leaseToken) {
		return ErrInvalidCurrentConfigurationLifecycleProcessor
	}
	events, err := p.store.ClaimCurrentConfigurationLifecycle(
		ctx,
		leaseToken,
		p.config.BatchSize,
		p.config.LeaseTTL,
	)
	if err != nil {
		return fmt.Errorf("claim current configuration lifecycle: %w", err)
	}
	if len(events) > p.config.BatchSize {
		return ErrCurrentConfigurationLifecycleBatchOverflow
	}
	return p.reconcileBatch(ctx, leaseToken, events)
}

func (p *CurrentConfigurationLifecycleProcessor) reconcileBatch(
	ctx context.Context,
	leaseToken string,
	events []CurrentConfigurationLifecycleEvent,
) error {
	if len(events) == 0 {
		return nil
	}
	type item struct {
		index int
		event CurrentConfigurationLifecycleEvent
	}
	jobs := make(chan item)
	results := make([]error, len(events))
	workers := min(p.config.MaxConcurrent, len(events))
	var group sync.WaitGroup
	group.Add(workers)
	for range workers {
		go func() {
			defer group.Done()
			for work := range jobs {
				if ctx.Err() != nil {
					return
				}
				results[work.index] = p.reconcileOne(ctx, leaseToken, work.event)
			}
		}()
	}

send:
	for index, event := range events {
		select {
		case jobs <- item{index: index, event: event}:
		case <-ctx.Done():
			break send
		}
	}
	close(jobs)
	group.Wait()
	if err := ctx.Err(); err != nil {
		return err
	}
	return errors.Join(results...)
}

func (p *CurrentConfigurationLifecycleProcessor) reconcileOne(
	ctx context.Context,
	leaseToken string,
	event CurrentConfigurationLifecycleEvent,
) error {
	intent, err := decodeCurrentConfigurationLifecycleEvent(event, leaseToken)
	if err != nil {
		if markErr := p.store.MarkCurrentConfigurationLifecycleDead(
			ctx, event.EventID, leaseToken, currentConfigurationLifecycleInvalidSnapshot,
		); markErr != nil {
			return fmt.Errorf("mark lifecycle event %q invalid", event.EventID)
		}
		return fmt.Errorf("lifecycle event %q has invalid snapshot", event.EventID)
	}

	result, reconcileErr := p.reconciler.ReconcileCurrentConfigurationLifecycle(ctx, event, intent)
	if err := ctx.Err(); err != nil {
		return err
	}
	if reconcileErr != nil {
		result = CurrentConfigurationLifecycleReconcileResult{
			Disposition: CurrentConfigurationLifecycleRetry,
			ErrorCode:   currentConfigurationLifecycleGenericFailure,
		}
	}
	if !validCurrentConfigurationLifecycleResult(result) {
		result = CurrentConfigurationLifecycleReconcileResult{
			Disposition: CurrentConfigurationLifecycleDead,
			ErrorCode:   "RECONCILE_RESULT_INVALID",
		}
	}

	switch result.Disposition {
	case CurrentConfigurationLifecycleReconciled:
		err = p.store.MarkCurrentConfigurationLifecycleDelivered(ctx, event.EventID, leaseToken)
	case CurrentConfigurationLifecycleRetry:
		if event.AttemptCount >= p.config.MaxAttempts {
			err = p.store.MarkCurrentConfigurationLifecycleDead(ctx, event.EventID, leaseToken, "RETRY_EXHAUSTED")
		} else {
			err = p.store.MarkCurrentConfigurationLifecycleRetry(
				ctx,
				event.EventID,
				leaseToken,
				result.ErrorCode,
				currentConfigurationLifecycleRetryDelay(p.config.RetryBase, event.AttemptCount),
			)
		}
	case CurrentConfigurationLifecycleDead:
		err = p.store.MarkCurrentConfigurationLifecycleDead(ctx, event.EventID, leaseToken, result.ErrorCode)
	}
	if err != nil {
		return fmt.Errorf("complete lifecycle event %q", event.EventID)
	}
	if result.Disposition != CurrentConfigurationLifecycleReconciled {
		return fmt.Errorf("lifecycle event %q disposition %s code %s", event.EventID, result.Disposition, result.ErrorCode)
	}
	return nil
}

func decodeCurrentConfigurationLifecycleEvent(
	event CurrentConfigurationLifecycleEvent,
	leaseToken string,
) (CurrentConfigurationLifecycleIntent, error) {
	if !validCurrentConfigurationLifecycleIdentity(event.EventID) || event.ProjectID <= 0 ||
		!validCurrentConfigurationLifecycleIdentity(event.ConfigurationUUID) || event.Revision <= 0 ||
		event.ActorID <= 0 || event.AttemptCount <= 0 || event.AttemptCount > MaxCurrentConfigurationLifecycleAttempts ||
		event.LeaseToken != leaseToken || len(event.Snapshot) < 2 ||
		len(event.Snapshot) > currentConfigurationLifecycleSnapshotLimit ||
		sha256.Sum256(event.Snapshot) != event.SnapshotDigest {
		return CurrentConfigurationLifecycleIntent{}, ErrInvalidCurrentConfigurationLifecycleProcessor
	}
	intent, err := decodeCurrentConfigurationLifecycleIntent(event.Snapshot, event.EventID)
	if err != nil {
		return CurrentConfigurationLifecycleIntent{}, ErrInvalidCurrentConfigurationLifecycleProcessor
	}
	if intent.ID != event.EventID || intent.Operation != event.Operation || intent.ActorID != event.ActorID {
		return CurrentConfigurationLifecycleIntent{}, ErrInvalidCurrentConfigurationLifecycleProcessor
	}
	var snapshot *CurrentConfigurationLifecycleSnapshot
	switch event.Operation {
	case CurrentConfigurationCreated:
		if intent.Before != nil || intent.After == nil {
			return CurrentConfigurationLifecycleIntent{}, ErrInvalidCurrentConfigurationLifecycleProcessor
		}
		snapshot = intent.After
	case CurrentConfigurationUpdated:
		if intent.Before == nil || intent.After == nil || intent.Before.UUID != intent.After.UUID {
			return CurrentConfigurationLifecycleIntent{}, ErrInvalidCurrentConfigurationLifecycleProcessor
		}
		snapshot = intent.After
	case CurrentConfigurationDeleted:
		if intent.Before == nil || intent.After != nil {
			return CurrentConfigurationLifecycleIntent{}, ErrInvalidCurrentConfigurationLifecycleProcessor
		}
		snapshot = intent.Before
	default:
		return CurrentConfigurationLifecycleIntent{}, ErrInvalidCurrentConfigurationLifecycleProcessor
	}
	if snapshot.ProjectID != event.ProjectID || snapshot.UUID != event.ConfigurationUUID {
		return CurrentConfigurationLifecycleIntent{}, ErrInvalidCurrentConfigurationLifecycleProcessor
	}
	return intent, nil
}

func validCurrentConfigurationLifecycleResult(result CurrentConfigurationLifecycleReconcileResult) bool {
	switch result.Disposition {
	case CurrentConfigurationLifecycleReconciled:
		return result.ErrorCode == ""
	case CurrentConfigurationLifecycleRetry, CurrentConfigurationLifecycleDead:
		return validCurrentConfigurationLifecycleErrorCode(result.ErrorCode)
	default:
		return false
	}
}

func validCurrentConfigurationLifecycleErrorCode(value string) bool {
	if value == "" || len(value) > 128 {
		return false
	}
	for _, character := range value {
		if (character < 'A' || character > 'Z') && (character < '0' || character > '9') && character != '_' {
			return false
		}
	}
	return true
}

func validCurrentConfigurationLifecycleIdentity(value string) bool {
	return value != "" && len(value) <= 128 && value == strings.TrimSpace(value) && !strings.ContainsRune(value, '\x00')
}

func validCurrentConfigurationLifecycleLeaseToken(value string) bool {
	if !validCurrentConfigurationLifecycleIdentity(value) {
		return false
	}
	for _, character := range value {
		if (character < 'a' || character > 'z') && (character < 'A' || character > 'Z') &&
			(character < '0' || character > '9') && character != '.' && character != '_' &&
			character != ':' && character != '-' {
			return false
		}
	}
	return true
}

func currentConfigurationLifecycleRetryDelay(base time.Duration, attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	delay := base
	for current := 1; current < attempt && delay < MaxCurrentConfigurationLifecycleRetryDelay; current++ {
		if delay > MaxCurrentConfigurationLifecycleRetryDelay/2 {
			return MaxCurrentConfigurationLifecycleRetryDelay
		}
		delay *= 2
	}
	return min(delay, MaxCurrentConfigurationLifecycleRetryDelay)
}

func waitCurrentConfigurationLifecycle(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

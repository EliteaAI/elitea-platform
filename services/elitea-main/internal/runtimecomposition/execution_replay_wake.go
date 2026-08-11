package runtimecomposition

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	executionapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/executions"
	outputapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/output"
	"github.com/redis/go-redis/v9"
)

const (
	executionReplayWakeChannel     = "elitea:runtime:execution-replay:wake:v1"
	executionReplayWakeQueueSize   = 1024
	executionReplayWakeHistorySize = 4096
	executionReplayWakeTimeout     = 100 * time.Millisecond
	executionReplayWakeRetryMin    = 250 * time.Millisecond
	executionReplayWakeRetryMax    = 30 * time.Second
)

type executionReplayWake struct {
	ProjectID   string `json:"project_id"`
	ExecutionID string `json:"execution_id"`
	Cursor      uint64 `json:"cursor"`
}

func (w executionReplayWake) valid() bool {
	return w.Cursor > 0 && w.ProjectID != "" && len(w.ProjectID) <= 32 &&
		w.ExecutionID != "" && len(w.ExecutionID) <= 128 &&
		!strings.ContainsAny(w.ProjectID, "\x00\r\n") &&
		!strings.ContainsAny(w.ExecutionID, "\x00\r\n")
}

func (w executionReplayWake) key() string {
	return w.ProjectID + "\x00" + w.ExecutionID
}

// redisExecutionReplayWakeBus carries only a tiny, advisory wake signal. The
// SSE handler always replays PostgreSQL after a wake, so a lost or duplicated
// Redis message cannot lose, forge, or reorder execution output. One shared
// subscription serves every SSE stream in this elitea-main process.
type redisExecutionReplayWakeBus struct {
	client *redis.Client
	logger *slog.Logger

	notify chan executionReplayWake

	mu          sync.Mutex
	nextWaiter  uint64
	waiters     map[string]map[uint64]chan struct{}
	highWater   map[string]uint64
	historyKeys []string
	queueWarned atomic.Bool
}

func newRedisExecutionReplayWakeBus(client *redis.Client, logger *slog.Logger) (*redisExecutionReplayWakeBus, error) {
	if client == nil || logger == nil {
		return nil, errors.New("execution replay wake Redis client and logger are required")
	}
	return &redisExecutionReplayWakeBus{
		client:    client,
		logger:    logger,
		notify:    make(chan executionReplayWake, executionReplayWakeQueueSize),
		waiters:   make(map[string]map[uint64]chan struct{}),
		highWater: make(map[string]uint64),
	}, nil
}

// Notify is deliberately non-blocking. Local streams wake immediately after
// the durable transaction commits; the bounded Redis queue fans the same wake
// to other replicas. Queue pressure or Redis loss falls back to PostgreSQL
// polling and therefore affects latency only, never correctness.
func (b *redisExecutionReplayWakeBus) Notify(projectID, executionID string, cursor uint64) {
	if b == nil {
		return
	}
	wake := executionReplayWake{ProjectID: projectID, ExecutionID: executionID, Cursor: cursor}
	if !wake.valid() {
		return
	}
	b.dispatch(wake)
	select {
	case b.notify <- wake:
	default:
		if b.queueWarned.CompareAndSwap(false, true) {
			b.logger.Warn("execution replay wake queue is full; bounded polling remains active")
		}
	}
}

func (b *redisExecutionReplayWakeBus) Wait(ctx context.Context, projectID, executionID string, afterCursor uint64) (bool, error) {
	if b == nil || ctx == nil || projectID == "" || executionID == "" ||
		len(projectID) > 32 || len(executionID) > 128 {
		return false, errors.New("execution replay wake wait is invalid")
	}
	key := executionReplayWake{ProjectID: projectID, ExecutionID: executionID}.key()
	wake := make(chan struct{}, 1)

	b.mu.Lock()
	if b.highWater[key] > afterCursor {
		b.mu.Unlock()
		return false, nil
	}
	b.nextWaiter++
	waiterID := b.nextWaiter
	if b.waiters[key] == nil {
		b.waiters[key] = make(map[uint64]chan struct{})
	}
	b.waiters[key][waiterID] = wake
	b.mu.Unlock()

	defer b.removeWaiter(key, waiterID)
	timer := time.NewTimer(phaseOneReplayPollInterval)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false, ctx.Err()
	case <-wake:
		return false, nil
	case <-timer.C:
		return true, nil
	}
}

func (b *redisExecutionReplayWakeBus) Run(ctx context.Context) error {
	if b == nil || b.client == nil || ctx == nil {
		return errors.New("execution replay wake lifecycle is incomplete")
	}
	go b.runPublisher(ctx)
	retryDelay := executionReplayWakeRetryMin
	for ctx.Err() == nil {
		pubsub := b.client.Subscribe(ctx, executionReplayWakeChannel)
		if _, err := pubsub.Receive(ctx); err != nil {
			_ = pubsub.Close()
			if ctx.Err() != nil {
				return ctx.Err()
			}
			b.logger.Warn("execution replay wake subscription failed; bounded polling remains active", "err", err)
			if err := waitForReplayWakeRetry(ctx, retryDelay); err != nil {
				return err
			}
			retryDelay = min(retryDelay*2, executionReplayWakeRetryMax)
			continue
		}
		retryDelay = executionReplayWakeRetryMin
		messages := pubsub.Channel(redis.WithChannelSize(executionReplayWakeQueueSize))
		closed := false
		for !closed {
			select {
			case <-ctx.Done():
				_ = pubsub.Close()
				return ctx.Err()
			case message, ok := <-messages:
				if !ok {
					closed = true
					continue
				}
				var wake executionReplayWake
				if json.Unmarshal([]byte(message.Payload), &wake) != nil || !wake.valid() {
					continue
				}
				b.dispatch(wake)
			}
		}
		_ = pubsub.Close()
		if ctx.Err() == nil {
			b.logger.Warn("execution replay wake subscription stopped; bounded polling remains active")
			if err := waitForReplayWakeRetry(ctx, retryDelay); err != nil {
				return err
			}
			retryDelay = min(retryDelay*2, executionReplayWakeRetryMax)
		}
	}
	return ctx.Err()
}

func (b *redisExecutionReplayWakeBus) runPublisher(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case wake := <-b.notify:
			b.queueWarned.Store(false)
			encoded, err := json.Marshal(wake)
			if err != nil {
				continue
			}
			publishContext, cancel := context.WithTimeout(ctx, executionReplayWakeTimeout)
			err = b.client.Publish(publishContext, executionReplayWakeChannel, encoded).Err()
			cancel()
			if err != nil && ctx.Err() == nil {
				b.logger.Warn("execution replay wake publish failed; bounded polling remains active", "err", err)
			}
		}
	}
}

func waitForReplayWakeRetry(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (b *redisExecutionReplayWakeBus) dispatch(wake executionReplayWake) {
	key := wake.key()
	b.mu.Lock()
	if wake.Cursor > b.highWater[key] {
		if _, exists := b.highWater[key]; !exists {
			if len(b.historyKeys) == executionReplayWakeHistorySize {
				delete(b.highWater, b.historyKeys[0])
				copy(b.historyKeys, b.historyKeys[1:])
				b.historyKeys = b.historyKeys[:len(b.historyKeys)-1]
			}
			b.historyKeys = append(b.historyKeys, key)
		}
		b.highWater[key] = wake.Cursor
	}
	for _, waiter := range b.waiters[key] {
		select {
		case waiter <- struct{}{}:
		default:
		}
	}
	b.mu.Unlock()
}

func (b *redisExecutionReplayWakeBus) removeWaiter(key string, waiterID uint64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.waiters[key], waiterID)
	if len(b.waiters[key]) == 0 {
		delete(b.waiters, key)
	}
}

type wakingNodeEventIngestor struct {
	next outputNodeEventIngestor
	wake *redisExecutionReplayWakeBus
}

type outputNodeEventIngestor interface {
	IngestNodeEvent(context.Context, outputapp.NodeEventFrame) (outputapp.ProjectionOutcome, error)
}

func (i wakingNodeEventIngestor) IngestNodeEvent(ctx context.Context, frame outputapp.NodeEventFrame) (outputapp.ProjectionOutcome, error) {
	outcome, err := i.next.IngestNodeEvent(ctx, frame)
	if err == nil && !agentTerminalNodeEvent(frame.BrowserData) {
		i.wake.Notify(frame.ProjectionProjectID, frame.Fence.ExecutionID, outcome.Cursor)
	}
	return outcome, err
}

func agentTerminalNodeEvent(data []byte) bool {
	var event struct {
		Type string `json:"type"`
	}
	if json.Unmarshal(data, &event) != nil {
		return false
	}
	switch event.Type {
	case "full_message", "agent_hitl_interrupt", "mcp_authorization_required":
		return true
	default:
		return false
	}
}

type wakingAgentExecutionIngestor struct {
	next outputAgentExecutionIngestor
	wake *redisExecutionReplayWakeBus
}

type outputAgentExecutionIngestor interface {
	IngestAgent(context.Context, outputapp.AgentExecutionFrame) (outputapp.ProjectionOutcome, error)
}

func (i wakingAgentExecutionIngestor) IngestAgent(ctx context.Context, frame outputapp.AgentExecutionFrame) (outputapp.ProjectionOutcome, error) {
	outcome, err := i.next.IngestAgent(ctx, frame)
	if err == nil {
		i.wake.Notify(frame.ProjectionProjectID, frame.Fence.ExecutionID, outcome.Cursor)
	}
	return outcome, err
}

var (
	_ executionapi.ReplayWaiter = (*redisExecutionReplayWakeBus)(nil)
	_ publisherRunner           = (*redisExecutionReplayWakeBus)(nil)
)

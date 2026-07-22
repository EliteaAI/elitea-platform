// Package nats is the gateway's hardened NATS JetStream client.
//
// It backs the budget-enforcement path (design §8): the authoritative budget
// counters live in a JetStream *counter stream* incremented atomically with the
// Nats-Incr header, the 80% soft-alert cooldown lives in a KV bucket, and the
// write-behind deltas are published to a limits stream.
//
// Hardening (design §8.5, a Build prerequisite): the connection sets
// Timeout=1s, and EVERY counter / KV operation is wrapped in
// context.WithTimeout(ctx, OpTimeout=150ms) so a NATS network partition trips
// the circuit breaker instead of hanging the /llm request. A lightweight
// circuit breaker (sony/gobreaker) wraps the counter+KV operations; callers use
// its state to drive the tiered-hybrid fail-mode FSM (§8.5).
//
// Nats-Incr reality (see the "nats-incr-is-stream-counter" note): NATS 2.12's
// atomic increment is a stream feature (StreamConfig.AllowMsgCounter), NOT a KV
// method — nats.go v1.52.0 exposes no KeyValue.Incr(). The counter is therefore
// a dedicated stream (GATEWAY_BUDGET) whose per-subject running total is
// returned in PubAck.Value on publish and read back via GetLastMsgForSubject.
package nats

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/sony/gobreaker/v2"
)

const (
	// ConnectTimeout bounds the initial dial and every request/reply the client
	// makes; a partition fails fast rather than hanging (design §8.5).
	ConnectTimeout = 1 * time.Second

	// OpTimeout bounds every individual counter / KV operation. Without it a
	// NATS partition hangs the request instead of tripping the breaker (§8.5).
	OpTimeout = 150 * time.Millisecond

	// IncrHeader is the NATS 2.12 atomic-increment header. nats.go v1.52.0 does
	// not define it (the KeyValue interface has no Incr), so we set it directly
	// on the published message; the counter stream (AllowMsgCounter) applies it
	// and returns the new running total in PubAck.Value.
	IncrHeader = "Nats-Incr"

	// BudgetStream is the counter stream holding int64 nano-USD budget counters,
	// one running total per subject gateway.budget.<scope>.<id>.<period>.
	BudgetStream = "GATEWAY_BUDGET"
	// budgetSubjectPrefix is the wildcard the counter stream binds.
	budgetSubjectRoot = "gateway.budget.counter"

	// AlertCooldownBucket is the KV bucket enforcing the 80% soft-alert cooldown
	// via kv.Create (SETNX-equivalent) + bucket TTL (design §8.3).
	AlertCooldownBucket = "GATEWAY_ALERT_COOLDOWN"

	// DeltasStream is the write-behind stream (§8.6); the scheduler drains it.
	DeltasStream = "GATEWAY_BUDGET_DELTAS"
	// DeltaSubject is the write-behind delta subject (§8.6).
	DeltaSubject = "gateway.budget.delta"
)

// ErrUnavailable is returned when the circuit breaker is open or a NATS
// operation exceeds OpTimeout. Callers (the governance store) map it onto the
// tiered-hybrid fail-mode FSM (§8.5) — it is an infrastructure signal, never a
// budget-policy decision.
var ErrUnavailable = errors.New("nats: unavailable")

// Config is the resolved NATS wiring for the gateway.
type Config struct {
	// URL is the NATS server URL (nats://host:4222). Empty disables NATS wiring
	// (the gateway then runs without budget enforcement — dev/test only).
	URL string
	// Name identifies this client in NATS monitoring.
	Name string
	// CBFailureThreshold trips the breaker after this many consecutive failures
	// (design §8.5, LLM_BUDGET_CB_FAILURE_THRESHOLD, default 3).
	CBFailureThreshold uint32
	// CBOpenDuration is how long the breaker stays open before probing half-open
	// (design §8.5, LLM_BUDGET_CB_OPEN_DURATION_SEC, default 10s).
	CBOpenDuration time.Duration
	// Replicas is the KV/stream replica count (1 scale-1, ≥3 HA). Applied when
	// this client creates the assets; a mismatch with an existing asset is left
	// untouched (bootstrap owns the authoritative config).
	Replicas int
}

// withDefaults fills zero values with the design §8.5 defaults.
func (c Config) withDefaults() Config {
	if c.Name == "" {
		c.Name = "elitea-llm-gateway"
	}
	if c.CBFailureThreshold == 0 {
		c.CBFailureThreshold = 3
	}
	if c.CBOpenDuration <= 0 {
		c.CBOpenDuration = 10 * time.Second
	}
	if c.Replicas <= 0 {
		c.Replicas = 1
	}
	return c
}

// conn is the minimal surface of *nats.Conn the client uses; it lets tests
// substitute a fake without a live server.
type conn interface {
	Close()
	IsClosed() bool
}

// The following narrow interfaces are the exact operation surface the
// breaker-wrapped methods call through. The real nats.go JetStream/Stream/KV
// types satisfy them, and tests inject fakes so the hardening logic (timeout,
// breaker, error mapping, counter parsing) is verifiable without a live server.

// publisher is the JetStream publish surface (IncrBudget, PublishDelta).
type publisher interface {
	PublishMsg(ctx context.Context, m *nats.Msg, opts ...jetstream.PublishOpt) (*jetstream.PubAck, error)
}

// counterReader is the last-message-for-subject read surface (ReadBudget).
type counterReader interface {
	GetLastMsgForSubject(ctx context.Context, subject string) (*jetstream.RawStreamMsg, error)
}

// kvCreator is the SETNX-equivalent surface (TryAlertCooldown).
type kvCreator interface {
	Create(ctx context.Context, key string, value []byte, opts ...jetstream.KVCreateOpt) (uint64, error)
}

// assetProvisioner is the JetStream admin surface ensureAssets needs. The real
// jetstream.JetStream satisfies it; tests inject a fake so asset provisioning is
// verifiable without a live server.
type assetProvisioner interface {
	CreateOrUpdateStream(ctx context.Context, cfg jetstream.StreamConfig) (jetstream.Stream, error)
	CreateOrUpdateKeyValue(ctx context.Context, cfg jetstream.KeyValueConfig) (jetstream.KeyValue, error)
	Stream(ctx context.Context, stream string) (jetstream.Stream, error)
}

// Client is the hardened JetStream client. It is safe for concurrent use.
type Client struct {
	cfg      Config
	nc       conn
	js       jetstream.JetStream
	pub      publisher
	budget   counterReader
	cooldown kvCreator
	breaker  *gobreaker.CircuitBreaker[uint64]

	// onStateChange, if set, is invoked on every breaker transition — the
	// recovery-reconciliation goroutine (§8.5) subscribes here.
	onStateChange func(from, to gobreaker.State)
}

// Connect dials NATS with the hardened timeout and ensures the budget counter
// stream, cooldown KV bucket, and write-behind deltas stream exist.
func Connect(ctx context.Context, cfg Config) (*Client, error) {
	cfg = cfg.withDefaults()
	if cfg.URL == "" {
		return nil, fmt.Errorf("nats: empty URL")
	}
	nc, err := nats.Connect(cfg.URL,
		nats.Name(cfg.Name),
		nats.Timeout(ConnectTimeout),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(500*time.Millisecond),
	)
	if err != nil {
		return nil, fmt.Errorf("nats: connect: %w", err)
	}
	js, err := jetstream.New(nc)
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("nats: jetstream: %w", err)
	}
	c := &Client{cfg: cfg, nc: nc, js: js, pub: js}
	c.breaker = newBreaker(cfg, func(from, to gobreaker.State) {
		if c.onStateChange != nil {
			c.onStateChange(from, to)
		}
	})
	if err := c.ensureAssets(ctx, js); err != nil {
		nc.Close()
		return nil, err
	}
	return c, nil
}

// newBreaker builds the KV/counter circuit breaker (design §8.5). It trips after
// CBFailureThreshold consecutive failures within a 5s window and probes
// half-open after CBOpenDuration.
func newBreaker(cfg Config, onChange func(from, to gobreaker.State)) *gobreaker.CircuitBreaker[uint64] {
	threshold := cfg.CBFailureThreshold
	return gobreaker.NewCircuitBreaker[uint64](gobreaker.Settings{
		Name:        "nats-budget",
		MaxRequests: 1, // half-open probes one request at a time
		Interval:    5 * time.Second,
		Timeout:     cfg.CBOpenDuration,
		ReadyToTrip: func(counts gobreaker.Counts) bool {
			return counts.ConsecutiveFailures >= threshold
		},
		OnStateChange: func(_ string, from, to gobreaker.State) {
			if onChange != nil {
				onChange(from, to)
			}
		},
	})
}

// OnBreakerStateChange registers a callback invoked on every breaker transition.
// The recovery-reconciliation goroutine (§8.5) uses this to fire on the
// open→half-open→closed edge. It MUST be called before concurrent use.
func (c *Client) OnBreakerStateChange(fn func(from, to gobreaker.State)) {
	c.onStateChange = fn
}

// BreakerState reports the current circuit-breaker state (design §8.5 FSM input).
func (c *Client) BreakerState() gobreaker.State { return c.breaker.State() }

// ensureAssets idempotently creates the counter stream, cooldown KV bucket, and
// deltas stream. It is safe to run on every startup; an existing asset with a
// compatible config is reused (CreateOrUpdateStream), and the bootstrap chart
// remains the authoritative owner of retention/replica tuning.
func (c *Client) ensureAssets(ctx context.Context, prov assetProvisioner) error {
	sctx, cancel := context.WithTimeout(ctx, ConnectTimeout)
	defer cancel()

	// Budget counter stream: AllowMsgCounter enables Nats-Incr running totals.
	if _, err := prov.CreateOrUpdateStream(sctx, jetstream.StreamConfig{
		Name:            BudgetStream,
		Subjects:        []string{budgetSubjectRoot + ".>"},
		Storage:         jetstream.FileStorage,
		Replicas:        c.cfg.Replicas,
		Retention:       jetstream.LimitsPolicy,
		AllowMsgCounter: true,
		// Only the running total matters; keep a single message per subject.
		MaxMsgsPerSubject: 1,
	}); err != nil {
		return fmt.Errorf("nats: ensure budget counter stream: %w", err)
	}

	// Alert-cooldown KV bucket (real KV; SETNX via kv.Create + bucket TTL).
	kv, err := prov.CreateOrUpdateKeyValue(sctx, jetstream.KeyValueConfig{
		Bucket:   AlertCooldownBucket,
		Storage:  jetstream.FileStorage,
		Replicas: c.cfg.Replicas,
		History:  1,
	})
	if err != nil {
		return fmt.Errorf("nats: ensure cooldown kv: %w", err)
	}
	c.cooldown = kv

	// Bind the budget counter stream handle for reads/increments.
	st, err := prov.Stream(sctx, BudgetStream)
	if err != nil {
		return fmt.Errorf("nats: bind budget stream: %w", err)
	}
	c.budget = st
	return nil
}

// BudgetSubject builds the counter subject for a budget scope/period. The
// components are sanitised to the NATS token charset by the caller's own
// identifiers (scope ∈ {project,team,customer,global}; scope_id numeric/uuid;
// period unix seconds), so no token contains a dot or space.
func BudgetSubject(scope, scopeID string, periodStartUnix int64) string {
	return fmt.Sprintf("%s.%s.%s.%d", budgetSubjectRoot, scope, scopeID, periodStartUnix)
}

// IncrBudget atomically adds deltaNano (int64 nano-USD, may be negative for a
// correction) to the counter for subject and returns the new running total.
// The whole operation is breaker-guarded and OpTimeout-bounded (design §8.5).
func (c *Client) IncrBudget(ctx context.Context, subject string, deltaNano int64) (int64, error) {
	v, err := c.breaker.Execute(func() (uint64, error) {
		octx, cancel := context.WithTimeout(ctx, OpTimeout)
		defer cancel()
		msg := &nats.Msg{
			Subject: subject,
			Header:  nats.Header{IncrHeader: []string{strconv.FormatInt(deltaNano, 10)}},
		}
		ack, err := c.pub.PublishMsg(octx, msg)
		if err != nil {
			return 0, err
		}
		total, perr := strconv.ParseInt(ack.Value, 10, 64)
		if perr != nil {
			// A non-counter stream (or an empty val) is a config error, not a
			// transient one — surface it without tripping on parse noise.
			return 0, fmt.Errorf("nats: counter ack %q: %w", ack.Value, perr)
		}
		return uint64(total), nil
	})
	if err != nil {
		return 0, mapErr(err)
	}
	return int64(v), nil
}

// ReadBudget returns the current running total (int64 nano-USD) for subject, or
// 0 if the counter has never been incremented this period. Breaker-guarded and
// OpTimeout-bounded.
func (c *Client) ReadBudget(ctx context.Context, subject string) (int64, error) {
	v, err := c.breaker.Execute(func() (uint64, error) {
		octx, cancel := context.WithTimeout(ctx, OpTimeout)
		defer cancel()
		raw, err := c.budget.GetLastMsgForSubject(octx, subject)
		if err != nil {
			if errors.Is(err, jetstream.ErrMsgNotFound) {
				return 0, nil // never incremented this period → 0
			}
			return 0, err
		}
		total, perr := counterValue(raw)
		if perr != nil {
			return 0, perr
		}
		return uint64(total), nil
	})
	if err != nil {
		return 0, mapErr(err)
	}
	return int64(v), nil
}

// counterValue extracts the running total from a counter-stream message. NATS
// stores the total as the message payload (a decimal string); the Nats-Incr
// header on the stored message carries the last applied delta, not the total.
func counterValue(raw *jetstream.RawStreamMsg) (int64, error) {
	if raw == nil || len(raw.Data) == 0 {
		return 0, nil
	}
	total, err := strconv.ParseInt(string(raw.Data), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("nats: counter payload %q: %w", raw.Data, err)
	}
	return total, nil
}

// TryAlertCooldown attempts to claim the soft-alert cooldown for key. It returns
// true if the alert should fire (the key was freshly created) and false if a
// cooldown is already active (kv.Create failed with ErrKeyExists). The bucket's
// TTL expires the key so the next crossing after the window re-fires (§8.3).
func (c *Client) TryAlertCooldown(ctx context.Context, key string) (bool, error) {
	v, err := c.breaker.Execute(func() (uint64, error) {
		octx, cancel := context.WithTimeout(ctx, OpTimeout)
		defer cancel()
		if _, err := c.cooldown.Create(octx, key, []byte("1")); err != nil {
			if errors.Is(err, jetstream.ErrKeyExists) {
				return 0, nil // cooldown active → suppress
			}
			return 0, err
		}
		return 1, nil // freshly claimed → fire
	})
	if err != nil {
		return false, mapErr(err)
	}
	return v == 1, nil
}

// PublishDelta publishes a write-behind delta to GATEWAY_BUDGET_DELTAS with
// Nats-Msg-Id=eventID for publish-side dedup within the stream's duplicate
// window (design §8.6). It is breaker-guarded and OpTimeout-bounded.
func (c *Client) PublishDelta(ctx context.Context, eventID string, payload []byte) error {
	_, err := c.breaker.Execute(func() (uint64, error) {
		octx, cancel := context.WithTimeout(ctx, OpTimeout)
		defer cancel()
		msg := &nats.Msg{
			Subject: DeltaSubject,
			Data:    payload,
			Header:  nats.Header{jetstream.MsgIDHeader: []string{eventID}},
		}
		if _, err := c.pub.PublishMsg(octx, msg); err != nil {
			return 0, err
		}
		return 0, nil
	})
	if err != nil {
		return mapErr(err)
	}
	return nil
}

// JetStream exposes the underlying JetStream handle for the scheduler's
// write-behind consumer wiring (§8.6). The gateway itself does not consume.
func (c *Client) JetStream() jetstream.JetStream { return c.js }

// Close tears down the NATS connection.
func (c *Client) Close() {
	if c.nc != nil && !c.nc.IsClosed() {
		c.nc.Close()
	}
}

// mapErr normalises breaker/timeout errors to ErrUnavailable so the governance
// store can distinguish an infrastructure failure (→ tiered-hybrid fallback)
// from a real error. Config/parse errors pass through unchanged.
func mapErr(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, gobreaker.ErrOpenState),
		errors.Is(err, gobreaker.ErrTooManyRequests),
		errors.Is(err, context.DeadlineExceeded),
		errors.Is(err, context.Canceled),
		errors.Is(err, nats.ErrTimeout),
		errors.Is(err, nats.ErrNoResponders),
		errors.Is(err, nats.ErrConnectionClosed):
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	default:
		return err
	}
}

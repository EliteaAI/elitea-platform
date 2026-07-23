// Package natsbus is the NATS-backed EventBus for elitea-main.
//
// It is a drop-in replacement for internal/infra/redis.EventBus, re-pointing
// the platform event stream from Redis pub/sub onto NATS core pub/sub (design
// §8.1 "the EventBus is re-pointed from Redis pub/sub to NATS gateway.events.*";
// ADR-0015 "events on gateway.events.*"). It carries the identical
// redis.Event envelope on the wire so existing consumers — the webhook
// dispatcher (internal/api/webhook) and the project SSE handler
// (internal/api/v2/events) — decode messages unchanged; only the transport
// differs.
//
// Channel↔subject mapping. Redis channels use ':' as a separator
// ("project:123:events", "elitea:*"); NATS subjects use '.' and reserve '*'/'>'
// as single-/multi-token wildcards. subjectFor translates a Redis channel to a
// NATS subject by replacing ':' with '.' under a fixed root, so
// "project:123:events" → "gateway.events.project.123.events" and the
// "elitea:*" catch-all → "gateway.events.>" (NATS multi-token wildcard). The
// gateway.events.* / gateway.events.> subject space is exactly the one the
// design/ADR reserve for soft-alert and governance events.
//
// Soft-alert path (design §8.3): the gateway emits an alert event on
// gateway.events.<...> when accumulated_cost/hard_limit crosses the configured
// threshold; elitea-main subscribers receive it here. The alert payload
// contract lives in the events package (events.SoftAlertPayload).
//
// Every operation is bounded: connection Timeout is 1s (matching the gateway's
// NATS client hardening, design §8.5) and Publish flushes so a failed send
// surfaces synchronously rather than silently buffering.
package natsbus

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/nats-io/nats.go"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/redis"
)

// SubjectRoot is the reserved subject prefix for all platform events on NATS
// (design/ADR: gateway.events.*). Every Redis channel is mapped under it.
const SubjectRoot = "gateway.events"

// ConnectTimeout bounds the initial dial and every request the client makes so
// a NATS partition fails fast rather than hanging (design §8.5, matches the
// gateway NATS client's 1s Timeout).
const ConnectTimeout = 1 * time.Second

// natsConn is the minimal surface of *nats.Conn the bus uses. It lets tests
// substitute a fake without a live server (same narrow-interface pattern as the
// gateway's internal/infra/nats client).
type natsConn interface {
	Publish(subj string, data []byte) error
	ChanSubscribe(subj string, ch chan *nats.Msg) (subscription, error)
	FlushTimeout(timeout time.Duration) error
	RTT() (time.Duration, error)
	Drain() error
	Close()
}

// subscription is the minimal surface of *nats.Subscription the bus needs
// (drain on teardown). Abstracting it makes subscription cleanup observable in
// tests without a live server.
type subscription interface {
	Drain() error
}

// realConn adapts a *nats.Conn to natsConn. Publish/FlushTimeout/RTT/Drain/Close
// are promoted from the embedded connection unchanged; only ChanSubscribe is
// overridden to return the narrower subscription interface (the concrete
// *nats.Subscription already satisfies it).
type realConn struct{ *nats.Conn }

func (c realConn) ChanSubscribe(subj string, ch chan *nats.Msg) (subscription, error) {
	return c.Conn.ChanSubscribe(subj, ch)
}

// EventBus publishes and subscribes to platform events over NATS core pub/sub.
// Its method set mirrors redis.EventBus so it is a drop-in at the call sites.
type EventBus struct {
	conn   natsConn
	source string
}

// Connect dials NATS and returns an EventBus. url is the NATS server URL
// (nats://host:4222); name identifies the client in NATS monitoring; source is
// stamped into every published Event. A dial failure is returned to the caller
// (main.go treats it as non-fatal and falls back to Redis).
func Connect(url, name, source string) (*EventBus, error) {
	nc, err := nats.Connect(url,
		nats.Name(name),
		nats.Timeout(ConnectTimeout),
		nats.MaxReconnects(-1),
	)
	if err != nil {
		return nil, fmt.Errorf("natsbus: connect: %w", err)
	}
	return New(realConn{Conn: nc}, source), nil
}

// New wraps an already-connected NATS connection. Exposed for wiring and tests.
func New(conn natsConn, source string) *EventBus {
	return &EventBus{conn: conn, source: source}
}

// subjectFor maps a Redis channel name to a NATS subject under SubjectRoot.
// ':' → '.'; a trailing ':*' (Redis catch-all) becomes the NATS multi-token
// wildcard '>' so an "elitea:*" subscription still receives every event.
func subjectFor(channel string) string {
	if channel == "" {
		return SubjectRoot
	}
	// Bare "*" Redis catch-all matches every channel → NATS "root.>".
	if channel == "*" {
		return SubjectRoot + ".>"
	}
	// Redis "prefix:*" catch-all → NATS "root.prefix.>" multi-token wildcard.
	if strings.HasSuffix(channel, ":*") {
		prefix := strings.TrimSuffix(channel, ":*")
		prefix = strings.ReplaceAll(prefix, ":", ".")
		if prefix == "" {
			return SubjectRoot + ".>"
		}
		return SubjectRoot + "." + prefix + ".>"
	}
	return SubjectRoot + "." + strings.ReplaceAll(channel, ":", ".")
}

// Publish marshals payload into a redis.Event envelope and publishes it to the
// NATS subject derived from channel. It flushes so a transport error surfaces
// synchronously (bounded by ConnectTimeout) rather than being silently buffered.
func (eb *EventBus) Publish(_ context.Context, channel string, eventType string, payload interface{}) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("natsbus: marshal payload: %w", err)
	}

	evt := redis.Event{
		Type:      eventType,
		Source:    eb.source,
		Payload:   data,
		Timestamp: time.Now().UTC(),
	}

	msg, err := json.Marshal(evt)
	if err != nil {
		return fmt.Errorf("natsbus: marshal event: %w", err)
	}

	if err := eb.conn.Publish(subjectFor(channel), msg); err != nil {
		return fmt.Errorf("natsbus: publish: %w", err)
	}
	if err := eb.conn.FlushTimeout(ConnectTimeout); err != nil {
		return fmt.Errorf("natsbus: flush: %w", err)
	}
	return nil
}

// Subscribe asynchronously consumes events on the subject derived from channel,
// decoding each into a redis.Event and invoking handler. It reuses
// redis.EventHandler so the webhook dispatcher's HandleEvent(ctx, redis.Event)
// method value is passed unchanged and both buses share one signature. The
// goroutine exits (and drains the subscription) when ctx is cancelled. A
// malformed message is logged and skipped; a handler error is logged but does
// not stop the loop — identical semantics to redis.EventBus.Subscribe.
func (eb *EventBus) Subscribe(ctx context.Context, channel string, handler redis.EventHandler) {
	subject := subjectFor(channel)
	msgCh := make(chan *nats.Msg, 64)
	sub, err := eb.conn.ChanSubscribe(subject, msgCh)
	if err != nil {
		slog.Error("natsbus: subscribe failed", "err", err, "subject", subject)
		return
	}

	go func() {
		defer func() { _ = sub.Drain() }()
		for {
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-msgCh:
				if !ok {
					return
				}
				var evt redis.Event
				if err := json.Unmarshal(msg.Data, &evt); err != nil {
					slog.Error("natsbus: unmarshal event", "err", err, "subject", subject)
					continue
				}
				if err := handler(ctx, evt); err != nil {
					slog.Error("natsbus: handler error", "err", err, "subject", subject, "type", evt.Type)
				}
			}
		}
	}()
}

// Raw returns a receive-only channel of decoded events for a channel, plus a
// cancel func that drains the underlying subscription. The project SSE handler
// (internal/api/v2/events) uses this so it can multiplex events with its own
// heartbeat ticker instead of supplying a callback. The channel closes when the
// caller invokes cancel or ctx is cancelled.
func (eb *EventBus) Raw(ctx context.Context, channel string) (<-chan redis.Event, func(), error) {
	subject := subjectFor(channel)
	msgCh := make(chan *nats.Msg, 64)
	sub, err := eb.conn.ChanSubscribe(subject, msgCh)
	if err != nil {
		return nil, nil, fmt.Errorf("natsbus: subscribe: %w", err)
	}

	out := make(chan redis.Event, 64)
	done := make(chan struct{})
	cancel := func() {
		select {
		case <-done:
		default:
			close(done)
		}
	}

	go func() {
		defer close(out)
		defer func() { _ = sub.Drain() }()
		for {
			select {
			case <-ctx.Done():
				return
			case <-done:
				return
			case msg, ok := <-msgCh:
				if !ok {
					return
				}
				var evt redis.Event
				if err := json.Unmarshal(msg.Data, &evt); err != nil {
					slog.Error("natsbus: unmarshal event", "err", err, "subject", subject)
					continue
				}
				select {
				case out <- evt:
				case <-ctx.Done():
					return
				case <-done:
					return
				}
			}
		}
	}()

	return out, cancel, nil
}

// Ping verifies connectivity via the connection round-trip time. It satisfies
// the health.Checker interface (internal/api/health) so /health/ready reports
// NATS the same way it reported Redis.
func (eb *EventBus) Ping(_ context.Context) error {
	if _, err := eb.conn.RTT(); err != nil {
		return fmt.Errorf("natsbus: ping: %w", err)
	}
	return nil
}

// Close drains in-flight messages then closes the connection. Drain is
// preferred over a bare Close so buffered subscription messages are processed
// (nats.go guidance). A drain error falls back to Close.
func (eb *EventBus) Close() {
	if err := eb.conn.Drain(); err != nil {
		eb.conn.Close()
	}
}

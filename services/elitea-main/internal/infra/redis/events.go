package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

type Event struct {
	Type      string          `json:"type"`
	Source    string          `json:"source"`
	Payload   json.RawMessage `json:"payload"`
	Timestamp time.Time       `json:"timestamp"`
}

type EventBus struct {
	client *goredis.Client
	source string
}

func NewEventBus(client *goredis.Client, source string) *EventBus {
	return &EventBus{client: client, source: source}
}

func (eb *EventBus) Publish(ctx context.Context, channel string, eventType string, payload interface{}) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("eventbus: marshal payload: %w", err)
	}

	evt := Event{
		Type:      eventType,
		Source:    eb.source,
		Payload:   data,
		Timestamp: time.Now().UTC(),
	}

	msg, err := json.Marshal(evt)
	if err != nil {
		return fmt.Errorf("eventbus: marshal event: %w", err)
	}

	return eb.client.Publish(ctx, channel, msg).Err()
}

type EventHandler func(ctx context.Context, event Event) error

func (eb *EventBus) Subscribe(ctx context.Context, channel string, handler EventHandler) {
	sub := eb.client.Subscribe(ctx, channel)

	go func() {
		defer func() { _ = sub.Close() }()
		ch := sub.Channel()

		for {
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-ch:
				if !ok {
					return
				}
				var evt Event
				if err := json.Unmarshal([]byte(msg.Payload), &evt); err != nil {
					slog.Error("eventbus: unmarshal event", "err", err, "channel", channel)
					continue
				}
				if err := handler(ctx, evt); err != nil {
					slog.Error("eventbus: handler error", "err", err, "channel", channel, "type", evt.Type)
				}
			}
		}
	}()
}

func (eb *EventBus) Ping(ctx context.Context) error {
	return eb.client.Ping(ctx).Err()
}

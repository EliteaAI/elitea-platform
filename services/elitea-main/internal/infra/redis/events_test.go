package redis_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"

	infraredis "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/redis"
)

func skipIfNoRedis(t *testing.T, rdb *goredis.Client) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("Redis not available: %v", err)
	}
}

func TestEventBus_PublishSubscribe(t *testing.T) {
	rdb := goredis.NewClient(&goredis.Options{Addr: "localhost:6379"})
	skipIfNoRedis(t, rdb)
	defer rdb.Close()

	eb := infraredis.NewEventBus(rdb, "test-service")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	received := make(chan infraredis.Event, 1)
	eb.Subscribe(ctx, "test:events", func(_ context.Context, evt infraredis.Event) error {
		received <- evt
		return nil
	})

	time.Sleep(50 * time.Millisecond)

	payload := map[string]string{"key": "value"}
	if err := eb.Publish(ctx, "test:events", "test.created", payload); err != nil {
		t.Fatalf("publish failed: %v", err)
	}

	select {
	case evt := <-received:
		if evt.Type != "test.created" {
			t.Errorf("expected type test.created, got %q", evt.Type)
		}
		if evt.Source != "test-service" {
			t.Errorf("expected source test-service, got %q", evt.Source)
		}
		var p map[string]string
		json.Unmarshal(evt.Payload, &p)
		if p["key"] != "value" {
			t.Errorf("expected payload key=value, got %v", p)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for event")
	}
}

func TestEventBus_Ping(t *testing.T) {
	rdb := goredis.NewClient(&goredis.Options{Addr: "localhost:6379"})
	skipIfNoRedis(t, rdb)
	defer rdb.Close()

	eb := infraredis.NewEventBus(rdb, "test-service")
	if err := eb.Ping(context.Background()); err != nil {
		t.Fatalf("expected ping success, got: %v", err)
	}
}

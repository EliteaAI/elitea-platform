package redis_test

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"

	infraredis "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/redis"
)

// redisAddressEnv is the one name the whole repository uses for a test Redis.
// It used to be absent here: the address was the literal "localhost:6379" and
// the guard skipped whenever nothing answered. That skip could not be turned
// off from outside the process, so these tests never ran in CI and their
// green said nothing (#423).
const redisAddressEnv = "ELITEA_TEST_REDIS_ADDR"

// newTestRedis returns a client for the configured test Redis.
//
// With ELITEA_TEST_REDIS_ADDR set, a Redis was PROMISED, so an unreachable
// one is a FAILURE. Only the unset case skips, so that a developer with no
// Redis can still run `go test ./...`. Same shape as CONTRACT_REQUIRE_PARITY
// in .github/workflows/ci-contract.yml.
func newTestRedis(t *testing.T) *goredis.Client {
	t.Helper()
	address := os.Getenv(redisAddressEnv)
	if address == "" {
		t.Skipf("set %s to run the real-Redis event bus test", redisAddressEnv)
	}
	client := goredis.NewClient(&goredis.Options{Addr: address})
	t.Cleanup(func() { _ = client.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		t.Fatalf("ping the %s Redis at %s: %v", redisAddressEnv, address, err)
	}
	return client
}

func TestEventBus_PublishSubscribe(t *testing.T) {
	rdb := newTestRedis(t)

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
		if err := json.Unmarshal(evt.Payload, &p); err != nil {
			t.Errorf("unmarshal payload: %v", err)
		}
		if p["key"] != "value" {
			t.Errorf("expected payload key=value, got %v", p)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for event")
	}
}

func TestEventBus_Ping(t *testing.T) {
	rdb := newTestRedis(t)

	eb := infraredis.NewEventBus(rdb, "test-service")
	if err := eb.Ping(context.Background()); err != nil {
		t.Fatalf("expected ping success, got: %v", err)
	}
}

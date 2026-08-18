package authsvc_test

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/authsvc"
	"github.com/redis/go-redis/v9"
)

// redisAddressEnv is the one name the whole repository uses for a test Redis.
// It used to be absent here: the address was the literal "localhost:6379" and
// the guard skipped whenever nothing answered. That skip could not be turned
// off from outside the process, so these five tests never ran in CI and their
// green said nothing (#423).
const redisAddressEnv = "ELITEA_TEST_REDIS_ADDR"

// newTestRedis returns a client for the configured test Redis.
//
// With ELITEA_TEST_REDIS_ADDR set, a Redis was PROMISED, so an unreachable
// one is a FAILURE. Only the unset case skips, so that a developer with no
// Redis can still run `go test ./...`. Same shape as CONTRACT_REQUIRE_PARITY
// in .github/workflows/ci-contract.yml.
func newTestRedis(t *testing.T) *redis.Client {
	t.Helper()
	address := os.Getenv(redisAddressEnv)
	if address == "" {
		t.Skipf("set %s to run the real-Redis auth RPC test", redisAddressEnv)
	}
	client := redis.NewClient(&redis.Options{Addr: address})
	t.Cleanup(func() { _ = client.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		t.Fatalf("ping the %s Redis at %s: %v", redisAddressEnv, address, err)
	}
	return client
}

func TestClient_ValidateToken_Timeout(t *testing.T) {
	rdb := newTestRedis(t)

	client := authsvc.New(rdb, authsvc.WithRPCTimeout(100*time.Millisecond))

	ctx := context.Background()
	_, err := client.ValidateToken(ctx, "expired-token")
	if err == nil {
		t.Fatal("expected error on timeout")
	}
	if err.Error() != "authsvc: rpc timeout" {
		t.Errorf("expected timeout error, got: %v", err)
	}
}

func TestClient_ValidateToken_Success(t *testing.T) {
	rdb := newTestRedis(t)

	client := authsvc.New(rdb, authsvc.WithRPCTimeout(2*time.Second))

	// Start a mock pylon_auth responder
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sub := rdb.Subscribe(ctx, "pylon_auth:rpc:request")
	defer func() { _ = sub.Close() }()

	go func() {
		ch := sub.Channel()
		for msg := range ch {
			var req struct {
				RequestID    string          `json:"request_id"`
				Method       string          `json:"method"`
				Payload      json.RawMessage `json:"payload"`
				ReplyChannel string          `json:"reply_channel"`
			}
			if err := json.Unmarshal([]byte(msg.Payload), &req); err != nil {
				continue
			}

			data, _ := json.Marshal(map[string]interface{}{
				"user_id":     "test-user-id",
				"email":       "test@example.com",
				"roles":       []string{"editor"},
				"permissions": []string{"apps.edit", "apps.view"},
			})

			resp, _ := json.Marshal(map[string]interface{}{
				"request_id": req.RequestID,
				"success":    true,
				"data":       json.RawMessage(data),
			})

			rdb.Publish(ctx, req.ReplyChannel, resp)
		}
	}()

	// Give the subscriber a moment to be ready
	time.Sleep(50 * time.Millisecond)

	user, err := client.ValidateToken(context.Background(), "valid-token")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if user.ID != "test-user-id" {
		t.Errorf("expected user ID test-user-id, got %q", user.ID)
	}
	if user.Email != "test@example.com" {
		t.Errorf("expected email test@example.com, got %q", user.Email)
	}
	if len(user.Permissions) != 2 {
		t.Errorf("expected 2 permissions, got %d", len(user.Permissions))
	}
}

func TestClient_ValidateToken_ErrorResponse(t *testing.T) {
	rdb := newTestRedis(t)

	client := authsvc.New(rdb, authsvc.WithRPCTimeout(2*time.Second))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sub := rdb.Subscribe(ctx, "pylon_auth:rpc:request")
	defer func() { _ = sub.Close() }()

	go func() {
		ch := sub.Channel()
		for msg := range ch {
			var req struct {
				RequestID    string `json:"request_id"`
				ReplyChannel string `json:"reply_channel"`
			}
			if err := json.Unmarshal([]byte(msg.Payload), &req); err != nil {
				continue
			}

			resp, _ := json.Marshal(map[string]interface{}{
				"request_id": req.RequestID,
				"success":    false,
				"error":      "token expired",
			})

			rdb.Publish(ctx, req.ReplyChannel, resp)
		}
	}()

	time.Sleep(50 * time.Millisecond)

	_, err := client.ValidateToken(context.Background(), "expired-token")
	if err == nil {
		t.Fatal("expected error for expired token")
	}
	if err.Error() != "authsvc: token expired" {
		t.Errorf("expected 'authsvc: token expired', got: %v", err)
	}
}

func TestClient_Cache(t *testing.T) {
	rdb := newTestRedis(t)

	// Clean test keys
	rdb.Del(context.Background(), "auth:token:testkey")

	client := authsvc.New(rdb)
	ctx := context.Background()

	user := auth.User{
		ID:          "cached-user",
		Email:       "cached@example.com",
		Permissions: []string{"read"},
	}

	if err := client.SetCached(ctx, "auth:token:testkey", user); err != nil {
		t.Fatalf("SetCached failed: %v", err)
	}

	got, err := client.GetCached(ctx, "auth:token:testkey")
	if err != nil {
		t.Fatalf("GetCached failed: %v", err)
	}
	if got.ID != "cached-user" {
		t.Errorf("expected cached-user, got %q", got.ID)
	}
	if got.Email != "cached@example.com" {
		t.Errorf("expected cached@example.com, got %q", got.Email)
	}

	// Verify cache miss
	_, err = client.GetCached(ctx, "auth:token:nonexistent")
	if err == nil {
		t.Error("expected error for cache miss")
	}

	// Cleanup
	rdb.Del(ctx, "auth:token:testkey")
}

func TestClient_ContextCancelled(t *testing.T) {
	rdb := newTestRedis(t)

	client := authsvc.New(rdb, authsvc.WithRPCTimeout(5*time.Second))

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // immediately cancel

	_, err := client.ValidateToken(ctx, "any-token")
	if err == nil {
		t.Fatal("expected error on cancelled context")
	}
}

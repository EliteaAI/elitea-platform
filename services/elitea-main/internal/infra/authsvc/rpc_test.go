package authsvc_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/authsvc"
	"github.com/redis/go-redis/v9"
)

func skipIfNoRedis(t *testing.T, rdb *redis.Client) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("Redis not available: %v", err)
	}
}

func TestClient_ValidateToken_Timeout(t *testing.T) {
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	skipIfNoRedis(t, rdb)
	defer rdb.Close()

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
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	skipIfNoRedis(t, rdb)
	defer rdb.Close()

	client := authsvc.New(rdb, authsvc.WithRPCTimeout(2*time.Second))

	// Start a mock pylon_auth responder
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sub := rdb.Subscribe(ctx, "pylon_auth:rpc:request")
	defer sub.Close()

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
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	skipIfNoRedis(t, rdb)
	defer rdb.Close()

	client := authsvc.New(rdb, authsvc.WithRPCTimeout(2*time.Second))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sub := rdb.Subscribe(ctx, "pylon_auth:rpc:request")
	defer sub.Close()

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
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	skipIfNoRedis(t, rdb)
	defer rdb.Close()

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
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	skipIfNoRedis(t, rdb)
	defer rdb.Close()

	client := authsvc.New(rdb, authsvc.WithRPCTimeout(5*time.Second))

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // immediately cancel

	_, err := client.ValidateToken(ctx, "any-token")
	if err == nil {
		t.Fatal("expected error on cancelled context")
	}
}

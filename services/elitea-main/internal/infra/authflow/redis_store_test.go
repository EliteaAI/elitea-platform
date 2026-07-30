package authflow

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/browserauth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth/browserflow"
)

const testKeyPrefix = "elitea_auth_flow_"

var _ browserauth.TransactionStore = (*RedisStore)(nil)

func TestNewRedisStoreRejectsInvalidConfigurationAndDistributedClients(t *testing.T) {
	t.Parallel()

	if _, err := NewRedisStore(nil, Config{KeyPrefix: testKeyPrefix}); !errors.Is(err, ErrInvalidConfiguration) {
		t.Fatalf("nil client error = %v, want %v", err, ErrInvalidConfiguration)
	}
	client := redis.NewClient(&redis.Options{Addr: "127.0.0.1:0"})
	t.Cleanup(func() { _ = client.Close() })
	for _, prefix := range []string{"", "prefix\n", strings.Repeat("p", maxKeyPrefixBytes+1)} {
		if _, err := NewRedisStore(client, Config{KeyPrefix: prefix}); !errors.Is(err, ErrInvalidConfiguration) {
			t.Fatalf("prefix %q error = %v, want %v", prefix, err, ErrInvalidConfiguration)
		}
	}

	cluster := redis.NewClusterClient(&redis.ClusterOptions{Addrs: []string{"127.0.0.1:0"}})
	t.Cleanup(func() { _ = cluster.Close() })
	if _, err := NewRedisStore(cluster, Config{KeyPrefix: testKeyPrefix}); !errors.Is(err, ErrInvalidConfiguration) {
		t.Fatalf("cluster error = %v, want %v", err, ErrInvalidConfiguration)
	}
	ring := redis.NewRing(&redis.RingOptions{Addrs: map[string]string{"shard": "127.0.0.1:0"}})
	t.Cleanup(func() { _ = ring.Close() })
	if _, err := NewRedisStore(ring, Config{KeyPrefix: testKeyPrefix}); !errors.Is(err, ErrInvalidConfiguration) {
		t.Fatalf("ring error = %v, want %v", err, ErrInvalidConfiguration)
	}
}

func TestRedisStoreCreateConsumeAndReplay(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 20, 12, 0, 0, 0, time.UTC)
	id := testTransactionID(1)
	store, server, client, _ := newTestStore(t, now, fixedGenerator(id))
	transaction := testTransaction(now, "oidc", "session-1")

	createdID, err := store.Create(context.Background(), transaction)
	if err != nil {
		t.Fatal(err)
	}
	if createdID != id || browserflow.ValidateTransactionID(createdID) != nil {
		t.Fatalf("created ID = %q", createdID)
	}
	key := testKeyPrefix + id
	if value, err := client.HGet(context.Background(), key, "provider").Result(); err != nil || value != "oidc" {
		t.Fatalf("stored provider = %q, %v", value, err)
	}
	if ttl := server.TTL(key); ttl <= 0 || ttl > 5*time.Minute {
		t.Fatalf("TTL = %s, want derived five-minute lifetime", ttl)
	}

	consumed, err := store.Consume(context.Background(), id, "oidc", "session-1")
	if err != nil {
		t.Fatal(err)
	}
	if consumed != transaction {
		t.Fatalf("consumed transaction = %+v, want %+v", consumed, transaction)
	}
	if server.Exists(key) {
		t.Fatal("consumed transaction remains in Redis")
	}
	if _, err := store.Consume(context.Background(), id, "oidc", "session-1"); !errors.Is(err, browserflow.ErrTransactionRejected) {
		t.Fatalf("replay error = %v, want %v", err, browserflow.ErrTransactionRejected)
	}
}

func TestRedisStoreBindingMismatchDoesNotConsume(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 20, 12, 0, 0, 0, time.UTC)
	id := testTransactionID(2)
	store, server, _, _ := newTestStore(t, now, fixedGenerator(id))
	transaction := testTransaction(now, "oidc", "session-1")
	if _, err := store.Create(context.Background(), transaction); err != nil {
		t.Fatal(err)
	}

	for _, binding := range []struct {
		provider string
		session  string
	}{
		{provider: "saml", session: "session-1"},
		{provider: "oidc", session: "session-2"},
	} {
		if _, err := store.Consume(context.Background(), id, binding.provider, binding.session); !errors.Is(err, browserflow.ErrTransactionRejected) {
			t.Fatalf("binding %+v error = %v, want %v", binding, err, browserflow.ErrTransactionRejected)
		}
		if !server.Exists(testKeyPrefix + id) {
			t.Fatalf("binding mismatch %+v consumed transaction", binding)
		}
	}
	if _, err := store.Consume(context.Background(), id, "oidc", "session-1"); err != nil {
		t.Fatalf("correct binding after mismatches: %v", err)
	}
}

func TestRedisStoreTTLAndApplicationExpirationAreBounded(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 20, 12, 0, 0, 0, time.UTC)
	t.Run("Redis expiry", func(t *testing.T) {
		t.Parallel()
		id := testTransactionID(3)
		store, server, _, _ := newTestStore(t, now, fixedGenerator(id))
		if _, err := store.Create(context.Background(), testTransaction(now, "oidc", "session-1")); err != nil {
			t.Fatal(err)
		}
		server.FastForward(5 * time.Minute)
		if _, err := store.Consume(context.Background(), id, "oidc", "session-1"); !errors.Is(err, browserflow.ErrTransactionRejected) {
			t.Fatalf("expired consume error = %v, want %v", err, browserflow.ErrTransactionRejected)
		}
	})

	t.Run("application clock expiry", func(t *testing.T) {
		t.Parallel()
		id := testTransactionID(4)
		store, server, _, clock := newTestStore(t, now, fixedGenerator(id))
		transaction := testTransaction(now, "oidc", "session-1")
		if _, err := store.Create(context.Background(), transaction); err != nil {
			t.Fatal(err)
		}
		clock.Set(transaction.ExpiresAt)
		if _, err := store.Consume(context.Background(), id, "oidc", "session-1"); !errors.Is(err, browserflow.ErrTransactionRejected) {
			t.Fatalf("expired consume error = %v, want %v", err, browserflow.ErrTransactionRejected)
		}
		if server.Exists(testKeyPrefix + id) {
			t.Fatal("application-expired transaction was not consumed")
		}
	})

	t.Run("already expired create", func(t *testing.T) {
		t.Parallel()
		id := testTransactionID(5)
		store, server, _, clock := newTestStore(t, now, fixedGenerator(id))
		transaction := testTransaction(now, "oidc", "session-1")
		clock.Set(transaction.ExpiresAt)
		if _, err := store.Create(context.Background(), transaction); !errors.Is(err, browserflow.ErrTransactionRejected) {
			t.Fatalf("expired create error = %v, want %v", err, browserflow.ErrTransactionRejected)
		}
		if len(server.Keys()) != 0 {
			t.Fatalf("expired create wrote keys: %v", server.Keys())
		}
	})
}

func TestRedisStoreRetriesAndBoundsIDCollisions(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 20, 12, 0, 0, 0, time.UTC)
	firstID := testTransactionID(6)
	secondID := testTransactionID(7)
	store, _, _, _ := newTestStore(t, now, sequenceGenerator(firstID, firstID, secondID))
	if id, err := store.Create(context.Background(), testTransaction(now, "oidc", "session-1")); err != nil || id != firstID {
		t.Fatalf("first create = %q, %v", id, err)
	}
	if id, err := store.Create(context.Background(), testTransaction(now, "saml", "session-2")); err != nil || id != secondID {
		t.Fatalf("collision retry create = %q, %v", id, err)
	}

	collidingID := testTransactionID(8)
	bounded, _, _, _ := newTestStore(t, now, fixedGenerator(collidingID))
	if _, err := bounded.Create(context.Background(), testTransaction(now, "oidc", "session-1")); err != nil {
		t.Fatal(err)
	}
	if _, err := bounded.Create(context.Background(), testTransaction(now, "saml", "session-2")); !errors.Is(err, ErrIDCollision) {
		t.Fatalf("bounded collision error = %v, want %v", err, ErrIDCollision)
	}

	invalid, server, _, _ := newTestStore(t, now, fixedGenerator("transaction-1"))
	if _, err := invalid.Create(context.Background(), testTransaction(now, "oidc", "session-3")); !errors.Is(err, ErrInvalidID) {
		t.Fatalf("invalid generated ID error = %v, want %v", err, ErrInvalidID)
	}
	if len(server.Keys()) != 0 {
		t.Fatalf("invalid generated ID wrote keys: %v", server.Keys())
	}
}

func TestRedisStoreCollisionRecomputesRemainingAbsoluteTTL(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 20, 12, 0, 0, 0, time.UTC)
	clock := &testClock{now: now}
	firstID := testTransactionID(60)
	secondID := testTransactionID(61)
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	t.Cleanup(func() { _ = client.Close() })
	if err := server.Set(testKeyPrefix+firstID, "unrelated"); err != nil {
		t.Fatal(err)
	}
	server.SetTTL(testKeyPrefix+firstID, time.Hour)

	calls := 0
	generate := func() (string, error) {
		calls++
		if calls == 1 {
			clock.Set(now.Add(2 * time.Minute))
			return firstID, nil
		}
		return secondID, nil
	}
	store, err := newRedisStore(client, Config{KeyPrefix: testKeyPrefix}, generate, clock.Now)
	if err != nil {
		t.Fatal(err)
	}
	transaction := testTransaction(now, "oidc", "session-1")
	id, err := store.Create(context.Background(), transaction)
	if err != nil {
		t.Fatal(err)
	}
	if id != secondID || calls != 2 {
		t.Fatalf("created ID = %q, generator calls = %d", id, calls)
	}
	if ttl := server.TTL(testKeyPrefix + secondID); ttl != 3*time.Minute {
		t.Fatalf("TTL after delayed collision retry = %s, want 3m", ttl)
	}
}

func TestRedisStoreConcurrentConsumeHasOneWinner(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 20, 12, 0, 0, 0, time.UTC)
	id := testTransactionID(9)
	store, _, _, _ := newTestStore(t, now, fixedGenerator(id))
	if _, err := store.Create(context.Background(), testTransaction(now, "oidc", "session-1")); err != nil {
		t.Fatal(err)
	}

	const attempts = 32
	start := make(chan struct{})
	results := make(chan error, attempts)
	var wait sync.WaitGroup
	for range attempts {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			_, err := store.Consume(context.Background(), id, "oidc", "session-1")
			results <- err
		}()
	}
	close(start)
	wait.Wait()
	close(results)

	successes := 0
	for err := range results {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, browserflow.ErrTransactionRejected):
		default:
			t.Fatalf("unexpected consume error: %v", err)
		}
	}
	if successes != 1 {
		t.Fatalf("successful consumes = %d, want 1", successes)
	}
}

func TestRedisStoreConsumesMalformedRecordsWithoutReturningClaims(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 20, 12, 0, 0, 0, time.UTC)
	validTransaction := testTransaction(now, "oidc", "session-1")
	validRecord, err := json.Marshal(validTransaction)
	if err != nil {
		t.Fatal(err)
	}
	unknownRecord := append(append([]byte(nil), validRecord[:len(validRecord)-1]...), []byte(`,"unknown":true}`)...)
	duplicateRecord := append(append([]byte(nil), validRecord[:len(validRecord)-1]...), []byte(`,"provider":"oidc"}`)...)
	mismatchedTransaction := validTransaction
	mismatchedTransaction.Provider = "saml"
	mismatchedRecord, err := json.Marshal(mismatchedTransaction)
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name   string
		mutate func(context.Context, *redis.Client, string) error
	}{
		{
			name: "malformed JSON",
			mutate: func(ctx context.Context, client *redis.Client, key string) error {
				return client.HSet(ctx, key, "record", "{").Err()
			},
		},
		{
			name: "unknown field",
			mutate: func(ctx context.Context, client *redis.Client, key string) error {
				return client.HSet(ctx, key, "record", unknownRecord).Err()
			},
		},
		{
			name: "duplicate field",
			mutate: func(ctx context.Context, client *redis.Client, key string) error {
				return client.HSet(ctx, key, "record", duplicateRecord).Err()
			},
		},
		{
			name: "non canonical whitespace",
			mutate: func(ctx context.Context, client *redis.Client, key string) error {
				return client.HSet(ctx, key, "record", append([]byte(" "), validRecord...)).Err()
			},
		},
		{
			name: "oversized",
			mutate: func(ctx context.Context, client *redis.Client, key string) error {
				return client.HSet(ctx, key, "record", strings.Repeat("x", MaxRecordBytes+1)).Err()
			},
		},
		{
			name: "record binding differs from sidecar",
			mutate: func(ctx context.Context, client *redis.Client, key string) error {
				return client.HSet(ctx, key, "record", mismatchedRecord).Err()
			},
		},
		{
			name: "missing record field",
			mutate: func(ctx context.Context, client *redis.Client, key string) error {
				return client.HDel(ctx, key, "record").Err()
			},
		},
		{
			name: "missing provider sidecar",
			mutate: func(ctx context.Context, client *redis.Client, key string) error {
				return client.HDel(ctx, key, "provider").Err()
			},
		},
		{
			name: "missing originating session sidecar",
			mutate: func(ctx context.Context, client *redis.Client, key string) error {
				return client.HDel(ctx, key, "originating_session_id").Err()
			},
		},
		{
			name: "missing Redis TTL",
			mutate: func(ctx context.Context, client *redis.Client, key string) error {
				return client.Persist(ctx, key).Err()
			},
		},
		{
			name: "wrong Redis type",
			mutate: func(ctx context.Context, client *redis.Client, key string) error {
				if err := client.Del(ctx, key).Err(); err != nil {
					return err
				}
				return client.Set(ctx, key, "not-a-hash", time.Minute).Err()
			},
		},
	}
	for index, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			id := testTransactionID(byte(20 + index))
			store, server, client, _ := newTestStore(t, now, fixedGenerator(id))
			if _, err := store.Create(context.Background(), validTransaction); err != nil {
				t.Fatal(err)
			}
			key := testKeyPrefix + id
			if err := test.mutate(context.Background(), client, key); err != nil {
				t.Fatal(err)
			}
			if _, err := store.Consume(context.Background(), id, "oidc", "session-1"); !errors.Is(err, ErrInvalidRecord) {
				t.Fatalf("error = %v, want %v", err, ErrInvalidRecord)
			}
			if server.Exists(key) {
				t.Fatal("malformed transaction remains in Redis")
			}
		})
	}
}

func TestRedisStoreCancellationOutageAndInvalidInput(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 20, 12, 0, 0, 0, time.UTC)
	id := testTransactionID(40)
	store, server, _, _ := newTestStore(t, now, fixedGenerator(id))
	transaction := testTransaction(now, "oidc", "session-1")

	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := store.Create(canceled, transaction); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled create error = %v, want %v", err, context.Canceled)
	}
	if _, err := store.Create(context.Background(), transaction); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Consume(canceled, id, "oidc", "session-1"); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled consume error = %v, want %v", err, context.Canceled)
	}
	if !server.Exists(testKeyPrefix + id) {
		t.Fatal("pre-canceled consume mutated transaction")
	}
	if _, err := store.Consume(context.Background(), "transaction-1", "oidc", "session-1"); !errors.Is(err, ErrInvalidID) {
		t.Fatalf("invalid ID error = %v, want %v", err, ErrInvalidID)
	}
	if _, err := store.Consume(context.Background(), id, "oidc provider", "session-1"); !errors.Is(err, browserflow.ErrTransactionRejected) {
		t.Fatalf("invalid binding error = %v, want %v", err, browserflow.ErrTransactionRejected)
	}
	if !server.Exists(testKeyPrefix + id) {
		t.Fatal("invalid binding consumed transaction")
	}

	server.Close()
	if _, err := store.Consume(context.Background(), id, "oidc", "session-1"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("outage consume error = %v, want %v", err, ErrUnavailable)
	}
	if _, err := store.Create(context.Background(), testTransaction(now, "saml", "session-2")); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("outage create error = %v, want %v", err, ErrUnavailable)
	}
}

func newTestStore(
	t *testing.T,
	now time.Time,
	generate idGenerator,
) (*RedisStore, *miniredis.Miniredis, *redis.Client, *testClock) {
	t.Helper()
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{
		Addr:         server.Addr(),
		MaxRetries:   -1,
		DialTimeout:  100 * time.Millisecond,
		ReadTimeout:  100 * time.Millisecond,
		WriteTimeout: 100 * time.Millisecond,
	})
	t.Cleanup(func() { _ = client.Close() })
	clock := &testClock{now: now}
	store, err := newRedisStore(client, Config{KeyPrefix: testKeyPrefix}, generate, clock.Now)
	if err != nil {
		t.Fatal(err)
	}
	return store, server, client, clock
}

func testTransaction(now time.Time, provider string, sessionID string) browserflow.Transaction {
	return browserflow.Transaction{
		SchemaVersion:        browserflow.CurrentTransactionSchemaVersion,
		Provider:             provider,
		OriginatingSessionID: sessionID,
		ReturnTarget:         "/projects/7",
		CreatedAt:            now,
		ExpiresAt:            now.Add(5 * time.Minute),
		Correlation:          browserflow.ProtocolCorrelation{Nonce: "nonce-1"},
	}
}

func testTransactionID(value byte) string {
	random := make([]byte, browserflow.TransactionIDRandomBytes)
	for index := range random {
		random[index] = value
	}
	return base64.RawURLEncoding.EncodeToString(random)
}

func fixedGenerator(id string) idGenerator {
	return func() (string, error) { return id, nil }
}

func sequenceGenerator(ids ...string) idGenerator {
	index := 0
	return func() (string, error) {
		if index >= len(ids) {
			return ids[len(ids)-1], nil
		}
		id := ids[index]
		index++
		return id, nil
	}
}

type testClock struct {
	mu  sync.RWMutex
	now time.Time
}

func (c *testClock) Now() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.now
}

func (c *testClock) Set(now time.Time) {
	c.mu.Lock()
	c.now = now
	c.mu.Unlock()
}

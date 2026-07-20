package authsession

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	sessionstate "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth/session"
)

const testKeyPrefix = "elitea_auth_session_"

func TestNotFoundErrorUsesStorageNeutralSessionContract(t *testing.T) {
	t.Parallel()

	if ErrNotFound != sessionstate.ErrNotFound {
		t.Fatalf("ErrNotFound = %v, want storage-neutral %v", ErrNotFound, sessionstate.ErrNotFound)
	}
}

func TestRandomSessionIDIsCanonicalAndUnique(t *testing.T) {
	t.Parallel()

	seen := make(map[string]struct{}, 64)
	for range 64 {
		id, err := randomSessionID()
		if err != nil {
			t.Fatal(err)
		}
		if !validSessionID(id) {
			t.Fatalf("generated ID %q is not a canonical 256-bit value", id)
		}
		if _, duplicate := seen[id]; duplicate {
			t.Fatalf("duplicate random session ID %q", id)
		}
		seen[id] = struct{}{}
	}
}

func TestNewRedisStoreRejectsClusterAndRingClients(t *testing.T) {
	t.Parallel()

	cluster := redis.NewClusterClient(&redis.ClusterOptions{Addrs: []string{"127.0.0.1:0"}})
	t.Cleanup(func() { _ = cluster.Close() })
	if _, err := NewRedisStore(cluster, Config{KeyPrefix: testKeyPrefix, TTL: time.Hour}); !errors.Is(err, ErrInvalidConfiguration) {
		t.Fatalf("cluster error = %v, want %v", err, ErrInvalidConfiguration)
	}

	ring := redis.NewRing(&redis.RingOptions{Addrs: map[string]string{"shard": "127.0.0.1:0"}})
	t.Cleanup(func() { _ = ring.Close() })
	if _, err := NewRedisStore(ring, Config{KeyPrefix: testKeyPrefix, TTL: time.Hour}); !errors.Is(err, ErrInvalidConfiguration) {
		t.Fatalf("ring error = %v, want %v", err, ErrInvalidConfiguration)
	}
}

func TestRedisStoreCreateReadKeepsSensitiveStateOutOfOpaqueID(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 19, 12, 0, 0, 0, time.UTC)
	opaqueID := testSessionID(1)
	store, server := newTestStore(t, 30*time.Minute, fixedGenerator(opaqueID))
	state := completedState(now.Add(20 * time.Minute))

	id, err := store.Create(context.Background(), state)
	if err != nil {
		t.Fatal(err)
	}
	if !validSessionID(id) {
		t.Fatalf("generated ID %q is not canonical", id)
	}
	if id != opaqueID {
		t.Fatalf("session ID = %q, want generated opaque ID %q", id, opaqueID)
	}
	for _, sensitive := range []string{"subject-42", "provider-session-secret", "42", "oidc"} {
		if strings.Contains(id, sensitive) {
			t.Fatalf("session ID contains sensitive state %q", sensitive)
		}
	}
	keys := server.Keys()
	if len(keys) != 1 || keys[0] != testKeyPrefix+id {
		t.Fatalf("Redis keys = %v", keys)
	}

	got, err := store.Read(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if got.SchemaVersion != sessionstate.CurrentSchemaVersion || !got.Done || got.UserID == nil || *got.UserID != 42 {
		t.Fatalf("read state = %+v", got)
	}
	if string(got.ProviderAttributes) != string(state.ProviderAttributes) {
		t.Fatalf("provider state changed: %+v", got)
	}
	if ttl := server.TTL(testKeyPrefix + id); ttl <= 0 || ttl > 30*time.Minute {
		t.Fatalf("Redis TTL = %s, want configured server-session lifetime", ttl)
	}
}

func TestRedisStoreKeepsServerLifetimeIndependentFromAuthExpiration(t *testing.T) {
	t.Parallel()

	t.Run("Redis TTL", func(t *testing.T) {
		t.Parallel()
		store, server := newTestStore(t, 5*time.Minute, fixedGenerator(testSessionID(1)))
		id, err := store.Create(context.Background(), incompleteState())
		if err != nil {
			t.Fatal(err)
		}
		server.FastForward(5 * time.Minute)
		if _, err := store.Read(context.Background(), id); !errors.Is(err, ErrNotFound) {
			t.Fatalf("read error = %v, want %v", err, ErrNotFound)
		}
	})

	t.Run("expired auth context remains available to authorization and logout", func(t *testing.T) {
		t.Parallel()
		now := time.Date(2026, time.July, 19, 12, 0, 0, 0, time.UTC)
		store, server := newTestStore(t, 30*time.Minute, fixedGenerator(testSessionID(2)))
		state := completedState(now.Add(-time.Minute))
		id, err := store.Create(context.Background(), state)
		if err != nil {
			t.Fatal(err)
		}
		got, err := store.Read(context.Background(), id)
		if err != nil {
			t.Fatal(err)
		}
		if got.Expiration == nil || !got.Expiration.Equal(*state.Expiration) {
			t.Fatalf("auth expiration changed: got %v, want %v", got.Expiration, state.Expiration)
		}
		if ttl := server.TTL(testKeyPrefix + id); ttl <= 0 || ttl > 30*time.Minute {
			t.Fatalf("Redis TTL = %s, want configured server-session lifetime", ttl)
		}
	})
}

func TestRedisStoreRotateAndReplaceCommitsAuthenticatedStateAtomically(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 19, 12, 0, 0, 0, time.UTC)
	oldID := testSessionID(12)
	newID := testSessionID(13)
	store, server := newTestStore(
		t,
		30*time.Minute,
		sequenceGenerator(oldID, newID),
	)
	createdID, err := store.Create(context.Background(), incompleteState())
	if err != nil {
		t.Fatal(err)
	}
	server.FastForward(7 * time.Minute)
	replacement := completedState(now.Add(time.Hour))

	rotatedID, err := store.RotateAndReplace(context.Background(), createdID, replacement)
	if err != nil {
		t.Fatal(err)
	}
	if rotatedID != newID {
		t.Fatalf("rotated ID = %q, want %q", rotatedID, newID)
	}
	if _, err := store.Read(context.Background(), createdID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("old ID read error = %v, want %v", err, ErrNotFound)
	}
	got, err := store.Read(context.Background(), rotatedID)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Done || got.UserID == nil || *got.UserID != 42 {
		t.Fatalf("replacement state = %+v", got)
	}
	if ttl := server.TTL(testKeyPrefix + rotatedID); ttl <= 23*time.Minute || ttl > 30*time.Minute {
		t.Fatalf("replacement TTL = %s, want refreshed server-session lifetime", ttl)
	}
}

func TestRedisStoreRotateAndReplaceRejectsInvalidStateBeforeMutation(t *testing.T) {
	t.Parallel()

	oldID := testSessionID(14)
	newID := testSessionID(15)
	store, server := newTestStore(
		t,
		time.Hour,
		sequenceGenerator(oldID, newID),
	)
	createdID, err := store.Create(context.Background(), incompleteState())
	if err != nil {
		t.Fatal(err)
	}
	invalid := incompleteState()
	invalid.SchemaVersion = sessionstate.CurrentSchemaVersion + 1

	if _, err := store.RotateAndReplace(context.Background(), createdID, invalid); !errors.Is(err, sessionstate.ErrInvalidState) {
		t.Fatalf("rotate-and-replace error = %v, want %v", err, sessionstate.ErrInvalidState)
	}
	if !server.Exists(testKeyPrefix+createdID) || server.Exists(testKeyPrefix+newID) {
		t.Fatalf("invalid replacement mutated Redis keys: %v", server.Keys())
	}
}

func TestRedisStoreRotateInvalidatesOldIDAndPreservesRemainingTTL(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 19, 12, 0, 0, 0, time.UTC)
	oldID := testSessionID(10)
	newID := testSessionID(11)
	store, server := newTestStore(
		t,
		30*time.Minute,
		sequenceGenerator(oldID, newID),
	)
	state := completedState(now.Add(time.Hour))
	createdID, err := store.Create(context.Background(), state)
	if err != nil {
		t.Fatal(err)
	}
	server.FastForward(7 * time.Minute)
	remaining := server.TTL(testKeyPrefix + createdID)

	rotatedID, err := store.Rotate(context.Background(), createdID)
	if err != nil {
		t.Fatal(err)
	}
	if rotatedID != newID || rotatedID == createdID {
		t.Fatalf("rotated ID = %q, old = %q", rotatedID, createdID)
	}
	if _, err := store.Read(context.Background(), createdID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("old ID read error = %v, want %v", err, ErrNotFound)
	}
	if _, err := store.Read(context.Background(), rotatedID); err != nil {
		t.Fatalf("new ID read: %v", err)
	}
	if got := server.TTL(testKeyPrefix + rotatedID); got != remaining {
		t.Fatalf("rotated TTL = %s, want %s", got, remaining)
	}
}

func TestRedisStoreRotationRetriesCollisionWithoutExposingOldID(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 19, 12, 0, 0, 0, time.UTC)
	oldID := testSessionID(20)
	collidingID := testSessionID(21)
	newID := testSessionID(22)
	store, server := newTestStore(
		t,
		30*time.Minute,
		sequenceGenerator(oldID, collidingID, newID),
	)
	createdID, err := store.Create(context.Background(), completedState(now.Add(time.Hour)))
	if err != nil {
		t.Fatal(err)
	}
	server.Set(testKeyPrefix+collidingID, "unrelated")
	server.SetTTL(testKeyPrefix+collidingID, time.Hour)

	rotatedID, err := store.Rotate(context.Background(), createdID)
	if err != nil {
		t.Fatal(err)
	}
	if rotatedID != newID {
		t.Fatalf("rotated ID = %q, want %q", rotatedID, newID)
	}
	if value, err := server.Get(testKeyPrefix + collidingID); err != nil || value != "unrelated" {
		t.Fatalf("colliding record = %q, %v", value, err)
	}
	if server.Exists(testKeyPrefix + oldID) {
		t.Fatal("old ID remains valid after successful rotation")
	}
}

func TestRedisStoreCreateCollisionsAreBounded(t *testing.T) {
	t.Parallel()

	collidingID := testSessionID(30)
	store, server := newTestStore(t, time.Hour, fixedGenerator(collidingID))
	server.Set(testKeyPrefix+collidingID, "existing")
	server.SetTTL(testKeyPrefix+collidingID, time.Hour)

	if _, err := store.Create(context.Background(), incompleteState()); !errors.Is(err, ErrIDCollision) {
		t.Fatalf("create error = %v, want %v", err, ErrIDCollision)
	}
	if value, err := server.Get(testKeyPrefix + collidingID); err != nil || value != "existing" {
		t.Fatalf("colliding value = %q, %v", value, err)
	}
}

func TestRedisStoreRejectsMalformedUnknownAndOversizedRecords(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 19, 12, 0, 0, 0, time.UTC)
	store, server := newTestStore(t, time.Hour, fixedGenerator(testSessionID(40)))

	unknownVersion := completedState(now.Add(time.Hour))
	unknownVersion.SchemaVersion++
	unknownVersionRecord, err := json.Marshal(unknownVersion)
	if err != nil {
		t.Fatal(err)
	}
	validRecord, err := json.Marshal(completedState(now.Add(time.Hour)))
	if err != nil {
		t.Fatal(err)
	}
	unknownFieldRecord := append(append([]byte(nil), validRecord[:len(validRecord)-1]...), []byte(`,"unknown":true}`)...)
	oversizedAttributes := completedState(now.Add(time.Hour))
	oversizedAttributes.ProviderAttributes = json.RawMessage(
		`{"value":"` + strings.Repeat("x", sessionstate.MaxProviderAttributesBytes) + `"}`,
	)
	oversizedAttributesRecord, err := json.Marshal(oversizedAttributes)
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name   string
		record []byte
		ttl    bool
	}{
		{name: "malformed JSON", record: []byte("{"), ttl: true},
		{name: "unknown schema", record: unknownVersionRecord, ttl: true},
		{name: "unknown field", record: unknownFieldRecord, ttl: true},
		{name: "oversized provider attributes", record: oversizedAttributesRecord, ttl: true},
		{name: "oversized record", record: []byte(strings.Repeat("x", MaxRecordBytes+1)), ttl: true},
		{name: "missing Redis TTL", record: validRecord, ttl: false},
	}
	for index, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			id := testSessionID(byte(50 + index))
			key := testKeyPrefix + id
			server.Set(key, string(test.record))
			if test.ttl {
				server.SetTTL(key, time.Hour)
			}
			if _, err := store.Read(context.Background(), id); !errors.Is(err, sessionstate.ErrInvalidState) {
				t.Fatalf("read error = %v, want %v", err, sessionstate.ErrInvalidState)
			}
		})
	}
}

func TestRedisStoreDeleteIsIdempotentLogoutPrimitive(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 19, 12, 0, 0, 0, time.UTC)
	store, _ := newTestStore(t, time.Hour, fixedGenerator(testSessionID(70)))
	id, err := store.Create(context.Background(), completedState(now.Add(time.Hour)))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(context.Background(), id); err != nil {
		t.Fatalf("second delete: %v", err)
	}
	if _, err := store.Read(context.Background(), id); !errors.Is(err, ErrNotFound) {
		t.Fatalf("read error = %v, want %v", err, ErrNotFound)
	}
}

func TestRedisStoreFailsClosedWhenRedisIsUnavailable(t *testing.T) {
	t.Parallel()

	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{
		Addr:         server.Addr(),
		MaxRetries:   -1,
		DialTimeout:  100 * time.Millisecond,
		ReadTimeout:  100 * time.Millisecond,
		WriteTimeout: 100 * time.Millisecond,
	})
	t.Cleanup(func() { _ = client.Close() })
	now := time.Date(2026, time.July, 19, 12, 0, 0, 0, time.UTC)
	store, err := newRedisStore(
		client,
		Config{KeyPrefix: testKeyPrefix, TTL: time.Hour},
		fixedGenerator(testSessionID(80)),
	)
	if err != nil {
		t.Fatal(err)
	}
	id, err := store.Create(context.Background(), completedState(now.Add(time.Hour)))
	if err != nil {
		t.Fatal(err)
	}
	server.Close()

	if _, err := store.Read(context.Background(), id); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("read error = %v, want %v", err, ErrUnavailable)
	}
	if _, err := store.Create(context.Background(), incompleteState()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("create error = %v, want %v", err, ErrUnavailable)
	}
	if err := store.Delete(context.Background(), id); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("delete error = %v, want %v", err, ErrUnavailable)
	}
	if _, err := store.Rotate(context.Background(), id); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("rotate error = %v, want %v", err, ErrUnavailable)
	}
	if _, err := store.RotateAndReplace(context.Background(), id, incompleteState()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("rotate-and-replace error = %v, want %v", err, ErrUnavailable)
	}
}

func TestRedisStoreRejectsInvalidIDsBeforeRedisAccess(t *testing.T) {
	t.Parallel()

	store, _ := newTestStore(t, time.Hour, fixedGenerator(testSessionID(90)))
	if _, err := store.Read(context.Background(), "../../not-a-session"); !errors.Is(err, ErrInvalidID) {
		t.Fatalf("read error = %v, want %v", err, ErrInvalidID)
	}
	if err := store.Delete(context.Background(), "../../not-a-session"); !errors.Is(err, ErrInvalidID) {
		t.Fatalf("delete error = %v, want %v", err, ErrInvalidID)
	}
}

func newTestStore(
	t *testing.T,
	ttl time.Duration,
	generate idGenerator,
) (*RedisStore, *miniredis.Miniredis) {
	t.Helper()
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	t.Cleanup(func() { _ = client.Close() })
	store, err := newRedisStore(
		client,
		Config{KeyPrefix: testKeyPrefix, TTL: ttl},
		generate,
	)
	if err != nil {
		t.Fatal(err)
	}
	return store, server
}

func completedState(expiration time.Time) sessionstate.State {
	userID := int64(42)
	provider := "oidc"
	return sessionstate.State{
		SchemaVersion:      sessionstate.CurrentSchemaVersion,
		Done:               true,
		Expiration:         &expiration,
		Provider:           &provider,
		ProviderAttributes: json.RawMessage(`{"nameid":"subject-42","attributes":{"picture":"avatar"},"sessionindex":"provider-session-secret"}`),
		UserID:             &userID,
	}
}

func incompleteState() sessionstate.State {
	return sessionstate.State{
		SchemaVersion:      sessionstate.CurrentSchemaVersion,
		ProviderAttributes: json.RawMessage("{}"),
	}
}

func testSessionID(value byte) string {
	return base64.RawURLEncoding.EncodeToString(bytesOf(value, sessionIDRandomBytes))
}

func bytesOf(value byte, size int) []byte {
	result := make([]byte, size)
	for index := range result {
		result[index] = value
	}
	return result
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

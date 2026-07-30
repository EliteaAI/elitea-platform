package redisdispatch

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"

	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestNewRedisStreamAppenderRejectsCapacityOutsideEncodedByteBudget(t *testing.T) {
	client := redis.NewClient(&redis.Options{Addr: "127.0.0.1:0"})
	t.Cleanup(func() {
		if err := client.Close(); err != nil {
			t.Errorf("close Redis client: %v", err)
		}
	})

	invalid := []RedisStreamAppenderConfig{
		{MaxEntries: -1, MaxEntryBytes: 1024},
		{MaxEntries: 0, MaxEntryBytes: 1024},
		{MaxEntries: 1, MaxEntryBytes: 0},
		{MaxEntries: 1, MaxEntryBytes: int(maxSupportedControlStreamEncodedBytes) + 1},
		{MaxEntries: maxSupportedControlStreamEncodedBytes/1024 + 1, MaxEntryBytes: 1024},
	}
	for _, config := range invalid {
		if _, err := NewRedisStreamAppender(client, config); err == nil {
			t.Fatalf("accepted invalid Redis stream capacity %+v", config)
		}
	}
	maximum := RedisStreamAppenderConfig{MaxEntries: maxSupportedControlStreamEncodedBytes / 1024, MaxEntryBytes: 1024}
	if _, err := NewRedisStreamAppender(client, maximum); err != nil {
		t.Fatalf("rejected exact supported Redis stream byte budget: %v", err)
	}
	if _, err := NewRedisStreamAppender(nil, RedisStreamAppenderConfig{MaxEntries: 1, MaxEntryBytes: 1024}); err == nil {
		t.Fatal("accepted nil Redis control client")
	}
	cluster := redis.NewClusterClient(&redis.ClusterOptions{Addrs: []string{"127.0.0.1:0"}})
	t.Cleanup(func() {
		if err := cluster.Close(); err != nil {
			t.Errorf("close rejected Redis Cluster client: %v", err)
		}
	})
	if _, err := NewRedisStreamAppender(cluster, maximum); err == nil {
		t.Fatal("accepted Redis Cluster client for a two-key single-primary script")
	}
	ring := redis.NewRing(&redis.RingOptions{Addrs: map[string]string{"shard": "127.0.0.1:0"}})
	t.Cleanup(func() {
		if err := ring.Close(); err != nil {
			t.Errorf("close rejected Redis Ring client: %v", err)
		}
	})
	if _, err := NewRedisStreamAppender(ring, maximum); err == nil {
		t.Fatal("accepted Redis Ring client for a two-key single-primary script")
	}
}

func TestRedisStreamAppenderStopsExactlyAtCapacityAndRecoversAfterXDEL(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() {
		if err := client.Close(); err != nil {
			t.Errorf("close Redis client: %v", err)
		}
	})
	appender, err := NewRedisStreamAppender(client, RedisStreamAppenderConfig{MaxEntries: 2, MaxEntryBytes: 1024})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	stream := "test:control:capacity"

	firstID, err := appender.Append(ctx, stream, redisEnvelopeField, "delivery-first", []byte("first"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := appender.Append(ctx, stream, redisEnvelopeField, "delivery-second", []byte("second")); err != nil {
		t.Fatal(err)
	}
	if retryID, err := appender.Append(ctx, stream, redisEnvelopeField, "delivery-first", []byte("first")); err != nil || retryID != firstID {
		t.Fatalf("exact retry at full capacity id=%q err=%v, want %q", retryID, err, firstID)
	}
	if _, err := appender.Append(ctx, stream, redisEnvelopeField, "delivery-third", []byte("must-not-drop-existing")); !errors.Is(err, ErrControlStreamSaturated) || !errors.Is(err, executionapp.ErrDispatchBackpressured) {
		t.Fatalf("expected typed stream saturation at capacity, got %v", err)
	} else {
		var saturation *ControlStreamSaturatedError
		if !errors.As(err, &saturation) || saturation.CurrentEntries != 2 || saturation.CurrentMappings != 2 || saturation.MaxEntries != 2 {
			t.Fatalf("unexpected saturation details: %#v", saturation)
		}
	}
	if length, err := client.XLen(ctx, stream).Result(); err != nil || length != 2 {
		t.Fatalf("saturated append changed stream length: length=%d err=%v", length, err)
	}

	if deleted, err := client.XDel(ctx, stream, firstID).Result(); err != nil || deleted != 1 {
		t.Fatalf("release settled entry capacity: deleted=%d err=%v", deleted, err)
	}
	if deleted, err := client.HDel(ctx, deliveryIndexKey(stream), "delivery-first").Result(); err != nil || deleted != 1 {
		t.Fatalf("release settled delivery mapping: deleted=%d err=%v", deleted, err)
	}
	if _, err := appender.Append(ctx, stream, redisEnvelopeField, "delivery-third", []byte("third")); err != nil {
		t.Fatalf("append after XDEL released capacity: %v", err)
	}
	entries, err := client.XRange(ctx, stream, "-", "+").Result()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[0].Values[redisEnvelopeField] != "second" || entries[1].Values[redisEnvelopeField] != "third" {
		t.Fatalf("capacity recovery dropped or trimmed an entry: %+v", entries)
	}
}

func TestRedisStreamAppenderConcurrentConflictingBytesSelectOneImmutableWinner(t *testing.T) {
	server := miniredis.RunT(t)
	appenders := make([]*RedisStreamAppender, 2)
	for index := range appenders {
		client := redis.NewClient(&redis.Options{Addr: server.Addr()})
		t.Cleanup(func() {
			if err := client.Close(); err != nil {
				t.Errorf("close Redis client: %v", err)
			}
		})
		appender, err := NewRedisStreamAppender(client, RedisStreamAppenderConfig{MaxEntries: 2, MaxEntryBytes: 1024})
		if err != nil {
			t.Fatal(err)
		}
		appenders[index] = appender
	}

	const attempts = 32
	type appendResult struct {
		value string
		id    string
		err   error
	}
	ctx := context.Background()
	stream := "test:control:concurrent-conflict"
	start := make(chan struct{})
	results := make(chan appendResult, attempts)
	var workers sync.WaitGroup
	workers.Add(attempts)
	for index := range attempts {
		go func() {
			defer workers.Done()
			<-start
			value := fmt.Sprintf("candidate-%d", index%2)
			entryID, err := appenders[index%len(appenders)].Append(ctx, stream, redisEnvelopeField, "one-stable-delivery", []byte(value))
			results <- appendResult{value: value, id: entryID, err: err}
		}()
	}
	close(start)
	workers.Wait()
	close(results)

	entries, err := appenders[0].client.(*redis.Client).XRange(ctx, stream, "-", "+").Result()
	if err != nil || len(entries) != 1 {
		t.Fatalf("conflicting race entries=%v err=%v, want one", entries, err)
	}
	winner, ok := entries[0].Values[redisEnvelopeField].(string)
	if !ok || (winner != "candidate-0" && winner != "candidate-1") {
		t.Fatalf("invalid immutable winner: %#v", entries[0].Values)
	}
	succeeded, conflicted := 0, 0
	for result := range results {
		switch {
		case result.value == winner && result.err == nil && result.id == entries[0].ID:
			succeeded++
		case result.value != winner && errors.Is(result.err, ErrControlDeliveryConflict) && result.id == "":
			conflicted++
		default:
			t.Fatalf("conflicting race returned value=%q id=%q err=%v for winner=%q", result.value, result.id, result.err, winner)
		}
	}
	if succeeded != attempts/2 || conflicted != attempts/2 {
		t.Fatalf("conflicting race successes=%d conflicts=%d, want %d/%d", succeeded, conflicted, attempts/2, attempts/2)
	}
	if mappings, err := appenders[0].client.(*redis.Client).HLen(ctx, deliveryIndexKey(stream)).Result(); err != nil || mappings != 1 {
		t.Fatalf("conflicting race mappings=%d err=%v, want 1", mappings, err)
	}
}

func TestRedisStreamAppenderDeduplicatesAndFailsClosedOnPartialKeyLoss(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() {
		if err := client.Close(); err != nil {
			t.Errorf("close Redis client: %v", err)
		}
	})
	appender, err := NewRedisStreamAppender(client, RedisStreamAppenderConfig{MaxEntries: 2, MaxEntryBytes: 1024})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	stream := "test:control:delivery-dedupe"
	firstID, err := appender.Append(ctx, stream, redisEnvelopeField, "outbox-1", []byte("exact-envelope"))
	if err != nil {
		t.Fatal(err)
	}
	deduplicatedID, err := appender.Append(ctx, stream, redisEnvelopeField, "outbox-1", []byte("exact-envelope"))
	if err != nil || deduplicatedID != firstID {
		t.Fatalf("exact retry id=%q err=%v, want %q", deduplicatedID, err, firstID)
	}
	if _, err := appender.Append(ctx, stream, redisEnvelopeField, "outbox-1", []byte("conflicting-envelope")); !errors.Is(err, ErrControlDeliveryConflict) {
		t.Fatalf("stable identity accepted different exact bytes: %v", err)
	}
	if length, err := client.XLen(ctx, stream).Result(); err != nil || length != 1 {
		t.Fatalf("exact retry duplicated stream entry: length=%d err=%v", length, err)
	}

	// Hash-only state: losing the stream entry while retaining its mapping is
	// ambiguous and must fail without deleting or replacing the mapping.
	if deleted, err := client.XDel(ctx, stream, firstID).Result(); err != nil || deleted != 1 {
		t.Fatalf("inject hash-only state: deleted=%d err=%v", deleted, err)
	}
	if _, err := appender.Append(ctx, stream, redisEnvelopeField, "outbox-1", []byte("exact-envelope")); !errors.Is(err, ErrControlDeliveryIndexInconsistent) {
		t.Fatalf("hash-only state did not fail closed: %v", err)
	} else {
		var inconsistent *ControlDeliveryIndexInconsistentError
		if !errors.As(err, &inconsistent) || inconsistent.CurrentEntries != 0 || inconsistent.CurrentMappings != 1 {
			t.Fatalf("unexpected hash-only inconsistency: %#v", inconsistent)
		}
	}
	if length, err := client.XLen(ctx, stream).Result(); err != nil || length != 0 {
		t.Fatalf("hash-only rejection mutated stream: length=%d err=%v", length, err)
	}
	if mappedID, err := client.HGet(ctx, deliveryIndexKey(stream), "outbox-1").Result(); err != nil || mappedID != firstID {
		t.Fatalf("hash-only rejection mutated mapping=%q err=%v, want %q", mappedID, err, firstID)
	}

	// Coordinated loss of both keys is unambiguous: PostgreSQL visibility
	// repair can replay the exact durable bytes and rebuild the pair.
	if err := client.Del(ctx, stream, deliveryIndexKey(stream)).Err(); err != nil {
		t.Fatalf("reset both Redis keys: %v", err)
	}
	rebuiltID, err := appender.Append(ctx, stream, redisEnvelopeField, "outbox-1", []byte("exact-envelope"))
	if err != nil || rebuiltID == "" {
		t.Fatalf("coordinated-loss rebuild id=%q err=%v", rebuiltID, err)
	}

	// Stream-only state: losing the mapping while retaining the stream entry
	// is equally ambiguous and must leave the entry untouched.
	if deleted, err := client.HDel(ctx, deliveryIndexKey(stream), "outbox-1").Result(); err != nil || deleted != 1 {
		t.Fatalf("inject stream-only state: deleted=%d err=%v", deleted, err)
	}
	if _, err := appender.Append(ctx, stream, redisEnvelopeField, "outbox-1", []byte("exact-envelope")); !errors.Is(err, ErrControlDeliveryIndexInconsistent) {
		t.Fatalf("stream-only state did not fail closed: %v", err)
	} else {
		var inconsistent *ControlDeliveryIndexInconsistentError
		if !errors.As(err, &inconsistent) || inconsistent.CurrentEntries != 1 || inconsistent.CurrentMappings != 0 {
			t.Fatalf("unexpected stream-only inconsistency: %#v", inconsistent)
		}
	}
	entries, err := client.XRange(ctx, stream, "-", "+").Result()
	if err != nil || len(entries) != 1 || entries[0].ID != rebuiltID || entries[0].Values[redisEnvelopeField] != "exact-envelope" {
		t.Fatalf("stream-only rejection mutated entry: entries=%v err=%v", entries, err)
	}
	if mappings, err := client.HLen(ctx, deliveryIndexKey(stream)).Result(); err != nil || mappings != 0 {
		t.Fatalf("stream-only rejection mutated mappings=%d err=%v", mappings, err)
	}
}

func TestRedisStreamAppenderCapacityIsAtomicAcrossPublishers(t *testing.T) {
	server := miniredis.RunT(t)
	const (
		capacity = int64(7)
		attempts = 64
	)
	appenders := make([]*RedisStreamAppender, 2)
	for index := range appenders {
		client := redis.NewClient(&redis.Options{Addr: server.Addr()})
		t.Cleanup(func() {
			if err := client.Close(); err != nil {
				t.Errorf("close Redis client: %v", err)
			}
		})
		appender, err := NewRedisStreamAppender(client, RedisStreamAppenderConfig{MaxEntries: capacity, MaxEntryBytes: 1024})
		if err != nil {
			t.Fatal(err)
		}
		appenders[index] = appender
	}

	ctx := context.Background()
	stream := "test:control:concurrent-capacity"
	start := make(chan struct{})
	results := make(chan error, attempts)
	var workers sync.WaitGroup
	workers.Add(attempts)
	for index := range attempts {
		go func() {
			defer workers.Done()
			<-start
			_, err := appenders[index%len(appenders)].Append(ctx, stream, redisEnvelopeField, fmt.Sprintf("delivery-%d", index), []byte(fmt.Sprintf("command-%d", index)))
			results <- err
		}()
	}
	close(start)
	workers.Wait()
	close(results)

	succeeded := 0
	saturated := 0
	for err := range results {
		switch {
		case err == nil:
			succeeded++
		case errors.Is(err, ErrControlStreamSaturated):
			saturated++
		default:
			t.Fatalf("unexpected concurrent append result: %v", err)
		}
	}
	if succeeded != int(capacity) || saturated != attempts-int(capacity) {
		t.Fatalf("atomic capacity gate admitted successes=%d saturated=%d, want %d/%d", succeeded, saturated, capacity, attempts-int(capacity))
	}
	if length, err := appenders[0].client.(*redis.Client).XLen(ctx, stream).Result(); err != nil || length != capacity {
		t.Fatalf("concurrent capacity gate produced length=%d err=%v, want %d", length, err, capacity)
	}
	if mappings, err := appenders[0].client.(*redis.Client).HLen(ctx, deliveryIndexKey(stream)).Result(); err != nil || mappings != capacity {
		t.Fatalf("concurrent capacity gate produced mappings=%d err=%v, want %d", mappings, err, capacity)
	}
}

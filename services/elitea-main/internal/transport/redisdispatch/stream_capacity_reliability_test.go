package redisdispatch

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	redisReliabilityRoundsEnv   = "ELITEA_RUNTIME_REDIS_RELIABILITY_ROUNDS"
	redisReliabilityDurationEnv = "ELITEA_RUNTIME_REDIS_RELIABILITY_DURATION"
)

// TestRedisStreamServiceBackedCapacityReliability is an opt-in real-Redis
// load/reliability test. A configured duration makes it a developer-scale
// single-service soak. It proves the Lua stream+delivery-index gate is atomic
// across clients, never trims a live command, bounds both keys, and releases
// capacity only after terminal stream and mapping cleanup. Every round also
// injects each one-key-loss direction and proves retry fails without mutation;
// coordinated loss of both keys remains repairable from the exact input.
// It does not inject a Redis process outage and is not a production-topology
// soak, multiprocess E2E, or production-scale issue #5681 data-path test.
func TestRedisStreamServiceBackedCapacityReliability(t *testing.T) {
	roundsValue := os.Getenv(redisReliabilityRoundsEnv)
	durationValue := os.Getenv(redisReliabilityDurationEnv)
	if roundsValue == "" && durationValue == "" {
		t.Skipf("set either %s (1..1000) or %s (1s..5m) to run the real-Redis reliability test", redisReliabilityRoundsEnv, redisReliabilityDurationEnv)
	}
	if roundsValue != "" && durationValue != "" {
		t.Fatalf("set only one of %s and %s", redisReliabilityRoundsEnv, redisReliabilityDurationEnv)
	}
	rounds := 0
	soakDuration := time.Duration(0)
	if roundsValue != "" {
		parsed, err := strconv.Atoi(roundsValue)
		if err != nil || parsed < 1 || parsed > 1000 || strconv.Itoa(parsed) != roundsValue {
			t.Fatalf("%s must be a canonical integer from 1 to 1000", redisReliabilityRoundsEnv)
		}
		rounds = parsed
	} else {
		parsed, err := time.ParseDuration(durationValue)
		if err != nil || parsed < time.Second || parsed > 5*time.Minute {
			t.Fatalf("%s must be a duration from 1s through 5m", redisReliabilityDurationEnv)
		}
		soakDuration = parsed
	}
	address := os.Getenv(redisServiceTestAddressEnv)
	if address == "" {
		t.Skipf("set %s with %s", redisServiceTestAddressEnv, redisReliabilityRoundsEnv)
	}

	const (
		clientCount       = 4
		streamCapacity    = int64(64)
		attemptsPerRound  = 1024
		concurrentWorkers = 32
	)
	testTimeout := 5 * time.Minute
	if soakDuration > 0 {
		testTimeout = soakDuration + time.Minute
	}
	ctx, cancel := context.WithTimeout(context.Background(), testTimeout)
	defer cancel()
	clients := make([]*redis.Client, clientCount)
	for index := range clients {
		clients[index] = redis.NewClient(&redis.Options{
			Addr:           address,
			DialTimeout:    2 * time.Second,
			ReadTimeout:    2 * time.Second,
			WriteTimeout:   2 * time.Second,
			PoolTimeout:    2 * time.Second,
			PoolSize:       concurrentWorkers / clientCount,
			MaxActiveConns: concurrentWorkers / clientCount,
			MaxRetries:     -1,
		})
		if err := clients[index].Ping(ctx).Err(); err != nil {
			t.Fatalf("ping Redis client %d: %v", index, err)
		}
		defer func(client *redis.Client) {
			if err := client.Close(); err != nil {
				t.Errorf("close Redis reliability client: %v", err)
			}
		}(clients[index])
	}

	stream := fmt.Sprintf("elitea:test:capacity-reliability:%d", time.Now().UnixNano())
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cleanupCancel()
		if err := clients[0].Del(cleanupCtx, stream, deliveryIndexKey(stream)).Err(); err != nil {
			t.Errorf("delete Redis reliability stream: %v", err)
		}
	}()

	appenders := make([]*RedisStreamAppender, clientCount)
	for index, client := range clients {
		appender, err := NewRedisStreamAppender(client, RedisStreamAppenderConfig{
			MaxEntries:    streamCapacity,
			MaxEntryBytes: 64 * 1024,
		})
		if err != nil {
			t.Fatal(err)
		}
		appenders[index] = appender
	}
	controlValue := []byte("bounded-reference-only-control-envelope")

	started := time.Now()
	completedRounds := 0
	peakConnections := 0
	for rounds <= 0 || completedRounds < rounds {
		if soakDuration > 0 && completedRounds > 0 && time.Since(started) >= soakDuration {
			break
		}
		round := completedRounds
		if err := clients[0].Del(ctx, stream, deliveryIndexKey(stream)).Err(); err != nil {
			t.Fatalf("round %d reset stream: %v", round, err)
		}
		type appendResult struct {
			deliveryID string
			err        error
		}
		jobs := make(chan int)
		results := make(chan appendResult, attemptsPerRound)
		var workers sync.WaitGroup
		workers.Add(concurrentWorkers)
		for range concurrentWorkers {
			go func() {
				defer workers.Done()
				for attempt := range jobs {
					deliveryID := fmt.Sprintf("round-%d-attempt-%d", round, attempt)
					_, err := appenders[attempt%len(appenders)].Append(ctx, stream, redisEnvelopeField, deliveryID, controlValue)
					results <- appendResult{deliveryID: deliveryID, err: err}
				}
			}()
		}
		for attempt := range attemptsPerRound {
			jobs <- attempt
		}
		close(jobs)
		workers.Wait()
		close(results)

		succeeded := 0
		saturated := 0
		successfulDeliveries := make([]string, 0, streamCapacity)
		for result := range results {
			switch {
			case result.err == nil:
				succeeded++
				successfulDeliveries = append(successfulDeliveries, result.deliveryID)
			case errors.Is(result.err, ErrControlStreamSaturated):
				saturated++
			default:
				t.Fatalf("round %d unexpected append result: %v", round, result.err)
			}
		}
		if succeeded != int(streamCapacity) || saturated != attemptsPerRound-int(streamCapacity) {
			t.Fatalf("round %d successes=%d saturated=%d, want %d/%d", round, succeeded, saturated, streamCapacity, attemptsPerRound-int(streamCapacity))
		}
		entries, err := clients[0].XRangeN(ctx, stream, "-", "+", streamCapacity+1).Result()
		if err != nil {
			t.Fatalf("round %d read bounded stream: %v", round, err)
		}
		if len(entries) != int(streamCapacity) {
			t.Fatalf("round %d live stream entries=%d, want %d", round, len(entries), streamCapacity)
		}
		if mappings, err := clients[0].HLen(ctx, deliveryIndexKey(stream)).Result(); err != nil || mappings != streamCapacity {
			t.Fatalf("round %d live delivery mappings=%d err=%v, want %d", round, mappings, err, streamCapacity)
		}
		entryIDs := make([]string, len(entries))
		for index, entry := range entries {
			entryIDs[index] = entry.ID
			if len(entry.Values) != 1 {
				t.Fatalf("round %d entry %s fields=%d, want 1", round, entry.ID, len(entry.Values))
			}
			raw, ok := entry.Values[redisEnvelopeField].(string)
			if !ok || !bytes.Equal([]byte(raw), controlValue) {
				t.Fatalf("round %d entry %s changed durable control bytes", round, entry.ID)
			}
		}
		deleted, err := clients[0].XDel(ctx, stream, entryIDs...).Result()
		if err != nil || deleted != streamCapacity {
			t.Fatalf("round %d XDEL released=%d/%d err=%v", round, deleted, streamCapacity, err)
		}
		removedMappings, err := clients[0].HDel(ctx, deliveryIndexKey(stream), successfulDeliveries...).Result()
		if err != nil || removedMappings != streamCapacity {
			t.Fatalf("round %d HDEL released=%d/%d err=%v", round, removedMappings, streamCapacity, err)
		}
		if length, err := clients[0].XLen(ctx, stream).Result(); err != nil || length != 0 {
			t.Fatalf("round %d post-settlement XLEN=%d err=%v", round, length, err)
		}
		if mappings, err := clients[0].HLen(ctx, deliveryIndexKey(stream)).Result(); err != nil || mappings != 0 {
			t.Fatalf("round %d post-settlement HLEN=%d err=%v", round, mappings, err)
		}

		probeDeliveryID := fmt.Sprintf("round-%d-divergence-probe", round)
		probeEntryID, err := appenders[0].Append(ctx, stream, redisEnvelopeField, probeDeliveryID, controlValue)
		if err != nil {
			t.Fatalf("round %d append hash-only probe: %v", round, err)
		}
		if deleted, err := clients[0].XDel(ctx, stream, probeEntryID).Result(); err != nil || deleted != 1 {
			t.Fatalf("round %d inject hash-only state: deleted=%d err=%v", round, deleted, err)
		}
		if _, err := appenders[1].Append(ctx, stream, redisEnvelopeField, probeDeliveryID, controlValue); !errors.Is(err, ErrControlDeliveryIndexInconsistent) {
			t.Fatalf("round %d hash-only retry did not fail closed: %v", round, err)
		}
		if length, err := clients[0].XLen(ctx, stream).Result(); err != nil || length != 0 {
			t.Fatalf("round %d hash-only rejection mutated XLEN=%d err=%v", round, length, err)
		}
		if mappings, err := clients[0].HLen(ctx, deliveryIndexKey(stream)).Result(); err != nil || mappings != 1 {
			t.Fatalf("round %d hash-only rejection mutated HLEN=%d err=%v", round, mappings, err)
		}
		if err := clients[0].Del(ctx, stream, deliveryIndexKey(stream)).Err(); err != nil {
			t.Fatalf("round %d clear coordinated hash-only loss: %v", round, err)
		}

		probeEntryID, err = appenders[2].Append(ctx, stream, redisEnvelopeField, probeDeliveryID, controlValue)
		if err != nil {
			t.Fatalf("round %d rebuild coordinated key loss: %v", round, err)
		}
		if deleted, err := clients[0].HDel(ctx, deliveryIndexKey(stream), probeDeliveryID).Result(); err != nil || deleted != 1 {
			t.Fatalf("round %d inject stream-only state: deleted=%d err=%v", round, deleted, err)
		}
		if _, err := appenders[3].Append(ctx, stream, redisEnvelopeField, probeDeliveryID, controlValue); !errors.Is(err, ErrControlDeliveryIndexInconsistent) {
			t.Fatalf("round %d stream-only retry did not fail closed: %v", round, err)
		}
		entries, err = clients[0].XRangeN(ctx, stream, "-", "+", 2).Result()
		if err != nil || len(entries) != 1 || entries[0].ID != probeEntryID {
			t.Fatalf("round %d stream-only rejection mutated entries=%v err=%v", round, entries, err)
		}
		if mappings, err := clients[0].HLen(ctx, deliveryIndexKey(stream)).Result(); err != nil || mappings != 0 {
			t.Fatalf("round %d stream-only rejection mutated HLEN=%d err=%v", round, mappings, err)
		}
		if err := clients[0].Del(ctx, stream, deliveryIndexKey(stream)).Err(); err != nil {
			t.Fatalf("round %d clear coordinated stream-only loss: %v", round, err)
		}

		totalConnections := 0
		for _, client := range clients {
			totalConnections += int(client.PoolStats().TotalConns)
		}
		if totalConnections > concurrentWorkers {
			t.Fatalf("round %d Redis client connections=%d, declared bound=%d", round, totalConnections, concurrentWorkers)
		}
		peakConnections = max(peakConnections, totalConnections)
		completedRounds++
	}
	t.Logf("real Redis reliability rounds=%d attempts=%d elapsed=%s configured_duration=%s fixed_concurrency=%d clients=%d peak_connections=%d live_entry_ceiling=%d", completedRounds, completedRounds*attemptsPerRound, time.Since(started), soakDuration, concurrentWorkers, clientCount, peakConnections, streamCapacity)
}

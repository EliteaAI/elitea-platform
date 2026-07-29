package redisdispatch

import (
	"context"
	"errors"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestIndexV2CutoverReaderRequiresEmptyStreamPendingListAndDeliveryIndex(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() {
		if err := client.Close(); err != nil {
			t.Errorf("close Redis client: %v", err)
		}
	})
	ctx := context.Background()
	stream := "commands.v1.index.ingest.indexing.shared.1.0"
	group := "elitea-indexer-worker-v1"
	if err := client.XGroupCreateMkStream(ctx, stream, group, "0").Err(); err != nil {
		t.Fatal(err)
	}
	reader, err := NewIndexV2CutoverReader(client, stream, group)
	if err != nil {
		t.Fatal(err)
	}
	state, err := reader.ReadIndexControlState(ctx)
	if err != nil || state.StreamEntries != 0 || state.PendingEntries != 0 || state.DeliveryMappings != 0 {
		t.Fatalf("clean state=%+v err=%v", state, err)
	}
	entryID, err := client.XAdd(ctx, &redis.XAddArgs{
		Stream: stream,
		Values: map[string]any{redisEnvelopeField: "signed-v1"},
	}).Result()
	if err != nil {
		t.Fatal(err)
	}
	if err := client.HSet(ctx, deliveryIndexKey(stream), "outbox-v1", entryID).Err(); err != nil {
		t.Fatal(err)
	}
	if _, err := client.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group:    group,
		Consumer: "worker-v1",
		Streams:  []string{stream, ">"},
		Count:    1,
	}).Result(); err != nil {
		t.Fatal(err)
	}
	state, err = reader.ReadIndexControlState(ctx)
	if err != nil || state.StreamEntries != 1 || state.PendingEntries != 1 || state.DeliveryMappings != 1 {
		t.Fatalf("outstanding state=%+v err=%v", state, err)
	}
}

func TestIndexV2CutoverReaderFailsClosedWhenConsumerGroupIsAbsent(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	reader, err := NewIndexV2CutoverReader(
		client,
		"commands.v1.index.ingest.indexing.shared.1.0",
		"elitea-indexer-worker-v1",
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reader.ReadIndexControlState(context.Background()); err == nil {
		t.Fatal("absent consumer group was accepted")
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := reader.ReadIndexControlState(cancelled); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled error=%v", err)
	}
}

package redisdispatch

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"fmt"
	"os"
	"testing"
	"time"

	runtimev1 "github.com/EliteaAI/elitea-platform/libs/proto/gen/go/elitea/runtime/v1"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
	"github.com/redis/go-redis/v9"
)

const redisServiceTestAddressEnv = "ELITEA_TEST_REDIS_ADDR"

// TestRedisStreamServiceBackedControlPlane exercises only the Redis control
// adapter against a real Redis 7 service. It is not a full runtime E2E test:
// PostgreSQL, the Python worker, gRPC, HTTPS input, and SSE are out of scope.
func TestRedisStreamServiceBackedControlPlane(t *testing.T) {
	address := os.Getenv(redisServiceTestAddressEnv)
	if address == "" {
		t.Skipf("set %s to run the real-Redis integration test", redisServiceTestAddressEnv)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	client := redis.NewClient(&redis.Options{
		Addr:         address,
		DialTimeout:  2 * time.Second,
		ReadTimeout:  2 * time.Second,
		WriteTimeout: 2 * time.Second,
		MaxRetries:   0,
	})
	defer func() {
		if err := client.Close(); err != nil {
			t.Errorf("close Redis client: %v", err)
		}
	}()
	if err := client.Ping(ctx).Err(); err != nil {
		t.Fatalf("ping Redis service at %s: %v", address, err)
	}

	stream := fmt.Sprintf("elitea:test:configuration-validation:%d", time.Now().UnixNano())
	group := "elitea-worker-python-test"
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cleanupCancel()
		if err := client.Del(cleanupCtx, stream).Err(); err != nil {
			t.Errorf("delete Redis test stream: %v", err)
		}
	}()
	if err := client.XGroupCreateMkStream(ctx, stream, group, "0").Err(); err != nil {
		t.Fatalf("create Redis consumer group: %v", err)
	}

	appender, err := NewRedisStreamAppender(client)
	if err != nil {
		t.Fatal(err)
	}
	limits, err := LimitsFromProto(&runtimev1.ProtocolLimitsV1{
		LimitsRevision:         "elitea.runtime.limits.conformance.v1",
		MaxWorkerCommandBytes:  32 * 1024,
		MaxSignedEnvelopeBytes: 48 * 1024,
		MaxRedisFieldBytes:     48 * 1024,
		MaxRedisEntryBytes:     64 * 1024,
		MaxSafeStringBytes:     256,
	})
	if err != nil {
		t.Fatal(err)
	}
	config := validProducerConfig()
	config.Stream = stream
	config.ProtocolRevision = "elitea.runtime.v1"
	config.EnvelopeSchemaRevision = "elitea.runtime.signed-worker-command.v1"
	config.Limits = limits
	producer, err := NewProducer(config, redisServiceHMACSigner{}, appender)
	if err != nil {
		t.Fatal(err)
	}

	settingsCanary := []byte(`{"auth_type":"Digest","secret":"ELITEA_SETTINGS_CANARY"}`)
	outputCanary := []byte("ELITEA_OUTPUT_CANARY:binary-terminal-frame")
	heavyToken := []byte("ELITEA_32_MIB_BODY_CANARY")
	heavyBody := bytes.Repeat(heavyToken, (32<<20)/len(heavyToken)+1)
	heavyBody = heavyBody[:32<<20]
	if len(heavyBody) != 32<<20 {
		t.Fatal("test did not construct the 32 MiB regression canary")
	}
	forbidden := [][]byte{
		settingsCanary,
		[]byte("ELITEA_SETTINGS_CANARY"),
		outputCanary,
		[]byte("ELITEA_OUTPUT_CANARY"),
		heavyToken,
		heavyBody,
	}

	dispatch := validTransportDispatch()
	dispatch.CapabilityVersion = "1"
	dispatch.LimitsRevision = limits.Revision
	prepared, err := producer.PrepareValidation(ctx, dispatch)
	if err != nil {
		t.Fatal(err)
	}
	if err := producer.AppendPrepared(ctx, prepared); err != nil {
		t.Fatal(err)
	}
	first := readNewRedisMessage(t, ctx, client, stream, group, "consumer-primary")
	firstValue := assertReferenceOnlyRedisMessage(t, first, config.Limits, forbidden)
	if prepared.Digest != runtimedomain.SHA256(firstValue) {
		t.Fatal("producer digest does not bind the exact Redis field bytes")
	}
	assertPendingCount(t, ctx, client, stream, group, 1)
	if acknowledged, err := client.XAck(ctx, stream, group, first.ID).Result(); err != nil {
		t.Fatalf("ack first Redis delivery: %v", err)
	} else if acknowledged != 1 {
		t.Fatalf("acknowledged %d first Redis deliveries, want 1", acknowledged)
	}
	assertPendingCount(t, ctx, client, stream, group, 0)

	if err := producer.AppendPrepared(ctx, prepared); err != nil {
		t.Fatal(err)
	}
	unacknowledged := readNewRedisMessage(t, ctx, client, stream, group, "consumer-primary")
	assertReferenceOnlyRedisMessage(t, unacknowledged, config.Limits, forbidden)
	assertPendingCount(t, ctx, client, stream, group, 1)

	claimed, _, err := client.XAutoClaim(ctx, &redis.XAutoClaimArgs{
		Stream:   stream,
		Group:    group,
		Consumer: "consumer-recovery",
		MinIdle:  0,
		Start:    "0-0",
		Count:    1,
	}).Result()
	if err != nil {
		t.Fatalf("reclaim pending Redis delivery: %v", err)
	}
	if len(claimed) != 1 || claimed[0].ID != unacknowledged.ID {
		t.Fatalf("unexpected reclaimed Redis deliveries: %+v", claimed)
	}
	assertReferenceOnlyRedisMessage(t, claimed[0], config.Limits, forbidden)

	pending, err := client.XPendingExt(ctx, &redis.XPendingExtArgs{
		Stream: stream,
		Group:  group,
		Start:  "-",
		End:    "+",
		Count:  1,
	}).Result()
	if err != nil {
		t.Fatalf("inspect reclaimed Redis delivery: %v", err)
	}
	if len(pending) != 1 || pending[0].ID != unacknowledged.ID || pending[0].Consumer != "consumer-recovery" {
		t.Fatalf("pending Redis delivery was not transferred to the recovery consumer: %+v", pending)
	}
	if acknowledged, err := client.XAck(ctx, stream, group, unacknowledged.ID).Result(); err != nil {
		t.Fatalf("ack reclaimed Redis delivery: %v", err)
	} else if acknowledged != 1 {
		t.Fatalf("acknowledged %d reclaimed Redis deliveries, want 1", acknowledged)
	}
	assertPendingCount(t, ctx, client, stream, group, 0)
}

type redisServiceHMACSigner struct{}

func (redisServiceHMACSigner) SignWorkerCommand(_ context.Context, command []byte) (Signature, error) {
	mac := hmac.New(sha256.New, []byte("ELITEA_RUNTIME_V1_TEST_ONLY_NOT_A_SECRET"))
	_, _ = mac.Write(command)
	return Signature{
		Profile: runtimev1.SignatureProfileV1_SIGNATURE_PROFILE_V1_TEST_ONLY_HMAC_SHA256,
		KeyID:   "elitea-runtime-v1-conformance-hmac",
		Value:   mac.Sum(nil),
	}, nil
}

func readNewRedisMessage(t *testing.T, ctx context.Context, client *redis.Client, stream, group, consumer string) redis.XMessage {
	t.Helper()
	streams, err := client.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group:    group,
		Consumer: consumer,
		Streams:  []string{stream, ">"},
		Count:    1,
		Block:    2 * time.Second,
	}).Result()
	if err != nil {
		t.Fatalf("read Redis consumer-group delivery: %v", err)
	}
	if len(streams) != 1 || streams[0].Stream != stream || len(streams[0].Messages) != 1 {
		t.Fatalf("unexpected Redis consumer-group response: %+v", streams)
	}
	return streams[0].Messages[0]
}

func assertReferenceOnlyRedisMessage(t *testing.T, message redis.XMessage, limits Limits, forbidden [][]byte) []byte {
	t.Helper()
	if len(message.Values) != 1 {
		t.Fatalf("Redis control entry has %d fields, want exactly 1: %+v", len(message.Values), message.Values)
	}
	raw, ok := message.Values[redisEnvelopeField]
	if !ok {
		t.Fatalf("Redis control entry lacks %q: %+v", redisEnvelopeField, message.Values)
	}
	var value []byte
	switch typed := raw.(type) {
	case string:
		value = []byte(typed)
	case []byte:
		value = append([]byte(nil), typed...)
	default:
		t.Fatalf("Redis control field used non-binary-safe type %T", raw)
	}
	if len(value) > limits.MaxRedisFieldBytes {
		t.Fatalf("Redis control field is %d bytes, limit %d", len(value), limits.MaxRedisFieldBytes)
	}
	if size := encodedRedisEntryBytes(redisEnvelopeField, value); size > limits.MaxRedisEntryBytes {
		t.Fatalf("complete Redis control entry is %d bytes, limit %d", size, limits.MaxRedisEntryBytes)
	}
	for _, canary := range forbidden {
		if bytes.Contains(value, canary) {
			t.Fatalf("Redis control entry contains forbidden body canary %q", canary[:min(len(canary), 64)])
		}
	}
	return value
}

func assertPendingCount(t *testing.T, ctx context.Context, client *redis.Client, stream, group string, expected int64) {
	t.Helper()
	pending, err := client.XPending(ctx, stream, group).Result()
	if err != nil {
		t.Fatalf("inspect Redis pending deliveries: %v", err)
	}
	if pending.Count != expected {
		t.Fatalf("Redis pending delivery count is %d, want %d", pending.Count, expected)
	}
}

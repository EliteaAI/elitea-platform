package redisdispatch

import (
	"errors"
	"fmt"

	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	"github.com/redis/go-redis/v9"
)

// maxSupportedControlStreamEncodedBytes is the hard per-stream budget for the
// protocol's conservative encoded-entry bound. With the v1 64 KiB entry limit,
// one Redis control stream can therefore hold at most 1,024 live entries.
// Deployments may configure a lower count, but cannot raise this 64 MiB bound.
const maxSupportedControlStreamEncodedBytes = int64(64 << 20)

var appendWithinCapacityScript = redis.NewScript(`
local capacity = tonumber(ARGV[1])
local field = ARGV[2]
local value = ARGV[3]
local delivery_id = ARGV[4]
local length = redis.call('XLEN', KEYS[1])
local mappings = redis.call('HLEN', KEYS[2])
-- Any one-key loss is ambiguous. Refuse it before HGET/XADD/HSET so this
-- attempt cannot mutate either survivor. Zero/zero intentionally continues:
-- PostgreSQL can replay the immutable envelope after coordinated key loss.
if length ~= mappings then
    return {-2, length, mappings}
end
local mapped_entry_id = redis.call('HGET', KEYS[2], delivery_id)
if mapped_entry_id then
    local mapped_entries = redis.call('XRANGE', KEYS[1], mapped_entry_id, mapped_entry_id, 'COUNT', 1)
    if #mapped_entries == 1 then
        local mapped_fields = mapped_entries[1][2]
        if #mapped_fields ~= 2 or mapped_fields[1] ~= field or mapped_fields[2] ~= value then
            return {-1, mapped_entry_id, mappings}
        end
        return {2, mapped_entry_id, mappings}
    end
    return {-2, length, mappings}
end
if length >= capacity or mappings >= capacity then
    return {0, length, mappings}
end
local entry_id = redis.call('XADD', KEYS[1], '*', field, value)
redis.call('HSET', KEYS[2], delivery_id, entry_id)
return {1, entry_id, mappings + 1}
`)

// RedisStreamAppenderConfig bounds live entries and stable-delivery mappings in
// one control stream. XACK alone does not release capacity; the settlement path
// must atomically XACK, XDEL, and HDEL the terminal entry and its mapping.
// Saturated commands remain in the durable PostgreSQL outbox.
type RedisStreamAppenderConfig struct {
	MaxEntries    int64
	MaxEntryBytes int
}

func (c RedisStreamAppenderConfig) validate() error {
	if c.MaxEntries <= 0 || c.MaxEntryBytes <= 0 {
		return errors.New("invalid Redis control stream capacity")
	}
	// Division avoids multiplication overflow. It also keeps MaxEntries far
	// inside Redis Lua 5.1's exact-integer range.
	if int64(c.MaxEntryBytes) > maxSupportedControlStreamEncodedBytes || c.MaxEntries > maxSupportedControlStreamEncodedBytes/int64(c.MaxEntryBytes) {
		return errors.New("Redis control stream capacity exceeds the supported encoded-byte budget")
	}
	return nil
}

var ErrControlStreamSaturated = errors.New("CONTROL_STREAM_SATURATED")

// ControlStreamSaturatedError is a retryable backpressure result. No stream
// entry was appended by the attempt that returned this error.
type ControlStreamSaturatedError struct {
	CurrentEntries  int64
	CurrentMappings int64
	MaxEntries      int64
}

func (e *ControlStreamSaturatedError) Error() string {
	return fmt.Sprintf("%s: current entries %d mappings %d reached configured capacity %d", ErrControlStreamSaturated, e.CurrentEntries, e.CurrentMappings, e.MaxEntries)
}

func (e *ControlStreamSaturatedError) Unwrap() error {
	return executionapp.ErrDispatchBackpressured
}

func (e *ControlStreamSaturatedError) Is(target error) bool {
	return target == ErrControlStreamSaturated || target == executionapp.ErrDispatchBackpressured
}

func parseCapacityAppendResult(raw any, capacity int64) (string, error) {
	values, ok := raw.([]any)
	if !ok || len(values) != 3 {
		return "", errors.New("invalid Redis capacity-append response")
	}
	status, ok := values[0].(int64)
	if !ok {
		return "", errors.New("invalid Redis capacity-append status")
	}
	switch status {
	case -2:
		entries, entriesOK := values[1].(int64)
		mappings, mappingsOK := values[2].(int64)
		if !entriesOK || !mappingsOK || entries < 0 || mappings < 0 {
			return "", errors.New("invalid Redis delivery-index inconsistency response")
		}
		return "", &ControlDeliveryIndexInconsistentError{CurrentEntries: entries, CurrentMappings: mappings}
	case -1:
		return "", ErrControlDeliveryConflict
	case 0:
		current, ok := values[1].(int64)
		mappings, mappingsOK := values[2].(int64)
		if !ok || !mappingsOK || (current < capacity && mappings < capacity) {
			return "", errors.New("invalid Redis saturation response")
		}
		return "", &ControlStreamSaturatedError{CurrentEntries: current, CurrentMappings: mappings, MaxEntries: capacity}
	case 1, 2:
		entryID, ok := values[1].(string)
		if !ok || entryID == "" {
			return "", errors.New("invalid Redis stream entry identity")
		}
		return entryID, nil
	default:
		return "", errors.New("invalid Redis capacity-append status")
	}
}

var ErrControlDeliveryConflict = errors.New("CONTROL_DELIVERY_CONFLICT")

var ErrControlDeliveryIndexInconsistent = errors.New("CONTROL_DELIVERY_INDEX_INCONSISTENT")

// ControlDeliveryIndexInconsistentError means one of the two atomically-owned
// Redis keys was partially lost or corrupted. Publication fails without
// mutation; an operator must restore both keys consistently or reset both so
// PostgreSQL visibility repair can rebuild the delivery.
type ControlDeliveryIndexInconsistentError struct {
	CurrentEntries  int64
	CurrentMappings int64
}

func (e *ControlDeliveryIndexInconsistentError) Error() string {
	return fmt.Sprintf("%s: stream entries %d delivery mappings %d", ErrControlDeliveryIndexInconsistent, e.CurrentEntries, e.CurrentMappings)
}

func (e *ControlDeliveryIndexInconsistentError) Is(target error) bool {
	return target == ErrControlDeliveryIndexInconsistent
}

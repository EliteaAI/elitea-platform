// Package authflow persists one-time browser authentication transactions.
package authflow

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/redis/go-redis/v9"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth/browserflow"
)

const (
	MaxRecordBytes    = 64 << 10
	maxKeyPrefixBytes = 256
	createAttempts    = 4
)

var (
	ErrInvalidConfiguration = errors.New("invalid browser authentication transaction store configuration")
	ErrInvalidID            = errors.New("invalid browser authentication transaction ID")
	ErrInvalidRecord        = errors.New("invalid browser authentication transaction record")
	ErrUnavailable          = errors.New("browser authentication transaction store unavailable")
	ErrIDCollision          = errors.New("browser authentication transaction ID collision limit reached")
)

type Config struct {
	KeyPrefix string
}

type idGenerator func() (string, error)
type clock func() time.Time

// RedisStore uses one logical Redis primary. It does not own or close the
// injected client and is safe for concurrent use when the client is safe.
type RedisStore struct {
	client    redis.UniversalClient
	keyPrefix string
	generate  idGenerator
	now       clock
}

func NewRedisStore(client redis.UniversalClient, config Config) (*RedisStore, error) {
	return newRedisStore(client, config, browserflow.NewTransactionID, time.Now)
}

func newRedisStore(
	client redis.UniversalClient,
	config Config,
	generate idGenerator,
	now clock,
) (*RedisStore, error) {
	if client == nil || generate == nil || now == nil {
		return nil, ErrInvalidConfiguration
	}
	switch client.(type) {
	case *redis.ClusterClient, *redis.Ring:
		return nil, fmt.Errorf("%w: transactions require one logical Redis primary", ErrInvalidConfiguration)
	}
	if err := validateKeyPrefix(config.KeyPrefix); err != nil {
		return nil, err
	}
	return &RedisStore{
		client:    client,
		keyPrefix: config.KeyPrefix,
		generate:  generate,
		now:       now,
	}, nil
}

// Create stores transaction and its binding atomically under a fresh canonical
// 256-bit ID. Redis TTL is derived from ExpiresAt on every collision attempt so
// retries never extend the transaction lifetime.
func (s *RedisStore) Create(
	ctx context.Context,
	transaction browserflow.Transaction,
) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	record, err := encodeTransaction(transaction)
	if err != nil {
		return "", err
	}

	for range createAttempts {
		now := s.now().UTC()
		if !transaction.ActiveAt(now) {
			return "", browserflow.ErrTransactionRejected
		}
		ttlMilliseconds := transaction.ExpiresAt.Sub(now).Milliseconds()
		if ttlMilliseconds <= 0 {
			return "", browserflow.ErrTransactionRejected
		}

		id, err := s.generate()
		if err != nil {
			return "", fmt.Errorf("generate browser authentication transaction ID: %w", err)
		}
		if browserflow.ValidateTransactionID(id) != nil {
			return "", ErrInvalidID
		}
		created, err := createScript.Run(
			ctx,
			s.client,
			[]string{s.key(id)},
			transaction.Provider,
			transaction.OriginatingSessionID,
			record,
			ttlMilliseconds,
		).Int64()
		if err != nil {
			return "", storeError(ctx, "create", err)
		}
		switch created {
		case 1:
			return id, nil
		case 0:
			continue
		default:
			return "", fmt.Errorf("%w: invalid create response", ErrUnavailable)
		}
	}
	return "", ErrIDCollision
}

// Consume atomically verifies the provider and originating-session sidecar
// fields before deleting and returning the transaction. A binding mismatch is
// not consumed. Missing, Redis-expired, application-expired, and replayed IDs
// all return browserflow.ErrTransactionRejected.
func (s *RedisStore) Consume(
	ctx context.Context,
	id string,
	provider string,
	originatingSessionID string,
) (browserflow.Transaction, error) {
	if err := ctx.Err(); err != nil {
		return browserflow.Transaction{}, err
	}
	if browserflow.ValidateTransactionID(id) != nil {
		return browserflow.Transaction{}, ErrInvalidID
	}
	if browserflow.ValidateProvider(provider) != nil ||
		browserflow.ValidateOpaqueID(originatingSessionID) != nil {
		return browserflow.Transaction{}, browserflow.ErrTransactionRejected
	}

	result, err := consumeScript.Run(
		ctx,
		s.client,
		[]string{s.key(id)},
		provider,
		originatingSessionID,
		MaxRecordBytes,
	).Result()
	if err != nil {
		return browserflow.Transaction{}, storeError(ctx, "consume", err)
	}
	status, record, err := consumeResult(result)
	if err != nil {
		return browserflow.Transaction{}, err
	}
	switch status {
	case consumeMissing, consumeMismatch:
		return browserflow.Transaction{}, browserflow.ErrTransactionRejected
	case consumeMalformed:
		return browserflow.Transaction{}, ErrInvalidRecord
	case consumeSucceeded:
		transaction, err := decodeTransaction(record)
		if err != nil {
			return browserflow.Transaction{}, err
		}
		if transaction.Provider != provider || transaction.OriginatingSessionID != originatingSessionID {
			return browserflow.Transaction{}, ErrInvalidRecord
		}
		if !transaction.ActiveAt(s.now().UTC()) {
			return browserflow.Transaction{}, browserflow.ErrTransactionRejected
		}
		return transaction, nil
	default:
		return browserflow.Transaction{}, fmt.Errorf("%w: invalid consume status", ErrUnavailable)
	}
}

func encodeTransaction(transaction browserflow.Transaction) ([]byte, error) {
	if err := transaction.Validate(); err != nil {
		return nil, err
	}
	record, err := json.Marshal(transaction)
	if err != nil {
		return nil, fmt.Errorf("%w: encode", ErrInvalidRecord)
	}
	if len(record) == 0 || len(record) > MaxRecordBytes {
		return nil, fmt.Errorf("%w: encoded size", ErrInvalidRecord)
	}
	return record, nil
}

func decodeTransaction(record []byte) (browserflow.Transaction, error) {
	if len(record) == 0 || len(record) > MaxRecordBytes {
		return browserflow.Transaction{}, fmt.Errorf("%w: encoded size", ErrInvalidRecord)
	}
	decoder := json.NewDecoder(bytes.NewReader(record))
	decoder.DisallowUnknownFields()
	var transaction browserflow.Transaction
	if err := decoder.Decode(&transaction); err != nil {
		return browserflow.Transaction{}, fmt.Errorf("%w: decode", ErrInvalidRecord)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return browserflow.Transaction{}, fmt.Errorf("%w: trailing data", ErrInvalidRecord)
	}
	if err := transaction.Validate(); err != nil {
		return browserflow.Transaction{}, fmt.Errorf("%w: value", ErrInvalidRecord)
	}
	canonical, err := json.Marshal(transaction)
	if err != nil || !bytes.Equal(canonical, record) {
		return browserflow.Transaction{}, fmt.Errorf("%w: non-canonical JSON", ErrInvalidRecord)
	}
	return transaction, nil
}

func consumeResult(result any) (int64, []byte, error) {
	values, ok := result.([]interface{})
	if !ok || len(values) == 0 {
		return 0, nil, fmt.Errorf("%w: invalid consume response", ErrUnavailable)
	}
	status, ok := values[0].(int64)
	if !ok {
		return 0, nil, fmt.Errorf("%w: invalid consume response", ErrUnavailable)
	}
	if status != consumeSucceeded {
		if len(values) != 1 {
			return 0, nil, fmt.Errorf("%w: invalid consume response", ErrUnavailable)
		}
		return status, nil, nil
	}
	if len(values) != 2 {
		return 0, nil, fmt.Errorf("%w: invalid consume response", ErrUnavailable)
	}
	switch record := values[1].(type) {
	case string:
		return status, []byte(record), nil
	case []byte:
		return status, record, nil
	default:
		return 0, nil, fmt.Errorf("%w: invalid consume response", ErrUnavailable)
	}
}

func (s *RedisStore) key(id string) string {
	return s.keyPrefix + id
}

func validateKeyPrefix(prefix string) error {
	if prefix == "" || len(prefix) > maxKeyPrefixBytes || !utf8.ValidString(prefix) {
		return fmt.Errorf("%w: key prefix is invalid", ErrInvalidConfiguration)
	}
	for _, character := range prefix {
		if unicode.IsControl(character) {
			return fmt.Errorf("%w: key prefix contains a control character", ErrInvalidConfiguration)
		}
	}
	return nil
}

func storeError(ctx context.Context, operation string, err error) error {
	if contextErr := ctx.Err(); contextErr != nil {
		return contextErr
	}
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return fmt.Errorf("%w during %s", ErrUnavailable, operation)
}

const (
	consumeMissing   int64 = -3
	consumeMalformed int64 = -2
	consumeMismatch  int64 = -1
	consumeSucceeded int64 = 1
)

var createScript = redis.NewScript(`
if redis.call('EXISTS', KEYS[1]) == 1 then
    return 0
end
redis.call('HSET', KEYS[1],
    'provider', ARGV[1],
    'originating_session_id', ARGV[2],
    'record', ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
return 1
`)

var consumeScript = redis.NewScript(`
local key_type = redis.call('TYPE', KEYS[1])
if type(key_type) == 'table' then
    key_type = key_type['ok']
end
if key_type == 'none' then
    return {-3}
end
if key_type ~= 'hash' then
    redis.call('DEL', KEYS[1])
    return {-2}
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then
    redis.call('DEL', KEYS[1])
    return {-2}
end
local provider = redis.call('HGET', KEYS[1], 'provider')
local session_id = redis.call('HGET', KEYS[1], 'originating_session_id')
local record_size = redis.call('HSTRLEN', KEYS[1], 'record')
local max_record_size = tonumber(ARGV[3])
if not provider or not session_id or record_size <= 0 or
        not max_record_size or record_size > max_record_size then
    redis.call('DEL', KEYS[1])
    return {-2}
end
if provider ~= ARGV[1] or session_id ~= ARGV[2] then
    return {-1}
end
local record = redis.call('HGET', KEYS[1], 'record')
redis.call('DEL', KEYS[1])
return {1, record}
`)

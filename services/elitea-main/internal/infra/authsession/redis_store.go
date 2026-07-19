// Package authsession persists browser authentication sessions in Redis.
package authsession

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/redis/go-redis/v9"

	sessionstate "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth/session"
)

const (
	MaxRecordBytes       = 64 << 10
	maxKeyPrefixBytes    = 256
	sessionIDRandomBytes = 32
	createAttempts       = 4
)

var (
	ErrInvalidConfiguration = errors.New("invalid browser session store configuration")
	ErrInvalidID            = errors.New("invalid browser session ID")
	ErrNotFound             = errors.New("browser session not found")
	ErrExpired              = errors.New("browser session expired")
	ErrUnavailable          = errors.New("browser session store unavailable")
	ErrIDCollision          = errors.New("browser session ID collision limit reached")
	ErrRotationConflict     = errors.New("browser session changed during rotation")
)

// Config contains the current-baseline Redis key prefix and the maximum
// server-side lifetime. KeyPrefix is used exactly as provided before the opaque
// session ID.
type Config struct {
	KeyPrefix string
	TTL       time.Duration
}

type idGenerator func() (string, error)
type clock func() time.Time

// RedisStore does not own or close the injected Redis client. Its methods are
// safe for concurrent use when the client is safe for concurrent use.
type RedisStore struct {
	client    redis.UniversalClient
	keyPrefix string
	ttl       time.Duration
	generate  idGenerator
	now       clock
}

// NewRedisStore creates an unmounted server-side session store.
func NewRedisStore(client redis.UniversalClient, config Config) (*RedisStore, error) {
	return newRedisStore(client, config, randomSessionID, time.Now)
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
	if err := validateKeyPrefix(config.KeyPrefix); err != nil {
		return nil, err
	}
	if config.TTL < time.Millisecond {
		return nil, fmt.Errorf("%w: TTL must be at least one millisecond", ErrInvalidConfiguration)
	}
	return &RedisStore{
		client:    client,
		keyPrefix: config.KeyPrefix,
		ttl:       config.TTL,
		generate:  generate,
		now:       now,
	}, nil
}

// Create stores state under a fresh opaque ID. Existing keys are never
// overwritten; a bounded number of random-ID collisions is retried.
func (s *RedisStore) Create(ctx context.Context, state sessionstate.State) (string, error) {
	record, ttl, err := s.encodeForCreate(state)
	if err != nil {
		return "", err
	}

	for range createAttempts {
		id, err := s.generate()
		if err != nil {
			return "", fmt.Errorf("generate browser session ID: %w", err)
		}
		if !validSessionID(id) {
			return "", ErrInvalidID
		}
		created, err := s.client.SetNX(ctx, s.key(id), record, ttl).Result()
		if err != nil {
			return "", storeError(ctx, "create", err)
		}
		if created {
			return id, nil
		}
	}
	return "", ErrIDCollision
}

// Read returns only a supported, bounded, unexpired state. Missing Redis TTLs,
// malformed records, unknown schema versions, and dependency failures fail
// closed.
func (s *RedisStore) Read(ctx context.Context, id string) (sessionstate.State, error) {
	state, _, err := s.readRecord(ctx, id)
	return state, err
}

// Delete invalidates id. It is idempotent so repeated logout requests succeed.
func (s *RedisStore) Delete(ctx context.Context, id string) error {
	if !validSessionID(id) {
		return ErrInvalidID
	}
	if err := s.client.Del(ctx, s.key(id)).Err(); err != nil {
		return storeError(ctx, "delete", err)
	}
	return nil
}

// Rotate atomically moves the existing record and its remaining Redis TTL to a
// fresh ID. The old ID is invalid after success. The two keys must map to the
// same Redis Cluster hash slot; deployments using Redis Cluster must include a
// fixed hash tag in KeyPrefix.
func (s *RedisStore) Rotate(ctx context.Context, id string) (string, error) {
	state, record, err := s.readRecord(ctx, id)
	if err != nil {
		return "", err
	}

	for range createAttempts {
		newID, err := s.generate()
		if err != nil {
			return "", fmt.Errorf("generate browser session ID: %w", err)
		}
		if !validSessionID(newID) {
			return "", ErrInvalidID
		}
		result, err := rotateScript.Run(
			ctx,
			s.client,
			[]string{s.key(id), s.key(newID)},
			record,
		).Result()
		if err != nil {
			return "", storeError(ctx, "rotate", err)
		}
		status, ok := result.(int64)
		if !ok {
			return "", fmt.Errorf("%w: invalid rotate response", ErrUnavailable)
		}
		switch status {
		case rotateSucceeded:
			if logicallyExpired(state, s.now()) {
				_ = s.Delete(ctx, newID)
				return "", ErrExpired
			}
			return newID, nil
		case rotateCollision:
			continue
		case rotateMissing:
			return "", ErrNotFound
		case rotateChanged:
			return "", ErrRotationConflict
		default:
			return "", fmt.Errorf("%w: invalid rotate status", ErrUnavailable)
		}
	}
	return "", ErrIDCollision
}

func (s *RedisStore) encodeForCreate(state sessionstate.State) ([]byte, time.Duration, error) {
	if state.SchemaVersion == 0 {
		state.SchemaVersion = sessionstate.CurrentSchemaVersion
	}
	if len(state.ProviderAttributes) == 0 {
		state.ProviderAttributes = json.RawMessage("{}")
	}
	if state.Expiration != nil {
		expiration := state.Expiration.UTC()
		state.Expiration = &expiration
	}
	if err := state.Validate(); err != nil {
		return nil, 0, err
	}

	now := s.now()
	ttl := s.ttl
	if state.Expiration != nil {
		remaining := state.Expiration.Sub(now)
		if remaining <= 0 {
			return nil, 0, ErrExpired
		}
		if remaining < ttl {
			ttl = remaining
		}
	}
	if ttl < time.Millisecond {
		ttl = time.Millisecond
	}

	record, err := json.Marshal(state)
	if err != nil {
		return nil, 0, fmt.Errorf("encode browser session: %w", err)
	}
	if len(record) > MaxRecordBytes {
		return nil, 0, fmt.Errorf("%w: encoded record is too large", sessionstate.ErrInvalidState)
	}
	return record, ttl, nil
}

func (s *RedisStore) readRecord(
	ctx context.Context,
	id string,
) (sessionstate.State, []byte, error) {
	if !validSessionID(id) {
		return sessionstate.State{}, nil, ErrInvalidID
	}
	record, err := s.client.Get(ctx, s.key(id)).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return sessionstate.State{}, nil, ErrNotFound
		}
		return sessionstate.State{}, nil, storeError(ctx, "read", err)
	}
	if len(record) == 0 || len(record) > MaxRecordBytes {
		return sessionstate.State{}, nil, fmt.Errorf("%w: encoded record size is invalid", sessionstate.ErrInvalidState)
	}
	ttl, err := s.client.PTTL(ctx, s.key(id)).Result()
	if err != nil {
		return sessionstate.State{}, nil, storeError(ctx, "read TTL", err)
	}
	if ttl == -2*time.Nanosecond {
		return sessionstate.State{}, nil, ErrNotFound
	}
	if ttl <= 0 {
		return sessionstate.State{}, nil, fmt.Errorf("%w: Redis TTL is missing", sessionstate.ErrInvalidState)
	}

	state, err := decodeRecord(record)
	if err != nil {
		return sessionstate.State{}, nil, err
	}
	if logicallyExpired(state, s.now()) {
		_ = s.client.Del(ctx, s.key(id)).Err()
		return sessionstate.State{}, nil, ErrExpired
	}
	return state, record, nil
}

func decodeRecord(record []byte) (sessionstate.State, error) {
	decoder := json.NewDecoder(bytes.NewReader(record))
	decoder.DisallowUnknownFields()
	var state sessionstate.State
	if err := decoder.Decode(&state); err != nil {
		return sessionstate.State{}, fmt.Errorf("%w: malformed encoded record", sessionstate.ErrInvalidState)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return sessionstate.State{}, fmt.Errorf("%w: trailing encoded data", sessionstate.ErrInvalidState)
	}
	if err := state.Validate(); err != nil {
		return sessionstate.State{}, err
	}
	return state, nil
}

func logicallyExpired(state sessionstate.State, now time.Time) bool {
	return state.Expiration != nil && !state.Expiration.After(now)
}

func (s *RedisStore) key(id string) string {
	return s.keyPrefix + id
}

func randomSessionID() (string, error) {
	random := make([]byte, sessionIDRandomBytes)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(random), nil
}

func validSessionID(id string) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(id)
	return err == nil && len(decoded) == sessionIDRandomBytes &&
		base64.RawURLEncoding.EncodeToString(decoded) == id
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
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	return fmt.Errorf("%w during %s: %v", ErrUnavailable, operation, err)
}

const (
	rotateMissing   int64 = -2
	rotateChanged   int64 = -1
	rotateCollision int64 = 0
	rotateSucceeded int64 = 1
)

var rotateScript = redis.NewScript(`
local current = redis.call('GET', KEYS[1])
if not current then
    return -2
end
if current ~= ARGV[1] then
    return -1
end
if redis.call('EXISTS', KEYS[2]) == 1 then
    return 0
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then
    return -2
end
redis.call('SET', KEYS[2], current, 'PX', ttl, 'NX')
redis.call('DEL', KEYS[1])
return 1
`)

// Package authattempt implements shared browser-authentication admission.
package authattempt

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"reflect"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/redis/go-redis/v9"

	browserapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/browserauth"
)

const (
	maxKeyPrefixBytes = 256
	maxAttempts       = int64(1_000_000)
	minWindow         = time.Second
	maxWindow         = browserapp.MaxBrowserAttemptRetryAfter
	minKeySecretBytes = 32
	maxKeySecretBytes = 64
	keyDomain         = "elitea-browser-attempt-v1\x00"
)

var (
	ErrInvalidConfiguration = errors.New("invalid browser attempt limiter configuration")
	ErrUnavailable          = errors.New("browser attempt limiter unavailable")
)

// Policy is one fixed-window limit. The limiter snapshots every policy at
// construction; later mutation of Config cannot change a running instance.
type Policy struct {
	MaxAttempts int64
	Window      time.Duration
}

// Config names all supported stages explicitly so a newly added stage cannot
// silently inherit a weaker limit.
type Config struct {
	KeyPrefix string
	// KeySecret is stable deployment-wide keying material supplied by a secret
	// resolver. It prevents low-entropy client addresses and logins from being
	// recovered by enumerating Redis keys offline. Live rotation is unsupported:
	// every replica must change it only in a coordinated cutover.
	KeySecret            []byte
	Global               Policy
	FormBegin            Policy
	FormCredentialClient Policy
	FormCredentialLogin  Policy
	OIDCBegin            Policy
	OIDCCallback         Policy
}

// RedisAdmitter uses one logical Redis primary (standalone or Sentinel) with a
// non-evicting memory policy. The global window bounds dimensional key growth;
// async Sentinel failover can conservatively lose recent counters and reopen
// part of a fixed window. RedisAdmitter does not own or close the client.
type RedisAdmitter struct {
	client       redis.Scripter
	keyPrefix    string
	keySecret    [sha256.Size]byte
	global       Policy
	formBegin    Policy
	formClient   Policy
	formLogin    Policy
	oidcBegin    Policy
	oidcCallback Policy
}

func NewRedisAdmitter(client redis.UniversalClient, config Config) (*RedisAdmitter, error) {
	if client == nil || isNilInterface(client) {
		return nil, ErrInvalidConfiguration
	}
	switch client.(type) {
	case *redis.ClusterClient, *redis.Ring:
		return nil, fmt.Errorf("%w: attempts require one logical Redis primary", ErrInvalidConfiguration)
	}
	return newRedisAdmitter(client, config)
}

func newRedisAdmitter(client redis.Scripter, config Config) (*RedisAdmitter, error) {
	if client == nil || isNilInterface(client) || !validKeyPrefix(config.KeyPrefix) || !validKeySecret(config.KeySecret) ||
		!validPolicy(config.Global) || !validPolicy(config.FormBegin) ||
		!validPolicy(config.FormCredentialClient) || !validPolicy(config.FormCredentialLogin) ||
		!validPolicy(config.OIDCBegin) || !validPolicy(config.OIDCCallback) ||
		config.Global.Window < config.FormBegin.Window ||
		config.Global.Window < config.FormCredentialClient.Window ||
		config.Global.Window < config.FormCredentialLogin.Window ||
		config.Global.Window < config.OIDCBegin.Window ||
		config.Global.Window < config.OIDCCallback.Window {
		return nil, ErrInvalidConfiguration
	}
	return &RedisAdmitter{
		client:       client,
		keyPrefix:    config.KeyPrefix,
		keySecret:    sha256.Sum256(config.KeySecret),
		global:       config.Global,
		formBegin:    config.FormBegin,
		formClient:   config.FormCredentialClient,
		formLogin:    config.FormCredentialLogin,
		oidcBegin:    config.OIDCBegin,
		oidcCallback: config.OIDCCallback,
	}, nil
}

// Admit atomically admits up to MaxAttempts within the stage's Redis-backed
// fixed window. A dependency or malformed Redis reply fails closed. Denied
// attempts do not extend the window or grow a queue/backlog.
func (a *RedisAdmitter) Admit(
	ctx context.Context,
	attempt browserapp.BrowserAttempt,
) (time.Duration, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	if a == nil || a.client == nil {
		return 0, ErrUnavailable
	}
	if err := attempt.Validate(); err != nil {
		return 0, err
	}
	policies, ok := a.policies(attempt.Stage)
	if !ok {
		return 0, browserapp.ErrInvalidBrowserAttempt
	}
	keys := a.keys(attempt)
	if len(keys) != len(policies) {
		return 0, ErrUnavailable
	}
	arguments := make([]interface{}, 0, len(policies)*2)
	var largestWindow time.Duration
	for _, policy := range policies {
		arguments = append(arguments, policy.MaxAttempts, policy.Window.Milliseconds())
		if policy.Window > largestWindow {
			largestWindow = policy.Window
		}
	}

	result, err := admitScript.Run(
		ctx,
		a.client,
		keys,
		arguments...,
	).Result()
	if err != nil {
		return 0, dependencyError(ctx, err)
	}
	status, remainingMilliseconds, ok := parseAdmitResult(result)
	if !ok || remainingMilliseconds <= 0 ||
		remainingMilliseconds > largestWindow.Milliseconds() {
		return 0, ErrUnavailable
	}
	switch status {
	case admitAllowed:
		return 0, nil
	case admitLimited:
		return time.Duration(remainingMilliseconds) * time.Millisecond, browserapp.ErrAttemptLimited
	case admitCorrupt:
		return 0, ErrUnavailable
	default:
		return 0, ErrUnavailable
	}
}

func (a *RedisAdmitter) policies(stage browserapp.BrowserAttemptStage) ([]Policy, bool) {
	switch stage {
	case browserapp.BrowserAttemptFormBegin:
		return []Policy{a.global, a.formBegin}, true
	case browserapp.BrowserAttemptFormCredential:
		return []Policy{a.global, a.formClient, a.formLogin}, true
	case browserapp.BrowserAttemptOIDCBegin:
		return []Policy{a.global, a.oidcBegin}, true
	case browserapp.BrowserAttemptOIDCCallback:
		return []Policy{a.global, a.oidcCallback}, true
	default:
		return nil, false
	}
}

func (a *RedisAdmitter) keys(attempt browserapp.BrowserAttempt) []string {
	globalKey := a.key("", "global", nil)
	clientKey := a.key(attempt.Stage, "client", []byte(attempt.ClientKey))
	if attempt.Stage != browserapp.BrowserAttemptFormCredential {
		return []string{globalKey, clientKey}
	}
	// Enforce the credential policy independently per client and per login.
	// A combined client+login bucket can be bypassed by spraying many accounts
	// from one client or one account from many clients.
	return []string{
		globalKey,
		clientKey,
		a.key(attempt.Stage, "login", attempt.LoginDigest[:]),
	}
}

func (a *RedisAdmitter) key(stage browserapp.BrowserAttemptStage, dimension string, value []byte) string {
	digest := hmac.New(sha256.New, a.keySecret[:])
	_, _ = digest.Write([]byte(keyDomain))
	_, _ = digest.Write([]byte(stage))
	_, _ = digest.Write([]byte{0})
	_, _ = digest.Write([]byte(dimension))
	_, _ = digest.Write([]byte{0})
	_, _ = digest.Write(value)
	return a.keyPrefix + base64.RawURLEncoding.EncodeToString(digest.Sum(nil))
}

func validPolicy(policy Policy) bool {
	return policy.MaxAttempts > 0 && policy.MaxAttempts <= maxAttempts &&
		policy.Window >= minWindow && policy.Window <= maxWindow &&
		policy.Window%time.Millisecond == 0
}

func validKeyPrefix(prefix string) bool {
	if prefix == "" || len(prefix) > maxKeyPrefixBytes || !utf8.ValidString(prefix) {
		return false
	}
	for _, character := range prefix {
		if unicode.IsControl(character) || unicode.IsSpace(character) {
			return false
		}
	}
	return true
}

func validKeySecret(secret []byte) bool {
	return len(secret) >= minKeySecretBytes && len(secret) <= maxKeySecretBytes
}

func isNilInterface(value any) bool {
	reflected := reflect.ValueOf(value)
	return reflected.Kind() == reflect.Pointer && reflected.IsNil()
}

func dependencyError(ctx context.Context, err error) error {
	if contextErr := ctx.Err(); contextErr != nil {
		return contextErr
	}
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return ErrUnavailable
}

const (
	admitCorrupt int64 = -1
	admitLimited int64 = 0
	admitAllowed int64 = 1
)

func parseAdmitResult(result any) (status int64, remainingMilliseconds int64, ok bool) {
	values, ok := result.([]interface{})
	if !ok || len(values) != 2 {
		return 0, 0, false
	}
	status, statusOK := values[0].(int64)
	remaining, remainingOK := values[1].(int64)
	return status, remaining, statusOK && remainingOK
}

var admitScript = redis.NewScript(`
if #KEYS < 2 or #KEYS > 3 or #ARGV ~= #KEYS * 2 then
    return {-1, 0}
end

local states = {}
local retry_ttl = 0
local allowed_ttl = nil
for index, key in ipairs(KEYS) do
    local argument_index = (index - 1) * 2
    local attempt_limit = tonumber(ARGV[argument_index + 1])
    local window_ms = tonumber(ARGV[argument_index + 2])
    if not attempt_limit or attempt_limit < 1 or
            not window_ms or window_ms < 1 then
        return {-1, 0}
    end
    local key_type = redis.call('TYPE', key)
    if type(key_type) == 'table' then
        key_type = key_type['ok']
    end
    if key_type == 'none' then
        states[index] = {count = 0, attempt_limit = attempt_limit, window_ms = window_ms}
        if not allowed_ttl or window_ms < allowed_ttl then
            allowed_ttl = window_ms
        end
    elseif key_type ~= 'string' then
        return {-1, 0}
    else
        local ttl = redis.call('PTTL', key)
        local current = redis.call('GET', key)
        if ttl <= 0 or not current or string.len(current) > 20 or
                not string.match(current, '^[1-9][0-9]*$') then
            return {-1, 0}
        end
        local count = tonumber(current)
        if not count or count < 1 then
            return {-1, 0}
        end
        states[index] = {count = count, attempt_limit = attempt_limit, window_ms = window_ms}
        if not allowed_ttl or ttl < allowed_ttl then
            allowed_ttl = ttl
        end
        if count >= attempt_limit and ttl > retry_ttl then
            retry_ttl = ttl
        end
    end
end
if retry_ttl > 0 then
    return {0, retry_ttl}
end

for index, key in ipairs(KEYS) do
    local state = states[index]
    if state['count'] == 0 then
        redis.call('SET', key, '1', 'PX', state['window_ms'])
    else
        local incremented = redis.call('INCR', key)
        if incremented < 1 or incremented > state['attempt_limit'] then
            return {-1, 0}
        end
    end
end
return {1, allowed_ttl}
`)

var _ browserapp.AttemptAdmitter = (*RedisAdmitter)(nil)

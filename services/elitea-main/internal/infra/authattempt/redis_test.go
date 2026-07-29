package authattempt

import (
	"context"
	"crypto/sha256"
	"errors"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	browserapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/browserauth"
)

func TestNewRedisAdmitterRejectsIncompleteAndDistributedConfiguration(t *testing.T) {
	valid := validConfig()
	if _, err := NewRedisAdmitter(nil, valid); !errors.Is(err, ErrInvalidConfiguration) {
		t.Fatalf("nil client error = %v", err)
	}
	var typedNil *redis.Client
	if _, err := NewRedisAdmitter(typedNil, valid); !errors.Is(err, ErrInvalidConfiguration) {
		t.Fatalf("typed nil client error = %v", err)
	}
	if _, err := NewRedisAdmitter(redis.NewClusterClient(&redis.ClusterOptions{
		Addrs: []string{"127.0.0.1:0"},
	}), valid); !errors.Is(err, ErrInvalidConfiguration) {
		t.Fatalf("cluster error = %v", err)
	}
	if _, err := NewRedisAdmitter(redis.NewRing(&redis.RingOptions{
		Addrs: map[string]string{"one": "127.0.0.1:0"},
	}), valid); !errors.Is(err, ErrInvalidConfiguration) {
		t.Fatalf("ring error = %v", err)
	}

	invalid := []Config{
		{},
		func() Config { config := valid; config.KeyPrefix = "bad prefix:"; return config }(),
		func() Config { config := valid; config.KeySecret = []byte("short"); return config }(),
		func() Config { config := valid; config.KeySecret = make([]byte, maxKeySecretBytes+1); return config }(),
		func() Config { config := valid; config.Global.MaxAttempts = 0; return config }(),
		func() Config { config := valid; config.Global.Window = 30 * time.Second; return config }(),
		func() Config { config := valid; config.FormBegin.MaxAttempts = 0; return config }(),
		func() Config {
			config := valid
			config.FormCredentialClient.MaxAttempts = maxAttempts + 1
			return config
		}(),
		func() Config { config := valid; config.FormCredentialLogin.Window = 0; return config }(),
		func() Config { config := valid; config.OIDCBegin.Window = time.Millisecond; return config }(),
		func() Config {
			config := valid
			config.OIDCCallback.Window = maxWindow + time.Millisecond
			return config
		}(),
	}
	stub := &scriptStub{result: []interface{}{int64(1), int64(1000)}}
	for index, config := range invalid {
		if _, err := newRedisAdmitter(stub, config); !errors.Is(err, ErrInvalidConfiguration) {
			t.Fatalf("invalid config %d error = %v", index, err)
		}
	}
}

func TestRedisAdmitterClassifiesResultsWithoutLeakingAttemptMaterial(t *testing.T) {
	tests := []struct {
		name      string
		result    any
		err       error
		wantError error
		wantRetry time.Duration
	}{
		{name: "allowed", result: []interface{}{int64(1), int64(1500)}},
		{name: "limited", result: []interface{}{int64(0), int64(1500)}, wantError: browserapp.ErrAttemptLimited, wantRetry: 1500 * time.Millisecond},
		{name: "corrupt", result: []interface{}{int64(-1), int64(1500)}, wantError: ErrUnavailable},
		{name: "malformed type", result: []interface{}{"1", int64(1500)}, wantError: ErrUnavailable},
		{name: "malformed ttl", result: []interface{}{int64(1), int64(0)}, wantError: ErrUnavailable},
		{name: "impossible ttl", result: []interface{}{int64(1), int64((time.Minute + time.Millisecond) / time.Millisecond)}, wantError: ErrUnavailable},
		{name: "outage", err: errors.New("dial secret.internal:6379"), wantError: ErrUnavailable},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			stub := &scriptStub{result: test.result, err: test.err}
			limiter, err := newRedisAdmitter(stub, validConfig())
			if err != nil {
				t.Fatal(err)
			}
			attempt := browserapp.BrowserAttempt{
				ClientKey: "192.0.2.7",
				Stage:     browserapp.BrowserAttemptFormBegin,
			}
			retry, err := limiter.Admit(context.Background(), attempt)
			if test.wantError == nil && err != nil || test.wantError != nil && !errors.Is(err, test.wantError) {
				t.Fatalf("error = %v, want %v", err, test.wantError)
			}
			if retry != test.wantRetry {
				t.Fatalf("retry = %s, want %s", retry, test.wantRetry)
			}
			if stub.calls != 1 || len(stub.keys) != 2 {
				t.Fatalf("calls=%d keys=%v", stub.calls, stub.keys)
			}
			for _, key := range stub.keys {
				if len(key) != len(validConfig().KeyPrefix)+43 || strings.Contains(key, attempt.ClientKey) {
					t.Fatalf("attempt material escaped into keys=%v", stub.keys)
				}
			}
			if err != nil && strings.Contains(err.Error(), "secret.internal") {
				t.Fatalf("dependency detail escaped: %v", err)
			}
		})
	}
}

func TestRedisAdmitterValidatesBeforeRedisAndPreservesCancellation(t *testing.T) {
	stub := &scriptStub{result: []interface{}{int64(1), int64(1000)}}
	limiter, err := newRedisAdmitter(stub, validConfig())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := limiter.Admit(context.Background(), browserapp.BrowserAttempt{
		ClientKey: "192.0.2.7", Stage: browserapp.BrowserAttemptFormCredential,
	}); !errors.Is(err, browserapp.ErrInvalidBrowserAttempt) || stub.calls != 0 {
		t.Fatalf("invalid attempt error=%v calls=%d", err, stub.calls)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := limiter.Admit(ctx, browserapp.BrowserAttempt{
		ClientKey: "192.0.2.7", Stage: browserapp.BrowserAttemptFormBegin,
	}); !errors.Is(err, context.Canceled) || stub.calls != 0 {
		t.Fatalf("canceled error=%v calls=%d", err, stub.calls)
	}
}

func TestRedisAdmitterHashesStageClientAndLoginIntoSeparateKeys(t *testing.T) {
	stub := &scriptStub{result: []interface{}{int64(1), int64(1000)}}
	limiter, err := newRedisAdmitter(stub, validConfig())
	if err != nil {
		t.Fatal(err)
	}
	digestA := sha256.Sum256([]byte("admin"))
	digestB := sha256.Sum256([]byte("viewer"))
	attempts := []browserapp.BrowserAttempt{
		{ClientKey: "192.0.2.7", Stage: browserapp.BrowserAttemptFormBegin},
		{ClientKey: "192.0.2.8", Stage: browserapp.BrowserAttemptFormBegin},
		{ClientKey: "192.0.2.7", Stage: browserapp.BrowserAttemptOIDCBegin},
		{ClientKey: "192.0.2.7", Stage: browserapp.BrowserAttemptFormCredential, LoginDigest: digestA},
		{ClientKey: "192.0.2.7", Stage: browserapp.BrowserAttemptFormCredential, LoginDigest: digestB},
	}
	keysByAttempt := make([][]string, 0, len(attempts))
	for _, attempt := range attempts {
		before := len(stub.keys)
		if _, err := limiter.Admit(context.Background(), attempt); err != nil {
			t.Fatal(err)
		}
		wantKeys := 2
		if attempt.Stage == browserapp.BrowserAttemptFormCredential {
			wantKeys = 3
		}
		if got := len(stub.keys) - before; got != wantKeys {
			t.Fatalf("keys for %+v = %d, want %d", attempt, got, wantKeys)
		}
		keys := append([]string(nil), stub.keys[before:]...)
		keysByAttempt = append(keysByAttempt, keys)
		for _, key := range keys {
			if strings.Contains(key, attempt.ClientKey) {
				t.Fatalf("client material escaped into key %q", key)
			}
		}
	}
	if keysByAttempt[0][0] != keysByAttempt[1][0] ||
		keysByAttempt[0][0] != keysByAttempt[2][0] ||
		keysByAttempt[0][1] == keysByAttempt[1][1] ||
		keysByAttempt[0][1] == keysByAttempt[2][1] ||
		keysByAttempt[3][1] != keysByAttempt[4][1] ||
		keysByAttempt[3][2] == keysByAttempt[4][2] ||
		keysByAttempt[3][1] == keysByAttempt[3][2] {
		t.Fatalf("unexpected key separation: %v", keysByAttempt)
	}
}

func TestRedisAdmitterSnapshotsKeySecret(t *testing.T) {
	stub := &scriptStub{result: []interface{}{int64(1), int64(1000)}}
	config := validConfig()
	limiter, err := newRedisAdmitter(stub, config)
	if err != nil {
		t.Fatal(err)
	}
	attempt := browserapp.BrowserAttempt{ClientKey: "192.0.2.7", Stage: browserapp.BrowserAttemptFormBegin}
	want := limiter.keys(attempt)[1]
	for index := range config.KeySecret {
		config.KeySecret[index] = 0
	}
	if got := limiter.keys(attempt)[1]; got != want {
		t.Fatalf("key changed after caller mutated config secret")
	}
}

func TestRedisAdmitterIsAtomicAcrossInstancesAndDoesNotGrowDeniedBacklog(t *testing.T) {
	server := miniredis.RunT(t)
	clientA := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	clientB := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	t.Cleanup(func() { _ = clientA.Close(); _ = clientB.Close() })
	config := validConfig()
	config.FormBegin = Policy{MaxAttempts: 7, Window: time.Minute}
	first, err := NewRedisAdmitter(clientA, config)
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewRedisAdmitter(clientB, config)
	if err != nil {
		t.Fatal(err)
	}
	attempt := browserapp.BrowserAttempt{ClientKey: "192.0.2.7", Stage: browserapp.BrowserAttemptFormBegin}

	var admitted atomic.Int64
	var limited atomic.Int64
	var unexpected atomic.Int64
	var wait sync.WaitGroup
	for index := 0; index < 64; index++ {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			limiter := first
			if index%2 == 1 {
				limiter = second
			}
			retry, err := limiter.Admit(context.Background(), attempt)
			switch {
			case err == nil && retry == 0:
				admitted.Add(1)
			case errors.Is(err, browserapp.ErrAttemptLimited) && retry > 0 && retry <= time.Minute:
				limited.Add(1)
			default:
				unexpected.Add(1)
			}
		}(index)
	}
	wait.Wait()
	if admitted.Load() != config.FormBegin.MaxAttempts || limited.Load() != 64-config.FormBegin.MaxAttempts || unexpected.Load() != 0 {
		t.Fatalf("admitted=%d limited=%d unexpected=%d", admitted.Load(), limited.Load(), unexpected.Load())
	}
	if keys := server.Keys(); len(keys) != 2 || strings.Contains(strings.Join(keys, ","), attempt.ClientKey) {
		t.Fatalf("Redis keys = %v", keys)
	}

	// A distinct stage has an independent window, and expiry admits again.
	if _, err := second.Admit(context.Background(), browserapp.BrowserAttempt{
		ClientKey: attempt.ClientKey, Stage: browserapp.BrowserAttemptOIDCBegin,
	}); err != nil {
		t.Fatal(err)
	}
	server.FastForward(time.Minute)
	if _, err := first.Admit(context.Background(), attempt); err != nil {
		t.Fatalf("post-expiry admit: %v", err)
	}
}

func TestRedisAdmitterLimitsFormCredentialsPerClientAndPerLogin(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	t.Cleanup(func() { _ = client.Close() })
	config := validConfig()
	config.FormCredentialClient = Policy{MaxAttempts: 2, Window: time.Minute}
	config.FormCredentialLogin = Policy{MaxAttempts: 2, Window: time.Minute}
	limiter, err := NewRedisAdmitter(client, config)
	if err != nil {
		t.Fatal(err)
	}
	loginA := sha256.Sum256([]byte("admin"))
	loginB := sha256.Sum256([]byte("viewer"))
	attempt := func(clientKey string, loginDigest [sha256.Size]byte) error {
		_, admitErr := limiter.Admit(context.Background(), browserapp.BrowserAttempt{
			ClientKey: clientKey, Stage: browserapp.BrowserAttemptFormCredential, LoginDigest: loginDigest,
		})
		return admitErr
	}
	if err := attempt("192.0.2.7", loginA); err != nil {
		t.Fatal(err)
	}
	if err := attempt("192.0.2.7", loginA); err != nil {
		t.Fatal(err)
	}
	if err := attempt("192.0.2.8", loginA); !errors.Is(err, browserapp.ErrAttemptLimited) {
		t.Fatalf("distributed login spray error = %v", err)
	}
	if err := attempt("192.0.2.7", loginB); !errors.Is(err, browserapp.ErrAttemptLimited) {
		t.Fatalf("single-client account spray error = %v", err)
	}
	if err := attempt("192.0.2.8", loginB); err != nil {
		t.Fatalf("denied attempt mutated an unrelated bucket: %v", err)
	}
	if keys := server.Keys(); len(keys) != 5 {
		t.Fatalf("Redis keys = %v, want one global and four dimensional counters", keys)
	}
}

func TestRedisAdmitterGlobalPolicyBoundsNovelKeyCardinality(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	t.Cleanup(func() { _ = client.Close() })
	config := validConfig()
	config.Global = Policy{MaxAttempts: 3, Window: time.Minute}
	limiter, err := NewRedisAdmitter(client, config)
	if err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 3; index++ {
		if _, err := limiter.Admit(context.Background(), browserapp.BrowserAttempt{
			ClientKey: string(rune('a' + index)), Stage: browserapp.BrowserAttemptFormBegin,
		}); err != nil {
			t.Fatalf("admit %d: %v", index, err)
		}
	}
	for index := 0; index < 50; index++ {
		retry, err := limiter.Admit(context.Background(), browserapp.BrowserAttempt{
			ClientKey: "novel-" + strconv.Itoa(index), Stage: browserapp.BrowserAttemptFormBegin,
		})
		if !errors.Is(err, browserapp.ErrAttemptLimited) || retry <= 0 {
			t.Fatalf("novel attempt %d retry=%s error=%v", index, retry, err)
		}
	}
	if keys := server.Keys(); len(keys) != 4 {
		t.Fatalf("Redis keys = %v, want one global and three admitted client counters", keys)
	}
}

func TestRedisAdmitterFailsClosedOnCorruptStateAndOutage(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	t.Cleanup(func() { _ = client.Close() })
	limiter, err := NewRedisAdmitter(client, validConfig())
	if err != nil {
		t.Fatal(err)
	}
	attempt := browserapp.BrowserAttempt{ClientKey: "192.0.2.7", Stage: browserapp.BrowserAttemptFormBegin}
	key := limiter.keys(attempt)[0]
	if err := server.Set(key, "not-an-integer"); err != nil {
		t.Fatal(err)
	}
	server.SetTTL(key, time.Minute)
	if _, err := limiter.Admit(context.Background(), attempt); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("corrupt state error = %v", err)
	}
	if err := server.Set(key, "1"); err != nil {
		t.Fatal(err)
	}
	if _, err := limiter.Admit(context.Background(), attempt); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("missing TTL error = %v", err)
	}
	server.Del(key)
	if err := client.RPush(context.Background(), key, "1").Err(); err != nil {
		t.Fatal(err)
	}
	if _, err := limiter.Admit(context.Background(), attempt); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("wrong type error = %v", err)
	}
	server.FlushAll()
	keys := limiter.keys(attempt)
	if err := server.Set(keys[0], "1"); err != nil {
		t.Fatal(err)
	}
	server.SetTTL(keys[0], time.Minute)
	if err := server.Set(keys[1], "invalid"); err != nil {
		t.Fatal(err)
	}
	server.SetTTL(keys[1], time.Minute)
	if _, err := limiter.Admit(context.Background(), attempt); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("one corrupt dimension error = %v", err)
	}
	server.Close()
	if _, err := limiter.Admit(context.Background(), attempt); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("outage error = %v", err)
	}
}

func validConfig() Config {
	return Config{
		KeyPrefix:            "elitea:auth:attempt:v1:",
		KeySecret:            []byte("0123456789abcdef0123456789abcdef"),
		Global:               Policy{MaxAttempts: 1000, Window: time.Minute},
		FormBegin:            Policy{MaxAttempts: 20, Window: time.Minute},
		FormCredentialClient: Policy{MaxAttempts: 5, Window: time.Minute},
		FormCredentialLogin:  Policy{MaxAttempts: 25, Window: time.Minute},
		OIDCBegin:            Policy{MaxAttempts: 20, Window: time.Minute},
		OIDCCallback:         Policy{MaxAttempts: 30, Window: time.Minute},
	}
}

type scriptStub struct {
	result any
	err    error
	calls  int
	keys   []string
}

func (s *scriptStub) command(keys []string) *redis.Cmd {
	s.calls++
	s.keys = append(s.keys, keys...)
	return redis.NewCmdResult(s.result, s.err)
}

func (s *scriptStub) Eval(_ context.Context, _ string, keys []string, _ ...interface{}) *redis.Cmd {
	return s.command(keys)
}
func (s *scriptStub) EvalSha(_ context.Context, _ string, keys []string, _ ...interface{}) *redis.Cmd {
	return s.command(keys)
}
func (s *scriptStub) EvalRO(_ context.Context, _ string, _ []string, _ ...interface{}) *redis.Cmd {
	panic("unexpected EvalRO")
}
func (s *scriptStub) EvalShaRO(_ context.Context, _ string, _ []string, _ ...interface{}) *redis.Cmd {
	panic("unexpected EvalShaRO")
}
func (s *scriptStub) ScriptExists(context.Context, ...string) *redis.BoolSliceCmd {
	return redis.NewBoolSliceResult(nil, errors.New("unexpected ScriptExists"))
}
func (s *scriptStub) ScriptLoad(context.Context, string) *redis.StringCmd {
	return redis.NewStringResult("", errors.New("unexpected ScriptLoad"))
}

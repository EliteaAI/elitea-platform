package main

// The start-up gate for SECRETS_MASTER_KEY (#412).
//
// run() must refuse to start on a malformed key, and it must refuse BEFORE it
// opens the database pool — so this case needs no PostgreSQL. That ordering is
// the point of the gate, not an accident of the test: the fault has to be
// caught before anything composes a handler, because two of the four
// NewHandler callers build one per request and would only fail long after
// provisioning had written vaults.

import (
	"context"
	"encoding/base64"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	v2secrets "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/secrets"
)

func TestRunRefusesToStartOnAMalformedMasterKey(t *testing.T) {
	// A valid key with a trailing SPACE. A trailing newline would not work:
	// Go's base64 decoder ignores "\r" and "\n", so such a key is still valid
	// and must keep working — see the secrets package's unit cases.
	valid := base64.URLEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	t.Setenv(v2secrets.MasterKeyEnvVar, valid+" ")
	// The two variables run() reads before the gate. Cleared so a value in the
	// developer's own shell cannot stop run() earlier and fake a pass.
	t.Setenv("AUTH_DEV_MODE", "")
	t.Setenv("ELITEA_DEV_BOOTSTRAP_LEGACY_SCHEMA", "")
	t.Setenv("ELITEA_HTTP_ADDRESS", "")
	// Unreachable on purpose. If the gate ever stops firing, run() reaches the
	// pool and this case fails on a DIFFERENT error rather than passing.
	t.Setenv("DATABASE_URL", "postgres://127.0.0.1:1/elitea?sslmode=disable&connect_timeout=1")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	err := run(ctx, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err == nil {
		t.Fatalf("run() started with a malformed %s; it must refuse, because the "+
			"secrets handler would otherwise store every project vault key unwrapped",
			v2secrets.MasterKeyEnvVar)
	}
	// Naming the variable is an acceptance criterion: the message is the only
	// thing the operator gets.
	if !strings.Contains(err.Error(), v2secrets.MasterKeyEnvVar) {
		t.Fatalf("run() failed with %q, which does not name %s", err, v2secrets.MasterKeyEnvVar)
	}
}

// The companion half. An absent key must NOT stop the service, or every
// deployment that supplies no key — the E2E stack, the local compose stack,
// every chart except the staging one — would stop booting.
func TestAnAbsentMasterKeyDoesNotStopStartup(t *testing.T) {
	key, err := v2secrets.MasterKeyFromEnv(func(string) string { return "" })
	if err != nil {
		t.Fatalf("an absent %s must not stop start-up, got %v", v2secrets.MasterKeyEnvVar, err)
	}
	if key != nil {
		t.Fatalf("an absent %s must yield no key, got %x", v2secrets.MasterKeyEnvVar, key)
	}
}

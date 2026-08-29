// The centry vault round trip between elitea-main and pylon-indexer. Issue #418.
//
// WHAT THE DEFECT IS. Both services store project keys in centry.secrets_key.
// Each one wraps the key with SECRETS_MASTER_KEY when it holds that key, and
// stores the key verbatim when it does not. pylon-indexer used to carry a
// committed Fernet key as the default for that setting, and no deployment gave
// it the variable, so the two services answered "is this row wrapped?"
// differently in the same stack. Neither could read what the other wrote.
//
// WHY AN EXISTENCE ASSERTION CANNOT FIND IT. "The row is there" is true in both
// forms. "The key decodes" is true for any 32 bytes. Issue #399 stayed invisible
// for exactly that reason. The only assertion that separates a matching key from
// a mismatched one is a ROUND TRIP: one service writes, the OTHER reads, and the
// value comes back.
//
// WHY THE OTHER HALF RUNS IN A CONTAINER. pylon-indexer's key is not a constant
// this test could hold. It is whatever pylon's expander makes of
// services/pylon-indexer/configs/shared.yml. Modelling that expander in Go would
// test the model, not the service, so the Python half runs the real expander on
// the real file, inside the real base image. See testdata/pylon_vault_io.py.
//
// WHAT EACH CASE CHECKS BEFORE IT CHECKS ITS RESULT:
//   - the Python half opens testdata/centry/vault-key-format.json, so it is
//     known to implement centry's row format before it writes a row;
//   - the key the config yields is compared with the key the environment gave,
//     so a second key source fails here rather than later;
//   - the stored key row is confirmed WRAPPED, so a pass cannot come from two
//     services that both skipped wrapping.
//
// The negative control is the discriminator. It gives the two halves different
// keys and requires BOTH directions to fail. Without it, a green round trip
// could mean "the two agree" or "neither wraps".
//
// Needs a PostgreSQL (ELITEA_TEST_DATABASE_URL) and a container runtime that can
// run the pylon base image. Skipped, with the reason, when either is absent.
package vaultparity_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/secrets"
)

// pylonImage is the image services/pylon-indexer/Containerfile builds on. The
// PYLON_VERSION arg there is the single source of the tag; keep them equal.
const pylonImage = "ghcr.io/eliteaai/pylon:1.2.25"

const (
	roundTripProjectID = "4118"
	roundTripName      = "OPENAI_API_KEY"
	roundTripValue     = "round-trip-not-a-real-credential"
)

// vault is centry's stored JSON shape.
type vault struct {
	Secrets       map[string]string `json:"secrets"`
	HiddenSecrets map[string]string `json:"hidden_secrets"`
}

// --- the pylon-indexer half ------------------------------------------------

// pylonRunner runs testdata/pylon_vault_io.py inside the pylon base image with
// the repository mounted read-only, so the script reads the SAME config file
// the service ships.
type pylonRunner struct {
	engine string // podman or docker
	repo   string
}

func newPylonRunner(t *testing.T) pylonRunner {
	t.Helper()

	engine := os.Getenv("ELITEA_TEST_CONTAINER_ENGINE")
	if engine == "" {
		for _, candidate := range []string{"podman", "docker"} {
			if _, err := exec.LookPath(candidate); err == nil {
				engine = candidate
				break
			}
		}
	}
	if engine == "" {
		t.Skip("no podman or docker on PATH; the pylon-indexer half of the round trip cannot run")
	}

	// A missing image must skip, not fail: this test is about wrapping, and a
	// registry that is unreachable says nothing about wrapping.
	//
	// `image inspect` rather than podman's `image exists`, because the engine
	// here can also be docker, and docker has no `exists` subcommand.
	check := exec.Command(engine, "image", "inspect", pylonImage) //nolint:gosec // fixed arguments
	if err := check.Run(); err != nil {
		pull := exec.Command(engine, "pull", pylonImage) //nolint:gosec // fixed arguments
		if out, pullErr := pull.CombinedOutput(); pullErr != nil {
			t.Skipf("cannot get %s (%v): %s", pylonImage, pullErr, out)
		}
	}

	return pylonRunner{engine: engine, repo: repoRoot(t)}
}

// run executes one step and decodes its JSON reply.
func (r pylonRunner) run(t *testing.T, step, masterKey string, in any, out any) error {
	t.Helper()

	args := []string{
		"run", "--rm", "--interactive", "--network=none",
		"--volume", r.repo + ":/repo:ro",
		"--workdir", "/repo",
	}
	if masterKey != "" {
		args = append(args, "--env", "SECRETS_MASTER_KEY="+masterKey)
	}
	args = append(args, pylonImage, "python",
		"/repo/services/elitea-main/tests/vaultparity/testdata/pylon_vault_io.py", step)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, r.engine, args...) //nolint:gosec // engine is podman or docker
	if in != nil {
		encoded, err := json.Marshal(in)
		if err != nil {
			t.Fatalf("encode %s input: %v", step, err)
		}
		cmd.Stdin = bytes.NewReader(encoded)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%s: %w: %s", step, err, strings.TrimSpace(stderr.String()))
	}
	if out == nil {
		return nil
	}
	// The engine writes progress lines to stderr, so stdout carries only the
	// script's own output. Take the last line regardless, so a stray warning
	// cannot break the decode.
	lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")
	if err := json.Unmarshal([]byte(lines[len(lines)-1]), out); err != nil {
		return fmt.Errorf("%s: decode %q: %w", step, stdout.String(), err)
	}
	return nil
}

// --- shared helpers --------------------------------------------------------

// repoRoot walks up to the directory holding testdata/centry, the fixture the
// Python half self-checks against. Walking beats a counted "../.." chain: a
// miscount would fail the same way a missing repository does.
func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "testdata", "centry", "vault-key-format.json")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("testdata/centry/vault-key-format.json not found in any parent directory")
		}
		dir = parent
	}
}

// newMasterKey mints a Fernet master key: URL-safe base64 of 32 bytes.
func newMasterKey(t *testing.T) string {
	t.Helper()
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		t.Fatalf("generate a master key: %v", err)
	}
	return base64.URLEncoding.EncodeToString(raw)
}

// fingerprint names a key without disclosing it. Same rule as the Python half.
func fingerprint(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])[:16]
}

func vaultID(projectID string) string { return "project-" + projectID }

// requireOneKeySource fails when the config does not yield exactly the key the
// environment gave. A committed default, a second source, or a config pylon
// dropped on a parse error all land here.
func requireOneKeySource(t *testing.T, runner pylonRunner, masterKey string) {
	t.Helper()

	var selfCheck struct {
		OK bool `json:"ok"`
	}
	if err := runner.run(t, "selfcheck", "", nil, &selfCheck); err != nil || !selfCheck.OK {
		t.Fatalf("the Python half does not implement centry's row format: %v", err)
	}

	var derived struct {
		Fingerprint    string `json:"fingerprint"`
		EnvFingerprint string `json:"env_fingerprint"`
	}
	if err := runner.run(t, "masterkey", masterKey, nil, &derived); err != nil {
		t.Fatalf("derive pylon-indexer's master key: %v", err)
	}
	if derived.Fingerprint != fingerprint(masterKey) {
		t.Fatalf("configs/shared.yml yields master key %s; the environment gave %s. "+
			"pylon-indexer has a key source of its own",
			derived.Fingerprint, fingerprint(masterKey))
	}
	if derived.EnvFingerprint != derived.Fingerprint {
		t.Fatalf("the derived key %s is not the environment's key %s",
			derived.Fingerprint, derived.EnvFingerprint)
	}
}

// requireWrappedKeyRow fails when the stored key row is a bare project key.
// Without it a green round trip could mean the two services agreed by both
// skipping the wrapping — which is the accident issue #399 ran on.
func requireWrappedKeyRow(t *testing.T, pool *pgxpool.Pool, projectID string) {
	t.Helper()
	var row []byte
	if err := pool.QueryRow(context.Background(),
		`SELECT data FROM centry.secrets_key WHERE id = $1`, vaultID(projectID)).Scan(&row); err != nil {
		t.Fatalf("read the stored key row: %v", err)
	}
	// An unwrapped row is Fernet.generate_key() output: 44 ASCII characters
	// that decode to 32 bytes. A wrapped row is a Fernet token over those 44
	// characters, and is far longer.
	if len(row) == 44 {
		if raw, err := base64.URLEncoding.DecodeString(string(row)); err == nil && len(raw) == 32 {
			t.Fatal("the stored key row is a bare project key: nothing wrapped it")
		}
	}
}

// --- direction one: pylon-indexer writes, elitea-main reads ----------------

func TestPylonIndexerWritesAVaultEliteaMainReads(t *testing.T) {
	pool := isolatedCentryPool(t)
	runner := newPylonRunner(t)
	masterKey := newMasterKey(t)

	requireOneKeySource(t, runner, masterKey)

	var written struct {
		KeyRow  string `json:"key_row"`
		DataRow string `json:"data_row"`
	}
	if err := runner.run(t, "write", masterKey, map[string]any{
		"vault": vault{
			Secrets:       map[string]string{roundTripName: roundTripValue},
			HiddenSecrets: map[string]string{},
		},
	}, &written); err != nil {
		t.Fatalf("pylon-indexer write: %v", err)
	}
	insertVaultRows(t, pool, roundTripProjectID, written.KeyRow, written.DataRow)
	requireWrappedKeyRow(t, pool, roundTripProjectID)

	t.Setenv("SECRETS_MASTER_KEY", masterKey)
	value, err := secrets.NewHandler(pool).
		LookupProjectSecret(context.Background(), roundTripProjectID, roundTripName)
	if err != nil {
		t.Fatalf("elitea-main could not read the vault pylon-indexer wrote: %v", err)
	}
	if value != roundTripValue {
		t.Fatalf("elitea-main read %q; want %q", value, roundTripValue)
	}
}

// --- direction two: elitea-main writes, pylon-indexer reads ----------------

func TestEliteaMainWritesAVaultPylonIndexerReads(t *testing.T) {
	pool := isolatedCentryPool(t)
	runner := newPylonRunner(t)
	masterKey := newMasterKey(t)

	requireOneKeySource(t, runner, masterKey)

	t.Setenv("SECRETS_MASTER_KEY", masterKey)
	handler := secrets.NewHandler(pool)
	ctx := context.Background()
	if err := handler.EnsureProjectVault(ctx, roundTripProjectID); err != nil {
		t.Fatalf("create the project vault: %v", err)
	}
	if err := handler.StoreProjectSecrets(ctx, roundTripProjectID,
		map[string]string{roundTripName: roundTripValue}); err != nil {
		t.Fatalf("store the secret: %v", err)
	}
	requireWrappedKeyRow(t, pool, roundTripProjectID)

	keyRow, dataRow := selectVaultRows(t, pool, roundTripProjectID)

	var read struct {
		Vault vault `json:"vault"`
	}
	if err := runner.run(t, "read", masterKey,
		map[string]string{"key_row": keyRow, "data_row": dataRow}, &read); err != nil {
		t.Fatalf("pylon-indexer could not read the vault elitea-main wrote: %v", err)
	}
	if read.Vault.Secrets[roundTripName] != roundTripValue {
		t.Fatalf("pylon-indexer read %q; want %q",
			read.Vault.Secrets[roundTripName], roundTripValue)
	}
}

// --- the discriminator -----------------------------------------------------

func TestASecondMasterKeyBreaksBothDirections(t *testing.T) {
	pool := isolatedCentryPool(t)
	runner := newPylonRunner(t)
	deploymentKey := newMasterKey(t)
	otherKey := newMasterKey(t)

	requireOneKeySource(t, runner, deploymentKey)

	t.Run("elitea-main writes, pylon-indexer holds the other key", func(t *testing.T) {
		t.Setenv("SECRETS_MASTER_KEY", deploymentKey)
		handler := secrets.NewHandler(pool)
		ctx := context.Background()
		if err := handler.EnsureProjectVault(ctx, roundTripProjectID); err != nil {
			t.Fatalf("create the project vault: %v", err)
		}
		if err := handler.StoreProjectSecrets(ctx, roundTripProjectID,
			map[string]string{roundTripName: roundTripValue}); err != nil {
			t.Fatalf("store the secret: %v", err)
		}
		keyRow, dataRow := selectVaultRows(t, pool, roundTripProjectID)

		var read struct {
			Vault vault `json:"vault"`
		}
		err := runner.run(t, "read", otherKey,
			map[string]string{"key_row": keyRow, "data_row": dataRow}, &read)
		if err == nil {
			t.Fatal("pylon-indexer opened a vault written under a different master key; " +
				"the round trip above proves nothing")
		}
	})

	t.Run("pylon-indexer writes, elitea-main holds the other key", func(t *testing.T) {
		var written struct {
			KeyRow  string `json:"key_row"`
			DataRow string `json:"data_row"`
		}
		if err := runner.run(t, "write", otherKey, map[string]any{
			"vault": vault{
				Secrets:       map[string]string{roundTripName: roundTripValue},
				HiddenSecrets: map[string]string{},
			},
		}, &written); err != nil {
			t.Fatalf("pylon-indexer write: %v", err)
		}
		const otherProjectID = "4119"
		insertVaultRows(t, pool, otherProjectID, written.KeyRow, written.DataRow)

		t.Setenv("SECRETS_MASTER_KEY", deploymentKey)
		_, err := secrets.NewHandler(pool).
			LookupProjectSecret(context.Background(), otherProjectID, roundTripName)
		if err == nil {
			t.Fatal("elitea-main opened a vault written under a different master key; " +
				"the round trip above proves nothing")
		}
		// And it failed for the right reason. ErrSecretNotFound here would mean
		// the wrong key opened the vault and merely found no such name, which
		// is the conflation the one idiom exists to prevent (#416).
		if errors.Is(err, secrets.ErrSecretNotFound) {
			t.Fatalf("a vault written under a different master key reported an absent "+
				"secret rather than a read failure: %v", err)
		}
	})
}

// --- database ---------------------------------------------------------------

func insertVaultRows(t *testing.T, pool *pgxpool.Pool, projectID, keyRow, dataRow string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO centry.secrets_key (id, data) VALUES ($1, $2)
		 ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
		vaultID(projectID), []byte(keyRow)); err != nil {
		t.Fatalf("insert the key row: %v", err)
	}
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO centry.secrets_data (id, data) VALUES ($1, $2)
		 ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
		vaultID(projectID), []byte(dataRow)); err != nil {
		t.Fatalf("insert the data row: %v", err)
	}
}

func selectVaultRows(t *testing.T, pool *pgxpool.Pool, projectID string) (keyRow, dataRow string) {
	t.Helper()
	var key, data []byte
	if err := pool.QueryRow(context.Background(),
		`SELECT data FROM centry.secrets_key WHERE id = $1`, vaultID(projectID)).Scan(&key); err != nil {
		t.Fatalf("read the key row: %v", err)
	}
	if err := pool.QueryRow(context.Background(),
		`SELECT data FROM centry.secrets_data WHERE id = $1`, vaultID(projectID)).Scan(&data); err != nil {
		t.Fatalf("read the data row: %v", err)
	}
	return string(key), string(data)
}

// isolatedCentryPool makes a throwaway database holding only the two centry
// vault tables, and drops it afterwards.
func isolatedCentryPool(t *testing.T) *pgxpool.Pool {
	t.Helper()

	databaseURL := os.Getenv("ELITEA_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set ELITEA_TEST_DATABASE_URL to run the centry vault round trip")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	adminConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatalf("parse ELITEA_TEST_DATABASE_URL: %v", err)
	}
	adminConfig.MaxConns = 2
	admin, err := pgxpool.NewWithConfig(ctx, adminConfig)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := admin.Ping(ctx); err != nil {
		admin.Close()
		t.Fatalf("ping: %v", err)
	}

	name := fmt.Sprintf("elitea_vaultparity_%d_%d", os.Getpid(), time.Now().UnixNano())
	quoted := pgx.Identifier{name}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+quoted); err != nil {
		admin.Close()
		t.Fatalf("create the isolated database: %v", err)
	}

	testConfig := adminConfig.Copy()
	testConfig.ConnConfig.Database = name
	testConfig.MaxConns = 4
	pool, err := pgxpool.NewWithConfig(ctx, testConfig)
	if err != nil {
		_, _ = admin.Exec(context.Background(), "DROP DATABASE "+quoted+" WITH (FORCE)")
		admin.Close()
		t.Fatalf("connect to the isolated database: %v", err)
	}

	t.Cleanup(func() {
		pool.Close()
		dropCtx, dropCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer dropCancel()
		if _, err := admin.Exec(dropCtx, "DROP DATABASE "+quoted+" WITH (FORCE)"); err != nil {
			t.Errorf("drop the isolated database: %v", err)
		}
		admin.Close()
	})

	if _, err := pool.Exec(ctx, `
CREATE SCHEMA centry;
CREATE TABLE centry.secrets_key (id TEXT PRIMARY KEY, data BYTEA);
CREATE TABLE centry.secrets_data (id TEXT PRIMARY KEY, data BYTEA)`); err != nil {
		t.Fatalf("create the centry vault tables: %v", err)
	}
	return pool
}

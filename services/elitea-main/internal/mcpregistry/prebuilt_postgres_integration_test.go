package mcpregistry_test

// Acceptance for the pre-built MCP catalogue store against a real PostgreSQL
// (shared migration 0094).
//
// The unit tests around this package assert the RESOLUTION rules on values that
// a test constructed. They cannot report that the table is wrong, that a
// constraint does not hold, or that a write and a read disagree about a column
// — and a catalogue that silently loses a URL or a client-secret reference
// fails at a remote server with a message naming none of this. So every case
// here changes rows and reads them back.

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/mcpregistry"
)

func TestPrebuiltStoreRoundTrip(t *testing.T) {
	pool := newCataloguePool(t)
	store := mcpregistry.NewPrebuiltStore(pool)
	ctx := context.Background()

	saved, err := store.Upsert(ctx, mcpregistry.PrebuiltServer{
		Key:             "GitHub Copilot",
		DisplayName:     "GitHub Copilot",
		ServerURL:       "https://api.githubcopilot.com/mcp/",
		BaseURL:         "https://api.githubcopilot.com",
		ClientID:        "catalogue-client",
		ClientSecretRef: "mcp_prebuilt__github_copilot_1a2b3c4d__client_secret",
		TimeoutSeconds:  30,
		Headers:         map[string]string{"X-Catalogue": "yes"},
		Enabled:         true,
	})
	require.NoError(t, err)

	// The key is NORMALISED on the way in, even though the caller passed a
	// display-cased name. If it were stored verbatim, a lookup by toolkit type
	// would never find it.
	require.Equal(t, "github_copilot", saved.Key)

	// Every field survives the round trip. A column that silently dropped its
	// value would leave the toolkit under-configured at use.
	found, err := store.Lookup(ctx, "mcp_github_copilot")
	require.NoError(t, err)
	require.Equal(t, saved, found)
	require.Equal(t, "https://api.githubcopilot.com/mcp/", found.ServerURL)
	require.Equal(t, "mcp_prebuilt__github_copilot_1a2b3c4d__client_secret", found.ClientSecretRef)
	require.Equal(t, map[string]string{"X-Catalogue": "yes"}, found.Headers)
	require.Equal(t, 30, found.TimeoutSeconds)
}

// The lookup normalises BOTH sides, which is the whole point of the key: an
// operator's display name and a toolkit's `type` are written independently and
// must still meet.
func TestPrebuiltStoreLookupAcceptsEveryFormOfTheName(t *testing.T) {
	pool := newCataloguePool(t)
	store := mcpregistry.NewPrebuiltStore(pool)
	ctx := context.Background()

	_, err := store.Upsert(ctx, mcpregistry.PrebuiltServer{
		Key: "epam_presales", DisplayName: "Epam Presales", Enabled: true,
		ServerURL: "https://presales.example.com/mcp",
	})
	require.NoError(t, err)

	for _, form := range []string{"epam_presales", "mcp_epam_presales", "Epam Presales", "EPAM PRESALES"} {
		found, err := store.Lookup(ctx, form)
		require.NoError(t, err, "form %q", form)
		require.Equal(t, "epam_presales", found.Key, "form %q", form)
	}
}

// An upsert REPLACES the definition. pylon rebuilds its catalogue from the
// descriptor on every reload, so a save means "this is the definition now" and
// not "merge this into whatever was there".
func TestPrebuiltStoreUpsertReplacesRatherThanMerges(t *testing.T) {
	pool := newCataloguePool(t)
	store := mcpregistry.NewPrebuiltStore(pool)
	ctx := context.Background()

	_, err := store.Upsert(ctx, mcpregistry.PrebuiltServer{
		Key: "thing", DisplayName: "Thing", Enabled: true,
		ServerURL: "https://first.example.com/mcp",
		ClientID:  "first-client", TimeoutSeconds: 30,
		Headers: map[string]string{"X-First": "yes"},
	})
	require.NoError(t, err)

	_, err = store.Upsert(ctx, mcpregistry.PrebuiltServer{
		Key: "thing", DisplayName: "Thing", Enabled: true,
		ServerURL: "https://second.example.com/mcp",
	})
	require.NoError(t, err)

	found, err := store.Lookup(ctx, "thing")
	require.NoError(t, err)
	require.Equal(t, "https://second.example.com/mcp", found.ServerURL)
	require.Empty(t, found.ClientID, "a replaced definition must not keep the old client id")
	require.Zero(t, found.TimeoutSeconds)
	require.Empty(t, found.Headers, "a replaced definition must not keep the old headers")

	// And it replaced rather than duplicated: the unique index holds.
	all, err := store.List(ctx)
	require.NoError(t, err)
	require.Len(t, all, 1)
}

// A disabled entry is STORED, not hidden, so an operator can withdraw a server
// without losing its sealed secret reference. Resolve is what declines it.
func TestPrebuiltStoreKeepsDisabledEntriesVisible(t *testing.T) {
	pool := newCataloguePool(t)
	store := mcpregistry.NewPrebuiltStore(pool)
	ctx := context.Background()

	_, err := store.Upsert(ctx, mcpregistry.PrebuiltServer{
		Key: "withdrawn", DisplayName: "Withdrawn", Enabled: false,
		ClientSecretRef: "mcp_prebuilt__withdrawn_deadbeef__client_secret",
	})
	require.NoError(t, err)

	found, err := store.Lookup(ctx, "withdrawn")
	require.NoError(t, err)
	require.False(t, found.Enabled)
	require.NotEmpty(t, found.ClientSecretRef, "withdrawing must not drop the secret reference")

	resolved := mcpregistry.Resolve(map[string]any{"url": ""}, "mcp_withdrawn", &found, nil)
	require.Equal(t, "", resolved["url"], "a withdrawn entry must not resolve")
}

// Delete reports the secret reference the row held, so the caller can clean the
// vault. An orphaned vault entry is inert but invisible, which is why the
// reference is returned rather than dropped.
func TestPrebuiltStoreDeleteReportsTheSecretReference(t *testing.T) {
	pool := newCataloguePool(t)
	store := mcpregistry.NewPrebuiltStore(pool)
	ctx := context.Background()

	const reference = "mcp_prebuilt__gone_0f0f0f0f__client_secret"
	_, err := store.Upsert(ctx, mcpregistry.PrebuiltServer{
		Key: "gone", DisplayName: "Gone", Enabled: true, ClientSecretRef: reference,
	})
	require.NoError(t, err)

	got, err := store.Delete(ctx, "mcp_gone")
	require.NoError(t, err)
	require.Equal(t, reference, got)

	_, err = store.Lookup(ctx, "gone")
	require.ErrorIs(t, err, mcpregistry.ErrPrebuiltNotFound)

	_, err = store.Delete(ctx, "gone")
	require.ErrorIs(t, err, mcpregistry.ErrPrebuiltNotFound,
		"a second delete must report absence, not succeed silently")
}

func TestPrebuiltStoreLookupReportsAbsenceDistinctly(t *testing.T) {
	store := mcpregistry.NewPrebuiltStore(newCataloguePool(t))
	_, err := store.Lookup(context.Background(), "never_defined")
	require.ErrorIs(t, err, mcpregistry.ErrPrebuiltNotFound)
}

// An empty catalogue lists as an empty slice, never nil, so the admin response
// encodes as `[]` rather than `null`.
func TestPrebuiltStoreListsAnEmptyCatalogueAsEmpty(t *testing.T) {
	entries, err := mcpregistry.NewPrebuiltStore(newCataloguePool(t)).List(context.Background())
	require.NoError(t, err)
	require.NotNil(t, entries)
	require.Empty(t, entries)
}

// The constraints in 0094 are load-bearing: they are what stops a row that no
// code path can honour from being stored by a future caller that forgets to
// check.
func TestPrebuiltStoreRejectsUnusableDefinitions(t *testing.T) {
	store := mcpregistry.NewPrebuiltStore(newCataloguePool(t))
	ctx := context.Background()

	_, err := store.Upsert(ctx, mcpregistry.PrebuiltServer{Key: "x", DisplayName: "  "})
	require.Error(t, err, "a blank display name must be refused")

	_, err = store.Upsert(ctx, mcpregistry.PrebuiltServer{
		Key: "x", DisplayName: "X", TimeoutSeconds: -1})
	require.Error(t, err, "a negative timeout must be refused")

	// A name that normalises to nothing has no key to be stored under.
	_, err = store.Upsert(ctx, mcpregistry.PrebuiltServer{Key: "", DisplayName: "mcp_"})
	require.Error(t, err)
}

// A store built without a pool is a composition fault. It must report that
// rather than dereferencing nil and taking the process down.
func TestPrebuiltStoreWithoutAPoolReportsIt(t *testing.T) {
	store := mcpregistry.NewPrebuiltStore(nil)
	ctx := context.Background()

	_, err := store.List(ctx)
	require.ErrorIs(t, err, mcpregistry.ErrNoPool)
	_, err = store.Lookup(ctx, "x")
	require.ErrorIs(t, err, mcpregistry.ErrNoPool)
	_, err = store.Upsert(ctx, mcpregistry.PrebuiltServer{Key: "x", DisplayName: "X"})
	require.ErrorIs(t, err, mcpregistry.ErrNoPool)
	_, err = store.Delete(ctx, "x")
	require.ErrorIs(t, err, mcpregistry.ErrNoPool)
}

/* ── database bootstrap ────────────────────────────────────────────────── */

// newCataloguePool builds an isolated database and applies migration 0094 to
// it. The DDL is executed from the migration FILE rather than restated here, so
// this test cannot pass against a schema the migration does not create.
func newCataloguePool(t *testing.T) *pgxpool.Pool {
	t.Helper()

	const environment = "ELITEA_TEST_DATABASE_URL"
	databaseURL := os.Getenv(environment)
	if databaseURL == "" {
		t.Skipf("set %s to run the PostgreSQL integration test", environment)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	adminConfig, err := pgxpool.ParseConfig(databaseURL)
	require.NoError(t, err)
	adminConfig.MaxConns = 2
	adminPool, err := pgxpool.NewWithConfig(ctx, adminConfig)
	require.NoError(t, err)
	require.NoError(t, adminPool.Ping(ctx))

	databaseName := fmt.Sprintf("elitea_mcp_cat_it_%d_%d", os.Getpid(), time.Now().UnixNano())
	quoted := pgx.Identifier{databaseName}.Sanitize()
	_, err = adminPool.Exec(ctx, "CREATE DATABASE "+quoted)
	require.NoError(t, err)

	testConfig := adminConfig.Copy()
	testConfig.ConnConfig.Database = databaseName
	testConfig.MaxConns = 4
	pool, err := pgxpool.NewWithConfig(ctx, testConfig)
	require.NoError(t, err)

	t.Cleanup(func() {
		pool.Close()
		dropCtx, dropCancel := context.WithTimeout(context.Background(), 120*time.Second)
		defer dropCancel()
		if _, err := adminPool.Exec(dropCtx, "DROP DATABASE "+quoted+" WITH (FORCE)"); err != nil {
			t.Errorf("drop isolated database: %v", err)
		}
		adminPool.Close()
	})

	migration, err := os.ReadFile("../../migrations/shared/0094_mcp_prebuilt_catalogue.sql")
	require.NoError(t, err, "the migration file must be readable: this test proves IT, not a copy of it")
	_, err = pool.Exec(ctx, string(migration))
	require.NoError(t, err)

	// Applying it twice must be a no-op. Every file in this corpus is expected
	// to be idempotent, and a re-run is what a partially-applied deployment
	// does.
	_, err = pool.Exec(ctx, string(migration))
	require.NoError(t, err, "migration 0094 must be idempotent")

	return pool
}

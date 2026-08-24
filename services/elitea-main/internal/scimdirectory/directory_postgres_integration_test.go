package scimdirectory

// The directory against a real PostgreSQL.
//
// The account table is created from the SAME statement the initial migration
// carries, and the SCIM side table from shared migration 0096's own file — so
// this test cannot pass against a schema the migrations do not create. That is
// the rule the pre-built MCP catalogue's integration test states, and it is what
// keeps a constraint from being asserted in a copy nobody deploys.

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// The person who signed in through single sign-on before the directory push
// reached them already has an account. Creating a second one would split their
// work across two identities that can never be merged.
func TestAPushAdoptsAnAccountCreatedByAFirstLogin(t *testing.T) {
	pool := newDirectoryPool(t)
	store := NewStore(pool)
	ctx := context.Background()

	var existing int
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO auth_core__user (email, name) VALUES ('alice@corp.com', 'Alice') RETURNING id`,
	).Scan(&existing))

	created, err := store.Create(ctx, User{
		UserName: "alice@corp.com", DisplayName: "Alice Smith", ExternalID: "00u1abc", Active: true,
	})
	require.NoError(t, err)
	require.Equal(t, existing, created.ID, "a push must adopt the account, not create a second one")
	require.Equal(t, "Alice Smith", created.DisplayName)
	require.Equal(t, "00u1abc", created.ExternalID)
}

// SCIM userName is case-insensitive. A provider that pushes `Alice@Corp.com`
// and later filters on `alice@corp.com` must find one account, not create two.
func TestTheAddressIsFoldedOnTheWayIn(t *testing.T) {
	pool := newDirectoryPool(t)
	store := NewStore(pool)
	ctx := context.Background()

	first, err := store.Create(ctx, User{UserName: "Alice@Corp.com", Active: true})
	require.NoError(t, err)
	second, err := store.Create(ctx, User{UserName: "alice@corp.com", Active: true})
	require.NoError(t, err)
	require.Equal(t, first.ID, second.ID)

	filter, err := ParseFilter(`userName eq "ALICE@CORP.COM"`)
	require.NoError(t, err)
	found, total, err := store.List(ctx, filter, 1, 10)
	require.NoError(t, err)
	require.Equal(t, 1, total)
	require.Equal(t, first.ID, found[0].ID)
}

// Two accounts claiming one external id would make a client's lookup ambiguous:
// it would update whichever the database returned first.
func TestTwoAccountsCannotShareAnExternalID(t *testing.T) {
	pool := newDirectoryPool(t)
	store := NewStore(pool)
	ctx := context.Background()

	_, err := store.Create(ctx, User{UserName: "alice@corp.com", ExternalID: "00u1abc", Active: true})
	require.NoError(t, err)

	_, err = store.Create(ctx, User{UserName: "bob@corp.com", ExternalID: "00u1abc", Active: true})
	require.ErrorIs(t, err, ErrConflict)
}

// An omitted external id is legitimate — RFC 7643 says a service provider must
// not require one — so the uniqueness index must not treat two absent ids as a
// collision.
func TestSeveralAccountsMayHaveNoExternalID(t *testing.T) {
	pool := newDirectoryPool(t)
	store := NewStore(pool)
	ctx := context.Background()

	_, err := store.Create(ctx, User{UserName: "alice@corp.com", Active: true})
	require.NoError(t, err)
	_, err = store.Create(ctx, User{UserName: "bob@corp.com", Active: true})
	require.NoError(t, err)
}

// A replace that would take an address another account already holds is
// REFUSED. Only an operator can decide which of the two survives.
func TestAReplaceOntoATakenAddressIsAConflict(t *testing.T) {
	pool := newDirectoryPool(t)
	store := NewStore(pool)
	ctx := context.Background()

	alice, err := store.Create(ctx, User{UserName: "alice@corp.com", Active: true})
	require.NoError(t, err)
	_, err = store.Create(ctx, User{UserName: "bob@corp.com", Active: true})
	require.NoError(t, err)

	_, err = store.Replace(ctx, alice.ID, User{UserName: "bob@corp.com", Active: true})
	require.ErrorIs(t, err, ErrConflict)
}

// Deactivation suspends and is reversible: a re-hired person's account comes
// back with their work attached.
func TestDeactivationSuspendsAndCanBeUndone(t *testing.T) {
	pool := newDirectoryPool(t)
	store := NewStore(pool)
	ctx := context.Background()

	alice, err := store.Create(ctx, User{UserName: "alice@corp.com", Active: true})
	require.NoError(t, err)

	require.NoError(t, store.Deactivate(ctx, alice.ID))
	after, err := store.Get(ctx, alice.ID)
	require.NoError(t, err)
	require.False(t, after.Active)

	// The row is still there. A DELETE that removed it would take the person's
	// authored work with it.
	var rows int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM auth_core__user WHERE id = $1`, alice.ID).Scan(&rows))
	require.Equal(t, 1, rows)

	restored, err := store.SetActive(ctx, alice.ID, true)
	require.NoError(t, err)
	require.True(t, restored.Active)
}

// An account created by a first login has no SCIM row at all. It must still be
// listable and patchable — a directory that only saw accounts it created would
// be unable to deactivate anybody who signed in before it was connected.
func TestAnAccountWithNoSCIMRowIsStillManageable(t *testing.T) {
	pool := newDirectoryPool(t)
	store := NewStore(pool)
	ctx := context.Background()

	var existing int
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO auth_core__user (email, name) VALUES ('carol@corp.com', 'Carol') RETURNING id`,
	).Scan(&existing))

	users, total, err := store.List(ctx, Filter{}, 1, 10)
	require.NoError(t, err)
	require.Equal(t, 1, total)
	require.Equal(t, existing, users[0].ID)
	require.Empty(t, users[0].ExternalID)

	_, err = store.SetActive(ctx, existing, false)
	require.NoError(t, err)
}

// The total is the count of the WHOLE result, not of the page. A client pages
// by startIndex until it has seen totalResults, and a total that counted only
// the page would stop it after the first request.
func TestTheTotalCountsTheWholeResultNotThePage(t *testing.T) {
	pool := newDirectoryPool(t)
	store := NewStore(pool)
	ctx := context.Background()

	for index := range 5 {
		_, err := store.Create(ctx, User{
			UserName: fmt.Sprintf("user%d@corp.com", index), Active: true,
		})
		require.NoError(t, err)
	}

	page, total, err := store.List(ctx, Filter{}, 1, 2)
	require.NoError(t, err)
	require.Equal(t, 5, total)
	require.Len(t, page, 2)

	second, _, err := store.List(ctx, Filter{}, 3, 2)
	require.NoError(t, err)
	require.Len(t, second, 2)
	require.NotEqual(t, page[0].ID, second[0].ID, "startIndex is one-based and must advance the page")
}

/* ── database bootstrap ────────────────────────────────────────────────── */

func newDirectoryPool(t *testing.T) *pgxpool.Pool {
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

	databaseName := fmt.Sprintf("elitea_scim_it_%d_%d", os.Getpid(), time.Now().UnixNano())
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

	// The account table, in the shape 001_initial.sql creates it. It is
	// restated here rather than read from that file because the file is a
	// thousand statements of unrelated schema; the columns below are the whole
	// of what this package touches, and a drift in them would fail every test
	// in this file rather than pass quietly.
	_, err = pool.Exec(ctx, `
		CREATE TABLE auth_core__user (
			id SERIAL PRIMARY KEY,
			email TEXT UNIQUE,
			name TEXT,
			last_login TIMESTAMP,
			suspended BOOLEAN NOT NULL DEFAULT false
		)`)
	require.NoError(t, err)

	migration, err := os.ReadFile("../../migrations/shared/0096_scim_provisioning.sql")
	require.NoError(t, err, "the migration file must be readable: this test proves IT, not a copy of it")
	_, err = pool.Exec(ctx, string(migration))
	require.NoError(t, err)

	// Applying it twice must be a no-op. Every file in this corpus is expected
	// to be idempotent, and a re-run is what a partially-applied deployment
	// does.
	_, err = pool.Exec(ctx, string(migration))
	require.NoError(t, err, "migration 0096 must be idempotent")

	return pool
}

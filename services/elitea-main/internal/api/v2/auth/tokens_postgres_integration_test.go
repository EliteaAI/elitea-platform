package auth

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresTokenRepositoryLifecycle(t *testing.T) {
	adminURL := os.Getenv("ELITEA_AUTH_TEST_DATABASE_URL")
	if adminURL == "" {
		t.Skip("set ELITEA_AUTH_TEST_DATABASE_URL to an isolated PostgreSQL admin database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	adminConfig, err := pgxpool.ParseConfig(adminURL)
	if err != nil {
		t.Fatal(err)
	}
	adminPool, err := pgxpool.NewWithConfig(ctx, adminConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer adminPool.Close()

	databaseName := fmt.Sprintf("elitea_auth_test_%d", time.Now().UnixNano())
	identifier := pgx.Identifier{databaseName}.Sanitize()
	if _, err := adminPool.Exec(ctx, "CREATE DATABASE "+identifier); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = adminPool.Exec(context.Background(),
			`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
			databaseName,
		)
		_, _ = adminPool.Exec(context.Background(), "DROP DATABASE IF EXISTS "+identifier)
	}()

	testConfig := adminConfig.Copy()
	testConfig.ConnConfig.Database = databaseName
	pool, err := pgxpool.NewWithConfig(ctx, testConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if _, err := pool.Exec(ctx, `
CREATE TABLE public.auth_core__user (
    id integer PRIMARY KEY,
    email text,
    suspended boolean NOT NULL DEFAULT false
);
CREATE TABLE public.auth_core__token (
    id serial PRIMARY KEY,
    uuid varchar(36) UNIQUE,
    expires timestamp without time zone,
    user_id integer REFERENCES public.auth_core__user(id) ON DELETE CASCADE,
    name text
);
INSERT INTO public.auth_core__user (id, email, suspended)
VALUES (7, 'owner@example.test', false), (42, 'collision@example.test', false);`); err != nil {
		t.Fatal(err)
	}

	repository := &postgresTokenRepository{pool: pool}
	expires := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Microsecond)
	created, err := repository.Create(ctx, 7, "ci-token", &expires)
	if err != nil {
		t.Fatal(err)
	}
	if created.UserID != 7 || created.ID <= 0 || !validTokenUUID(created.UUID) || created.Name != "ci-token" {
		t.Fatalf("created = %+v", created)
	}

	listed, err := repository.List(ctx, 7)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].ID != created.ID {
		t.Fatalf("listed = %+v", listed)
	}
	got, err := repository.GetOwned(ctx, 7, created.UUID)
	if err != nil || got.ID != created.ID {
		t.Fatalf("get = %+v, err=%v", got, err)
	}
	if _, err := repository.GetOwned(ctx, 42, created.UUID); !errors.Is(err, errTokenNotFound) {
		t.Fatalf("cross-owner get error = %v, want errTokenNotFound", err)
	}
	if err := repository.DeleteOwned(ctx, 42, created.UUID); !errors.Is(err, errTokenForbidden) {
		t.Fatalf("cross-owner delete error = %v, want errTokenForbidden", err)
	}
	if err := repository.DeleteOwned(ctx, 7, created.UUID); err != nil {
		t.Fatal(err)
	}
	if _, err := repository.GetOwned(ctx, 7, created.UUID); !errors.Is(err, errTokenNotFound) {
		t.Fatalf("deleted token get error = %v, want errTokenNotFound", err)
	}

	if _, err := pool.Exec(ctx, `UPDATE public.auth_core__user SET suspended = true WHERE id = 7`); err != nil {
		t.Fatal(err)
	}
	if _, err := repository.Create(ctx, 7, "blocked-token", nil); !errors.Is(err, errTokenForbidden) {
		t.Fatalf("suspended-owner create error = %v, want errTokenForbidden", err)
	}
}

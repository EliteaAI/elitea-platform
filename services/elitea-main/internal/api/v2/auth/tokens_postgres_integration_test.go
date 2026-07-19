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

	identity "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	dbschema "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/schema"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/authsvc"
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
	if _, err := pool.Exec(ctx, dbschema.AuthCoreBaselineSQLCProjection); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
INSERT INTO public.auth_core__user (id, email, suspended)
VALUES (7, 'owner@example.test', false), (42, 'collision@example.test', false);`); err != nil {
		t.Fatal(err)
	}

	repository := newPostgresTokenRepository(pool)
	expires := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Microsecond)
	created, err := repository.Create(ctx, 7, "ci-token", &expires)
	if err != nil {
		t.Fatal(err)
	}
	if created.UserID != 7 || created.ID <= 0 || !validTokenUUID(created.UUID) || created.Name != "ci-token" {
		t.Fatalf("created = %+v", created)
	}
	const signingKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	encoded, err := signBaselineToken([]byte(signingKey), created)
	if err != nil {
		t.Fatal(err)
	}
	principal, err := authsvc.NewLocalValidator(pool, signingKey).ValidateToken(ctx, encoded)
	if err != nil {
		t.Fatal(err)
	}
	if principal.TokenID != fmt.Sprintf("%d", created.ID) || principal.UserID != "7" || principal.ID != "7" {
		t.Fatalf("validated principal = %+v", principal)
	}
	currentUser, err := authsvc.NewCurrentUserResolver(pool).Resolve(ctx, principal)
	if err != nil {
		t.Fatal(err)
	}
	if currentUser.ID != 7 || currentUser.Email == nil || *currentUser.Email != "owner@example.test" {
		t.Fatalf("current user = %+v", currentUser)
	}
	if currentUser.Name != nil || currentUser.LastLogin != nil || currentUser.Suspended {
		t.Fatalf("current user nullable/state fields = %+v", currentUser)
	}
	principalValidator := authsvc.NewPrincipalValidator(pool)
	forwarded, err := principalValidator.ValidatePrincipal(ctx, identity.User{
		ID:       fmt.Sprintf("%d", created.ID),
		TokenID:  fmt.Sprintf("%d", created.ID),
		UserID:   "7",
		Email:    "-",
		AuthType: "token",
	})
	if err != nil {
		t.Fatal(err)
	}
	if forwarded.ID != "7" || forwarded.UserID != "7" || forwarded.TokenID != fmt.Sprintf("%d", created.ID) || forwarded.Email != "owner@example.test" {
		t.Fatalf("forwarded principal = %+v", forwarded)
	}
	session, err := principalValidator.ValidatePrincipal(ctx, identity.User{
		ID:       "42",
		UserID:   "7",
		Email:    "untrusted@example.test",
		AuthType: "session",
	})
	if err != nil {
		t.Fatal(err)
	}
	if session.ID != "7" || session.UserID != "7" || session.Email != "owner@example.test" {
		t.Fatalf("session principal = %+v", session)
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
	if _, err := authsvc.NewLocalValidator(pool, signingKey).ValidateToken(ctx, encoded); err == nil {
		t.Fatal("deleted PAT remained valid")
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

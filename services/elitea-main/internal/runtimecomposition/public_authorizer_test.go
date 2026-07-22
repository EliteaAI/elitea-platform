package runtimecomposition

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	configurationapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/configurations"
	executionapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/executions"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/jackc/pgx/v5"
)

type authorizationRow struct {
	active bool
	err    error
}

func (r authorizationRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) != 1 {
		return fmt.Errorf("scan destinations = %d", len(dest))
	}
	value, ok := dest[0].(*bool)
	if !ok {
		return errors.New("authorization destination is not boolean")
	}
	*value = r.active
	return nil
}

type authorizationStore struct {
	row   pgx.Row
	sql   string
	args  []any
	calls int
}

func (s *authorizationStore) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	s.calls++
	s.sql = sql
	s.args = append([]any(nil), args...)
	return s.row
}

func TestPublicAuthorizerDerivesPhaseOneIdentityFromVerifiedMembership(t *testing.T) {
	store := &authorizationStore{row: authorizationRow{active: true}}
	authorizer, err := newPostgresPublicAuthorizer(store, &authorizationStore{row: authorizationRow{active: true}})
	if err != nil {
		t.Fatal(err)
	}
	ctx := auth.ContextWithAuthenticatedUser(context.Background(), auth.User{ID: "17"}, auth.AuthenticationSourceToken)
	identity, err := authorizer.AuthorizeValidation(ctx, "42", "revision-1")
	if err != nil {
		t.Fatal(err)
	}
	if identity.TenantID != "42" || identity.ResourceProjectID != "42" || identity.ProjectionProjectID != "42" || identity.ActorID != "17" {
		t.Fatalf("unexpected admission identity: %+v", identity)
	}
	if store.calls != 1 || !strings.Contains(store.sql, "p.owner_id = $2") || !strings.Contains(store.sql, "auth_core__project_user_role") {
		t.Fatalf("authorization query is not strict membership SQL: %s", store.sql)
	}
}

func TestPublicAuthorizerAcceptsVerifiedForwardedMembership(t *testing.T) {
	store := &authorizationStore{row: authorizationRow{active: true}}
	authorizer, err := newPostgresPublicAuthorizer(store, &authorizationStore{row: authorizationRow{active: true}})
	if err != nil {
		t.Fatal(err)
	}
	ctx := auth.ContextWithAuthenticatedUser(context.Background(), auth.User{ID: "17"}, auth.AuthenticationSourceForwarded)
	identity, err := authorizer.AuthorizeValidation(ctx, "42", "revision-1")
	if err != nil {
		t.Fatal(err)
	}
	if identity.ActorID != "17" || identity.ResourceProjectID != "42" || store.calls != 1 {
		t.Fatalf("identity=%+v membership queries=%d", identity, store.calls)
	}
}

func TestPublicAuthorizerRejectsDevelopmentAndMissingMembership(t *testing.T) {
	developmentStore := &authorizationStore{row: authorizationRow{active: true}}
	authorizer, err := newPostgresPublicAuthorizer(developmentStore, &authorizationStore{row: authorizationRow{active: true}})
	if err != nil {
		t.Fatal(err)
	}
	development := auth.ContextWithAuthenticatedUser(context.Background(), auth.User{ID: "17"}, auth.AuthenticationSourceDevelopment)
	if _, err := authorizer.AuthorizeValidation(development, "42", "revision-1"); !errors.Is(err, configurationapi.ErrValidationForbidden) {
		t.Fatalf("development source error = %v", err)
	}
	if developmentStore.calls != 0 {
		t.Fatalf("development source reached database %d times", developmentStore.calls)
	}

	store := &authorizationStore{row: authorizationRow{active: false}}
	authorizer, err = newPostgresPublicAuthorizer(store, &authorizationStore{row: authorizationRow{active: true}})
	if err != nil {
		t.Fatal(err)
	}
	ctx := auth.ContextWithAuthenticatedUser(context.Background(), auth.User{ID: "17"}, auth.AuthenticationSourceSession)
	if _, err := authorizer.AuthorizeValidation(ctx, "42", "revision-1"); !errors.Is(err, configurationapi.ErrValidationForbidden) {
		t.Fatalf("missing membership error = %v", err)
	}
}

func TestPublicAuthorizerBindsExecutionEventsToProjectionProject(t *testing.T) {
	store := &authorizationStore{row: authorizationRow{active: true}}
	authorizer, err := newPostgresPublicAuthorizer(&authorizationStore{row: authorizationRow{active: true}}, store)
	if err != nil {
		t.Fatal(err)
	}
	ctx := auth.ContextWithAuthenticatedUser(context.Background(), auth.User{ID: "17"}, auth.AuthenticationSourceAPIKey)
	if err := authorizer.AuthorizeExecutionEvents(ctx, "42", "execution-1"); err != nil {
		t.Fatal(err)
	}
	if store.calls != 1 || !strings.Contains(store.sql, "j.projection_project_id = $2") || !strings.Contains(store.sql, "j.execution_id = $1") {
		t.Fatalf("execution authorization query is not projection-bound: %s", store.sql)
	}
	if len(store.args) != 3 || store.args[0] != "execution-1" || store.args[1] != int64(42) || store.args[2] != int64(17) {
		t.Fatalf("execution authorization args = %v", store.args)
	}

	store = &authorizationStore{row: authorizationRow{active: false}}
	authorizer, _ = newPostgresPublicAuthorizer(&authorizationStore{row: authorizationRow{active: true}}, store)
	if err := authorizer.AuthorizeExecutionEvents(ctx, "42", "execution-1"); !errors.Is(err, executionapi.ErrExecutionEventsForbidden) {
		t.Fatalf("unauthorized event error = %v", err)
	}
}

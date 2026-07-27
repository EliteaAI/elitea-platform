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
	active       bool
	capabilityID string
	err          error
}

func (r authorizationRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) != 1 {
		return fmt.Errorf("scan destinations = %d", len(dest))
	}
	switch value := dest[0].(type) {
	case *bool:
		*value = r.active
	case *string:
		*value = r.capabilityID
	default:
		return errors.New("unsupported authorization destination")
	}
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

type authorizationPermissionResolver struct {
	resolution auth.PermissionResolution
	err        error
	calls      int
	principal  auth.User
	mode       string
	projectID  string
}

func (r *authorizationPermissionResolver) ResolvePermissions(
	_ context.Context,
	principal auth.User,
	mode string,
	projectID string,
) (auth.PermissionResolution, error) {
	r.calls++
	r.principal = principal
	r.mode = mode
	r.projectID = projectID
	return r.resolution, r.err
}

func indexEventPermissions() *authorizationPermissionResolver {
	return &authorizationPermissionResolver{
		resolution: auth.PermissionResolution{
			UserID:      17,
			Permissions: []string{"models.applications.tool.patch"},
		},
	}
}

func TestPublicAuthorizerDerivesPhaseOneIdentityFromVerifiedMembership(t *testing.T) {
	store := &authorizationStore{row: authorizationRow{active: true}}
	authorizer, err := newPostgresPublicAuthorizer(
		store,
		&authorizationStore{row: authorizationRow{capabilityID: "index.ingest.v1"}},
		indexEventPermissions(),
	)
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
	authorizer, err := newPostgresPublicAuthorizer(
		store,
		&authorizationStore{row: authorizationRow{capabilityID: "index.ingest.v1"}},
		indexEventPermissions(),
	)
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
	authorizer, err := newPostgresPublicAuthorizer(
		developmentStore,
		&authorizationStore{row: authorizationRow{capabilityID: "index.ingest.v1"}},
		indexEventPermissions(),
	)
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
	authorizer, err = newPostgresPublicAuthorizer(
		store,
		&authorizationStore{row: authorizationRow{capabilityID: "index.ingest.v1"}},
		indexEventPermissions(),
	)
	if err != nil {
		t.Fatal(err)
	}
	ctx := auth.ContextWithAuthenticatedUser(context.Background(), auth.User{ID: "17"}, auth.AuthenticationSourceSession)
	if _, err := authorizer.AuthorizeValidation(ctx, "42", "revision-1"); !errors.Is(err, configurationapi.ErrValidationForbidden) {
		t.Fatalf("missing membership error = %v", err)
	}
}

func TestPublicAuthorizerBindsAllowlistedExecutionEventsToProjectionProject(t *testing.T) {
	store := &authorizationStore{row: authorizationRow{capabilityID: "index.ingest.v1"}}
	permissions := indexEventPermissions()
	authorizer, err := newPostgresPublicAuthorizer(
		&authorizationStore{row: authorizationRow{active: true}},
		store,
		permissions,
	)
	if err != nil {
		t.Fatal(err)
	}
	ctx := auth.ContextWithAuthenticatedUser(context.Background(), auth.User{ID: "17"}, auth.AuthenticationSourceAPIKey)
	if err := authorizer.AuthorizeExecutionEvents(ctx, "42", "execution-1"); err != nil {
		t.Fatal(err)
	}
	for _, binding := range []string{
		"j.tenant_id = ($2::bigint)::text",
		"j.resource_project_id = $2::bigint",
		"j.projection_project_id = $2::bigint",
		"j.execution_id = $1",
		"COUNT(*) = 1",
	} {
		if store.calls != 1 || !strings.Contains(store.sql, binding) {
			t.Fatalf("execution authorization query is missing %q: %s", binding, store.sql)
		}
	}
	for _, capability := range []string{"'configuration.validate.v1'", "'index.ingest.v1'"} {
		if !strings.Contains(store.sql, capability) {
			t.Fatalf("execution authorization is missing allowlisted capability %s: %s", capability, store.sql)
		}
	}
	if !strings.Contains(store.sql, "j.capability_id IN") {
		t.Fatalf("execution authorization capability predicate is not closed: %s", store.sql)
	}
	if len(store.args) != 2 || store.args[0] != "execution-1" || store.args[1] != int64(42) {
		t.Fatalf("execution authorization args = %v", store.args)
	}
	if permissions.calls != 1 ||
		permissions.principal.ID != "17" ||
		permissions.mode != auth.PermissionModeDefault ||
		permissions.projectID != "42" {
		t.Fatalf("permission resolution mismatch: %+v", permissions)
	}

	store = &authorizationStore{row: authorizationRow{}}
	authorizer, _ = newPostgresPublicAuthorizer(
		&authorizationStore{row: authorizationRow{active: true}},
		store,
		indexEventPermissions(),
	)
	if err := authorizer.AuthorizeExecutionEvents(ctx, "42", "execution-1"); !errors.Is(err, executionapi.ErrExecutionEventsForbidden) {
		t.Fatalf("unauthorized event error = %v", err)
	}
}

func TestPublicAuthorizerRequiresIndexObservationPermission(t *testing.T) {
	store := &authorizationStore{row: authorizationRow{capabilityID: "index.ingest.v1"}}
	permissions := &authorizationPermissionResolver{
		resolution: auth.PermissionResolution{
			UserID:      17,
			Permissions: []string{"models.applications.tool.get"},
		},
	}
	authorizer, err := newPostgresPublicAuthorizer(
		&authorizationStore{row: authorizationRow{active: true}},
		store,
		permissions,
	)
	if err != nil {
		t.Fatal(err)
	}
	ctx := auth.ContextWithAuthenticatedUser(context.Background(), auth.User{ID: "17"}, auth.AuthenticationSourceSession)
	if err := authorizer.AuthorizeExecutionEvents(ctx, "42", "execution-1"); !errors.Is(err, executionapi.ErrExecutionEventsForbidden) {
		t.Fatalf("missing patch permission error = %v", err)
	}

	permissions.err = errors.New("inactive principal")
	if err := authorizer.AuthorizeExecutionEvents(ctx, "42", "execution-1"); !errors.Is(err, executionapi.ErrExecutionEventsForbidden) {
		t.Fatalf("resolver failure error = %v", err)
	}
}

func TestPublicAuthorizerKeepsValidationReplayTransitionalAndFailClosed(t *testing.T) {
	store := &authorizationStore{row: authorizationRow{capabilityID: "configuration.validate.v1"}}
	permissions := &authorizationPermissionResolver{
		resolution: auth.PermissionResolution{
			UserID:      17,
			Permissions: []string{"configurations.configuration.details"},
		},
	}
	authorizer, err := newPostgresPublicAuthorizer(
		&authorizationStore{row: authorizationRow{active: true}},
		store,
		permissions,
	)
	if err != nil {
		t.Fatal(err)
	}
	ctx := auth.ContextWithAuthenticatedUser(context.Background(), auth.User{ID: "17"}, auth.AuthenticationSourceSession)
	if err := authorizer.AuthorizeExecutionEvents(ctx, "42", "execution-1"); err != nil {
		t.Fatalf("validation compatibility replay error = %v", err)
	}
	permissions.resolution.Permissions = nil
	if err := authorizer.AuthorizeExecutionEvents(ctx, "42", "execution-1"); !errors.Is(err, executionapi.ErrExecutionEventsForbidden) {
		t.Fatalf("empty validation permissions error = %v", err)
	}
}

func TestPublicAuthorizerRejectsUnverifiedExecutionEventPrincipalBeforeDatabase(t *testing.T) {
	store := &authorizationStore{row: authorizationRow{capabilityID: "index.ingest.v1"}}
	authorizer, err := newPostgresPublicAuthorizer(
		&authorizationStore{row: authorizationRow{active: true}},
		store,
		indexEventPermissions(),
	)
	if err != nil {
		t.Fatal(err)
	}
	contexts := []context.Context{
		auth.ContextWithUser(context.Background(), auth.User{ID: "17"}),
		auth.ContextWithAuthenticatedUser(context.Background(), auth.User{ID: "17"}, auth.AuthenticationSourceDevelopment),
	}
	for _, ctx := range contexts {
		if err := authorizer.AuthorizeExecutionEvents(ctx, "42", "execution-1"); !errors.Is(err, executionapi.ErrExecutionEventsForbidden) {
			t.Fatalf("unverified principal error = %v", err)
		}
	}
	if store.calls != 0 {
		t.Fatalf("unverified principal reached execution authorization database %d times", store.calls)
	}
}

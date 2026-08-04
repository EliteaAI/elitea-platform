package runtimecomposition

import (
	"context"
	"errors"
	"testing"

	configurationapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/configurations"
	executionapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/executions"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
)

type authorizationRow struct {
	active       bool
	capabilityID string
	err          error
}

type authorizationStore struct {
	row             authorizationRow
	admissionParams sqlcgen.AuthorizeRuntimeValidationProjectParams
	outputParams    sqlcgen.ResolveRuntimeExecutionEventCapabilityParams
	calls           int
}

func (s *authorizationStore) AuthorizeRuntimeValidationProject(
	_ context.Context,
	params sqlcgen.AuthorizeRuntimeValidationProjectParams,
) (bool, error) {
	s.calls++
	s.admissionParams = params
	return s.row.active, s.row.err
}

func (s *authorizationStore) ResolveRuntimeExecutionEventCapability(
	_ context.Context,
	params sqlcgen.ResolveRuntimeExecutionEventCapabilityParams,
) (string, error) {
	s.calls++
	s.outputParams = params
	return s.row.capabilityID, s.row.err
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
	if store.calls != 1 || store.admissionParams.ProjectID != 42 || store.admissionParams.UserID != 17 {
		t.Fatalf("authorization query params = %+v calls=%d", store.admissionParams, store.calls)
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
	if store.calls != 1 || store.outputParams.ExecutionID != "execution-1" || store.outputParams.ProjectID != 42 {
		t.Fatalf("execution authorization params = %+v calls=%d", store.outputParams, store.calls)
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

func TestPublicAuthorizerRequiresChatPermissionForBothAgentCapabilities(t *testing.T) {
	ctx := auth.ContextWithAuthenticatedUser(
		context.Background(),
		auth.User{ID: "17"},
		auth.AuthenticationSourceSession,
	)
	for _, capabilityID := range []string{
		executiondomain.AgentApplicationCapability,
		executiondomain.AgentAdhocCapability,
	} {
		store := &authorizationStore{row: authorizationRow{capabilityID: capabilityID}}
		permissions := &authorizationPermissionResolver{resolution: auth.PermissionResolution{
			UserID: 17, Permissions: []string{"models.chat.messages.create"},
		}}
		authorizer, err := newPostgresPublicAuthorizer(
			&authorizationStore{row: authorizationRow{active: true}},
			store,
			permissions,
		)
		if err != nil {
			t.Fatal(err)
		}
		if err := authorizer.AuthorizeExecutionEvents(ctx, "42", "execution-1"); err != nil {
			t.Fatalf("capability %s permission rejected: %v", capabilityID, err)
		}
		permissions.resolution.Permissions = []string{"models.chat.messages.get"}
		if err := authorizer.AuthorizeExecutionEvents(ctx, "42", "execution-1"); !errors.Is(err, executionapi.ErrExecutionEventsForbidden) {
			t.Fatalf("capability %s missing permission error = %v", capabilityID, err)
		}
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

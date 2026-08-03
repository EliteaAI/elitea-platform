package runtimecomposition

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	configurationapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/configurations"
	executionapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/executions"
	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
)

type publicAdmissionAuthorizationQuerier interface {
	AuthorizeRuntimeValidationProject(context.Context, sqlcgen.AuthorizeRuntimeValidationProjectParams) (bool, error)
}

type publicOutputAuthorizationQuerier interface {
	ResolveRuntimeExecutionEventCapability(context.Context, sqlcgen.ResolveRuntimeExecutionEventCapabilityParams) (string, error)
}

// postgresPublicAuthorizer accepts only a principal with server-derived
// authentication provenance. Forwarded identities are admitted only after the
// opaque production route has verified the proxy peer and reloaded the active
// principal. Development and provenance-free contexts are rejected before
// PostgreSQL. Validation admission preserves the current membership contract;
// execution observation additionally resolves the capability's exact RBAC
// permission whenever that policy is known.
type postgresPublicAuthorizer struct {
	admissionStore publicAdmissionAuthorizationQuerier
	outputStore    publicOutputAuthorizationQuerier
	permissions    auth.PermissionResolver
}

func newPostgresPublicAuthorizer(
	admissionStore publicAdmissionAuthorizationQuerier,
	outputStore publicOutputAuthorizationQuerier,
	permissions auth.PermissionResolver,
) (*postgresPublicAuthorizer, error) {
	if admissionStore == nil || outputStore == nil || permissions == nil {
		return nil, errors.New("runtime authorization databases and permission resolver are required")
	}
	return &postgresPublicAuthorizer{
		admissionStore: admissionStore,
		outputStore:    outputStore,
		permissions:    permissions,
	}, nil
}

func (a *postgresPublicAuthorizer) AuthorizeValidation(ctx context.Context, projectID, _ string) (executionapp.AdmissionIdentity, error) {
	project, user, ok := runtimePrincipal(ctx, projectID)
	if !ok {
		return executionapp.AdmissionIdentity{}, configurationapi.ErrValidationForbidden
	}
	authorized, err := a.admissionStore.AuthorizeRuntimeValidationProject(
		ctx,
		sqlcgen.AuthorizeRuntimeValidationProjectParams{
			ProjectID: int32(project),
			UserID:    int32(user),
		},
	)
	if err != nil {
		return executionapp.AdmissionIdentity{}, fmt.Errorf("authorize runtime validation project: %w", err)
	}
	if !authorized {
		return executionapp.AdmissionIdentity{}, configurationapi.ErrValidationForbidden
	}
	canonicalProject := strconv.FormatInt(project, 10)
	canonicalUser := strconv.FormatInt(user, 10)
	return executionapp.AdmissionIdentity{
		TenantID:            canonicalProject,
		ResourceProjectID:   canonicalProject,
		ProjectionProjectID: canonicalProject,
		ActorID:             canonicalUser,
	}, nil
}

func (a *postgresPublicAuthorizer) AuthorizeExecutionEvents(ctx context.Context, projectID, executionID string) error {
	project, principal, ok := runtimePrincipalDetails(ctx, projectID)
	if !ok || executionID == "" || len(executionID) > 256 {
		return executionapi.ErrExecutionEventsForbidden
	}
	capabilityID, err := a.outputStore.ResolveRuntimeExecutionEventCapability(
		ctx,
		sqlcgen.ResolveRuntimeExecutionEventCapabilityParams{
			ExecutionID: executionID,
			ProjectID:   int32(project),
		},
	)
	if err != nil {
		return fmt.Errorf("resolve runtime execution event policy: %w", err)
	}
	if capabilityID == "" {
		return executionapi.ErrExecutionEventsForbidden
	}

	resolution, err := a.permissions.ResolvePermissions(
		ctx,
		principal,
		auth.PermissionModeDefault,
		strconv.FormatInt(project, 10),
	)
	if err != nil {
		return executionapi.ErrExecutionEventsForbidden
	}
	switch capabilityID {
	case "index.ingest.v1":
		if !containsPermission(resolution.Permissions, "models.applications.tool.patch") {
			return executionapi.ErrExecutionEventsForbidden
		}
	case "configuration.validate.v1":
		// Validation can currently be admitted by either create or update.
		// Until admission persists that originating permission, retain the
		// current project-member compatibility behavior without guessing a
		// static permission. The resolver still revalidates the active user,
		// token and project on every SSE poll.
		if len(resolution.Permissions) == 0 {
			return executionapi.ErrExecutionEventsForbidden
		}
	case "agent.execute.application.v1":
		if !containsPermission(resolution.Permissions, "models.chat.messages.create") {
			return executionapi.ErrExecutionEventsForbidden
		}
	default:
		return executionapi.ErrExecutionEventsForbidden
	}
	return nil
}

func runtimePrincipalDetails(ctx context.Context, projectID string) (int64, auth.User, bool) {
	principal, ok := auth.RuntimePrincipalFromContext(ctx)
	if !ok {
		return 0, auth.User{}, false
	}
	project, err := canonicalPositiveInteger(projectID)
	if err != nil {
		return 0, auth.User{}, false
	}
	return project, principal, true
}

func containsPermission(permissions []string, required string) bool {
	for _, permission := range permissions {
		if permission == required {
			return true
		}
	}
	return false
}

func runtimePrincipal(ctx context.Context, projectID string) (int64, int64, bool) {
	principal, ok := auth.RuntimePrincipalFromContext(ctx)
	if !ok {
		return 0, 0, false
	}
	project, err := canonicalPositiveInteger(projectID)
	if err != nil {
		return 0, 0, false
	}
	user, err := canonicalPositiveInteger(principal.ID)
	if err != nil {
		return 0, 0, false
	}
	return project, user, true
}

func canonicalPositiveInteger(value string) (int64, error) {
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed <= 0 || parsed > 1<<31-1 || strconv.FormatInt(parsed, 10) != value {
		return 0, errors.New("identifier is not a canonical positive PostgreSQL integer")
	}
	return parsed, nil
}

var _ configurationapi.ValidationAuthorizer = (*postgresPublicAuthorizer)(nil)
var _ executionapi.EventAuthorizer = (*postgresPublicAuthorizer)(nil)

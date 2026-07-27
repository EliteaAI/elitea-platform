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
	"github.com/jackc/pgx/v5"
)

type publicAuthorizationQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// postgresPublicAuthorizer accepts only a principal with server-derived
// authentication provenance. Forwarded identities are admitted only after the
// opaque production route has verified the proxy peer and reloaded the active
// principal. Development and provenance-free contexts are rejected before
// PostgreSQL. Validation admission preserves the current membership contract;
// execution observation additionally resolves the capability's exact RBAC
// permission whenever that policy is known.
type postgresPublicAuthorizer struct {
	admissionStore publicAuthorizationQueryer
	outputStore    publicAuthorizationQueryer
	permissions    auth.PermissionResolver
}

func newPostgresPublicAuthorizer(
	admissionStore,
	outputStore publicAuthorizationQueryer,
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
	var authorized bool
	err := a.admissionStore.QueryRow(ctx, `
SELECT EXISTS (
    SELECT 1
    FROM centry.project AS p
    WHERE p.id = $1
      AND p.suspended = FALSE
      AND (
          p.owner_id = $2
          OR EXISTS (
              SELECT 1
              FROM auth_core__project_user_role AS pur
              WHERE pur.project_id = p.id
                AND pur.user_id = $2
          )
      )
)`, project, user).Scan(&authorized)
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
	var capabilityID string
	err := a.outputStore.QueryRow(ctx, `
SELECT COALESCE(
    CASE WHEN COUNT(*) = 1 THEN MIN(j.capability_id) END,
    ''
)
FROM elitea_runtime.execution_jobs AS j
JOIN centry.project AS p
  ON p.id = j.projection_project_id
WHERE j.execution_id = $1
  AND j.tenant_id = ($2::bigint)::text
  AND j.resource_project_id = $2::bigint
  AND j.projection_project_id = $2::bigint
  AND j.capability_id IN (
      'configuration.validate.v1',
      'index.ingest.v1'
  )
  AND p.suspended = FALSE`, executionID, project).Scan(&capabilityID)
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
	if err != nil || parsed <= 0 || strconv.FormatInt(parsed, 10) != value {
		return 0, errors.New("identifier is not a canonical positive integer")
	}
	return parsed, nil
}

var _ configurationapi.ValidationAuthorizer = (*postgresPublicAuthorizer)(nil)
var _ executionapi.EventAuthorizer = (*postgresPublicAuthorizer)(nil)

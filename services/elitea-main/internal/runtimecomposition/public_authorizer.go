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
// PostgreSQL. Membership has no permissive fallback: the user must own the
// project or hold a persisted project role.
type postgresPublicAuthorizer struct {
	admissionStore publicAuthorizationQueryer
	outputStore    publicAuthorizationQueryer
}

func newPostgresPublicAuthorizer(admissionStore, outputStore publicAuthorizationQueryer) (*postgresPublicAuthorizer, error) {
	if admissionStore == nil || outputStore == nil {
		return nil, errors.New("runtime admission and output authorization databases are required")
	}
	return &postgresPublicAuthorizer{admissionStore: admissionStore, outputStore: outputStore}, nil
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
	project, user, ok := runtimePrincipal(ctx, projectID)
	if !ok || executionID == "" || len(executionID) > 256 {
		return executionapi.ErrExecutionEventsForbidden
	}
	var authorized bool
	err := a.outputStore.QueryRow(ctx, `
SELECT EXISTS (
    SELECT 1
    FROM elitea_runtime.execution_jobs AS j
    JOIN centry.project AS p
      ON p.id = j.projection_project_id
    WHERE j.execution_id = $1
      AND j.projection_project_id = $2
      AND j.capability_id = 'configuration.validate.v1'
      AND p.suspended = FALSE
      AND (
          p.owner_id = $3
          OR EXISTS (
              SELECT 1
              FROM auth_core__project_user_role AS pur
              WHERE pur.project_id = p.id
                AND pur.user_id = $3
          )
      )
)`, executionID, project, user).Scan(&authorized)
	if err != nil {
		return fmt.Errorf("authorize runtime execution events: %w", err)
	}
	if !authorized {
		return executionapi.ErrExecutionEventsForbidden
	}
	return nil
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

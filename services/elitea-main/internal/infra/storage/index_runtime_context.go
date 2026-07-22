package storage

import (
	"context"
	"errors"
	"strconv"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

const (
	EliteaClientTokenSchemaVersion = "elitea.runtime.elitea-client-token.v1"
	projectAuthTokenSecretName     = "auth_token"
	maxEliteaClientTokenBytes      = 16 * 1024
	maxRuntimeContextResponseBytes = 32 * 1024
)

// RuntimeContextAuthorization is derived only from an active durable claim.
// The request cannot select a project or capability independently.
type RuntimeContextAuthorization struct {
	ResourceProjectID int64
}

// RuntimeContextAuthorizer applies the same workload-certificate, session,
// claim, generation, desired-state, and fence checks as private input reads.
type RuntimeContextAuthorizer interface {
	AuthorizeRuntimeContext(context.Context, ContentClaim) (RuntimeContextAuthorization, error)
}

// ProjectTokenValidator is the narrow bridge to the production Auth graph's
// existing current-baseline HS512 PAT validator.
type ProjectTokenValidator interface {
	ValidateToken(context.Context, string) (auth.User, error)
}

type EliteaClientTokenContext struct {
	SchemaVersion string `json:"schema_version"`
	ProjectID     int64  `json:"project_id"`
	Token         string `json:"token"`
}

// EliteaClientTokenService materializes the current project system-user token
// only after private claim authorization. The value is never cached, logged,
// persisted, or allowed to fall back to the admin vault.
type EliteaClientTokenService struct {
	authorizer RuntimeContextAuthorizer
	vaults     SecretVaultLoader
	validator  ProjectTokenValidator
}

func NewEliteaClientTokenService(
	authorizer RuntimeContextAuthorizer,
	vaults SecretVaultLoader,
	validator ProjectTokenValidator,
) (*EliteaClientTokenService, error) {
	if authorizer == nil || vaults == nil || validator == nil {
		return nil, errors.New("runtime context dependencies are required")
	}
	return &EliteaClientTokenService{
		authorizer: authorizer,
		vaults:     vaults,
		validator:  validator,
	}, nil
}

func (s *EliteaClientTokenService) Resolve(
	ctx context.Context,
	claim ContentClaim,
) (EliteaClientTokenContext, error) {
	if err := ctx.Err(); err != nil {
		return EliteaClientTokenContext{}, err
	}
	authorization, err := s.authorizer.AuthorizeRuntimeContext(ctx, claim)
	if err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return EliteaClientTokenContext{}, contextErr
		}
		return EliteaClientTokenContext{}, ErrContentUnauthorized
	}
	if authorization.ResourceProjectID <= 0 {
		return EliteaClientTokenContext{}, ErrContentUnavailable
	}

	vault, err := s.vaults.LoadProjectVault(ctx, authorization.ResourceProjectID)
	if err != nil || vault == nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return EliteaClientTokenContext{}, contextErr
		}
		return EliteaClientTokenContext{}, ErrContentUnavailable
	}
	secret, err := vault.LookupRegular(projectAuthTokenSecretName)
	if err != nil || len(secret.Value) == 0 || len(secret.Value) > maxEliteaClientTokenBytes {
		return EliteaClientTokenContext{}, ErrContentUnavailable
	}

	principal, err := s.validator.ValidateToken(ctx, secret.Value)
	if err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return EliteaClientTokenContext{}, contextErr
		}
		return EliteaClientTokenContext{}, ErrContentUnavailable
	}
	projectID := strconv.FormatInt(authorization.ResourceProjectID, 10)
	ownerID, ownerOK := principal.OwningUserID()
	tokenID, tokenIDErr := strconv.ParseInt(principal.TokenID, 10, 64)
	canonicalOwnerID := strconv.FormatInt(ownerID, 10)
	if !ownerOK || ownerID <= 0 || tokenIDErr != nil || tokenID <= 0 ||
		principal.ID != canonicalOwnerID || principal.UserID != canonicalOwnerID ||
		principal.AuthType != "token" ||
		principal.Email != "system_user_"+projectID+"@centry.user" {
		return EliteaClientTokenContext{}, ErrContentUnavailable
	}

	return EliteaClientTokenContext{
		SchemaVersion: EliteaClientTokenSchemaVersion,
		ProjectID:     authorization.ResourceProjectID,
		Token:         secret.Value,
	}, nil
}

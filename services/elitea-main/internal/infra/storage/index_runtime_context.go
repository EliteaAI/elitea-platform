package storage

import (
	"context"
	"errors"
	"strconv"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

const (
	EliteaClientTokenSchemaVersion = "elitea.runtime.elitea-client-token.v1"
	maxEliteaClientTokenBytes      = 16 * 1024
	maxRuntimeContextResponseBytes = 32 * 1024

	runtimeContextStageProjectIdentity  = "project_identity"
	runtimeContextStageClaimAuthorize   = "claim_authorization"
	runtimeContextStageExecutionActor   = "execution_actor"
	runtimeContextStageExecutionMode    = "execution_mode"
	runtimeContextStageActorPATIssuance = "actor_pat_issuance"
	runtimeContextStagePATValidation    = "pat_validation"
	runtimeContextStagePrincipalBinding = "principal_binding"
	runtimeContextInitiatorUser         = "user"
)

type runtimeContextUnavailableError struct {
	stage string
}

func (e *runtimeContextUnavailableError) Error() string {
	return ErrContentUnavailable.Error()
}

func (e *runtimeContextUnavailableError) Unwrap() error {
	return ErrContentUnavailable
}

func runtimeContextUnavailable(stage string) error {
	return &runtimeContextUnavailableError{stage: stage}
}

func runtimeContextUnavailableStage(err error) string {
	var unavailable *runtimeContextUnavailableError
	if !errors.As(err, &unavailable) {
		return "unknown"
	}
	switch unavailable.stage {
	case runtimeContextStageProjectIdentity,
		runtimeContextStageClaimAuthorize,
		runtimeContextStageExecutionActor,
		runtimeContextStageExecutionMode,
		runtimeContextStageActorPATIssuance,
		runtimeContextStagePATValidation,
		runtimeContextStagePrincipalBinding:
		return unavailable.stage
	default:
		return "unknown"
	}
}

// RuntimeContextAuthorization is derived only from an active durable claim.
// The request cannot select a project or capability independently.
type RuntimeContextAuthorization struct {
	ResourceProjectID int64
	ActorID           string
	Initiator         string
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

// ActorTokenIssuer recreates one current-baseline bearer token for the exact
// durable execution actor. It must not create or select a different principal.
type ActorTokenIssuer interface {
	IssueToken(context.Context, int64) (string, error)
}

type EliteaClientTokenContext struct {
	SchemaVersion string `json:"schema_version"`
	ProjectID     int64  `json:"project_id"`
	Token         string `json:"token"`
}

// EliteaClientTokenService materializes the current interactive actor's PAT
// only after private claim authorization. The value is never cached, logged,
// persisted, or allowed to fall back to a project-system or admin identity.
type EliteaClientTokenService struct {
	authorizer RuntimeContextAuthorizer
	issuer     ActorTokenIssuer
	validator  ProjectTokenValidator
}

func NewEliteaClientTokenService(
	authorizer RuntimeContextAuthorizer,
	issuer ActorTokenIssuer,
	validator ProjectTokenValidator,
) (*EliteaClientTokenService, error) {
	if authorizer == nil || issuer == nil || validator == nil {
		return nil, errors.New("runtime context dependencies are required")
	}
	return &EliteaClientTokenService{
		authorizer: authorizer,
		issuer:     issuer,
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
		if errors.Is(err, ErrContentUnauthorized) {
			return EliteaClientTokenContext{}, ErrContentUnauthorized
		}
		return EliteaClientTokenContext{}, runtimeContextUnavailable(runtimeContextStageClaimAuthorize)
	}
	if authorization.ResourceProjectID <= 0 {
		return EliteaClientTokenContext{}, runtimeContextUnavailable(runtimeContextStageProjectIdentity)
	}
	actorID, err := strconv.ParseInt(authorization.ActorID, 10, 64)
	if err != nil || actorID <= 0 || strconv.FormatInt(actorID, 10) != authorization.ActorID {
		return EliteaClientTokenContext{}, runtimeContextUnavailable(runtimeContextStageExecutionActor)
	}
	if authorization.Initiator != runtimeContextInitiatorUser {
		return EliteaClientTokenContext{}, runtimeContextUnavailable(runtimeContextStageExecutionMode)
	}

	token, err := s.issuer.IssueToken(ctx, actorID)
	if err != nil || len(token) == 0 || len(token) > maxEliteaClientTokenBytes {
		if contextErr := ctx.Err(); contextErr != nil {
			return EliteaClientTokenContext{}, contextErr
		}
		return EliteaClientTokenContext{}, runtimeContextUnavailable(runtimeContextStageActorPATIssuance)
	}

	principal, err := s.validator.ValidateToken(ctx, token)
	if err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return EliteaClientTokenContext{}, contextErr
		}
		return EliteaClientTokenContext{}, runtimeContextUnavailable(runtimeContextStagePATValidation)
	}
	ownerID, ownerOK := principal.OwningUserID()
	tokenID, tokenIDErr := strconv.ParseInt(principal.TokenID, 10, 64)
	if !ownerOK || ownerID <= 0 || tokenIDErr != nil || tokenID <= 0 ||
		ownerID != actorID || principal.ID != authorization.ActorID ||
		principal.UserID != authorization.ActorID || principal.AuthType != "token" {
		return EliteaClientTokenContext{}, runtimeContextUnavailable(runtimeContextStagePrincipalBinding)
	}

	return EliteaClientTokenContext{
		SchemaVersion: EliteaClientTokenSchemaVersion,
		ProjectID:     authorization.ResourceProjectID,
		Token:         token,
	}, nil
}

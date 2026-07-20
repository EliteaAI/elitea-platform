package authsvc

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
)

var (
	// ErrTokenRejected identifies a syntactically invalid, expired, revoked, or
	// otherwise unknown caller credential. It is safe to map to an ordinary
	// authentication denial without exposing the underlying reason.
	ErrTokenRejected = auth.ErrCredentialRejected
	// ErrTokenValidationUnavailable identifies configuration, storage, or data
	// integrity failures. ForwardAuth must fail closed without misreporting an
	// infrastructure outage as an ordinary bad credential.
	ErrTokenValidationUnavailable = auth.ErrCredentialValidationUnavailable
)

type activePATQueries interface {
	GetActivePATPrincipalByUUID(context.Context, string) (sqlcgen.GetActivePATPrincipalByUUIDRow, error)
}

type LocalValidator struct {
	queries   activePATQueries
	secretKey []byte
}

func NewLocalValidator(pool *pgxpool.Pool, secretKey string) *LocalValidator {
	validator := &LocalValidator{secretKey: []byte(secretKey)}
	if pool != nil {
		validator.queries = sqlcgen.New(pool)
	}
	return validator
}

type tokenClaims struct {
	UUID    string  `json:"uuid"`
	Expires *string `json:"expires"`
	jwt.RegisteredClaims
}

func (v *LocalValidator) ValidateToken(ctx context.Context, tokenStr string) (auth.User, error) {
	if v == nil || len(v.secretKey) == 0 {
		return auth.User{}, fmt.Errorf("%w: token signing key is not configured", ErrTokenValidationUnavailable)
	}
	token, err := jwt.ParseWithClaims(tokenStr, &tokenClaims{}, func(t *jwt.Token) (interface{}, error) {
		if t.Method.Alg() != jwt.SigningMethodHS512.Alg() {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return v.secretKey, nil
	})
	if err != nil {
		return auth.User{}, fmt.Errorf("%w: invalid token: %v", ErrTokenRejected, err)
	}

	claims, ok := token.Claims.(*tokenClaims)
	if !ok || claims.UUID == "" {
		return auth.User{}, fmt.Errorf("%w: invalid token claims", ErrTokenRejected)
	}
	if v.queries == nil {
		return auth.User{}, fmt.Errorf("%w: token repository is not configured", ErrTokenValidationUnavailable)
	}

	// Expiry and active ownership are validated in one generated query. Roles
	// and permissions remain authoritative in the RBAC resolver and are not
	// cached into the credential identity.
	principal, err := v.queries.GetActivePATPrincipalByUUID(ctx, claims.UUID)
	if err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return auth.User{}, contextErr
		}
		if errors.Is(err, pgx.ErrNoRows) {
			return auth.User{}, fmt.Errorf("%w: token not found", ErrTokenRejected)
		}
		return auth.User{}, fmt.Errorf("%w: db lookup failed: %w", ErrTokenValidationUnavailable, err)
	}
	if principal.TokenID <= 0 || principal.UserID <= 0 {
		return auth.User{}, fmt.Errorf("%w: token principal contains invalid identity data", ErrTokenValidationUnavailable)
	}

	return auth.User{
		ID:       strconv.FormatInt(int64(principal.UserID), 10),
		UserID:   strconv.FormatInt(int64(principal.UserID), 10),
		TokenID:  strconv.FormatInt(int64(principal.TokenID), 10),
		Email:    principal.Email,
		AuthType: "token",
	}, nil
}

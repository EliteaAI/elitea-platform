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
		return auth.User{}, errors.New("authsvc: token signing key is not configured")
	}
	token, err := jwt.ParseWithClaims(tokenStr, &tokenClaims{}, func(t *jwt.Token) (interface{}, error) {
		if t.Method.Alg() != jwt.SigningMethodHS512.Alg() {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return v.secretKey, nil
	})
	if err != nil {
		return auth.User{}, fmt.Errorf("authsvc: invalid token: %w", err)
	}

	claims, ok := token.Claims.(*tokenClaims)
	if !ok || claims.UUID == "" {
		return auth.User{}, errors.New("authsvc: invalid token claims")
	}
	if v.queries == nil {
		return auth.User{}, errors.New("authsvc: token repository is not configured")
	}

	// Expiry and active ownership are validated in one generated query. Roles
	// and permissions remain authoritative in the RBAC resolver and are not
	// cached into the credential identity.
	principal, err := v.queries.GetActivePATPrincipalByUUID(ctx, claims.UUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return auth.User{}, errors.New("authsvc: token not found")
		}
		return auth.User{}, fmt.Errorf("authsvc: db lookup failed: %w", err)
	}
	if principal.TokenID <= 0 || principal.UserID <= 0 {
		return auth.User{}, errors.New("authsvc: token principal contains invalid identity data")
	}

	return auth.User{
		ID:       strconv.FormatInt(int64(principal.UserID), 10),
		UserID:   strconv.FormatInt(int64(principal.UserID), 10),
		TokenID:  strconv.FormatInt(int64(principal.TokenID), 10),
		Email:    principal.Email,
		AuthType: "token",
	}, nil
}

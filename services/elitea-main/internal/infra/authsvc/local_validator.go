package authsvc

import (
	"context"
	"fmt"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

type LocalValidator struct {
	pool      *pgxpool.Pool
	secretKey []byte
}

func NewLocalValidator(pool *pgxpool.Pool, secretKey string) *LocalValidator {
	return &LocalValidator{
		pool:      pool,
		secretKey: []byte(secretKey),
	}
}

type tokenClaims struct {
	UUID    string  `json:"uuid"`
	Expires *string `json:"expires"`
	jwt.RegisteredClaims
}

func (v *LocalValidator) ValidateToken(ctx context.Context, tokenStr string) (auth.User, error) {
	// Decode JWT with HS512
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
		return auth.User{}, fmt.Errorf("authsvc: invalid token claims")
	}

	// Look up token in DB
	var tokenID int
	var userID int
	err = v.pool.QueryRow(ctx,
		`SELECT id, user_id
FROM public.auth_core__token
WHERE uuid = $1
  AND (expires IS NULL OR expires > (clock_timestamp() AT TIME ZONE 'UTC'))`,
		claims.UUID,
	).Scan(&tokenID, &userID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return auth.User{}, fmt.Errorf("authsvc: token not found")
		}
		return auth.User{}, fmt.Errorf("authsvc: db lookup failed: %w", err)
	}

	// Get user info. Suspension is an authentication invariant, not only an
	// authorization concern: a suspended owner must not retain access to routes
	// that do not have a permission guard.
	var email, name string
	err = v.pool.QueryRow(ctx,
		`SELECT COALESCE(email, ''), COALESCE(name, '') FROM public.auth_core__user WHERE id = $1 AND suspended = false`,
		userID,
	).Scan(&email, &name)
	if err != nil {
		return auth.User{}, fmt.Errorf("authsvc: user not found: %w", err)
	}

	// Get roles
	rows, err := v.pool.Query(ctx, `
		SELECT r.name FROM public.auth_core__role r
		JOIN public.auth_core__user_role ur ON ur.role_id = r.id
		WHERE ur.user_id = $1
	`, userID)
	var roles []string
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var role string
			rows.Scan(&role)
			roles = append(roles, role)
		}
	}

	return auth.User{
		ID:       fmt.Sprintf("%d", userID),
		UserID:   fmt.Sprintf("%d", userID),
		TokenID:  fmt.Sprintf("%d", tokenID),
		Email:    email,
		AuthType: "token",
		Roles:    roles,
	}, nil
}

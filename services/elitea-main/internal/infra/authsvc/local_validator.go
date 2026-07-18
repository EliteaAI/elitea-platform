package authsvc

import (
	"context"
	"fmt"
	"time"

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
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
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
	var expires *time.Time
	err = v.pool.QueryRow(ctx,
		`SELECT id, user_id, expires FROM auth_core__token WHERE uuid = $1`,
		claims.UUID,
	).Scan(&tokenID, &userID, &expires)
	if err != nil {
		if err == pgx.ErrNoRows {
			return auth.User{}, fmt.Errorf("authsvc: token not found")
		}
		return auth.User{}, fmt.Errorf("authsvc: db lookup failed: %w", err)
	}

	// Check expiry from DB record
	if expires != nil && time.Now().After(*expires) {
		return auth.User{}, fmt.Errorf("authsvc: token expired")
	}

	// Get user info
	var email, name string
	err = v.pool.QueryRow(ctx,
		`SELECT COALESCE(email, ''), COALESCE(name, '') FROM auth_core__user WHERE id = $1`,
		userID,
	).Scan(&email, &name)
	if err != nil {
		return auth.User{}, fmt.Errorf("authsvc: user not found: %w", err)
	}

	// Get roles
	rows, err := v.pool.Query(ctx, `
		SELECT r.name FROM auth_core__role r
		JOIN auth_core__user_role ur ON ur.role_id = r.id
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

	// Get permissions via role → permission mapping
	permRows, err := v.pool.Query(ctx, `
		SELECT DISTINCT rp.permission
		FROM auth_core__role_permission rp
		JOIN auth_core__user_role ur ON ur.role_id = rp.role_id
		WHERE ur.user_id = $1
		ORDER BY rp.permission
	`, userID)
	var permissions []string
	if err == nil {
		defer permRows.Close()
		for permRows.Next() {
			var perm string
			permRows.Scan(&perm)
			permissions = append(permissions, perm)
		}
	}

	return auth.User{
		ID:          fmt.Sprintf("%d", userID),
		Email:       email,
		AuthType:    "token",
		Roles:       roles,
		Permissions: permissions,
	}, nil
}

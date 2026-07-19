package authsvc

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

var ErrPrincipalInactive = errors.New("authsvc: principal is inactive")

type principalStore interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// PrincipalValidator rechecks mutable account state after a credential or
// session has been validated. This keeps suspension authoritative even when
// the credential result came from the short-lived authentication cache.
type PrincipalValidator struct {
	store principalStore
}

func NewPrincipalValidator(pool *pgxpool.Pool) *PrincipalValidator {
	if pool == nil {
		return &PrincipalValidator{}
	}
	return &PrincipalValidator{store: pool}
}

func (v *PrincipalValidator) ValidatePrincipal(ctx context.Context, principal auth.User) (auth.User, error) {
	if v == nil || v.store == nil {
		return auth.User{}, ErrPrincipalInactive
	}

	isToken := principal.TokenID != "" || strings.EqualFold(principal.AuthType, "token")
	if isToken {
		// ID was historically ambiguous: depending on the producer it could be
		// either auth_core__token.id or auth_core__user.id. New trusted producers
		// must provide both typed IDs, so stale or partial cache entries fail
		// closed instead of being resolved through a colliding numeric row.
		if principal.TokenID == "" || principal.UserID == "" {
			return auth.User{}, ErrPrincipalInactive
		}
		id, ok := positivePrincipalID(principal.TokenID)
		if !ok {
			return auth.User{}, ErrPrincipalInactive
		}
		claimedUserID, ok := positivePrincipalID(principal.UserID)
		if !ok {
			return auth.User{}, ErrPrincipalInactive
		}
		var userID int64
		var email string
		err := v.store.QueryRow(ctx, `
SELECT token.user_id, COALESCE(owner.email, '')
FROM public.auth_core__token AS token
JOIN public.auth_core__user AS owner ON owner.id = token.user_id
WHERE token.id = $1
  AND owner.suspended = false
  AND (token.expires IS NULL OR token.expires > (clock_timestamp() AT TIME ZONE 'UTC'))`, id).Scan(&userID, &email)
		if err != nil {
			return auth.User{}, principalValidationError("token", err)
		}
		if claimedUserID != userID {
			return auth.User{}, ErrPrincipalInactive
		}
		principal.TokenID = strconv.FormatInt(id, 10)
		principal.UserID = strconv.FormatInt(userID, 10)
		// Compatibility handlers still use User.ID as an owning-user foreign
		// key. Never allow the forwarded token row ID to reach those paths.
		principal.ID = principal.UserID
		if principal.Email == "" {
			principal.Email = email
		}
		return principal, nil
	}

	userIDValue := principal.UserID
	if userIDValue == "" {
		userIDValue = principal.ID
	}
	userID, ok := positivePrincipalID(userIDValue)
	if !ok {
		return auth.User{}, ErrPrincipalInactive
	}
	var email string
	err := v.store.QueryRow(ctx,
		`SELECT COALESCE(email, '') FROM public.auth_core__user WHERE id = $1 AND suspended = false`,
		userID,
	).Scan(&email)
	if err != nil {
		return auth.User{}, principalValidationError("user", err)
	}
	principal.UserID = strconv.FormatInt(userID, 10)
	if principal.ID == "" {
		principal.ID = principal.UserID
	}
	if principal.Email == "" {
		principal.Email = email
	}
	return principal, nil
}

func positivePrincipalID(value string) (int64, bool) {
	id, err := strconv.ParseInt(value, 10, 64)
	return id, err == nil && id > 0
}

func principalValidationError(kind string, err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrPrincipalInactive
	}
	return fmt.Errorf("authsvc: validate active %s: %w", kind, err)
}

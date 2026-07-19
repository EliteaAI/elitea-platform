package authsvc

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

type principalRow struct {
	values []any
	err    error
}

func (r principalRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) != len(r.values) {
		return errors.New("unexpected scan shape")
	}
	for i, value := range r.values {
		switch target := dest[i].(type) {
		case *int64:
			*target = value.(int64)
		case *string:
			*target = value.(string)
		default:
			return errors.New("unexpected scan target")
		}
	}
	return nil
}

type principalStoreFunc func(context.Context, string, ...any) pgx.Row

func (f principalStoreFunc) QueryRow(ctx context.Context, query string, args ...any) pgx.Row {
	return f(ctx, query, args...)
}

func TestPrincipalValidatorTokenCrossChecksOwnerDespiteNumericIDCollision(t *testing.T) {
	validator := &PrincipalValidator{store: principalStoreFunc(func(_ context.Context, _ string, args ...any) pgx.Row {
		if got := args[0]; got != int64(42) {
			t.Fatalf("token row ID = %v, want 42", got)
		}
		// Token row 42 deliberately belongs to user 7. The user table may also
		// contain row 42; it must never be inferred as this token's owner.
		return principalRow{values: []any{int64(7), "owner@example.test"}}
	})}

	got, err := validator.ValidatePrincipal(context.Background(), auth.User{
		ID:       "42",
		TokenID:  "42",
		UserID:   "7",
		AuthType: "token",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "7" || got.TokenID != "42" || got.UserID != "7" {
		t.Fatalf("resolved principal = %+v", got)
	}
}

func TestPrincipalValidatorRejectsMismatchedClaimedTokenOwner(t *testing.T) {
	validator := &PrincipalValidator{store: principalStoreFunc(func(context.Context, string, ...any) pgx.Row {
		return principalRow{values: []any{int64(7), "owner@example.test"}}
	})}

	_, err := validator.ValidatePrincipal(context.Background(), auth.User{
		ID:       "42",
		TokenID:  "42",
		UserID:   "42",
		AuthType: "token",
	})
	if !errors.Is(err, ErrPrincipalInactive) {
		t.Fatalf("error = %v, want ErrPrincipalInactive", err)
	}
}

func TestPrincipalValidatorRejectsIncompleteCachedTokenBeforeLookup(t *testing.T) {
	// Row 42 may exist in both auth_core__token and auth_core__user. An old
	// cache entry containing only the compatibility ID must not select either
	// interpretation, and a partially upgraded entry is equally untrusted.
	for _, test := range []struct {
		name      string
		principal auth.User
	}{
		{
			name:      "ID-only stale cache with numeric collision",
			principal: auth.User{ID: "42", AuthType: "token"},
		},
		{
			name:      "owner ID without token ID",
			principal: auth.User{ID: "42", UserID: "42", AuthType: "token"},
		},
		{
			name:      "token ID without owner ID",
			principal: auth.User{ID: "42", TokenID: "42", AuthType: "token"},
		},
		{
			name:      "typed token ID without auth type or owner ID",
			principal: auth.User{ID: "42", TokenID: "42"},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			validator := &PrincipalValidator{store: principalStoreFunc(func(context.Context, string, ...any) pgx.Row {
				calls++
				return principalRow{err: pgx.ErrNoRows}
			})}

			_, err := validator.ValidatePrincipal(context.Background(), test.principal)
			if !errors.Is(err, ErrPrincipalInactive) {
				t.Fatalf("error = %v, want ErrPrincipalInactive", err)
			}
			if calls != 0 {
				t.Fatalf("database lookups = %d, want 0 for incomplete token principal", calls)
			}
		})
	}
}

func TestPrincipalValidatorRejectsSuspendedOrMissingUser(t *testing.T) {
	validator := &PrincipalValidator{store: principalStoreFunc(func(context.Context, string, ...any) pgx.Row {
		return principalRow{err: pgx.ErrNoRows}
	})}

	_, err := validator.ValidatePrincipal(context.Background(), auth.User{ID: "7", UserID: "7", AuthType: "session"})
	if !errors.Is(err, ErrPrincipalInactive) {
		t.Fatalf("error = %v, want ErrPrincipalInactive", err)
	}
}

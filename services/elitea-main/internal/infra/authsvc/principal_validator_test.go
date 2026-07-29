package authsvc

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
)

func TestInactiveErrorUsesStorageNeutralAuthContract(t *testing.T) {
	t.Parallel()

	if ErrPrincipalInactive != auth.ErrPrincipalInactive {
		t.Fatalf("ErrPrincipalInactive = %v, want storage-neutral %v", ErrPrincipalInactive, auth.ErrPrincipalInactive)
	}
}

type principalQueriesStub struct {
	activePAT  func(context.Context, int32) (sqlcgen.GetActivePATPrincipalByIDRow, error)
	activeUser func(context.Context, int32) (sqlcgen.GetActiveUserPrincipalByIDRow, error)
}

func (s principalQueriesStub) GetActivePATPrincipalByID(
	ctx context.Context,
	tokenID int32,
) (sqlcgen.GetActivePATPrincipalByIDRow, error) {
	if s.activePAT == nil {
		return sqlcgen.GetActivePATPrincipalByIDRow{}, pgx.ErrNoRows
	}
	return s.activePAT(ctx, tokenID)
}

func (s principalQueriesStub) GetActiveUserPrincipalByID(
	ctx context.Context,
	userID int32,
) (sqlcgen.GetActiveUserPrincipalByIDRow, error) {
	if s.activeUser == nil {
		return sqlcgen.GetActiveUserPrincipalByIDRow{}, pgx.ErrNoRows
	}
	return s.activeUser(ctx, userID)
}

func TestPrincipalValidatorTokenCrossChecksOwnerDespiteNumericIDCollision(t *testing.T) {
	validator := &PrincipalValidator{queries: principalQueriesStub{
		activePAT: func(_ context.Context, tokenID int32) (sqlcgen.GetActivePATPrincipalByIDRow, error) {
			if tokenID != 42 {
				t.Fatalf("token row ID = %d, want 42", tokenID)
			}
			// Token row 42 deliberately belongs to user 7. The user table may
			// also contain row 42; it must never be inferred as this token's owner.
			return sqlcgen.GetActivePATPrincipalByIDRow{
				TokenID: 42,
				UserID:  7,
				Email:   "owner@example.test",
			}, nil
		},
	}}

	got, err := validator.ValidatePrincipal(context.Background(), auth.User{
		ID:       "42",
		TokenID:  "42",
		UserID:   "7",
		Email:    "-",
		AuthType: "token",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "7" || got.TokenID != "42" || got.UserID != "7" {
		t.Fatalf("resolved principal = %+v", got)
	}
	if got.Email != "owner@example.test" {
		t.Fatalf("resolved email = %q, want authoritative database email", got.Email)
	}
}

func TestPrincipalValidatorRejectsMismatchedClaimedTokenOwner(t *testing.T) {
	validator := &PrincipalValidator{queries: principalQueriesStub{
		activePAT: func(context.Context, int32) (sqlcgen.GetActivePATPrincipalByIDRow, error) {
			return sqlcgen.GetActivePATPrincipalByIDRow{
				TokenID: 42,
				UserID:  7,
				Email:   "owner@example.test",
			}, nil
		},
	}}

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
			validator := &PrincipalValidator{queries: principalQueriesStub{
				activePAT: func(context.Context, int32) (sqlcgen.GetActivePATPrincipalByIDRow, error) {
					calls++
					return sqlcgen.GetActivePATPrincipalByIDRow{}, pgx.ErrNoRows
				},
				activeUser: func(context.Context, int32) (sqlcgen.GetActiveUserPrincipalByIDRow, error) {
					calls++
					return sqlcgen.GetActiveUserPrincipalByIDRow{}, pgx.ErrNoRows
				},
			}}

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

func TestPrincipalValidatorUsesAuthoritativeActiveUserAttributes(t *testing.T) {
	validator := &PrincipalValidator{queries: principalQueriesStub{
		activeUser: func(_ context.Context, userID int32) (sqlcgen.GetActiveUserPrincipalByIDRow, error) {
			if userID != 7 {
				t.Fatalf("user ID = %d, want 7", userID)
			}
			return sqlcgen.GetActiveUserPrincipalByIDRow{
				UserID: 7,
				Email:  "owner@example.test",
			}, nil
		},
	}}

	got, err := validator.ValidatePrincipal(context.Background(), auth.User{
		ID:       "42",
		UserID:   "7",
		Email:    "untrusted@example.test",
		AuthType: "session",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "7" || got.UserID != "7" || got.Email != "owner@example.test" {
		t.Fatalf("resolved principal = %+v", got)
	}
}

func TestPrincipalValidatorRejectsSuspendedOrMissingUser(t *testing.T) {
	validator := &PrincipalValidator{queries: principalQueriesStub{}}

	_, err := validator.ValidatePrincipal(
		context.Background(),
		auth.User{ID: "7", UserID: "7", AuthType: "session"},
	)
	if !errors.Is(err, ErrPrincipalInactive) {
		t.Fatalf("error = %v, want ErrPrincipalInactive", err)
	}
}

func TestPrincipalValidatorRejectsIDsOutsideBaselineDatabaseRangeBeforeLookup(t *testing.T) {
	calls := 0
	validator := &PrincipalValidator{queries: principalQueriesStub{
		activeUser: func(context.Context, int32) (sqlcgen.GetActiveUserPrincipalByIDRow, error) {
			calls++
			return sqlcgen.GetActiveUserPrincipalByIDRow{}, nil
		},
	}}

	_, err := validator.ValidatePrincipal(
		context.Background(),
		auth.User{ID: "2147483648", UserID: "2147483648", AuthType: "session"},
	)
	if !errors.Is(err, ErrPrincipalInactive) {
		t.Fatalf("error = %v, want ErrPrincipalInactive", err)
	}
	if calls != 0 {
		t.Fatalf("database lookups = %d, want 0", calls)
	}
}

func TestPrincipalDatabaseIDRejectsBeforeNarrowing(t *testing.T) {
	for value, wantOK := range map[string]bool{
		"1":                   true,
		"2147483647":          true,
		"0":                   false,
		"-1":                  false,
		"2147483648":          false,
		"9223372036854775807": false,
		"not-an-integer":      false,
	} {
		t.Run(value, func(t *testing.T) {
			id, ok := principalDatabaseID(value)
			if ok != wantOK {
				t.Fatalf("principalDatabaseID(%q) = %d, %v", value, id, ok)
			}
			if !ok && id != 0 {
				t.Fatalf("rejected principalDatabaseID(%q) narrowed to %d", value, id)
			}
		})
	}
}

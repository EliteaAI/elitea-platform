package storage

import (
	"context"
	"errors"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/centrysecrets"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

const (
	storagePythonMasterKey  = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
	storagePythonProjectKey = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8="
	storagePythonWrappedKey = "gAAAAABlU_EAoKGio6SlpqeoqaqrrK2uryHMXcX6u3HizkFeKnBIPXqOzdaW4oCAofma6bzJk8y2Ei0rbhRDFYgh-0veP4OgLAC1Vi8Jba2ulGhC4bQrzwA4rrjMrzA3m8X5wInwskE6"
	storagePythonVaultToken = "gAAAAABlU_EBsLGys7S1tre4ubq7vL2-vx1XMkCj-NAPVrz2qJjob7g8g2X5uZRKHkqRYf3PrTLUC8Q1IHnCMja09Xr6VixBNDJNqcJhTDidsE3D9XlcDpLfJ6e5zNz6DsTP67crLz-PvCJO0qwoNSpc2vwiLlTkf2xnyvlVOAMXlrmueSNrVxUoOGRzpK_fci7UQqhXtn2DDrjEgHLzW77baCUbY6nqH4w48HOBwzsCN7Y6dpkZkns7IK5pFKZs4WwYxYbAU6Q0"
)

func TestPostgresSecretVaultLoaderReadsCurrentUnwrappedProjectShape(t *testing.T) {
	loader, err := newPostgresSecretVaultLoader(secretVaultQueryFixture(t, "project-2", storagePythonProjectKey), nil)
	require.NoError(t, err)

	vault, err := loader.LoadProjectVault(context.Background(), 2)
	require.NoError(t, err)
	secret, err := vault.Lookup("normal")
	require.NoError(t, err)
	require.Equal(t, "normal-canary", secret.Value)
	hidden, err := vault.Lookup("hidden")
	require.NoError(t, err)
	require.True(t, hidden.Hidden)
	_, err = vault.LookupRegular("hidden")
	require.ErrorIs(t, err, centrysecrets.ErrSecretNotFound)
}

func TestPostgresSecretVaultLoaderReadsCurrentMasterWrappedAdminShape(t *testing.T) {
	loader, err := newPostgresSecretVaultLoader(
		secretVaultQueryFixture(t, currentAdminVaultID, storagePythonWrappedKey),
		[]byte(storagePythonMasterKey),
	)
	require.NoError(t, err)

	vault, err := loader.LoadAdminVault(context.Background())
	require.NoError(t, err)
	secret, err := vault.LookupRegular("normal")
	require.NoError(t, err)
	require.Equal(t, "normal-canary", secret.Value)
}

func TestPostgresSecretVaultLoaderRejectsInvalidMasterAndHidesStorageDetails(t *testing.T) {
	_, err := newPostgresSecretVaultLoader(secretVaultQueryFixture(t, "project-2", storagePythonProjectKey), []byte("invalid"))
	require.Error(t, err)

	loader, err := newPostgresSecretVaultLoader(contentQueryerFunc(func(context.Context, string, ...any) pgx.Row {
		return contentRowFunc(func(...any) error { return errors.New("database-password-canary") })
	}), nil)
	require.NoError(t, err)
	_, err = loader.LoadProjectVault(context.Background(), 2)
	require.ErrorIs(t, err, ErrContentUnavailable)
	require.NotContains(t, err.Error(), "database-password-canary")
}

func TestPostgresSecretVaultLoaderDestroyClearsMasterKeyAndDisablesReads(t *testing.T) {
	loader, err := newPostgresSecretVaultLoader(
		secretVaultQueryFixture(t, currentAdminVaultID, storagePythonWrappedKey),
		[]byte(storagePythonMasterKey),
	)
	require.NoError(t, err)
	require.NotEmpty(t, loader.masterKey)

	loader.Destroy()
	require.Nil(t, loader.masterKey)
	require.Nil(t, loader.store)
	_, err = loader.LoadAdminVault(context.Background())
	require.ErrorIs(t, err, ErrContentUnavailable)

	// Shutdown cleanup is intentionally idempotent.
	loader.Destroy()
}

func secretVaultQueryFixture(t *testing.T, expectedVaultID, storedKey string) contentQueryer {
	t.Helper()
	return contentQueryerFunc(func(_ context.Context, query string, args ...any) pgx.Row {
		require.Contains(t, query, "centry.secrets_key")
		require.Contains(t, query, "centry.secrets_data")
		require.Len(t, args, 1)
		require.Equal(t, expectedVaultID, args[0])
		return contentRowFunc(func(dest ...any) error {
			require.Len(t, dest, 2)
			*dest[0].(*[]byte) = []byte(storedKey)
			*dest[1].(*[]byte) = []byte(storagePythonVaultToken)
			return nil
		})
	})
}

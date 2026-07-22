package storage

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/centrysecrets"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const currentAdminVaultID = "admin"

// SecretVault exposes only exact-name reads. LookupRegular is used for the
// current shared-admin fallback, which must not expose hidden admin secrets to
// project workloads.
type SecretVault interface {
	Lookup(string) (centrysecrets.Secret, error)
	LookupRegular(string) (centrysecrets.Secret, error)
}

// SecretVaultLoader loads one current Centry vault snapshot. Implementations
// must not cache decrypted values beyond the request that asked for them.
type SecretVaultLoader interface {
	LoadProjectVault(context.Context, int64) (SecretVault, error)
	LoadAdminVault(context.Context) (SecretVault, error)
}

// PostgresSecretVaultLoader is a read-only adapter for the current
// centry.secrets_key / centry.secrets_data representation. The optional master
// key is injected explicitly; this package never reads process environment.
type PostgresSecretVaultLoader struct {
	store     contentQueryer
	masterKey []byte
}

func NewPostgresSecretVaultLoader(pool *pgxpool.Pool, masterKey []byte) (*PostgresSecretVaultLoader, error) {
	if pool == nil {
		return nil, errors.New("secret vault database pool is required")
	}
	return newPostgresSecretVaultLoader(pool, masterKey)
}

func newPostgresSecretVaultLoader(store contentQueryer, masterKey []byte) (*PostgresSecretVaultLoader, error) {
	if store == nil {
		return nil, errors.New("secret vault database store is required")
	}
	if len(masterKey) > 0 && !validEncodedFernetKey(masterKey) {
		return nil, errors.New("secret vault master key is invalid")
	}
	return &PostgresSecretVaultLoader{
		store:     store,
		masterKey: append([]byte(nil), masterKey...),
	}, nil
}

func (l *PostgresSecretVaultLoader) LoadProjectVault(ctx context.Context, projectID int64) (SecretVault, error) {
	if projectID <= 0 {
		return nil, ErrContentRejected
	}
	return l.load(ctx, "project-"+strconv.FormatInt(projectID, 10))
}

func (l *PostgresSecretVaultLoader) LoadAdminVault(ctx context.Context) (SecretVault, error) {
	return l.load(ctx, currentAdminVaultID)
}

func (l *PostgresSecretVaultLoader) load(ctx context.Context, vaultID string) (SecretVault, error) {
	var storedProjectKey, encryptedVault []byte
	err := l.store.QueryRow(ctx, `
SELECT k.data, d.data
FROM centry.secrets_key AS k
JOIN centry.secrets_data AS d ON d.id = k.id
WHERE k.id = $1`, vaultID).Scan(&storedProjectKey, &encryptedVault)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrContentUnavailable
	}
	if err != nil {
		return nil, fmt.Errorf("load encrypted secret vault: %w", ErrContentUnavailable)
	}
	defer clearContentBytes(storedProjectKey)
	defer clearContentBytes(encryptedVault)

	var vault *centrysecrets.Vault
	if len(l.masterKey) == 0 {
		vault, err = centrysecrets.OpenUnwrapped(storedProjectKey, encryptedVault)
	} else {
		vault, err = centrysecrets.OpenWrapped(l.masterKey, storedProjectKey, encryptedVault)
	}
	if err != nil {
		return nil, fmt.Errorf("open encrypted secret vault: %w", ErrContentUnavailable)
	}
	return vault, nil
}

func validEncodedFernetKey(value []byte) bool {
	if len(value) != 44 {
		return false
	}
	var decoded [33]byte
	n, err := base64.URLEncoding.Decode(decoded[:], value)
	clearContentBytes(decoded[:])
	return err == nil && n == 32
}

package repos

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

const maxCurrentVaultMutations = 256

var (
	ErrInvalidCurrentVaultMutation = errors.New("invalid current secret-vault mutation")
	ErrCurrentVaultUnavailable     = errors.New("current secret vault is unavailable")
)

// CurrentSecretVaultRepository atomically rewrites the existing
// centry.secrets_key/secrets_data representation. It does not invent a second
// secret store and never exposes enumeration through this application-facing
// adapter.
type CurrentSecretVaultRepository struct {
	store     sharedStore
	masterKey []byte
}

func NewCurrentSecretVaultRepository(pool *pgxpool.Pool, masterKey []byte) (*CurrentSecretVaultRepository, error) {
	store, err := newPostgresSharedStore(pool)
	if err != nil {
		return nil, err
	}
	return newCurrentSecretVaultRepository(store, masterKey)
}

func newCurrentSecretVaultRepository(store sharedStore, masterKey []byte) (*CurrentSecretVaultRepository, error) {
	if store == nil {
		return nil, errors.New("current secret-vault database is required")
	}
	if len(masterKey) != 0 && !validEncodedCurrentFernetKey(masterKey) {
		return nil, errors.New("current secret-vault master key is invalid")
	}
	return &CurrentSecretVaultRepository{
		store:     store,
		masterKey: append([]byte(nil), masterKey...),
	}, nil
}

func (r *CurrentSecretVaultRepository) MutateProject(
	ctx context.Context,
	projectID int64,
	mutations []centrysecrets.Mutation,
) error {
	if projectID <= 0 {
		return ErrInvalidCurrentVaultMutation
	}
	return r.mutate(ctx, "project-"+strconv.FormatInt(projectID, 10), mutations)
}

func (r *CurrentSecretVaultRepository) MutateAdmin(ctx context.Context, mutations []centrysecrets.Mutation) error {
	return r.mutate(ctx, "admin", mutations)
}

func (r *CurrentSecretVaultRepository) mutate(ctx context.Context, vaultID string, mutations []centrysecrets.Mutation) error {
	if r == nil || r.store == nil {
		return ErrCurrentVaultUnavailable
	}
	if ctx == nil || vaultID == "" || len(mutations) == 0 || len(mutations) > maxCurrentVaultMutations {
		return ErrInvalidCurrentVaultMutation
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	err := r.store.WithinTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadWrite}, func(tx sqlExecutor) error {
		var encryptedProjectKey, encryptedVault []byte
		if err := tx.QueryRow(ctx, `
SELECT k.data, d.data
FROM centry.secrets_key AS k
JOIN centry.secrets_data AS d ON d.id = k.id
WHERE k.id = $1
FOR UPDATE OF k, d`, vaultID).Scan(&encryptedProjectKey, &encryptedVault); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrCurrentVaultUnavailable
			}
			return fmt.Errorf("lock current secret vault: %w", ErrCurrentVaultUnavailable)
		}
		defer clearCurrentVaultBytes(encryptedProjectKey)
		defer clearCurrentVaultBytes(encryptedVault)

		var rewritten []byte
		var err error
		if len(r.masterKey) == 0 {
			rewritten, err = centrysecrets.RewriteUnwrapped(encryptedProjectKey, encryptedVault, mutations)
		} else {
			rewritten, err = centrysecrets.RewriteWrapped(r.masterKey, encryptedProjectKey, encryptedVault, mutations)
		}
		if errors.Is(err, centrysecrets.ErrInvalidMutation) {
			return ErrInvalidCurrentVaultMutation
		}
		if err != nil {
			return ErrCurrentVaultUnavailable
		}
		defer clearCurrentVaultBytes(rewritten)

		tag, err := tx.Exec(ctx, `
UPDATE centry.secrets_data
SET data = $2
WHERE id = $1`, vaultID, rewritten)
		if err != nil || tag.RowsAffected() != 1 {
			return ErrCurrentVaultUnavailable
		}
		return nil
	})
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		return err
	}
	return nil
}

// Destroy clears the repository-owned master-key copy. The repository must not
// be reused after this call.
func (r *CurrentSecretVaultRepository) Destroy() {
	if r == nil {
		return
	}
	clearCurrentVaultBytes(r.masterKey)
	r.masterKey = nil
	r.store = nil
}

func validEncodedCurrentFernetKey(value []byte) bool {
	if len(value) != 44 {
		return false
	}
	decoded := make([]byte, base64.URLEncoding.DecodedLen(len(value)))
	n, err := base64.URLEncoding.Decode(decoded, value)
	clearCurrentVaultBytes(decoded)
	return err == nil && n == 32
}

func clearCurrentVaultBytes(value []byte) {
	for index := range value {
		value[index] = 0
	}
}

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

// EnsureProjectVault creates one project's empty vault when it does not exist,
// and reports whether it created it.
//
// WHY THIS IS HERE (#371). MutateProject cannot create a vault: it locks
// centry.secrets_key/secrets_data and answers ErrCurrentVaultUnavailable when
// the pair is absent. Until now the ONLY code that could bring a project vault
// into being was the secrets HTTP handler, which mints a Fernet key inline on
// its first write. So the first non-HTTP writer for a newly created project —
// project PgVector material — had nothing to write into and could only fail.
//
// It is idempotent and safe under a concurrent first write. The key row is
// inserted with DO NOTHING and the whole pair is written in one transaction, so
// the loser of a race changes nothing and reports created=false. That ordering
// is the same one the secrets handler documents: replacing an existing key row
// would orphan a data row encrypted under the old key.
func (r *CurrentSecretVaultRepository) EnsureProjectVault(
	ctx context.Context,
	projectID int64,
) (created bool, err error) {
	if r == nil || r.store == nil {
		return false, ErrCurrentVaultUnavailable
	}
	if ctx == nil || projectID <= 0 {
		return false, ErrInvalidCurrentVaultMutation
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	vaultID := "project-" + strconv.FormatInt(projectID, 10)

	err = r.store.WithinTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadWrite},
		func(tx sqlExecutor) error {
			var present bool
			if scanErr := tx.QueryRow(ctx, `
SELECT EXISTS (
    SELECT 1
    FROM centry.secrets_key AS k
    JOIN centry.secrets_data AS d ON d.id = k.id
    WHERE k.id = $1
)`, vaultID).Scan(&present); scanErr != nil {
				return ErrCurrentVaultUnavailable
			}
			if present {
				return nil
			}

			var storedKey, encryptedVault []byte
			var createErr error
			if len(r.masterKey) == 0 {
				storedKey, encryptedVault, createErr = centrysecrets.CreateUnwrapped()
			} else {
				storedKey, encryptedVault, createErr = centrysecrets.CreateWrapped(r.masterKey)
			}
			if createErr != nil {
				return ErrCurrentVaultUnavailable
			}
			defer clearCurrentVaultBytes(storedKey)
			defer clearCurrentVaultBytes(encryptedVault)

			// DO NOTHING on both halves: a concurrent first write may have
			// inserted the key between the probe above and this statement, and
			// the surviving key must stay the one the data is encrypted with.
			tag, execErr := tx.Exec(ctx, `
INSERT INTO centry.secrets_key (id, data) VALUES ($1, $2)
ON CONFLICT (id) DO NOTHING`, vaultID, storedKey)
			if execErr != nil {
				return ErrCurrentVaultUnavailable
			}
			if tag.RowsAffected() == 0 {
				// Another writer won. Leave its rows untouched.
				return nil
			}
			if _, execErr := tx.Exec(ctx, `
INSERT INTO centry.secrets_data (id, data) VALUES ($1, $2)
ON CONFLICT (id) DO NOTHING`, vaultID, encryptedVault); execErr != nil {
				return ErrCurrentVaultUnavailable
			}
			created = true
			return nil
		})
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return false, ctxErr
		}
		return false, err
	}
	return created, nil
}

// DeleteProjectVault removes one project's vault rows, and reports whether it
// removed anything.
//
// It is the inverse of EnsureProjectVault and exists for the same caller: a
// provisioning step that created a vault must remove it when the project it
// belongs to is rolled back. Nothing else deletes these rows, so a project
// deleted without this leaves an encrypted vault naming a project that is gone.
func (r *CurrentSecretVaultRepository) DeleteProjectVault(
	ctx context.Context,
	projectID int64,
) (removed bool, err error) {
	if r == nil || r.store == nil {
		return false, ErrCurrentVaultUnavailable
	}
	if ctx == nil || projectID <= 0 {
		return false, ErrInvalidCurrentVaultMutation
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	vaultID := "project-" + strconv.FormatInt(projectID, 10)

	err = r.store.WithinTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadWrite},
		func(tx sqlExecutor) error {
			// Data first: a key row without its data row is an unreadable vault,
			// which is the state lockCurrentSecretVault already rejects, whereas
			// a data row without its key is unopenable ciphertext nothing sweeps.
			dataTag, execErr := tx.Exec(ctx, `DELETE FROM centry.secrets_data WHERE id = $1`, vaultID)
			if execErr != nil {
				return ErrCurrentVaultUnavailable
			}
			keyTag, execErr := tx.Exec(ctx, `DELETE FROM centry.secrets_key WHERE id = $1`, vaultID)
			if execErr != nil {
				return ErrCurrentVaultUnavailable
			}
			removed = dataTag.RowsAffected() > 0 || keyTag.RowsAffected() > 0
			return nil
		})
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return false, ctxErr
		}
		return false, err
	}
	return removed, nil
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
		vault, err := lockCurrentSecretVault(ctx, tx, vaultID)
		if err != nil {
			return err
		}
		defer vault.destroy()
		return vault.mutate(ctx, tx, r.masterKey, mutations)
	})
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		return err
	}
	return nil
}

// lockedCurrentSecretVault owns the encrypted bytes selected under a qualified
// centry row lock. It is transaction-local and must be destroyed before the
// owning transaction callback returns.
type lockedCurrentSecretVault struct {
	id                  string
	encryptedProjectKey []byte
	encryptedVault      []byte
}

func lockCurrentSecretVault(
	ctx context.Context,
	tx sqlExecutor,
	vaultID string,
) (*lockedCurrentSecretVault, error) {
	if ctx == nil || tx == nil || vaultID == "" {
		return nil, ErrCurrentVaultUnavailable
	}
	vault := &lockedCurrentSecretVault{id: vaultID}
	if err := tx.QueryRow(ctx, `
SELECT k.data, d.data
FROM centry.secrets_key AS k
JOIN centry.secrets_data AS d ON d.id = k.id
WHERE k.id = $1
FOR UPDATE OF k, d`, vaultID).Scan(&vault.encryptedProjectKey, &vault.encryptedVault); err != nil {
		vault.destroy()
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrCurrentVaultUnavailable
		}
		return nil, fmt.Errorf("lock current secret vault: %w", ErrCurrentVaultUnavailable)
	}
	if len(vault.encryptedProjectKey) == 0 || len(vault.encryptedVault) == 0 {
		vault.destroy()
		return nil, ErrCurrentVaultUnavailable
	}
	return vault, nil
}

func (v *lockedCurrentSecretVault) mutate(
	ctx context.Context,
	tx sqlExecutor,
	masterKey []byte,
	mutations []centrysecrets.Mutation,
) error {
	if v == nil || tx == nil || v.id == "" || len(mutations) == 0 || len(mutations) > maxCurrentVaultMutations {
		return ErrInvalidCurrentVaultMutation
	}
	var rewritten []byte
	var err error
	if len(masterKey) == 0 {
		rewritten, err = centrysecrets.RewriteUnwrapped(v.encryptedProjectKey, v.encryptedVault, mutations)
	} else {
		rewritten, err = centrysecrets.RewriteWrapped(masterKey, v.encryptedProjectKey, v.encryptedVault, mutations)
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
WHERE id = $1`, v.id, rewritten)
	if err != nil || tag.RowsAffected() != 1 {
		return ErrCurrentVaultUnavailable
	}
	return nil
}

func (v *lockedCurrentSecretVault) destroy() {
	if v == nil {
		return
	}
	clearCurrentVaultBytes(v.encryptedProjectKey)
	clearCurrentVaultBytes(v.encryptedVault)
	v.encryptedProjectKey = nil
	v.encryptedVault = nil
	v.id = ""
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

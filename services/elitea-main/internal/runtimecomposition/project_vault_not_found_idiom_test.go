package runtimecomposition

import (
	"context"
	"errors"
	"fmt"
	"testing"

	secretsapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/secrets"
	vectorstoreapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/vectorstore"
)

// The secrets package answers "not found" ONE way (#416), and this is the proof
// that a caller can still tell the three conditions apart through it.
//
// The package used to answer two ways: a `found bool` on LookupProjectSecret
// and the ErrSecretNotFound sentinel everywhere else. Two idioms for one
// condition is how an unreadable vault gets read as an empty one, which is the
// defect class #412 and #399 both belong to.
//
// THE THREE CASES, each with its own subtest below:
//
//	found       → the value, found == true, no error
//	absent      → found == false, NO error
//	read failed → an error, and found is never true
//
// A fourth condition rides the same sentinel mechanism: a project with no vault
// at all (ErrVaultAbsent). It stays an ERROR here on purpose — it means the
// provisioning step never ran, not that this one secret is unset.
type notFoundIdiomVaultStub struct {
	stored    map[string]string
	lookupErr error
}

func (s *notFoundIdiomVaultStub) LookupProjectSecret(
	_ context.Context,
	_ string,
	name string,
) (string, error) {
	if s.lookupErr != nil {
		return "", s.lookupErr
	}
	value, ok := s.stored[name]
	if !ok {
		return "", fmt.Errorf("%w: %q", secretsapi.ErrSecretNotFound, name)
	}
	return value, nil
}

func (s *notFoundIdiomVaultStub) StoreProjectSecrets(
	_ context.Context,
	_ string,
	_ map[string]string,
) error {
	return nil
}

func TestLookupOptionalProjectSecretSeparatesFoundAbsentAndFailed(t *testing.T) {
	t.Parallel()

	t.Run("found", func(t *testing.T) {
		t.Parallel()
		value, found, err := lookupOptionalProjectSecret(
			context.Background(),
			&notFoundIdiomVaultStub{stored: map[string]string{"pgvector_password": "s3cret"}},
			"1",
			"pgvector_password",
		)
		if err != nil || !found || value != "s3cret" {
			t.Fatalf("value=%q found=%v error=%v", value, found, err)
		}
	})

	t.Run("absent", func(t *testing.T) {
		t.Parallel()
		value, found, err := lookupOptionalProjectSecret(
			context.Background(),
			&notFoundIdiomVaultStub{stored: map[string]string{}},
			"1",
			"pgvector_password",
		)
		if err != nil || found || value != "" {
			t.Fatalf("an absent secret must be found=false with no error: value=%q found=%v error=%v",
				value, found, err)
		}
	})

	t.Run("read failed", func(t *testing.T) {
		t.Parallel()
		// The message says "not found" on purpose. A caller that matched on
		// text rather than on the sentinel would read this vault failure as an
		// empty vault, mint a second password over material it cannot open, and
		// report nothing.
		cause := errors.New("decrypt 1 vault key: cipher: message authentication failed, secret not found")
		value, found, err := lookupOptionalProjectSecret(
			context.Background(),
			&notFoundIdiomVaultStub{lookupErr: cause},
			"1",
			"pgvector_password",
		)
		if found || value != "" {
			t.Fatalf("a failed read reported a result: value=%q found=%v", value, found)
		}
		if !errors.Is(err, cause) {
			t.Fatalf("the cause did not reach the caller: %v", err)
		}
		if errors.Is(err, secretsapi.ErrSecretNotFound) {
			t.Fatal("a failed read matched ErrSecretNotFound")
		}
	})

	t.Run("no vault at all", func(t *testing.T) {
		t.Parallel()
		_, found, err := lookupOptionalProjectSecret(
			context.Background(),
			&notFoundIdiomVaultStub{lookupErr: fmt.Errorf("look up p_1 secret: %w", secretsapi.ErrVaultAbsent)},
			"1",
			"pgvector_password",
		)
		if found {
			t.Fatal("a project with no vault was reported as a project with an empty vault")
		}
		if !errors.Is(err, secretsapi.ErrVaultAbsent) {
			t.Fatalf("error = %v, want ErrVaultAbsent", err)
		}
	})
}

// The same three answers, seen where they are acted on. LoadProjectPgvectorMaterial
// is the one production caller, and the material it builds decides whether the
// provisioner writes a new password over the old one.
func TestLoadProjectPgvectorMaterialActsOnEachOfTheThreeAnswers(t *testing.T) {
	t.Parallel()

	t.Run("absent material is empty, not a fault", func(t *testing.T) {
		t.Parallel()
		repository := newCurrentProjectPgvectorMaterialRepositoryForTest(
			t, &notFoundIdiomVaultStub{stored: map[string]string{}})
		material, err := repository.LoadProjectPgvectorMaterial(context.Background(), 1)
		if err != nil || material.PasswordFound || material.ConnectionStringFound {
			t.Fatalf("material=%+v error=%v", material, err)
		}
	})

	t.Run("an unreadable vault is a fault, not empty material", func(t *testing.T) {
		t.Parallel()
		repository := newCurrentProjectPgvectorMaterialRepositoryForTest(
			t, &notFoundIdiomVaultStub{lookupErr: errors.New("decrypt 1 vault data: authentication failed")})
		material, err := repository.LoadProjectPgvectorMaterial(context.Background(), 1)
		if !errors.Is(err, vectorstoreapp.ErrProjectPgvectorVault) {
			t.Fatalf("error = %v, want ErrProjectPgvectorVault", err)
		}
		if material.PasswordFound || material.ConnectionStringFound {
			t.Fatalf("a failed read produced material: %+v", material)
		}
	})

	t.Run("found material carries both values", func(t *testing.T) {
		t.Parallel()
		repository := newCurrentProjectPgvectorMaterialRepositoryForTest(t, &notFoundIdiomVaultStub{
			stored: map[string]string{
				vectorstoreapp.ProjectPgvectorPasswordKey: "s3cret",
				vectorstoreapp.ProjectPgvectorConnstrKey:  "postgresql://vectors/p_1",
			},
		})
		material, err := repository.LoadProjectPgvectorMaterial(context.Background(), 1)
		if err != nil || !material.PasswordFound || !material.ConnectionStringFound {
			t.Fatalf("material=%+v error=%v", material, err)
		}
		if material.Password != "s3cret" || material.ConnectionString != "postgresql://vectors/p_1" {
			t.Fatalf("material=%+v", material)
		}
	})
}

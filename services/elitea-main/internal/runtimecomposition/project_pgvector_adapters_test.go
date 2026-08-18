package runtimecomposition

import (
	"context"
	"errors"
	"maps"
	"strings"
	"testing"

	vectorstoreapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/vectorstore"
	"github.com/jackc/pgx/v5"
)

func TestCurrentProjectPgvectorDatabaseProvisionerOwnsTrustedBootstrap(t *testing.T) {
	t.Parallel()

	bootstrap, err := pgx.ParseConfig(
		"postgresql://bootstrap:bootstrap-password@vectors:5432/vectors?" +
			"application_name=must-not-copy&connect_timeout=15&sslmode=require&" +
			"target_session_attrs=read-write",
	)
	if err != nil {
		t.Fatal(err)
	}
	adapter, err := newCurrentProjectPgvectorDatabaseProvisioner(bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	bootstrap.User = "mutated"
	bootstrap.Password = "mutated"
	bootstrap.Host = "mutated"
	bootstrap.Database = "mutated"
	if adapter.admin.User != "bootstrap" || adapter.admin.Password != "bootstrap-password" ||
		adapter.admin.Host != "vectors" || adapter.admin.Port != 5432 || adapter.admin.Database != "vectors" ||
		adapter.admin.ProjectConnectionParams != "connect_timeout=15&sslmode=require&target_session_attrs=read-write" {
		t.Fatal("adapter did not own the trusted bootstrap configuration")
	}
	password, err := adapter.NewProjectPassword()
	if err != nil || len(password) != 20 {
		t.Fatalf("NewProjectPassword() length=%d error=%v", len(password), err)
	}
	if _, err := newCurrentProjectPgvectorDatabaseProvisioner(nil); err == nil {
		t.Fatal("nil bootstrap was accepted")
	}
}

func TestCurrentProjectPgvectorMaterialRepositoryUsesTheProjectVaultOnly(t *testing.T) {
	t.Parallel()

	secrets := &currentProjectPgvectorSecretsStub{
		stored: map[string]string{
			vectorstoreapp.ProjectPgvectorPasswordKey: "project-password",
			vectorstoreapp.ProjectPgvectorConnstrKey:  "project-connection",
		},
	}
	repository := newCurrentProjectPgvectorMaterialRepositoryForTest(t, secrets)

	material, err := repository.LoadProjectPgvectorMaterial(context.Background(), 73)
	if err != nil || !material.Complete() || material.Password != "project-password" ||
		material.ConnectionString != "project-connection" {
		t.Fatalf("LoadProjectPgvectorMaterial() material=%+v error=%v", material, err)
	}
	// The port is keyed by the vault's own project id form. A read against
	// another project would open another tenant's vault.
	if secrets.lookupProjectID != "73" || secrets.lookups != 2 {
		t.Fatalf("read routing = project %q lookups %d", secrets.lookupProjectID, secrets.lookups)
	}

	if err := repository.StoreProjectPgvectorMaterial(context.Background(), 73, "new-password", "new-connection"); err != nil {
		t.Fatal(err)
	}
	// ONE rewrite carries both values. Two writes would leave a password with
	// no connection string when the second one fails.
	want := map[string]string{
		vectorstoreapp.ProjectPgvectorPasswordKey: "new-password",
		vectorstoreapp.ProjectPgvectorConnstrKey:  "new-connection",
	}
	if secrets.writes != 1 || secrets.writeProjectID != "73" || !maps.Equal(secrets.written, want) {
		t.Fatalf("atomic write = writes %d project %q values %#v",
			secrets.writes, secrets.writeProjectID, secrets.written)
	}
}

func TestCurrentProjectPgvectorMaterialRepositoryHandlesMissingAndRedactsFailures(t *testing.T) {
	t.Parallel()

	t.Run("missing password and connection string", func(t *testing.T) {
		repository := newCurrentProjectPgvectorMaterialRepositoryForTest(
			t,
			&currentProjectPgvectorSecretsStub{stored: map[string]string{}},
		)
		material, err := repository.LoadProjectPgvectorMaterial(context.Background(), 1)
		if err != nil || material.PasswordFound || material.ConnectionStringFound {
			t.Fatalf("material=%+v error=%v", material, err)
		}
	})

	t.Run("read failure", func(t *testing.T) {
		repository := newCurrentProjectPgvectorMaterialRepositoryForTest(
			t,
			&currentProjectPgvectorSecretsStub{lookupErr: errors.New("vault-secret-canary")},
		)
		_, err := repository.LoadProjectPgvectorMaterial(context.Background(), 1)
		if !errors.Is(err, vectorstoreapp.ErrProjectPgvectorVault) || strings.Contains(err.Error(), "vault-secret-canary") {
			t.Fatalf("error = %v", err)
		}
	})

	t.Run("write failure", func(t *testing.T) {
		repository := newCurrentProjectPgvectorMaterialRepositoryForTest(
			t,
			&currentProjectPgvectorSecretsStub{storeErr: errors.New("vault-secret-canary")},
		)
		err := repository.StoreProjectPgvectorMaterial(context.Background(), 1, "password", "connection")
		if !errors.Is(err, vectorstoreapp.ErrProjectPgvectorVault) || strings.Contains(err.Error(), "vault-secret-canary") {
			t.Fatalf("error = %v", err)
		}
	})
}

func TestCurrentProjectPgvectorMaterialRepositoryValidatesAndPreservesCancellation(t *testing.T) {
	t.Parallel()

	repository := newCurrentProjectPgvectorMaterialRepositoryForTest(
		t,
		&currentProjectPgvectorSecretsStub{stored: map[string]string{}},
	)

	var nilContext context.Context
	if _, err := repository.LoadProjectPgvectorMaterial(nilContext, 1); !errors.Is(err, vectorstoreapp.ErrInvalidProjectPgvectorRequest) {
		t.Fatalf("nil context error = %v", err)
	}
	if err := repository.StoreProjectPgvectorMaterial(context.Background(), 1, "password", ""); !errors.Is(err, vectorstoreapp.ErrInvalidProjectPgvectorRequest) {
		t.Fatalf("empty connection error = %v", err)
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := repository.LoadProjectPgvectorMaterial(canceled, 1); !errors.Is(err, context.Canceled) {
		t.Fatalf("load cancellation = %v", err)
	}
	if err := repository.StoreProjectPgvectorMaterial(canceled, 1, "password", "connection"); !errors.Is(err, context.Canceled) {
		t.Fatalf("store cancellation = %v", err)
	}
}

func TestCurrentProjectPgvectorMaterialRepositoryRequiresItsVaultPort(t *testing.T) {
	t.Parallel()

	if _, err := newCurrentProjectPgvectorMaterialRepository(nil); err == nil {
		t.Fatal("a repository with no vault port was accepted")
	}
}

func newCurrentProjectPgvectorMaterialRepositoryForTest(
	t *testing.T,
	secrets ProjectVaultSecrets,
) *currentProjectPgvectorMaterialRepository {
	t.Helper()
	repository, err := newCurrentProjectPgvectorMaterialRepository(secrets)
	if err != nil {
		t.Fatal(err)
	}
	return repository
}

// currentProjectPgvectorSecretsStub stands in for internal/api/v2/secrets.Handler.
type currentProjectPgvectorSecretsStub struct {
	stored          map[string]string
	lookupErr       error
	storeErr        error
	lookupProjectID string
	lookups         int
	written         map[string]string
	writeProjectID  string
	writes          int
}

func (s *currentProjectPgvectorSecretsStub) LookupProjectSecret(
	_ context.Context,
	projectID string,
	name string,
) (string, bool, error) {
	s.lookups++
	s.lookupProjectID = projectID
	if s.lookupErr != nil {
		return "", false, s.lookupErr
	}
	value, ok := s.stored[name]
	return value, ok, nil
}

func (s *currentProjectPgvectorSecretsStub) StoreProjectSecrets(
	_ context.Context,
	projectID string,
	values map[string]string,
) error {
	s.writes++
	s.writeProjectID = projectID
	if s.storeErr != nil {
		return s.storeErr
	}
	s.written = maps.Clone(values)
	return nil
}

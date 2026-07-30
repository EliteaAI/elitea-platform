package runtimecomposition

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	vectorstoreapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/vectorstore"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/centrysecrets"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
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

func TestCurrentProjectPgvectorMaterialRepositoryUsesRegularProjectVaultOnly(t *testing.T) {
	t.Parallel()

	vault := &currentProjectPgvectorVaultStub{
		regular: map[string]centrysecrets.Secret{
			vectorstoreapp.ProjectPgvectorPasswordKey: {Value: "project-password"},
			vectorstoreapp.ProjectPgvectorConnstrKey:  {Value: "project-connection"},
		},
	}
	loader := &currentProjectPgvectorVaultLoaderStub{project: vault}
	mutator := &currentProjectPgvectorVaultMutatorStub{}
	repository := newCurrentProjectPgvectorMaterialRepositoryForTest(t, loader, mutator)

	material, err := repository.LoadProjectPgvectorMaterial(context.Background(), 73)
	if err != nil || !material.Complete() || material.Password != "project-password" ||
		material.ConnectionString != "project-connection" {
		t.Fatalf("LoadProjectPgvectorMaterial() material=%+v error=%v", material, err)
	}
	if loader.projectID != 73 || vault.regularLookups != 2 || vault.generalLookups != 0 || loader.adminCalls != 0 {
		t.Fatalf("vault routing = project %d regular %d general %d admin %d", loader.projectID, vault.regularLookups, vault.generalLookups, loader.adminCalls)
	}

	if err := repository.StoreProjectPgvectorMaterial(context.Background(), 73, "project-password", "project-connection"); err != nil {
		t.Fatal(err)
	}
	want := []centrysecrets.Mutation{
		{Collection: centrysecrets.RegularSecrets, Name: vectorstoreapp.ProjectPgvectorPasswordKey, Value: "project-password"},
		{Collection: centrysecrets.RegularSecrets, Name: vectorstoreapp.ProjectPgvectorConnstrKey, Value: "project-connection"},
	}
	if mutator.calls != 1 || mutator.projectID != 73 || !reflect.DeepEqual(mutator.mutations, want) {
		t.Fatalf("atomic mutation = calls %d project %d values %#v", mutator.calls, mutator.projectID, mutator.mutations)
	}
}

func TestCurrentProjectPgvectorMaterialRepositoryHandlesMissingAndRedactsFailures(t *testing.T) {
	t.Parallel()

	t.Run("missing regular password", func(t *testing.T) {
		repository := newCurrentProjectPgvectorMaterialRepositoryForTest(
			t,
			&currentProjectPgvectorVaultLoaderStub{project: &currentProjectPgvectorVaultStub{regular: map[string]centrysecrets.Secret{}}},
			&currentProjectPgvectorVaultMutatorStub{},
		)
		material, err := repository.LoadProjectPgvectorMaterial(context.Background(), 1)
		if err != nil || material.PasswordFound || material.ConnectionStringFound {
			t.Fatalf("material=%+v error=%v", material, err)
		}
	})

	t.Run("loader failure", func(t *testing.T) {
		repository := newCurrentProjectPgvectorMaterialRepositoryForTest(
			t,
			&currentProjectPgvectorVaultLoaderStub{err: errors.New("vault-secret-canary")},
			&currentProjectPgvectorVaultMutatorStub{},
		)
		_, err := repository.LoadProjectPgvectorMaterial(context.Background(), 1)
		if !errors.Is(err, vectorstoreapp.ErrProjectPgvectorVault) || strings.Contains(err.Error(), "vault-secret-canary") {
			t.Fatalf("error = %v", err)
		}
	})

	t.Run("mutation failure", func(t *testing.T) {
		repository := newCurrentProjectPgvectorMaterialRepositoryForTest(
			t,
			&currentProjectPgvectorVaultLoaderStub{project: &currentProjectPgvectorVaultStub{}},
			&currentProjectPgvectorVaultMutatorStub{err: errors.New("vault-secret-canary")},
		)
		err := repository.StoreProjectPgvectorMaterial(context.Background(), 1, "password", "connection")
		if !errors.Is(err, vectorstoreapp.ErrProjectPgvectorVault) || strings.Contains(err.Error(), "vault-secret-canary") {
			t.Fatalf("error = %v", err)
		}
	})
}

func TestCurrentProjectPgvectorMaterialRepositoryValidatesAndPreservesCancellation(t *testing.T) {
	t.Parallel()

	loader := &currentProjectPgvectorVaultLoaderStub{project: &currentProjectPgvectorVaultStub{}}
	mutator := &currentProjectPgvectorVaultMutatorStub{}
	repository := newCurrentProjectPgvectorMaterialRepositoryForTest(t, loader, mutator)

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

func newCurrentProjectPgvectorMaterialRepositoryForTest(
	t *testing.T,
	loader storage.SecretVaultLoader,
	mutator currentProjectSecretVaultMutator,
) *currentProjectPgvectorMaterialRepository {
	t.Helper()
	repository, err := newCurrentProjectPgvectorMaterialRepository(loader, mutator)
	if err != nil {
		t.Fatal(err)
	}
	return repository
}

type currentProjectPgvectorVaultLoaderStub struct {
	project    storage.SecretVault
	err        error
	projectID  int64
	adminCalls int
}

func (s *currentProjectPgvectorVaultLoaderStub) LoadProjectVault(_ context.Context, projectID int64) (storage.SecretVault, error) {
	s.projectID = projectID
	return s.project, s.err
}

func (s *currentProjectPgvectorVaultLoaderStub) LoadAdminVault(context.Context) (storage.SecretVault, error) {
	s.adminCalls++
	return nil, errors.New("admin vault must not be used")
}

type currentProjectPgvectorVaultStub struct {
	regular        map[string]centrysecrets.Secret
	regularLookups int
	generalLookups int
}

func (s *currentProjectPgvectorVaultStub) Lookup(string) (centrysecrets.Secret, error) {
	s.generalLookups++
	return centrysecrets.Secret{}, errors.New("general lookup must not be used")
}

func (s *currentProjectPgvectorVaultStub) LookupRegular(name string) (centrysecrets.Secret, error) {
	s.regularLookups++
	secret, ok := s.regular[name]
	if !ok {
		return centrysecrets.Secret{}, centrysecrets.ErrSecretNotFound
	}
	return secret, nil
}

func (*currentProjectPgvectorVaultStub) LookupProjectID(string) (centrysecrets.Secret, error) {
	return centrysecrets.Secret{}, errors.New("project ID lookup must not be used")
}

func (*currentProjectPgvectorVaultStub) LookupRegularProjectID(string) (centrysecrets.Secret, error) {
	return centrysecrets.Secret{}, errors.New("project ID lookup must not be used")
}

func (*currentProjectPgvectorVaultStub) LookupRegularInteger(string) (centrysecrets.Secret, error) {
	return centrysecrets.Secret{}, errors.New("integer lookup must not be used")
}

type currentProjectPgvectorVaultMutatorStub struct {
	projectID int64
	mutations []centrysecrets.Mutation
	err       error
	calls     int
}

func (s *currentProjectPgvectorVaultMutatorStub) MutateProject(
	_ context.Context,
	projectID int64,
	mutations []centrysecrets.Mutation,
) error {
	s.calls++
	s.projectID = projectID
	s.mutations = append([]centrysecrets.Mutation(nil), mutations...)
	return s.err
}

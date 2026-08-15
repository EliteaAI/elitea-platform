package runtimecomposition

// These cases pin the rules that decide whether the project_pgvector step does
// anything, and what its compensation removes. The provisioning itself needs a
// live PostgreSQL and is proven in
// application/projectprovisioning/provisioner_pgvector_postgres_integration_test.go.

import (
	"context"
	"errors"
	"testing"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	vectorstoreapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/vectorstore"
	"github.com/jackc/pgx/v5"
)

func TestProvisionProjectVectorStoreSkipsWhenNoBootstrapIsConfigured(t *testing.T) {
	t.Parallel()

	vaults := &projectVectorStoreVaultStub{}
	store := newProjectVectorStoreForTest(t, &projectVectorStoreFinderStub{}, &projectVectorStoreUnsecreterStub{}, vaults, true)

	if err := store.ProvisionProjectVectorStore(context.Background(), 7); err != nil {
		t.Fatalf("ProvisionProjectVectorStore() = %v, want nil when the deployment runs no vector store", err)
	}
	// Nothing may be created for a project that gets no vector store. A vault
	// minted here would outlive a project the step did not provision.
	if vaults.ensured != 0 {
		t.Fatalf("the project vault was created without a bootstrap: %d calls", vaults.ensured)
	}
}

func TestProvisionProjectVectorStoreReportsAnUnusableBootstrap(t *testing.T) {
	t.Parallel()

	for name, connectionString := range map[string]any{
		"not a URL":            "elitea-pgvector",
		"unsupported scheme":   "mysql://user:pass@host:3306/db",
		"unredeemed reference": "{{secret.pgvector_connstr}}",
		"empty":                "",
		"not a string":         42,
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			vaults := &projectVectorStoreVaultStub{}
			finder := &projectVectorStoreFinderStub{
				found: true,
				data:  map[string]any{"connection_string": connectionString},
			}
			// An unsecreter that fails stands in for the public project having
			// no vault, which is the normal case for a clear-text bootstrap.
			store := newProjectVectorStoreForTest(t, finder,
				&projectVectorStoreUnsecreterStub{err: errors.New("no vault")}, vaults, true)

			err := store.ProvisionProjectVectorStore(context.Background(), 7)
			if !errors.Is(err, ErrProjectVectorStoreBootstrap) {
				t.Fatalf("error = %v, want ErrProjectVectorStoreBootstrap", err)
			}
			if vaults.ensured != 0 {
				t.Fatalf("the project vault was created for an unusable bootstrap: %d calls", vaults.ensured)
			}
		})
	}
}

// TestProvisionProjectVectorStoreRedeemsOnlyAReference pins the reason the
// unsecreter is called conditionally.
//
// It loads the OWNING project's vault and fails when that vault does not exist.
// The public project has no vault until something writes a secret there, so
// calling it for a bootstrap stored in the clear would reject the configuration
// every single-tenant deployment actually has.
func TestProvisionProjectVectorStoreRedeemsOnlyAReference(t *testing.T) {
	t.Parallel()

	t.Run("clear text is not redeemed", func(t *testing.T) {
		t.Parallel()
		unsecreter := &projectVectorStoreUnsecreterStub{err: errors.New("public project has no vault")}
		finder := &projectVectorStoreFinderStub{
			found: true,
			// Port 1 refuses immediately, so this reaches the connect attempt
			// without waiting for a timeout.
			data: map[string]any{"connection_string": "postgresql+psycopg://u:p@127.0.0.1:1/elitea"},
		}
		store := newProjectVectorStoreForTest(t, finder, unsecreter, &projectVectorStoreVaultStub{}, true)

		// The provision fails at the database, which is past resolution. What
		// this case asserts is that the failure is NOT the unsecreter's.
		err := store.ProvisionProjectVectorStore(context.Background(), 7)
		if errors.Is(err, ErrProjectVectorStoreBootstrap) {
			t.Fatalf("a clear-text bootstrap was rejected during resolution: %v", err)
		}
		if unsecreter.calls != 0 {
			t.Fatalf("the unsecreter ran for a bootstrap with no reference: %d calls", unsecreter.calls)
		}
	})

	t.Run("a reference is redeemed", func(t *testing.T) {
		t.Parallel()
		unsecreter := &projectVectorStoreUnsecreterStub{
			data: map[string]any{"connection_string": "postgresql://u:p@127.0.0.1:1/elitea"},
		}
		finder := &projectVectorStoreFinderStub{
			found: true,
			data:  map[string]any{"connection_string": "{{secret.pgvector_connstr}}"},
		}
		store := newProjectVectorStoreForTest(t, finder, unsecreter, &projectVectorStoreVaultStub{}, true)

		err := store.ProvisionProjectVectorStore(context.Background(), 7)
		if errors.Is(err, ErrProjectVectorStoreBootstrap) {
			t.Fatalf("a redeemed bootstrap was rejected during resolution: %v", err)
		}
		if unsecreter.calls != 1 {
			t.Fatalf("the unsecreter ran %d times for a bootstrap reference, want 1", unsecreter.calls)
		}
		if unsecreter.projectID != referencePublicProjectID {
			t.Fatalf("the reference was redeemed against project %d, want the public project %d",
				unsecreter.projectID, referencePublicProjectID)
		}
	})
}

func TestRemoveProjectVectorStoreRemovesTheRowAndTheVault(t *testing.T) {
	t.Parallel()

	vaults := &projectVectorStoreVaultStub{}
	configurations := &projectVectorStoreConfigurationsStub{}
	store := newProjectVectorStoreForTest(t, &projectVectorStoreFinderStub{},
		&projectVectorStoreUnsecreterStub{}, vaults, true)
	store.configurations = configurations

	if err := store.RemoveProjectVectorStore(context.Background(), 7); err != nil {
		t.Fatalf("RemoveProjectVectorStore() = %v", err)
	}
	if configurations.deleted != 1 || configurations.title != vectorstoreapp.DefaultProjectPgvectorTitle {
		t.Fatalf("configuration delete = %d calls, title %q", configurations.deleted, configurations.title)
	}
	if vaults.removed != 1 {
		t.Fatalf("vault delete = %d calls, want 1", vaults.removed)
	}
}

// TestRemoveProjectVectorStoreSkipsAnAbsentTenant covers project deletion, which
// runs every remove including those for steps that never created anything.
func TestRemoveProjectVectorStoreSkipsAnAbsentTenant(t *testing.T) {
	t.Parallel()

	vaults := &projectVectorStoreVaultStub{}
	configurations := &projectVectorStoreConfigurationsStub{}
	store := newProjectVectorStoreForTest(t, &projectVectorStoreFinderStub{},
		&projectVectorStoreUnsecreterStub{}, vaults, false)
	store.configurations = configurations

	if err := store.RemoveProjectVectorStore(context.Background(), 7); err != nil {
		t.Fatalf("RemoveProjectVectorStore() = %v, want nil for a tenant that is already gone", err)
	}
	if configurations.deleted != 0 {
		t.Fatalf("the delete ran against an absent tenant: %d calls", configurations.deleted)
	}
	// The vault is not in the tenant, so it must go regardless.
	if vaults.removed != 1 {
		t.Fatalf("vault delete = %d calls, want 1", vaults.removed)
	}
}

// TestRemoveProjectVectorStoreRemovesTheVaultAfterARowFailure pins the rule that
// one failing half must not strand the other. It is the same rule
// Provisioner.compensate applies to the step list.
func TestRemoveProjectVectorStoreRemovesTheVaultAfterARowFailure(t *testing.T) {
	t.Parallel()

	vaults := &projectVectorStoreVaultStub{}
	configurations := &projectVectorStoreConfigurationsStub{err: errors.New("row delete failed")}
	store := newProjectVectorStoreForTest(t, &projectVectorStoreFinderStub{},
		&projectVectorStoreUnsecreterStub{}, vaults, true)
	store.configurations = configurations

	if err := store.RemoveProjectVectorStore(context.Background(), 7); err == nil {
		t.Fatal("RemoveProjectVectorStore() reported success while the row delete failed")
	}
	if vaults.removed != 1 {
		t.Fatalf("the vault was stranded by a failing row delete: %d calls", vaults.removed)
	}
}

/* ── fixture ───────────────────────────────────────────────────────────── */

const referencePublicProjectID = 1

func newProjectVectorStoreForTest(
	t *testing.T,
	finder *projectVectorStoreFinderStub,
	unsecreter *projectVectorStoreUnsecreterStub,
	vaults *projectVectorStoreVaultStub,
	tenantPresent bool,
) *ProjectVectorStore {
	t.Helper()
	store, err := newProjectVectorStore(
		referencePublicProjectID,
		projectVectorStoreSchemasStub{present: tenantPresent},
		finder,
		unsecreter,
		&projectVectorStoreMaterialsStub{},
		&projectVectorStoreConfigurationsStub{},
		vaults,
		nil,
	)
	if err != nil {
		t.Fatalf("newProjectVectorStore() error = %v", err)
	}
	return store
}

type projectVectorStoreFinderStub struct {
	found bool
	err   error
	data  map[string]any
}

func (s *projectVectorStoreFinderStub) FindByEliteaTitle(
	_ context.Context, projectID int32, _ string, _ bool,
) (configurationapp.CurrentExpansionConfiguration, bool, error) {
	if s.err != nil {
		return configurationapp.CurrentExpansionConfiguration{}, false, s.err
	}
	return configurationapp.CurrentExpansionConfiguration{
		ProjectID: projectID,
		Type:      vectorstoreapp.ProjectPgvectorType,
		Data:      s.data,
	}, s.found, nil
}

type projectVectorStoreUnsecreterStub struct {
	data      map[string]any
	err       error
	calls     int
	projectID int32
}

func (s *projectVectorStoreUnsecreterStub) Unsecret(
	_ context.Context, projectID int32, data map[string]any,
) (map[string]any, error) {
	s.calls++
	s.projectID = projectID
	if s.err != nil {
		return nil, s.err
	}
	if s.data != nil {
		return s.data, nil
	}
	return data, nil
}

type projectVectorStoreVaultStub struct {
	ensured    int
	removed    int
	ensureErr  error
	removeErr  error
	lastEnsure int64
}

func (s *projectVectorStoreVaultStub) EnsureProjectVault(_ context.Context, projectID int64) (bool, error) {
	s.ensured++
	s.lastEnsure = projectID
	return true, s.ensureErr
}

func (s *projectVectorStoreVaultStub) DeleteProjectVault(_ context.Context, _ int64) (bool, error) {
	s.removed++
	return true, s.removeErr
}

type projectVectorStoreConfigurationsStub struct {
	deleted int
	title   string
	err     error
}

func (s *projectVectorStoreConfigurationsStub) UpsertProjectPgvectorConfiguration(
	_ context.Context, _ vectorstoreapp.ProjectConfiguration,
) (int32, error) {
	return 1, nil
}

func (s *projectVectorStoreConfigurationsStub) DeleteProjectPgvectorConfiguration(
	_ context.Context, _ int64, title string,
) (bool, error) {
	s.deleted++
	s.title = title
	return true, s.err
}

type projectVectorStoreMaterialsStub struct{}

func (*projectVectorStoreMaterialsStub) LoadProjectPgvectorMaterial(
	_ context.Context, _ int64,
) (vectorstoreapp.ProjectMaterial, error) {
	return vectorstoreapp.ProjectMaterial{}, nil
}

func (*projectVectorStoreMaterialsStub) StoreProjectPgvectorMaterial(
	_ context.Context, _ int64, _ string, _ string,
) error {
	return nil
}

type projectVectorStoreSchemasStub struct{ present bool }

func (s projectVectorStoreSchemasStub) QueryRow(_ context.Context, _ string, _ ...any) pgx.Row {
	return projectVectorStoreRowStub{tenantPresent: s.present}
}

type projectVectorStoreRowStub struct{ tenantPresent bool }

func (r projectVectorStoreRowStub) Scan(dest ...any) error {
	if len(dest) != 1 {
		return errors.New("unexpected scan arity")
	}
	target, ok := dest[0].(*bool)
	if !ok {
		return errors.New("unexpected scan type")
	}
	*target = r.tenantPresent
	return nil
}

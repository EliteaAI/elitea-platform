package runtimecomposition

// The project vector-store collaborator the provisioner's project_pgvector step
// calls (#371).
//
// It composes components that already existed and had no caller:
// newCurrentProjectPgvectorDatabaseProvisioner, the vault material repository
// beside it, and repos.CurrentProjectPgvectorConfigurationsRepository, joined by
// vectorstore.ProjectPgvectorService. Nothing here re-implements provisioning;
// this file supplies the two things the service could not supply for itself —
// the bootstrap connection, and the inverse used for compensation.
//
// WHERE THE BOOTSTRAP COMES FROM. pylon reads it from the PUBLIC project's
// `elitea-pgvector` configuration and unsecrets it against that project's vault
// (elitea_core/rpc/vectorstore.py:276-296). This does exactly the same, through
// the same two components the index path uses: FindByEliteaTitle and the vault
// unsecreter. It is resolved per provision rather than at start-up, so an
// operator who repoints the platform's vector store does not have to restart
// the service.
//
// WHEN THAT ROW IS ABSENT the deployment has no vector store at all, and no
// project — old or new — can index. The step then reports success without doing
// anything, because there is nothing to provision from and failing would take
// away project creation on a deployment that never had indexing. That is a
// bounded rule, not a silent gap: the row's presence is the deployment's own
// statement that it runs a vector store.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	vectorstoreapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/vectorstore"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/pgvector"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrProjectVectorStoreBootstrap reports a public `elitea-pgvector`
// configuration that exists but cannot be used as a bootstrap connection. It is
// deliberately distinct from "absent": an absent row means the deployment runs
// no vector store, a malformed one means it is misconfigured.
var ErrProjectVectorStoreBootstrap = errors.New("runtimecomposition: project vector-store bootstrap is unusable")

type projectVectorStoreFinder interface {
	FindByEliteaTitle(
		context.Context,
		int32,
		string,
		bool,
	) (configurationapp.CurrentExpansionConfiguration, bool, error)
}

type projectVectorStoreUnsecreter interface {
	Unsecret(context.Context, int32, map[string]any) (map[string]any, error)
}

type projectVectorStoreVault interface {
	EnsureProjectVault(context.Context, int64) (bool, error)
	DeleteProjectVault(context.Context, int64) (bool, error)
}

type projectVectorStoreConfigurations interface {
	vectorstoreapp.ProjectConfigurationRepository
	DeleteProjectPgvectorConfiguration(context.Context, int64, string) (bool, error)
}

type projectVectorStoreSchemas interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// ProjectVectorStore satisfies projectprovisioning.ProjectVectorStore.
type ProjectVectorStore struct {
	publicProjectID int32
	schemas         projectVectorStoreSchemas
	finder          projectVectorStoreFinder
	unsecreter      projectVectorStoreUnsecreter
	materials       vectorstoreapp.ProjectMaterialRepository
	configurations  projectVectorStoreConfigurations
	vaults          projectVectorStoreVault
	logger          *slog.Logger
}

func newProjectVectorStore(
	publicProjectID int32,
	schemas projectVectorStoreSchemas,
	finder projectVectorStoreFinder,
	unsecreter projectVectorStoreUnsecreter,
	materials vectorstoreapp.ProjectMaterialRepository,
	configurations projectVectorStoreConfigurations,
	vaults projectVectorStoreVault,
	logger *slog.Logger,
) (*ProjectVectorStore, error) {
	if publicProjectID <= 0 || schemas == nil || finder == nil || unsecreter == nil ||
		materials == nil || configurations == nil || vaults == nil {
		return nil, errors.New("project vector-store dependencies are required")
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &ProjectVectorStore{
		publicProjectID: publicProjectID,
		schemas:         schemas,
		finder:          finder,
		unsecreter:      unsecreter,
		materials:       materials,
		configurations:  configurations,
		vaults:          vaults,
		logger:          logger,
	}, nil
}

// ProvisionProjectVectorStore converges the project's PgVector role and
// database, its vault material, and its `vectorstorage` configuration row.
func (s *ProjectVectorStore) ProvisionProjectVectorStore(ctx context.Context, projectID int64) error {
	if s == nil {
		return errors.New("project vector store is not configured")
	}
	if projectID <= 0 {
		return vectorstoreapp.ErrInvalidProjectPgvectorRequest
	}

	bootstrap, configured, err := s.resolveBootstrap(ctx)
	if err != nil {
		return err
	}
	if !configured {
		s.logger.WarnContext(ctx,
			"project created without a vector store: this deployment has no public elitea-pgvector configuration, so no project can index",
			"project_id", projectID, "public_project_id", s.publicProjectID)
		return nil
	}

	// The vault must exist before the service hands its material over. Nothing
	// else creates one for a project this route just created.
	if _, err := s.vaults.EnsureProjectVault(ctx, projectID); err != nil {
		return fmt.Errorf("create project vault: %w", err)
	}

	databases, err := newCurrentProjectPgvectorDatabaseProvisioner(bootstrap)
	if err != nil {
		return fmt.Errorf("%w: %s", ErrProjectVectorStoreBootstrap, err)
	}
	service, err := vectorstoreapp.NewProjectPgvectorService(databases, s.materials, s.configurations)
	if err != nil {
		return err
	}
	if _, err := service.Provision(ctx, vectorstoreapp.ProvisionRequest{
		ProjectID: projectID,
		// The documented production mode: one database and one login role per
		// project, which is what pylon's create_pgvector_credentials creates
		// when use_existing_pgvector_user is false — its default.
		Mode:               vectorstoreapp.IsolationDatabaseRole,
		Intent:             vectorstoreapp.ProvisionIfMissing,
		ConfigurationTitle: vectorstoreapp.DefaultProjectPgvectorTitle,
	}); err != nil {
		return err
	}
	return nil
}

// RemoveProjectVectorStore removes the configuration row and the project vault.
//
// It does NOT drop the PgVector role or database — see the step's own comment
// in projectprovisioning for why that boundary is where it is.
//
// Both halves run even when the first fails, and the first error is returned.
// Stopping at the first failure would strand the other resource, which is the
// same rule Provisioner.compensate applies one level up.
func (s *ProjectVectorStore) RemoveProjectVectorStore(ctx context.Context, projectID int64) error {
	if s == nil {
		return errors.New("project vector store is not configured")
	}
	if projectID <= 0 {
		return vectorstoreapp.ErrInvalidProjectPgvectorRequest
	}

	var firstErr error
	// The tenant may already be gone: Deprovision runs every remove, and a
	// project deleted before this step existed has no row to remove either.
	present, err := s.tenantConfigurationPresent(ctx, projectID)
	switch {
	case err != nil:
		firstErr = err
	case present:
		if _, err := s.configurations.DeleteProjectPgvectorConfiguration(
			ctx, projectID, vectorstoreapp.DefaultProjectPgvectorTitle,
		); err != nil {
			firstErr = fmt.Errorf("delete project pgvector configuration: %w", err)
		}
	}

	// The vault goes with the project. This step is the first writer to create
	// it, and both callers of this method — create compensation and project
	// deletion — destroy the project, so no other subsystem's secrets can
	// legitimately outlive it. Nothing else deletes these rows.
	if _, err := s.vaults.DeleteProjectVault(ctx, projectID); err != nil && firstErr == nil {
		firstErr = fmt.Errorf("delete project vault: %w", err)
	}
	return firstErr
}

// tenantConfigurationPresent reports whether the project's tenant configuration
// table exists. The delete runs inside a tenant transaction, which refuses a
// schema that is not there.
func (s *ProjectVectorStore) tenantConfigurationPresent(ctx context.Context, projectID int64) (bool, error) {
	var present bool
	// The name is derived from an int64 id, never from caller input, and it is
	// bound as one text argument rather than concatenated in SQL.
	if err := s.schemas.QueryRow(ctx,
		`SELECT to_regclass($1::text) IS NOT NULL`,
		fmt.Sprintf("p_%d.configuration", projectID),
	).Scan(&present); err != nil {
		return false, fmt.Errorf("resolve project tenant configuration table: %w", err)
	}
	return present, nil
}

// resolveBootstrap reads the platform's PgVector bootstrap from the public
// project, exactly where pylon reads it.
//
// configured is false only when the row is absent. A row that is present but
// unusable is an error, so a misconfigured deployment is reported rather than
// silently treated as one that runs no vector store.
func (s *ProjectVectorStore) resolveBootstrap(ctx context.Context) (*pgx.ConnConfig, bool, error) {
	configuration, found, err := s.finder.FindByEliteaTitle(
		ctx,
		s.publicProjectID,
		vectorstoreapp.DefaultProjectPgvectorTitle,
		false,
	)
	if err != nil {
		return nil, false, fmt.Errorf("read project vector-store bootstrap: %w", err)
	}
	if !found {
		return nil, false, nil
	}

	raw, ok := configuration.Data["connection_string"].(string)
	if !ok || raw == "" {
		return nil, false, fmt.Errorf("%w: no connection string", ErrProjectVectorStoreBootstrap)
	}
	// Redeem only when there is something to redeem. The unsecreter loads the
	// owning project's vault and FAILS when that vault does not exist, and the
	// public project has no vault until something writes a secret there — so
	// calling it unconditionally would reject a bootstrap stored in the clear,
	// which is how the standalone stack and most single-tenant deployments
	// store it. The check is deliberately coarser than the placeholder syntax
	// it guards: it can only cause a redemption that was not needed, never skip
	// one that was.
	if strings.Contains(raw, "{{") {
		data, err := s.unsecreter.Unsecret(ctx, s.publicProjectID, configuration.Data)
		if err != nil {
			return nil, false, fmt.Errorf("%w: redeem bootstrap secrets", ErrProjectVectorStoreBootstrap)
		}
		raw, ok = data["connection_string"].(string)
		if !ok || raw == "" {
			return nil, false, fmt.Errorf("%w: no connection string", ErrProjectVectorStoreBootstrap)
		}
	}
	// The stored form is SQLAlchemy's `postgresql+psycopg://`, which pgx cannot
	// parse. This is the same normalisation the index path applies.
	dsn, ok := pgvector.NormalizeConnectionString(raw)
	if !ok {
		return nil, false, fmt.Errorf("%w: connection string is not a PostgreSQL URL", ErrProjectVectorStoreBootstrap)
	}
	// A placeholder that no vault entry redeemed reaches here verbatim, and
	// would otherwise become a host literally named "{{secret.…}}".
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		return nil, false, fmt.Errorf("%w: connection string is malformed", ErrProjectVectorStoreBootstrap)
	}
	return config, true, nil
}

// NewProjectVectorStore composes the project vector-store collaborator from the
// Configurations runtime, which already owns the finder, the unsecreter and the
// vault writer this needs.
func (runtime *CurrentConfigurationsRuntime) NewProjectVectorStore(
	pool *pgxpool.Pool,
	logger *slog.Logger,
) (*ProjectVectorStore, error) {
	if runtime == nil || runtime.rows == nil || runtime.unsecreter == nil ||
		runtime.vaultWriter == nil || runtime.vaultLoader == nil || pool == nil {
		return nil, errors.New("project vector-store composition is incomplete")
	}
	configurations, err := repos.NewCurrentProjectPgvectorConfigurationsRepository(pool)
	if err != nil {
		return nil, err
	}
	materials, err := newCurrentProjectPgvectorMaterialRepository(runtime.vaultLoader, runtime.vaultWriter)
	if err != nil {
		return nil, err
	}
	return newProjectVectorStore(
		runtime.publicProjectID,
		pool,
		runtime.rows,
		runtime.unsecreter,
		materials,
		configurations,
		runtime.vaultWriter,
		logger,
	)
}

package runtimecomposition

import (
	"context"
	"errors"

	vectorstoreapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/vectorstore"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/centrysecrets"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/pgvector"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
	"github.com/jackc/pgx/v5"
)

type currentProjectPgvectorDatabaseProvisioner struct {
	provisioner *pgvector.Provisioner
	admin       pgvector.AdminConnection
}

func newCurrentProjectPgvectorDatabaseProvisioner(
	bootstrap *pgx.ConnConfig,
) (*currentProjectPgvectorDatabaseProvisioner, error) {
	if bootstrap == nil {
		return nil, errors.New("current project pgvector bootstrap is required")
	}
	projectConnectionParams, err := pgvector.ProjectConnectionParametersFromURL(bootstrap.ConnString())
	if err != nil {
		return nil, errors.New("current project pgvector bootstrap connection parameters are invalid")
	}
	connector, err := pgvector.NewPGXConnector(bootstrap)
	if err != nil {
		return nil, err
	}
	provisioner, err := pgvector.NewProvisioner(connector)
	if err != nil {
		return nil, err
	}
	return &currentProjectPgvectorDatabaseProvisioner{
		provisioner: provisioner,
		admin: pgvector.AdminConnection{
			User:                    bootstrap.User,
			Password:                bootstrap.Password,
			Host:                    bootstrap.Host,
			Port:                    bootstrap.Port,
			Database:                bootstrap.Database,
			ProjectConnectionParams: projectConnectionParams,
		},
	}, nil
}

func (*currentProjectPgvectorDatabaseProvisioner) NewProjectPassword() (string, error) {
	return pgvector.NewProjectPassword()
}

func (a *currentProjectPgvectorDatabaseProvisioner) Provision(
	ctx context.Context,
	request vectorstoreapp.DatabaseProvisionRequest,
	handoff func(context.Context, vectorstoreapp.DatabaseProvisionResult) error,
) (vectorstoreapp.DatabaseProvisionResult, error) {
	if a == nil || a.provisioner == nil || handoff == nil {
		return vectorstoreapp.DatabaseProvisionResult{}, pgvector.ErrInvalidConnector
	}
	if request.Mode != vectorstoreapp.IsolationDatabaseRole && request.Mode != vectorstoreapp.IsolationSchema {
		return vectorstoreapp.DatabaseProvisionResult{}, pgvector.ErrInvalidRequest
	}

	mode := pgvector.ModeDatabaseRole
	if request.Mode == vectorstoreapp.IsolationSchema {
		mode = pgvector.ModeSchema
	}
	result, err := a.provisioner.ProvisionWithHandoff(ctx, pgvector.Request{
		ProjectID:            request.ProjectID,
		Admin:                a.admin,
		Mode:                 mode,
		UseExistingAdminUser: request.UseExistingAdminUser,
		Password:             request.ProjectDatabasePassword,
	}, func(handoffContext context.Context, result pgvector.Result) error {
		return handoff(handoffContext, vectorstoreapp.DatabaseProvisionResult{
			Status:           result.Status,
			Password:         result.Password,
			ConnectionString: result.ConnectionString,
		})
	})
	if err != nil {
		return vectorstoreapp.DatabaseProvisionResult{}, err
	}
	return vectorstoreapp.DatabaseProvisionResult{
		Status:           result.Status,
		Password:         result.Password,
		ConnectionString: result.ConnectionString,
	}, nil
}

type currentProjectSecretVaultMutator interface {
	MutateProject(context.Context, int64, []centrysecrets.Mutation) error
}

type currentProjectPgvectorMaterialRepository struct {
	loader  storage.SecretVaultLoader
	mutator currentProjectSecretVaultMutator
}

func newCurrentProjectPgvectorMaterialRepository(
	loader storage.SecretVaultLoader,
	mutator currentProjectSecretVaultMutator,
) (*currentProjectPgvectorMaterialRepository, error) {
	if loader == nil || mutator == nil {
		return nil, errors.New("current project pgvector vault dependencies are required")
	}
	return &currentProjectPgvectorMaterialRepository{loader: loader, mutator: mutator}, nil
}

func (r *currentProjectPgvectorMaterialRepository) LoadProjectPgvectorMaterial(
	ctx context.Context,
	projectID int64,
) (vectorstoreapp.ProjectMaterial, error) {
	if ctx == nil || projectID <= 0 || r == nil || r.loader == nil {
		return vectorstoreapp.ProjectMaterial{}, vectorstoreapp.ErrInvalidProjectPgvectorRequest
	}
	if err := ctx.Err(); err != nil {
		return vectorstoreapp.ProjectMaterial{}, err
	}
	vault, err := r.loader.LoadProjectVault(ctx, projectID)
	if err != nil || vault == nil {
		return vectorstoreapp.ProjectMaterial{}, currentProjectPgvectorAdapterError(ctx, err)
	}

	password, passwordFound, err := lookupCurrentProjectPgvectorMaterial(
		vault,
		vectorstoreapp.ProjectPgvectorPasswordKey,
	)
	if err != nil {
		return vectorstoreapp.ProjectMaterial{}, currentProjectPgvectorAdapterError(ctx, err)
	}
	connectionString, connectionStringFound, err := lookupCurrentProjectPgvectorMaterial(
		vault,
		vectorstoreapp.ProjectPgvectorConnstrKey,
	)
	if err != nil {
		return vectorstoreapp.ProjectMaterial{}, currentProjectPgvectorAdapterError(ctx, err)
	}
	return vectorstoreapp.ProjectMaterial{
		Password:              password,
		PasswordFound:         passwordFound,
		ConnectionString:      connectionString,
		ConnectionStringFound: connectionStringFound,
	}, nil
}

func lookupCurrentProjectPgvectorMaterial(vault storage.SecretVault, name string) (string, bool, error) {
	secret, err := vault.LookupRegular(name)
	if errors.Is(err, centrysecrets.ErrSecretNotFound) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return secret.Value, true, nil
}

func (r *currentProjectPgvectorMaterialRepository) StoreProjectPgvectorMaterial(
	ctx context.Context,
	projectID int64,
	password string,
	connectionString string,
) error {
	if ctx == nil || projectID <= 0 || connectionString == "" || r == nil || r.mutator == nil {
		return vectorstoreapp.ErrInvalidProjectPgvectorRequest
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := r.mutator.MutateProject(ctx, projectID, []centrysecrets.Mutation{
		{
			Collection: centrysecrets.RegularSecrets,
			Name:       vectorstoreapp.ProjectPgvectorPasswordKey,
			Value:      password,
		},
		{
			Collection: centrysecrets.RegularSecrets,
			Name:       vectorstoreapp.ProjectPgvectorConnstrKey,
			Value:      connectionString,
		},
	}); err != nil {
		return currentProjectPgvectorAdapterError(ctx, err)
	}
	return nil
}

func currentProjectPgvectorAdapterError(ctx context.Context, cause error) error {
	if ctx != nil {
		if err := ctx.Err(); err != nil {
			return err
		}
	}
	if errors.Is(cause, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(cause, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return vectorstoreapp.ErrProjectPgvectorVault
}

var (
	_ vectorstoreapp.DatabaseProvisioner       = (*currentProjectPgvectorDatabaseProvisioner)(nil)
	_ vectorstoreapp.ProjectMaterialRepository = (*currentProjectPgvectorMaterialRepository)(nil)
)

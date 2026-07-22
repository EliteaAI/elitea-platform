package runtimecomposition

import (
	"errors"
	"fmt"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CurrentConfigurationsRuntime is the independently composable current
// Configurations read/model/vault boundary. It has no Redis, worker, gRPC, or
// index-ingest dependency; those systems consume this capability rather than
// owning provider credentials.
type CurrentConfigurationsRuntime struct {
	publicProjectID  int32
	rows             *repos.CurrentConfigurationsRepository
	scope            *repos.CurrentExpansionScopeRepository
	unsecreter       *storage.CurrentVaultUnsecreter
	reader           *configurationapp.CurrentCRUDService
	models           *configurationapp.CurrentModelCatalogService
	available        *configurationapp.CurrentAvailableCatalog
	vaultLoader      storage.SecretVaultLoader
	vaultLoaderOwner *storage.PostgresSecretVaultLoader
	vaultWriter      *repos.CurrentSecretVaultRepository
}

func NewCurrentConfigurationsRuntime(
	pool *pgxpool.Pool,
	publicProjectID int32,
	vaultMasterKeyFile string,
) (*CurrentConfigurationsRuntime, error) {
	if pool == nil || publicProjectID <= 0 {
		return nil, errors.New("current Configurations database and public project are required")
	}
	available, err := configurationapp.LoadPinnedCurrentAvailableCatalog()
	if err != nil {
		return nil, fmt.Errorf("load current Configurations catalog: %w", err)
	}
	masterKey, err := loadOptionalFernetMasterKey(vaultMasterKeyFile)
	if err != nil {
		return nil, err
	}
	defer clear(masterKey)

	vaultLoader, err := storage.NewPostgresSecretVaultLoader(pool, masterKey)
	if err != nil {
		return nil, fmt.Errorf("construct current Configurations vault reader: %w", err)
	}
	vaultWriter, err := repos.NewCurrentSecretVaultRepository(pool, masterKey)
	if err != nil {
		return nil, fmt.Errorf("construct current Configurations vault writer: %w", err)
	}

	configurationRows, err := repos.NewCurrentConfigurationsRepository(pool)
	if err != nil {
		vaultWriter.Destroy()
		return nil, fmt.Errorf("construct current Configurations repository: %w", err)
	}
	scope, err := repos.NewCurrentExpansionScopeRepository(pool, publicProjectID)
	if err != nil {
		vaultWriter.Destroy()
		return nil, fmt.Errorf("construct current Configurations scope: %w", err)
	}
	unsecreter, err := storage.NewCurrentVaultUnsecreter(vaultLoader)
	if err != nil {
		vaultWriter.Destroy()
		return nil, fmt.Errorf("construct current Configurations unsecreter: %w", err)
	}
	reader, err := configurationapp.NewCurrentCRUDService(configurationRows)
	if err != nil {
		vaultWriter.Destroy()
		return nil, err
	}
	modelRows, err := repos.NewCurrentModelsRepository(pool)
	if err != nil {
		vaultWriter.Destroy()
		return nil, fmt.Errorf("construct current Configurations model repository: %w", err)
	}
	modelDefaults, err := storage.NewCurrentModelDefaultsReader(vaultLoader)
	if err != nil {
		vaultWriter.Destroy()
		return nil, err
	}
	models, err := configurationapp.NewCurrentModelCatalogService(modelRows, modelDefaults)
	if err != nil {
		vaultWriter.Destroy()
		return nil, err
	}

	return &CurrentConfigurationsRuntime{
		publicProjectID:  publicProjectID,
		rows:             configurationRows,
		scope:            scope,
		unsecreter:       unsecreter,
		reader:           reader,
		models:           models,
		available:        available,
		vaultLoader:      vaultLoader,
		vaultLoaderOwner: vaultLoader,
		vaultWriter:      vaultWriter,
	}, nil
}

func (runtime *CurrentConfigurationsRuntime) Reader() *configurationapp.CurrentCRUDService {
	if runtime == nil {
		return nil
	}
	return runtime.reader
}

func (runtime *CurrentConfigurationsRuntime) ModelCatalog() *configurationapp.CurrentModelCatalogService {
	if runtime == nil {
		return nil
	}
	return runtime.models
}

func (runtime *CurrentConfigurationsRuntime) AvailableCatalog() *configurationapp.CurrentAvailableCatalog {
	if runtime == nil {
		return nil
	}
	return runtime.available
}

func (runtime *CurrentConfigurationsRuntime) VaultWriter() *repos.CurrentSecretVaultRepository {
	if runtime == nil {
		return nil
	}
	return runtime.vaultWriter
}

func (runtime *CurrentConfigurationsRuntime) Destroy() {
	if runtime == nil {
		return
	}
	if runtime.vaultWriter != nil {
		runtime.vaultWriter.Destroy()
	}
	if runtime.vaultLoaderOwner != nil {
		runtime.vaultLoaderOwner.Destroy()
	}
	runtime.reader = nil
	runtime.models = nil
	runtime.available = nil
	runtime.rows = nil
	runtime.scope = nil
	runtime.unsecreter = nil
	runtime.vaultLoader = nil
	runtime.vaultLoaderOwner = nil
	runtime.vaultWriter = nil
	runtime.publicProjectID = 0
}

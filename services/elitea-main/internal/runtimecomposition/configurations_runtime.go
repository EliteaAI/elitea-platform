package runtimecomposition

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
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
	expander         *configurationapp.CurrentExpansionService
	reader           *configurationapp.CurrentConfigurationReadService
	types            *configurationapp.CurrentConfigurationTypesService
	models           *configurationapp.CurrentModelCatalogService
	available        *configurationapp.CurrentAvailableCatalog
	vaultLoader      storage.SecretVaultLoader
	vaultLoaderOwner *storage.PostgresSecretVaultLoader
	vaultWriter      *repos.CurrentSecretVaultRepository
	mutationRows     *repos.CurrentConfigurationMutationRepository
}

// NewCurrentConfigurationsRuntime composes the boundary.
//
// The master key has TWO accepted sources and they must agree, because the
// vault rows this runtime reads are written by someone else: the secrets
// handler, which wraps every project key with SECRETS_MASTER_KEY. Passing this
// runtime a different key — or none — does not fail at composition time. It
// fails later, once per read, as ErrInvalidProjectKey on a row that is
// perfectly intact, and the model catalogue then answered 500 for EVERY
// section on a deployment whose configuration rows were all present (#399's
// one-key-source rule, applied to the reader this time).
//
//   - vaultMasterKeyFile is the file source. No compose file or chart in
//     deploy/ sets ELITEA_VAULT_MASTER_KEY_FILE, so it is the override, not
//     the default.
//   - envMasterKey is the base64url-encoded SECRETS_MASTER_KEY the rest of the
//     process already uses. It is what a real deployment supplies.
//
// A nil pair stays supported: that is the unwrapped shape centry writes when
// no master key is set, and the E2E stack seeds it deliberately.
func NewCurrentConfigurationsRuntime(
	pool *pgxpool.Pool,
	publicProjectID int32,
	vaultMasterKeyFile string,
	envMasterKey []byte,
) (*CurrentConfigurationsRuntime, error) {
	if pool == nil || publicProjectID <= 0 {
		return nil, errors.New("current Configurations database and public project are required")
	}
	available, err := configurationapp.LoadPinnedCurrentAvailableCatalog()
	if err != nil {
		return nil, fmt.Errorf("load current Configurations catalog: %w", err)
	}
	fileMasterKey, err := loadOptionalFernetMasterKey(vaultMasterKeyFile)
	if err != nil {
		return nil, err
	}
	defer clear(fileMasterKey)
	masterKey := fileMasterKey
	if fileMasterKey == nil {
		masterKey = envMasterKey
	} else if len(envMasterKey) != 0 && !bytes.Equal(fileMasterKey, envMasterKey) {
		// Refusing beats picking a winner. Whichever one lost would read some
		// of the vaults in this database and not the others, and the half it
		// could not open is indistinguishable from a corrupt row.
		return nil, errors.New(
			"ELITEA_VAULT_MASTER_KEY_FILE and SECRETS_MASTER_KEY hold different keys",
		)
	}

	vaultLoader, err := storage.NewPostgresSecretVaultLoader(pool, masterKey)
	if err != nil {
		return nil, fmt.Errorf("construct current Configurations vault reader: %w", err)
	}
	vaultWriter, err := repos.NewCurrentSecretVaultRepository(pool, masterKey)
	if err != nil {
		vaultLoader.Destroy()
		return nil, fmt.Errorf("construct current Configurations vault writer: %w", err)
	}
	mutationRows, err := repos.NewCurrentConfigurationMutationRepository(pool, masterKey)
	if err != nil {
		destroyCurrentConfigurationsPersistence(vaultLoader, vaultWriter, nil)
		return nil, fmt.Errorf("construct current Configurations mutation repository: %w", err)
	}

	configurationRows, err := repos.NewCurrentConfigurationsRepository(pool)
	if err != nil {
		destroyCurrentConfigurationsPersistence(vaultLoader, vaultWriter, mutationRows)
		return nil, fmt.Errorf("construct current Configurations repository: %w", err)
	}
	scope, err := repos.NewCurrentExpansionScopeRepository(pool, publicProjectID)
	if err != nil {
		destroyCurrentConfigurationsPersistence(vaultLoader, vaultWriter, mutationRows)
		return nil, fmt.Errorf("construct current Configurations scope: %w", err)
	}
	unsecreter, err := storage.NewCurrentVaultUnsecreter(vaultLoader)
	if err != nil {
		destroyCurrentConfigurationsPersistence(vaultLoader, vaultWriter, mutationRows)
		return nil, fmt.Errorf("construct current Configurations unsecreter: %w", err)
	}
	expander, err := configurationapp.NewCurrentExpansionService(scope, configurationRows, unsecreter)
	if err != nil {
		destroyCurrentConfigurationsPersistence(vaultLoader, vaultWriter, mutationRows)
		return nil, fmt.Errorf("construct current Configurations expansion: %w", err)
	}
	rowReader, err := configurationapp.NewCurrentCRUDService(configurationRows)
	if err != nil {
		destroyCurrentConfigurationsPersistence(vaultLoader, vaultWriter, mutationRows)
		return nil, err
	}
	options, err := configurationapp.NewCurrentConfigurationOptionsEnricher(available, configurationRows)
	if err != nil {
		destroyCurrentConfigurationsPersistence(vaultLoader, vaultWriter, mutationRows)
		return nil, err
	}
	reader, err := configurationapp.NewCurrentConfigurationReadService(
		rowReader,
		options,
		publicProjectID,
	)
	if err != nil {
		destroyCurrentConfigurationsPersistence(vaultLoader, vaultWriter, mutationRows)
		return nil, err
	}
	types, err := configurationapp.NewCurrentConfigurationTypesService(configurationRows)
	if err != nil {
		destroyCurrentConfigurationsPersistence(vaultLoader, vaultWriter, mutationRows)
		return nil, err
	}
	modelRows, err := repos.NewCurrentModelsRepository(pool)
	if err != nil {
		destroyCurrentConfigurationsPersistence(vaultLoader, vaultWriter, mutationRows)
		return nil, fmt.Errorf("construct current Configurations model repository: %w", err)
	}
	modelDefaults, err := storage.NewCurrentModelDefaultsReader(vaultLoader)
	if err != nil {
		destroyCurrentConfigurationsPersistence(vaultLoader, vaultWriter, mutationRows)
		return nil, err
	}
	models, err := configurationapp.NewCurrentModelCatalogService(modelRows, modelDefaults)
	if err != nil {
		destroyCurrentConfigurationsPersistence(vaultLoader, vaultWriter, mutationRows)
		return nil, err
	}

	return &CurrentConfigurationsRuntime{
		publicProjectID:  publicProjectID,
		rows:             configurationRows,
		scope:            scope,
		unsecreter:       unsecreter,
		expander:         expander,
		reader:           reader,
		types:            types,
		models:           models,
		available:        available,
		vaultLoader:      vaultLoader,
		vaultLoaderOwner: vaultLoader,
		vaultWriter:      vaultWriter,
		mutationRows:     mutationRows,
	}, nil
}

func destroyCurrentConfigurationsPersistence(
	loader *storage.PostgresSecretVaultLoader,
	writer *repos.CurrentSecretVaultRepository,
	mutations *repos.CurrentConfigurationMutationRepository,
) {
	if mutations != nil {
		mutations.Destroy()
	}
	if writer != nil {
		writer.Destroy()
	}
	if loader != nil {
		loader.Destroy()
	}
}

// NewMutationService composes the atomic row/vault/lifecycle transaction only
// after the caller supplies the production SDK validation boundary. The
// runtime itself builds and verifies the complete 49-type normalizer chain so
// a partial PoV fallback cannot be mounted accidentally.
func (runtime *CurrentConfigurationsRuntime) NewMutationService(
	validator configurationapp.CurrentSDKConfigurationValidator,
) (*configurationapp.CurrentConfigurationMutationService, error) {
	if runtime == nil || runtime.mutationRows == nil || runtime.available == nil || runtime.expander == nil || validator == nil {
		return nil, errors.New("current Configurations mutation composition is incomplete")
	}
	normalizer, err := configurationapp.NewCurrentConfigurationDataNormalizer(
		runtime.available,
		runtime.expander,
		validator,
	)
	if err != nil {
		return nil, fmt.Errorf("compose current Configurations normalizer: %w", err)
	}
	return configurationapp.NewCurrentConfigurationMutationService(
		runtime.mutationRows,
		runtime.available,
		normalizer,
		newCurrentConfigurationUUID,
		newCurrentConfigurationSecretID,
	)
}

func newCurrentConfigurationUUID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf(
		"%08x-%04x-%04x-%04x-%012x",
		value[0:4], value[4:6], value[6:8], value[8:10], value[10:16],
	), nil
}

func newCurrentConfigurationSecretID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(value[:]), nil
}

func (runtime *CurrentConfigurationsRuntime) Reader() *configurationapp.CurrentConfigurationReadService {
	if runtime == nil {
		return nil
	}
	return runtime.reader
}

func (runtime *CurrentConfigurationsRuntime) Types() *configurationapp.CurrentConfigurationTypesService {
	if runtime == nil {
		return nil
	}
	return runtime.types
}

func (runtime *CurrentConfigurationsRuntime) Expansion() *configurationapp.CurrentExpansionService {
	if runtime == nil {
		return nil
	}
	return runtime.expander
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

// VaultLoader exposes the request-scoped read capability owned by this
// runtime. Callers must not retain decrypted vault snapshots or destroy the
// returned loader; lifecycle remains with CurrentConfigurationsRuntime.
func (runtime *CurrentConfigurationsRuntime) VaultLoader() storage.SecretVaultLoader {
	if runtime == nil {
		return nil
	}
	return runtime.vaultLoader
}

func (runtime *CurrentConfigurationsRuntime) Destroy() {
	if runtime == nil {
		return
	}
	if runtime.mutationRows != nil {
		runtime.mutationRows.Destroy()
	}
	if runtime.vaultWriter != nil {
		runtime.vaultWriter.Destroy()
	}
	if runtime.vaultLoaderOwner != nil {
		runtime.vaultLoaderOwner.Destroy()
	}
	runtime.reader = nil
	runtime.types = nil
	runtime.models = nil
	runtime.available = nil
	runtime.rows = nil
	runtime.scope = nil
	runtime.unsecreter = nil
	runtime.expander = nil
	runtime.vaultLoader = nil
	runtime.vaultLoaderOwner = nil
	runtime.vaultWriter = nil
	runtime.mutationRows = nil
	runtime.publicProjectID = 0
}

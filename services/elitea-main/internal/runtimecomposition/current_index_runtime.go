package runtimecomposition

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	indexmetaapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexmeta"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/pgvector"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	indexResourceClass  = "indexing"
	indexIsolationClass = "project"
	indexDeadlineTTL    = 24 * time.Hour
)

type currentIndexRuntime struct {
	start        *indexingapp.StartService
	materializer *storage.CurrentConfigurationsMaterializer
	indexMeta    *indexmetaapp.Service
}

// newCurrentIndexRuntime composes the current index_data preparation path from
// Configurations-owned records. Provider credentials remain generic
// configuration data; this graph contains no GitHub, OpenAPI, or other toolkit
// credential implementation. The SDK receives the same expanded toolkit and
// Configurations-derived model metadata that the current Python path supplies.
func newCurrentIndexRuntime(
	pool *pgxpool.Pool,
	configurations *CurrentConfigurationsRuntime,
	config Config,
	policy repos.IndexIngestDispatchPolicy,
) (*currentIndexRuntime, error) {
	if pool == nil || configurations == nil || configurations.rows == nil || configurations.scope == nil ||
		configurations.unsecreter == nil || configurations.models == nil || configurations.vaultLoader == nil ||
		!config.IndexIngestDispatchEnabled || configurations.publicProjectID <= 0 {
		return nil, errors.New("current index runtime dependencies are required")
	}
	vaults := configurations.vaultLoader

	builtInSchemas, err := LoadPinnedCurrentToolkitSchemaSnapshot()
	if err != nil {
		return nil, fmt.Errorf("load current SDK toolkit schema snapshot: %w", err)
	}
	schemas, err := NewCurrentCompositeToolkitSchemaCatalog(
		builtInSchemas,
		UnavailableCurrentActorVisibleToolkitSchemas{},
	)
	if err != nil {
		return nil, err
	}
	names, err := NewCurrentBuiltInToolkitNameDeriver(builtInSchemas)
	if err != nil {
		return nil, err
	}

	toolkitRows, err := repos.NewCurrentToolkitsRepository(pool)
	if err != nil {
		return nil, fmt.Errorf("construct current toolkit repository: %w", err)
	}
	toolkits, err := NewCurrentToolkitReaderAdapter(toolkitRows, names)
	if err != nil {
		return nil, err
	}
	nestedToolkits, err := NewCurrentNestedToolkitReaderAdapter(toolkitRows, names)
	if err != nil {
		return nil, err
	}

	expander, err := configurationapp.NewCurrentExpansionService(
		configurations.scope,
		configurations.rows,
		configurations.unsecreter,
	)
	if err != nil {
		return nil, err
	}

	models := configurations.models
	modelVisibility, err := NewCurrentModelVisibilityAdapter(models, configurations.publicProjectID)
	if err != nil {
		return nil, err
	}
	settings, err := configurationapp.NewCurrentToolkitSettingsResolver(
		schemas,
		nestedToolkits,
		expander,
		modelVisibility,
		configurations.unsecreter,
	)
	if err != nil {
		return nil, err
	}
	inputs, err := indexingapp.NewCurrentAuthoritativeInputResolver(
		toolkits,
		models,
		settings,
		configurations.publicProjectID,
	)
	if err != nil {
		return nil, err
	}

	bundleFactory, err := indexingapp.NewInputBundleFactory(indexingapp.InputProfile{
		Classification:        inputClassification,
		RequiredGrantAudience: inputGrantAudience,
	}, currentRuntimeID)
	if err != nil {
		return nil, err
	}
	jobs, err := repos.NewIndexIngestJobsRepository(pool, policy)
	if err != nil {
		return nil, fmt.Errorf("construct current index admission repository: %w", err)
	}
	admissions, err := indexingapp.NewAdmissionService(jobs, bundleFactory, nil, currentRuntimeID)
	if err != nil {
		return nil, err
	}
	start, err := indexingapp.NewStartService(inputs, admissions, currentRuntimeID)
	if err != nil {
		return nil, err
	}
	materializer, err := storage.NewCurrentConfigurationsMaterializer(configurations.unsecreter)
	if err != nil {
		return nil, err
	}
	indexMetaTimeouts, err := storage.NewCurrentIndexMetaTimeoutResolver(vaults)
	if err != nil {
		return nil, err
	}
	indexMeta, err := indexmetaapp.NewService(
		toolkits,
		settings,
		indexMetaTimeouts,
		pgvector.NewCurrentIndexMetaReader(),
	)
	if err != nil {
		return nil, err
	}

	return &currentIndexRuntime{
		start:        start,
		materializer: materializer,
		indexMeta:    indexMeta,
	}, nil
}

func currentRuntimeID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(value[:]), nil
}

var _ executionapp.IDGenerator = currentRuntimeID

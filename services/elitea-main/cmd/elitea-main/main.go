package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/health"
	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	configurationapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/configurations"
	indexingapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/indexing"
	indextypesapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/indextypes"
	projectinfoapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/projectinfo"
	v2projects "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/projects"
	socialapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/social"
	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	socialapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/social"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/authcomposition"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/authsvc"
	infradb "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db"
	dbrepos "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/legacyrbac"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/runtimecomposition"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		endpoint, err := healthcheckURL(os.LookupEnv)
		if err != nil {
			os.Exit(1)
		}
		client := &http.Client{Timeout: 2 * time.Second}
		resp, err := client.Get(endpoint)
		if err != nil || resp.StatusCode != 200 {
			os.Exit(1)
		}
		_ = resp.Body.Close()
		os.Exit(0)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, logger); err != nil {
		logger.Error("elitea-main stopped with an error", "err", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, logger *slog.Logger) (runErr error) {
	publicAddress, err := configuredHTTPAddress(os.LookupEnv)
	if err != nil {
		return err
	}
	devMode := os.Getenv("AUTH_DEV_MODE") == "true"
	bootstrapLegacySchema := os.Getenv("ELITEA_DEV_BOOTSTRAP_LEGACY_SCHEMA") == "true"
	if bootstrapLegacySchema && !devMode {
		return errors.New("ELITEA_DEV_BOOTSTRAP_LEGACY_SCHEMA requires AUTH_DEV_MODE=true")
	}

	// Database
	dbDSN := envOr("DATABASE_URL", "postgres://localhost:5432/elitea?sslmode=disable")
	pool, err := pgxpool.New(ctx, dbDSN)
	if err != nil {
		return fmt.Errorf("create database pool: %w", err)
	}
	defer pool.Close()

	// The unversioned legacy bootstrap exists only for an empty local developer
	// database. Production shared/tenant histories are owned by elitea-migrate.
	if bootstrapLegacySchema {
		if err := infradb.RunMigrations(ctx, pool); err != nil {
			return fmt.Errorf("bootstrap local legacy database schema: %w", err)
		}
	}

	var productionAuth *api.ProductionAuthRoutes
	var currentProjectList *v2projects.CurrentProjectListRoute
	var currentSocialAuthors *socialapi.CurrentAuthorsRoute
	var formGraph *authcomposition.FormGraph
	var authReadiness health.Checker
	var principalValidator apimw.PrincipalValidator
	var forwardedIdentityVerifier apimw.ForwardedIdentityPeerVerifier
	authConfigPath, authEnabled, err := configuredAuthConfigPath(os.LookupEnv)
	if err != nil {
		return err
	}
	if authEnabled {
		if err := pool.Ping(ctx); err != nil {
			return fmt.Errorf("verify authentication PostgreSQL dependency: %w", err)
		}
		authConfig, loadErr := authcomposition.Load(authConfigPath)
		if loadErr != nil {
			return fmt.Errorf("load production Form authentication: %w", loadErr)
		}
		formGraph, err = authcomposition.NewFormGraph(ctx, authConfig, authcomposition.FormGraphDependencies{
			PostgreSQL:           pool,
			MainRoutePublicRules: api.CurrentMainRoutePublicRules(),
		})
		if err != nil {
			return fmt.Errorf("compose production Form authentication: %w", err)
		}
		defer func() {
			if err := formGraph.Close(); runErr == nil && err != nil {
				runErr = fmt.Errorf("close production Form authentication: %w", err)
			}
		}()
		productionAuth, err = api.NewProductionAuthRoutes(formGraph.BrowserRoutes(), formGraph.MainForwardAuth())
		if err != nil {
			return fmt.Errorf("mount production Form authentication: %w", err)
		}
		principalValidator = authsvc.NewPrincipalValidator(pool)
		forwardedIdentityVerifier = formGraph.ForwardedIdentityVerifier()
		currentProjectList, err = v2projects.NewCurrentProjectListRoute(
			sqlcgen.New(pool),
			apimw.AuthConfig{
				Validator:                 formGraph,
				PrincipalValidator:        principalValidator,
				ForwardedIdentityVerifier: forwardedIdentityVerifier,
			},
			legacyrbac.NewPostgresResolver(pool),
		)
		if err != nil {
			return fmt.Errorf("compose current project-list route: %w", err)
		}
		socialAuthorsRepository, repositoryErr := dbrepos.NewCurrentSocialAuthorsRepository(pool)
		if repositoryErr != nil {
			return fmt.Errorf("compose current Social authors repository: %w", repositoryErr)
		}
		socialAuthorsService, serviceErr := socialapp.NewCurrentAuthorsService(socialAuthorsRepository)
		if serviceErr != nil {
			return fmt.Errorf("compose current Social authors service: %w", serviceErr)
		}
		currentSocialAuthors, err = socialapi.NewCurrentAuthorsRoute(
			socialAuthorsService,
			apimw.AuthConfig{
				Validator:                 formGraph,
				PrincipalValidator:        principalValidator,
				ForwardedIdentityVerifier: forwardedIdentityVerifier,
			},
			legacyrbac.NewPostgresResolver(pool),
		)
		if err != nil {
			return fmt.Errorf("compose current Social authors route: %w", err)
		}
		authReadiness = formGraph
		logger.Info("production Form authentication enabled")
	}

	currentProjectInfoSettings, err := currentProjectInfoConfigFromEnv(os.LookupEnv)
	if err != nil {
		return fmt.Errorf("load current project-info settings: %w", err)
	}
	if currentProjectInfoSettings.Enabled &&
		(formGraph == nil || principalValidator == nil || forwardedIdentityVerifier == nil) {
		return errors.New("ELITEA_PROJECT_INFO_ENABLED requires production authentication")
	}
	var currentProjectInfo *projectinfoapi.CurrentProjectInfoRoute
	if currentProjectInfoSettings.Enabled {
		currentProjectInfoRepository, repositoryErr :=
			projectinfoapi.NewCurrentProjectInfoRepository(pool)
		if repositoryErr != nil {
			return fmt.Errorf("compose current project-info repository: %w", repositoryErr)
		}
		currentProjectInfo, err = projectinfoapi.NewCurrentProjectInfoRoute(
			currentProjectInfoRepository,
			apimw.AuthConfig{
				Validator:                 formGraph,
				PrincipalValidator:        principalValidator,
				ForwardedIdentityVerifier: forwardedIdentityVerifier,
			},
			legacyrbac.NewPostgresResolver(pool),
		)
		if err != nil {
			return fmt.Errorf("compose current project-info route: %w", err)
		}
		logger.Info("current project-info route enabled")
	}

	currentIndexTypesSettings, err := currentIndexTypesConfigFromEnv(os.LookupEnv)
	if err != nil {
		return fmt.Errorf("load current index-types settings: %w", err)
	}
	if currentIndexTypesSettings.Enabled &&
		(formGraph == nil || principalValidator == nil || forwardedIdentityVerifier == nil) {
		return errors.New("ELITEA_INDEX_TYPES_ENABLED requires production authentication")
	}
	var currentIndexTypes *indextypesapi.CurrentIndexTypesRoute
	if currentIndexTypesSettings.Enabled {
		currentIndexTypesSnapshot, snapshotErr :=
			runtimecomposition.LoadPinnedCurrentIndexTypesSnapshot()
		if snapshotErr != nil {
			return fmt.Errorf("load pinned current index-types snapshot: %w", snapshotErr)
		}
		currentIndexTypes, err = indextypesapi.NewCurrentIndexTypesRoute(
			currentIndexTypesSnapshot,
			apimw.AuthConfig{
				Validator:                 formGraph,
				PrincipalValidator:        principalValidator,
				ForwardedIdentityVerifier: forwardedIdentityVerifier,
			},
			legacyrbac.NewPostgresResolver(pool),
		)
		if err != nil {
			return fmt.Errorf("compose current index-types route: %w", err)
		}
		logger.Info(
			"current index-types route enabled",
			"sdk_revision",
			currentIndexTypesSnapshot.SDKRevision(),
			"entry_count",
			currentIndexTypesSnapshot.EntryCount(),
		)
	}

	currentConfigurationsConfig, err := currentConfigurationsConfigFromEnv(os.LookupEnv)
	if err != nil {
		return fmt.Errorf("load current Configurations settings: %w", err)
	}
	if currentConfigurationsConfig.Enabled && (formGraph == nil || principalValidator == nil || forwardedIdentityVerifier == nil) {
		return errors.New("ELITEA_CONFIGURATIONS_ENABLED requires production authentication")
	}
	var currentConfigurationsRoot *runtimecomposition.CurrentConfigurationsRuntime
	var currentConfigurationRead http.Handler
	var currentConfigurationAvailable http.Handler
	var currentConfigurationTypes http.Handler
	var currentConfigurationMutation http.Handler
	var currentModelCatalog http.Handler
	var currentModelDefault http.Handler
	var currentLLMFacade http.Handler
	var currentLLMRoot *runtimecomposition.CurrentLLMRuntime
	if currentConfigurationsConfig.Enabled {
		currentConfigurationsRoot, err = runtimecomposition.NewCurrentConfigurationsRuntime(
			pool,
			currentConfigurationsConfig.PublicProjectID,
			currentConfigurationsConfig.VaultMasterKeyFile,
		)
		if err != nil {
			return fmt.Errorf("compose current Configurations services: %w", err)
		}
		defer currentConfigurationsRoot.Destroy()
		currentAuth := apimw.AuthConfig{
			Validator:                 formGraph,
			PrincipalValidator:        principalValidator,
			ForwardedIdentityVerifier: forwardedIdentityVerifier,
		}
		currentPermissions := legacyrbac.NewPostgresResolver(pool)
		currentConfigurationAvailable, err = configurationapi.NewCurrentAvailableRoute(
			currentConfigurationsRoot.AvailableCatalog(),
			currentAuth,
		)
		if err != nil {
			return fmt.Errorf("compose current Configurations available route: %w", err)
		}
		currentConfigurationRead, err = configurationapi.NewCurrentConfigurationReadRoute(
			currentConfigurationsRoot.Reader(),
			currentConfigurationsConfig.PublicProjectID,
			currentAuth,
			currentPermissions,
		)
		if err != nil {
			return fmt.Errorf("compose current Configurations read routes: %w", err)
		}
		currentConfigurationTypes, err = configurationapi.NewCurrentConfigurationTypesRoute(
			currentConfigurationsRoot.Types(),
			currentAuth,
			currentPermissions,
		)
		if err != nil {
			return fmt.Errorf("compose current Configurations types route: %w", err)
		}
		currentModelCatalog, err = configurationapi.NewCurrentModelCatalogRoute(
			currentConfigurationsRoot.ModelCatalog(),
			currentConfigurationsConfig.PublicProjectID,
			currentAuth,
			currentPermissions,
		)
		if err != nil {
			return fmt.Errorf("compose current Configurations model route: %w", err)
		}
		currentModelDefault, err = configurationapi.NewCurrentModelDefaultRoute(
			currentConfigurationsRoot.VaultWriter(),
			currentAuth,
			currentPermissions,
		)
		if err != nil {
			return fmt.Errorf("compose current Configurations model-default route: %w", err)
		}
		if currentConfigurationsConfig.LiteLLMBaseURL != "" {
			currentLLMRoot, err = runtimecomposition.NewCurrentLLMRuntime(
				pool,
				currentConfigurationsRoot,
				runtimecomposition.CurrentLLMConfig{
					BaseURL:       currentConfigurationsConfig.LiteLLMBaseURL,
					MasterKeyFile: currentConfigurationsConfig.LiteLLMMasterKeyFile,
				},
			)
			if err != nil {
				return fmt.Errorf("compose current LiteLLM facade: %w", err)
			}
			defer currentLLMRoot.Close()
			currentLLMFacade = apimw.Auth(currentAuth)(currentLLMRoot.Handler())
		}
		logger.Info("current Configurations services enabled", "public_project_id", currentConfigurationsConfig.PublicProjectID)
	}

	runtimeConfig, err := runtimecomposition.ConfigFromEnv(os.LookupEnv)
	if err != nil {
		return fmt.Errorf("load optional runtime configuration: %w", err)
	}
	if runtimeConfig.Enabled && (principalValidator == nil || forwardedIdentityVerifier == nil) {
		return errors.New("ELITEA_RUNTIME_ENABLED requires production authentication")
	}
	if err := validateRuntimeComposition(currentConfigurationsConfig, runtimeConfig); err != nil {
		return err
	}
	var runtimeRoot *runtimecomposition.Runtime
	var productionRuntime *api.ProductionRuntimeRoutes
	var currentIndexStart http.Handler
	var currentIndexCancel http.Handler
	var currentIndexMeta http.Handler
	if runtimeConfig.Enabled {
		runtimePools, openErr := openRuntimeDatabasePools(ctx, dbDSN, runtimecomposition.PhaseOneDatabasePoolLimits())
		if openErr != nil {
			return openErr
		}
		defer runtimePools.Close()
		var configurationLifecycleReconciler configurationapp.CurrentConfigurationLifecycleReconciler
		if currentConfigurationsConfig.MutationEnabled {
			configurationLifecycleReconciler, err = runtimecomposition.NewCurrentConfigurationLifecycleReconciler(
				runtimePools.Control,
				currentConfigurationsRoot,
				currentLLMRoot,
				currentConfigurationsConfig.AllowProjectOwnLLMs,
			)
			if err != nil {
				return fmt.Errorf("compose current Configurations lifecycle: %w", err)
			}
		}
		runtimeRoot, err = runtimecomposition.New(ctx, runtimeConfig, runtimecomposition.Dependencies{
			AdmissionPool:                    runtimePools.Admission,
			ControlPool:                      runtimePools.Control,
			OutputPool:                       runtimePools.Output,
			ReplayPool:                       runtimePools.Replay,
			TerminalEffectsPool:              runtimePools.TerminalEffects,
			ContentPool:                      runtimePools.Content,
			CurrentConfigurations:            currentConfigurationsRoot,
			ConfigurationLifecycleReconciler: configurationLifecycleReconciler,
			ActorTokenIssuer:                 formGraph,
			ProjectTokenValidator:            formGraph,
			PermissionResolver:               legacyrbac.NewPostgresResolver(pool),
			Logger:                           logger,
		})
		if err != nil {
			return fmt.Errorf("compose optional runtime: %w", err)
		}
		defer func() {
			if err := runtimeRoot.Close(); runErr == nil && err != nil {
				runErr = fmt.Errorf("close optional runtime: %w", err)
			}
		}()
		if currentConfigurationsConfig.MutationEnabled {
			mutationService, mutationErr := currentConfigurationsRoot.NewMutationService(
				runtimeRoot.CurrentSDKConfigurationValidator(),
			)
			if mutationErr != nil {
				return fmt.Errorf("compose current Configurations mutation service: %w", mutationErr)
			}
			currentConfigurationMutation, mutationErr = configurationapi.NewCurrentConfigurationMutationRoute(
				mutationService,
				apimw.AuthConfig{
					Validator:                 formGraph,
					PrincipalValidator:        principalValidator,
					ForwardedIdentityVerifier: forwardedIdentityVerifier,
				},
				legacyrbac.NewPostgresResolver(pool),
			)
			if mutationErr != nil {
				return fmt.Errorf("compose current Configurations mutation routes: %w", mutationErr)
			}
		}
		publicRoutes := runtimeRoot.PublicRoutes()
		productionRuntime, err = api.NewProductionRuntimeRoutes(
			publicRoutes.Validation,
			publicRoutes.ExecutionEvents,
			principalValidator,
			forwardedIdentityVerifier,
		)
		if err != nil {
			return fmt.Errorf("compose production runtime HTTP routes: %w", err)
		}
		if publicRoutes.IndexStart != nil {
			currentIndexStart, err = indexingapi.NewCurrentIndexStartRoute(
				publicRoutes.IndexStart,
				apimw.AuthConfig{
					Validator:                 formGraph,
					PrincipalValidator:        principalValidator,
					ForwardedIdentityVerifier: forwardedIdentityVerifier,
				},
				legacyrbac.NewPostgresResolver(pool),
			)
			if err != nil {
				return fmt.Errorf("compose current index-start route: %w", err)
			}
		}
		if publicRoutes.IndexCancel != nil {
			currentIndexCancel, err = indexingapi.NewCurrentIndexCancelRoute(
				publicRoutes.IndexCancel,
				apimw.AuthConfig{
					Validator:                 formGraph,
					PrincipalValidator:        principalValidator,
					ForwardedIdentityVerifier: forwardedIdentityVerifier,
				},
				legacyrbac.NewPostgresResolver(pool),
			)
			if err != nil {
				return fmt.Errorf("compose current index-cancel route: %w", err)
			}
		}
		if publicRoutes.IndexMeta != nil {
			currentIndexMeta, err = indexingapi.NewCurrentIndexMetaRoute(
				publicRoutes.IndexMeta,
				apimw.AuthConfig{
					Validator:                 formGraph,
					PrincipalValidator:        principalValidator,
					ForwardedIdentityVerifier: forwardedIdentityVerifier,
				},
				legacyrbac.NewPostgresResolver(pool),
			)
			if err != nil {
				return fmt.Errorf("compose current index-meta route: %w", err)
			}
		}
		slog.Info("production runtime enabled", "control_addr", runtimeConfig.ControlAddress, "output_addr", runtimeConfig.OutputAddress, "content_addr", runtimeConfig.ContentAddress)
	}

	r := api.NewRouter(api.RouterConfig{
		HealthDeps: health.Deps{
			DB:    &poolChecker{pool: pool},
			Redis: authReadiness,
		},
		ProductionAuth:                productionAuth,
		ProductionRuntime:             productionRuntime,
		CurrentProjectInfo:            currentProjectInfo,
		CurrentIndexTypes:             currentIndexTypes,
		CurrentProjectList:            currentProjectList,
		CurrentSocialAuthors:          currentSocialAuthors,
		CurrentConfigurationAvailable: currentConfigurationAvailable,
		CurrentConfigurationRead:      currentConfigurationRead,
		CurrentConfigurationTypes:     currentConfigurationTypes,
		CurrentConfigurationMutation:  currentConfigurationMutation,
		CurrentIndexStart:             currentIndexStart,
		CurrentIndexCancel:            currentIndexCancel,
		CurrentIndexMeta:              currentIndexMeta,
		CurrentModelCatalog:           currentModelCatalog,
		CurrentModelDefault:           currentModelDefault,
		CurrentLLMFacade:              currentLLMFacade,
	})

	srv := &http.Server{
		Addr: publicAddress,
		// Socket.IO remains unmounted until its legacy connection
		// authentication, project-membership checks, room authorization, and
		// per-event permission contract are implemented. Mounting the current
		// prototype would expose cross-tenant rooms and execution events.
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	slog.Info("starting server", "addr", srv.Addr, "runtime_enabled", runtimeRoot != nil)
	var runtimeLifecycleRoot runtimeLifecycle
	if runtimeRoot != nil {
		runtimeLifecycleRoot = runtimeRoot
	}
	if err := serveApplication(ctx, srv, runtimeLifecycleRoot, 15*time.Second); err != nil {
		return err
	}
	slog.Info("server stopped")
	return nil
}

const maxAuthConfigPathBytes = 4096

func configuredAuthConfigPath(lookup func(string) (string, bool)) (string, bool, error) {
	if lookup == nil {
		return "", false, errors.New("authentication configuration environment lookup is required")
	}
	path, present := lookup("ELITEA_AUTH_CONFIG_FILE")
	if !present {
		return "", false, nil
	}
	if path == "" || len(path) > maxAuthConfigPathBytes || path != strings.TrimSpace(path) || strings.ContainsAny(path, "\r\n\x00") {
		return "", false, errors.New("ELITEA_AUTH_CONFIG_FILE is invalid")
	}
	return path, true, nil
}

type publicServerLifecycle interface {
	ListenAndServe() error
	Shutdown(context.Context) error
}

type runtimeLifecycle interface {
	Run(context.Context) error
	Shutdown(context.Context) error
}

var ErrApplicationDrainTimeout = errors.New("application drain deadline exceeded")

func serveApplication(ctx context.Context, public publicServerLifecycle, runtime runtimeLifecycle, shutdownTimeout time.Duration) error {
	if ctx == nil || public == nil || shutdownTimeout <= 0 {
		return errors.New("application lifecycle dependencies are incomplete")
	}
	type result struct {
		name string
		err  error
	}
	componentCount := 1
	results := make(chan result, 2)
	go func() { results <- result{name: "public HTTP", err: public.ListenAndServe()} }()
	if runtime != nil {
		componentCount++
		// Runtime cancellation is owned by Shutdown below so the same drain
		// deadline reaches its publisher and private listeners before pools close.
		go func() { results <- result{name: "production runtime", err: runtime.Run(context.Background())} }()
	}

	var primary *result
	select {
	case first := <-results:
		primary = &first
	case <-ctx.Done():
	}
	causes := make([]error, 0, componentCount+1)
	if primary != nil {
		if primary.err == nil {
			causes = append(causes, fmt.Errorf("%s stopped unexpectedly", primary.name))
		} else {
			causes = append(causes, fmt.Errorf("%s failed: %w", primary.name, primary.err))
		}
	}

	drainCtx, drainCancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer drainCancel()
	shutdownResults := make(chan result, 2)
	go func() { shutdownResults <- result{name: "public HTTP", err: public.Shutdown(drainCtx)} }()
	shutdownPending := 1
	if runtime != nil {
		shutdownPending++
		go func() { shutdownResults <- result{name: "production runtime", err: runtime.Shutdown(drainCtx)} }()
	}
	remainingComponents := componentCount
	if primary != nil {
		remainingComponents--
	}
	drainDone := drainCtx.Done()
	deadlineObserved := false
	for remainingComponents > 0 || shutdownPending > 0 {
		select {
		case drained := <-results:
			remainingComponents--
			if drained.err == nil {
				causes = append(causes, fmt.Errorf("%s stopped unexpectedly", drained.name))
				continue
			}
			if errors.Is(drained.err, http.ErrServerClosed) || errors.Is(drained.err, context.Canceled) || errors.Is(drained.err, context.DeadlineExceeded) {
				continue
			}
			causes = append(causes, fmt.Errorf("%s failed during drain: %w", drained.name, drained.err))
		case stopped := <-shutdownResults:
			shutdownPending--
			if stopped.err != nil && !errors.Is(stopped.err, context.Canceled) && !errors.Is(stopped.err, context.DeadlineExceeded) {
				causes = append(causes, fmt.Errorf("shutdown %s: %w", stopped.name, stopped.err))
			}
		case <-drainDone:
			deadlineObserved = true
			drainDone = nil
			causes = append(causes, fmt.Errorf("%w after %s", ErrApplicationDrainTimeout, shutdownTimeout))
		}
	}
	if deadlineObserved && !errors.Is(errors.Join(causes...), ErrApplicationDrainTimeout) {
		causes = append(causes, fmt.Errorf("%w after %s", ErrApplicationDrainTimeout, shutdownTimeout))
	}
	return errors.Join(causes...)
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

type poolChecker struct {
	pool *pgxpool.Pool
}

func (p *poolChecker) Ping(ctx context.Context) error {
	return p.pool.Ping(ctx)
}

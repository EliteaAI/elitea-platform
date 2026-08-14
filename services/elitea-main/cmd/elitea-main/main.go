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

	"github.com/EliteaAI/elitea-platform/libs/go/observability"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/adminui"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/health"
	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	agentexecutionapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/agentexecution"
	v2analytics "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/analytics"
	applicationskillsapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/applicationskills"
	v2auth "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/auth"
	configurationapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/configurations"
	v2convs "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/conversations"
	v2folders "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/folders"
	indexingapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/indexing"
	indextypesapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/indextypes"
	notificationsapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/notifications"
	projectinfoapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/projectinfo"
	v2projects "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/projects"
	promptcontextreadsapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/promptcontextreads"
	v2skills "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/skills"
	socialapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/social"
	v2tags "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/tags"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/webhook"
	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	socialapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/social"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/authcomposition"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/applications"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/authsvc"
	infradb "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db"
	dbrepos "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/legacyrbac"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/llmproxy"
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

// developmentFlagsFromEnv validates the two development-only environment
// flags and reports whether the legacy-schema bootstrap was requested. It
// reads the environment through the injected getenv and has NO side effects,
// so its invariants are testable without executing startup — calling run() to
// exercise them would open database pools, contact the object store, and bind
// the public HTTP port.
//
// AUTH_DEV_MODE was an unauthenticated-admin bypass (ADR-0017). It is gone, so
// the variable is inert — but an operator who still sets it to "true" believes
// authentication is disabled and may have deployed accordingly, so refuse to
// start rather than ignoring it silently. A lingering "false" is harmless and
// stays tolerated.
//
// The legacy-schema bootstrap is a developer-machine convenience that runs the
// unversioned schema against an empty local database. It needs a "this is a
// developer machine" marker, not an authentication bypass, so it no longer
// cross-checks AUTH_DEV_MODE. It is self-gating and fail-closed: absent an
// explicit opt-in, nothing runs.
func developmentFlagsFromEnv(getenv func(string) string) (bootstrapLegacySchema bool, err error) {
	if getenv("AUTH_DEV_MODE") == "true" {
		return false, errors.New("AUTH_DEV_MODE=true is no longer supported: the development authentication bypass was removed (ADR-0017). Authenticate via OIDC or an API token and remove this variable")
	}

	bootstrapLegacySchema = getenv("ELITEA_DEV_BOOTSTRAP_LEGACY_SCHEMA") == "true"
	if bootstrapLegacySchema {
		// Production shared/tenant histories are owned by elitea-migrate. A
		// deployment that has configured any real authentication mode is not a
		// developer machine, and must never bootstrap the legacy schema.
		for _, configured := range []string{"APPLICATION_SECRET_KEY", "OIDC_ISSUER_URL", "ELITEA_AUTH_CONFIG_FILE"} {
			if getenv(configured) != "" {
				return false, fmt.Errorf("ELITEA_DEV_BOOTSTRAP_LEGACY_SCHEMA is a local-development flag and must not be set when %s is configured", configured)
			}
		}
	}
	return bootstrapLegacySchema, nil
}

func run(ctx context.Context, logger *slog.Logger) (runErr error) {
	publicAddress, err := configuredHTTPAddress(os.LookupEnv)
	if err != nil {
		return err
	}
	bootstrapLegacySchema, err := developmentFlagsFromEnv(os.Getenv)
	if err != nil {
		return err
	}

	// Observability (issue #250): exports elitea-main's own request spans to
	// the same OTLP collector internal/api/v2/tracing proxies UI/worker
	// traces to, so the ingest pipeline is self-verifying — every request
	// this process serves produces a span an operator can see land in the
	// collector, with no separate "did tracing actually work" check needed.
	obsProvider, err := observability.New(ctx, observability.ConfigFromEnv("elitea-main", ""))
	if err != nil {
		return fmt.Errorf("initialize observability: %w", err)
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := obsProvider.Shutdown(shutdownCtx); runErr == nil && err != nil {
			runErr = fmt.Errorf("shut down observability: %w", err)
		}
	}()

	// Database
	dbDSN := envOr("DATABASE_URL", "postgres://localhost:5432/elitea?sslmode=disable")
	pool, err := openDatabasePool(ctx, dbDSN, os.LookupEnv)
	if err != nil {
		return err
	}
	defer pool.Close()

	// Object store. Production remains fail-closed: when the capability is
	// enabled, startup requires a working S3/Azure/GCS backend. The mixed
	// migration deployment explicitly disables these still-incomplete Go
	// routes and keeps the current Centry artifacts capability authoritative;
	// this avoids adding a second storage service or inventing a filesystem
	// compatibility backend.
	var objectStore storage.ObjectStore
	if os.Getenv("ELITEA_ARTIFACTS_ENABLED") != "false" {
		storageCfg, err := storage.ConfigFromEnv(os.LookupEnv)
		if err != nil {
			return fmt.Errorf("load storage configuration: %w", err)
		}
		objectStore, err = newObjectStore(ctx, storageCfg)
		if err != nil {
			return fmt.Errorf("create object store: %w", err)
		}
		if err := objectStoreReadinessProbe(ctx, objectStore); err != nil {
			return fmt.Errorf("object store readiness probe: %w", err)
		}
		if err := configureObjectStoreRetentionLifecycle(ctx, objectStore); err != nil {
			return fmt.Errorf("configure object store retention lifecycle: %w", err)
		}
	} else {
		logger.Info("Go artifacts capability disabled; current Centry artifacts routes remain authoritative")
	}

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
	var currentSocialAvatar *socialapi.CurrentAvatarRoute
	var currentNotifications *notificationsapi.CurrentNotificationAPIRoute
	var currentNotificationEvents *notificationsapi.CurrentNotificationEventsRoute
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
		socialAvatarRepository, repositoryErr := dbrepos.NewCurrentSocialAvatarRepository(pool)
		if repositoryErr != nil {
			return fmt.Errorf("compose current Social avatar repository: %w", repositoryErr)
		}
		currentSocialAvatar, err = socialapi.NewCurrentAvatarRoute(
			socialAvatarRepository,
			objectStore,
			apimw.AuthConfig{
				Validator:                 formGraph,
				PrincipalValidator:        principalValidator,
				ForwardedIdentityVerifier: forwardedIdentityVerifier,
			},
			legacyrbac.NewPostgresResolver(pool),
		)
		if err != nil {
			return fmt.Errorf("compose current Social avatar route: %w", err)
		}
		notificationRepository, repositoryErr := dbrepos.NewCurrentNotificationRepository(pool)
		if repositoryErr != nil {
			return fmt.Errorf("compose current notification repository: %w", repositoryErr)
		}
		currentNotifications, err = notificationsapi.NewCurrentNotificationAPIRoute(
			notificationRepository,
			apimw.AuthConfig{
				Validator:                 formGraph,
				PrincipalValidator:        principalValidator,
				ForwardedIdentityVerifier: forwardedIdentityVerifier,
			},
			legacyrbac.NewPostgresResolver(pool),
		)
		if err != nil {
			return fmt.Errorf("compose current notification API route: %w", err)
		}
		notificationEventsRepository, repositoryErr :=
			dbrepos.NewCurrentNotificationEventRepository(pool)
		if repositoryErr != nil {
			return fmt.Errorf("compose current notification events repository: %w", repositoryErr)
		}
		currentNotificationEvents, err = notificationsapi.NewCurrentNotificationEventsRoute(
			notificationEventsRepository,
			apimw.AuthConfig{
				Validator:                 formGraph,
				PrincipalValidator:        principalValidator,
				ForwardedIdentityVerifier: forwardedIdentityVerifier,
			},
			legacyrbac.NewPostgresResolver(pool),
		)
		if err != nil {
			return fmt.Errorf("compose current notification events route: %w", err)
		}
		authReadiness = formGraph
		logger.Info("production Form authentication enabled")
	}

	// Wire OIDC browser-session authentication when OIDC_ISSUER_URL is set.
	// SessionHandler and OIDCHandler are independent of the FormGraph path and
	// can coexist with it (both populate RouterConfig.Auth) — but only because
	// internal/api/production_router.go now resolves the /forward-auth prefix to
	// ONE owner. Composing both used to panic chi at startup; see the comment
	// there before assuming any second browser-auth plane can simply be added.
	var oidcSessionHandler *v2auth.SessionHandler
	var oidcOIDCHandler *v2auth.OIDCHandler
	oidcCfg, err := v2auth.OIDCConfigFromEnv()
	if err != nil {
		return fmt.Errorf("load OIDC configuration: %w", err)
	}
	if oidcCfg != nil {
		appSecretKey := os.Getenv("APPLICATION_SECRET_KEY")
		if appSecretKey == "" {
			return errors.New("APPLICATION_SECRET_KEY is required when OIDC_ISSUER_URL is set")
		}
		oidcSessionHandler = v2auth.NewSessionHandler(pool, appSecretKey)
		oidcOIDCHandler, err = v2auth.NewOIDCHandler(ctx, oidcCfg, pool, appSecretKey)
		if err != nil {
			return fmt.Errorf("initialize OIDC handler: %w", err)
		}
		logger.Info("OIDC authentication enabled", "issuer", oidcCfg.IssuerURL)
	}

	// Wire currentProjectList with OIDC-only auth when formGraph is absent.
	// formGraph (ELITEA_AUTH_CONFIG_FILE) wires it above with full validators;
	// OIDC-only deployments (E2E stack) only have session-cookie auth.
	if currentProjectList == nil && oidcSessionHandler != nil {
		var oidcProjectListErr error
		currentProjectList, oidcProjectListErr = v2projects.NewCurrentProjectListRoute(
			sqlcgen.New(pool),
			apimw.AuthConfig{
				SessionSecret: os.Getenv("APPLICATION_SECRET_KEY"),
			},
			legacyrbac.NewPostgresResolver(pool),
		)
		if oidcProjectListErr != nil {
			return fmt.Errorf("compose OIDC-only project-list route: %w", oidcProjectListErr)
		}
		logger.Info("project-list route enabled (OIDC-only auth)")
	}

	// Same shape, same reason, for the notification SSE stream (#152). This is
	// the route `useNotificationsSSE` opens on every page that mounts the
	// sidebar — GET /api/v2/notifications/events/prompt_lib/{projectID} — and
	// it was composed ONLY inside the `authEnabled` (ELITEA_AUTH_CONFIG_FILE)
	// branch above. OIDC-only deployments, which is what the E2E stack and any
	// SSO-only install are, therefore 404'd it on every load, and the client
	// degraded to its list-query fallback with only a console warning to show
	// for it. That 404 was previously attributed to RouterConfig.EventSource /
	// RedisClient being unwired; those gate a DIFFERENT route
	// (/api/v2/events/prompt_lib/{projectID}, no client) and fixing them alone
	// would not have moved this one.
	if currentNotificationEvents == nil && oidcSessionHandler != nil {
		notificationEventsRepository, repositoryErr :=
			dbrepos.NewCurrentNotificationEventRepository(pool)
		if repositoryErr != nil {
			return fmt.Errorf("compose OIDC-only notification events repository: %w", repositoryErr)
		}
		var oidcNotificationEventsErr error
		currentNotificationEvents, oidcNotificationEventsErr = notificationsapi.NewCurrentNotificationEventsRoute(
			notificationEventsRepository,
			apimw.AuthConfig{
				SessionSecret: os.Getenv("APPLICATION_SECRET_KEY"),
			},
			legacyrbac.NewPostgresResolver(pool),
		)
		if oidcNotificationEventsErr != nil {
			return fmt.Errorf("compose OIDC-only notification events route: %w", oidcNotificationEventsErr)
		}
		logger.Info("notification events route enabled (OIDC-only auth)")
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

	currentApplicationSkillsSettings, err :=
		currentApplicationSkillsConfigFromEnv(os.LookupEnv)
	if err != nil {
		return fmt.Errorf("load current application-skills settings: %w", err)
	}
	if currentApplicationSkillsSettings.Enabled &&
		(formGraph == nil || principalValidator == nil || forwardedIdentityVerifier == nil) {
		return errors.New("ELITEA_APPLICATION_SKILLS_ENABLED requires production authentication")
	}
	var currentApplicationSkills *applicationskillsapi.CurrentApplicationSkillsRoute
	if currentApplicationSkillsSettings.Enabled {
		currentApplicationSkillsRepository, repositoryErr :=
			applicationskillsapi.NewCurrentApplicationSkillsRepository(pool)
		if repositoryErr != nil {
			return fmt.Errorf(
				"compose current application-skills repository: %w",
				repositoryErr,
			)
		}
		currentApplicationSkills, err =
			applicationskillsapi.NewCurrentApplicationSkillsRoute(
				currentApplicationSkillsRepository,
				apimw.AuthConfig{
					Validator:                 formGraph,
					PrincipalValidator:        principalValidator,
					ForwardedIdentityVerifier: forwardedIdentityVerifier,
				},
				legacyrbac.NewPostgresResolver(pool),
			)
		if err != nil {
			return fmt.Errorf("compose current application-skills route: %w", err)
		}
		logger.Info("current application-skills route enabled")
	}

	currentConfigurationsConfig, err := currentConfigurationsConfigFromEnv(os.LookupEnv)
	if err != nil {
		return fmt.Errorf("load current Configurations settings: %w", err)
	}
	currentPromptContextReadsSettings, err :=
		currentPromptContextReadsConfigFromEnv(os.LookupEnv)
	if err != nil {
		return fmt.Errorf("load current prompt-context read settings: %w", err)
	}
	if currentPromptContextReadsSettings.Enabled && !currentConfigurationsConfig.Enabled {
		return errors.New("ELITEA_PROMPT_CONTEXT_READS_ENABLED requires ELITEA_CONFIGURATIONS_ENABLED=true")
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
	var currentPromptContextReads *promptcontextreadsapi.CurrentRoutes
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
			// The browser's only credential (#292), same reasoning as the
			// agent-start route above. These are the configuration reads the
			// UI makes on every chat page — the model catalogue among them —
			// and without a session they answered 401 to the product's own
			// model picker, which then rendered empty. A user could not choose
			// a model, so the turn was rejected for not naming one: a chat that
			// cannot run, with every configuration row present and correct.
			//
			// Reads only widen to a session; each route still resolves
			// permissions through currentPermissions below.
			SessionSecret: os.Getenv("APPLICATION_SECRET_KEY"),
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
		// No /llm data plane is composed here. This block used to build the
		// LiteLLM facade (an authenticated reverse proxy plus an administration
		// client holding the proxy's master key) whenever ELITEA_LITELLM_BASE_URL
		// was set. The Bifrost gateway replaced it: it resolves each project's
		// provider credentials and model definitions from
		// p_{projectID}.configuration itself, so Main has nothing to proxy on
		// its behalf beyond the mTLS gateway proxy composed on LLM_GATEWAY_URL
		// below, which is the sole /llm backend.
		if currentPromptContextReadsSettings.Enabled {
			chatConfigReader, readerErr :=
				promptcontextreadsapi.NewCurrentChatConfigVaultReader(
					currentConfigurationsRoot.VaultLoader(),
				)
			if readerErr != nil {
				return fmt.Errorf("compose current chat configuration reader: %w", readerErr)
			}
			projectContextReader, readerErr :=
				promptcontextreadsapi.NewCurrentProjectContextRepository(pool)
			if readerErr != nil {
				return fmt.Errorf("compose current project-context reader: %w", readerErr)
			}
			currentPromptContextReads, err = promptcontextreadsapi.NewCurrentRoutes(
				chatConfigReader,
				projectContextReader,
				currentAuth,
				currentPermissions,
			)
			if err != nil {
				return fmt.Errorf("compose current prompt-context read routes: %w", err)
			}
			logger.Info("current prompt-context read routes enabled")
		}
		logger.Info("current Configurations services enabled", "public_project_id", currentConfigurationsConfig.PublicProjectID)
	}

	// The chat-config read has to be composable WITHOUT the Configurations
	// chain (#194). Its only registration used to sit inside the deleted
	// `ChatService` gate on the prototype eliteacore handler, and the current
	// implementation above is reachable only under
	// ELITEA_PROMPT_CONTEXT_READS_ENABLED, which itself requires
	// ELITEA_CONFIGURATIONS_ENABLED + ELITEA_AI_PROJECT_ID. Neither of those
	// is set in any deployment, so
	// `GET /api/v2/elitea_core/chat_config/prompt_lib/{projectID}` has
	// answered 404 everywhere for as long as the gate has existed — while
	// `features/artifacts`' chatConfigApi has been querying it on every
	// artifacts page load and silently falling back to a 150 MB default.
	//
	// Turning the chain on was rejected as the fix for the same reason #131
	// rejected it: the flag gates composition, but the router every
	// environment actually runs is the compatibility router, and enabling the
	// chain would additionally light up ~10 unrelated Configurations/LLM
	// routes that are deliberately dark. The reader itself needs nothing from
	// that chain — only a *pgxpool.Pool and the optional vault master key —
	// so it is composed here instead, exactly like the OIDC-only project-list
	// and notification-event routes above.
	//
	// CurrentRoutes is an atomic pair, so the project-context read is
	// constructed alongside it. Which PATHS become reachable is decided at the
	// router: the compatibility router (the one every deployment gets) mounts
	// only the chat_config path, because that is #194's half and the
	// project-context path is already served there by the prototype eliteacore
	// handler. The production router — which NewRouter never reaches while any
	// prototype field is set, i.e. in no deployment today — mounts both, so
	// composing here does make the current project-context implementation
	// reachable THERE where the flag chain previously left it dark.
	if currentPromptContextReads == nil && (formGraph != nil || oidcSessionHandler != nil) {
		// Reuse the Configurations runtime's loader when it exists, so a
		// deployment that DOES set ELITEA_VAULT_MASTER_KEY_FILE keeps reading
		// master-key-wrapped project keys. Without that chain the master-key
		// file cannot be expressed at all today (currentConfigurationsConfig
		// rejects it unless ELITEA_CONFIGURATIONS_ENABLED=true), so the
		// unwrapped loader is the only reachable shape there — which is also
		// the shape centry writes when SECRETS_MASTER_KEY is unset.
		chatConfigVaults := currentConfigurationsRoot.VaultLoader()
		if chatConfigVaults == nil {
			unwrapped, vaultErr := storage.NewPostgresSecretVaultLoader(pool, nil)
			if vaultErr != nil {
				return fmt.Errorf("compose ungated chat configuration vault loader: %w", vaultErr)
			}
			defer unwrapped.Destroy()
			chatConfigVaults = unwrapped
		}
		chatConfigReader, readerErr :=
			promptcontextreadsapi.NewCurrentChatConfigVaultReader(chatConfigVaults)
		if readerErr != nil {
			return fmt.Errorf("compose ungated chat configuration reader: %w", readerErr)
		}
		projectContextReader, readerErr :=
			promptcontextreadsapi.NewCurrentProjectContextRepository(pool)
		if readerErr != nil {
			return fmt.Errorf("compose ungated project-context reader: %w", readerErr)
		}
		// authsvc.NewPrincipalValidator(pool) is built here rather than reusing
		// the `principalValidator` variable because that variable is nil in
		// exactly the branch that needs it: it is only assigned inside the
		// `authEnabled` block, which is also the only place formGraph is set.
		// See chatConfigAuthConfig for why nil is not survivable (#301).
		currentPromptContextReads, err = promptcontextreadsapi.NewCurrentRoutes(
			chatConfigReader,
			projectContextReader,
			chatConfigAuthConfig(
				formGraph,
				principalValidator,
				forwardedIdentityVerifier,
				authsvc.NewPrincipalValidator(pool),
				os.Getenv("APPLICATION_SECRET_KEY"),
			),
			legacyrbac.NewPostgresResolver(pool),
		)
		if err != nil {
			return fmt.Errorf("compose ungated chat configuration route: %w", err)
		}
		logger.Info("chat-config route enabled (ungated)")
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
	var currentAgentStart http.Handler
	var currentAgentCancel http.Handler
	var currentIndexCancel http.Handler
	var currentIndexMeta http.Handler
	var currentIndexMetaDelete http.Handler
	var currentIndexScheduleUpdate http.Handler
	var currentIndexScheduleDelete http.Handler
	if runtimeConfig.Enabled {
		databasePoolLimits, limitsErr := runtimecomposition.DatabasePoolLimitsFromEnv(os.LookupEnv)
		if limitsErr != nil {
			return fmt.Errorf("load runtime database pool limits: %w", limitsErr)
		}
		runtimePools, openErr := openRuntimeDatabasePools(ctx, dbDSN, databasePoolLimits)
		if openErr != nil {
			return openErr
		}
		defer runtimePools.Close()
		var configurationLifecycleReconciler configurationapp.CurrentConfigurationLifecycleReconciler
		if currentConfigurationsConfig.MutationEnabled {
			// No LLM runtime here: the lifecycle is database-side. It once
			// pushed every credential and model into the LiteLLM proxy, which
			// meant configuration mutation could not run without that proxy.
			// The Bifrost gateway pulls the same configuration rows, so the
			// lifecycle now only resolves references and writes status_ok.
			configurationLifecycleReconciler, err = runtimecomposition.NewCurrentConfigurationLifecycleReconciler(
				runtimePools.Control,
				currentConfigurationsRoot,
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
			ProjectSystemTokenSource:         formGraph,
			PermissionResolver:               legacyrbac.NewPostgresResolver(pool),
			Logger:                           logger,
			ObjectStore:                      objectStore,
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
			// The browser's only credential for the events stream: an
			// EventSource sends a cookie and nothing else (#93). Same secret
			// the rest of the router uses, so a session is accepted here on
			// exactly the terms it is accepted everywhere else.
			os.Getenv("APPLICATION_SECRET_KEY"),
		)
		if err != nil {
			return fmt.Errorf("compose production runtime HTTP routes: %w", err)
		}
		// The browser's credential for the runtime routes the WEB APP calls
		// directly (#93 Surface A): the index list, an index run and its
		// cancel, and the chat stop button. Each was composed for forwarded
		// identity alone, so every one of them answered `401 missing
		// authorization header` to the product's own UI while working for the
		// worker — the same shape as #291 on the chat start route, and the
		// reason Surface A's REST path could not be exercised from a browser
		// at all.
		//
		// Additive: the peer verifier and principal validator are unchanged,
		// so the worker and the forward-auth edge authenticate exactly as
		// before, and each route still resolves permissions through the RBAC
		// resolver it is given.
		browserRuntimeAuth := apimw.AuthConfig{
			Validator:                 formGraph,
			PrincipalValidator:        principalValidator,
			ForwardedIdentityVerifier: forwardedIdentityVerifier,
			SessionSecret:             os.Getenv("APPLICATION_SECRET_KEY"),
		}
		if publicRoutes.IndexStart != nil {
			currentIndexStart, err = indexingapi.NewCurrentIndexStartRoute(
				publicRoutes.IndexStart,
				browserRuntimeAuth,
				legacyrbac.NewPostgresResolver(pool),
			)
			if err != nil {
				return fmt.Errorf("compose current index-start route: %w", err)
			}
		}
		if publicRoutes.AgentStart != nil {
			currentAgentStart, err = agentexecutionapi.NewCurrentApplicationStartRoute(
				publicRoutes.AgentStart,
				apimw.AuthConfig{
					Validator:                 formGraph,
					PrincipalValidator:        principalValidator,
					ForwardedIdentityVerifier: forwardedIdentityVerifier,
					// The browser's only credential (#291). This handler serves
					// START, REGENERATE and CONTINUE (production_router.go),
					// i.e. every write path a chat conversation has, and the UI
					// authenticates with a session cookie and nothing else — no
					// bearer, no forwarded identity. Without this the product's
					// own chat cannot start a turn while every server-side hop
					// can, the same shape #93 found on the events stream, which
					// this is the other half of: the UI could read a stream it
					// was not allowed to open.
					//
					// It does not widen what a caller may DO. The route still
					// resolves permissions through legacyrbac below, so
					// membership and `models.chat.messages.create` are checked
					// exactly as before; this only lets a session prove who it
					// is. A deployment reached solely through a forward-auth
					// edge is unaffected — it simply never presents a cookie.
					SessionSecret: os.Getenv("APPLICATION_SECRET_KEY"),
				},
				legacyrbac.NewPostgresResolver(pool),
			)
			if err != nil {
				return fmt.Errorf("compose current agent-start route: %w", err)
			}
		}
		if publicRoutes.AgentCancel != nil {
			currentAgentCancel, err = agentexecutionapi.NewCurrentAgentCancelRoute(
				publicRoutes.AgentCancel,
				browserRuntimeAuth,
				legacyrbac.NewPostgresResolver(pool),
			)
			if err != nil {
				return fmt.Errorf("compose current agent-cancel route: %w", err)
			}
		}
		if publicRoutes.IndexCancel != nil {
			currentIndexCancel, err = indexingapi.NewCurrentIndexCancelRoute(
				publicRoutes.IndexCancel,
				browserRuntimeAuth,
				legacyrbac.NewPostgresResolver(pool),
			)
			if err != nil {
				return fmt.Errorf("compose current index-cancel route: %w", err)
			}
		}
		if publicRoutes.IndexMeta != nil {
			currentIndexMeta, err = indexingapi.NewCurrentIndexMetaRoute(
				publicRoutes.IndexMeta,
				browserRuntimeAuth,
				legacyrbac.NewPostgresResolver(pool),
			)
			if err != nil {
				return fmt.Errorf("compose current index-meta route: %w", err)
			}
		}
		if publicRoutes.IndexMetaDelete != nil {
			currentIndexMetaDelete, err =
				indexingapi.NewCurrentIndexMetaDeleteRoute(
					publicRoutes.IndexMetaDelete,
					browserRuntimeAuth,
					legacyrbac.NewPostgresResolver(pool),
				)
			if err != nil {
				return fmt.Errorf(
					"compose current index metadata delete route: %w",
					err,
				)
			}
		}
		if publicRoutes.IndexScheduleUpdate != nil {
			currentIndexScheduleUpdate, err =
				indexingapi.NewCurrentIndexScheduleRoute(
					publicRoutes.IndexScheduleUpdate,
					apimw.AuthConfig{
						Validator:                 formGraph,
						PrincipalValidator:        principalValidator,
						ForwardedIdentityVerifier: forwardedIdentityVerifier,
					},
					legacyrbac.NewPostgresResolver(pool),
				)
			if err != nil {
				return fmt.Errorf(
					"compose current index schedule update route: %w",
					err,
				)
			}
		}
		if publicRoutes.IndexScheduleDelete != nil {
			currentIndexScheduleDelete, err =
				indexingapi.NewCurrentIndexScheduleDeleteRoute(
					publicRoutes.IndexScheduleDelete,
					apimw.AuthConfig{
						Validator:                 formGraph,
						PrincipalValidator:        principalValidator,
						ForwardedIdentityVerifier: forwardedIdentityVerifier,
					},
					legacyrbac.NewPostgresResolver(pool),
				)
			if err != nil {
				return fmt.Errorf(
					"compose current index schedule delete route: %w",
					err,
				)
			}
		}
		slog.Info("production runtime enabled", "control_addr", runtimeConfig.ControlAddress, "output_addr", runtimeConfig.OutputAddress, "content_addr", runtimeConfig.ContentAddress)
	}

	// BF0.9c: compose the mTLS streaming reverse proxy to elitea-llm-gateway-svc.
	// Gated on LLM_GATEWAY_URL so the proxy is only enabled in deployments where
	// the gateway service is reachable.
	var gatewayProxy http.Handler
	var gatewayProjectResolver apimw.PersonalProjectResolver
	if gwURL := os.Getenv("LLM_GATEWAY_URL"); gwURL != "" {
		gw, gwErr := llmproxy.New(llmproxy.Config{
			TargetURL:      gwURL,
			IdentitySecret: os.Getenv("GATEWAY_IDENTITY_SECRET"),
			ClientCertFile: os.Getenv("LLM_GATEWAY_CLIENT_CERT"),
			ClientKeyFile:  os.Getenv("LLM_GATEWAY_CLIENT_KEY"),
			CAFile:         os.Getenv("LLM_GATEWAY_CA_FILE"),
			Logger:         logger,
		})
		if gwErr != nil {
			return fmt.Errorf("compose llm gateway proxy: %w", gwErr)
		}
		gatewayProxy = gw
		gatewayProjectResolver = apimw.NewDBPersonalProjectResolver(pool)
		slog.Info("llm gateway proxy enabled", "target", gwURL)
	}

	// BF0.9c/d: the gateway proxy needs the same production-auth wiring as
	// every other auth-protected route above, gated on formGraph != nil —
	// assigning a nil *FormGraph directly to an interface field would produce
	// a non-nil interface holding a nil pointer, defeating the "not
	// configured" nil-checks in the auth middleware (#86).
	var gatewayAuthValidator apimw.TokenValidator
	var gatewayPrincipalValidator apimw.PrincipalValidator
	var gatewayForwardedIdentityVerifier apimw.ForwardedIdentityPeerVerifier
	var gatewaySessionSecret string
	if formGraph != nil {
		gatewayAuthValidator = formGraph
		gatewayPrincipalValidator = principalValidator
		gatewayForwardedIdentityVerifier = forwardedIdentityVerifier
		gatewaySessionSecret = os.Getenv("APPLICATION_SECRET_KEY")
	} else if oidcSessionHandler != nil {
		// OIDC-only deployments (no ELITEA_AUTH_CONFIG_FILE) still need the session
		// secret in the auth middleware so OIDC session cookies are accepted on
		// /api/v2 routes. formGraph uses the same APPLICATION_SECRET_KEY.
		gatewaySessionSecret = os.Getenv("APPLICATION_SECRET_KEY")
	}

	var adminUICfg *adminui.Config
	if dir := os.Getenv("ADMIN_UI_STATIC_DIR"); dir != "" {
		adminUICfg = &adminui.Config{
			StaticDir:     dir,
			ViteServerURL: "/api/v2",
			BasePath:      "/admin/app",
			SecretKey:     os.Getenv("APPLICATION_SECRET_KEY"),
		}
	}

	// Project SSE stream transport (#152). Without this, router.go's
	// `if cfg.EventSource != nil { … } else if cfg.RedisClient != nil { … }`
	// falls through on both arms and /api/v2/events/prompt_lib/{projectID} is
	// never registered — a 404 indistinguishable from a typo'd path. See
	// newEventStreamRedisClient for why Redis is the correct arm here.
	eventStreamRedis, err := newEventStreamRedisClient(ctx, os.LookupEnv)
	if err != nil {
		return fmt.Errorf("compose project event stream: %w", err)
	}
	if eventStreamRedis != nil {
		defer func() {
			if err := eventStreamRedis.Close(); runErr == nil && err != nil {
				runErr = fmt.Errorf("close project event stream: %w", err)
			}
		}()
		logger.Info("project SSE stream enabled (redis transport)")
	}

	// The toolkit TYPE catalogue (GET /elitea_core/toolkits/prompt_lib/
	// {projectID}) serves each tool's argument schema from the digest-pinned SDK
	// snapshot. It is loaded unconditionally and here, in the composition root,
	// because internal/api must not import internal/runtimecomposition. A
	// snapshot that will not load is an embedded-asset defect, so it stops
	// startup rather than degrading the endpoint to schema-less tool lists.
	toolkitArgumentSchemas, err := runtimecomposition.LoadPinnedCurrentToolkitSchemaSnapshot()
	if err != nil {
		return fmt.Errorf("load pinned current toolkit schema snapshot: %w", err)
	}

	r := api.NewRouter(api.RouterConfig{
		AdminUI:                adminUICfg,
		Pool:                   pool,
		ToolkitArgumentSchemas: toolkitArgumentSchemas,
		HealthDeps: health.Deps{
			DB:    &poolChecker{pool: pool},
			Redis: authReadiness,
		},
		AuthValidator:      gatewayAuthValidator,
		PrincipalValidator: gatewayPrincipalValidator,
		SessionSecret:      gatewaySessionSecret,
		Auth: api.AuthDeps{
			ForwardedIdentityVerifier: gatewayForwardedIdentityVerifier,
			SessionHandler:            oidcSessionHandler,
			OIDCHandler:               oidcOIDCHandler,
		},
		ProductionAuth:                productionAuth,
		ProductionRuntime:             productionRuntime,
		CurrentProjectInfo:            currentProjectInfo,
		CurrentIndexTypes:             currentIndexTypes,
		CurrentApplicationSkills:      currentApplicationSkills,
		CurrentPromptContextReads:     currentPromptContextReads,
		CurrentProjectList:            currentProjectList,
		CurrentSocialAuthors:          currentSocialAuthors,
		CurrentSocialAvatar:           currentSocialAvatar,
		CurrentConfigurationAvailable: currentConfigurationAvailable,
		CurrentConfigurationRead:      currentConfigurationRead,
		CurrentConfigurationTypes:     currentConfigurationTypes,
		CurrentConfigurationMutation:  currentConfigurationMutation,
		CurrentIndexStart:             currentIndexStart,
		CurrentAgentStart:             currentAgentStart,
		CurrentAgentCancel:            currentAgentCancel,
		CurrentIndexCancel:            currentIndexCancel,
		CurrentIndexMeta:              currentIndexMeta,
		CurrentIndexMetaDelete:        currentIndexMetaDelete,
		CurrentIndexScheduleUpdate:    currentIndexScheduleUpdate,
		CurrentIndexScheduleDelete:    currentIndexScheduleDelete,
		CurrentNotifications:          currentNotifications,
		CurrentNotificationEvents:     currentNotificationEvents,
		CurrentModelCatalog:           currentModelCatalog,
		CurrentModelDefault:           currentModelDefault,
		GatewayProxy:                  gatewayProxy,
		GatewayProjectResolver:        gatewayProjectResolver,
		ObjectStore:                   objectStore,
		// Without AppsRepo, internal/api/router.go silently skips registering
		// every /elitea_core/application(s)/* and /elitea_core/version(s)/*
		// route, and creating an agent from the UI 404s (#115).
		AppsRepo: applicationsRepository(pool),
		// Same defect class as AppsRepo above, six more times (#126). Each of
		// these repositories already EXISTED — conversations.go alone is 951
		// lines — and had zero callers, so router.go dropped their route groups
		// and the endpoints 404'd in every deployment. Counted at the gates:
		// conversations 23 routes, skills 12, analytics 7, folders 6, tags 3.
		ConvsRepo:     conversationsRepository(pool),
		SkillsRepo:    skillsRepository(pool),
		FoldersRepo:   foldersRepository(pool),
		TagsRepo:      tagsRepository(pool),
		AnalyticsRepo: analyticsRepository(pool),
		// WebhookRepo is the sixth instance of the same defect, and it hid one
		// step deeper than the other five. Its gate mounts a subrouter —
		// `r.Mount("/webhooks/prompt_lib/{projectID}", webhook.NewHandler(...).Routes())`
		// — so a count of inline r.Get/r.Post calls inside the gated block
		// returns zero, and it looked like a field that gated nothing. The five
		// routes are declared in the handler's own Routes() method.
		WebhookRepo: webhooksRepository(pool),
		// The project SSE stream's transport. Nil-gated in router.go behind a
		// two-arm fallback (EventSource → RedisClient) whose members were BOTH
		// unassigned, so the endpoint 404'd everywhere (#152).
		RedisClient: eventStreamRedis,
	})

	// NOTE(#126): the Socket.IO prototype server (internal/api/socketio) is
	// gone. It was never mounted — the comment that stood here said it stayed
	// unmounted until connection authentication, project-membership checks,
	// room authorization and a per-event permission contract existed, since
	// mounting it would have exposed cross-tenant rooms and execution events.
	// Every one of its handlers proxied to indexersvc.Client, the prototype
	// Redis RPC transport this change retires, so it could not have been
	// mounted after the deletion either. The chat-dispatch migration it was a
	// placeholder for is #93; the web client's own socket.io still points at
	// pylon and is unaffected.
	// NOT wrapped in otelhttp here: internal/api/router.go already installs
	// apimw.OtelMiddleware (r.Use at router.go:396) as chi middleware, which
	// creates a span per request via otel.Tracer("elitea-main") — the same
	// global tracer provider observability.New (above) installs. otelhttp
	// would duplicate that instrumentation AND break it: otelhttp's response
	// writer wrapper has no Unwrap(), unlike apimw's own statusRecorder
	// (middleware/otel.go), so http.ResponseController.SetWriteDeadline
	// (used by the SSE writers in internal/api/v2/executions/events.go and
	// internal/api/v2/notifications/events.go, and by artifact upload/
	// download deadlines) would stop reaching the real ResponseWriter.
	srv := newHTTPServer(publicAddress, r)

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

// applicationsRepository composes the tenant-schema applications repository
// backing RouterConfig.AppsRepo. It is a named function rather than an inline
// constructor so main_router_wiring_test.go can assert the field is present in
// the production RouterConfig literal: a nil AppsRepo makes
// internal/api/router.go drop the whole /elitea_core applications route group
// without any startup error, which is how #115 stayed invisible.
func applicationsRepository(pool *pgxpool.Pool) applications.Repository {
	if pool == nil {
		return nil
	}
	return dbrepos.NewApplicationsRepo(pool)
}

// The remaining tenant-schema repositories, composed the same way and for the
// same reason: a nil field makes router.go drop the route group silently, with
// no startup error and a 404 indistinguishable from a typo'd path.
//
// Named functions, not inline constructors, so main_router_wiring_test.go can
// assert each field is present in the production literal.

func conversationsRepository(pool *pgxpool.Pool) v2convs.Repository {
	if pool == nil {
		return nil
	}
	return dbrepos.NewConversationsRepo(pool)
}

func skillsRepository(pool *pgxpool.Pool) v2skills.Repository {
	if pool == nil {
		return nil
	}
	return dbrepos.NewSkillsRepo(pool)
}

func foldersRepository(pool *pgxpool.Pool) v2folders.Repository {
	if pool == nil {
		return nil
	}
	return dbrepos.NewFoldersRepo(pool)
}

func webhooksRepository(pool *pgxpool.Pool) webhook.Repository {
	if pool == nil {
		return nil
	}
	return dbrepos.NewWebhooksRepo(pool)
}

func tagsRepository(pool *pgxpool.Pool) v2tags.Repository {
	if pool == nil {
		return nil
	}
	return dbrepos.NewTagsRepo(pool)
}

func analyticsRepository(pool *pgxpool.Pool) v2analytics.Repository {
	if pool == nil {
		return nil
	}
	return dbrepos.NewAnalyticsRepo(pool)
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

// objectStoreReadinessProbe issues one Stat against a sentinel key that is
// never expected to exist. ErrNotFound therefore means the backend is
// reachable and authenticated; any other error (access denied, a transport
// failure) means it is not, and the service should not start.
func objectStoreReadinessProbe(ctx context.Context, store storage.ObjectStore) error {
	ref, err := storage.NewObjectRef("1", "elitea-system", "readiness-probe")
	if err != nil {
		return err
	}
	if _, err := store.Stat(ctx, ref); err != nil && !errors.Is(err, storage.ErrNotFound) {
		return err
	}
	return nil
}

// retentionLifecycleConfigurer is satisfied by s3.Backend and gcs.Backend —
// see their ConfigureRetentionLifecycle doc comments for why this is a
// separate, optional step here rather than folded into newObjectStore/New()
// itself (New() must stay a cheap, non-network-dialing constructor).
// azure.Backend does not implement it: Azure's own default ~7-day
// uncommitted-block GC already delivers the same outcome with no explicit
// call, see azure/backend.go's AbortMultipart doc comment.
type retentionLifecycleConfigurer interface {
	ConfigureRetentionLifecycle(ctx context.Context) error
}

func configureObjectStoreRetentionLifecycle(ctx context.Context, store storage.ObjectStore) error {
	configurer, ok := store.(retentionLifecycleConfigurer)
	if !ok {
		return nil
	}
	return configurer.ConfigureRetentionLifecycle(ctx)
}

type poolChecker struct {
	pool *pgxpool.Pool
}

func (p *poolChecker) Ping(ctx context.Context) error {
	return p.pool.Ping(ctx)
}

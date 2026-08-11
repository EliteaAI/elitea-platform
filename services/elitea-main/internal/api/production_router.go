package api

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/browserauth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/health"
	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	agentexecutionapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/agentexecution"
	applicationskillsapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/applicationskills"
	configurationapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/configurations"
	indexingapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/indexing"
	indextypesapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/indextypes"
	notificationsapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/notifications"
	projectinfoapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/projectinfo"
	v2projects "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/projects"
	promptcontextreadsapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/promptcontextreads"
	v2social "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/social"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/legacyrbac"
)

var ErrInvalidProductionAuthRoutes = errors.New("invalid production authentication routes")

// ProductionAuthRoutes is constructed atomically so a caller cannot mount a
// browser login surface without the gateway edge that authorizes the current
// Main, or vice versa.
type ProductionAuthRoutes struct {
	browser http.Handler
	main    http.Handler
}

func NewProductionAuthRoutes(browser, main http.Handler) (*ProductionAuthRoutes, error) {
	if browser == nil || main == nil {
		return nil, ErrInvalidProductionAuthRoutes
	}
	return &ProductionAuthRoutes{browser: browser, main: main}, nil
}

// NewRouter exposes only routes whose production authorization contract is
// explicit. Unclassified prototype handlers stay compiled in
// newPrototypeCompatibilityRouter, but cannot be enabled by configuration.
func NewRouter(cfg RouterConfig) chi.Router {
	if prototypeCompatibilityRequested(cfg) {
		return newPrototypeCompatibilityRouter(cfg)
	}

	r := chi.NewRouter()

	r.Use(apimw.RequestID)
	// Preserve the socket peer in Request.RemoteAddr. A generic RealIP
	// middleware trusts caller-controlled forwarding headers before route-level
	// proxy policy can validate the peer. TrustedProxyResolver performs the one
	// authoritative forwarded-chain resolution for ForwardAuth and rate limits.
	r.Use(apimw.OtelMiddleware)
	r.Use(apimw.Recover)

	// Public, non-product-data routes.
	r.Mount("/", health.RoutesWithDeps(cfg.HealthDeps))
	mountReviewedProductionRoutes(r, cfg, true)

	// Artifacts (S11): mounted unconditionally, unlike the cfg.CurrentXxx
	// routes above. Auth/RBAC gating must not depend on whether the storage
	// backend happens to be wired — mountArtifactRoutes degrades every route
	// to notImplementedArtifact when it isn't (see ArtifactDeps), but still
	// enforces authentication and permission on all of them either way.
	artifactResolver := cfg.ArtifactPermissionResolver
	if artifactResolver == nil {
		artifactResolver = legacyrbac.NewPostgresResolver(cfg.Pool)
	}
	artifactHandler := cfg.ArtifactHandler
	if artifactHandler == nil {
		artifactHandler, _ = newArtifactHandler(cfg)
	}
	mountArtifactRoutes(r, ArtifactDeps{
		Handler: artifactHandler,
		Authenticate: apimw.Auth(apimw.AuthConfig{
			Client:                    cfg.AuthClient,
			Validator:                 cfg.AuthValidator,
			PrincipalValidator:        cfg.PrincipalValidator,
			ForwardedIdentityVerifier: cfg.Auth.ForwardedIdentityVerifier,
			SessionSecret:             cfg.SessionSecret,
			TrustedProxyCIDRs:         cfg.Auth.TrustedProxyCIDRs,
		}),
		Resolver: artifactResolver,
	})

	return r
}

// mountReviewedProductionRoutes is the single registration source for every
// current-compatibility route whose production authorization contract has been
// reviewed. Hybrid deployments add broad parity repositories, but those
// additions must never remove or replace these admitted routes.
func mountReviewedProductionRoutes(r chi.Router, cfg RouterConfig, includeCurrentProjectContext bool) {
	if cfg.ProductionAuth != nil {
		r.Mount(browserauth.BasePath, cfg.ProductionAuth.browser)
		// This address is reached only by the gateway's ForwardAuth middleware;
		// deployment routing must never expose it as a product route.
		r.Method(http.MethodGet, browserauth.MainForwardAuthPath, cfg.ProductionAuth.main)
	}
	if cfg.CurrentProjectList != nil {
		r.Method(http.MethodGet, v2projects.CurrentProjectListPath, cfg.CurrentProjectList)
	}
	if cfg.CurrentSocialAuthors != nil {
		r.Method(http.MethodGet, v2social.CurrentAuthorsPath, cfg.CurrentSocialAuthors)
		r.Method(http.MethodGet, v2social.CurrentAuthorsDefaultPath, cfg.CurrentSocialAuthors)
	}
	if cfg.CurrentProjectInfo != nil {
		r.Method(http.MethodGet, projectinfoapi.CurrentProjectInfoPath, cfg.CurrentProjectInfo)
	}
	if cfg.CurrentIndexTypes != nil {
		r.Method(http.MethodGet, indextypesapi.CurrentIndexTypesPath, cfg.CurrentIndexTypes)
	}
	if cfg.CurrentApplicationSkills != nil {
		r.Method(http.MethodGet, applicationskillsapi.CurrentApplicationSkillsPath, cfg.CurrentApplicationSkills)
	}
	if cfg.CurrentPromptContextReads != nil {
		r.Method(http.MethodGet, promptcontextreadsapi.CurrentChatConfigPath, cfg.CurrentPromptContextReads)
		if includeCurrentProjectContext {
			r.Method(http.MethodGet, promptcontextreadsapi.CurrentProjectContextPath, cfg.CurrentPromptContextReads)
		}
	}
	if cfg.CurrentConfigurationAvailable != nil {
		r.Method(http.MethodGet, configurationapi.CurrentAvailablePath, cfg.CurrentConfigurationAvailable)
		r.Method(http.MethodGet, configurationapi.CurrentAvailableSlashPath, cfg.CurrentConfigurationAvailable)
		r.Method(http.MethodGet, configurationapi.CurrentAvailableProjectPath, cfg.CurrentConfigurationAvailable)
	}
	if cfg.CurrentConfigurationRead != nil {
		r.Method(http.MethodGet, configurationapi.CurrentConfigurationListPath, cfg.CurrentConfigurationRead)
		r.Method(http.MethodGet, configurationapi.CurrentConfigurationDetailsPath, cfg.CurrentConfigurationRead)
	}
	if cfg.CurrentConfigurationTypes != nil {
		r.Method(http.MethodGet, configurationapi.CurrentConfigurationTypesPath, cfg.CurrentConfigurationTypes)
	}
	if cfg.CurrentConfigurationMutation != nil {
		r.Method(http.MethodPost, configurationapi.CurrentConfigurationListPath, cfg.CurrentConfigurationMutation)
		r.Method(http.MethodPut, configurationapi.CurrentConfigurationDetailsPath, cfg.CurrentConfigurationMutation)
		r.Method(http.MethodDelete, configurationapi.CurrentConfigurationDetailsPath, cfg.CurrentConfigurationMutation)
	}
	if cfg.ProductionRuntime != nil {
		r.Method(http.MethodPost, "/api/v2"+runtimeValidationPath, cfg.ProductionRuntime.validation)
		r.Method(http.MethodGet, "/api/v2"+runtimeEventsPath, cfg.ProductionRuntime.executionEvents)
	}
	if cfg.CurrentIndexStart != nil {
		r.Method(http.MethodPost, indexingapi.CurrentIndexStartPath, cfg.CurrentIndexStart)
	}
	if cfg.CurrentAgentStart != nil {
		r.Method(http.MethodPost, agentexecutionapi.CurrentApplicationStartPath, cfg.CurrentAgentStart)
		r.Method(http.MethodPost, agentexecutionapi.CurrentRegenerationPath, cfg.CurrentAgentStart)
		r.Method(http.MethodPost, agentexecutionapi.CurrentContinuationPath, cfg.CurrentAgentStart)
	}
	if cfg.CurrentAgentCancel != nil {
		r.Method(http.MethodDelete, agentexecutionapi.CurrentAgentCancelPath, cfg.CurrentAgentCancel)
	}
	if cfg.CurrentIndexCancel != nil {
		r.Method(http.MethodDelete, indexingapi.CurrentIndexCancelPath, cfg.CurrentIndexCancel)
	}
	if cfg.CurrentIndexMeta != nil {
		r.Method(http.MethodGet, indexingapi.CurrentIndexMetaListPath, cfg.CurrentIndexMeta)
	}
	if cfg.CurrentIndexMetaDelete != nil {
		r.Method(
			indexingapi.SourceOnlyIndexDeleteMethod,
			indexingapi.CurrentIndexMetaDeletePath,
			cfg.CurrentIndexMetaDelete,
		)
	}
	if cfg.CurrentIndexScheduleUpdate != nil {
		r.Method(
			indexingapi.SourceOnlyIndexScheduleMethod,
			indexingapi.SourceOnlyIndexSchedulePath,
			cfg.CurrentIndexScheduleUpdate,
		)
	}
	if cfg.CurrentIndexScheduleDelete != nil {
		r.Method(
			indexingapi.SourceOnlyIndexScheduleDeleteMethod,
			indexingapi.SourceOnlyIndexScheduleDeletePath,
			cfg.CurrentIndexScheduleDelete,
		)
	}
	if cfg.CurrentNotifications != nil {
		r.Method(http.MethodGet, notificationsapi.CurrentNotificationsPath, cfg.CurrentNotifications)
		r.Method(http.MethodPut, notificationsapi.CurrentNotificationsPath, cfg.CurrentNotifications)
		r.Method(http.MethodDelete, notificationsapi.CurrentNotificationsPath, cfg.CurrentNotifications)
		r.Method(http.MethodGet, notificationsapi.CurrentNotificationPath, cfg.CurrentNotifications)
		r.Method(http.MethodPut, notificationsapi.CurrentNotificationPath, cfg.CurrentNotifications)
		r.Method(http.MethodDelete, notificationsapi.CurrentNotificationPath, cfg.CurrentNotifications)
	}
	if cfg.CurrentNotificationEvents != nil {
		r.Method(
			http.MethodGet,
			notificationsapi.CurrentNotificationEventsPath,
			cfg.CurrentNotificationEvents,
		)
	}
	if cfg.CurrentModelCatalog != nil {
		r.Method(http.MethodGet, configurationapi.CurrentModelCatalogPath, cfg.CurrentModelCatalog)
	}
	if cfg.CurrentModelDefault != nil {
		r.Method(http.MethodPost, configurationapi.CurrentModelDefaultPath, cfg.CurrentModelDefault)
	}
	if cfg.GatewayProxy != nil {
		r.Group(func(r chi.Router) {
			r.Use(apimw.Auth(apimw.AuthConfig{
				Client:                    cfg.AuthClient,
				Validator:                 cfg.AuthValidator,
				PrincipalValidator:        cfg.PrincipalValidator,
				ForwardedIdentityVerifier: cfg.Auth.ForwardedIdentityVerifier,
				SessionSecret:             cfg.SessionSecret,
				TrustedProxyCIDRs:         cfg.Auth.TrustedProxyCIDRs,
			}))
			r.Use(apimw.Project(apimw.ProjectConfig{Resolver: cfg.GatewayProjectResolver}))
			r.Mount("/llm", cfg.GatewayProxy)
		})
	} else if cfg.CurrentLLMFacade != nil {
		r.Handle("/llm/*", cfg.CurrentLLMFacade)
	}
}

func prototypeCompatibilityRequested(cfg RouterConfig) bool {
	return cfg.Auth.Client != nil ||
		cfg.Auth.Validator != nil ||
		cfg.Auth.SessionHandler != nil ||
		cfg.Auth.OIDCHandler != nil ||
		cfg.AppsRepo != nil ||
		cfg.SkillsRepo != nil ||
		cfg.FoldersRepo != nil ||
		cfg.TagsRepo != nil ||
		cfg.AnalyticsRepo != nil ||
		cfg.ConvsRepo != nil ||
		cfg.WebhookRepo != nil ||
		cfg.EventSource != nil ||
		cfg.LLMProxy != nil
}

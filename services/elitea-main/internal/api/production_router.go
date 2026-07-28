package api

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/browserauth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/health"
	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	applicationskillsapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/applicationskills"
	configurationapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/configurations"
	indexingapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/indexing"
	indextypesapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/indextypes"
	projectinfoapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/projectinfo"
	v2projects "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/projects"
	promptcontextreadsapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/promptcontextreads"
	v2social "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/social"
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
		r.Method(http.MethodGet, promptcontextreadsapi.CurrentProjectContextPath, cfg.CurrentPromptContextReads)
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
	if cfg.CurrentModelCatalog != nil {
		r.Method(http.MethodGet, configurationapi.CurrentModelCatalogPath, cfg.CurrentModelCatalog)
	}
	if cfg.CurrentModelDefault != nil {
		r.Method(http.MethodPost, configurationapi.CurrentModelDefaultPath, cfg.CurrentModelDefault)
	}
	if cfg.CurrentLLMFacade != nil {
		r.Handle("/llm/*", cfg.CurrentLLMFacade)
	}

	return r
}

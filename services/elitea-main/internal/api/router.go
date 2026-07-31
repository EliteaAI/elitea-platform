package api

import (
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/adminui"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/gateway"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/health"
	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/shadow"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/admin"
	v2analytics "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/analytics"
	v2apps "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/applications"
	v2applicationskills "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/applicationskills"
	v2artifacts "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/artifacts"
	v2auth "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/auth"
	v2branding "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/branding"
	v2chat "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/chat"
	v2configs "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/configurations"
	v2contextmgr "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/contextmgr"
	v2convs "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/conversations"
	v2core "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/eliteacore"
	v2events "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/events"
	v2folders "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/folders"
	v2indextypes "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/indextypes"
	v2pipelines "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/pipelines"
	v2predict "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/predict"
	v2projectinfo "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/projectinfo"
	v2projects "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/projects"
	v2promptcontextreads "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/promptcontextreads"
	v2scheduling "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/scheduling"
	v2secrets "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/secrets"
	v2skills "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/skills"
	v2social "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/social"
	v2tags "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/tags"
	v2toolkits "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/toolkits"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/webhook"
	platformauth "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/cutover"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/applications"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/authsvc"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/legacyrbac"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"
)

// AuthDeps preserves the current-main grouped dependency contract while the
// parity composition continues to accept the established flat fields.
type AuthDeps struct {
	Client                    *authsvc.Client
	Validator                 apimw.TokenValidator
	PrincipalValidator        apimw.PrincipalValidator
	ForwardedIdentityVerifier apimw.ForwardedIdentityPeerVerifier
	SessionHandler            *v2auth.SessionHandler
	OIDCHandler               *v2auth.OIDCHandler
	SessionSecret             string
	TrustedProxyCIDRs         []string
}

// IndexerDeps preserves the current-main grouped runtime dependency contract.
type IndexerDeps struct {
	Predictor      v2predict.Predictor
	LLMService     v2predict.LLMService
	ChatService    v2chat.ChatService
	PipelineRunner v2pipelines.Runner
	ToolTester     v2toolkits.ToolTester
	MCPSyncer      v2core.MCPToolSyncer
}

type RouterConfig struct {
	Auth               AuthDeps
	Indexer            IndexerDeps
	AuthClient         *authsvc.Client
	AuthValidator      apimw.TokenValidator
	PrincipalValidator apimw.PrincipalValidator
	SessionHandler     *v2auth.SessionHandler
	OIDCHandler        *v2auth.OIDCHandler
	HealthDeps         health.Deps
	Pool               *pgxpool.Pool
	AppsRepo           applications.Repository
	SkillsRepo         v2skills.Repository
	FoldersRepo        v2folders.Repository
	TagsRepo           v2tags.Repository
	AnalyticsRepo      v2analytics.Repository
	ConvsRepo          v2convs.Repository
	WebhookRepo        webhook.Repository
	RedisClient        *goredis.Client
	EventSource        v2events.EventSource
	Predictor          v2predict.Predictor
	LLMService         v2predict.LLMService
	ChatService        v2chat.ChatService
	PipelineRunner     v2pipelines.Runner
	ToolTester         v2toolkits.ToolTester
	MCPSyncer          v2core.MCPToolSyncer
	Shadow             *shadow.Comparator
	ShadowMetrics      *shadow.Metrics
	CutoverTracker     *cutover.Tracker
	CutoverRouter      *cutover.Router
	AdminUI            *adminui.Config
	Storage            storage.Backend
	BudgetAlertStore   *gateway.BudgetAlertStore
	SessionSecret      string
	// InternalAdminToken is a disabled-by-default transitional control for
	// shadow/cutover operations, not production workload identity. Empty leaves
	// those routes unmounted.
	InternalAdminToken            string
	RuntimeRoutes                 RuntimeRoutes
	ProductionAuth                *ProductionAuthRoutes
	ProductionRuntime             *ProductionRuntimeRoutes
	CurrentProjectInfo            *v2projectinfo.CurrentProjectInfoRoute
	CurrentIndexTypes             *v2indextypes.CurrentIndexTypesRoute
	CurrentApplicationSkills      *v2applicationskills.CurrentApplicationSkillsRoute
	CurrentPromptContextReads     *v2promptcontextreads.CurrentRoutes
	CurrentProjectList            *v2projects.CurrentProjectListRoute
	CurrentSocialAuthors          *v2social.CurrentAuthorsRoute
	CurrentConfigurationAvailable http.Handler
	CurrentConfigurationRead      http.Handler
	CurrentConfigurationTypes     http.Handler
	CurrentConfigurationMutation  http.Handler
	CurrentIndexStart             http.Handler
	CurrentIndexCancel            http.Handler
	CurrentIndexMeta              http.Handler
	CurrentIndexMetaDelete        http.Handler
	CurrentIndexScheduleUpdate    http.Handler
	CurrentIndexScheduleDelete    http.Handler
	CurrentNotifications          http.Handler
	CurrentNotificationEvents     http.Handler
	CurrentModelCatalog           http.Handler
	CurrentModelDefault           http.Handler
	CurrentLLMFacade              http.Handler
	LLMProxy                      http.Handler
	LLMProjectResolver            apimw.PersonalProjectResolver
}

type RuntimeRoutes struct {
	Validation      http.Handler
	ExecutionEvents http.Handler
}

const (
	runtimeValidationPath = "/configurations/validation/{projectID}/{configurationRevisionID}"
	runtimeEventsPath     = "/executions/{projectID}/{executionID}/events"
)

// newPrototypeCompatibilityRouter preserves the broad prototype registration
// map for parity work. Production composition deliberately does not call it:
// most of these routes have not yet been assigned an exact legacy route policy.
func newPrototypeCompatibilityRouter(cfg RouterConfig) chi.Router {
	if cfg.AuthClient == nil {
		cfg.AuthClient = cfg.Auth.Client
	}
	if cfg.AuthValidator == nil {
		cfg.AuthValidator = cfg.Auth.Validator
	}
	if cfg.PrincipalValidator == nil {
		cfg.PrincipalValidator = cfg.Auth.PrincipalValidator
	}
	if cfg.SessionHandler == nil {
		cfg.SessionHandler = cfg.Auth.SessionHandler
	}
	if cfg.OIDCHandler == nil {
		cfg.OIDCHandler = cfg.Auth.OIDCHandler
	}
	if cfg.SessionSecret == "" {
		cfg.SessionSecret = cfg.Auth.SessionSecret
	}
	if cfg.Predictor == nil {
		cfg.Predictor = cfg.Indexer.Predictor
	}
	if cfg.LLMService == nil {
		cfg.LLMService = cfg.Indexer.LLMService
	}
	if cfg.ChatService == nil {
		cfg.ChatService = cfg.Indexer.ChatService
	}
	if cfg.PipelineRunner == nil {
		cfg.PipelineRunner = cfg.Indexer.PipelineRunner
	}
	if cfg.ToolTester == nil {
		cfg.ToolTester = cfg.Indexer.ToolTester
	}
	if cfg.MCPSyncer == nil {
		cfg.MCPSyncer = cfg.Indexer.MCPSyncer
	}

	r := chi.NewRouter()
	permissionResolver := legacyrbac.NewPostgresResolver(cfg.Pool)

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		ExposedHeaders:   []string{"Content-Length"},
		AllowCredentials: false,
		MaxAge:           300,
	}))
	r.Use(apimw.RequestID)
	// Keep the raw socket peer available to any trust-aware proxy resolver.
	// Generic RealIP processing before authentication would make X-Real-IP and
	// X-Forwarded-For caller-controlled trust inputs.
	r.Use(apimw.OtelMiddleware)
	r.Use(apimw.Recover)

	r.Mount("/", health.RoutesWithDeps(cfg.HealthDeps))

	// Traefik forward-auth endpoint (no auth middleware — this IS the auth check)
	forwardAuth := v2auth.NewForwardAuthHandler(cfg.AuthClient, cfg.AuthValidator)
	r.Get("/auth", forwardAuth.ServeHTTP)

	// Browser-facing OIDC session lifecycle. Legacy form authentication is not
	// mounted because auth_core__user has no password credential columns; the
	// previous prototype queried columns that do not exist in the legacy schema.
	if cfg.SessionHandler != nil {
		r.Route("/forward-auth", func(r chi.Router) {
			if cfg.OIDCHandler != nil {
				r.Get("/login", func(w http.ResponseWriter, req *http.Request) {
					http.Redirect(w, req, "/forward-auth/auth_oidc/login", http.StatusFound)
				})
			}
			r.Get("/logout", cfg.SessionHandler.Logout)
			r.Get("/info", cfg.SessionHandler.Info)
			r.Get("/auth_form/logout", cfg.SessionHandler.Logout)
			if cfg.OIDCHandler != nil {
				r.Get("/auth_oidc/login", cfg.OIDCHandler.Login)
				r.Get("/auth_oidc/callback", cfg.OIDCHandler.Callback)
			}
			r.Get("/auth_oidc/logout", cfg.SessionHandler.Logout)
		})
	}

	// Preserve the current-main prototype S3 surface for route compatibility.
	// The reviewed production router mounts its separately permission-scoped
	// candidate only when the legacy S3 credential contract is composed.
	s3Handler := v2artifacts.NewS3Handler(cfg.Storage)
	r.Get("/artifacts/s3/", s3Handler.ListBuckets)
	r.Get("/artifacts/s3/{bucket}", s3Handler.ListObjects)
	r.Get("/artifacts/s3/{bucket}/*", s3Handler.GetObject)
	r.Put("/artifacts/s3/{bucket}/*", s3Handler.PutObject)
	r.Delete("/artifacts/s3/{bucket}/*", s3Handler.DeleteObject)

	// Static file serving for application icons (root level like pylon)
	iconDir := os.Getenv("ICON_DATA_DIR")
	if iconDir == "" {
		iconDir = "/data/static/application_icon"
	}
	toolIconDir := os.Getenv("TOOL_ICON_DATA_DIR")
	if toolIconDir == "" {
		toolIconDir = "/data/static/elitea_static-main/tool_icons"
	}
	r.Handle("/app/application_icon/*", http.StripPrefix("/app/application_icon/", http.FileServer(http.Dir(iconDir))))
	r.Handle("/app/application_tool_icon/*", http.StripPrefix("/app/application_tool_icon/", http.FileServer(http.Dir(toolIconDir))))

	// The UI loads branding before a browser session exists, so this exact
	// static bootstrap route must remain public in both current-main and PoV.
	brandingHandler := v2branding.NewHandler(v2branding.Config{PackPath: os.Getenv("BRAND_PACK_PATH")})
	r.Get("/api/v2/branding/bootstrap.js", brandingHandler.Bootstrap)
	r.Head("/api/v2/branding/bootstrap.js", brandingHandler.Bootstrap)

	// Admin UI SPA — serves the admin panel with server-side config injection
	if cfg.AdminUI != nil {
		adminUIHandler := adminui.NewHandler(*cfg.AdminUI)
		r.Mount(cfg.AdminUI.BasePath, adminUIHandler.Routes())
	}

	if len(cfg.InternalAdminToken) >= apimw.MinimumInternalAdminTokenBytes {
		r.Group(func(r chi.Router) {
			r.Use(apimw.RequireInternalAdminToken(cfg.InternalAdminToken))
			if cfg.Shadow != nil && cfg.ShadowMetrics != nil {
				r.Mount("/internal/shadow", shadow.NewAdminHandler(cfg.Shadow, cfg.ShadowMetrics).Routes())
			}
			if cfg.CutoverTracker != nil {
				r.Mount("/internal/cutover", cutover.NewAdminHandler(cfg.CutoverTracker).Routes())
			}
		})
	}

	// Strip doubled /api/v2/api/v2/... prefix caused by admin_ui RTK Query
	// baseUrl + explicit V2_BASE prefix in projectsApi/configurationApi/serviceDescriptorsApi
	r.HandleFunc("/api/v2/api/v2/*", func(w http.ResponseWriter, req *http.Request) {
		req.URL.Path = strings.TrimPrefix(req.URL.Path, "/api/v2")
		req.URL.RawPath = ""
		r.ServeHTTP(w, req)
	})

	r.Group(func(r chi.Router) {
		r.Use(apimw.Auth(apimw.AuthConfig{
			Client:                    cfg.AuthClient,
			Validator:                 cfg.AuthValidator,
			PrincipalValidator:        cfg.PrincipalValidator,
			ForwardedIdentityVerifier: cfg.Auth.ForwardedIdentityVerifier,
			SessionSecret:             cfg.SessionSecret,
			TrustedProxyCIDRs:         cfg.Auth.TrustedProxyCIDRs,
		}))

		if cfg.CutoverRouter != nil {
			r.Use(cfg.CutoverRouter.Middleware)
		}

		if cfg.Shadow != nil {
			r.Use(shadow.MiddlewareWithMetrics(shadow.MiddlewareConfig{
				Comparator: cfg.Shadow,
				Metrics:    cfg.ShadowMetrics,
			}))
		}

		r.Route("/api/v2", func(r chi.Router) {
			mountRuntimeRoutes(r, cfg.RuntimeRoutes)

			coreHandler := v2core.NewHandler(
				cfg.Pool,
				v2core.WithPermissionResolver(permissionResolver),
			)
			if cfg.MCPSyncer != nil {
				coreHandler.SetMCPSyncer(cfg.MCPSyncer)
			}

			// === Auth endpoints ===
			r.Mount("/auth", v2auth.NewHandler(
				cfg.Pool,
				v2auth.WithPermissionResolver(permissionResolver),
				v2auth.WithTokenSigningKey(cfg.SessionSecret),
			).Routes())

			// === Projects endpoints ===
			r.Mount("/projects", v2projects.NewHandler(cfg.Pool).Routes())

			// === Admin endpoints ===
			adminHandler := admin.NewHandler(cfg.Pool)
			r.Route("/admin", func(r chi.Router) {
				// Admin panel endpoints (administration mode, no projectID)
				r.Get("/system_info/prompt_lib", adminHandler.SystemInfo)
				r.Get("/system_info/{mode}", adminHandler.SystemInfo)
				r.Get("/plugin_config_values/prompt_lib/resources", adminHandler.ResourcesConfig)
				r.Get("/auth_users/{mode}", adminHandler.AuthUsers)
				r.Get("/permissions/{scope}/{mode}", adminHandler.AdminPermissions)
				r.Get("/projects/{mode}", adminHandler.Projects)
				r.Get("/plugin_config_schemas/{mode}", adminHandler.PluginConfigSchemas)
				r.Get("/plugin_config_values/{mode}/{plugin}", adminHandler.PluginConfigValues)
				r.Put("/plugin_config_values/{mode}/{plugin}", adminHandler.PluginConfigValuesSave)
				r.Get("/plugin_config_suggestions/{mode}/{key}", adminHandler.PluginConfigSuggestions)
				r.Post("/plugin_config_restart/{mode}/{pylonID}", adminHandler.PluginConfigRestart)
				r.Get("/moderation_statuses/{mode}", adminHandler.ModerationStatuses)
				r.Get("/maintenance/{mode}", adminHandler.Maintenance)
				r.Put("/maintenance/{mode}", adminHandler.Maintenance)
				r.Get("/runtime_remote/{mode}", adminHandler.RuntimeRemote)
				r.Get("/runtime_remote_config/{mode}/{pluginID}", adminHandler.RuntimeRemoteConfig)
				r.Post("/runtime_remote_config/{mode}/{pluginID}", adminHandler.RuntimeRemoteConfig)
				r.Get("/runtime_plugin/{mode}/{pluginName}", adminHandler.RuntimePlugin)
				r.Put("/runtime_plugin/{mode}/{pluginName}", adminHandler.RuntimePlugin)
				r.Post("/runtime_pylons/{mode}", adminHandler.RuntimePylonLogs)
				r.Get("/tasks/{mode}/", adminHandler.Tasks)
				r.Get("/tasks/{mode}", adminHandler.Tasks)
				r.Get("/active_tasks/{mode}", adminHandler.ActiveTasks)

				// Regular app admin endpoints (with projectID)
				r.Get("/users/{mode}/{projectID}", coreHandler.Users)
				r.Post("/users/{mode}/{projectID}", coreHandler.Users)
				r.Put("/users/{mode}/{projectID}", coreHandler.Users)
				r.Delete("/users/{mode}/{projectID}", coreHandler.Users)
				r.Get("/roles/{mode}/{projectID}", coreHandler.Roles)
				r.Get("/moderation_status/{mode}/{projectID}/{entityID}", coreHandler.ModerationStatus)
				r.Post("/moderation_status/{mode}/{projectID}/{entityID}", coreHandler.ModerationStatus)

				// Preserve current-main gateway administration. Server-side
				// permission enforcement is required even when the UI hides
				// these controls.
				if cfg.BudgetAlertStore == nil {
					cfg.BudgetAlertStore = gateway.NewBudgetAlertStore()
				}
				budgetAlertHandler := gateway.NewBudgetAlertHandler(cfg.BudgetAlertStore)
				governanceHandler := gateway.NewGovernanceHandler(cfg.Pool)
				r.Group(func(r chi.Router) {
					r.Use(apimw.RequirePermissions("configuration.governance"))
					r.Route("/gateway", func(r chi.Router) {
						r.Mount("/", budgetAlertHandler.Routes())
						governanceHandler.Register(r)
					})
				})
			})

			// === Scheduling ===
			schedulingHandler := v2scheduling.NewHandler(cfg.Pool)
			r.Get("/scheduling/schedules/{mode}/{projectID}", schedulingHandler.Schedules)

			// === Configurations ===
			r.Mount("/configurations", v2configs.NewHandler(
				cfg.Pool,
				v2configs.WithPermissionResolver(permissionResolver),
			).Routes())

			// === Secrets ===
			r.Mount("/secrets", v2secrets.NewHandler(cfg.Pool).Routes())

			// === Notifications ===
			r.Route("/notifications", func(r chi.Router) {
				r.Get("/notifications/prompt_lib/{projectID}", coreHandler.Notifications)
				r.Put("/notification/prompt_lib/{projectID}/{notificationID}", coreHandler.UpdateNotification)
				r.Delete("/notification/prompt_lib/{projectID}/{notificationID}", coreHandler.UpdateNotification)
				r.Delete("/notifications/prompt_lib/{projectID}", coreHandler.UpdateNotification)
				r.Put("/notifications/prompt_lib/{projectID}", coreHandler.UpdateNotification)
			})

			// === elitea_core plugin routes ===
			r.Route("/elitea_core", func(r chi.Router) {
				// Applications
				if cfg.AppsRepo != nil {
					appHandler := v2apps.NewHandler(cfg.AppsRepo)
					r.Get("/applications/prompt_lib/{projectID}", appHandler.List)
					r.Post("/applications/prompt_lib/{projectID}", appHandler.Create)
					r.Get("/application/prompt_lib/{projectID}/{applicationID}", appHandler.Get)
					r.Put("/application/prompt_lib/{projectID}/{applicationID}", appHandler.Update)
					r.Delete("/application/prompt_lib/{projectID}/{applicationID}", appHandler.Delete)
					r.Get("/versions/prompt_lib/{projectID}/{applicationID}", appHandler.ListVersions)
					r.Post("/versions/prompt_lib/{projectID}/{applicationID}", appHandler.CreateVersion)
					r.Get("/version/prompt_lib/{projectID}/{applicationID}/{versionID}", appHandler.GetVersion)
					r.Put("/version/prompt_lib/{projectID}/{applicationID}/{versionID}", appHandler.UpdateVersion)
					r.Delete("/version/prompt_lib/{projectID}/{applicationID}/{versionID}", appHandler.DeleteVersion)
					r.Get("/default_version/prompt_lib/{projectID}/{applicationID}", appHandler.GetDefaultVersion)
					r.Patch("/default_version/prompt_lib/{projectID}/{applicationID}/{versionID}", appHandler.SetDefaultVersion)
				}

				// Agent categories
				r.Get("/agent_categories/prompt_lib/{projectID}", coreHandler.AgentCategories)

				// Skills (UI calls /skill/ and /skills/ paths)
				if cfg.SkillsRepo != nil {
					skillHandler := v2skills.NewHandler(cfg.SkillsRepo)
					r.Get("/skills/{mode}/{projectID}", skillHandler.List)
					r.Post("/skills/{mode}/{projectID}", skillHandler.Create)
					r.Get("/skill/{mode}/{projectID}/{skillID}", skillHandler.Get)
					r.Post("/skill/{mode}/{projectID}/{skillID}", skillHandler.Create)
					r.Put("/skill/{mode}/{projectID}/{skillID}", skillHandler.Update)
					r.Patch("/skill/{mode}/{projectID}/{skillID}", skillHandler.Update)
					r.Delete("/skill/{mode}/{projectID}/{skillID}", skillHandler.Delete)
					r.Patch("/skill_default_version/{mode}/{projectID}/{skillID}", skillHandler.Update)
					r.Get("/application_skills/{mode}/{projectID}/{appVersionID}", skillHandler.List)
					r.Post("/skill_import/{mode}/{projectID}", skillHandler.Create)
					r.Get("/skill_export/{mode}/{projectID}/{skillID}", skillHandler.Get)
					r.Get("/skill_export/{mode}/{projectID}/{skillID}/{versionID}", skillHandler.Get)
				}

				// Toolkits
				toolkitHandler := v2toolkits.NewHandler(cfg.Pool, cfg.ToolTester)
				// /tool(s)/ and /toolkits/ paths route to toolkitHandler (toolkit instances, not skills)
				r.Get("/tools/prompt_lib/{projectID}", toolkitHandler.List)
				r.Post("/tools/prompt_lib/{projectID}", toolkitHandler.Create)
				r.Get("/tool/prompt_lib/{projectID}/{toolkitID}", toolkitHandler.Get)
				r.Put("/tool/prompt_lib/{projectID}/{toolkitID}", toolkitHandler.Update)
				r.Patch("/tool/prompt_lib/{projectID}/{toolkitID}", toolkitHandler.Update)
				r.Delete("/tool/prompt_lib/{projectID}/{toolkitID}", toolkitHandler.Delete)
				r.Get("/toolkits/prompt_lib/{projectID}", toolkitHandler.List)
				r.Get("/toolkit_types/prompt_lib/{projectID}", toolkitHandler.ListTypes)
				r.Get("/toolkit_available_tools/prompt_lib/{projectID}/{toolkitID}", toolkitHandler.AvailableTools)
				r.Post("/toolkit_discover_tools/prompt_lib/{projectID}/{toolkitType}", toolkitHandler.DiscoverTools)
				r.Post("/toolkit_validator/prompt_lib/{projectID}/{toolkitID}", toolkitHandler.ValidateToolkit)
				r.Post("/fork_toolkit/prompt_lib/{projectID}", toolkitHandler.ForkToolkit)
				r.Post("/test_tool/prompt_lib/{projectID}/{toolID}", toolkitHandler.TestTool)
				r.Post("/test_toolkit_tool/prompt_lib/{projectID}", toolkitHandler.TestToolkitTool)
				r.Get("/export_toolkit/prompt_lib/{projectID}/{toolkitID}", toolkitHandler.ExportToolkit)
				r.Get("/index_types/prompt_lib/{projectID}", toolkitHandler.IndexTypes)
				r.Get("/index_meta/prompt_lib/{projectID}/{toolkitID}", toolkitHandler.IndexMeta)
				r.Get("/index_meta/prompt_lib/{projectID}/{toolkitID}/{indexMetaID}", toolkitHandler.IndexMetaGet)
				r.Patch("/index_meta/prompt_lib/{projectID}/{toolkitID}/{indexMetaID}", toolkitHandler.IndexMetaUpdate)
				r.Delete("/index_meta/prompt_lib/{projectID}/{toolkitID}/{indexMetaID}", toolkitHandler.IndexMetaDelete)
				r.Delete("/index_cancel/prompt_lib/{projectID}/{toolkitID}/{indexName}/{taskID}", toolkitHandler.IndexCancel)

				// Folders
				if cfg.FoldersRepo != nil {
					folderHandler := v2folders.NewHandler(cfg.FoldersRepo)
					r.Get("/folder/prompt_lib/{projectID}", folderHandler.List)
					r.Post("/folder/prompt_lib/{projectID}", folderHandler.Create)
					r.Get("/folder/prompt_lib/{projectID}/{folderID}", folderHandler.Get)
					r.Put("/folder/prompt_lib/{projectID}/{folderID}", folderHandler.Update)
					r.Patch("/folder/prompt_lib/{projectID}/{folderID}", folderHandler.Update)
					r.Delete("/folder/prompt_lib/{projectID}/{folderID}", folderHandler.Delete)
				}

				// Tags
				if cfg.TagsRepo != nil {
					tagHandler := v2tags.NewHandler(cfg.TagsRepo)
					r.Get("/tags/prompt_lib/{projectID}", tagHandler.List)
					r.Post("/tags/prompt_lib/{projectID}", tagHandler.Create)
					r.Delete("/tags/prompt_lib/{projectID}/{tagID}", tagHandler.Delete)
				}

				// Conversations
				if cfg.ConvsRepo != nil {
					convHandler := v2convs.NewHandler(cfg.ConvsRepo)
					r.Get("/conversations/prompt_lib/{projectID}", convHandler.List)
					r.Post("/conversations/prompt_lib/{projectID}", convHandler.Create)
					r.Get("/conversation/prompt_lib/{projectID}/{conversationID}", convHandler.Get)
					r.Put("/conversation/prompt_lib/{projectID}/{conversationID}", convHandler.Update)
					r.Delete("/conversation/prompt_lib/{projectID}/{conversationID}", convHandler.Delete)
					r.Get("/messages/prompt_lib/{projectID}/{conversationID}", convHandler.ListMessages)
					r.Delete("/messages/prompt_lib/{projectID}/{conversationID}", convHandler.DeleteMessages)
					r.Delete("/message/prompt_lib/{projectID}/{messageID}", convHandler.DeleteMessage)
					r.Post("/participants/prompt_lib/{projectID}/{conversationID}", convHandler.AddParticipant)
					r.Delete("/participant/prompt_lib/{projectID}/{conversationID}/{participantID}", convHandler.RemoveParticipant)
					r.Put("/entity_settings/prompt_lib/{projectID}/{conversationID}/{participantID}", convHandler.UpdateEntitySettings)
					r.Patch("/entity_settings/prompt_lib/{projectID}/{conversationID}", convHandler.BatchUpdateEntitySettings)
					r.Post("/select_conversation/prompt_lib/{projectID}/{conversationID}", convHandler.SelectConversation)
					r.Delete("/select_conversation/prompt_lib/{projectID}", convHandler.DeselectConversation)
					r.Post("/regenerate/prompt_lib/{projectID}/{conversationID}", convHandler.Regenerate)
					r.Post("/canvases/prompt_lib/{projectID}", convHandler.CreateCanvas)
					r.Get("/canvas/prompt_lib/{projectID}/{canvasID}", convHandler.GetCanvas)
					r.Put("/canvas/prompt_lib/{projectID}/{canvasID}", convHandler.UpdateCanvas)
					r.Put("/attachment_storage/prompt_lib/{projectID}/{conversationID}", convHandler.UpdateAttachmentStorage)
					r.Post("/attachments/prompt_lib/{projectID}/{conversationID}", convHandler.AddAttachments)
					r.Delete("/attachments/prompt_lib/{projectID}/{conversationID}", convHandler.DeleteAttachments)
					r.Get("/context_analytics/prompt_lib/{projectID}/{conversationID}", convHandler.GetContextAnalytics)
					r.Put("/context_strategy/prompt_lib/{projectID}/{conversationID}", convHandler.UpdateContextStrategy)
				}

				// Predict/LLM
				if cfg.Predictor != nil {
					predictHandler := v2predict.NewHandler(cfg.Predictor, cfg.LLMService)
					r.Post("/predict_llm/prompt_lib/{projectID}", predictHandler.Predict)
					r.Delete("/task/prompt_lib/{projectID}/{taskID}", predictHandler.CancelTask)
					r.Get("/application_task/prompt_lib/{projectID}/{taskID}", predictHandler.GetTask)
				}

				// Chat
				if cfg.ChatService != nil {
					chatHandler := v2chat.NewHandler(cfg.ChatService)
					r.Mount("/chat/prompt_lib/{projectID}", chatHandler.Routes())
					r.Get("/chat_config/prompt_lib/{projectID}", coreHandler.ChatConfig)
				}

				// Pipelines
				if cfg.PipelineRunner != nil {
					pipelineHandler := v2pipelines.NewHandler(cfg.PipelineRunner).WithPool(cfg.Pool)
					r.Get("/pipeline_trigger/prompt_lib/{projectID}/pipeline/{versionID}/trigger", pipelineHandler.GetTrigger)
					r.Post("/pipeline_trigger/prompt_lib/{projectID}/pipeline/{versionID}/trigger", pipelineHandler.Trigger)
					r.Put("/pipeline_trigger/prompt_lib/{projectID}/pipeline/{versionID}/trigger", pipelineHandler.UpdateTrigger)
				}

				// Batch version replacement
				if cfg.AppsRepo != nil {
					appHandler := v2apps.NewHandler(cfg.AppsRepo)
					r.Post("/batch_replace_version/prompt_lib/{projectID}/{oldVersionID}/{newVersionID}", appHandler.BatchReplaceVersion)
				}

				// Application attachment storage
				r.Put("/application_attachment_storage/prompt_lib/{projectID}/{applicationID}/{versionID}", coreHandler.UpdateAttachmentStorage)

				// Webchat (predict via version ID)
				if cfg.Predictor != nil {
					predictHandler := v2predict.NewHandler(cfg.Predictor, cfg.LLMService)
					r.Post("/webchat/prompt_lib/{projectID}/{versionID}", predictHandler.Predict)
				}

				// Generate drafts (forward to predict/indexer)
				if cfg.Predictor != nil {
					predictHandler := v2predict.NewHandler(cfg.Predictor, cfg.LLMService)
					r.Post("/generate_application_draft/prompt_lib/{projectID}", predictHandler.Predict)
					r.Post("/generate_skill_draft/prompt_lib/{projectID}", predictHandler.Predict)
					r.Post("/generate_project_context_draft/prompt_lib/{projectID}", predictHandler.Predict)
				}

				// Fork
				r.Post("/fork/prompt_lib/{projectID}", coreHandler.ExportImportPost)

				// Publishing
				r.Post("/publish/prompt_lib/{projectID}/{versionID}", coreHandler.Publish)
				r.Post("/unpublish/prompt_lib/{projectID}/{versionID}", coreHandler.Unpublish)
				r.Get("/publish_validate/prompt_lib/{projectID}/{versionID}", coreHandler.PublishValidate)
				r.Post("/publish_validate/prompt_lib/{projectID}/{versionID}", coreHandler.PublishValidate)
				r.Post("/version_validator/prompt_lib/{projectID}/{applicationID}/{versionID}", coreHandler.VersionValidator)
				r.Get("/version_validator/prompt_lib/{projectID}/{applicationID}/{versionID}", coreHandler.VersionValidator)

				// Public applications
				r.Get("/public_applications/prompt_lib", coreHandler.PublicApplications)
				r.Get("/public_applications/prompt_lib/", coreHandler.PublicApplications)
				r.Get("/public_application/prompt_lib/{applicationID}", coreHandler.PublicApplications)
				r.Get("/public_application/prompt_lib/{applicationID}/{versionName}", coreHandler.PublicApplications)

				// Check version in use
				r.Get("/check_version_in_use/prompt_lib/{projectID}/{appID}/{versionID}", coreHandler.ApplicationRelation)

				// Authors / trending
				r.Get("/author/prompt_lib/{authorID}", coreHandler.Author)
				r.Get("/trending_authors/prompt_lib/{projectID}", coreHandler.TrendingAuthors)

				// Moderation
				r.Get("/moderation_status/{mode}/{projectID}/{entityID}", coreHandler.ModerationStatus)

				// Application relations
				r.Get("/application_relation/prompt_lib/{projectID}/{appID}/{versionID}", coreHandler.ApplicationRelation)
				r.Patch("/application_relation/prompt_lib/{projectID}/{appID}/{versionID}", coreHandler.ApplicationRelation)

				// Recommendations
				r.Get("/recommendations/prompt_lib/{projectID}", coreHandler.Recommendations)

				// Feedbacks
				r.Get("/feedbacks/default/{projectID}", coreHandler.Feedbacks)

				// Analytics (flat paths matching UI expectations)
				if cfg.AnalyticsRepo != nil {
					analyticsHandler := v2analytics.NewHandler(cfg.AnalyticsRepo)
					r.Get("/analytics/prompt_lib/{projectID}", analyticsHandler.Usage)
					r.Get("/analytics_agents/prompt_lib/{projectID}", analyticsHandler.Agents)
					r.Get("/analytics_agent_detail/prompt_lib/{projectID}", analyticsHandler.Agents)
					r.Get("/analytics_tools/prompt_lib/{projectID}", analyticsHandler.Tools)
					r.Get("/analytics_tool_detail/prompt_lib/{projectID}", analyticsHandler.Tools)
					r.Get("/analytics_users/prompt_lib/{projectID}", analyticsHandler.Users)
					r.Get("/analytics_user_detail/prompt_lib/{projectID}", analyticsHandler.Users)
				}

				// Icons
				r.Get("/default_icons/prompt_lib/{projectID}", coreHandler.DefaultIcons)
				r.Get("/upload_icon/prompt_lib/{projectID}", coreHandler.ListUploadedIcons)
				r.Post("/upload_icon/prompt_lib/{projectID}", coreHandler.UploadIcon)
				r.Post("/upload_icon/prompt_lib/{projectID}/{entityID}", coreHandler.UploadIcon)
				r.Put("/upload_icon/prompt_lib/{projectID}/{versionId}", coreHandler.UpdateIcon)
				r.Delete("/upload_icon/prompt_lib/{projectID}/{name}", coreHandler.DeleteIcon)

				// Export/Import
				r.Post("/export_import/prompt_lib/{projectID}/{entityID}", coreHandler.ExportImportPost)
				r.Get("/export_import/prompt_lib/{projectID}/{entityID}", coreHandler.ExportImportGet)
				r.Post("/export_converter/prompt_lib", coreHandler.ExportConverter)

				// Pin
				r.Post("/pin/prompt_lib/{projectID}/{entityType}/{entityID}", coreHandler.Pin)
				r.Delete("/pin/prompt_lib/{projectID}/{entityType}/{entityID}", coreHandler.Unpin)

				// Project info/context
				r.Get("/project_info/prompt_lib/{projectID}/project-info", coreHandler.ProjectInfo)
				r.Put("/project_info/prompt_lib/{projectID}/project-info", coreHandler.UpdateProjectInfo)
				r.Get("/project_icon/prompt_lib/{projectID}", coreHandler.ListProjectIcons)
				r.Post("/project_icon/prompt_lib/{projectID}", coreHandler.CreateProjectIcon)
				r.Delete("/project_icon/prompt_lib/{projectID}/{name}", coreHandler.DeleteProjectIcon)
				r.Get("/project_context/prompt_lib/{projectID}/project-context", coreHandler.ProjectContext)
				r.Put("/project_context/prompt_lib/{projectID}/project-context", coreHandler.UpdateProjectContext)

				// Platform settings
				r.Get("/platform_settings/prompt_lib/{projectID}", coreHandler.PlatformSettings)
				r.Get("/platform_settings/prompt_lib", coreHandler.PlatformSettings)

				// Search
				r.Get("/search_options/prompt_lib/{projectID}", coreHandler.SearchOptions)

				// MCP OAuth & sync
				r.Post("/mcp_oauth_proxy/{projectID}", coreHandler.MCPOAuthProxy)
				r.Post("/mcp_dcr_proxy/{projectID}", coreHandler.MCPDCRProxy)
				r.Post("/mcp_sync_tools/prompt_lib/{projectID}", coreHandler.MCPSyncTools)

				// Import wizard
				r.Post("/import_wizard/prompt_lib/{projectID}", coreHandler.ExportImportPost)

				// Users / Roles (served under /admin/ for UI compat, registered here as fallback)
				r.Get("/users/{mode}/{projectID}", coreHandler.Users)
				r.Get("/roles/{mode}/{projectID}", coreHandler.Roles)
				r.Get("/permissions/prompt_lib/{projectID}", coreHandler.Permissions)

				// Admin panel audit & service descriptors
				r.Get("/admin/{mode}", coreHandler.ServiceDescriptors)
				r.Get("/audit_traces/{mode}", coreHandler.AuditTraces)
				r.Get("/audit_trace_heatmap/{mode}", coreHandler.AuditTraceHeatmap)
			})

			// === Social plugin ===
			r.Mount("/social", v2social.NewHandler(cfg.Pool).Routes())

			// === Artifacts ===
			artifactHandler := v2artifacts.NewInMemoryHandler()
			r.Route("/artifacts", func(r chi.Router) {
				// Bucket CRUD
				r.Get("/buckets/default/{projectID}", artifactHandler.ListBuckets)
				r.Post("/buckets/default/{projectID}", artifactHandler.CreateBucket)
				r.Put("/buckets/default/{projectID}", artifactHandler.UpdateBucket)
				r.Patch("/buckets/default/{projectID}", artifactHandler.PatchBucket)
				r.Delete("/buckets/default/{projectID}", artifactHandler.DeleteBucket)
				// Artifact CRUD (list + upload + legacy JSON create + delete single + bulk delete)
				r.Get("/artifacts/default/{projectID}/{bucket}", artifactHandler.ListArtifacts)
				r.Post("/artifacts/default/{projectID}/{bucket}", artifactHandler.UploadArtifact)
				r.Delete("/artifacts/default/{projectID}/{bucket}", artifactHandler.DeleteArtifacts)
				r.Get("/artifact/default/{projectID}/{bucket}", artifactHandler.GetArtifact)
				r.Post("/artifact/default/{projectID}/{bucket}", artifactHandler.CreateArtifact)
				r.Delete("/artifact/default/{projectID}/{bucket}", artifactHandler.DeleteArtifact)
			})

			// === Context Manager ===
			ctxMgrHandler := v2contextmgr.NewHandler(cfg.Pool)
			r.Route("/context_manager", func(r chi.Router) {
				r.Post("/optimize_context/{projectID}/{conversationID}", ctxMgrHandler.OptimizeContext)
				r.Get("/analytics/{projectID}/{conversationID}", ctxMgrHandler.GetAnalytics)
				r.Get("/summaries/{projectID}/{conversationID}", ctxMgrHandler.ListSummaries)
				r.Post("/summaries/{projectID}/{conversationID}", ctxMgrHandler.CreateSummary)
				r.Put("/summary/{projectID}/{conversationID}/{summaryID}", ctxMgrHandler.UpdateSummary)
				r.Delete("/summary/{projectID}/{conversationID}/{summaryID}", ctxMgrHandler.DeleteSummary)
			})

			// === Support Assistant ===
			r.Route("/support_assistant", func(r chi.Router) {
				r.Get("/config/", coreHandler.SupportConfig)
				r.Get("/config", coreHandler.SupportConfig)
			})

			// === Webhooks ===
			if cfg.WebhookRepo != nil {
				r.Mount("/webhooks/prompt_lib/{projectID}", webhook.NewHandler(cfg.WebhookRepo).Routes())
			}

			// === Events (SSE) ===
			if cfg.EventSource != nil {
				r.Mount("/events/prompt_lib/{projectID}", v2events.NewHandlerFromSource(cfg.EventSource).Routes())
			} else if cfg.RedisClient != nil {
				r.Mount("/events/prompt_lib/{projectID}", v2events.NewHandler(cfg.RedisClient).Routes())
			}
		})
	})

	if cfg.LLMProxy != nil {
		r.Group(func(r chi.Router) {
			r.Use(apimw.Auth(apimw.AuthConfig{
				Client:                    cfg.AuthClient,
				Validator:                 cfg.AuthValidator,
				PrincipalValidator:        cfg.PrincipalValidator,
				ForwardedIdentityVerifier: cfg.Auth.ForwardedIdentityVerifier,
				SessionSecret:             cfg.SessionSecret,
				TrustedProxyCIDRs:         cfg.Auth.TrustedProxyCIDRs,
			}))
			r.Use(apimw.Project(apimw.ProjectConfig{Resolver: cfg.LLMProjectResolver}))
			r.Mount("/llm", cfg.LLMProxy)
		})
	}

	return r
}

func mountArtifactS3Routes(
	r chi.Router,
	handler *v2artifacts.S3Handler,
	authenticate func(http.Handler) http.Handler,
	resolver platformauth.PermissionResolver,
) {
	projectID := apimw.ProjectIDFromQuery("project_id")
	view := apimw.RequireResolvedPermissionsForProject(
		resolver,
		platformauth.PermissionModeDefault,
		projectID,
		"configuration.artifacts.artifacts.view",
	)
	create := apimw.RequireResolvedPermissionsForProject(
		resolver,
		platformauth.PermissionModeDefault,
		projectID,
		"configuration.artifacts.artifacts.create",
	)
	deleteObject := apimw.RequireResolvedPermissionsForProject(
		resolver,
		platformauth.PermissionModeDefault,
		projectID,
		"configuration.artifacts.artifacts.delete",
	)

	r.Route("/artifacts/s3", func(r chi.Router) {
		r.Use(authenticate)
		r.With(view).Get("/", handler.ListBuckets)
		r.With(view).Get("/{bucket}", handler.ListObjects)
		r.With(view).Get("/{bucket}/*", handler.GetObject)
		r.With(create).Put("/{bucket}/*", handler.PutObject)
		r.With(deleteObject).Delete("/{bucket}/*", handler.DeleteObject)
	})
}

func mountRuntimeRoutes(router chi.Router, routes RuntimeRoutes) {
	// A partial composition is not exposed. Both public runtime paths share the
	// same authenticated-principal provenance and strict PostgreSQL membership
	// authorizer, so mounting only one is a startup wiring error and fails closed.
	if routes.Validation == nil || routes.ExecutionEvents == nil {
		return
	}
	router.Method(http.MethodPost, runtimeValidationPath, routes.Validation)
	router.Method(http.MethodGet, runtimeEventsPath, routes.ExecutionEvents)
}

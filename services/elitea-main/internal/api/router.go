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
	v2configs "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/configurations"
	v2contextmgr "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/contextmgr"
	v2convs "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/conversations"
	v2core "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/eliteacore"
	v2events "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/events"
	v2folders "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/folders"
	v2indextypes "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/indextypes"
	v2mcp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/mcp"
	v2moderation "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/moderation"
	v2openapidocs "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/openapidocs"
	v2projectinfo "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/projectinfo"
	v2projects "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/projects"
	v2promptcontextreads "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/promptcontextreads"
	v2scheduling "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/scheduling"
	v2secrets "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/secrets"
	v2skillpublish "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/skillpublish"
	v2skills "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/skills"
	v2social "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/social"
	v2tags "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/tags"
	v2toolkits "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/toolkits"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/webhook"
	platformauth "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/cutover"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/applications"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/authsvc"
	dbrepos "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
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

// NOTE(#126): IndexerDeps and its six fields — Predictor, LLMService,
// ChatService, PipelineRunner, ToolTester, MCPSyncer — used to live here. They
// were projections onto internal/infra/indexersvc, a prototype Redis RPC client
// that published raw JSON to the `elitea_rpc` channel that pylon-indexer serves
// through arbiter's gzip+pickle codec, so every call was silently dropped.
// Nothing ever assigned them outside tests, so the twelve routes they gated
// 404'd in every deployment.
//
// They are gone rather than fixed because the replacement transport already
// ships: runtimecomposition + the Redis command stream + services/
// elitea-worker-python, deployed in deploy/centry-hybrid/pov-compose.yml, and
// elitea-docs' spec-transport-implementation.mdx lists indexersvc/rpc.go under
// "Delete after bounded dispatch/control/output adapters land". They landed.
//
// The capabilities those routes were the last visible trace of are recorded so
// they are not lost with the code: #192 (inbound webhook pipeline trigger),
// #193 (scheduled pipeline execution), #93 (chat dispatch/streaming migration),
// #194 (AI draft generation, tool testing and MCP tool sync have no backend).

type RouterConfig struct {
	Auth               AuthDeps
	AuthClient         *authsvc.Client
	AuthValidator      apimw.TokenValidator
	PrincipalValidator apimw.PrincipalValidator
	SessionHandler     *v2auth.SessionHandler
	OIDCHandler        *v2auth.OIDCHandler
	HealthDeps         health.Deps
	Pool               *pgxpool.Pool
	// ArtifactPermissionResolver overrides the legacyrbac.NewPostgresResolver
	// built from Pool for the artifact routes only (S11) — tests inject a
	// resolver here to control RBAC outcomes without a live database. Every
	// other route keeps using the Pool-backed resolver regardless of this
	// field.
	ArtifactPermissionResolver platformauth.PermissionResolver
	// ArtifactHandler overrides newArtifactHandler's Pool/ObjectStore-backed
	// construction (S11) — newArtifactHandler always builds real
	// Postgres-backed repositories from Pool with no injection seam, so a
	// router-level test proving a genuine 2xx through the full auth/RBAC/
	// handler chain (as opposed to just "reached past the stub") has no
	// other way to supply a working fake Repository/ObjectStore pair.
	ArtifactHandler *v2artifacts.Handler
	AppsRepo        applications.Repository
	SkillsRepo      v2skills.Repository
	FoldersRepo     v2folders.Repository
	TagsRepo        v2tags.Repository
	AnalyticsRepo   v2analytics.Repository
	ConvsRepo       v2convs.Repository
	WebhookRepo     webhook.Repository
	RedisClient     *goredis.Client
	EventSource     v2events.EventSource
	Shadow          *shadow.Comparator
	ShadowMetrics   *shadow.Metrics
	CutoverTracker  *cutover.Tracker
	CutoverRouter   *cutover.Router
	AdminUI         *adminui.Config
	// ObjectStore is the new S3/Azure/GCS-compatible backend (see
	// docs/plans/storage-migration-plan.md). S8 reads it for the bucket-plane
	// DELETE cascade, but only inside newProductionRouter — it is
	// not on any production request path until S11 mounts the new artifact
	// routes there.
	ObjectStore      storage.ObjectStore
	BudgetAlertStore *gateway.BudgetAlertStore
	SessionSecret    string
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
	CurrentSocialAvatar           *v2social.CurrentAvatarRoute
	CurrentConfigurationAvailable http.Handler
	CurrentConfigurationRead      http.Handler
	CurrentConfigurationTypes     http.Handler
	CurrentConfigurationMutation  http.Handler
	CurrentIndexStart             http.Handler
	CurrentAgentStart             http.Handler
	CurrentAgentCancel            http.Handler
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
	// GatewayProxy is the mTLS streaming reverse proxy to elitea-llm-gateway-svc
	// (BF0.9c). When non-nil, it is mounted at /llm with Auth+Project middleware
	// in the production router.
	GatewayProxy           http.Handler
	GatewayProjectResolver apimw.PersonalProjectResolver
}

type RuntimeRoutes struct {
	Validation      http.Handler
	ExecutionEvents http.Handler
}

const (
	runtimeValidationPath = "/configurations/validation/{projectID}/{configurationRevisionID}"
	runtimeEventsPath     = "/executions/{projectID}/{executionID}/events"
)

// notImplementedArtifact is the S7 placeholder for every new artifact route
// this stage registers but does not yet implement — S8, S9, and S15 each
// replace it at their own paths. It returns the same typed error envelope
// (components/schemas/Error in api/openapi/v2.yaml) real artifact handlers
// use for every other error response, rather than a bare 501.
func notImplementedArtifact(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotImplemented)
	_, _ = w.Write([]byte(`{"error":{"code":"NotImplemented","message":"pending S8/S9"}}`))
}

// artifactRepoAdapter satisfies v2artifacts.Repository by embedding both S6
// repositories — they share no method names, so Go's method promotion does
// the rest. Neither constructor accepts a nil pool without erroring, unlike
// most other prototype-router dependencies, so newArtifactHandler below
// builds this only when cfg.Pool and cfg.ObjectStore are both set.
type artifactRepoAdapter struct {
	*dbrepos.ArtifactBucketsRepository
	*dbrepos.ArtifactObjectsRepository
	*dbrepos.ArtifactTransferGrantsRepository
}

// newArtifactHandler builds the S6/S1-backed artifacts.Handler when
// cfg.Pool and cfg.ObjectStore are both available. ok is false when either
// is unset or repository construction fails, in which case every artifact
// route stays on notImplementedArtifact — the same placeholder S7
// registered for all of them, so a router built without database/storage
// config (as most tests do) keeps behaving exactly as it did before S8/S9.
func newArtifactHandler(cfg RouterConfig) (h *v2artifacts.Handler, ok bool) {
	if cfg.Pool == nil || cfg.ObjectStore == nil {
		return nil, false
	}
	bucketsRepo, err := dbrepos.NewArtifactBucketsRepository(cfg.Pool)
	if err != nil {
		return nil, false
	}
	objectsRepo, err := dbrepos.NewArtifactObjectsRepository(cfg.Pool)
	if err != nil {
		return nil, false
	}
	grantsRepo, err := dbrepos.NewArtifactTransferGrantsRepository(cfg.Pool)
	if err != nil {
		return nil, false
	}
	return v2artifacts.NewHandler(artifactRepoAdapter{bucketsRepo, objectsRepo, grantsRepo}, cfg.ObjectStore), true
}

// Permission strings from the existing configuration.artifacts.artifacts
// catalog (S11). edit is easy to miss — legacy uses it for retention and pin
// changes (PATCH), distinct from create (uploads, bucket/grant creation) and
// delete (DELETE, :batchDelete).
const (
	artifactPermissionView   = "configuration.artifacts.artifacts.view"
	artifactPermissionCreate = "configuration.artifacts.artifacts.create"
	artifactPermissionEdit   = "configuration.artifacts.artifacts.edit"
	artifactPermissionDelete = "configuration.artifacts.artifacts.delete"
)

// ArtifactDeps is mountArtifactRoutes' dependency bundle. Handler nil means
// every route falls back to notImplementedArtifact — the same degrade S7-S10
// already rely on — while Authenticate/Resolver still gate every request, so
// auth/RBAC enforcement never depends on the storage backend being wired.
type ArtifactDeps struct {
	Handler      *v2artifacts.Handler
	Authenticate func(http.Handler) http.Handler
	Resolver     platformauth.PermissionResolver
}

// mountArtifactRoutes registers all 16 artifact routes (13 from S7, plus
// S16's 3 native-multipart continuation routes) on r, wrapped in
// deps.Authenticate and per-route RBAC (S11). Called once, from
// newProductionRouter, so the oapiserver conformance suite and production
// see an identical route shape. Deliberately NOT nested inside the
// shadow-wrapped /api/v2 group: the shadow middleware buffers the entire
// response into a bytes.Buffer and has no Unwrap method, which would defeat
// ResponseController deadlines and buffer every downloaded object in memory
// (S12).
func mountArtifactRoutes(r chi.Router, deps ArtifactDeps) {
	view := apimw.RequireResolvedPermissions(deps.Resolver, platformauth.PermissionModeDefault, artifactPermissionView)
	create := apimw.RequireResolvedPermissions(deps.Resolver, platformauth.PermissionModeDefault, artifactPermissionCreate)
	edit := apimw.RequireResolvedPermissions(deps.Resolver, platformauth.PermissionModeDefault, artifactPermissionEdit)
	del := apimw.RequireResolvedPermissions(deps.Resolver, platformauth.PermissionModeDefault, artifactPermissionDelete)

	listBuckets, createBucket, getBucket, updateBucket, deleteBucket := notImplementedArtifact, notImplementedArtifact, notImplementedArtifact, notImplementedArtifact, notImplementedArtifact
	listObjects, uploadObject, batchDeleteObjects, downloadObject, statObject, deleteObject := notImplementedArtifact, notImplementedArtifact, notImplementedArtifact, notImplementedArtifact, notImplementedArtifact, notImplementedArtifact
	createTransferGrant, commitTransferGrant := notImplementedArtifact, notImplementedArtifact
	presignUploadPart, completeMultipartUpload, abortMultipartUpload := notImplementedArtifact, notImplementedArtifact, notImplementedArtifact
	if deps.Handler != nil {
		listBuckets, createBucket, getBucket, updateBucket, deleteBucket =
			deps.Handler.ListBuckets, deps.Handler.CreateBucket, deps.Handler.GetBucket, deps.Handler.UpdateBucket, deps.Handler.DeleteBucket
		listObjects, uploadObject, batchDeleteObjects, downloadObject, statObject, deleteObject =
			deps.Handler.ListObjects, deps.Handler.UploadObject, deps.Handler.BatchDeleteObjects, deps.Handler.DownloadObject, deps.Handler.StatObject, deps.Handler.DeleteObject
		createTransferGrant, commitTransferGrant = deps.Handler.CreateTransferGrant, deps.Handler.CommitTransferGrant
		presignUploadPart, completeMultipartUpload, abortMultipartUpload =
			deps.Handler.PresignUploadPart, deps.Handler.CompleteMultipartUpload, deps.Handler.AbortMultipartUpload
	}

	r.Group(func(r chi.Router) {
		r.Use(deps.Authenticate)
		r.Route("/api/v2/artifacts", func(r chi.Router) {
			// Bucket plane — S8.
			r.With(view).Get("/buckets/{projectID}", listBuckets)
			r.With(create).Post("/buckets/{projectID}", createBucket)
			r.With(view).Get("/buckets/{projectID}/{bucket}", getBucket)
			r.With(edit).Patch("/buckets/{projectID}/{bucket}", updateBucket)
			r.With(del).Delete("/buckets/{projectID}/{bucket}", deleteBucket)

			// Object plane — S9. The three key-bearing routes use a trailing
			// chi wildcard, not the spec's literal {key} — see S7/S9 for why.
			r.With(view).Get("/objects/{projectID}/{bucket}", listObjects)
			r.With(create).Post("/objects/{projectID}/{bucket}", uploadObject)
			r.With(del).Post("/objects/{projectID}/{bucket}:batchDelete", batchDeleteObjects)
			r.With(view).Get("/objects/{projectID}/{bucket}/*", downloadObject)
			r.With(view).Head("/objects/{projectID}/{bucket}/*", statObject)
			r.With(del).Delete("/objects/{projectID}/{bucket}/*", deleteObject)

			// Transfer grants — S15. create for both: grant creation is
			// explicitly create per S11; commit is the write half of the same
			// grant lifecycle and the plan does not distinguish it.
			r.With(create).Post("/grants/{projectID}/{bucket}", createTransferGrant)
			r.With(create).Post("/grants/{projectID}/{grantID}:commit", commitTransferGrant)

			// Native multipart upload continuation — S16. Same permission
			// tier as the grant routes above: a part presign, a complete, and
			// an abort are all steps of the same create-time write lifecycle
			// CreateTransferGrant started, not a distinct RBAC category the
			// plan introduces.
			r.With(create).Post("/grants/{projectID}/{grantID}/parts/{partNumber}", presignUploadPart)
			r.With(create).Post("/grants/{projectID}/{grantID}:completeMultipart", completeMultipartUpload)
			r.With(create).Post("/grants/{projectID}/{grantID}:abortMultipart", abortMultipartUpload)
		})
	})
}

// mountMCPServerRoutes registers the MCP server endpoints (issue 252 P2/P3) —
// the streamable-HTTP surface external MCP clients speak to.
//
//	GET|POST /app/{projectID}/mcp
//	GET|POST /app/{projectID}/mcp/{category}
//	GET|POST /app/{projectID}/mcp/{entity}/{entityVersionID}
//
// Mounted on its own Auth-wrapped subrouter for the same reason the artifact
// routes are: these paths live outside /api/v2 (pylon serves them from the app
// blueprint, and the internal-toolkit URLs written into existing projects
// hardcode `/app/{project_id}/mcp/...`), so they cannot inherit the /api/v2
// group's middleware, and they must not inherit shadow's response buffering.
//
// RequireProjectAccess is unconditional here. The endpoint reads one tenant's
// agents and toolkits by name, and authentication alone would let any
// authenticated PAT holder enumerate the tool inventory of a project they have
// nothing to do with. There is no client to regress, because these routes are
// new in this change — the same argument the skill-publishing block makes above.
//
// The two path variants are registered separately rather than as one wildcard
// because chi will not match a bare `/app/{projectID}/mcp` against a `/*`
// pattern; the handler reads the tail with chi.URLParam(r, "*"), which is empty
// for the first pair.
func mountMCPServerRoutes(r chi.Router, pool *pgxpool.Pool, authenticate func(http.Handler) http.Handler) {
	handler := v2mcp.NewHandler(pool)
	r.Group(func(r chi.Router) {
		r.Use(authenticate)
		r.Use(apimw.RequireProjectAccess(pool))
		r.Get("/app/{projectID}/mcp", handler.Endpoint)
		r.Post("/app/{projectID}/mcp", handler.Endpoint)
		r.Get("/app/{projectID}/mcp/*", handler.Endpoint)
		r.Post("/app/{projectID}/mcp/*", handler.Endpoint)
	})
}

// newProductionRouter is the single route composition NewRouter builds. It
// carries the broad legacy-parity registration map alongside
// mountReviewedProductionRoutes (called at the end, below) because that is
// what cmd/elitea-main/main.go's composition root has always assembled: most
// of the routes registered here have not been assigned an exact legacy route
// policy, but real deployments need them anyway (#243).
func newProductionRouter(cfg RouterConfig) chi.Router {
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

	// S20b: serves what coreHandler.UploadIcon (mounted further below, S9
	// object-store-backed) writes — public/unauthenticated for the same
	// reason as the two routes above: a browser <img src="..."> carries no
	// Authorization header.
	r.Get("/icons/{projectID}/{filename}", v2core.DownloadIcon(cfg.ObjectStore))
	// Social avatar: serves what CurrentSocialAvatar's upload handler writes,
	// public/unauthenticated for the same reason as /icons above.
	r.Get(v2social.CurrentAvatarDownloadPath, v2social.DownloadAvatar(cfg.ObjectStore))
	// The UI loads branding before a browser session exists, so this exact
	// static bootstrap route must remain public in both current-main and PoV.
	brandingHandler := v2branding.NewHandler(v2branding.Config{PackPath: os.Getenv("BRAND_PACK_PATH")})
	r.Get("/api/v2/branding/bootstrap.js", brandingHandler.Bootstrap)
	r.Head("/api/v2/branding/bootstrap.js", brandingHandler.Bootstrap)

	// Served API docs (S251): the legacy shared plugin's openapi/swagger-ui
	// routes had no Go counterpart at all — public/unauthenticated like the
	// branding bootstrap above, since API documentation predates any session.
	openapiDocsHandler := v2openapidocs.NewHandler()
	r.Get("/api/openapi.yaml", openapiDocsHandler.Spec)
	r.Get("/api/openapi.json", openapiDocsHandler.SpecJSON)
	r.Get("/docs", openapiDocsHandler.UI)

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

	// Artifacts (S11): mounted here, outside the shadow-wrapped group below,
	// on its own Auth-wrapped subrouter so it never inherits shadow's
	// response buffering.
	artifactResolver := cfg.ArtifactPermissionResolver
	if artifactResolver == nil {
		artifactResolver = permissionResolver
	}
	artifactHandler := cfg.ArtifactHandler
	if artifactHandler == nil {
		artifactHandler, _ = newArtifactHandler(cfg)
	}
	authenticate := apimw.Auth(apimw.AuthConfig{
		Client:                    cfg.AuthClient,
		Validator:                 cfg.AuthValidator,
		PrincipalValidator:        cfg.PrincipalValidator,
		ForwardedIdentityVerifier: cfg.Auth.ForwardedIdentityVerifier,
		SessionSecret:             cfg.SessionSecret,
		TrustedProxyCIDRs:         cfg.Auth.TrustedProxyCIDRs,
	})
	mountArtifactRoutes(r, ArtifactDeps{
		Handler:      artifactHandler,
		Authenticate: authenticate,
		Resolver:     artifactResolver,
	})

	// The MCP server (issue 252). Outside the /api/v2 group for the reasons in
	// mountMCPServerRoutes.
	mountMCPServerRoutes(r, cfg.Pool, authenticate)

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
				v2core.WithObjectStore(cfg.ObjectStore),
			)

			// === Auth endpoints ===
			r.Mount("/auth", v2auth.NewHandler(
				cfg.Pool,
				v2auth.WithPermissionResolver(permissionResolver),
				v2auth.WithTokenSigningKey(cfg.SessionSecret),
			).Routes())

			// === Projects endpoints ===
			r.Mount("/projects", v2projects.NewHandler(cfg.Pool).Routes())

			// === Admin endpoints ===
			adminHandler := admin.NewHandler(cfg.Pool, admin.WithPermissionResolver(permissionResolver))
			moderationHandler := v2moderation.NewHandler(cfg.Pool)
			// The admin panel's surface. Every route below is gated on the same
			// pylon permission its Python counterpart declares in
			// legacy/plugins/admin/api/v2/, resolved from the database in
			// `administration` mode. The admin SPA's
			// `window.admin_ui_config.permissions` is PRESENTATION state and is
			// never consulted here.
			//
			// Unit A14 gated the auth_users WRITES only and left that listing —
			// and the whole plugin-config/runtime block — open, to avoid a
			// behaviour change with blast radius outside that unit: no
			// deployment bootstrapped by elitea-migrate had a single
			// administration-mode role, so gating a read would have turned
			// "the admin panel works" into "403 for everyone". That is fixed at
			// the source — migrations/shared/0060_admin_central_rbac.sql seeds
			// the administration roles and their grants, and
			// internal/infra/db/migrations/001_initial.sql seeds them on a fresh
			// database — so the remaining reads are gated to match pylon too.
			//
			// Read this as the parity table it is. `mode` in the URL does NOT
			// select the permission mode: pylon reaches these handlers only
			// through its `administration` AdminAPI, so the resolution mode is
			// always `administration`.
			central := func(permission string) func(http.Handler) http.Handler {
				return apimw.RequireCentralPermissions(
					permissionResolver, platformauth.PermissionModeAdministration,
					permission,
				)
			}
			// auth_users.py, user_suspend.py
			requireAdminUsers := central("admin.auth.users")
			// system_info.py, plugin_config_*.py, maintenance.py, runtime_*.py,
			// tasks.py, active_tasks.py — all declare ["runtime.plugins"].
			requireRuntimePlugins := central("runtime.plugins")
			// moderation_status.py / moderation_statuses.py. The queue itself is
			// registered further down, next to the three other moderation routes
			// this unit added, so all four read as one surface.
			requireModeration := central("admin.moderation")
			// The admin PROJECTS surface. projects.py declares
			// `projects.projects.projects.view` and project_suspend.py declares
			// `projects.projects.projects.edit`.
			//
			// The listing is gated rather than open: a project row names the
			// project, its owner and its admins across every tenant, so the
			// listing itself is the sensitive part. The same argument applies
			// verbatim to the admin USER listing, which was left open only
			// because it predated the migration that makes any of this
			// resolvable.
			requireProjectsView := central("projects.projects.projects.view")
			requireProjectsEdit := central("projects.projects.projects.edit")
			r.Route("/admin", func(r chi.Router) {
				// Admin panel endpoints (administration mode, no projectID)
				//
				// The two `prompt_lib` routes stay open ON PURPOSE. They are the
				// help-center's version/resource lookup, reached in pylon through
				// `PromptLibAPI`, whose `get()` carries NO check_api decorator at
				// all (system_info.py, plugin_config_values.py) — unlike the
				// `AdminAPI` siblings one line below. chi matches a static
				// segment ahead of a `{param}`, so these keep winning over
				// `/system_info/{mode}` and `/plugin_config_values/{mode}/{plugin}`.
				r.Get("/system_info/prompt_lib", adminHandler.SystemInfo)
				// The Help Center's own read (unit A14). pylon exposes exactly
				// ONE config section to non-administrators —
				// `_PUBLIC_SECTIONS = {"resources"}` in
				// legacy/plugins/admin/api/v2/plugin_config_values.py — and this
				// route is restricted the same way, by being a route rather than
				// a `{section}` parameter a caller could substitute. It now
				// serves that section; it used to return chat and upload limits,
				// which is why every Help Center card said "No links configured".
				r.Get("/plugin_config_values/prompt_lib/resources", adminHandler.PromptLibResourcesValues)

				r.With(requireRuntimePlugins).Get("/system_info/{mode}", adminHandler.SystemInfo)
				// Before this gate any authenticated session could read the
				// global user list — id, name, email, last_login, suspended and
				// administration role for every row of auth_core__user.
				r.With(requireAdminUsers).Get("/auth_users/{mode}", adminHandler.AuthUsers)
				r.With(requireAdminUsers).Post("/auth_users/{mode}", adminHandler.AuthUsersAction)
				r.With(requireAdminUsers).Put("/user_suspend/{mode}/{userID}", adminHandler.UserSuspend)
				// The admin Roles page. Before it, only the GET existed —
				// ungated, ignoring {scope}, and listing only already-granted
				// permissions. See internal/api/v2/admin/roles.go.
				//
				// Gated on the permissions the pylon originals declare
				// (`configuration.roles.permissions.view` / `.edit`,
				// legacy/plugins/admin/api/v2/permissions.py), resolved from
				// auth_core__user_role per request. The read is gated too: this
				// matrix is the deployment's authorisation model, and knowing
				// which role holds which privilege is itself sensitive.
				requireRolesView := central("configuration.roles.permissions.view")
				requireRolesEdit := central("configuration.roles.permissions.edit")
				r.With(requireRolesView).Get("/permissions/{scope}/{mode}", adminHandler.AdminPermissions)
				r.With(requireRolesEdit).Put("/permissions/{scope}/{mode}", adminHandler.AdminPermissionsSave)
				r.With(requireRolesEdit).Post("/permissions/{scope}/{mode}", adminHandler.AdminPermissionsSync)
				r.With(requireProjectsView).Get("/projects/{mode}", adminHandler.Projects)
				// `ProjectSuspend` existed in the admin package before this unit
				// but was mounted on NO route — dead code with no caller. It is
				// the only project WRITE this unit implements: create and delete
				// are multi-system provisioning pipelines (tenant schema, object
				// storage, vault, RabbitMQ, InfluxDB, a system user and its
				// token — legacy/plugins/projects/utils/project_steps.py) and
				// are rendered unavailable in the UI rather than guessed at here.
				r.With(requireProjectsEdit).
					Put("/project_suspend/{mode}/{projectID}", adminHandler.ProjectSuspend)
				r.With(requireRuntimePlugins).Get("/plugin_config_schemas/{mode}", adminHandler.PluginConfigSchemas)
				// The admin Configuration page's read and write (unit A14).
				// The `{mode}` pair they replace answered 200 for EVERY section:
				// the GET with the schema's defaults for all of them at once
				// (ignoring the segment), the PUT with an empty object and a
				// success flag, without decoding its request body.
				//
				// `administration` is a STATIC segment, so chi's trie prefers it
				// and a static segment binds no `{mode}` parameter — the trap
				// #207's test caught. These handlers state their mode rather
				// than sniffing it from the URL. Sections that additionally
				// declare a `required_permission` are checked INSIDE the
				// handler, because that permission depends on the section and
				// route middleware cannot see it.
				//
				// pylon registers no handler for any other mode on this path
				// except `prompt_lib`/resources above, so there is deliberately
				// no `{mode}` fallback: another mode 404s rather than being
				// answered with something plausible.
				r.With(requireRuntimePlugins).
					Get("/plugin_config_values/administration/{plugin}", adminHandler.AdministrationPluginConfigValues)
				r.With(requireRuntimePlugins).
					Put("/plugin_config_values/administration/{plugin}", adminHandler.AdministrationPluginConfigValuesSave)
				r.With(requireRuntimePlugins).Get("/plugin_config_suggestions/{mode}/{key}", adminHandler.PluginConfigSuggestions)
				r.With(requireRuntimePlugins).Post("/plugin_config_restart/{mode}/{pylonID}", adminHandler.PluginConfigRestart)
				// `/moderation_statuses/…` is NOT registered here. #209 gated the
				// stub that used to sit on this line; this unit replaced the stub
				// with a real handler, registered below on a static
				// `administration` segment. Re-adding a `{mode}` route here would
				// resurrect the stub for every other mode — and since pylon reaches
				// this surface only through its `administration` AdminAPI, the only
				// thing that would answer is a constant nobody asked for.
				r.With(requireRuntimePlugins).Get("/maintenance/{mode}", adminHandler.Maintenance)
				r.With(requireRuntimePlugins).Put("/maintenance/{mode}", adminHandler.Maintenance)
				r.With(requireRuntimePlugins).Get("/runtime_remote/{mode}", adminHandler.RuntimeRemote)
				r.With(requireRuntimePlugins).Get("/runtime_remote_config/{mode}/{pluginID}", adminHandler.RuntimeRemoteConfig)
				r.With(requireRuntimePlugins).Post("/runtime_remote_config/{mode}/{pluginID}", adminHandler.RuntimeRemoteConfig)
				r.With(requireRuntimePlugins).Get("/runtime_plugin/{mode}/{pluginName}", adminHandler.RuntimePlugin)
				r.With(requireRuntimePlugins).Put("/runtime_plugin/{mode}/{pluginName}", adminHandler.RuntimePlugin)
				r.With(requireRuntimePlugins).Post("/runtime_pylons/{mode}", adminHandler.RuntimePylonLogs)
				r.With(requireRuntimePlugins).Get("/tasks/{mode}/", adminHandler.Tasks)
				r.With(requireRuntimePlugins).Get("/tasks/{mode}", adminHandler.Tasks)
				r.With(requireRuntimePlugins).Get("/active_tasks/{mode}", adminHandler.ActiveTasks)

				// Regular app admin endpoints (with projectID)
				//
				// #130: POST/PUT/DELETE used to be mounted onto coreHandler.Users
				// as well. That handler does no method branching — every verb ran
				// the listing SELECT and answered 200 with the member list — so
				// Invite / Edit role / Remove all reported success and wrote
				// nothing. They now reach real handlers, each gated on the same
				// pylon permission its Python counterpart declares
				// (legacy/plugins/admin/api/v2/users.py).
				r.Get("/users/{mode}/{projectID}", coreHandler.Users)
				r.With(apimw.RequireResolvedPermissions(
					permissionResolver, platformauth.PermissionModeDefault,
					"configuration.users.users.create",
				)).Post("/users/{mode}/{projectID}", coreHandler.UsersCreate)
				r.With(apimw.RequireResolvedPermissions(
					permissionResolver, platformauth.PermissionModeDefault,
					"configuration.users.users.edit",
				)).Put("/users/{mode}/{projectID}", coreHandler.UsersUpdate)
				r.With(apimw.RequireResolvedPermissions(
					permissionResolver, platformauth.PermissionModeDefault,
					"configuration.users.users.delete",
				)).Delete("/users/{mode}/{projectID}", coreHandler.UsersDelete)
				// The same invite/edit-role writes in ADMINISTRATION mode — what
				// the admin Projects page's "Manage project member" dialog calls
				// (unit A14). Registered as STATIC segments so chi's trie prefers
				// them over the `{mode}` routes above, leaving those untouched.
				//
				// They are separate registrations because the GATE differs, not
				// the handler. The `{mode}` routes resolve
				// `configuration.users.users.*` in DEFAULT mode, which
				// `legacyrbac.PostgresResolver` answers purely from the caller's
				// membership OF THAT PROJECT — so a global administrator who is
				// not a member of the project scores zero permissions and is
				// refused, and the admin panel's whole purpose is acting on
				// projects one is not in. pylon gates the same handler on the
				// same permission resolved in administration mode
				// (legacy/plugins/admin/api/v2/users.py maps BOTH modes to the
				// same body, and its `recommended_roles` names `administration`).
				r.With(apimw.RequireCentralPermissions(
					permissionResolver, platformauth.PermissionModeAdministration,
					"configuration.users.users.create",
				)).Post("/users/administration/{projectID}", coreHandler.UsersCreate)
				r.With(apimw.RequireCentralPermissions(
					permissionResolver, platformauth.PermissionModeAdministration,
					"configuration.users.users.edit",
				)).Put("/users/administration/{projectID}", coreHandler.UsersUpdate)
				r.Get("/roles/{mode}/{projectID}", coreHandler.Roles)

				// App requests / moderation (unit A14). Four routes, of which
				// three did not exist and the fourth answered from a constant:
				// `moderation_status/{mode}/{projectID}/{entityID}` returned
				// `{"status":"approved"}` to every caller for every entity while
				// its POST created nothing, so the catalogue's "Request Access"
				// button wrote to nowhere and the gate it feeds always said yes.
				// See internal/api/v2/moderation/requests.go.
				//
				// Gated on the permissions the pylon handlers declare
				// (legacy/plugins/admin/api/v2/moderation_status*.py). The split
				// between CENTRAL and RESOLVED is the same one the schedules and
				// admin-user writes needed: an operator answering requests that
				// arrive from every tenant is a member of none of those
				// projects, so a project-scoped resolver would refuse every
				// legitimate moderator — while the two project-scoped routes are
				// exactly as project-scoped as they look.
				//
				// `administration` is a STATIC segment on the queue and the
				// decision, so neither binds a `{mode}` param and both handlers
				// state their mode by existing rather than sniffing the URL.
				// `requireModeration` is #209's `central("admin.moderation")` —
				// the same middleware that gated the stub this route replaces.
				r.With(requireModeration).
					Get("/moderation_statuses/administration", moderationHandler.AdministrationRequests)
				r.With(apimw.RequireCentralPermissions(
					permissionResolver, platformauth.PermissionModeAdministration,
					"admin.moderation.edit",
				)).Put("/moderation_status/administration", moderationHandler.AdministrationRequestUpdate)
				r.With(apimw.RequireResolvedPermissions(
					permissionResolver, platformauth.PermissionModeDefault,
					"admin.moderation.view",
				)).Get("/moderation_status/{mode}/{projectID}/{entityID}", moderationHandler.Requests)
				r.With(apimw.RequireResolvedPermissions(
					permissionResolver, platformauth.PermissionModeDefault,
					"admin.moderation.create",
				)).Post("/moderation_status/{mode}/{projectID}/{entityID}", moderationHandler.RequestCreate)

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
			//
			// The platform cron table (unit A14). The PUT had no route at all
			// until this unit, so the admin Schedules tab's active switch and
			// inline cron editor had nothing behind them; the GET had a route
			// but read pipeline-trigger metadata out of the tenant schema and
			// short-circuited on the `projectID=0` the admin page sends. See
			// internal/api/v2/scheduling/schedules.go.
			//
			// Gated on the permissions pylon declares for the same handlers
			// (legacy/plugins/scheduling/api/v2/schedules.py):
			// `configuration.scheduling.schedules.view` and `…edit`.
			//
			// Registered as two pairs because the GATE differs, not the
			// handler — the same split the admin user writes needed above.
			// `legacyrbac.PostgresResolver` answers the `{mode}` routes purely
			// from the caller's membership OF THAT PROJECT, and an operator
			// disabling a PLATFORM job (`project_id IS NULL`) is a member of no
			// project at all, so a project-scoped resolver would refuse every
			// legitimate admin caller. The `administration` segment is STATIC so
			// chi's trie prefers it, leaving the project routes untouched.
			schedulingHandler := v2scheduling.NewHandler(cfg.Pool)
			r.With(apimw.RequireCentralPermissions(
				permissionResolver, platformauth.PermissionModeAdministration,
				"configuration.scheduling.schedules.view",
			)).Get("/scheduling/schedules/administration/{projectID}", schedulingHandler.AdministrationSchedules)
			r.With(apimw.RequireCentralPermissions(
				permissionResolver, platformauth.PermissionModeAdministration,
				"configuration.scheduling.schedules.edit",
			)).Put("/scheduling/schedules/administration/{projectID}", schedulingHandler.AdministrationSchedulesUpdate)
			r.With(apimw.RequireResolvedPermissions(
				permissionResolver, platformauth.PermissionModeDefault,
				"configuration.scheduling.schedules.view",
			)).Get("/scheduling/schedules/{mode}/{projectID}", schedulingHandler.Schedules)
			r.With(apimw.RequireResolvedPermissions(
				permissionResolver, platformauth.PermissionModeDefault,
				"configuration.scheduling.schedules.edit",
			)).Put("/scheduling/schedules/{mode}/{projectID}", schedulingHandler.SchedulesUpdate)

			// === Configurations ===
			r.Mount("/configurations", v2configs.NewHandler(
				cfg.Pool,
				v2configs.WithPermissionResolver(permissionResolver),
			).Routes())

			// === Secrets ===
			// Mounted under "/secrets" — the pylon PLUGIN name — while the
			// subrouter's own three prefixes are the plugin's RESOURCE
			// MODULES (secrets.py / secret.py / hide.py). The doubled
			// "secrets" in /api/v2/secrets/secrets/{mode}/{projectID} is the
			// real legacy shape, shared by apps/elitea-ui, elitea-sdk,
			// admin_ui and qa/elitea-api-testing. #137 read it as a
			// double-mount bug and moved the routes to the v2 root, which
			// broke every consumer outside apps/elitea-web; #151 restores it.
			// The resolver gates BOTH mode families: the `administration`
			// routes over the GLOBAL vault (unit A14) and the `default`
			// project routes, which until then had no gate at all — any
			// authenticated caller could name any {projectID} and read that
			// project's secret VALUES in plaintext. Both gates live inside
			// the package because the mode is a PATH SEGMENT: one chi route
			// serves both modes, so route-level middleware here could not
			// gate one and not the other.
			r.Mount("/secrets", v2secrets.NewHandler(
				cfg.Pool,
				v2secrets.WithPermissionResolver(permissionResolver),
			).Routes())

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
					appHandler := v2apps.NewHandler(cfg.AppsRepo, cfg.Pool)
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
					r.Post("/skill_import/{mode}/{projectID}", skillHandler.Import)
					r.Get("/skill_export/{mode}/{projectID}/{skillID}", skillHandler.Export)
					r.Get("/skill_export/{mode}/{projectID}/{skillID}/{versionID}", skillHandler.Export)
				}

				// Toolkits
				toolkitHandler := v2toolkits.NewHandler(cfg.Pool)
				// /tool(s)/ and /toolkits/ paths route to toolkitHandler (toolkit instances, not skills).
				//
				// NOTE the split, which was wrong until #129: /tools/ is the
				// INSTANCE list (toolkitHandler.List) and /toolkits/ is the
				// TYPE catalogue (toolkitHandler.ListTypeSchemas — a map of
				// toolkit type name to its settings JSON Schema). That is what
				// api/openapi/v2.yaml specifies (listToolkits ->
				// ToolkitTypeSchemas, listToolkitInstances -> the array), what
				// the generated web client requests (apps/elitea-web/src/
				// shared/api/generated/toolkits/toolkits.ts:562 vs :764), and
				// what the legacy runtime served (legacy elitea_core
				// api/v2/toolkits.py -> get_toolkit_schemas, api/v2/tools.py ->
				// the instance list). Both /toolkits/ registrations previously
				// pointed at List, so ListTypeSchemas had no route at all and
				// the MCP create screen could never show a type.
				// Gate behind FEATURE_FLAG_TOOLKIT_PROJECT_ACCESS for gradual rollout:
				// when enabled, enforces project-level access control on all toolkit endpoints.
				// Until vllm/bifrost integration is ready, set env var to "false" to disable.
				if os.Getenv("FEATURE_FLAG_TOOLKIT_PROJECT_ACCESS") != "false" {
					r.Group(func(r chi.Router) {
						r.Use(apimw.RequireProjectAccess(cfg.Pool))
						r.Get("/tools/prompt_lib/{projectID}", toolkitHandler.List)
						r.Post("/tools/prompt_lib/{projectID}", toolkitHandler.Create)
						r.Get("/tool/prompt_lib/{projectID}/{toolkitID}", toolkitHandler.Get)
						r.Put("/tool/prompt_lib/{projectID}/{toolkitID}", toolkitHandler.Update)
						r.Patch("/tool/prompt_lib/{projectID}/{toolkitID}", toolkitHandler.Update)
						r.Delete("/tool/prompt_lib/{projectID}/{toolkitID}", toolkitHandler.Delete)
						r.Get("/toolkits/prompt_lib/{projectID}", toolkitHandler.ListTypeSchemas)
						r.Get("/toolkit_types/prompt_lib/{projectID}", toolkitHandler.ListTypes)
						r.Get("/toolkit_available_tools/prompt_lib/{projectID}/{toolkitID}", toolkitHandler.AvailableTools)
						r.Post("/toolkit_discover_tools/prompt_lib/{projectID}/{toolkitType}", toolkitHandler.DiscoverTools)
						r.Get("/toolkit_validator/prompt_lib/{projectID}/{toolkitID}", toolkitHandler.ValidateToolkit)
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
					})
				} else {
					// Un-gated (legacy vllm/bifrost compatibility path)
					r.Get("/tools/prompt_lib/{projectID}", toolkitHandler.List)
					r.Post("/tools/prompt_lib/{projectID}", toolkitHandler.Create)
					r.Get("/tool/prompt_lib/{projectID}/{toolkitID}", toolkitHandler.Get)
					r.Put("/tool/prompt_lib/{projectID}/{toolkitID}", toolkitHandler.Update)
					r.Patch("/tool/prompt_lib/{projectID}/{toolkitID}", toolkitHandler.Update)
					r.Delete("/tool/prompt_lib/{projectID}/{toolkitID}", toolkitHandler.Delete)
					r.Get("/toolkits/prompt_lib/{projectID}", toolkitHandler.ListTypeSchemas)
					r.Get("/toolkit_types/prompt_lib/{projectID}", toolkitHandler.ListTypes)
					r.Get("/toolkit_available_tools/prompt_lib/{projectID}/{toolkitID}", toolkitHandler.AvailableTools)
					r.Post("/toolkit_discover_tools/prompt_lib/{projectID}/{toolkitType}", toolkitHandler.DiscoverTools)
					r.Get("/toolkit_validator/prompt_lib/{projectID}/{toolkitID}", toolkitHandler.ValidateToolkit)
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
				}

				// Folders
				if cfg.FoldersRepo != nil {
					// WithPool is what makes the grouped sidebar have any
					// content at all: every conversation the listing
					// groups is read through it, and without it the
					// endpoint answered 200 with empty folders and empty
					// date_groups for a project with nine conversations
					// (#128 defects 1 and 2).
					folderHandler := v2folders.NewHandler(cfg.FoldersRepo).WithPool(cfg.Pool)
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
					// S20a: chat attachment byte path — WithPool/WithObjectStore/
					// WithAttachmentStore are no-ops (nil) when cfg.Pool/
					// cfg.ObjectStore are unset, so AddAttachments' JSON-metadata
					// branch keeps working exactly as before wherever storage isn't
					// wired (matching newArtifactHandler's own degrade convention).
					convHandler := v2convs.NewHandler(cfg.ConvsRepo).
						WithPool(cfg.Pool).
						WithObjectStore(cfg.ObjectStore).
						WithAttachmentStore(newAttachmentStore(cfg.Pool))
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

				// NOTE(#126): the Predict/LLM, Chat and Pipeline-trigger route
				// groups stood here, each behind a nil gate on RouterConfig's
				// Predictor, ChatService or PipelineRunner field. Nothing ever
				// assigned those fields, so the groups were never registered
				// and the paths 404'd in every deployment:
				//   POST   /predict_llm/prompt_lib/{projectID}
				//   DELETE /task/prompt_lib/{projectID}/{taskID}
				//   GET    /application_task/prompt_lib/{projectID}/{taskID}
				//   POST   /chat/prompt_lib/{projectID}/{conversationID}/messages
				//   GET    /chat_config/prompt_lib/{projectID}
				//   GET|POST|PUT /pipeline_trigger/prompt_lib/{projectID}/pipeline/{versionID}/trigger
				// See the IndexerDeps note at the top of this file for why the
				// transport behind them was retired rather than repaired, and
				// #192/#193/#93/#194 for the capability records.

				// Batch version replacement
				if cfg.AppsRepo != nil {
					appHandler := v2apps.NewHandler(cfg.AppsRepo, cfg.Pool)
					r.Post("/batch_replace_version/prompt_lib/{projectID}/{oldVersionID}/{newVersionID}", appHandler.BatchReplaceVersion)
				}

				// Application attachment storage
				r.Put("/application_attachment_storage/prompt_lib/{projectID}/{applicationID}/{versionID}", coreHandler.UpdateAttachmentStorage)

				// NOTE(#126): webchat and the three AI-draft-generation routes
				// stood here behind the same nil gate on RouterConfig.Predictor,
				// and were never registered either:
				//   POST /webchat/prompt_lib/{projectID}/{versionID}
				//   POST /generate_application_draft/prompt_lib/{projectID}
				//   POST /generate_project_context_draft/prompt_lib/{projectID}
				//   POST /generate_skill_draft/prompt_lib/{projectID}
				// v2skills.DraftHandler survives the deletion — it depends only
				// on a narrow Predictor interface the current runtime could
				// supply — but it now has no caller. #194 records that.

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

				// Skill publishing (#249) — the skill-level counterpart of the
				// application publish block above, plus the skills-parity
				// extras that live in the same domain. Registered here rather
				// than in the skills block because none of it goes through
				// SkillsRepo: publishing is cross-schema SQL, the way
				// application publishing is.
				skillPublishHandler := v2skillpublish.NewHandler(cfg.Pool)

				// The catalog reads are project-independent: they serve the
				// public project's schema and take no {projectID}, so there is
				// no membership to check.
				r.Get("/public_skills/prompt_lib", skillPublishHandler.PublicSkills)
				r.Get("/public_skills/prompt_lib/", skillPublishHandler.PublicSkills)
				r.Get("/public_skill/prompt_lib/{skillID}", skillPublishHandler.PublicSkill)
				r.Get("/public_skill/prompt_lib/{skillID}/{versionName}", skillPublishHandler.PublicSkill)

				// Everything project-scoped goes behind RequireProjectAccess.
				//
				// These routes take {projectID} from the path and then read and
				// write THAT project's schema — unpublish deletes a catalog row
				// and reverts a source version, attach creates a skill and maps
				// it onto that project's agents. Authentication alone would let
				// any signed-in user aim them at a project they have nothing to
				// do with. The neighbouring application publish routes predate
				// this middleware and do not carry it; that is a gap to close
				// separately, not a reason to ship new delete-capable surface
				// with the same hole.
				//
				// Unconditional, unlike the toolkit block's flagged rollout:
				// that flag exists because the check was retrofitted onto
				// routes with live clients, and turning it on could break one.
				// These routes are new in the same change as the middleware, so
				// there is no client to regress and no rollout to stage — a
				// switch here would only be a way to run them unprotected.
				r.Group(func(r chi.Router) {
					r.Use(apimw.RequireProjectAccess(cfg.Pool))
					r.Post("/publish_skill/prompt_lib/{projectID}/{skillID}/{versionID}", skillPublishHandler.Publish)
					r.Post("/unpublish_skill/prompt_lib/{projectID}/{skillID}/{versionID}", skillPublishHandler.Unpublish)
					r.Post("/publish_skill_validate/prompt_lib/{projectID}/{skillID}/{versionID}", skillPublishHandler.PublishValidate)
					r.Post("/attach_public_skill/prompt_lib/{projectID}", skillPublishHandler.AttachPublicSkill)
					r.Get("/skill_categories/prompt_lib/{projectID}", skillPublishHandler.SkillCategories)
					r.Get("/skill_export_fork/prompt_lib/{projectID}/{skillID}", skillPublishHandler.ExportFork)
					r.Get("/skill_export_fork/prompt_lib/{projectID}/{skillID}/{versionID}", skillPublishHandler.ExportFork)
					r.Get("/agents_with_skill/prompt_lib/{projectID}/{skillID}", skillPublishHandler.AgentsWithSkill)
				})

				// Check version in use
				r.Get("/check_version_in_use/prompt_lib/{projectID}/{appID}/{versionID}", coreHandler.ApplicationRelation)

				// Authors / trending
				r.Get("/author/prompt_lib/{authorID}", coreHandler.Author)
				r.Get("/trending_authors/prompt_lib/{projectID}", coreHandler.TrendingAuthors)

				// Moderation used to be registered here as well, on
				// `/elitea_core/moderation_status/…`. pylon serves that resource
				// under `admin` only and no client has ever called this copy; it
				// is removed with the stub it pointed at rather than re-pointed
				// at the real handler, which would publish a second URL for the
				// same rows. See internal/api/v2/moderation/requests.go.

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
				// Registered unconditionally: this is the ONLY registration
				// source for project-context GET/PUT in the router every real
				// deployment reaches (CURRENT_PARITY_EVIDENCE.md,
				// internal/api/v2/promptcontextreads — "the compatibility
				// router mounts the chat-config path only... the production
				// router mounts both", and #243 made this the only router
				// left). CurrentPromptContextReads' own project-context
				// handler is a real, RBAC-scoped, parity-verified
				// implementation, but wiring it here too would double-register
				// the same method+path (chi panics on that) — see
				// mountReviewedProductionRoutes (production_router.go), which
				// deliberately does not mount it for the same reason.
				//
				// The relative suffix is derived from
				// v2promptcontextreads.CurrentProjectContextPath (the "/api/v2/elitea_core"
				// prefix comes from this route's enclosing r.Route groups)
				// rather than a second hardcoded literal, purely so the two
				// files can't drift on what path they're both talking about.
				r.Get(strings.TrimPrefix(v2promptcontextreads.CurrentProjectContextPath, "/api/v2/elitea_core"), coreHandler.ProjectContext)
				r.Put(strings.TrimPrefix(v2promptcontextreads.CurrentProjectContextPath, "/api/v2/elitea_core"), coreHandler.UpdateProjectContext)

				// Platform settings
				r.Get("/platform_settings/prompt_lib/{projectID}", coreHandler.PlatformSettings)
				r.Get("/platform_settings/prompt_lib", coreHandler.PlatformSettings)

				// Search
				r.Get("/search_options/prompt_lib/{projectID}", coreHandler.SearchOptions)

				// MCP OAuth & sync
				r.Post("/mcp_oauth_proxy/{projectID}", coreHandler.MCPOAuthProxy)
				r.Post("/mcp_dcr_proxy/{projectID}", coreHandler.MCPDCRProxy)
				r.Post("/mcp_sync_tools/prompt_lib/{projectID}", coreHandler.MCPSyncTools)

				// The MCP REST surface (issue 252 P1). All three carry
				// RequireProjectAccess: each names a project in its path and
				// then reads that project's toolkit rows or the caller's own
				// tokens, and authentication alone would let any signed-in user
				// aim them at a project they have nothing to do with. New
				// routes, so there is no client to regress — the same reasoning
				// the skill-publishing block above states.
				//
				// The modes are pylon's, not a guess: tools_list/tools_call
				// register `c.DEFAULT_MODE` only, internal_mcp_pat_status
				// registers `prompt_lib` only. A mode pylon does not serve on a
				// path 404s here rather than being answered with something
				// plausible.
				//
				// tools_list and tools_call answer 501 with a stated reason —
				// see internal/api/v2/mcp/registry.go. They are registered
				// rather than left off so the refusal is explicit and pinned by
				// a test: a 404 leaves the next person free to wire a stub up.
				mcpHandler := v2mcp.NewHandler(cfg.Pool)
				r.Group(func(r chi.Router) {
					r.Use(apimw.RequireProjectAccess(cfg.Pool))
					r.Get("/tools_list/default/{projectID}", mcpHandler.ToolsList)
					r.Post("/tools_call/default/{projectID}", mcpHandler.ToolsCall)
					r.Get("/internal_mcp_pat_status/prompt_lib/{projectID}/{toolkitType}", mcpHandler.InternalMCPPATStatus)
				})

				// Import wizard
				r.Post("/import_wizard/prompt_lib/{projectID}", coreHandler.ExportImportPost)

				// Users / Roles (served under /admin/ for UI compat, registered here as fallback)
				r.Get("/users/{mode}/{projectID}", coreHandler.Users)
				r.Get("/roles/{mode}/{projectID}", coreHandler.Roles)
				r.Get("/permissions/prompt_lib/{projectID}", coreHandler.Permissions)

				// The admin SERVICE DESCRIPTORS page (unit A14) — pylon's
				// provider hub. All three routes answer 501 with one reason;
				// see internal/api/v2/eliteacore/service_descriptors.go for
				// why, and for what each of them used to do.
				//
				// The listing was `r.Get("/admin/{mode}", …)` answering 200
				// with three hardcoded rows naming `elitea_core`, `auth` and
				// `indexer` — Pylon plugin names, not providers — in a shape
				// the client does not read, from a handler taking
				// `_ *http.Request` and therefore ungated. `administration` is
				// now a STATIC segment because that is the only mode pylon
				// registers on this path (`mode_handlers = {'administration':
				// AdminAPI}`); another mode 404s rather than being answered
				// with something plausible, and the handler states its mode
				// rather than reading a `{mode}` param a static segment does
				// not bind.
				//
				// The two register_descriptor verbs had NO route at all —
				// `coreHandler.RegisterDescriptor` was dead code answering
				// `{"ok": true}` to a discarded body. They are registered now
				// so the refusal is explicit and pinned by a test: a 404 leaves
				// the next person free to wire the stub back up.
				//
				// Gated on the permissions the pylon originals declare,
				// resolved in administration mode — `runtime.airun
				// .serviceproviders` for the listing (elitea_core/api/v2/
				// admin.py) and `provider_hub.descriptor.register` for the
				// writes (elitea_core/api/v2/register_descriptor.py). The gate
				// runs before the refusal: which subsystems a deployment runs
				// is itself information about it.
				r.With(central(v2core.ServiceDescriptorListPermission)).
					Get("/admin/administration", coreHandler.ServiceDescriptors)
				requireDescriptorRegister := central(v2core.ServiceDescriptorRegisterPermission)
				r.With(requireDescriptorRegister).
					Post("/register_descriptor/{projectID}", coreHandler.RegisterDescriptor)
				r.With(requireDescriptorRegister).
					Delete("/register_descriptor/{projectID}", coreHandler.RegisterDescriptor)

				// The admin audit trail (unit A14). All four are READS; the
				// surface has no writes. Two of them (`audit`, `audit_heatmap`)
				// had no route at all before this unit, and the other two were
				// stubs returning empty arrays.
				//
				// Gated on the permission the pylon originals declare
				// (`models.admin.audit_trail.view`,
				// legacy/plugins/elitea_core/api/v2/audit*.py), resolved from
				// auth_core__user_role per request. Unlike the admin USER
				// listing, these reads are gated rather than open: an audit row
				// names the user, the project and the action taken, so the
				// listing itself is the sensitive part.
				requireAuditTrail := apimw.RequireCentralPermissions(
					permissionResolver, platformauth.PermissionModeAdministration,
					"models.admin.audit_trail.view",
				)
				r.With(requireAuditTrail).Get("/audit/{mode}", coreHandler.AuditTrail)
				r.With(requireAuditTrail).Get("/audit_heatmap/{mode}", coreHandler.AuditHeatmap)
				r.With(requireAuditTrail).Get("/audit_traces/{mode}", coreHandler.AuditTraces)
				r.With(requireAuditTrail).Get("/audit_trace_heatmap/{mode}", coreHandler.AuditTraceHeatmap)

				// Per-user event counts for ONE project — the admin Projects
				// page's activity drawer (unit A14). Same table and therefore
				// the same gate as the four reads above; pylon's
				// project_user_activity.py declares that same permission. It had
				// no route and no handler at all before this unit.
				r.With(requireAuditTrail).
					Get("/project_user_activity/{mode}", coreHandler.ProjectUserActivity)
			})

			// === Social plugin ===
			r.Mount("/social", v2social.NewHandler(cfg.Pool).Routes())

			// Artifacts are mounted by mountArtifactRoutes below, outside
			// this /api/v2 group — see S11: the shadow middleware wrapping
			// this group buffers the whole response and has no Unwrap, which
			// would break download streaming and ResponseController
			// deadlines (S12).

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

	// /llm has two possible backends. GatewayProxy is the Bifrost gateway
	// (LLM_GATEWAY_URL); LLMProxy is the older LiteLLM facade, reachable only
	// under ELITEA_CONFIGURATIONS_ENABLED, which no deployment sets.
	//
	// The gateway arm is mounted HERE, not in production_router.go's
	// mountReviewedProductionRoutes: NewRouter always builds this router
	// (#243 deleted the only other build path, which was unreachable in
	// every real deployment), so mounting it in exactly one place is what
	// matters now — mountReviewedProductionRoutes explicitly defers to this
	// registration rather than mounting /llm itself.
	//
	// Gateway wins when both are composed: it is the migration target, and
	// serving the superseded facade in preference to it would be a silent
	// downgrade.
	// Each backend keeps its own literal per-field nil gate rather than being
	// collapsed into one nil-check over a local. TestNilGatedRouterFieldsAreWiredOrDeclared
	// reads this file as SOURCE to prove no route group is gated behind a field
	// the composition root never assigns, so a gate hidden behind a local
	// variable is invisible to it — which is the precise failure mode it exists
	// to catch.
	mountLLM := func(proxy http.Handler, resolver apimw.PersonalProjectResolver) {
		r.Group(func(r chi.Router) {
			r.Use(apimw.Auth(apimw.AuthConfig{
				Client:                    cfg.AuthClient,
				Validator:                 cfg.AuthValidator,
				PrincipalValidator:        cfg.PrincipalValidator,
				ForwardedIdentityVerifier: cfg.Auth.ForwardedIdentityVerifier,
				SessionSecret:             cfg.SessionSecret,
				TrustedProxyCIDRs:         cfg.Auth.TrustedProxyCIDRs,
			}))
			r.Use(apimw.Project(apimw.ProjectConfig{Resolver: resolver}))
			r.Mount("/llm", proxy)
		})
	}
	if cfg.GatewayProxy != nil {
		mountLLM(cfg.GatewayProxy, cfg.GatewayProjectResolver)
	} else if cfg.LLMProxy != nil {
		mountLLM(cfg.LLMProxy, cfg.LLMProjectResolver)
	}

	// Register reviewed current-compatible routes last. Some broad prototype
	// repositories own the same path with a partial or older method set (for
	// example conversations owns GET/DELETE messages and a legacy regenerate
	// POST). The reviewed handlers must remain authoritative whenever those
	// repositories are also composed; otherwise merely adding an unrelated
	// compatibility repository can silently remove agent execution or SSE.
	// The broad prototype compatibility handler above already owns the current
	// project-context GET. Keep that single live registration while adding the
	// reviewed routes it does not provide, including chat config and agent SSE.
	mountReviewedProductionRoutes(r, cfg)

	return r
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

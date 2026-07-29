package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/adminui"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/health"
	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/shadow"
	sioserver "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/socketio"
	v2auth "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/auth"
	v2events "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/events"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/webhook"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/cutover"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/authsvc"
	infradb "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/indexersvc"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/natsbus"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/redis"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage/filesystem"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/llmproxy"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		resp, err := http.Get("http://localhost:8080/healthz")
		if err != nil || resp.StatusCode != 200 {
			os.Exit(1)
		}
		os.Exit(0)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	ctx := context.Background()

	// Database
	dbDSN := envOr("DATABASE_URL", "postgres://localhost:5432/elitea?sslmode=disable")
	pool, err := pgxpool.New(ctx, dbDSN)
	if err != nil {
		slog.Error("failed to create db pool", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	// Run migrations (skip if loading from an existing dump)
	if envOr("SKIP_MIGRATIONS", "") == "" {
		if err := infradb.RunMigrations(ctx, pool); err != nil {
			slog.Error("failed to run migrations", "err", err)
			os.Exit(1)
		}
	} else {
		slog.Info("SKIP_MIGRATIONS set, skipping schema migrations")
	}

	// Redis
	redisOptions, err := redisOptionsFromEnv(os.LookupEnv)
	if err != nil {
		slog.Error("failed to configure Redis", "err", err)
		os.Exit(1)
	}
	rdb := goredis.NewClient(redisOptions)

	authClient := authsvc.New(rdb)
	jwtSecret := envOr("APPLICATION_SECRET_KEY", "")
	devMode := os.Getenv("AUTH_DEV_MODE") == "true"
	var localValidator *authsvc.LocalValidator
	var sessionHandler *v2auth.SessionHandler
	if jwtSecret != "" {
		if devMode {
			slog.Error("FATAL: AUTH_DEV_MODE=true conflicts with APPLICATION_SECRET_KEY being set. " +
				"DevMode uses a fake user ID that breaks database queries. " +
				"Remove AUTH_DEV_MODE or unset APPLICATION_SECRET_KEY.")
			os.Exit(1)
		}
		localValidator = authsvc.NewLocalValidator(pool, jwtSecret)
		sessionHandler = v2auth.NewSessionHandler(pool, rdb, jwtSecret)
		slog.Info("auth: using local token validator (pylon_auth not required)")
	} else {
		if devMode {
			slog.Warn("auth: AUTH_DEV_MODE enabled (no real authentication, dev user only)")
		} else {
			slog.Warn("auth: APPLICATION_SECRET_KEY not set, falling back to pylon_auth RPC")
		}
	}

	// OIDC (optional — enabled when OIDC_ISSUER_URL is set)
	var oidcHandler *v2auth.OIDCHandler
	oidcCfg, err := v2auth.OIDCConfigFromEnv()
	if err != nil {
		slog.Error("OIDC config invalid", "err", err)
		os.Exit(1)
	}
	if oidcCfg != nil {
		oidcHandler, err = v2auth.NewOIDCHandler(ctx, oidcCfg, pool, jwtSecret)
		if err != nil {
			slog.Error("OIDC provider discovery failed", "err", err)
			os.Exit(1)
		}
		slog.Info("auth: OIDC enabled", "issuer", oidcCfg.IssuerURL)
	}
	// EventBus: NATS gateway.events.* when GATEWAY_NATS_URL is set (design §8.1
	// re-points the platform event stream off Redis pub/sub), else Redis
	// pub/sub. A NATS dial failure at boot is non-fatal — elitea-main falls back
	// to Redis rather than refusing to start, matching the gateway's
	// non-fatal-NATS-boot policy.
	redisEventBus := redis.NewEventBus(rdb, "elitea-main")
	var (
		eventBus    eventSubscriber = redisEventBus
		healthPing  health.Checker  = redisEventBus
		eventSource v2events.EventSource
	)
	if natsURL := os.Getenv("GATEWAY_NATS_URL"); natsURL != "" {
		nb, nerr := natsbus.Connect(natsURL, "elitea-main", "elitea-main")
		if nerr != nil {
			slog.Warn("eventbus: NATS connect failed, falling back to Redis pub/sub", "err", nerr, "url", natsURL)
		} else {
			slog.Info("eventbus: using NATS gateway.events.*", "url", natsURL)
			eventBus = nb
			healthPing = nb
			eventSource = nb
			defer nb.Close()
		}
	}

	// Repositories (declared early so dispatcher can reference webhookRepo)
	appsRepo := repos.NewApplicationsRepo(pool)
	skillsRepo := repos.NewSkillsRepo(pool)
	foldersRepo := repos.NewFoldersRepo(pool)
	tagsRepo := repos.NewTagsRepo(pool)
	analyticsRepo := repos.NewAnalyticsRepo(pool)
	convsRepo := repos.NewConversationsRepo(pool)
	webhookRepo := repos.NewWebhooksRepo(pool)

	// Webhook dispatcher: fires HTTP callbacks on platform events
	webhookDispatcher := webhook.NewDispatcher(webhookRepo)
	eventBus.Subscribe(ctx, "elitea:*", webhookDispatcher.HandleEvent)

	// Shadow mode
	shadowWeight := 0.1
	if w := os.Getenv("SHADOW_WEIGHT"); w != "" {
		if f, err := strconv.ParseFloat(w, 64); err == nil {
			shadowWeight = f
		}
	}
	shadowCfg := shadow.Config{
		Enabled:       os.Getenv("SHADOW_ENABLED") == "true",
		LegacyBaseURL: os.Getenv("SHADOW_LEGACY_URL"),
		Weight:        shadowWeight,
		Timeout:       5 * time.Second,
		LogDiffs:      true,
	}
	comparator := shadow.NewComparator(shadowCfg)
	shadowMetrics := shadow.NewMetrics(1000)

	// Indexer RPC client (predict/chat/pipelines)
	indexerClient := indexersvc.New(rdb)

	// Cutover tracker + routing
	cutoverTracker := cutover.NewTracker(rdb)

	canaryWeight := 0.1
	if w := os.Getenv("CANARY_WEIGHT"); w != "" {
		if f, err := strconv.ParseFloat(w, 64); err == nil {
			canaryWeight = f
		}
	}
	if err := cutoverTracker.SeedDefaults(ctx); err != nil {
		slog.Warn("failed to seed cutover defaults", "err", err)
	}

	var cutoverRouter *cutover.Router
	if legacyURL := os.Getenv("LEGACY_URL"); legacyURL != "" {
		cutoverRouter = cutover.NewRouter(cutover.RouterConfig{
			Tracker:      cutoverTracker,
			LegacyURL:    legacyURL,
			CanaryWeight: canaryWeight,
		})
	}

	// Socket.IO server for real-time streaming (chat/application predict)
	sioSrv := sioserver.NewServer(sioserver.Config{
		Indexer: indexerClient,
		Redis:   rdb,
	})

	// Storage backend
	storageCfg := storage.ConfigFromEnv()
	var storageBackend storage.Backend
	switch storageCfg.Backend {
	case "", "filesystem":
		storageBackend = filesystem.New(storageCfg.DataDir)
	default:
		slog.Error("unsupported storage backend", "backend", storageCfg.Backend)
		os.Exit(1)
	}

	// LLM gateway proxy (BF0.9c): optional — only wired when GATEWAY_HTTP_ADDR is
	// set. Existing deployments without the gateway env var start normally.
	var (
		llmProxy           *llmproxy.Proxy
		llmProjectResolver apimw.PersonalProjectResolver
	)
	if gatewayAddr := os.Getenv("GATEWAY_HTTP_ADDR"); gatewayAddr != "" {
		proxyCfg := llmproxy.Config{
			TargetURL:      gatewayAddr,
			IdentitySecret: os.Getenv("GATEWAY_IDENTITY_SECRET"),
			ClientCertFile: os.Getenv("GATEWAY_CLIENT_CERT_FILE"),
			ClientKeyFile:  os.Getenv("GATEWAY_CLIENT_KEY_FILE"),
			CAFile:         os.Getenv("GATEWAY_CA_FILE"),
			ServerName:     os.Getenv("GATEWAY_SERVER_NAME"),
		}
		p, perr := llmproxy.New(proxyCfg)
		if perr != nil {
			slog.Error("llmproxy: failed to construct gateway proxy, /llm will not be mounted", "err", perr)
		} else {
			llmProxy = p
			llmProjectResolver = apimw.NewDBPersonalProjectResolver(pool)
			slog.Info("llmproxy: /llm mounted → gateway", "target", gatewayAddr)
		}
	} else {
		slog.Info("llmproxy: GATEWAY_HTTP_ADDR not set, /llm route disabled")
	}

	// Fix round-3 #5: resolve TrustedProxyCIDRs once and pass them into AuthDeps
	// so BOTH AuthConfig{} constructions in api.NewRouter receive the same list.
	// Relying on the env-fallback inside apimw.Auth() would work but makes the
	// router's behaviour invisible at the call site and breaks tests that set the
	// CIDRs programmatically rather than via the environment.
	var trustedProxyCIDRs []string
	if raw := os.Getenv("TRUSTED_PROXY_CIDRS"); raw != "" {
		trustedProxyCIDRs = strings.Split(raw, ",")
	}

	r := api.NewRouter(api.RouterConfig{
		Auth: api.AuthDeps{
			Client:            authClient,
			Validator:         localValidator,
			SessionHandler:    sessionHandler,
			OIDCHandler:       oidcHandler,
			SessionSecret:     jwtSecret,
			TrustedProxyCIDRs: trustedProxyCIDRs,
		},
		Indexer: api.IndexerDeps{
			Predictor:      indexerClient,
			LLMService:     indexerClient,
			ChatService:    indexerClient,
			PipelineRunner: indexerClient,
			ToolTester:     indexerClient,
			MCPSyncer:      indexerClient,
		},
		Pool: pool,
		HealthDeps: health.Deps{
			DB:    &poolChecker{pool: pool},
			Redis: healthPing,
		},
		AppsRepo:           appsRepo,
		SkillsRepo:         skillsRepo,
		FoldersRepo:        foldersRepo,
		TagsRepo:           tagsRepo,
		AnalyticsRepo:      analyticsRepo,
		ConvsRepo:          convsRepo,
		WebhookRepo:        webhookRepo,
		RedisClient:        rdb,
		EventSource:        eventSource,
		Shadow:             comparator,
		ShadowMetrics:      shadowMetrics,
		CutoverTracker:     cutoverTracker,
		CutoverRouter:      cutoverRouter,
		AdminUI:            adminUIConfig(),
		Storage:            storageBackend,
		LLMProxy:           llmProxy,
		LLMProjectResolver: llmProjectResolver,
	})

	// Combine chi router + Socket.IO on one port
	mux := http.NewServeMux()
	mux.Handle("/socket.io/", sioSrv.Handler())
	mux.Handle("/", r)

	srv := &http.Server{
		Addr:         ":8080",
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		slog.Info("starting server", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("shutting down server")
	shutCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutCtx); err != nil {
		slog.Error("server forced to shutdown", "err", err)
	}
	_ = rdb.Close()
	slog.Info("server stopped")
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func adminUIConfig() *adminui.Config {
	staticDir := os.Getenv("ADMIN_UI_STATIC_DIR")
	if staticDir == "" {
		staticDir = "/data/admin_ui/static/dist"
	}
	if _, err := os.Stat(staticDir); err != nil {
		slog.Info("admin UI disabled (static dir not found)", "path", staticDir)
		return nil
	}
	return &adminui.Config{
		StaticDir:     staticDir,
		ViteServerURL: envOr("ADMIN_UI_API_URL", "/api/v2"),
		BasePath:      envOr("ADMIN_UI_BASE_PATH", "/admin/app"),
		SecretKey:     envOr("APPLICATION_SECRET_KEY", ""),
	}
}

type poolChecker struct {
	pool *pgxpool.Pool
}

func (p *poolChecker) Ping(ctx context.Context) error {
	return p.pool.Ping(ctx)
}

// eventSubscriber is the subset of the EventBus main.go needs: subscribing the
// webhook dispatcher to platform events. Both transports satisfy it —
// redis.EventBus and natsbus.EventBus share Subscribe(ctx, channel,
// redis.EventHandler).
type eventSubscriber interface {
	Subscribe(ctx context.Context, channel string, handler redis.EventHandler)
}

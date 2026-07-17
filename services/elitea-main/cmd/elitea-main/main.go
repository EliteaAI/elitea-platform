package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/adminui"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/health"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/shadow"
	sioserver "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/socketio"
	v2auth "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/webhook"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/cutover"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/authsvc"
	infradb "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/indexersvc"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/redis"
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
	// Database
	dbDSN := envOr("DATABASE_URL", "postgres://localhost:5432/elitea?sslmode=disable")
	pool, err := pgxpool.New(ctx, dbDSN)
	if err != nil {
		return fmt.Errorf("create database pool: %w", err)
	}
	defer pool.Close()

	// Run migrations (skip if loading from an existing dump)
	if envOr("SKIP_MIGRATIONS", "") == "" {
		if err := infradb.RunMigrations(ctx, pool); err != nil {
			return fmt.Errorf("run legacy database migrations: %w", err)
		}
	} else {
		slog.Info("SKIP_MIGRATIONS set, skipping schema migrations")
	}

	runtimeConfig, err := runtimecomposition.ConfigFromEnv(os.LookupEnv)
	if err != nil {
		return fmt.Errorf("load optional runtime configuration: %w", err)
	}
	var runtimeRoot *runtimecomposition.Runtime
	var runtimeRoutes api.RuntimeRoutes
	if runtimeConfig.Enabled {
		runtimePools, openErr := openRuntimeDatabasePools(ctx, dbDSN, runtimecomposition.PhaseOneDatabasePoolLimits())
		if openErr != nil {
			return openErr
		}
		defer runtimePools.Close()
		runtimeRoot, err = runtimecomposition.New(ctx, runtimeConfig, runtimecomposition.Dependencies{
			AdmissionPool: runtimePools.Admission,
			ControlPool:   runtimePools.Control,
			OutputPool:    runtimePools.Output,
			ReplayPool:    runtimePools.Replay,
			ContentPool:   runtimePools.Content,
			Logger:        logger,
		})
		if err != nil {
			return fmt.Errorf("compose optional runtime: %w", err)
		}
		defer func() {
			if err := runtimeRoot.Close(); runErr == nil && err != nil {
				runErr = fmt.Errorf("close optional runtime: %w", err)
			}
		}()
		publicRoutes := runtimeRoot.PublicRoutes()
		runtimeRoutes = api.RuntimeRoutes{Validation: publicRoutes.Validation, ExecutionEvents: publicRoutes.ExecutionEvents}
		slog.Info("production runtime enabled", "control_addr", runtimeConfig.ControlAddress, "output_addr", runtimeConfig.OutputAddress, "content_addr", runtimeConfig.ContentAddress)
	}

	// Redis
	redisAddr := envOr("REDIS_URL", "localhost:6379")
	rdb := goredis.NewClient(&goredis.Options{Addr: redisAddr})
	defer func() {
		if err := rdb.Close(); runErr == nil && err != nil {
			runErr = fmt.Errorf("close legacy Redis client: %w", err)
		}
	}()

	authClient := authsvc.New(rdb)
	jwtSecret := envOr("APPLICATION_SECRET_KEY", "")
	devMode := os.Getenv("AUTH_DEV_MODE") == "true"
	var localValidator *authsvc.LocalValidator
	var sessionHandler *v2auth.SessionHandler
	if jwtSecret != "" {
		if devMode {
			return errors.New("AUTH_DEV_MODE=true conflicts with APPLICATION_SECRET_KEY")
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
		return fmt.Errorf("load OIDC configuration: %w", err)
	}
	if oidcCfg != nil {
		oidcHandler, err = v2auth.NewOIDCHandler(ctx, oidcCfg, pool, jwtSecret)
		if err != nil {
			return fmt.Errorf("discover OIDC provider: %w", err)
		}
		slog.Info("auth: OIDC enabled", "issuer", oidcCfg.IssuerURL)
	}
	eventBus := redis.NewEventBus(rdb, "elitea-main")

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

	r := api.NewRouter(api.RouterConfig{
		AuthClient:     authClient,
		AuthValidator:  localValidator,
		SessionHandler: sessionHandler,
		OIDCHandler:    oidcHandler,
		Pool:           pool,
		HealthDeps: health.Deps{
			DB:    &poolChecker{pool: pool},
			Redis: eventBus,
		},
		AppsRepo:       appsRepo,
		SkillsRepo:     skillsRepo,
		FoldersRepo:    foldersRepo,
		TagsRepo:       tagsRepo,
		AnalyticsRepo:  analyticsRepo,
		ConvsRepo:      convsRepo,
		WebhookRepo:    webhookRepo,
		RedisClient:    rdb,
		Shadow:         comparator,
		ShadowMetrics:  shadowMetrics,
		Predictor:      indexerClient,
		LLMService:     indexerClient,
		ChatService:    indexerClient,
		PipelineRunner: indexerClient,
		ToolTester:     indexerClient,
		MCPSyncer:      indexerClient,
		CutoverTracker: cutoverTracker,
		CutoverRouter:  cutoverRouter,
		AdminUI:        adminUIConfig(),
		SessionSecret:  jwtSecret,
		RuntimeRoutes:  runtimeRoutes,
	})

	// Combine chi router + Socket.IO on one port
	mux := http.NewServeMux()
	mux.Handle("/socket.io/", sioSrv.Handler())
	mux.Handle("/", r)

	srv := &http.Server{
		Addr:         publicAddress,
		Handler:      mux,
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

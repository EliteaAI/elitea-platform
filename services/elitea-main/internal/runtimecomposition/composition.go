package runtimecomposition

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	outputapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/output"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/migrate"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/transport/redisdispatch"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/transport/runtimegrpc"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/transport/runtimegrpc/control"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/transport/runtimegrpc/output"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/transport/workloadauth"
	platformmigrations "github.com/EliteaAI/elitea-platform/services/elitea-main/migrations"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	protocolRevision       = "elitea.runtime.v1"
	envelopeSchemaRevision = "elitea.runtime.signed-worker-command.v1"
	outputSchemaRevision   = "elitea.runtime.execution-output.v1"
	capabilityVersion      = "1"
	limitsRevision         = "elitea.runtime.limits.conformance.v1"

	resourceClass       = "validation-small"
	isolationClass      = "shared-credential-free"
	inputClassification = "tenant-confidential"
	inputGrantAudience  = "elitea.runtime.input.read.v1"

	maxWorkerCommandBytes  = 32 * 1024
	maxSignedEnvelopeBytes = 48 * 1024
	maxRedisFieldBytes     = 48 * 1024
	maxInputManifestBytes  = 64 * 1024
	maxInputEntries        = 16
	maxInputContentBytes   = 256 * 1024
	maxOutputFrameBytes    = 64 * 1024
	maxSafeStringBytes     = 256
	maxGRPCRequestBytes    = 64 * 1024
	maxGRPCResponseBytes   = 80 * 1024
	maxContentRequests     = 16
	claimLeaseTTL          = 30 * time.Second
)

type Dependencies struct {
	AdmissionPool *pgxpool.Pool
	ControlPool   *pgxpool.Pool
	OutputPool    *pgxpool.Pool
	ReplayPool    *pgxpool.Pool
	ContentPool   *pgxpool.Pool
	Logger        *slog.Logger
}

func New(ctx context.Context, config Config, dependencies Dependencies) (*Runtime, error) {
	if ctx == nil {
		return nil, errors.New("runtime composition context is required")
	}
	if !config.Enabled {
		return nil, errors.New("runtime composition is disabled")
	}
	if err := config.Validate(); err != nil {
		return nil, err
	}
	if err := validateDependencies(dependencies); err != nil {
		return nil, err
	}
	if err := migrate.New(dependencies.AdmissionPool, platformmigrations.Files).CheckHead(ctx, migrate.ScopeShared, "platform"); err != nil {
		return nil, fmt.Errorf("runtime shared migration head is not applied: %w", err)
	}

	privateKey, err := loadEd25519PrivateKey(config.SigningKeyFile)
	if err != nil {
		return nil, err
	}
	verificationKeys, err := loadEd25519VerificationKeyring(config.VerificationKeyringFile)
	if err != nil {
		return nil, err
	}
	if err := verificationKeys.requireActiveSigningKey(config.SigningKeyID, privateKey); err != nil {
		return nil, err
	}
	controlTLS, err := runtimegrpc.LoadServerTLSConfig(config.ControlTLS)
	if err != nil {
		return nil, fmt.Errorf("load control listener TLS: %w", err)
	}
	outputTLS, err := runtimegrpc.LoadServerTLSConfig(config.OutputTLS)
	if err != nil {
		return nil, fmt.Errorf("load output listener TLS: %w", err)
	}
	contentTLS, err := runtimegrpc.LoadServerTLSConfig(config.ContentTLS)
	if err != nil {
		return nil, fmt.Errorf("load content listener TLS: %w", err)
	}

	controlRedis, err := newControlRedisClient(ctx, config)
	if err != nil {
		return nil, err
	}
	closeRedis := true
	defer func() {
		if closeRedis {
			_ = controlRedis.Close()
		}
	}()

	limits := redisdispatch.Limits{
		Revision:               limitsRevision,
		MaxWorkerCommandBytes:  maxWorkerCommandBytes,
		MaxSignedEnvelopeBytes: maxSignedEnvelopeBytes,
		MaxRedisFieldBytes:     maxRedisFieldBytes,
		MaxRedisEntryBytes:     productionRedisEntrySize,
		MaxSignatureBytes:      256,
		MaxStringBytes:         maxSafeStringBytes,
	}
	appenderConfig := redisdispatch.RedisStreamAppenderConfig{
		MaxEntries:    config.StreamMaxEntries,
		MaxEntryBytes: productionRedisEntrySize,
	}
	if appenderConfig.MaxEntryBytes > limits.MaxRedisEntryBytes {
		return nil, errors.New("runtime Redis appender entry bound exceeds the producer bound")
	}
	appender, err := redisdispatch.NewRedisStreamAppender(controlRedis, appenderConfig)
	if err != nil {
		return nil, fmt.Errorf("construct bounded runtime Redis appender: %w", err)
	}
	signer, err := redisdispatch.NewEd25519CommandSigner(config.SigningKeyID, privateKey)
	if err != nil {
		return nil, fmt.Errorf("construct runtime command signer: %w", err)
	}
	producer, err := redisdispatch.NewProducer(redisdispatch.ProducerConfig{
		Stream:                 config.CommandStream,
		ProtocolRevision:       protocolRevision,
		EnvelopeSchemaRevision: envelopeSchemaRevision,
		Limits:                 limits,
	}, signer, appender)
	if err != nil {
		return nil, fmt.Errorf("construct runtime command producer: %w", err)
	}

	dispatchPolicy := repos.ValidationDispatchPolicy{
		StreamName:        config.CommandStream,
		CapabilityVersion: capabilityVersion,
		ResourceClass:     resourceClass,
		IsolationClass:    isolationClass,
		Priority:          1,
		DeadlineTTL:       time.Minute,
		LimitsRevision:    limitsRevision,
		MaxOutstanding:    config.MaxOutstanding,
	}
	jobs, err := repos.NewExecutionJobsRepository(dependencies.AdmissionPool, dispatchPolicy)
	if err != nil {
		return nil, fmt.Errorf("construct runtime execution jobs: %w", err)
	}
	targets, err := repos.NewConfigurationTargetsRepository(dependencies.AdmissionPool)
	if err != nil {
		return nil, fmt.Errorf("construct runtime configuration targets: %w", err)
	}
	bundles, err := executionapp.NewValidationInputBundleFactory(executionapp.ValidationInputProfile{
		SemanticRole:          "configuration.settings",
		Classification:        inputClassification,
		RequiredGrantAudience: inputGrantAudience,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("construct runtime input bundle factory: %w", err)
	}
	jobSubmitter, err := executionapp.NewSubmitJobService(jobs, nil, nil)
	if err != nil {
		return nil, err
	}
	validationSubmitter, err := configurationapp.NewSubmitValidationService(targets, bundles, jobSubmitter)
	if err != nil {
		return nil, err
	}

	outbox, err := repos.NewCommandOutboxRepository(dependencies.AdmissionPool, config.CommandStream)
	if err != nil {
		return nil, fmt.Errorf("construct runtime command outbox: %w", err)
	}
	dispatcher, err := executionapp.NewValidationDispatcher(outbox, producer)
	if err != nil {
		return nil, err
	}
	publisher, err := executionapp.NewOutboxPublisher(outbox, dispatcher, executionapp.OutboxPublisherConfig{
		PollInterval:      250 * time.Millisecond,
		VisibilityTimeout: 30 * time.Second,
		BatchSize:         64,
		MaxConcurrent:     8,
		ReportFailure: func(err error) {
			dependencies.Logger.Error("runtime outbox publisher cycle failed", "err", err)
		},
	})
	if err != nil {
		return nil, err
	}

	controlSessions, err := repos.NewWorkloadSessionsRepository(dependencies.ControlPool)
	if err != nil {
		return nil, fmt.Errorf("construct control workload sessions: %w", err)
	}
	controlPeerAuthorizer, err := workloadauth.NewPeerAuthorizer(controlSessions)
	if err != nil {
		return nil, err
	}
	verifier, err := control.NewProductionCommandVerifier(control.ProductionVerifierConfig{
		EnvelopeSchemaRevision: envelopeSchemaRevision,
		ProtocolRevision:       protocolRevision,
		CapabilityVersion:      capabilityVersion,
		LimitsRevision:         limitsRevision,
		MaxWorkerCommandBytes:  maxWorkerCommandBytes,
		MaxInputManifestBytes:  maxInputManifestBytes,
		MaxStringBytes:         maxSafeStringBytes,
	}, verificationKeys)
	if err != nil {
		return nil, err
	}
	controlClaimsRepository, err := repos.NewClaimsRepository(dependencies.ControlPool)
	if err != nil {
		return nil, fmt.Errorf("construct runtime claims: %w", err)
	}
	controlClaims, err := executionapp.NewClaimService(controlClaimsRepository, nil, claimLeaseTTL)
	if err != nil {
		return nil, err
	}
	inputs, err := repos.NewInputBundlesRepository(dependencies.ControlPool)
	if err != nil {
		return nil, fmt.Errorf("construct runtime input bundles: %w", err)
	}
	settlementsRepository, err := repos.NewSettlementsRepository(dependencies.ControlPool)
	if err != nil {
		return nil, fmt.Errorf("construct runtime settlements: %w", err)
	}
	settlements, err := executionapp.NewSettlementService(settlementsRepository)
	if err != nil {
		return nil, err
	}
	controlServer, err := control.NewServer(control.ServerConfig{
		MaxInputManifestBytes: maxInputManifestBytes,
		MaxInputEntries:       maxInputEntries,
		MaxInputContentBytes:  maxInputContentBytes,
		MaxStringBytes:        maxSafeStringBytes,
	}, controlPeerAuthorizer, verifier, controlClaims, inputs, settlements)
	if err != nil {
		return nil, err
	}

	outputInbox, err := repos.NewOutputInboxRepository(dependencies.OutputPool)
	if err != nil {
		return nil, fmt.Errorf("construct runtime output inbox: %w", err)
	}
	results, err := repos.NewConfigurationValidationResultsRepository(dependencies.OutputPool)
	if err != nil {
		return nil, fmt.Errorf("construct runtime validation projector: %w", err)
	}
	outputSessions, err := repos.NewWorkloadSessionsRepository(dependencies.OutputPool)
	if err != nil {
		return nil, fmt.Errorf("construct output workload sessions: %w", err)
	}
	outputPeerAuthorizer, err := workloadauth.NewPeerAuthorizer(outputSessions)
	if err != nil {
		return nil, err
	}
	outputClaimsRepository, err := repos.NewClaimsRepository(dependencies.OutputPool)
	if err != nil {
		return nil, fmt.Errorf("construct output claims: %w", err)
	}
	outputClaims, err := executionapp.NewClaimService(outputClaimsRepository, nil, claimLeaseTTL)
	if err != nil {
		return nil, err
	}
	validationOutput, err := outputapp.NewConfigurationValidationService(outputInbox, outputClaims, results)
	if err != nil {
		return nil, err
	}
	runtimeFailures, err := outputapp.NewRuntimeFailureService(outputInbox, outputClaims, results)
	if err != nil {
		return nil, err
	}
	outputServer, err := output.NewServer(output.ServerConfig{
		OutputSchemaRevision: outputSchemaRevision,
		MaxFrameBytes:        maxOutputFrameBytes,
		CreditFrames:         1,
		CreditBytes:          maxOutputFrameBytes,
	}, outputPeerAuthorizer, validationOutput, runtimeFailures)
	if err != nil {
		return nil, err
	}

	contentRepository, err := storage.NewPostgresContentRepository(dependencies.ContentPool)
	if err != nil {
		return nil, fmt.Errorf("construct runtime content repository: %w", err)
	}
	contentServer, err := storage.NewContentServerWithLimits(contentRepository, contentRepository, maxInputContentBytes, maxContentRequests)
	if err != nil {
		return nil, err
	}
	privateServers, err := runtimegrpc.NewPrivateServerSet(runtimegrpc.PrivateServerConfig{
		ControlAddress:          config.ControlAddress,
		OutputAddress:           config.OutputAddress,
		ContentAddress:          config.ContentAddress,
		ControlTLS:              controlTLS,
		OutputTLS:               outputTLS,
		ContentTLS:              contentTLS,
		ControlMaxRequestBytes:  maxGRPCRequestBytes,
		ControlMaxResponseBytes: maxGRPCResponseBytes,
		OutputMaxRequestBytes:   maxGRPCRequestBytes,
		OutputMaxResponseBytes:  maxGRPCResponseBytes,
		ControlGRPC:             phaseOneGRPCPolicy(16),
		OutputGRPC:              phaseOneGRPCPolicy(4),
		ContentMaxConnections:   64,
		ContentMaxStreams:       maxContentRequests,
		ContentReadTimeout:      10 * time.Second,
		ContentWriteTimeout:     30 * time.Second,
		ContentIdleTimeout:      time.Minute,
		ContentMaxHeaderBytes:   16 * 1024,
		ShutdownTimeout:         15 * time.Second,
	}, runtimegrpc.PrivateServices{
		Control: controlServer,
		Output:  outputServer,
		Content: contentServer.Routes(),
	})
	if err != nil {
		return nil, err
	}

	replay, err := repos.NewReplayEventsRepository(dependencies.ReplayPool)
	if err != nil {
		return nil, fmt.Errorf("construct runtime replay repository: %w", err)
	}
	publicAuthorizer, err := newPostgresPublicAuthorizer(dependencies.AdmissionPool, dependencies.ReplayPool)
	if err != nil {
		return nil, err
	}
	publicRoutes, err := newPublicRoutes(publicAuthorizer, validationSubmitter, replay)
	if err != nil {
		return nil, err
	}

	closeRedis = false
	return &Runtime{
		publisher:    publisher,
		private:      privateServers,
		controlRedis: controlRedis,
		publicRoutes: publicRoutes,
	}, nil
}

func phaseOneGRPCPolicy(maxConcurrentStreams uint32) runtimegrpc.GRPCServerPolicy {
	return runtimegrpc.GRPCServerPolicy{
		MaxConcurrentStreams:  maxConcurrentStreams,
		MaxConnections:        64,
		MinClientPingInterval: 30 * time.Second,
		KeepaliveTime:         time.Minute,
		KeepaliveTimeout:      10 * time.Second,
		MaxConnectionIdle:     5 * time.Minute,
		MaxConnectionAge:      30 * time.Minute,
		MaxConnectionAgeGrace: 30 * time.Second,
	}
}

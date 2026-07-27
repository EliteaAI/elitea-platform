package runtimecomposition

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	indexingapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/indexing"
	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	outputapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/output"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/migrate"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/pgvector"
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

	resourceClass          = "validation-small"
	isolationClass         = "shared-claim-scoped-authority"
	inputClassification    = "tenant-confidential"
	inputGrantAudience     = "elitea.runtime.input.read.v1"
	indexArtifactMediaType = "application/json"

	maxWorkerCommandBytes         = 32 * 1024
	maxSignedEnvelopeBytes        = 48 * 1024
	maxRedisFieldBytes            = 48 * 1024
	maxInputManifestBytes         = 64 * 1024
	maxInputEntries               = 16
	maxInputContentBytes          = 256 * 1024
	maxOutputFrameBytes           = 64 * 1024
	maxSafeStringBytes            = 256
	maxGRPCRequestBytes           = 64 * 1024
	maxGRPCResponseBytes          = 80 * 1024
	maxContentRequests            = 16
	maxIndexArtifactBytes         = 1 * 1024 * 1024
	claimLeaseTTL                 = 30 * time.Second
	productionIndexRedisEntrySize = (64 * 1024) - 1
)

type Dependencies struct {
	AdmissionPool                    *pgxpool.Pool
	ControlPool                      *pgxpool.Pool
	OutputPool                       *pgxpool.Pool
	ReplayPool                       *pgxpool.Pool
	ContentPool                      *pgxpool.Pool
	CurrentConfigurations            *CurrentConfigurationsRuntime
	ConfigurationLifecycleReconciler configurationapp.CurrentConfigurationLifecycleReconciler
	ActorTokenIssuer                 storage.ActorTokenIssuer
	ProjectTokenValidator            storage.ProjectTokenValidator
	PermissionResolver               auth.PermissionResolver
	Logger                           *slog.Logger
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
	if config.IndexIngestDispatchEnabled &&
		(dependencies.ActorTokenIssuer == nil || dependencies.ProjectTokenValidator == nil) {
		return nil, errors.New("runtime index ingest actor-token bridge is required")
	}
	if config.IndexIngestDispatchEnabled && dependencies.CurrentConfigurations == nil {
		return nil, errors.New("runtime index ingest current Configurations runtime is required")
	}
	if dependencies.ConfigurationLifecycleReconciler != nil && dependencies.CurrentConfigurations == nil {
		return nil, errors.New("configuration lifecycle requires current Configurations runtime")
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
	indexDispatchPolicy := repos.IndexIngestDispatchPolicy{
		StreamName:        config.IndexIngestCommandStream,
		CapabilityVersion: capabilityVersion,
		ResourceClass:     indexResourceClass,
		IsolationClass:    indexIsolationClass,
		Priority:          1,
		DeadlineTTL:       indexDeadlineTTL,
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
	var currentSDKConfigurationValidator configurationapp.CurrentSDKConfigurationValidator
	if dependencies.CurrentConfigurations != nil {
		validationCandidates, candidateErr := repos.NewCurrentSDKValidationCandidatesRepository(dependencies.AdmissionPool)
		if candidateErr != nil {
			return nil, fmt.Errorf("construct current SDK validation candidates: %w", candidateErr)
		}
		currentSDKConfigurationValidator, candidateErr = newCurrentSDKConfigurationValidator(
			dependencies.CurrentConfigurations.AvailableCatalog(),
			validationCandidates,
			bundles,
			jobSubmitter,
			currentRuntimeID,
		)
		if candidateErr != nil {
			return nil, fmt.Errorf("construct current SDK configuration validator: %w", candidateErr)
		}
	}
	validationSubmitter, err := configurationapp.NewSubmitValidationService(targets, bundles, jobSubmitter)
	if err != nil {
		return nil, err
	}

	var indexMetaTerminalEffect *currentIndexMetaTerminalProcessor
	var currentIndexMetaWriter *pgvector.CurrentIndexMetaWriter
	if config.IndexIngestDispatchEnabled {
		currentIndexMetaWriter = pgvector.NewCurrentIndexMetaWriter()
		indexMetaTerminalEffect, err = newCurrentIndexMetaTerminalProcessor(
			dependencies.ReplayPool,
			dependencies.CurrentConfigurations,
			currentIndexMetaWriter,
			func(err error) {
				dependencies.Logger.Error(
					"current index metadata terminal item requeued",
					"err",
					err,
				)
			},
		)
		if err != nil {
			return nil, fmt.Errorf("construct current index metadata terminal effect: %w", err)
		}
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
	var indexPublisher publisherRunner
	if config.IndexIngestDispatchEnabled {
		indexLimits := limits
		indexLimits.MaxRedisEntryBytes = productionIndexRedisEntrySize
		indexAppender, err := redisdispatch.NewRedisStreamAppender(controlRedis, redisdispatch.RedisStreamAppenderConfig{
			MaxEntries:    config.IndexIngestStreamMaxEntries,
			MaxEntryBytes: productionIndexRedisEntrySize,
		})
		if err != nil {
			return nil, fmt.Errorf("construct bounded index ingest Redis appender: %w", err)
		}
		indexProducer, err := redisdispatch.NewIndexIngestProducer(redisdispatch.IndexIngestProducerConfig{
			Stream:                 config.IndexIngestCommandStream,
			ConsumerGroup:          config.IndexIngestConsumerGroup,
			ValidationStream:       config.CommandStream,
			ProtocolRevision:       protocolRevision,
			EnvelopeSchemaRevision: envelopeSchemaRevision,
			CapabilityVersion:      capabilityVersion,
			Limits:                 indexLimits,
		}, signer, indexAppender)
		if err != nil {
			return nil, fmt.Errorf("construct index ingest Redis producer: %w", err)
		}
		indexOutbox, err := repos.NewCommandOutboxRepository(dependencies.AdmissionPool, config.IndexIngestCommandStream)
		if err != nil {
			return nil, fmt.Errorf("construct index ingest command outbox: %w", err)
		}
		indexDispatcher, err := indexingapp.NewIndexIngestDispatcher(indexOutbox, indexProducer)
		if err != nil {
			return nil, err
		}
		indexPublisher, err = indexingapp.NewIndexIngestOutboxPublisher(indexOutbox, indexDispatcher, executionapp.OutboxPublisherConfig{
			PollInterval:      250 * time.Millisecond,
			VisibilityTimeout: 30 * time.Second,
			BatchSize:         64,
			MaxConcurrent:     8,
			ReportFailure: func(err error) {
				dependencies.Logger.Error("index ingest outbox publisher cycle failed", "err", err)
			},
		})
		if err != nil {
			return nil, err
		}
	}
	publisherRoot, err := newConfiguredPublisherSet(config.IndexIngestDispatchEnabled, publisher, indexPublisher)
	if err != nil {
		return nil, err
	}
	if config.IndexIngestDispatchEnabled {
		indexMetaReconciler, reconcileErr := newCurrentIndexMetaTerminalReconciler(
			indexMetaTerminalEffect,
			500*time.Millisecond,
			8,
			func(err error) {
				dependencies.Logger.Error(
					"current index metadata terminal reconciliation failed",
					"err",
					err,
				)
			},
		)
		if reconcileErr != nil {
			return nil, fmt.Errorf(
				"construct current index metadata terminal reconciler: %w",
				reconcileErr,
			)
		}
		publisherRoot, err = newPublisherSet(publisherRoot, indexMetaReconciler)
		if err != nil {
			return nil, fmt.Errorf(
				"compose current index metadata terminal reconciler: %w",
				err,
			)
		}
	}
	if dependencies.ConfigurationLifecycleReconciler != nil {
		configurationLifecycle, lifecycleErr := newCurrentConfigurationLifecyclePublisher(
			dependencies.ControlPool,
			dependencies.ConfigurationLifecycleReconciler,
			dependencies.Logger,
		)
		if lifecycleErr != nil {
			return nil, fmt.Errorf("construct current configuration lifecycle processor: %w", lifecycleErr)
		}
		publisherRoot, err = newPublisherSet(publisherRoot, configurationLifecycle)
		if err != nil {
			return nil, fmt.Errorf("compose current configuration lifecycle processor: %w", err)
		}
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
	runtimeFailures, err := outputapp.NewRuntimeFailureService(
		outputInbox,
		outputClaims,
		results,
	)
	if err != nil {
		return nil, err
	}
	outputServerConfig := output.ServerConfig{
		OutputSchemaRevision: outputSchemaRevision,
		MaxFrameBytes:        maxOutputFrameBytes,
		CreditFrames:         1,
		CreditBytes:          maxOutputFrameBytes,
	}
	var outputServer *output.Server
	if config.IndexIngestDispatchEnabled {
		indexResults, err := repos.NewIndexIngestResultsRepository(dependencies.OutputPool, repos.IndexIngestOutputPolicy{
			LimitsRevision:    limitsRevision,
			ArtifactMediaType: indexArtifactMediaType,
			MaxArtifactBytes:  maxIndexArtifactBytes,
		})
		if err != nil {
			return nil, fmt.Errorf("construct index ingest result repository: %w", err)
		}
		indexOutput, err := outputapp.NewIndexIngestService(indexResults, outputClaims, indexResults, indexResults)
		if err != nil {
			return nil, err
		}
		nodeEvents, err := repos.NewNodeEventsRepository(dependencies.OutputPool)
		if err != nil {
			return nil, fmt.Errorf("construct node event replay repository: %w", err)
		}
		nodeEventOutput, err := outputapp.NewNodeEventService(outputClaims, nodeEvents)
		if err != nil {
			return nil, err
		}
		outputServer, err = output.NewServerWithIndexIngestAndNodeEvents(
			outputServerConfig,
			outputPeerAuthorizer,
			validationOutput,
			runtimeFailures,
			indexOutput,
			nodeEventOutput,
		)
	} else {
		outputServer, err = output.NewServer(outputServerConfig, outputPeerAuthorizer, validationOutput, runtimeFailures)
	}
	if err != nil {
		return nil, err
	}

	contentRepository, err := storage.NewPostgresContentRepository(dependencies.ContentPool)
	if err != nil {
		return nil, fmt.Errorf("construct runtime content repository: %w", err)
	}
	var contentServer *storage.ContentServer
	var indexStart indexingapi.StartUseCase
	var currentIndex *currentIndexRuntime
	if config.IndexIngestDispatchEnabled {
		runtimeToken, err := storage.NewEliteaClientTokenService(
			contentRepository,
			dependencies.ActorTokenIssuer,
			dependencies.ProjectTokenValidator,
		)
		if err != nil {
			return nil, fmt.Errorf("construct runtime index client-token context: %w", err)
		}
		currentIndex, err = newCurrentIndexRuntime(
			dependencies.AdmissionPool,
			dependencies.CurrentConfigurations,
			config,
			indexDispatchPolicy,
			currentIndexMetaWriter,
		)
		if err != nil {
			return nil, fmt.Errorf("construct current index runtime: %w", err)
		}
		contentServer, err = storage.NewMaterializingRuntimeContentServerWithLimits(
			contentRepository,
			contentRepository,
			currentIndex.materializer,
			runtimeToken,
			maxInputContentBytes,
			maxContentRequests,
		)
		if err != nil {
			return nil, err
		}
		indexStart = currentIndex.start
	} else {
		contentServer, err = storage.NewContentServerWithLimits(contentRepository, contentRepository, maxInputContentBytes, maxContentRequests)
		if err != nil {
			return nil, err
		}
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
	publicAuthorizer, err := newPostgresPublicAuthorizer(
		dependencies.AdmissionPool,
		dependencies.ReplayPool,
		dependencies.PermissionResolver,
	)
	if err != nil {
		return nil, err
	}
	publicRoutes, err := newPublicRoutes(publicAuthorizer, validationSubmitter, replay, indexStart)
	if err != nil {
		return nil, err
	}
	if currentIndex != nil {
		publicRoutes.IndexCancel = currentIndex.cancel
		publicRoutes.IndexMeta = currentIndex.indexMeta
	}

	closeRedis = false
	return &Runtime{
		publisher:              publisherRoot,
		private:                privateServers,
		controlRedis:           controlRedis,
		publicRoutes:           publicRoutes,
		configurationValidator: currentSDKConfigurationValidator,
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

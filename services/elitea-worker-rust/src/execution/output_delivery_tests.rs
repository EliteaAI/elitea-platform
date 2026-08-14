use std::collections::BTreeMap;
use std::collections::VecDeque;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use prost::Message;
use ring::digest;
use tokio::sync::{Semaphore, oneshot};
use tonic::{Request, Response, Status};

use super::agent_delivery::{FreshAgentDelivery, test_fresh_agent_delivery};
use super::agent_invocation::{
    AgentAuthorizationJob, AgentAuthorizationJobCompletion, AgentAuthorizedLifecycleCompletion,
    AuthorizedAgentLifecycle,
};
use super::agent_lease::ClaimLeaseMonitorConfig;
use super::agent_preparation::{
    AgentInputMaterializer, AgentPreparationConfig, AgentPreparationOutcome, PreInvocationTerminal,
    prepare_fresh_agent_invocation_with,
};
use super::invocation_admission::{InvocationAdmission, InvocationAdmissionConfig};
use super::invocation_supervisor::InvocationSupervisor;
use super::output_delivery::{
    AcceptedTerminalOutputRecovery, AgentOutputPreflight, AgentOutputPreflightError,
    AgentOutputPreflightKind, AgentOutputPreflightOutcome, AgentOutputRecoveryRequiredKind,
    AgentProgressConnector, AgentProgressPublishOutcome, AgentProgressPublisherConfig,
    AgentProgressReplaySession, AgentProgressSession, AgentTerminalRecoveryConfig,
    AgentTerminalRecoveryError, AgentTerminalReplay, FreshAgentProgressPublisher,
    publish_pre_invocation_terminal, recover_accepted_terminal,
};
use crate::agents::AgentExecutionKind;
use crate::protocol::command::{
    SignedCommandAuthenticator, TestOnlyConformanceHmacAuthenticator,
    parse_and_verify_agent_command,
};
use crate::protocol::control::{
    AgentControlClient, test_accepted_agent_claim, test_agent_output_authority,
    test_agent_output_authority_with_handoff, test_lease_monitored_input_execution,
};
use crate::protocol::elitea::runtime::v1::{
    AuthorizeInvocationDispositionV1, AuthorizeInvocationRequestV1, AuthorizeInvocationResponseV1,
    BeginExecutionDispositionV1, BeginExecutionRequestV1, BeginExecutionResponseV1,
    ClaimCommandRequestV1, ClaimCommandResponseV1, DesiredExecutionStateV1, DigestAlgorithmV1,
    DigestV1, ExecutionFenceV1, ExecutionIdentityV1, ExecutionOutputEventTypeV1,
    ExecutionOutputFrameV1, ObserveDesiredStateRequestV1, ObserveDesiredStateResponseV1,
    PrepareSettlementRequestV1, PrepareSettlementResponseV1, RenewLeaseRequestV1,
    RenewLeaseResponseV1, RuntimeErrorCodeV1, execution_output_frame_v1,
};
use crate::protocol::node_event::decode_current_node_event_json;
use crate::protocol::output::{OUTPUT_SCHEMA_REVISION, RuntimeFailureKind};
use crate::spool::{SpoolError, SpoolLimits, SpoolMasterKey};
use crate::transport::output_grpc::{
    ProgressRejectionWinner, ProgressReplayDecision, test_acknowledged_progress,
    test_acknowledged_terminal, test_rejected_progress,
};
use crate::transport::redis_commands::{
    RedisCommandDelivery, RedisCommandLimits, RedisCommandRetirer, RedisRetirementClient,
    RedisRetirementClientError, RedisRetirementConfig, RedisRetirementRequest,
    RedisRetirementResponse,
};
use crate::transport::{
    ControlGrpcConfig, ControlRpc, DurablyAckedTerminal, OutputGrpcConfig, OutputGrpcError,
    OutputProtocolError, PreparedOutputSpool,
};
use crate::transport::{InputContentError, MaterializedInput};

const NOW: i64 = 1_700_000_000_000;

fn vectors() -> BTreeMap<&'static str, &'static str> {
    include_str!("../../tests/fixtures/agent_control_vectors.txt")
        .lines()
        .map(|line| line.split_once('=').expect("named fixture"))
        .collect()
}

fn decode_hex(raw: &str) -> Vec<u8> {
    raw.trim()
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            u8::from_str_radix(std::str::from_utf8(pair).expect("ASCII hex"), 16)
                .expect("fixture hex")
        })
        .collect()
}

fn bytes(name: &str) -> Vec<u8> {
    decode_hex(vectors()[name])
}

fn output_bytes(name: &str) -> Vec<u8> {
    let output_vectors: BTreeMap<_, _> =
        include_str!("../../tests/fixtures/agent_output_vectors.txt")
            .lines()
            .map(|line| line.split_once('=').expect("named output fixture"))
            .collect();
    decode_hex(output_vectors[name])
}

fn claim_response() -> ClaimCommandResponseV1 {
    ClaimCommandResponseV1::decode(bytes("accepted_claim").as_slice()).expect("claim fixture")
}

fn fresh() -> FreshAgentDelivery {
    let raw = bytes("signed_command");
    let verified = parse_and_verify_agent_command(
        &raw,
        Some(&TestOnlyConformanceHmacAuthenticator as &dyn SignedCommandAuthenticator),
    )
    .expect("verified command");
    let claim =
        test_accepted_agent_claim(&verified, claim_response(), "workload-1", "worker-1", NOW)
            .expect("accepted claim");
    let delivery = RedisCommandDelivery::decode(
        b"runtime.commands.v1",
        b"1700000000000-0",
        vec![(b"signed_envelope".to_vec(), raw)],
        RedisCommandLimits {
            max_entry_bytes: 64 * 1024,
            max_field_bytes: 48 * 1024,
        },
    )
    .expect("Redis delivery");
    test_fresh_agent_delivery(delivery, verified, claim)
}

fn output_config(producer_id: &str) -> OutputGrpcConfig {
    OutputGrpcConfig {
        max_queued_frames: 1,
        max_queued_bytes: 64 * 1024,
        max_frame_bytes: 64 * 1024,
        max_server_credit_frames: 1,
        max_server_credit_bytes: 64 * 1024,
        stream_deadline: Duration::from_mins(1),
        ack_timeout: Duration::from_secs(1),
        workload_session_id: "workload-1".to_owned(),
        producer_id: producer_id.to_owned(),
    }
}

fn spool_limits() -> SpoolLimits {
    SpoolLimits {
        max_frames: 1,
        max_encrypted_bytes: 65 * 1024,
        max_frame_bytes: 64 * 1024,
    }
}

fn root() -> (tempfile::TempDir, PathBuf) {
    let base = std::env::temp_dir()
        .canonicalize()
        .expect("canonical temporary root");
    let temporary = tempfile::tempdir_in(base).expect("temporary output root");
    fs::set_permissions(temporary.path(), fs::Permissions::from_mode(0o700))
        .expect("private output root");
    let root = temporary.path().to_path_buf();
    (temporary, root)
}

fn preflight(root: PathBuf, producer_id: &str) -> AgentOutputPreflight {
    AgentOutputPreflight::new(
        root,
        SpoolMasterKey::new([b'p'; 32]),
        spool_limits(),
        output_config(producer_id),
    )
}

#[derive(Clone, Copy)]
enum ReplayResult {
    Acknowledged,
    AdvanceAndAcknowledged,
    Unavailable,
    DependencyUnavailable,
    AuthorizationFailed,
    CancellationWon,
    DeadlineWon,
}

struct FakeReplay {
    results: Mutex<VecDeque<ReplayResult>>,
    frames: Mutex<Vec<ExecutionOutputFrameV1>>,
    trace: Arc<Mutex<Vec<&'static str>>>,
}

impl FakeReplay {
    fn new(
        results: impl IntoIterator<Item = ReplayResult>,
        trace: Arc<Mutex<Vec<&'static str>>>,
    ) -> Self {
        Self {
            results: Mutex::new(results.into_iter().collect()),
            frames: Mutex::new(Vec::new()),
            trace,
        }
    }
}

#[async_trait]
impl AgentTerminalReplay for FakeReplay {
    async fn replay_terminal(
        &self,
        mut spool: PreparedOutputSpool,
        verified: &crate::protocol::command::VerifiedAgentCommand,
        expected: &ExecutionOutputFrameV1,
    ) -> Result<DurablyAckedTerminal, OutputGrpcError> {
        assert_eq!(spool.pending_frame_count(), 1);
        assert!(spool.replays(expected));
        self.trace.lock().expect("trace").push("replay");
        self.frames.lock().expect("frames").push(expected.clone());
        let result = self
            .results
            .lock()
            .expect("replay results")
            .pop_front()
            .expect("scripted replay result");
        match result {
            ReplayResult::Acknowledged => {
                spool.reconcile_pending_through(expected.sequence)?;
                test_acknowledged_terminal(verified, expected)
            }
            ReplayResult::AdvanceAndAcknowledged => {
                tokio::task::yield_now().await;
                tokio::time::advance(Duration::from_millis(1)).await;
                tokio::task::yield_now().await;
                spool.reconcile_pending_through(expected.sequence)?;
                test_acknowledged_terminal(verified, expected)
            }
            ReplayResult::Unavailable => Err(OutputGrpcError::Unavailable(
                "the test output endpoint is unavailable",
            )),
            ReplayResult::DependencyUnavailable => Err(OutputGrpcError::Protocol(
                OutputProtocolError::DependencyUnavailable,
            )),
            ReplayResult::AuthorizationFailed => Err(OutputGrpcError::Protocol(
                OutputProtocolError::AuthorizationFailed("the test output was rejected"),
            )),
            ReplayResult::CancellationWon => Err(OutputGrpcError::Protocol(
                OutputProtocolError::CancellationWon,
            )),
            ReplayResult::DeadlineWon => {
                Err(OutputGrpcError::Protocol(OutputProtocolError::DeadlineWon))
            }
        }
    }
}

struct RecoveryControl {
    trace: Arc<Mutex<Vec<&'static str>>>,
    settlement_fails: bool,
    authorize_disposition: Option<AuthorizeInvocationDispositionV1>,
    authorize_unavailable: bool,
    renew_fail_after: Option<usize>,
    renew_attempts: AtomicUsize,
    observe_states: Mutex<VecDeque<i32>>,
}

#[async_trait]
impl ControlRpc for RecoveryControl {
    async fn claim_command(
        &self,
        _request: Request<ClaimCommandRequestV1>,
    ) -> Result<Response<ClaimCommandResponseV1>, Status> {
        panic!("terminal recovery must not claim twice")
    }

    async fn begin_execution(
        &self,
        _request: Request<BeginExecutionRequestV1>,
    ) -> Result<Response<BeginExecutionResponseV1>, Status> {
        self.trace.lock().expect("trace").push("begin");
        Ok(Response::new(BeginExecutionResponseV1 {
            disposition: BeginExecutionDispositionV1::StartedNow as i32,
            rejection: None,
        }))
    }

    async fn authorize_invocation(
        &self,
        _request: Request<AuthorizeInvocationRequestV1>,
    ) -> Result<Response<AuthorizeInvocationResponseV1>, Status> {
        self.trace.lock().expect("trace").push("authorize");
        if self.authorize_unavailable {
            return Err(Status::unavailable(
                "test authorization transport unavailable",
            ));
        }
        let disposition = self
            .authorize_disposition
            .expect("terminal recovery must not authorize");
        Ok(Response::new(AuthorizeInvocationResponseV1 {
            disposition: disposition as i32,
            rejection: None,
        }))
    }

    async fn renew_lease(
        &self,
        _request: Request<RenewLeaseRequestV1>,
    ) -> Result<Response<RenewLeaseResponseV1>, Status> {
        self.trace.lock().expect("trace").push("renew");
        let attempt = self.renew_attempts.fetch_add(1, Ordering::SeqCst);
        if self
            .renew_fail_after
            .is_some_and(|successful| attempt >= successful)
        {
            return Err(Status::unavailable("test lease renewal unavailable"));
        }
        Ok(Response::new(RenewLeaseResponseV1 {
            lease_expires_at_unix_millis: NOW + 60_000,
            desired_state: DesiredExecutionStateV1::Running as i32,
            rejection: None,
        }))
    }

    async fn observe_desired_state(
        &self,
        _request: Request<ObserveDesiredStateRequestV1>,
    ) -> Result<Response<ObserveDesiredStateResponseV1>, Status> {
        self.trace.lock().expect("trace").push("observe");
        Ok(Response::new(ObserveDesiredStateResponseV1 {
            desired_state: self
                .observe_states
                .lock()
                .expect("observe states")
                .pop_front()
                .unwrap_or(DesiredExecutionStateV1::Running as i32),
            rejection: None,
        }))
    }

    async fn prepare_settlement(
        &self,
        request: Request<PrepareSettlementRequestV1>,
    ) -> Result<Response<PrepareSettlementResponseV1>, Status> {
        self.trace.lock().expect("trace").push("settlement");
        if self.settlement_fails {
            return Err(Status::unavailable("test settlement unavailable"));
        }
        let outcome = request
            .into_inner()
            .proposal
            .expect("settlement proposal")
            .requested_outcome;
        Ok(Response::new(PrepareSettlementResponseV1 {
            settlement_receipt_id: "settlement-receipt-1".to_owned(),
            outcome,
            rejection: None,
        }))
    }
}

struct InvalidAgentInput {
    trace: Arc<Mutex<Vec<&'static str>>>,
}

struct ValidAgentInput {
    trace: Arc<Mutex<Vec<&'static str>>>,
}

#[async_trait]
impl AgentInputMaterializer for ValidAgentInput {
    async fn materialize(
        &self,
        _execution: &crate::protocol::control::LeaseMonitoredAgentExecution,
    ) -> Result<MaterializedInput, InputContentError> {
        self.trace.lock().expect("trace").push("input");
        Ok(MaterializedInput::for_test(decode_hex(include_str!(
            "../../tests/fixtures/agent_application_input.hex"
        ))))
    }
}

#[async_trait]
impl AgentInputMaterializer for InvalidAgentInput {
    async fn materialize(
        &self,
        _execution: &crate::protocol::control::LeaseMonitoredAgentExecution,
    ) -> Result<MaterializedInput, InputContentError> {
        self.trace.lock().expect("trace").push("input");
        Err(InputContentError::InvalidInput(
            "the test agent input is invalid",
        ))
    }
}

fn recovery_control(
    trace: Arc<Mutex<Vec<&'static str>>>,
    settlement_fails: bool,
) -> Arc<AgentControlClient<RecoveryControl>> {
    recovery_control_with_policy(trace, settlement_fails, None, [])
}

fn recovery_control_with_policy(
    trace: Arc<Mutex<Vec<&'static str>>>,
    settlement_fails: bool,
    renew_fail_after: Option<usize>,
    observe_states: impl IntoIterator<Item = DesiredExecutionStateV1>,
) -> Arc<AgentControlClient<RecoveryControl>> {
    Arc::new(
        AgentControlClient::new(
            RecoveryControl {
                trace,
                settlement_fails,
                authorize_disposition: None,
                authorize_unavailable: false,
                renew_fail_after,
                renew_attempts: AtomicUsize::new(0),
                observe_states: Mutex::new(
                    observe_states
                        .into_iter()
                        .map(|state| state as i32)
                        .collect(),
                ),
            },
            ControlGrpcConfig {
                deadline: Duration::from_secs(1),
                workload_session_id: "workload-1".to_owned(),
                producer_id: "worker-1".to_owned(),
            },
        )
        .expect("recovery control"),
    )
}

fn authorization_control_with_disposition(
    trace: Arc<Mutex<Vec<&'static str>>>,
    disposition: AuthorizeInvocationDispositionV1,
) -> Arc<AgentControlClient<RecoveryControl>> {
    Arc::new(
        AgentControlClient::new(
            RecoveryControl {
                trace,
                settlement_fails: false,
                authorize_disposition: Some(disposition),
                authorize_unavailable: false,
                renew_fail_after: None,
                renew_attempts: AtomicUsize::new(0),
                observe_states: Mutex::new(VecDeque::new()),
            },
            ControlGrpcConfig {
                deadline: Duration::from_secs(1),
                workload_session_id: "workload-1".to_owned(),
                producer_id: "worker-1".to_owned(),
            },
        )
        .expect("authorization control"),
    )
}

fn authorization_control(
    trace: Arc<Mutex<Vec<&'static str>>>,
) -> Arc<AgentControlClient<RecoveryControl>> {
    authorization_control_with_disposition(
        trace,
        AuthorizeInvocationDispositionV1::AlreadyAuthorized,
    )
}

fn authorized_control(
    trace: Arc<Mutex<Vec<&'static str>>>,
) -> Arc<AgentControlClient<RecoveryControl>> {
    authorization_control_with_disposition(trace, AuthorizeInvocationDispositionV1::AuthorizedNow)
}

fn unavailable_authorization_control(
    trace: Arc<Mutex<Vec<&'static str>>>,
) -> Arc<AgentControlClient<RecoveryControl>> {
    Arc::new(
        AgentControlClient::new(
            RecoveryControl {
                trace,
                settlement_fails: false,
                authorize_disposition: None,
                authorize_unavailable: true,
                renew_fail_after: None,
                renew_attempts: AtomicUsize::new(0),
                observe_states: Mutex::new(VecDeque::new()),
            },
            ControlGrpcConfig {
                deadline: Duration::from_secs(1),
                workload_session_id: "workload-1".to_owned(),
                producer_id: "worker-1".to_owned(),
            },
        )
        .expect("unavailable authorization control"),
    )
}

struct GatedAuthorizedLifecycle {
    trace: Arc<Mutex<Vec<&'static str>>>,
    started: Mutex<Option<oneshot::Sender<()>>>,
    release: Arc<Semaphore>,
}

impl AuthorizedAgentLifecycle for GatedAuthorizedLifecycle {
    fn run(
        &self,
        run: super::agent_preparation::AuthorizedAgentRun,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = AgentAuthorizedLifecycleCompletion> + Send + 'static>,
    > {
        let trace = Arc::clone(&self.trace);
        let started = self.started.lock().expect("started").take();
        let release = Arc::clone(&self.release);
        Box::pin(async move {
            trace.lock().expect("trace").push("authorized");
            let execution_kind = run.execution_kind();
            if let Some(started) = started {
                let _ignored = started.send(());
            }
            release
                .acquire()
                .await
                .expect("authorized lifecycle release")
                .forget();
            let (_request, lease) = run.into_test_cleanup();
            lease.close().await.expect("authorized lease close");
            AgentAuthorizedLifecycleCompletion::for_test(execution_kind)
        })
    }
}

fn recovery_control_with_renew_failure(
    trace: Arc<Mutex<Vec<&'static str>>>,
) -> Arc<AgentControlClient<RecoveryControl>> {
    recovery_control_with_policy(trace, false, Some(0), [])
}

struct RecoveryRedis {
    trace: Arc<Mutex<Vec<&'static str>>>,
    result: Result<RedisRetirementResponse, RedisRetirementClientError>,
}

#[async_trait]
impl RedisRetirementClient for RecoveryRedis {
    async fn retire_delivery(
        &self,
        request: RedisRetirementRequest,
    ) -> Result<RedisRetirementResponse, RedisRetirementClientError> {
        assert_eq!(request.stream(), "runtime.commands.v1");
        self.trace.lock().expect("trace").push("redis");
        self.result
    }
}

fn recovery_retirer(
    trace: Arc<Mutex<Vec<&'static str>>>,
    result: Result<RedisRetirementResponse, RedisRetirementClientError>,
) -> RedisCommandRetirer<RecoveryRedis> {
    RedisCommandRetirer::new(
        RecoveryRedis { trace, result },
        RedisRetirementConfig {
            stream: "runtime.commands.v1".to_owned(),
            group: "runtime-workers".to_owned(),
            consumer: "worker-1".to_owned(),
        },
    )
    .expect("recovery retirer")
}

async fn pending_terminal_recovery() -> (
    tempfile::TempDir,
    AgentOutputPreflight,
    AcceptedTerminalOutputRecovery,
    ExecutionOutputFrameV1,
) {
    let (temporary, root) = root();
    let preflight = preflight(root, "worker-1");
    let empty = preflight.prepare(fresh()).await.expect("empty preflight");
    let AgentOutputPreflightOutcome::Empty(empty) = empty else {
        panic!("new execution spool must be empty");
    };
    let (fresh, output) = empty.into_parts();
    let mut spool = output.into_test_spool();
    let frame = terminal_frame(&fresh);
    spool.persist(frame.clone()).expect("durable terminal");
    drop(spool);
    let recovered = preflight.prepare(fresh).await.expect("terminal recovery");
    let AgentOutputPreflightOutcome::TerminalRecovery(recovery) = recovered else {
        panic!("durable terminal must route to recovery");
    };
    (temporary, preflight, *recovery, frame)
}

async fn pre_invocation_terminal_fixture(
    trace: Arc<Mutex<Vec<&'static str>>>,
) -> (
    tempfile::TempDir,
    Arc<AgentControlClient<RecoveryControl>>,
    PreInvocationTerminal,
    InvocationAdmission,
) {
    pre_invocation_terminal_fixture_with_policy(trace, None, []).await
}

async fn pre_invocation_terminal_fixture_with_policy(
    trace: Arc<Mutex<Vec<&'static str>>>,
    renew_fail_after: Option<usize>,
    observe_states: impl IntoIterator<Item = DesiredExecutionStateV1>,
) -> (
    tempfile::TempDir,
    Arc<AgentControlClient<RecoveryControl>>,
    PreInvocationTerminal,
    InvocationAdmission,
) {
    let (temporary, root) = root();
    let preflight = preflight(root, "worker-1");
    let empty = preflight.prepare(fresh()).await.expect("empty preflight");
    let AgentOutputPreflightOutcome::Empty(empty) = empty else {
        panic!("new execution spool must be empty");
    };
    let control =
        recovery_control_with_policy(Arc::clone(&trace), false, renew_fail_after, observe_states);
    let admission = InvocationAdmission::new(
        InvocationAdmissionConfig::new(1, Duration::from_secs(1)).expect("invocation admission"),
    );
    let outcome = prepare_fresh_agent_invocation_with(
        *empty,
        Arc::clone(&control),
        &admission,
        &InvalidAgentInput { trace },
        Arc::new(|| NOW),
        AgentPreparationConfig::new(Duration::from_secs(10)).expect("preparation config"),
    )
    .await
    .expect("pre-invocation terminal");
    let AgentPreparationOutcome::PreInvocationTerminal(terminal) = outcome else {
        panic!("invalid input must produce a pre-invocation terminal");
    };
    (temporary, control, *terminal, admission)
}

fn lease_config() -> ClaimLeaseMonitorConfig {
    ClaimLeaseMonitorConfig::new(Duration::from_secs(10)).expect("lease config")
}

fn recovery_config(max_output_sessions: usize) -> AgentTerminalRecoveryConfig {
    AgentTerminalRecoveryConfig::new(max_output_sessions).expect("recovery config")
}

fn progress_frame(
    fresh: &FreshAgentDelivery,
    fence: ExecutionFenceV1,
    sequence: u64,
    claim_handoff_watermark: u64,
) -> ExecutionOutputFrameV1 {
    let identity = fresh.spool_identity();
    let event = decode_current_node_event_json(
        br#"{"type":"agent_response","content":"durable progress"}"#,
    )
    .expect("valid current NodeEvent");
    let event_bytes = event.encode_to_vec();
    ExecutionOutputFrameV1 {
        output_schema_revision: OUTPUT_SCHEMA_REVISION.to_owned(),
        stream_id: format!("{}:{}", identity.execution_id, identity.generation),
        identity: Some(ExecutionIdentityV1 {
            tenant_id: identity.tenant_id,
            resource_project_id: identity.resource_project_id,
            projection_project_id: identity.projection_project_id,
            command_id: identity.command_id,
            execution_id: identity.execution_id,
            generation: identity.generation,
        }),
        fence: Some(fence),
        logical_output_id: format!("node-event:execution-1:{sequence}"),
        event_id: format!("command-1:{sequence}"),
        sequence,
        claim_handoff_watermark,
        event_type: ExecutionOutputEventTypeV1::NodeEvent as i32,
        occurred_at_unix_millis: NOW,
        payload_digest: Some(DigestV1 {
            algorithm: DigestAlgorithmV1::Sha256 as i32,
            value: digest::digest(&digest::SHA256, &event_bytes)
                .as_ref()
                .to_vec(),
        }),
        terminal: false,
        settlement_proposal: None,
        payload: Some(execution_output_frame_v1::Payload::NodeEvent(event)),
    }
}

fn terminal_frame(fresh: &FreshAgentDelivery) -> ExecutionOutputFrameV1 {
    let identity = fresh.spool_identity();
    let claim = claim_response();
    let receipt = claim.receipt.expect("claim receipt");
    let input_bundle_digest = receipt
        .input_bundle_ref
        .as_ref()
        .and_then(|reference| reference.digest.clone())
        .expect("claim input bundle digest");
    let request = receipt
        .input_bundle
        .as_ref()
        .and_then(|bundle| bundle.entries.first())
        .expect("claim request entry");
    let request_digest = request
        .content
        .as_ref()
        .and_then(|content| content.digest.clone())
        .expect("claim request digest");
    let request_version = request.immutable_version.clone();
    let mut frame =
        ExecutionOutputFrameV1::decode(output_bytes("completed_output_frame").as_slice())
            .expect("Python terminal output fixture");
    frame.stream_id = format!("{}:{}", identity.execution_id, identity.generation);
    frame.identity = Some(ExecutionIdentityV1 {
        tenant_id: identity.tenant_id,
        resource_project_id: identity.resource_project_id,
        projection_project_id: identity.projection_project_id,
        command_id: identity.command_id,
        execution_id: identity.execution_id,
        generation: identity.generation,
    });
    frame.fence = receipt.fence;
    frame.claim_handoff_watermark = fresh.claim_handoff_watermark();
    let Some(execution_output_frame_v1::Payload::AgentExecution(result)) = frame.payload.as_mut()
    else {
        panic!("terminal agent result");
    };
    result.input_bundle_digest = Some(input_bundle_digest);
    result.request_immutable_version = request_version;
    result.request_content_digest = Some(request_digest);
    let payload_digest = DigestV1 {
        algorithm: DigestAlgorithmV1::Sha256 as i32,
        value: digest::digest(&digest::SHA256, &result.encode_to_vec())
            .as_ref()
            .to_vec(),
    };
    frame.payload_digest = Some(payload_digest.clone());
    frame
        .settlement_proposal
        .as_mut()
        .expect("terminal settlement proposal")
        .terminal_payload_digest = Some(payload_digest);
    frame
}

#[derive(Clone, Copy)]
enum LiveProgressAction {
    Acknowledge,
    PersistThenUnavailable,
    PersistChangedFrameThenUnavailable,
    AuthorizationFailed,
    RejectCancellation,
    RetainAcknowledgementThenWait,
}

#[derive(Clone, Copy)]
enum ReplayProgressAction {
    Acknowledge,
    AuthorizationFailed,
    RetainAcknowledgementThenWait,
}

struct FakeProgressState {
    live_actions: Mutex<VecDeque<LiveProgressAction>>,
    replay_actions: Mutex<VecDeque<ReplayProgressAction>>,
    connects: AtomicUsize,
    sends: AtomicUsize,
    replays: AtomicUsize,
    live_closes: AtomicUsize,
    replay_closes: AtomicUsize,
    frames: Mutex<Vec<ExecutionOutputFrameV1>>,
    live_started: Semaphore,
    live_release: Semaphore,
    replay_started: Semaphore,
    replay_release: Semaphore,
}

impl FakeProgressState {
    fn new(
        live_actions: impl IntoIterator<Item = LiveProgressAction>,
        replay_actions: impl IntoIterator<Item = ReplayProgressAction>,
    ) -> Arc<Self> {
        Arc::new(Self {
            live_actions: Mutex::new(live_actions.into_iter().collect()),
            replay_actions: Mutex::new(replay_actions.into_iter().collect()),
            connects: AtomicUsize::new(0),
            sends: AtomicUsize::new(0),
            replays: AtomicUsize::new(0),
            live_closes: AtomicUsize::new(0),
            replay_closes: AtomicUsize::new(0),
            frames: Mutex::new(Vec::new()),
            live_started: Semaphore::new(0),
            live_release: Semaphore::new(0),
            replay_started: Semaphore::new(0),
            replay_release: Semaphore::new(0),
        })
    }
}

#[derive(Clone)]
struct FakeProgressConnector {
    state: Arc<FakeProgressState>,
}

struct FakeProgressSession {
    prepared: Option<PreparedOutputSpool>,
    state: Arc<FakeProgressState>,
    retained: Mutex<Option<ProgressReplayDecision>>,
}

#[async_trait]
impl AgentProgressSession for FakeProgressSession {
    async fn publish_progress(
        &mut self,
        frame: &ExecutionOutputFrameV1,
    ) -> Result<ProgressReplayDecision, OutputGrpcError> {
        self.state.sends.fetch_add(1, Ordering::SeqCst);
        self.state
            .frames
            .lock()
            .expect("progress frames")
            .push(frame.clone());
        let action = self
            .state
            .live_actions
            .lock()
            .expect("live actions")
            .pop_front()
            .expect("scripted live progress action");
        match action {
            LiveProgressAction::Acknowledge => Ok(ProgressReplayDecision::Acknowledged(
                test_acknowledged_progress(frame).expect("synthetic live progress ACK"),
            )),
            LiveProgressAction::PersistThenUnavailable => {
                self.prepared
                    .as_mut()
                    .expect("fresh prepared spool")
                    .persist(frame.clone())?;
                Err(OutputGrpcError::Unavailable(
                    "the scripted live progress stream is unavailable",
                ))
            }
            LiveProgressAction::PersistChangedFrameThenUnavailable => {
                let mut changed = frame.clone();
                changed.occurred_at_unix_millis += 1;
                self.prepared
                    .as_mut()
                    .expect("fresh prepared spool")
                    .persist(changed)?;
                Err(OutputGrpcError::Unavailable(
                    "the scripted changed progress stream is unavailable",
                ))
            }
            LiveProgressAction::AuthorizationFailed => Err(OutputGrpcError::Protocol(
                OutputProtocolError::AuthorizationFailed(
                    "the scripted progress session is not authorized",
                ),
            )),
            LiveProgressAction::RejectCancellation => Ok(ProgressReplayDecision::Rejected(
                test_rejected_progress(frame, ProgressRejectionWinner::Cancelled)
                    .expect("synthetic progress rejection"),
            )),
            LiveProgressAction::RetainAcknowledgementThenWait => {
                *self.retained.lock().expect("retained progress decision") =
                    Some(ProgressReplayDecision::Acknowledged(
                        test_acknowledged_progress(frame).expect("synthetic retained progress ACK"),
                    ));
                self.state.live_started.add_permits(1);
                self.state
                    .live_release
                    .acquire()
                    .await
                    .expect("live progress release")
                    .forget();
                self.retained
                    .lock()
                    .expect("retained progress decision")
                    .take()
                    .ok_or(OutputGrpcError::Unavailable(
                        "the scripted retained progress decision is unavailable",
                    ))
            }
        }
    }

    fn take_progress_decision(
        &self,
        _frame: &ExecutionOutputFrameV1,
    ) -> Result<Option<ProgressReplayDecision>, OutputGrpcError> {
        Ok(self
            .retained
            .lock()
            .map_err(|_| {
                OutputGrpcError::Unavailable(
                    "the scripted retained progress decision is unavailable",
                )
            })?
            .take())
    }

    async fn close(&mut self) -> Result<(), OutputGrpcError> {
        self.state.live_closes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

struct FakeProgressReplaySession {
    prepared: Option<PreparedOutputSpool>,
    expected: ExecutionOutputFrameV1,
    state: Arc<FakeProgressState>,
    action: ReplayProgressAction,
    retained: Option<ProgressReplayDecision>,
}

#[async_trait]
impl AgentProgressReplaySession for FakeProgressReplaySession {
    async fn wait(&mut self) -> Result<ProgressReplayDecision, OutputGrpcError> {
        if self.retained.is_none() {
            if matches!(self.action, ReplayProgressAction::AuthorizationFailed) {
                return Err(OutputGrpcError::Protocol(
                    OutputProtocolError::AuthorizationFailed(
                        "the scripted progress replay is not authorized",
                    ),
                ));
            }
            let prepared = self.prepared.as_mut().ok_or(OutputGrpcError::Unavailable(
                "the scripted replay spool is unavailable",
            ))?;
            assert!(prepared.replays(&self.expected));
            prepared.reconcile_pending_through(self.expected.sequence)?;
            self.retained = Some(ProgressReplayDecision::Acknowledged(
                test_acknowledged_progress(&self.expected)
                    .expect("synthetic restored progress ACK"),
            ));
            if matches!(
                self.action,
                ReplayProgressAction::RetainAcknowledgementThenWait
            ) {
                self.state.replay_started.add_permits(1);
                self.state
                    .replay_release
                    .acquire()
                    .await
                    .expect("replay progress release")
                    .forget();
            }
        }
        self.retained.take().ok_or(OutputGrpcError::Unavailable(
            "the scripted replay decision is unavailable",
        ))
    }

    async fn close(&mut self) -> Result<(), OutputGrpcError> {
        self.state.replay_closes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

#[async_trait]
impl AgentProgressConnector for FakeProgressConnector {
    type Session = FakeProgressSession;
    type Replay = FakeProgressReplaySession;

    async fn connect_progress(
        &self,
        prepared: PreparedOutputSpool,
    ) -> Result<Self::Session, OutputGrpcError> {
        assert_eq!(prepared.pending_frame_count(), 0);
        self.state.connects.fetch_add(1, Ordering::SeqCst);
        Ok(FakeProgressSession {
            prepared: Some(prepared),
            state: Arc::clone(&self.state),
            retained: Mutex::new(None),
        })
    }

    async fn start_progress_replay(
        &self,
        prepared: PreparedOutputSpool,
        expected: &ExecutionOutputFrameV1,
    ) -> Result<Self::Replay, OutputGrpcError> {
        assert_eq!(prepared.pending_frame_count(), 1);
        assert!(prepared.replays(expected));
        self.state.replays.fetch_add(1, Ordering::SeqCst);
        let action = self
            .state
            .replay_actions
            .lock()
            .expect("replay actions")
            .pop_front()
            .expect("scripted replay progress action");
        Ok(FakeProgressReplaySession {
            prepared: Some(prepared),
            expected: expected.clone(),
            state: Arc::clone(&self.state),
            action,
            retained: None,
        })
    }
}

async fn fresh_progress_publisher(
    state: Arc<FakeProgressState>,
    max_output_sessions: usize,
) -> (
    tempfile::TempDir,
    crate::protocol::command::VerifiedAgentCommand,
    FreshAgentProgressPublisher<FakeProgressConnector>,
) {
    fresh_progress_publisher_with_handoff(state, max_output_sessions, None).await
}

async fn fresh_progress_publisher_with_handoff(
    state: Arc<FakeProgressState>,
    max_output_sessions: usize,
    handoff: Option<u64>,
) -> (
    tempfile::TempDir,
    crate::protocol::command::VerifiedAgentCommand,
    FreshAgentProgressPublisher<FakeProgressConnector>,
) {
    let (temporary, output_root) = root();
    let outcome = preflight(output_root, "worker-1")
        .prepare(fresh())
        .await
        .expect("fresh progress preflight");
    let AgentOutputPreflightOutcome::Empty(empty) = outcome else {
        panic!("new progress spool must be empty");
    };
    let (fresh, output) = empty.into_parts();
    let (_delivery, verified, claim) = fresh.into_parts();
    let authority = match handoff {
        Some(handoff) => test_agent_output_authority_with_handoff(claim, handoff),
        None => test_agent_output_authority(claim),
    };
    let cursor = authority
        .into_output_cursor(&verified)
        .expect("claim-bound output cursor");
    let publisher = FreshAgentProgressPublisher::new(
        cursor,
        output,
        FakeProgressConnector { state },
        AgentProgressPublisherConfig::new(max_output_sessions).expect("progress publisher config"),
    );
    (temporary, verified, publisher)
}

fn browser_progress(content: &'static str) -> crate::protocol::elitea::runtime::v1::NodeEventV1 {
    let raw = format!(r#"{{"type":"agent_response","content":"{content}"}}"#);
    decode_current_node_event_json(raw.as_bytes()).expect("valid browser progress event")
}

fn browser_full_message(
    content: &'static str,
) -> crate::protocol::elitea::runtime::v1::NodeEventV1 {
    let raw = format!(r#"{{"type":"full_message","content":"{content}"}}"#);
    decode_current_node_event_json(raw.as_bytes()).expect("valid full message event")
}

#[test]
fn progress_session_budget_matches_the_deployed_v1_bounds() {
    assert!(AgentProgressPublisherConfig::new(1).is_ok());
    assert!(AgentProgressPublisherConfig::new(8).is_ok());
    for invalid in [0, 9] {
        let error = AgentProgressPublisherConfig::new(invalid)
            .expect_err("progress session budget must be bounded");
        assert_eq!(error.code(), "agent_progress.invalid_configuration");
        assert!(!error.retryable());
    }
}

#[tokio::test]
async fn fresh_progress_keeps_one_live_session_across_exact_acked_events() {
    let state = FakeProgressState::new(
        [
            LiveProgressAction::Acknowledge,
            LiveProgressAction::Acknowledge,
        ],
        [],
    );
    let (_temporary, verified, mut publisher) =
        fresh_progress_publisher(Arc::clone(&state), 2).await;

    let first = publisher
        .publish(&verified, browser_progress("first"), NOW)
        .await
        .expect("first progress ACK");
    let second = publisher
        .publish(&verified, browser_progress("second"), NOW + 1)
        .await
        .expect("second progress ACK");

    assert_eq!(
        first,
        AgentProgressPublishOutcome::Acknowledged { sequence: 5 }
    );
    assert_eq!(
        second,
        AgentProgressPublishOutcome::Acknowledged { sequence: 6 }
    );
    assert_eq!(state.connects.load(Ordering::SeqCst), 1);
    assert_eq!(state.sends.load(Ordering::SeqCst), 2);
    assert_eq!(state.replays.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn acked_full_message_binds_the_exact_canonical_browser_bytes() {
    let state = FakeProgressState::new([LiveProgressAction::Acknowledge], []);
    let (_temporary, verified, mut publisher) =
        fresh_progress_publisher(Arc::clone(&state), 2).await;
    let full_message = browser_full_message("final answer");
    let browser_json = crate::protocol::node_event::encode_current_node_event_json(&full_message)
        .expect("canonical full message JSON");
    let expected_digest = digest::digest(&digest::SHA256, &browser_json);

    let outcome = publisher
        .publish_full_message(&verified, full_message, NOW)
        .await
        .expect("durable full message ACK");
    assert_eq!(
        outcome,
        AgentProgressPublishOutcome::Acknowledged { sequence: 5 }
    );
    let later = publisher
        .publish(&verified, browser_progress("must not follow"), NOW + 1)
        .await
        .expect_err("full_message must remain the last progress event");
    assert_eq!(later.code(), "agent_progress.invalid_state");

    let artifact = publisher
        .into_test_acked_full_message()
        .expect("ACKed full message artifact proof");
    assert_eq!(
        artifact.artifact_id,
        format!(
            "node-event:{}:full-message",
            verified.command().execution_id
        )
    );
    assert_eq!(artifact.byte_length, browser_json.len() as u64);
    assert_eq!(artifact.digest.as_slice(), expected_digest.as_ref());
    assert_eq!(
        artifact.immutable_version,
        format!("sha256:{}", hex_lower(expected_digest.as_ref()))
    );
}

#[tokio::test]
async fn generic_or_unacknowledged_progress_cannot_mint_a_completed_terminal() {
    let state = FakeProgressState::new([LiveProgressAction::PersistThenUnavailable], []);
    let (_temporary, verified, mut publisher) =
        fresh_progress_publisher(Arc::clone(&state), 1).await;

    let generic = publisher
        .publish(&verified, browser_full_message("wrong path"), NOW)
        .await
        .expect_err("generic progress cannot mint a result artifact");
    assert_eq!(generic.code(), "agent_progress.invalid_state");
    publisher
        .publish_full_message(&verified, browser_full_message("not ACKed"), NOW)
        .await
        .expect_err("transport uncertainty must retain the full message");
    assert!(publisher.into_test_acked_full_message().is_none());
    assert_eq!(state.sends.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn restored_full_message_ack_retains_the_same_terminal_artifact_authority() {
    let state = FakeProgressState::new(
        [LiveProgressAction::PersistThenUnavailable],
        [ReplayProgressAction::Acknowledge],
    );
    let (_temporary, verified, mut publisher) =
        fresh_progress_publisher(Arc::clone(&state), 2).await;
    let outcome = publisher
        .publish_full_message(&verified, browser_full_message("restored result"), NOW)
        .await
        .expect("restored full message ACK");
    assert_eq!(
        outcome,
        AgentProgressPublishOutcome::Acknowledged { sequence: 5 }
    );
    assert!(publisher.into_test_acked_full_message().is_some());
    assert_eq!(state.replays.load(Ordering::SeqCst), 1);
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(char::from(HEX[usize::from(byte >> 4)]));
        output.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    output
}

#[tokio::test]
async fn uncertain_live_progress_reopens_and_replays_the_exact_durable_frame() {
    let state = FakeProgressState::new(
        [LiveProgressAction::PersistThenUnavailable],
        [ReplayProgressAction::Acknowledge],
    );
    let (_temporary, verified, mut publisher) =
        fresh_progress_publisher(Arc::clone(&state), 2).await;

    let outcome = publisher
        .publish(&verified, browser_progress("recover me"), NOW)
        .await
        .expect("restored progress ACK");

    assert_eq!(
        outcome,
        AgentProgressPublishOutcome::Acknowledged { sequence: 5 }
    );
    assert_eq!(state.connects.load(Ordering::SeqCst), 1);
    assert_eq!(state.sends.load(Ordering::SeqCst), 1);
    assert_eq!(state.live_closes.load(Ordering::SeqCst), 1);
    assert_eq!(state.replays.load(Ordering::SeqCst), 1);
    assert_eq!(state.replay_closes.load(Ordering::SeqCst), 1);
    let frames = state.frames.lock().expect("progress frames");
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0].sequence, 5);
}

#[tokio::test]
async fn changed_durable_progress_is_rejected_before_a_replay_session_starts() {
    let state = FakeProgressState::new(
        [LiveProgressAction::PersistChangedFrameThenUnavailable],
        [ReplayProgressAction::Acknowledge],
    );
    let (_temporary, verified, mut publisher) =
        fresh_progress_publisher(Arc::clone(&state), 2).await;

    let error = publisher
        .publish(&verified, browser_progress("bind exact bytes"), NOW)
        .await
        .expect_err("changed durable bytes must fail closed");

    assert_eq!(error.code(), "agent_output.invalid_durable_state");
    assert!(!error.retryable());
    assert_eq!(state.connects.load(Ordering::SeqCst), 1);
    assert_eq!(state.replays.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn nonretryable_live_failure_latches_without_a_second_attempt() {
    let state = FakeProgressState::new(
        [
            LiveProgressAction::AuthorizationFailed,
            LiveProgressAction::Acknowledge,
        ],
        [],
    );
    let (_temporary, verified, mut publisher) =
        fresh_progress_publisher(Arc::clone(&state), 2).await;

    let error = publisher
        .publish(&verified, browser_progress("fail closed"), NOW)
        .await
        .expect_err("authorization failure must fail closed");
    assert!(!error.retryable());
    let resumed = publisher
        .resume_pending()
        .await
        .expect_err("failed-closed progress must not retry");
    assert_eq!(resumed.code(), "agent_progress.invalid_state");
    assert_eq!(state.connects.load(Ordering::SeqCst), 1);
    assert_eq!(state.sends.load(Ordering::SeqCst), 1);
    assert_eq!(state.replays.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn nonretryable_replay_failure_latches_without_a_second_replay() {
    let state = FakeProgressState::new(
        [LiveProgressAction::PersistThenUnavailable],
        [
            ReplayProgressAction::AuthorizationFailed,
            ReplayProgressAction::Acknowledge,
        ],
    );
    let (_temporary, verified, mut publisher) =
        fresh_progress_publisher(Arc::clone(&state), 3).await;

    let error = publisher
        .publish(&verified, browser_progress("replay fail closed"), NOW)
        .await
        .expect_err("replay authorization failure must fail closed");
    assert!(!error.retryable());
    let resumed = publisher
        .resume_pending()
        .await
        .expect_err("failed-closed replay must not retry");
    assert_eq!(resumed.code(), "agent_progress.invalid_state");
    assert_eq!(state.connects.load(Ordering::SeqCst), 1);
    assert_eq!(state.sends.load(Ordering::SeqCst), 1);
    assert_eq!(state.replays.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn durable_ack_at_bigint_limit_cannot_be_resent_after_cursor_exhaustion() {
    let state = FakeProgressState::new([LiveProgressAction::Acknowledge], []);
    let (_temporary, verified, mut publisher) =
        fresh_progress_publisher_with_handoff(Arc::clone(&state), 2, Some(i64::MAX as u64 - 1))
            .await;

    let error = publisher
        .publish(&verified, browser_progress("last durable sequence"), NOW)
        .await
        .expect_err("the ACKed BIGINT ceiling must exhaust future output");
    assert_eq!(error.code(), "agent_progress.invalid_state");
    assert!(!error.retryable());
    let resumed = publisher
        .resume_pending()
        .await
        .expect_err("an ACKed exhausted frame must not be resent");
    assert_eq!(resumed.code(), "agent_progress.invalid_state");
    assert_eq!(state.connects.load(Ordering::SeqCst), 1);
    assert_eq!(state.sends.load(Ordering::SeqCst), 1);
    assert_eq!(state.replays.load(Ordering::SeqCst), 0);
    assert_eq!(
        state.frames.lock().expect("progress frames")[0].sequence,
        i64::MAX as u64
    );
}

#[tokio::test]
async fn retryable_progress_exhaustion_never_exceeds_the_session_budget() {
    let state = FakeProgressState::new([LiveProgressAction::PersistThenUnavailable], []);
    let (_temporary, verified, mut publisher) =
        fresh_progress_publisher(Arc::clone(&state), 1).await;

    let first = publisher
        .publish(&verified, browser_progress("bounded retry"), NOW)
        .await
        .expect_err("one unavailable attempt must exhaust the budget");
    assert!(first.retryable());
    let second = publisher
        .resume_pending()
        .await
        .expect_err("exhausted publisher must retain the exact frame");
    assert!(second.retryable());
    assert_eq!(state.connects.load(Ordering::SeqCst), 1);
    assert_eq!(state.sends.load(Ordering::SeqCst), 1);
    assert_eq!(state.replays.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn frame_bound_main_rejection_is_retained_without_resending() {
    let state = FakeProgressState::new([LiveProgressAction::RejectCancellation], []);
    let (_temporary, verified, mut publisher) =
        fresh_progress_publisher(Arc::clone(&state), 1).await;

    let outcome = publisher
        .publish(&verified, browser_progress("stop wins"), NOW)
        .await
        .expect("bound Main rejection");
    assert_eq!(
        outcome,
        AgentProgressPublishOutcome::Rejected { sequence: 5 }
    );
    assert_eq!(
        publisher
            .resume_pending()
            .await
            .expect("retained bound Main rejection"),
        AgentProgressPublishOutcome::Rejected { sequence: 5 }
    );
    assert_eq!(state.sends.load(Ordering::SeqCst), 1);
    assert_eq!(state.replays.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn cancelled_live_wait_recovers_the_retained_ack_without_resending() {
    let state = FakeProgressState::new([LiveProgressAction::RetainAcknowledgementThenWait], []);
    let (_temporary, verified, mut publisher) =
        fresh_progress_publisher(Arc::clone(&state), 2).await;

    {
        let publish = publisher.publish(&verified, browser_progress("cancel wait"), NOW);
        tokio::pin!(publish);
        tokio::select! {
            permit = state.live_started.acquire() => {
                permit.expect("live progress started").forget();
            }
            result = &mut publish => {
                panic!("live progress unexpectedly completed: {}", result.is_ok());
            }
        }
    }

    let outcome = publisher
        .resume_pending()
        .await
        .expect("retained live progress ACK");
    assert_eq!(
        outcome,
        AgentProgressPublishOutcome::Acknowledged { sequence: 5 }
    );
    assert_eq!(state.connects.load(Ordering::SeqCst), 1);
    assert_eq!(state.sends.load(Ordering::SeqCst), 1);
    assert_eq!(state.replays.load(Ordering::SeqCst), 0);
    assert_eq!(state.live_closes.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn cancelled_replay_wait_resumes_the_same_owned_replay_session() {
    let state = FakeProgressState::new(
        [LiveProgressAction::PersistThenUnavailable],
        [ReplayProgressAction::RetainAcknowledgementThenWait],
    );
    let (_temporary, verified, mut publisher) =
        fresh_progress_publisher(Arc::clone(&state), 2).await;

    {
        let publish = publisher.publish(&verified, browser_progress("replay wait"), NOW);
        tokio::pin!(publish);
        tokio::select! {
            permit = state.replay_started.acquire() => {
                permit.expect("progress replay started").forget();
            }
            result = &mut publish => {
                panic!("progress replay unexpectedly completed: {}", result.is_ok());
            }
        }
    }

    let outcome = publisher
        .resume_pending()
        .await
        .expect("retained restored progress ACK");
    assert_eq!(
        outcome,
        AgentProgressPublishOutcome::Acknowledged { sequence: 5 }
    );
    assert_eq!(state.connects.load(Ordering::SeqCst), 1);
    assert_eq!(state.sends.load(Ordering::SeqCst), 1);
    assert_eq!(state.replays.load(Ordering::SeqCst), 1);
    assert_eq!(state.replay_closes.load(Ordering::SeqCst), 1);
}

#[test]
fn claim_bound_output_cursor_advances_only_after_the_exact_progress_ack() {
    let fresh = fresh();
    let handoff = fresh.claim_handoff_watermark();
    let (_delivery, verified, claim) = fresh.into_parts();
    let authority = test_agent_output_authority(claim);
    let mut cursor = authority
        .into_output_cursor(&verified)
        .expect("matching output authority");
    assert_eq!(cursor.next_sequence(), Some(handoff + 1));

    let event = decode_current_node_event_json(
        br#"{"type":"agent_response","content":"claim-bound progress"}"#,
    )
    .expect("valid current NodeEvent");
    let progress = cursor
        .bind_progress(&verified, event, NOW)
        .expect("claim-bound progress");
    let progress_sequence = progress.sequence();
    assert_eq!(progress_sequence, handoff + 1);
    let frame = progress.into_frame();
    assert_eq!(frame.sequence, progress_sequence);
    assert_eq!(frame.claim_handoff_watermark, handoff);
    assert!(frame.fence.is_some());
    assert_eq!(cursor.next_sequence(), None);

    let second_event =
        decode_current_node_event_json(br#"{"type":"agent_response","content":"must wait"}"#)
            .expect("valid current NodeEvent");
    let Err(error) = cursor.bind_progress(&verified, second_event, NOW + 1) else {
        panic!("a second frame cannot be allocated before the first ACK");
    };
    assert!(matches!(
        error,
        crate::protocol::ProtocolError::AuthorizationFailed(_)
    ));

    let mut substituted = frame.clone();
    substituted.occurred_at_unix_millis += 1;
    let wrong_ack = test_acknowledged_progress(&substituted).expect("synthetic bound ACK");
    let error = cursor
        .commit_progress(wrong_ack)
        .expect_err("a same-sequence ACK for different bytes cannot advance the cursor");
    assert!(matches!(
        error,
        crate::protocol::ProtocolError::AuthorizationFailed(_)
    ));
    assert_eq!(cursor.next_sequence(), None);

    let exact_ack = test_acknowledged_progress(&frame).expect("synthetic bound ACK");
    cursor
        .commit_progress(exact_ack)
        .expect("exact progress ACK");
    assert_eq!(cursor.next_sequence(), Some(progress_sequence + 1));
    let terminal = cursor
        .bind_failure_terminal(&verified, RuntimeFailureKind::Internal, NOW + 1)
        .expect("next claim-bound terminal")
        .into_frame();
    assert!(terminal.terminal);
    assert_eq!(terminal.sequence, progress_sequence + 1);
    assert_eq!(terminal.claim_handoff_watermark, handoff);
}

#[test]
fn only_an_exact_bound_winner_can_replace_pending_progress_at_the_same_sequence() {
    for (winner, expected_code) in [
        (
            ProgressRejectionWinner::Cancelled,
            RuntimeErrorCodeV1::Cancelled,
        ),
        (
            ProgressRejectionWinner::DeadlineExceeded,
            RuntimeErrorCodeV1::DeadlineExceeded,
        ),
    ] {
        let fresh = fresh();
        let handoff = fresh.claim_handoff_watermark();
        let (_delivery, verified, claim) = fresh.into_parts();
        let authority = test_agent_output_authority(claim);
        let mut cursor = authority
            .into_output_cursor(&verified)
            .expect("matching output authority");
        let event = decode_current_node_event_json(
            br#"{"type":"agent_response","content":"rejected progress"}"#,
        )
        .expect("valid current NodeEvent");
        let progress = cursor
            .bind_progress(&verified, event, NOW)
            .expect("claim-bound progress");
        let frame = progress.into_frame();
        let rejected = test_rejected_progress(&frame, winner).expect("bound Main winner");
        let terminal = cursor
            .bind_rejected_progress_terminal(&verified, rejected, NOW + 25)
            .expect("same-sequence failure terminal")
            .into_frame();

        assert!(terminal.terminal);
        assert_eq!(terminal.sequence, frame.sequence);
        assert_eq!(terminal.claim_handoff_watermark, handoff);
        assert_eq!(terminal.occurred_at_unix_millis, NOW + 25);
        let Some(execution_output_frame_v1::Payload::RuntimeError(error)) = terminal.payload else {
            panic!("bound winner must create a runtime failure terminal");
        };
        assert_eq!(error.code, expected_code as i32);
    }

    let fresh = fresh();
    let (_delivery, verified, claim) = fresh.into_parts();
    let authority = test_agent_output_authority(claim);
    let mut cursor = authority
        .into_output_cursor(&verified)
        .expect("matching output authority");
    let event = decode_current_node_event_json(br#"{"type":"agent_response"}"#)
        .expect("valid current NodeEvent");
    let progress = cursor
        .bind_progress(&verified, event, NOW)
        .expect("claim-bound progress");
    let frame = progress.into_frame();
    let mut substituted = frame.clone();
    substituted.occurred_at_unix_millis += 1;
    let wrong = test_rejected_progress(&substituted, ProgressRejectionWinner::Cancelled)
        .expect("different frame winner");
    let Err(error) = cursor.bind_rejected_progress_terminal(&verified, wrong, NOW + 25) else {
        panic!("a same-sequence decision for different bytes cannot replace progress");
    };
    assert!(matches!(
        error,
        crate::protocol::ProtocolError::AuthorizationFailed(_)
    ));
}

#[test]
fn output_cursor_rejects_same_identity_changed_intent_before_exposing_a_fence() {
    let fresh = fresh();
    let (_delivery, original, claim) = fresh.into_parts();
    let changed = parse_and_verify_agent_command(
        &bytes("signed_command_same_identity_changed_intent"),
        Some(&TestOnlyConformanceHmacAuthenticator as &dyn SignedCommandAuthenticator),
    )
    .expect("verified changed-intent command");
    assert_eq!(original.command().command_id, changed.command().command_id);
    assert_ne!(
        original.command().deadline_unix_millis,
        changed.command().deadline_unix_millis
    );

    let authority = test_agent_output_authority(claim);
    let Err(error) = authority.into_output_cursor(&changed) else {
        panic!("changed immutable command intent must not reuse output authority");
    };
    assert!(matches!(
        error,
        crate::protocol::ProtocolError::AuthorizationFailed(_)
    ));
}

#[test]
fn output_cursor_rejects_a_different_valid_claim_before_exposing_a_fence() {
    let fresh = fresh();
    let (_delivery, verified, _claim) = fresh.into_parts();
    let authority = test_lease_monitored_input_execution(1, [0x61; 32]).into_output_authority();

    let Err(error) = authority.into_output_cursor(&verified) else {
        panic!("cross-execution output authority must fail");
    };
    assert!(matches!(
        error,
        crate::protocol::ProtocolError::AuthorizationFailed(_)
    ));
}

#[test]
fn output_cursor_latches_exhaustion_after_the_largest_durable_progress_ack() {
    let fresh = fresh();
    let (_delivery, verified, claim) = fresh.into_parts();
    let authority = test_agent_output_authority_with_handoff(claim, i64::MAX as u64 - 1);
    let mut cursor = authority
        .into_output_cursor(&verified)
        .expect("largest durable progress sequence");
    assert_eq!(cursor.next_sequence(), Some(i64::MAX as u64));

    let event = decode_current_node_event_json(br#"{"type":"agent_response"}"#)
        .expect("valid current NodeEvent");
    let progress = cursor
        .bind_progress(&verified, event, NOW)
        .expect("largest durable progress frame");
    let frame = progress.into_frame();
    let acknowledged = test_acknowledged_progress(&frame).expect("synthetic bound ACK");
    let error = cursor
        .commit_progress(acknowledged)
        .expect_err("the ACKed maximum has no contiguous successor");
    assert!(matches!(
        error,
        crate::protocol::ProtocolError::ResourceExhausted(_)
    ));
    assert_eq!(cursor.next_sequence(), None);

    let event = decode_current_node_event_json(br#"{"type":"agent_response"}"#)
        .expect("valid current NodeEvent");
    let Err(error) = cursor.bind_progress(&verified, event, NOW) else {
        panic!("an exhausted cursor must not reuse the ACKed sequence");
    };
    assert!(matches!(
        error,
        crate::protocol::ProtocolError::ResourceExhausted(_)
    ));
}

#[tokio::test]
async fn empty_spool_is_locked_before_fresh_preparation_can_exist() {
    let (_temporary, root) = root();
    let preflight = preflight(root, "worker-1");
    let first = preflight.prepare(fresh()).await.expect("empty preflight");
    assert_eq!(first.kind(), AgentOutputPreflightKind::Empty);

    let Err(error) = preflight.prepare(fresh()).await else {
        panic!("a second live spool owner must be rejected");
    };
    assert!(matches!(
        error,
        AgentOutputPreflightError::Output(OutputGrpcError::Spool(
            SpoolError::OwnershipUnavailable(_)
        ))
    ));
    assert_eq!(error.code(), "agent_output.spool_unavailable");
    assert!(error.retryable());

    drop(first);
    let reopened = preflight
        .prepare(fresh())
        .await
        .expect("reopened preflight");
    assert_eq!(reopened.kind(), AgentOutputPreflightKind::Empty);
}

#[tokio::test]
async fn producer_mismatch_fails_before_creating_an_execution_spool() {
    let (_temporary, root) = root();
    let preflight = preflight(root.clone(), "worker-other");

    let Err(error) = preflight.prepare(fresh()).await else {
        panic!("producer substitution must fail");
    };

    assert!(matches!(
        error,
        AgentOutputPreflightError::InvalidConfiguration(_)
    ));
    assert_eq!(error.code(), "agent_output.invalid_configuration");
    assert!(!error.retryable());
    assert!(fs::read_dir(root).expect("output root").next().is_none());
}

#[tokio::test]
async fn workload_session_mismatch_fails_before_creating_an_execution_spool() {
    let (_temporary, root) = root();
    let mut config = output_config("worker-1");
    config.workload_session_id = "workload-other".to_owned();
    let preflight = AgentOutputPreflight::new(
        root.clone(),
        SpoolMasterKey::new([b'p'; 32]),
        spool_limits(),
        config,
    );

    let Err(error) = preflight.prepare(fresh()).await else {
        panic!("workload-session substitution must fail");
    };

    assert!(matches!(
        error,
        AgentOutputPreflightError::InvalidConfiguration(_)
    ));
    assert_eq!(error.code(), "agent_output.invalid_configuration");
    assert!(!error.retryable());
    assert!(fs::read_dir(root).expect("output root").next().is_none());
}

#[tokio::test]
async fn sole_claim_bound_pending_progress_routes_to_recovery_not_fresh_work() {
    let (_temporary, root) = root();
    let preflight = preflight(root, "worker-1");
    let empty = preflight.prepare(fresh()).await.expect("empty preflight");
    let AgentOutputPreflightOutcome::Empty(empty) = empty else {
        panic!("new execution spool must be empty");
    };
    let (fresh, output) = empty.into_parts();
    let mut spool = output.into_test_spool();
    let fence = claim_response()
        .receipt
        .expect("claim receipt")
        .fence
        .expect("claim fence");
    let sequence = fresh.claim_handoff_watermark() + 1;
    let frame = progress_frame(&fresh, fence, sequence, fresh.claim_handoff_watermark());
    spool.persist(frame).expect("durable progress");
    drop(spool);

    let outcome = preflight.prepare(fresh).await.expect("pending preflight");
    let AgentOutputPreflightOutcome::RecoveryRequiredNoAck(recovery) = outcome else {
        panic!("durable progress must require server-side recovery");
    };
    assert_eq!(
        recovery.kind(),
        AgentOutputRecoveryRequiredKind::PendingProgress
    );
    assert_eq!(recovery.sequence(), sequence);
}

#[tokio::test]
async fn authenticated_handoff_reconciles_a_covered_stale_progress_frame() {
    let (_temporary, root) = root();
    let preflight = preflight(root, "worker-1");
    let empty = preflight.prepare(fresh()).await.expect("empty preflight");
    let AgentOutputPreflightOutcome::Empty(empty) = empty else {
        panic!("new execution spool must be empty");
    };
    let (accepted, output) = empty.into_parts();
    let mut spool = output.into_test_spool();
    let mut old_fence = claim_response()
        .receipt
        .expect("claim receipt")
        .fence
        .expect("claim fence");
    old_fence.fence_token[0] ^= 1;
    let sequence = accepted.claim_handoff_watermark();
    let stale_handoff = sequence.checked_sub(1).expect("positive handoff watermark");
    spool
        .persist(progress_frame(
            &accepted,
            old_fence,
            sequence,
            stale_handoff,
        ))
        .expect("durable stale progress");
    drop(spool);

    let outcome = preflight
        .prepare(accepted)
        .await
        .expect("covered preflight");
    let AgentOutputPreflightOutcome::RecoveryRequiredNoAck(recovery) = outcome else {
        panic!("covered progress must remain a no-ACK recovery outcome");
    };
    assert_eq!(
        recovery.kind(),
        AgentOutputRecoveryRequiredKind::ReconciledStaleProgress
    );
    assert_eq!(recovery.sequence(), sequence);

    let reopened = preflight
        .prepare(fresh())
        .await
        .expect("reconciled spool reopens");
    assert_eq!(reopened.kind(), AgentOutputPreflightKind::Empty);
}

#[tokio::test]
async fn sole_claim_bound_pending_terminal_routes_to_recovery_not_fresh_work() {
    let (_temporary, root) = root();
    let preflight = preflight(root, "worker-1");
    let empty = preflight.prepare(fresh()).await.expect("empty preflight");
    let AgentOutputPreflightOutcome::Empty(empty) = empty else {
        panic!("new execution spool must be empty");
    };
    let (fresh, output) = empty.into_parts();
    let mut spool = output.into_test_spool();
    let frame = terminal_frame(&fresh);
    let sequence = frame.sequence;
    spool.persist(frame).expect("durable terminal");
    drop(spool);

    let outcome = preflight.prepare(fresh).await.expect("pending preflight");
    let AgentOutputPreflightOutcome::TerminalRecovery(pending) = outcome else {
        panic!("durable terminal must never become fresh work");
    };
    assert_eq!(pending.sequence(), sequence);
}

#[tokio::test]
async fn terminal_reopener_rejects_changed_bytes_between_attempts() {
    let (_temporary, root) = root();
    let preflight = preflight(root, "worker-1");
    let empty = preflight.prepare(fresh()).await.expect("empty preflight");
    let AgentOutputPreflightOutcome::Empty(empty) = empty else {
        panic!("new execution spool must be empty");
    };
    let (fresh, output) = empty.into_parts();
    let mut spool = output.into_test_spool();
    let frame = terminal_frame(&fresh);
    spool
        .persist(frame.clone())
        .expect("durable terminal output");
    drop(spool);

    let recovery = preflight.prepare(fresh).await.expect("terminal recovery");
    let AgentOutputPreflightOutcome::TerminalRecovery(recovery) = recovery else {
        panic!("durable terminal must route to recovery");
    };
    let (_delivery, _verified, _claim, mut spool, expected, reopener) = recovery.into_parts();
    let mut replacement = expected.clone();
    replacement.occurred_at_unix_millis += 1;
    spool
        .replace_pending_exact(&expected, &replacement)
        .expect("canonical same-execution replacement");
    drop(spool);

    let Err(error) = reopener.reopen().await else {
        panic!("reopen must retain the exact classified terminal proof");
    };
    assert!(matches!(
        error,
        AgentOutputPreflightError::InvalidDurableState(_)
    ));
}

#[tokio::test]
async fn restored_terminal_payload_digest_is_revalidated_before_recovery() {
    let (_temporary, root) = root();
    let preflight = preflight(root, "worker-1");
    let empty = preflight.prepare(fresh()).await.expect("empty preflight");
    let AgentOutputPreflightOutcome::Empty(empty) = empty else {
        panic!("new execution spool must be empty");
    };
    let (fresh, output) = empty.into_parts();
    let mut spool = output.into_test_spool();
    let mut frame = terminal_frame(&fresh);
    frame
        .payload_digest
        .as_mut()
        .expect("terminal payload digest")
        .value[0] ^= 1;
    spool.persist(frame).expect("durable malformed terminal");
    drop(spool);

    let Err(error) = preflight.prepare(fresh).await else {
        panic!("a malformed terminal must not mint recovery authority");
    };
    assert!(matches!(
        error,
        AgentOutputPreflightError::InvalidDurableState(_)
    ));
    assert_eq!(error.code(), "agent_output.invalid_durable_state");
    assert!(!error.retryable());
}

#[tokio::test]
async fn restored_terminal_must_match_the_admitted_request_binding() {
    let (_temporary, root) = root();
    let preflight = preflight(root, "worker-1");
    let empty = preflight.prepare(fresh()).await.expect("empty preflight");
    let AgentOutputPreflightOutcome::Empty(empty) = empty else {
        panic!("new execution spool must be empty");
    };
    let (fresh, output) = empty.into_parts();
    let mut spool = output.into_test_spool();
    let mut frame = terminal_frame(&fresh);
    let Some(execution_output_frame_v1::Payload::AgentExecution(result)) = frame.payload.as_mut()
    else {
        panic!("terminal agent result");
    };
    result.request_immutable_version = "different-request-version".to_owned();
    let payload_digest = DigestV1 {
        algorithm: DigestAlgorithmV1::Sha256 as i32,
        value: digest::digest(&digest::SHA256, &result.encode_to_vec())
            .as_ref()
            .to_vec(),
    };
    frame.payload_digest = Some(payload_digest.clone());
    frame
        .settlement_proposal
        .as_mut()
        .expect("terminal settlement proposal")
        .terminal_payload_digest = Some(payload_digest);
    spool.persist(frame).expect("durable substituted terminal");
    drop(spool);

    let Err(error) = preflight.prepare(fresh).await else {
        panic!("a terminal for another admitted request must fail closed");
    };
    assert!(matches!(
        error,
        AgentOutputPreflightError::InvalidDurableState(_)
    ));
}

#[tokio::test]
async fn pending_frame_from_another_fence_fails_closed() {
    let (_temporary, root) = root();
    let preflight = preflight(root, "worker-1");
    let empty = preflight.prepare(fresh()).await.expect("empty preflight");
    let AgentOutputPreflightOutcome::Empty(empty) = empty else {
        panic!("new execution spool must be empty");
    };
    let (fresh, output) = empty.into_parts();
    let mut spool = output.into_test_spool();
    let mut fence = claim_response()
        .receipt
        .expect("claim receipt")
        .fence
        .expect("claim fence");
    fence.fence_token[0] ^= 1;
    let sequence = fresh.claim_handoff_watermark() + 1;
    spool
        .persist(progress_frame(
            &fresh,
            fence,
            sequence,
            fresh.claim_handoff_watermark(),
        ))
        .expect("durable foreign-fence frame");
    drop(spool);

    let Err(error) = preflight.prepare(fresh).await else {
        panic!("foreign-fence output must fail closed");
    };
    assert!(matches!(
        error,
        AgentOutputPreflightError::InvalidDurableState(_)
    ));
    assert_eq!(error.code(), "agent_output.invalid_durable_state");
    assert!(!error.retryable());
}

#[tokio::test]
async fn pre_invocation_failure_polls_persists_replays_settles_and_retires_in_order() {
    let trace = Arc::new(Mutex::new(Vec::new()));
    let (_temporary, control, terminal, admission) =
        pre_invocation_terminal_fixture(Arc::clone(&trace)).await;
    let replay = FakeReplay::new(
        [ReplayResult::Unavailable, ReplayResult::Acknowledged],
        Arc::clone(&trace),
    );
    let retirer = recovery_retirer(
        Arc::clone(&trace),
        Ok(RedisRetirementResponse {
            acknowledged: 1,
            deleted: 1,
            unmapped: 1,
        }),
    );

    let completion = publish_pre_invocation_terminal(
        control,
        &retirer,
        &replay,
        terminal,
        Arc::new(|| NOW),
        recovery_config(2),
    )
    .await
    .expect("failure terminal completion");

    assert_eq!(completion.execution_kind(), AgentExecutionKind::Application);
    assert_eq!(completion.sequence(), 5);
    assert_eq!(completion.failure(), RuntimeFailureKind::InvalidInput);
    assert_eq!(completion.settlement_receipt_id(), "settlement-receipt-1");
    assert_eq!(admission.available_capacity(), 1);
    let frames = replay.frames.lock().expect("frames");
    assert_eq!(frames.len(), 2);
    assert_eq!(frames[0], frames[1]);
    assert_eq!(frames[0].claim_handoff_watermark, 4);
    assert_eq!(frames[0].occurred_at_unix_millis, NOW);
    let Some(execution_output_frame_v1::Payload::RuntimeError(error)) = frames[0].payload.as_ref()
    else {
        panic!("canonical invalid-input terminal");
    };
    assert_eq!(error.code, RuntimeErrorCodeV1::InvalidInput as i32);
    assert_eq!(
        *trace.lock().expect("trace"),
        [
            "begin",
            "renew",
            "observe",
            "input",
            "renew",
            "observe",
            "renew",
            "observe",
            "replay",
            "replay",
            "settlement",
            "redis",
        ]
    );
}

#[tokio::test]
async fn already_authorized_drops_request_authority_and_publishes_one_bound_internal_terminal() {
    let trace = Arc::new(Mutex::new(Vec::new()));
    let (temporary, root) = root();
    let preflight = preflight(root, "worker-1");
    let outcome = preflight.prepare(fresh()).await.expect("empty preflight");
    let AgentOutputPreflightOutcome::Empty(empty) = outcome else {
        panic!("new execution spool must be empty");
    };
    let control = authorization_control(Arc::clone(&trace));
    let admission = InvocationAdmission::new(
        InvocationAdmissionConfig::new(1, Duration::from_secs(1)).expect("invocation admission"),
    );
    let supervisor = InvocationSupervisor::new(admission.clone());
    let prepared = prepare_fresh_agent_invocation_with(
        *empty,
        Arc::clone(&control),
        &admission,
        &ValidAgentInput {
            trace: Arc::clone(&trace),
        },
        Arc::new(|| NOW),
        AgentPreparationConfig::new(Duration::from_secs(10)).expect("preparation config"),
    )
    .await
    .expect("prepared invocation");
    let AgentPreparationOutcome::Prepared(prepared) = prepared else {
        panic!("valid application input must reach authorization");
    };
    let replay = Arc::new(FakeReplay::new(
        [ReplayResult::Acknowledged],
        Arc::clone(&trace),
    ));
    let retirer = Arc::new(recovery_retirer(
        Arc::clone(&trace),
        Ok(RedisRetirementResponse {
            acknowledged: 1,
            deleted: 1,
            unmapped: 1,
        }),
    ));
    let lifecycle = Arc::new(GatedAuthorizedLifecycle {
        trace: Arc::clone(&trace),
        started: Mutex::new(None),
        release: Arc::new(Semaphore::new(1)),
    });
    let (reservation, job) = AgentAuthorizationJob::new(
        *prepared,
        control,
        retirer,
        Arc::clone(&replay),
        Arc::new(|| NOW),
        recovery_config(1),
        lifecycle,
    );
    let invocation = match supervisor.submit(reservation, job) {
        Ok(invocation) => invocation,
        Err(rejected) => panic!("authorization supervision failed: {}", rejected.error()),
    };
    let completion = invocation.wait().await.expect("authorization job result");
    let AgentAuthorizationJobCompletion::Terminal(Ok(completion)) = completion else {
        panic!("the scripted response must publish a terminal without running ADK");
    };
    supervisor.close().await.expect("supervisor drain");

    assert_eq!(completion.execution_kind(), AgentExecutionKind::Application);
    assert_eq!(completion.sequence(), 5);
    assert_eq!(completion.failure(), RuntimeFailureKind::Internal);
    assert_eq!(completion.settlement_receipt_id(), "settlement-receipt-1");
    assert_eq!(admission.available_capacity(), 1);
    assert_eq!(replay.frames.lock().expect("frames").len(), 1);
    assert_eq!(
        *trace.lock().expect("trace"),
        [
            "begin",
            "renew",
            "observe",
            "input",
            "authorize",
            "renew",
            "observe",
            "replay",
            "settlement",
            "redis",
        ]
    );
    drop(temporary);
}

#[tokio::test]
async fn dropped_authorization_waiter_cannot_cancel_the_owned_authorized_lifecycle() {
    let trace = Arc::new(Mutex::new(Vec::new()));
    let (temporary, root) = root();
    let preflight = preflight(root, "worker-1");
    let outcome = preflight.prepare(fresh()).await.expect("empty preflight");
    let AgentOutputPreflightOutcome::Empty(empty) = outcome else {
        panic!("new execution spool must be empty");
    };
    let control = authorized_control(Arc::clone(&trace));
    let admission = InvocationAdmission::new(
        InvocationAdmissionConfig::new(1, Duration::from_secs(1)).expect("invocation admission"),
    );
    let supervisor = Arc::new(InvocationSupervisor::new(admission.clone()));
    let prepared = prepare_fresh_agent_invocation_with(
        *empty,
        Arc::clone(&control),
        &admission,
        &ValidAgentInput {
            trace: Arc::clone(&trace),
        },
        Arc::new(|| NOW),
        AgentPreparationConfig::new(Duration::from_secs(10)).expect("preparation config"),
    )
    .await
    .expect("prepared invocation");
    let AgentPreparationOutcome::Prepared(prepared) = prepared else {
        panic!("valid application input must reach authorization");
    };
    let (started_sender, started_receiver) = oneshot::channel();
    let release = Arc::new(Semaphore::new(0));
    let lifecycle = Arc::new(GatedAuthorizedLifecycle {
        trace: Arc::clone(&trace),
        started: Mutex::new(Some(started_sender)),
        release: Arc::clone(&release),
    });
    let replay = Arc::new(FakeReplay::new(
        [ReplayResult::Acknowledged],
        Arc::clone(&trace),
    ));
    let retirer = Arc::new(recovery_retirer(
        Arc::clone(&trace),
        Ok(RedisRetirementResponse {
            acknowledged: 1,
            deleted: 1,
            unmapped: 1,
        }),
    ));
    let (reservation, job) = AgentAuthorizationJob::new(
        *prepared,
        control,
        retirer,
        replay,
        Arc::new(|| NOW),
        recovery_config(1),
        lifecycle,
    );
    let invocation = match supervisor.submit(reservation, job) {
        Ok(invocation) => invocation,
        Err(rejected) => panic!("authorization supervision failed: {}", rejected.error()),
    };
    started_receiver.await.expect("authorized lifecycle start");
    assert_eq!(supervisor.active_count(), 1);
    assert_eq!(admission.available_capacity(), 0);

    drop(invocation);
    let closing = Arc::clone(&supervisor);
    let close = tokio::spawn(async move { closing.close().await });
    tokio::task::yield_now().await;
    assert!(!close.is_finished());
    assert_eq!(supervisor.active_count(), 1);
    assert_eq!(admission.available_capacity(), 0);

    release.add_permits(1);
    close.await.expect("close task").expect("supervisor drain");
    assert_eq!(supervisor.active_count(), 0);
    assert_eq!(admission.available_capacity(), 1);
    assert_eq!(
        *trace.lock().expect("trace"),
        [
            "begin",
            "renew",
            "observe",
            "input",
            "authorize",
            "authorized",
        ]
    );
    drop(temporary);
}

#[tokio::test]
async fn supervisor_stop_race_returns_unpolled_authorization_for_noack_cleanup() {
    let trace = Arc::new(Mutex::new(Vec::new()));
    let (temporary, root) = root();
    let preflight = preflight(root, "worker-1");
    let outcome = preflight.prepare(fresh()).await.expect("empty preflight");
    let AgentOutputPreflightOutcome::Empty(empty) = outcome else {
        panic!("new execution spool must be empty");
    };
    let control = authorized_control(Arc::clone(&trace));
    let admission = InvocationAdmission::new(
        InvocationAdmissionConfig::new(1, Duration::from_secs(1)).expect("invocation admission"),
    );
    let supervisor = InvocationSupervisor::new(admission.clone());
    let prepared = prepare_fresh_agent_invocation_with(
        *empty,
        Arc::clone(&control),
        &admission,
        &ValidAgentInput {
            trace: Arc::clone(&trace),
        },
        Arc::new(|| NOW),
        AgentPreparationConfig::new(Duration::from_secs(10)).expect("preparation config"),
    )
    .await
    .expect("prepared invocation");
    let AgentPreparationOutcome::Prepared(prepared) = prepared else {
        panic!("valid application input must reach authorization");
    };
    let (started_sender, started_receiver) = oneshot::channel();
    let lifecycle = Arc::new(GatedAuthorizedLifecycle {
        trace: Arc::clone(&trace),
        started: Mutex::new(Some(started_sender)),
        release: Arc::new(Semaphore::new(0)),
    });
    let (reservation, job) = AgentAuthorizationJob::new(
        *prepared,
        control,
        Arc::new(recovery_retirer(
            Arc::clone(&trace),
            Ok(RedisRetirementResponse {
                acknowledged: 1,
                deleted: 1,
                unmapped: 1,
            }),
        )),
        Arc::new(FakeReplay::new(
            [ReplayResult::Acknowledged],
            Arc::clone(&trace),
        )),
        Arc::new(|| NOW),
        recovery_config(1),
        lifecycle,
    );
    supervisor.stop().expect("stop supervisor");

    let Err(rejected) = supervisor.submit(reservation, job) else {
        panic!("stopped supervisor must return unpolled authorization");
    };
    let (error, reservation, job) = rejected.into_parts();
    assert_eq!(error.code(), "invocation_supervision.closed");
    assert!(
        job.close_unstarted()
            .await
            .expect("unstarted cleanup")
            .is_none()
    );
    drop(reservation);
    assert!(started_receiver.await.is_err());
    assert_eq!(admission.available_capacity(), 1);
    assert_eq!(
        *trace.lock().expect("trace"),
        ["begin", "renew", "observe", "input"]
    );
    supervisor.close().await.expect("close supervisor");
    drop(temporary);
}

#[tokio::test]
async fn unknown_authorization_effect_closes_locally_without_output_or_redis_ack() {
    let trace = Arc::new(Mutex::new(Vec::new()));
    let (temporary, root) = root();
    let preflight = preflight(root, "worker-1");
    let outcome = preflight.prepare(fresh()).await.expect("empty preflight");
    let AgentOutputPreflightOutcome::Empty(empty) = outcome else {
        panic!("new execution spool must be empty");
    };
    let control = unavailable_authorization_control(Arc::clone(&trace));
    let admission = InvocationAdmission::new(
        InvocationAdmissionConfig::new(1, Duration::from_secs(1)).expect("invocation admission"),
    );
    let supervisor = InvocationSupervisor::new(admission.clone());
    let prepared = prepare_fresh_agent_invocation_with(
        *empty,
        Arc::clone(&control),
        &admission,
        &ValidAgentInput {
            trace: Arc::clone(&trace),
        },
        Arc::new(|| NOW),
        AgentPreparationConfig::new(Duration::from_secs(10)).expect("preparation config"),
    )
    .await
    .expect("prepared invocation");
    let AgentPreparationOutcome::Prepared(prepared) = prepared else {
        panic!("valid application input must reach authorization");
    };
    let lifecycle = Arc::new(GatedAuthorizedLifecycle {
        trace: Arc::clone(&trace),
        started: Mutex::new(None),
        release: Arc::new(Semaphore::new(1)),
    });
    let (reservation, job) = AgentAuthorizationJob::new(
        *prepared,
        control,
        Arc::new(recovery_retirer(
            Arc::clone(&trace),
            Ok(RedisRetirementResponse {
                acknowledged: 1,
                deleted: 1,
                unmapped: 1,
            }),
        )),
        Arc::new(FakeReplay::new(
            [ReplayResult::Acknowledged],
            Arc::clone(&trace),
        )),
        Arc::new(|| NOW),
        recovery_config(1),
        lifecycle,
    );
    let invocation = match supervisor.submit(reservation, job) {
        Ok(invocation) => invocation,
        Err(rejected) => panic!("authorization supervision failed: {}", rejected.error()),
    };
    let completion = invocation.wait().await.expect("authorization job result");
    let AgentAuthorizationJobCompletion::Unknown(completion) = completion else {
        panic!("transport uncertainty must remain a no-ACK cleanup outcome");
    };
    assert_eq!(completion.execution_kind(), AgentExecutionKind::Application);
    assert!(completion.authorization_error().retryable());
    assert!(completion.lease_error().is_none());
    supervisor.close().await.expect("supervisor drain");

    assert_eq!(admission.available_capacity(), 1);
    assert_eq!(
        *trace.lock().expect("trace"),
        ["begin", "renew", "observe", "input", "authorize"]
    );
    drop(temporary);
}

#[tokio::test]
async fn publication_deadline_is_sampled_after_the_final_lease_poll() {
    let trace = Arc::new(Mutex::new(Vec::new()));
    let (_temporary, control, terminal, admission) =
        pre_invocation_terminal_fixture(Arc::clone(&trace)).await;
    let replay = FakeReplay::new([ReplayResult::Acknowledged], Arc::clone(&trace));
    let retirer = recovery_retirer(
        Arc::clone(&trace),
        Ok(RedisRetirementResponse {
            acknowledged: 1,
            deleted: 1,
            unmapped: 1,
        }),
    );

    let completion = publish_pre_invocation_terminal(
        control,
        &retirer,
        &replay,
        terminal,
        Arc::new(|| i64::MAX),
        recovery_config(1),
    )
    .await
    .expect("deadline terminal completion");

    assert_eq!(completion.failure(), RuntimeFailureKind::DeadlineExceeded);
    assert_eq!(admission.available_capacity(), 1);
    let frames = replay.frames.lock().expect("frames");
    assert_eq!(frames[0].occurred_at_unix_millis, i64::MAX);
    let Some(execution_output_frame_v1::Payload::RuntimeError(error)) = frames[0].payload.as_ref()
    else {
        panic!("canonical deadline terminal");
    };
    assert_eq!(error.code, RuntimeErrorCodeV1::DeadlineExceeded as i32);
    let trace = trace.lock().expect("trace");
    let final_poll = trace
        .windows(3)
        .position(|window| window == ["renew", "observe", "replay"]);
    assert!(final_poll.is_some(), "final lease poll must precede output");
}

#[tokio::test]
async fn final_stop_beats_both_the_proposed_failure_and_deadline() {
    let trace = Arc::new(Mutex::new(Vec::new()));
    let (_temporary, control, terminal, admission) = pre_invocation_terminal_fixture_with_policy(
        Arc::clone(&trace),
        None,
        [
            DesiredExecutionStateV1::Running,
            DesiredExecutionStateV1::Running,
            DesiredExecutionStateV1::Cancelled,
        ],
    )
    .await;
    let replay = FakeReplay::new([ReplayResult::Acknowledged], Arc::clone(&trace));
    let retirer = recovery_retirer(
        Arc::clone(&trace),
        Ok(RedisRetirementResponse {
            acknowledged: 1,
            deleted: 1,
            unmapped: 1,
        }),
    );

    let completion = publish_pre_invocation_terminal(
        control,
        &retirer,
        &replay,
        terminal,
        Arc::new(|| i64::MAX),
        recovery_config(1),
    )
    .await
    .expect("cancellation terminal completion");

    assert_eq!(completion.failure(), RuntimeFailureKind::Cancelled);
    assert_eq!(admission.available_capacity(), 1);
    let frames = replay.frames.lock().expect("frames");
    let Some(execution_output_frame_v1::Payload::RuntimeError(error)) = frames[0].payload.as_ref()
    else {
        panic!("canonical cancellation terminal");
    };
    assert_eq!(error.code, RuntimeErrorCodeV1::Cancelled as i32);
}

#[tokio::test]
async fn fatal_final_lease_loss_suppresses_output_settlement_and_redis() {
    let trace = Arc::new(Mutex::new(Vec::new()));
    let (_temporary, control, terminal, admission) =
        pre_invocation_terminal_fixture_with_policy(Arc::clone(&trace), Some(2), []).await;
    let replay = FakeReplay::new([ReplayResult::Acknowledged], Arc::clone(&trace));
    let retirer = recovery_retirer(
        Arc::clone(&trace),
        Ok(RedisRetirementResponse {
            acknowledged: 1,
            deleted: 1,
            unmapped: 1,
        }),
    );

    let error = publish_pre_invocation_terminal(
        control,
        &retirer,
        &replay,
        terminal,
        Arc::new(|| NOW),
        recovery_config(1),
    )
    .await
    .expect_err("fatal lease loss must suppress terminal output");

    assert_eq!(error.code(), "agent_failure_terminal.lease_lost");
    assert!(error.retryable());
    assert_eq!(admission.available_capacity(), 1);
    let trace = trace.lock().expect("trace");
    assert!(!trace.contains(&"replay"));
    assert!(!trace.contains(&"settlement"));
    assert!(!trace.contains(&"redis"));
}

#[tokio::test]
async fn exhausted_fresh_terminal_replay_retains_bytes_and_reports_safe_policy() {
    let trace = Arc::new(Mutex::new(Vec::new()));
    let (_temporary, control, terminal, admission) =
        pre_invocation_terminal_fixture(Arc::clone(&trace)).await;
    let replay = FakeReplay::new([ReplayResult::Unavailable], Arc::clone(&trace));
    let retirer = recovery_retirer(
        Arc::clone(&trace),
        Ok(RedisRetirementResponse {
            acknowledged: 1,
            deleted: 1,
            unmapped: 1,
        }),
    );

    let error = publish_pre_invocation_terminal(
        control,
        &retirer,
        &replay,
        terminal,
        Arc::new(|| NOW),
        recovery_config(1),
    )
    .await
    .expect_err("bounded fresh terminal replay exhaustion");

    assert_eq!(error.code(), "agent_failure_terminal.output_unavailable");
    assert!(error.retryable());
    assert_eq!(admission.available_capacity(), 1);
    assert!(!trace.lock().expect("trace").contains(&"settlement"));
    assert!(!trace.lock().expect("trace").contains(&"redis"));
}

#[tokio::test]
async fn accepted_terminal_replays_settles_and_only_then_retires_redis() {
    let (_temporary, _preflight, recovery, frame) = pending_terminal_recovery().await;
    let trace = Arc::new(Mutex::new(Vec::new()));
    let replay = FakeReplay::new([ReplayResult::Acknowledged], Arc::clone(&trace));
    let retirer = recovery_retirer(
        Arc::clone(&trace),
        Ok(RedisRetirementResponse {
            acknowledged: 1,
            deleted: 1,
            unmapped: 1,
        }),
    );

    let completion = recover_accepted_terminal(
        recovery_control(Arc::clone(&trace), false),
        &retirer,
        &replay,
        recovery,
        Arc::new(|| NOW),
        lease_config(),
        recovery_config(2),
    )
    .await
    .expect("terminal recovery");

    assert_eq!(completion.execution_kind(), AgentExecutionKind::Application);
    assert_eq!(completion.sequence(), frame.sequence);
    assert_eq!(completion.settlement_receipt_id(), "settlement-receipt-1");
    assert_eq!(
        *trace.lock().expect("trace"),
        ["replay", "settlement", "redis"]
    );
}

#[tokio::test(start_paused = true)]
async fn a_late_lease_failure_cannot_revoke_confirmed_terminal_retirement() {
    let (_temporary, _preflight, recovery, frame) = pending_terminal_recovery().await;
    let trace = Arc::new(Mutex::new(Vec::new()));
    let replay = FakeReplay::new([ReplayResult::AdvanceAndAcknowledged], Arc::clone(&trace));
    let retirer = recovery_retirer(
        Arc::clone(&trace),
        Ok(RedisRetirementResponse {
            acknowledged: 1,
            deleted: 1,
            unmapped: 1,
        }),
    );

    let completion = recover_accepted_terminal(
        recovery_control_with_renew_failure(Arc::clone(&trace)),
        &retirer,
        &replay,
        recovery,
        Arc::new(|| NOW),
        ClaimLeaseMonitorConfig::new(Duration::from_millis(1)).expect("lease config"),
        recovery_config(1),
    )
    .await
    .expect("durable retirement wins late lease failure");

    assert_eq!(completion.sequence(), frame.sequence);
    assert_eq!(
        *trace.lock().expect("trace"),
        ["replay", "renew", "settlement", "redis"]
    );
}

#[tokio::test]
async fn reconnect_uses_a_fresh_exact_spool_and_stops_at_the_bound() {
    let (_temporary, preflight, recovery, _frame) = pending_terminal_recovery().await;
    let trace = Arc::new(Mutex::new(Vec::new()));
    let replay = FakeReplay::new(
        [
            ReplayResult::Unavailable,
            ReplayResult::DependencyUnavailable,
        ],
        Arc::clone(&trace),
    );
    let retirer = recovery_retirer(
        Arc::clone(&trace),
        Ok(RedisRetirementResponse {
            acknowledged: 1,
            deleted: 1,
            unmapped: 1,
        }),
    );

    let error = recover_accepted_terminal(
        recovery_control(Arc::clone(&trace), false),
        &retirer,
        &replay,
        recovery,
        Arc::new(|| NOW),
        lease_config(),
        recovery_config(2),
    )
    .await
    .expect_err("bounded replay exhaustion");

    assert_eq!(error.code(), "agent_terminal_recovery.output_unavailable");
    assert!(error.retryable());
    assert_eq!(*trace.lock().expect("trace"), ["replay", "replay"]);
    let restored = preflight
        .prepare(fresh())
        .await
        .expect("exact terminal remains durable");
    assert_eq!(restored.kind(), AgentOutputPreflightKind::TerminalRecovery);
}

#[tokio::test]
async fn nonretryable_output_rejection_never_opens_a_second_session() {
    let (_temporary, _preflight, recovery, _frame) = pending_terminal_recovery().await;
    let trace = Arc::new(Mutex::new(Vec::new()));
    let replay = FakeReplay::new(
        [
            ReplayResult::AuthorizationFailed,
            ReplayResult::Acknowledged,
        ],
        Arc::clone(&trace),
    );
    let retirer = recovery_retirer(
        Arc::clone(&trace),
        Ok(RedisRetirementResponse {
            acknowledged: 1,
            deleted: 1,
            unmapped: 1,
        }),
    );

    let error = recover_accepted_terminal(
        recovery_control(Arc::clone(&trace), false),
        &retirer,
        &replay,
        recovery,
        Arc::new(|| NOW),
        lease_config(),
        recovery_config(2),
    )
    .await
    .expect_err("authorization failure");

    assert_eq!(error.code(), "agent_terminal_recovery.output_rejected");
    assert!(!error.retryable());
    assert_eq!(*trace.lock().expect("trace"), ["replay"]);
}

#[tokio::test]
async fn frame_bound_cancellation_replaces_exact_bytes_and_gets_a_fresh_budget() {
    let (_temporary, _preflight, recovery, original) = pending_terminal_recovery().await;
    let trace = Arc::new(Mutex::new(Vec::new()));
    let replay = FakeReplay::new(
        [
            ReplayResult::Unavailable,
            ReplayResult::CancellationWon,
            ReplayResult::Unavailable,
            ReplayResult::Acknowledged,
        ],
        Arc::clone(&trace),
    );
    let retirer = recovery_retirer(
        Arc::clone(&trace),
        Ok(RedisRetirementResponse {
            acknowledged: 1,
            deleted: 1,
            unmapped: 1,
        }),
    );

    recover_accepted_terminal(
        recovery_control(Arc::clone(&trace), false),
        &retirer,
        &replay,
        recovery,
        Arc::new(|| NOW),
        lease_config(),
        recovery_config(2),
    )
    .await
    .expect("cancellation replacement");

    let frames = replay.frames.lock().expect("frames");
    assert_eq!(frames.len(), 4);
    assert_eq!(frames[0], original);
    assert_eq!(frames[1], original);
    assert_eq!(frames[2].sequence, original.sequence);
    assert_eq!(
        frames[2].occurred_at_unix_millis,
        original.occurred_at_unix_millis
    );
    assert_eq!(frames[2], frames[3]);
    let Some(execution_output_frame_v1::Payload::RuntimeError(error)) = frames[2].payload.as_ref()
    else {
        panic!("canonical cancellation terminal");
    };
    assert_eq!(error.code, RuntimeErrorCodeV1::Cancelled as i32);
    assert_eq!(
        *trace.lock().expect("trace"),
        [
            "replay",
            "replay",
            "replay",
            "replay",
            "settlement",
            "redis"
        ]
    );
}

#[tokio::test]
async fn settlement_or_redis_failure_cannot_skip_the_authority_order() {
    for (settlement_fails, redis_result, expected_trace, expected_code) in [
        (
            true,
            Ok(RedisRetirementResponse {
                acknowledged: 1,
                deleted: 1,
                unmapped: 1,
            }),
            vec!["replay", "settlement"],
            "agent_terminal_recovery.settlement_failed",
        ),
        (
            false,
            Err(RedisRetirementClientError::DependencyUnavailable),
            vec!["replay", "settlement", "redis"],
            "redis_command.dependency_unavailable",
        ),
    ] {
        let (_temporary, _preflight, recovery, _frame) = pending_terminal_recovery().await;
        let trace = Arc::new(Mutex::new(Vec::new()));
        let replay = FakeReplay::new([ReplayResult::Acknowledged], Arc::clone(&trace));
        let retirer = recovery_retirer(Arc::clone(&trace), redis_result);

        let error = recover_accepted_terminal(
            recovery_control(Arc::clone(&trace), settlement_fails),
            &retirer,
            &replay,
            recovery,
            Arc::new(|| NOW),
            lease_config(),
            recovery_config(2),
        )
        .await
        .expect_err("terminal completion failure");

        assert_eq!(error.code(), expected_code);
        assert!(error.retryable());
        assert_eq!(*trace.lock().expect("trace"), expected_trace);
    }
}

#[tokio::test]
async fn a_second_frame_bound_winner_does_not_enter_a_replacement_loop() {
    for first_winner in [ReplayResult::CancellationWon, ReplayResult::DeadlineWon] {
        let (_temporary, _preflight, recovery, _frame) = pending_terminal_recovery().await;
        let trace = Arc::new(Mutex::new(Vec::new()));
        let replay = FakeReplay::new([first_winner, first_winner], Arc::clone(&trace));
        let retirer = recovery_retirer(
            Arc::clone(&trace),
            Ok(RedisRetirementResponse {
                acknowledged: 1,
                deleted: 1,
                unmapped: 1,
            }),
        );

        let error = recover_accepted_terminal(
            recovery_control(Arc::clone(&trace), false),
            &retirer,
            &replay,
            recovery,
            Arc::new(|| NOW),
            lease_config(),
            recovery_config(2),
        )
        .await
        .expect_err("a canonical replacement winner must not loop");

        assert_eq!(error.code(), "agent_terminal_recovery.output_rejected");
        assert_eq!(*trace.lock().expect("trace"), ["replay", "replay"]);
    }
}

#[test]
fn terminal_recovery_session_policy_matches_the_deployed_v1_bounds() {
    assert!(AgentTerminalRecoveryConfig::new(1).is_ok());
    assert!(AgentTerminalRecoveryConfig::new(8).is_ok());
    for invalid in [0, 9] {
        let error = AgentTerminalRecoveryConfig::new(invalid).expect_err("invalid session limit");
        assert_eq!(
            error.code(),
            "agent_terminal_recovery.invalid_configuration"
        );
        assert!(!error.retryable());
        assert!(matches!(
            error,
            AgentTerminalRecoveryError::InvalidConfiguration(_)
        ));
    }
}

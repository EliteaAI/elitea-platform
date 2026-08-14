use std::collections::BTreeMap;
use std::collections::VecDeque;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use prost::Message;
use ring::digest;
use tonic::{Request, Response, Status};

use super::agent_delivery::{FreshAgentDelivery, test_fresh_agent_delivery};
use super::agent_lease::ClaimLeaseMonitorConfig;
use super::output_delivery::{
    AcceptedTerminalOutputRecovery, AgentOutputPreflight, AgentOutputPreflightError,
    AgentOutputPreflightKind, AgentOutputPreflightOutcome, AgentOutputRecoveryRequiredKind,
    AgentTerminalRecoveryConfig, AgentTerminalRecoveryError, AgentTerminalReplay,
    recover_accepted_terminal,
};
use crate::agents::AgentExecutionKind;
use crate::protocol::command::{
    SignedCommandAuthenticator, TestOnlyConformanceHmacAuthenticator,
    parse_and_verify_agent_command,
};
use crate::protocol::control::{AgentControlClient, test_accepted_agent_claim};
use crate::protocol::elitea::runtime::v1::{
    AuthorizeInvocationRequestV1, AuthorizeInvocationResponseV1, BeginExecutionRequestV1,
    BeginExecutionResponseV1, ClaimCommandRequestV1, ClaimCommandResponseV1,
    DesiredExecutionStateV1, DigestAlgorithmV1, DigestV1, ExecutionFenceV1, ExecutionIdentityV1,
    ExecutionOutputEventTypeV1, ExecutionOutputFrameV1, ObserveDesiredStateRequestV1,
    ObserveDesiredStateResponseV1, PrepareSettlementRequestV1, PrepareSettlementResponseV1,
    RenewLeaseRequestV1, RenewLeaseResponseV1, RuntimeErrorCodeV1, execution_output_frame_v1,
};
use crate::protocol::node_event::decode_current_node_event_json;
use crate::protocol::output::OUTPUT_SCHEMA_REVISION;
use crate::spool::{SpoolError, SpoolLimits, SpoolMasterKey};
use crate::transport::output_grpc::test_acknowledged_terminal;
use crate::transport::redis_commands::{
    RedisCommandDelivery, RedisCommandLimits, RedisCommandRetirer, RedisRetirementClient,
    RedisRetirementClientError, RedisRetirementConfig, RedisRetirementRequest,
    RedisRetirementResponse,
};
use crate::transport::{
    ControlGrpcConfig, ControlRpc, DurablyAckedTerminal, OutputGrpcConfig, OutputGrpcError,
    OutputProtocolError, PreparedOutputSpool,
};

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
    renew_fails: bool,
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
        panic!("terminal recovery must not begin")
    }

    async fn authorize_invocation(
        &self,
        _request: Request<AuthorizeInvocationRequestV1>,
    ) -> Result<Response<AuthorizeInvocationResponseV1>, Status> {
        panic!("terminal recovery must not authorize")
    }

    async fn renew_lease(
        &self,
        _request: Request<RenewLeaseRequestV1>,
    ) -> Result<Response<RenewLeaseResponseV1>, Status> {
        self.trace.lock().expect("trace").push("renew");
        if self.renew_fails {
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
            desired_state: DesiredExecutionStateV1::Running as i32,
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

fn recovery_control(
    trace: Arc<Mutex<Vec<&'static str>>>,
    settlement_fails: bool,
) -> Arc<AgentControlClient<RecoveryControl>> {
    Arc::new(
        AgentControlClient::new(
            RecoveryControl {
                trace,
                settlement_fails,
                renew_fails: false,
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

fn recovery_control_with_renew_failure(
    trace: Arc<Mutex<Vec<&'static str>>>,
) -> Arc<AgentControlClient<RecoveryControl>> {
    Arc::new(
        AgentControlClient::new(
            RecoveryControl {
                trace,
                settlement_fails: false,
                renew_fails: true,
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

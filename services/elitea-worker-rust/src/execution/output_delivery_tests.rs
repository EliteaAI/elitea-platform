use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::time::Duration;

use prost::Message;
use ring::digest;

use super::agent_delivery::{FreshAgentDelivery, test_fresh_agent_delivery};
use super::output_delivery::{
    AgentOutputPreflight, AgentOutputPreflightError, AgentOutputPreflightKind,
    AgentOutputPreflightOutcome, PendingAgentOutputKind,
};
use crate::protocol::command::{
    SignedCommandAuthenticator, TestOnlyConformanceHmacAuthenticator,
    parse_and_verify_agent_command,
};
use crate::protocol::control::test_accepted_agent_claim;
use crate::protocol::elitea::runtime::v1::{
    ClaimCommandResponseV1, DigestAlgorithmV1, DigestV1, ExecutionIdentityV1,
    ExecutionOutputEventTypeV1, ExecutionOutputFrameV1, NodeEventV1, execution_output_frame_v1,
};
use crate::protocol::output::OUTPUT_SCHEMA_REVISION;
use crate::spool::{SpoolError, SpoolLimits, SpoolMasterKey};
use crate::transport::redis_commands::{RedisCommandDelivery, RedisCommandLimits};
use crate::transport::{OutputGrpcConfig, OutputGrpcError};

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
    let (fresh, mut spool) = empty.into_parts();
    let identity = fresh.spool_identity();
    let fence = claim_response()
        .receipt
        .expect("claim receipt")
        .fence
        .expect("claim fence");
    let event = NodeEventV1::default();
    let event_bytes = event.encode_to_vec();
    let sequence = fresh.claim_handoff_watermark() + 1;
    let frame = ExecutionOutputFrameV1 {
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
        claim_handoff_watermark: fresh.claim_handoff_watermark(),
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
    };
    spool.persist(frame).expect("durable progress");
    drop(spool);

    let outcome = preflight.prepare(fresh).await.expect("pending preflight");
    let AgentOutputPreflightOutcome::Pending(pending) = outcome else {
        panic!("durable progress must never become fresh work");
    };
    assert_eq!(pending.kind(), PendingAgentOutputKind::Progress);
    assert_eq!(pending.sequence(), sequence);
}

#[tokio::test]
async fn sole_claim_bound_pending_terminal_routes_to_recovery_not_fresh_work() {
    let (_temporary, root) = root();
    let preflight = preflight(root, "worker-1");
    let empty = preflight.prepare(fresh()).await.expect("empty preflight");
    let AgentOutputPreflightOutcome::Empty(empty) = empty else {
        panic!("new execution spool must be empty");
    };
    let (fresh, mut spool) = empty.into_parts();
    let identity = fresh.spool_identity();
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
    frame.fence = claim_response().receipt.expect("claim receipt").fence;
    frame.claim_handoff_watermark = fresh.claim_handoff_watermark();
    let sequence = frame.sequence;
    spool.persist(frame).expect("durable terminal");
    drop(spool);

    let outcome = preflight.prepare(fresh).await.expect("pending preflight");
    let AgentOutputPreflightOutcome::Pending(pending) = outcome else {
        panic!("durable terminal must never become fresh work");
    };
    assert_eq!(pending.kind(), PendingAgentOutputKind::Terminal);
    assert_eq!(pending.sequence(), sequence);
}

#[tokio::test]
async fn pending_frame_from_another_fence_fails_closed() {
    let (_temporary, root) = root();
    let preflight = preflight(root, "worker-1");
    let empty = preflight.prepare(fresh()).await.expect("empty preflight");
    let AgentOutputPreflightOutcome::Empty(empty) = empty else {
        panic!("new execution spool must be empty");
    };
    let (fresh, mut spool) = empty.into_parts();
    let identity = fresh.spool_identity();
    let mut fence = claim_response()
        .receipt
        .expect("claim receipt")
        .fence
        .expect("claim fence");
    fence.fence_token[0] ^= 1;
    let sequence = fresh.claim_handoff_watermark() + 1;
    spool
        .persist(ExecutionOutputFrameV1 {
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
            logical_output_id: "node-event:execution-1:5".to_owned(),
            event_id: "command-1:5".to_owned(),
            sequence,
            claim_handoff_watermark: fresh.claim_handoff_watermark(),
            event_type: ExecutionOutputEventTypeV1::NodeEvent as i32,
            occurred_at_unix_millis: NOW,
            payload_digest: Some(DigestV1 {
                algorithm: DigestAlgorithmV1::Sha256 as i32,
                value: digest::digest(&digest::SHA256, &[]).as_ref().to_vec(),
            }),
            terminal: false,
            settlement_proposal: None,
            payload: Some(execution_output_frame_v1::Payload::NodeEvent(
                NodeEventV1::default(),
            )),
        })
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

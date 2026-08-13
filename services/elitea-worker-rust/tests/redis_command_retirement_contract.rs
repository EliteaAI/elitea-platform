use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use elitea_worker_rust::protocol::command::{
    SignedCommandAuthenticator, TestOnlyConformanceHmacAuthenticator, VerifiedAgentCommand,
    parse_and_verify_agent_command,
};
use elitea_worker_rust::protocol::control::{
    AgentClaimDecision, AgentCommandRetirementAuthority, AgentControlClient,
};
use elitea_worker_rust::protocol::elitea::runtime::v1::{
    AuthorizeInvocationRequestV1, AuthorizeInvocationResponseV1, BeginExecutionRequestV1,
    BeginExecutionResponseV1, ClaimCommandRequestV1, ClaimCommandResponseV1,
    ObserveDesiredStateRequestV1, ObserveDesiredStateResponseV1, PrepareSettlementRequestV1,
    PrepareSettlementResponseV1, RenewLeaseRequestV1, RenewLeaseResponseV1,
    SignedWorkerCommandEnvelopeV1,
};
use elitea_worker_rust::transport::redis_commands::{
    RedisCommandDelivery, RedisCommandError, RedisCommandLimits, RedisCommandRetirer,
    RedisRetirementClient, RedisRetirementClientError, RedisRetirementConfig,
    RedisRetirementRequest, RedisRetirementResponse,
};
use elitea_worker_rust::transport::{ControlGrpcConfig, ControlRpc};
use prost::Message;
use tonic::{Request, Response, Status};

const NOW: i64 = 1_700_000_000_000;

fn vectors() -> BTreeMap<&'static str, &'static str> {
    include_str!("fixtures/agent_control_vectors.txt")
        .lines()
        .map(|line| line.split_once('=').expect("named fixture"))
        .collect()
}

fn bytes(name: &str) -> Vec<u8> {
    vectors()[name]
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            u8::from_str_radix(std::str::from_utf8(pair).expect("ASCII hex"), 16)
                .expect("fixture hex")
        })
        .collect()
}

fn verified(name: &str) -> VerifiedAgentCommand {
    let authenticator = TestOnlyConformanceHmacAuthenticator;
    parse_and_verify_agent_command(
        &bytes(name),
        Some(&authenticator as &dyn SignedCommandAuthenticator),
    )
    .expect("verified command")
}

struct ClaimRpc {
    response: ClaimCommandResponseV1,
}

#[async_trait]
impl ControlRpc for ClaimRpc {
    async fn claim_command(
        &self,
        _request: Request<ClaimCommandRequestV1>,
    ) -> Result<Response<ClaimCommandResponseV1>, Status> {
        Ok(Response::new(self.response.clone()))
    }

    async fn begin_execution(
        &self,
        _request: Request<BeginExecutionRequestV1>,
    ) -> Result<Response<BeginExecutionResponseV1>, Status> {
        Err(Status::unimplemented("not used"))
    }

    async fn authorize_invocation(
        &self,
        _request: Request<AuthorizeInvocationRequestV1>,
    ) -> Result<Response<AuthorizeInvocationResponseV1>, Status> {
        Err(Status::unimplemented("not used"))
    }

    async fn renew_lease(
        &self,
        _request: Request<RenewLeaseRequestV1>,
    ) -> Result<Response<RenewLeaseResponseV1>, Status> {
        Err(Status::unimplemented("not used"))
    }

    async fn observe_desired_state(
        &self,
        _request: Request<ObserveDesiredStateRequestV1>,
    ) -> Result<Response<ObserveDesiredStateResponseV1>, Status> {
        Err(Status::unimplemented("not used"))
    }

    async fn prepare_settlement(
        &self,
        _request: Request<PrepareSettlementRequestV1>,
    ) -> Result<Response<PrepareSettlementResponseV1>, Status> {
        Err(Status::unimplemented("not used"))
    }
}

async fn terminal_authority(command: &VerifiedAgentCommand) -> AgentCommandRetirementAuthority {
    let response = ClaimCommandResponseV1::decode(bytes("claim_obsolete_ack").as_slice())
        .expect("obsolete claim");
    let control = AgentControlClient::new(
        ClaimRpc { response },
        ControlGrpcConfig {
            deadline: Duration::from_secs(1),
            workload_session_id: "workload-1".to_owned(),
            producer_id: "worker-1".to_owned(),
        },
    )
    .expect("control client");
    let AgentClaimDecision::ObsoleteAck(authority) = control
        .claim_agent_delivery(command, NOW)
        .await
        .expect("obsolete authority")
    else {
        panic!("expected obsolete command retirement")
    };
    authority.into()
}

fn limits() -> RedisCommandLimits {
    RedisCommandLimits {
        max_entry_bytes: 64 * 1024,
        max_field_bytes: 48 * 1024,
    }
}

fn delivery(vector: &str) -> RedisCommandDelivery {
    delivery_bytes(bytes(vector))
}

fn delivery_bytes(signed_envelope: Vec<u8>) -> RedisCommandDelivery {
    RedisCommandDelivery::decode(
        b"runtime.commands.v1",
        b"1700000000000-0",
        vec![(b"signed_envelope".to_vec(), signed_envelope)],
        limits(),
    )
    .expect("Redis delivery")
}

fn push_varint(target: &mut Vec<u8>, mut value: u64) {
    while value >= 0x80 {
        target.push(u8::try_from(value & 0x7f).expect("seven-bit varint chunk") | 0x80);
        value >>= 7;
    }
    target.push(u8::try_from(value).expect("terminal varint byte"));
}

fn push_length_field(target: &mut Vec<u8>, field: u8, value: &[u8]) {
    target.push((field << 3) | 2);
    push_varint(target, value.len() as u64);
    target.extend_from_slice(value);
}

fn reordered_outer_envelope(vector: &str) -> Vec<u8> {
    let signed = SignedWorkerCommandEnvelopeV1::decode(bytes(vector).as_slice())
        .expect("signed command fixture");
    let mut raw = Vec::new();
    push_length_field(&mut raw, 6, &signed.signature);
    push_length_field(
        &mut raw,
        5,
        &signed
            .worker_command_digest
            .expect("worker command digest")
            .encode_to_vec(),
    );
    push_length_field(&mut raw, 4, &signed.worker_command_bytes);
    push_length_field(&mut raw, 3, signed.key_id.as_bytes());
    raw.push(2 << 3);
    push_varint(
        &mut raw,
        u64::try_from(signed.signature_profile).expect("nonnegative signature profile"),
    );
    push_length_field(&mut raw, 1, signed.envelope_schema_revision.as_bytes());
    raw
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CapturedRequest {
    stream: String,
    group: String,
    consumer: String,
    entry_id: String,
    stable_delivery_id: String,
    signed_envelope: Vec<u8>,
}

struct FakeRetirementState {
    response: Mutex<Result<RedisRetirementResponse, RedisRetirementClientError>>,
    requests: Mutex<Vec<CapturedRequest>>,
}

struct FakeRetirementClient(Arc<FakeRetirementState>);

#[async_trait]
impl RedisRetirementClient for FakeRetirementClient {
    async fn retire_delivery(
        &self,
        request: RedisRetirementRequest,
    ) -> Result<RedisRetirementResponse, RedisRetirementClientError> {
        self.0
            .requests
            .lock()
            .expect("retirement requests")
            .push(CapturedRequest {
                stream: request.stream().to_owned(),
                group: request.group().to_owned(),
                consumer: request.consumer().to_owned(),
                entry_id: request.entry_id().to_owned(),
                stable_delivery_id: request.stable_delivery_id().to_owned(),
                signed_envelope: request.signed_envelope().to_vec(),
            });
        *self.0.response.lock().expect("retirement response")
    }
}

fn retirer(
    response: Result<RedisRetirementResponse, RedisRetirementClientError>,
) -> (
    RedisCommandRetirer<FakeRetirementClient>,
    Arc<FakeRetirementState>,
) {
    let state = Arc::new(FakeRetirementState {
        response: Mutex::new(response),
        requests: Mutex::new(Vec::new()),
    });
    let retirer = RedisCommandRetirer::new(
        FakeRetirementClient(Arc::clone(&state)),
        RedisRetirementConfig {
            stream: "runtime.commands.v1".to_owned(),
            group: "rust-workers".to_owned(),
            consumer: "worker-1".to_owned(),
        },
    )
    .expect("command retirer");
    (retirer, state)
}

#[tokio::test(flavor = "current_thread")]
async fn durable_command_authority_retires_the_exact_verified_delivery() {
    let verified = verified("signed_command");
    let authority = terminal_authority(&verified).await;
    let (retirer, client) = retirer(Ok(RedisRetirementResponse {
        acknowledged: 1,
        deleted: 1,
        unmapped: 1,
    }));

    retirer
        .retire_agent_command(delivery("signed_command"), &verified, authority)
        .await
        .expect("atomic retirement");

    let requests = client.requests.lock().expect("retirement requests");
    assert_eq!(requests.len(), 1);
    assert_eq!(
        requests[0],
        CapturedRequest {
            stream: "runtime.commands.v1".to_owned(),
            group: "rust-workers".to_owned(),
            consumer: "worker-1".to_owned(),
            entry_id: "1700000000000-0".to_owned(),
            stable_delivery_id: "outbox-1".to_owned(),
            signed_envelope: bytes("signed_command"),
        }
    );
}

#[tokio::test(flavor = "current_thread")]
async fn command_and_exact_envelope_substitution_fail_before_redis() {
    let original = verified("signed_command");
    let authority = terminal_authority(&original).await;
    let changed = verified("signed_command_output_session");
    let (retirer, client) = retirer(Ok(RedisRetirementResponse {
        acknowledged: 1,
        deleted: 1,
        unmapped: 1,
    }));

    assert!(matches!(
        retirer
            .retire_agent_command(
                delivery("signed_command_output_session"),
                &changed,
                authority
            )
            .await,
        Err(RedisCommandError::AuthorizationFailed(_))
    ));
    assert!(
        client
            .requests
            .lock()
            .expect("retirement requests")
            .is_empty()
    );

    let authority = terminal_authority(&original).await;
    assert!(matches!(
        retirer
            .retire_agent_command(
                delivery("signed_command_output_session"),
                &original,
                authority
            )
            .await,
        Err(RedisCommandError::AuthorizationFailed(_))
    ));
    assert!(
        client
            .requests
            .lock()
            .expect("retirement requests")
            .is_empty()
    );
}

#[tokio::test(flavor = "current_thread")]
async fn same_identity_changed_intent_cannot_reuse_retirement_authority() {
    let original = verified("signed_command");
    let authority = terminal_authority(&original).await;
    let changed = verified("signed_command_same_identity_changed_intent");
    assert_eq!(original.command().command_id, changed.command().command_id);
    assert_eq!(
        original.command().idempotency_key,
        changed.command().idempotency_key
    );
    assert_ne!(
        original.command().deadline_unix_millis,
        changed.command().deadline_unix_millis
    );
    let (retirer, client) = retirer(Ok(RedisRetirementResponse {
        acknowledged: 1,
        deleted: 1,
        unmapped: 1,
    }));

    assert!(matches!(
        retirer
            .retire_agent_command(
                delivery("signed_command_same_identity_changed_intent"),
                &changed,
                authority
            )
            .await,
        Err(RedisCommandError::AuthorizationFailed(_))
    ));
    assert!(
        client
            .requests
            .lock()
            .expect("retirement requests")
            .is_empty()
    );
}

#[tokio::test(flavor = "current_thread")]
async fn verified_noncanonical_outer_envelope_retires_by_exact_bytes() {
    let canonical = bytes("signed_command");
    let raw = reordered_outer_envelope("signed_command");
    assert_ne!(raw, canonical);
    let authenticator = TestOnlyConformanceHmacAuthenticator;
    let verified = parse_and_verify_agent_command(
        &raw,
        Some(&authenticator as &dyn SignedCommandAuthenticator),
    )
    .expect("verified noncanonical command envelope");
    let authority = terminal_authority(&verified).await;
    let (retirer, client) = retirer(Ok(RedisRetirementResponse {
        acknowledged: 1,
        deleted: 1,
        unmapped: 1,
    }));

    retirer
        .retire_agent_command(delivery_bytes(raw.clone()), &verified, authority)
        .await
        .expect("exact noncanonical delivery retirement");
    let requests = client.requests.lock().expect("retirement requests");
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].signed_envelope, raw);
}

#[tokio::test(flavor = "current_thread")]
async fn only_exact_atomic_retirement_results_are_accepted() {
    for response in [
        RedisRetirementResponse {
            acknowledged: 1,
            deleted: 1,
            unmapped: 1,
        },
        RedisRetirementResponse {
            acknowledged: 2,
            deleted: 0,
            unmapped: 0,
        },
    ] {
        let verified = verified("signed_command");
        let authority = terminal_authority(&verified).await;
        let (retirer, _) = retirer(Ok(response));
        retirer
            .retire_agent_command(delivery("signed_command"), &verified, authority)
            .await
            .expect("confirmed retirement");
    }

    for response in [
        RedisRetirementResponse {
            acknowledged: 1,
            deleted: 0,
            unmapped: 0,
        },
        RedisRetirementResponse {
            acknowledged: 2,
            deleted: 1,
            unmapped: 1,
        },
        RedisRetirementResponse {
            acknowledged: -1,
            deleted: 1,
            unmapped: 1,
        },
    ] {
        let verified = verified("signed_command");
        let authority = terminal_authority(&verified).await;
        let (retirer, _) = retirer(Ok(response));
        assert!(matches!(
            retirer
                .retire_agent_command(delivery("signed_command"), &verified, authority)
                .await,
            Err(RedisCommandError::DependencyUnavailable(_))
        ));
    }
}

#[test]
fn redis_delivery_decode_preserves_duplicates_and_enforces_complete_bounds() {
    let signed = bytes("signed_command");
    assert!(RedisCommandDelivery::decode(b"runtime.commands.v1", b"1-0", [], limits()).is_err());
    assert!(
        RedisCommandDelivery::decode(
            b"runtime.commands.v1",
            b"1-0",
            vec![(b"unknown".to_vec(), signed.clone())],
            limits(),
        )
        .is_err()
    );
    assert!(
        RedisCommandDelivery::decode(
            b"runtime.commands.v1",
            b"1-0",
            vec![
                (b"signed_envelope".to_vec(), signed.clone()),
                (b"signed_envelope".to_vec(), signed.clone()),
            ],
            limits(),
        )
        .is_err()
    );
    assert!(
        RedisCommandDelivery::decode(
            b"runtime.commands.v1",
            b"not-an-id",
            vec![(b"signed_envelope".to_vec(), signed.clone())],
            limits(),
        )
        .is_err()
    );
    assert!(matches!(
        RedisCommandDelivery::decode(
            b"runtime.commands.v1",
            b"1-0",
            vec![(b"signed_envelope".to_vec(), signed)],
            RedisCommandLimits {
                max_entry_bytes: 8,
                max_field_bytes: 8,
            },
        ),
        Err(RedisCommandError::ResourceExhausted(_))
    ));
}

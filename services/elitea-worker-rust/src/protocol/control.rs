use std::fmt;
use std::time::Duration;

use prost::Message;
use ring::digest;
use subtle::ConstantTimeEq;
use tonic::transport::Channel;

use super::command::VerifiedAgentCommand;
use super::elitea::runtime::v1::{
    AuthorizeInvocationDispositionV1, AuthorizeInvocationRequestV1, AuthorizeInvocationResponseV1,
    BeginExecutionDispositionV1, BeginExecutionRequestV1, BeginExecutionResponseV1,
    ClaimCommandRequestV1, ClaimCommandResponseV1, ClaimDispositionV1, DesiredExecutionStateV1,
    DigestAlgorithmV1, DigestV1, ExecutionFenceV1, ExecutionIdentityV1,
    ExecutionInputBundleReferenceV1, ExecutionInputBundleV1, ExecutionInputEntryV1,
    ExecutionOutcomeV1, ObserveDesiredStateRequestV1, ObserveDesiredStateResponseV1,
    PrepareSettlementRequestV1, PrepareSettlementResponseV1, RenewLeaseRequestV1,
    RenewLeaseResponseV1, RuntimeErrorCodeV1, RuntimeErrorV1, ScopedContentReferenceV1,
    worker_command_v1,
};
use crate::transport::{
    ControlGrpcClient, ControlGrpcConfig, ControlGrpcError, ControlRpc, DurablyAckedTerminal,
    TonicControlRpc,
};

const MAX_CONTROL_IDENTITY_BYTES: usize = 256;
const MAX_MANIFEST_TEXT_BYTES: usize = 128;
const MAX_AGENT_INPUT_BYTES: u64 = 1024 * 1024;
const AGENT_EXECUTION_REQUEST_ROLE: &str = "agent.execution_request";
const AGENT_INPUT_MEDIA_TYPE: &str = "application/vnd.elitea.agent-execution-input.v1+protobuf";
const INPUT_GRANT_AUDIENCE: &str = "elitea.runtime.input.read.v1";

/// Stable semantic failures returned by the runtime control boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ControlSemanticError {
    InvalidInput(&'static str),
    ResourceExhausted(&'static str),
    IncompatibleVersion(&'static str),
    AuthorizationFailed(&'static str),
    UnsupportedCapability(&'static str),
    DependencyUnavailable(&'static str),
    Cancelled(&'static str),
    DeadlineExceeded(&'static str),
    Rejected(RuntimeControlRejection),
}

impl fmt::Display for ControlSemanticError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInput(message)
            | Self::ResourceExhausted(message)
            | Self::IncompatibleVersion(message)
            | Self::AuthorizationFailed(message)
            | Self::UnsupportedCapability(message)
            | Self::DependencyUnavailable(message)
            | Self::Cancelled(message)
            | Self::DeadlineExceeded(message) => formatter.write_str(message),
            Self::Rejected(rejection) => rejection.fmt(formatter),
        }
    }
}

impl std::error::Error for ControlSemanticError {}

/// Stable semantic-or-transport failure for authenticated agent control.
#[derive(Debug)]
pub enum AgentControlError {
    Semantic(ControlSemanticError),
    Transport(ControlGrpcError),
}

impl fmt::Display for AgentControlError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Semantic(error) => error.fmt(formatter),
            Self::Transport(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for AgentControlError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Semantic(error) => Some(error),
            Self::Transport(error) => Some(error),
        }
    }
}

impl From<ControlSemanticError> for AgentControlError {
    fn from(value: ControlSemanticError) -> Self {
        Self::Semantic(value)
    }
}

impl From<ControlGrpcError> for AgentControlError {
    fn from(value: ControlGrpcError) -> Self {
        Self::Transport(value)
    }
}

/// Closed runtime rejection categories without server-supplied text.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RuntimeControlRejectionKind {
    UnsupportedCapability,
    IncompatibleVersion,
    InvalidInput,
    ResourceExhausted,
    DependencyUnavailable,
    AuthorizationFailed,
    Cancelled,
    DeadlineExceeded,
}

/// One authenticated control rejection, retaining Main's retry decision.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RuntimeControlRejection {
    kind: RuntimeControlRejectionKind,
    retryable: bool,
}

impl RuntimeControlRejection {
    #[must_use]
    pub const fn kind(self) -> RuntimeControlRejectionKind {
        self.kind
    }

    #[must_use]
    pub const fn retryable(self) -> bool {
        self.retryable
    }
}

impl fmt::Display for RuntimeControlRejection {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self.kind {
            RuntimeControlRejectionKind::UnsupportedCapability => {
                "the runtime capability is unsupported"
            }
            RuntimeControlRejectionKind::IncompatibleVersion => {
                "the runtime contract is incompatible"
            }
            RuntimeControlRejectionKind::InvalidInput => {
                "the runtime control response rejected its input"
            }
            RuntimeControlRejectionKind::ResourceExhausted => {
                "the runtime control operation exceeded an approved limit"
            }
            RuntimeControlRejectionKind::DependencyUnavailable => {
                "a required runtime control dependency is unavailable"
            }
            RuntimeControlRejectionKind::AuthorizationFailed => {
                "runtime control authorization failed"
            }
            RuntimeControlRejectionKind::Cancelled => "execution cancellation was observed",
            RuntimeControlRejectionKind::DeadlineExceeded => "the execution deadline was exceeded",
        };
        formatter.write_str(message)
    }
}

/// One fresh, active, command-bound agent claim.
///
/// Its fields are private so a decoded protobuf cannot be mistaken for worker
/// authority. The type is intentionally not `Clone`.
pub struct AcceptedAgentClaim {
    identity: ExecutionIdentityV1,
    fence: ExecutionFenceV1,
    lease_expires_at_unix_millis: i64,
    claim_id: String,
    claim_handoff_watermark: u64,
    input_bundle_ref: ExecutionInputBundleReferenceV1,
    input_bundle: ExecutionInputBundleV1,
    request_entry: ExecutionInputEntryV1,
}

impl AcceptedAgentClaim {
    #[must_use]
    pub const fn lease_expires_at_unix_millis(&self) -> i64 {
        self.lease_expires_at_unix_millis
    }

    #[must_use]
    pub const fn claim_handoff_watermark(&self) -> u64 {
        self.claim_handoff_watermark
    }

    #[must_use]
    pub(crate) const fn input_bundle_ref(&self) -> &ExecutionInputBundleReferenceV1 {
        &self.input_bundle_ref
    }

    #[must_use]
    pub(crate) const fn input_bundle(&self) -> &ExecutionInputBundleV1 {
        &self.input_bundle
    }

    #[must_use]
    pub(crate) const fn request_entry(&self) -> &ExecutionInputEntryV1 {
        &self.request_entry
    }

    #[must_use]
    fn begin_execution_request(&self) -> BeginExecutionRequestV1 {
        BeginExecutionRequestV1 {
            identity: Some(self.identity.clone()),
            fence: Some(self.fence.clone()),
        }
    }

    #[must_use]
    fn authorize_invocation_request(&self) -> AuthorizeInvocationRequestV1 {
        AuthorizeInvocationRequestV1 {
            identity: Some(self.identity.clone()),
            fence: Some(self.fence.clone()),
        }
    }
}

fn renewal_request(
    identity: &ExecutionIdentityV1,
    fence: &ExecutionFenceV1,
    claim_id: &str,
    sequence: u64,
) -> Result<RenewLeaseRequestV1, ControlSemanticError> {
    let mut seed = identity.encode_to_vec();
    seed.push(0);
    fence.encode(&mut seed).map_err(|_| {
        ControlSemanticError::InvalidInput("the lease renewal binding is malformed")
    })?;
    seed.push(0);
    seed.extend_from_slice(claim_id.as_bytes());
    let binding = digest::digest(&digest::SHA256, &seed);
    Ok(RenewLeaseRequestV1 {
        identity: Some(identity.clone()),
        fence: Some(fence.clone()),
        idempotency_key: format!("lease-renew:{}:{sequence}", hex_lower(binding.as_ref())),
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BeginExecutionDecision {
    StartedNow,
    AlreadyStarted,
}

/// Claim state after the restart-safe `BeginExecution` fence succeeds.
pub struct PreparingAgentExecution {
    claim: AcceptedAgentClaim,
}

impl PreparingAgentExecution {
    /// Split the preparation into one execution typestate and one unique lease
    /// handle before exposing business input references.
    #[must_use]
    pub fn start_lease_monitor(self) -> (LeaseMonitoredAgentExecution, ClaimLeaseHandle) {
        let lease = ClaimLeaseHandle {
            identity: self.claim.identity.clone(),
            fence: self.claim.fence.clone(),
            claim_id: self.claim.claim_id.clone(),
            lease_expires_at_unix_millis: self.claim.lease_expires_at_unix_millis,
            renewal_sequence: 0,
        };
        (LeaseMonitoredAgentExecution { claim: self.claim }, lease)
    }
}

/// Business-input access after the delivery path owns a unique lease handle.
pub struct LeaseMonitoredAgentExecution {
    claim: AcceptedAgentClaim,
}

impl LeaseMonitoredAgentExecution {
    #[must_use]
    pub const fn input_bundle_ref(&self) -> &ExecutionInputBundleReferenceV1 {
        self.claim.input_bundle_ref()
    }

    #[must_use]
    pub const fn input_bundle(&self) -> &ExecutionInputBundleV1 {
        self.claim.input_bundle()
    }

    #[must_use]
    pub const fn request_entry(&self) -> &ExecutionInputEntryV1 {
        self.claim.request_entry()
    }
}

/// Recovery-only state proving `BeginExecution` reported prior possible work.
pub struct BeginExecutionRecovery {
    _claim: AcceptedAgentClaim,
}

/// Unique exact-fence lease state. It is neither cloneable nor formattable.
pub struct ClaimLeaseHandle {
    identity: ExecutionIdentityV1,
    fence: ExecutionFenceV1,
    claim_id: String,
    lease_expires_at_unix_millis: i64,
    renewal_sequence: u64,
}

impl ClaimLeaseHandle {
    #[must_use]
    pub const fn lease_expires_at_unix_millis(&self) -> i64 {
        self.lease_expires_at_unix_millis
    }

    fn next_renewal_request(&mut self) -> Result<RenewLeaseRequestV1, ControlSemanticError> {
        let sequence = self
            .renewal_sequence
            .checked_add(1)
            .filter(|value| i64::try_from(*value).is_ok())
            .ok_or(ControlSemanticError::ResourceExhausted(
                "the lease renewal sequence exceeds the durable counter limit",
            ))?;
        self.renewal_sequence = sequence;
        renewal_request(&self.identity, &self.fence, &self.claim_id, sequence)
    }

    fn observe_request(&self) -> ObserveDesiredStateRequestV1 {
        ObserveDesiredStateRequestV1 {
            identity: Some(self.identity.clone()),
            fence: Some(self.fence.clone()),
        }
    }
}

pub enum BeginAgentExecution {
    Preparing(PreparingAgentExecution),
    AlreadyStarted(BeginExecutionRecovery),
}

/// The only value that permits one SDK submission.
///
/// It is deliberately opaque and non-cloneable. The execution adapter must
/// consume it at the synchronous SDK submission boundary.
pub struct InvocationPermit {
    _claim: AcceptedAgentClaim,
}

pub enum InvocationAuthorizationDecision {
    AuthorizedNow(Box<InvocationPermit>),
    AlreadyAuthorized(Box<BeginExecutionRecovery>),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DesiredExecutionState {
    Running,
    Cancelled,
    Draining,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LeaseObservation {
    pub lease_expires_at_unix_millis: i64,
    pub desired_state: DesiredExecutionState,
}

/// Opaque, outcome-bound settlement receipt.
#[derive(Debug)]
pub struct SettlementReceipt {
    receipt_id: String,
    outcome: ExecutionOutcomeV1,
}

impl SettlementReceipt {
    #[must_use]
    pub fn receipt_id(&self) -> &str {
        &self.receipt_id
    }

    #[must_use]
    pub const fn outcome(&self) -> ExecutionOutcomeV1 {
        self.outcome
    }
}

/// Authenticated semantic control operations for one worker identity.
///
/// Raw protobuf responses never mint execution or retirement authority. The
/// client owns the one-attempt transport call and consumes typestate on the two
/// durable side-effect fences.
pub struct AgentControlClient<R> {
    control: ControlGrpcClient<R>,
    workload_session_id: String,
    producer_id: String,
}

impl AgentControlClient<TonicControlRpc> {
    /// Compose semantic control over a caller-verified mTLS channel.
    ///
    /// # Errors
    ///
    /// Returns a stable configuration error for invalid identity or deadline.
    pub fn from_channel(
        channel: Channel,
        config: ControlGrpcConfig,
    ) -> Result<Self, AgentControlError> {
        Self::new(TonicControlRpc::new(channel), config)
    }
}

impl<R> AgentControlClient<R> {
    /// Bind one injected transport to an immutable worker identity.
    ///
    /// # Errors
    ///
    /// Returns a stable configuration error for invalid identity or deadline.
    pub fn new(rpc: R, config: ControlGrpcConfig) -> Result<Self, AgentControlError> {
        let workload_session_id = config.workload_session_id.clone();
        let producer_id = config.producer_id.clone();
        let control = ControlGrpcClient::new(rpc, config)?;
        Ok(Self {
            control,
            workload_session_id,
            producer_id,
        })
    }
}

impl<R: ControlRpc> AgentControlClient<R> {
    /// Claim and validate one exact fresh agent command.
    ///
    /// # Errors
    ///
    /// Returns a typed transport, runtime rejection, or claim-binding failure.
    pub async fn claim_agent(
        &self,
        verified: &VerifiedAgentCommand,
        now_unix_millis: i64,
    ) -> Result<AcceptedAgentClaim, AgentControlError> {
        let request =
            build_agent_claim_request(verified, &self.workload_session_id, &self.producer_id)?;
        let response = self.control.claim_command(request).await?;
        parse_accepted_agent_claim(
            verified,
            response,
            &self.workload_session_id,
            &self.producer_id,
            now_unix_millis,
        )
        .map_err(Into::into)
    }

    /// Cross the restart-safe `BeginExecution` fence, consuming the fresh claim.
    ///
    /// # Errors
    ///
    /// Returns a typed transport, runtime rejection, or response-shape failure.
    pub async fn begin_agent_execution(
        &self,
        claim: AcceptedAgentClaim,
    ) -> Result<BeginAgentExecution, AgentControlError> {
        let response = self
            .control
            .begin_execution(claim.begin_execution_request())
            .await?;
        match parse_begin_execution_response(&response)? {
            BeginExecutionDecision::StartedNow => {
                Ok(BeginAgentExecution::Preparing(PreparingAgentExecution {
                    claim,
                }))
            }
            BeginExecutionDecision::AlreadyStarted => Ok(BeginAgentExecution::AlreadyStarted(
                BeginExecutionRecovery { _claim: claim },
            )),
        }
    }

    /// Cross the final invocation fence exactly once.
    ///
    /// The owned preparing state prevents replaying one response to mint more
    /// permits. Only `AUTHORIZED_NOW` produces [`InvocationPermit`].
    ///
    /// # Errors
    ///
    /// Returns a typed transport, runtime rejection, or response-shape failure.
    pub async fn authorize_agent_invocation(
        &self,
        preparing: LeaseMonitoredAgentExecution,
    ) -> Result<InvocationAuthorizationDecision, AgentControlError> {
        let response = self
            .control
            .authorize_invocation(preparing.claim.authorize_invocation_request())
            .await?;
        parse_authorize_invocation_response(preparing.claim, &response).map_err(Into::into)
    }

    /// Renew one unchanged accepted claim with an internally generated key.
    ///
    /// # Errors
    ///
    /// Returns a typed transport, runtime rejection, or lease validation error.
    pub async fn renew_lease(
        &self,
        lease: &mut ClaimLeaseHandle,
        now_unix_millis: i64,
        poll_interval: Duration,
    ) -> Result<LeaseObservation, AgentControlError> {
        let request = lease.next_renewal_request()?;
        let response = self.control.renew_lease(request).await?;
        let observation = parse_renew_lease_response(
            &response,
            lease.lease_expires_at_unix_millis,
            now_unix_millis,
            poll_interval,
        )?;
        lease.lease_expires_at_unix_millis = observation.lease_expires_at_unix_millis;
        Ok(observation)
    }

    /// Observe the server-owned desired state for one unchanged accepted claim.
    ///
    /// # Errors
    ///
    /// Returns a typed transport, runtime rejection, or response-shape failure.
    pub async fn observe_lease(
        &self,
        lease: &ClaimLeaseHandle,
    ) -> Result<DesiredExecutionState, AgentControlError> {
        let response = self
            .control
            .observe_desired_state(lease.observe_request())
            .await?;
        parse_observe_desired_state_response(&response).map_err(Into::into)
    }

    /// Prepare settlement only from a consumed, durably acknowledged terminal proof.
    ///
    /// # Errors
    ///
    /// Returns a typed transport, runtime rejection, or receipt-binding failure.
    pub async fn prepare_agent_settlement(
        &self,
        terminal: DurablyAckedTerminal,
    ) -> Result<SettlementReceipt, AgentControlError> {
        let (identity, fence, proposal) = terminal.into_settlement_parts();
        let expected_outcome =
            ExecutionOutcomeV1::try_from(proposal.requested_outcome).map_err(|_| {
                ControlSemanticError::InvalidInput("the settlement outcome is malformed")
            })?;
        if !terminal_outcome(expected_outcome) {
            return Err(
                ControlSemanticError::InvalidInput("the settlement outcome is malformed").into(),
            );
        }
        let proposal_bytes = proposal.encode_to_vec();
        let proposal_digest = digest::digest(&digest::SHA256, &proposal_bytes);
        let request = PrepareSettlementRequestV1 {
            identity: Some(identity),
            fence: Some(fence),
            idempotency_key: proposal.prepare_idempotency_key.clone(),
            proposal: Some(proposal),
            proposal_digest: Some(DigestV1 {
                algorithm: DigestAlgorithmV1::Sha256 as i32,
                value: proposal_digest.as_ref().to_vec(),
            }),
        };
        let response = self.control.prepare_settlement(request).await?;
        parse_prepare_settlement_response(response, expected_outcome).map_err(Into::into)
    }
}

/// Bind the exact authenticated envelope to one claim request.
///
/// # Errors
///
/// Returns a bounded semantic error for an invalid transport identity.
pub fn build_agent_claim_request(
    verified: &VerifiedAgentCommand,
    workload_session_id: &str,
    producer_id: &str,
) -> Result<ClaimCommandRequestV1, ControlSemanticError> {
    if !valid_control_identity(workload_session_id) || !valid_control_identity(producer_id) {
        return Err(ControlSemanticError::InvalidInput(
            "the control workload identity is malformed",
        ));
    }
    Ok(ClaimCommandRequestV1 {
        workload_session_id: workload_session_id.to_owned(),
        producer_id: producer_id.to_owned(),
        signed_command: Some(verified.signed().clone()),
    })
}

/// Validate and seal a fresh `ACCEPTED` agent claim.
///
/// # Errors
///
/// Returns a typed runtime rejection or a bounded local semantic error. Other
/// claim dispositions belong to the recovery parser and are never coerced into
/// fresh execution authority.
fn parse_accepted_agent_claim(
    verified: &VerifiedAgentCommand,
    response: ClaimCommandResponseV1,
    workload_session_id: &str,
    producer_id: &str,
    now_unix_millis: i64,
) -> Result<AcceptedAgentClaim, ControlSemanticError> {
    if now_unix_millis <= 0 {
        return Err(ControlSemanticError::InvalidInput(
            "the runtime clock is malformed",
        ));
    }
    let receipt = exclusive_claim_receipt(response)?;
    if receipt.disposition != ClaimDispositionV1::Accepted as i32 {
        return Err(ControlSemanticError::InvalidInput(
            "the claim disposition does not grant fresh execution authority",
        ));
    }
    if receipt.settlement_recovery.is_some() || receipt.retirement.is_some() {
        return Err(ControlSemanticError::InvalidInput(
            "the accepted claim contains recovery material",
        ));
    }
    let expected_identity = identity_from_command(verified);
    let identity = receipt.identity.ok_or(ControlSemanticError::InvalidInput(
        "the accepted claim identity is missing",
    ))?;
    if identity != expected_identity || identity.generation > i64::MAX as u64 {
        return Err(ControlSemanticError::AuthorizationFailed(
            "the claim receipt identity does not match its command",
        ));
    }
    let fence = receipt
        .fence
        .ok_or(ControlSemanticError::AuthorizationFailed(
            "the claim fence is malformed or expired",
        ))?;
    validate_active_fence(
        &fence,
        &receipt.claim_id,
        receipt.lease_expires_at_unix_millis,
        workload_session_id,
        producer_id,
        now_unix_millis,
    )?;
    if receipt.claim_handoff_watermark > i64::MAX as u64 {
        return Err(ControlSemanticError::ResourceExhausted(
            "the claim handoff watermark exceeds the durable counter limit",
        ));
    }
    if receipt.desired_state != DesiredExecutionStateV1::Running as i32 {
        return Err(ControlSemanticError::AuthorizationFailed(
            "the accepted claim desired state is malformed",
        ));
    }

    let expected_reference =
        verified
            .command()
            .input_bundle_ref
            .as_ref()
            .ok_or(ControlSemanticError::InvalidInput(
                "the command input reference is missing",
            ))?;
    let input_bundle_ref =
        receipt
            .input_bundle_ref
            .ok_or(ControlSemanticError::AuthorizationFailed(
                "the accepted claim changed the immutable input reference",
            ))?;
    if &input_bundle_ref != expected_reference {
        return Err(ControlSemanticError::AuthorizationFailed(
            "the accepted claim changed the immutable input reference",
        ));
    }
    let input_bundle = receipt
        .input_bundle
        .ok_or(ControlSemanticError::InvalidInput(
            "the accepted claim is missing its input manifest",
        ))?;
    validate_manifest_binding(&input_bundle_ref, &input_bundle)?;
    let request_entry = validate_agent_request_entry(verified, &input_bundle)?;

    Ok(AcceptedAgentClaim {
        identity,
        fence,
        lease_expires_at_unix_millis: receipt.lease_expires_at_unix_millis,
        claim_id: receipt.claim_id,
        claim_handoff_watermark: receipt.claim_handoff_watermark,
        input_bundle_ref,
        input_bundle,
        request_entry,
    })
}

/// Interpret the durable begin-execution fence.
///
/// # Errors
///
/// Returns a typed runtime rejection or rejects ambiguous/malformed responses.
fn parse_begin_execution_response(
    response: &BeginExecutionResponseV1,
) -> Result<BeginExecutionDecision, ControlSemanticError> {
    if let Some(rejection) = response.rejection.as_ref() {
        if response.disposition != BeginExecutionDispositionV1::Unspecified as i32 {
            return Err(ControlSemanticError::InvalidInput(
                "the begin execution response is ambiguous",
            ));
        }
        return Err(runtime_rejection(rejection));
    }
    match BeginExecutionDispositionV1::try_from(response.disposition).ok() {
        Some(BeginExecutionDispositionV1::StartedNow) => Ok(BeginExecutionDecision::StartedNow),
        Some(BeginExecutionDispositionV1::AlreadyStarted) => {
            Ok(BeginExecutionDecision::AlreadyStarted)
        }
        _ => Err(ControlSemanticError::InvalidInput(
            "the begin execution disposition is malformed",
        )),
    }
}

/// Interpret the last durable fence before SDK submission.
///
/// Only `AUTHORIZED_NOW` constructs an [`InvocationPermit`].
///
/// # Errors
///
/// Returns a typed runtime rejection or rejects ambiguous/malformed responses.
fn parse_authorize_invocation_response(
    claim: AcceptedAgentClaim,
    response: &AuthorizeInvocationResponseV1,
) -> Result<InvocationAuthorizationDecision, ControlSemanticError> {
    if let Some(rejection) = response.rejection.as_ref() {
        if response.disposition != AuthorizeInvocationDispositionV1::Unspecified as i32 {
            return Err(ControlSemanticError::InvalidInput(
                "the invocation authorization response is ambiguous",
            ));
        }
        return Err(runtime_rejection(rejection));
    }
    match AuthorizeInvocationDispositionV1::try_from(response.disposition).ok() {
        Some(AuthorizeInvocationDispositionV1::AuthorizedNow) => {
            Ok(InvocationAuthorizationDecision::AuthorizedNow(Box::new(
                InvocationPermit { _claim: claim },
            )))
        }
        Some(AuthorizeInvocationDispositionV1::AlreadyAuthorized) => {
            Ok(InvocationAuthorizationDecision::AlreadyAuthorized(
                Box::new(BeginExecutionRecovery { _claim: claim }),
            ))
        }
        _ => Err(ControlSemanticError::InvalidInput(
            "the invocation authorization disposition is malformed",
        )),
    }
}

/// Validate a renewed lease against the previous monotonic expiry and polling
/// safety margin.
///
/// # Errors
///
/// Returns a typed rejection, authorization failure for a shortened/expired
/// lease, or invalid input for a malformed desired state.
fn parse_renew_lease_response(
    response: &RenewLeaseResponseV1,
    previous_expiry_unix_millis: i64,
    now_unix_millis: i64,
    poll_interval: Duration,
) -> Result<LeaseObservation, ControlSemanticError> {
    if let Some(rejection) = response.rejection.as_ref() {
        if response.lease_expires_at_unix_millis != 0
            || response.desired_state != DesiredExecutionStateV1::Unspecified as i32
        {
            return Err(ControlSemanticError::InvalidInput(
                "the lease renewal response is ambiguous",
            ));
        }
        return Err(runtime_rejection(rejection));
    }
    if previous_expiry_unix_millis <= 0 || now_unix_millis <= 0 || poll_interval.is_zero() {
        return Err(ControlSemanticError::InvalidInput(
            "the lease validation boundary is malformed",
        ));
    }
    let margin = doubled_duration_millis_ceil(poll_interval)?;
    if response.lease_expires_at_unix_millis < previous_expiry_unix_millis
        || response
            .lease_expires_at_unix_millis
            .checked_sub(now_unix_millis)
            .is_none_or(|remaining| remaining < margin)
    {
        return Err(ControlSemanticError::AuthorizationFailed(
            "the renewed claim lease is malformed or expired",
        ));
    }
    Ok(LeaseObservation {
        lease_expires_at_unix_millis: response.lease_expires_at_unix_millis,
        desired_state: desired_state(response.desired_state)?,
    })
}

/// Validate one server-owned desired-state observation.
///
/// # Errors
///
/// Returns a typed rejection or invalid input for an unknown state.
fn parse_observe_desired_state_response(
    response: &ObserveDesiredStateResponseV1,
) -> Result<DesiredExecutionState, ControlSemanticError> {
    if let Some(rejection) = response.rejection.as_ref() {
        if response.desired_state != DesiredExecutionStateV1::Unspecified as i32 {
            return Err(ControlSemanticError::InvalidInput(
                "the desired-state response is ambiguous",
            ));
        }
        return Err(runtime_rejection(rejection));
    }
    desired_state(response.desired_state)
}

/// Validate one outcome-bound settlement receipt.
///
/// # Errors
///
/// Returns a typed rejection or invalid input for an ambiguous, unbounded, or
/// outcome-mismatched receipt.
fn parse_prepare_settlement_response(
    response: PrepareSettlementResponseV1,
    expected_outcome: ExecutionOutcomeV1,
) -> Result<SettlementReceipt, ControlSemanticError> {
    if let Some(rejection) = response.rejection.as_ref() {
        if !response.settlement_receipt_id.is_empty()
            || response.outcome != ExecutionOutcomeV1::Unspecified as i32
        {
            return Err(ControlSemanticError::InvalidInput(
                "the settlement response is ambiguous",
            ));
        }
        return Err(runtime_rejection(rejection));
    }
    if !bounded_text(&response.settlement_receipt_id, MAX_CONTROL_IDENTITY_BYTES)
        || response.outcome != expected_outcome as i32
        || !terminal_outcome(expected_outcome)
    {
        return Err(ControlSemanticError::InvalidInput(
            "the settlement receipt is malformed",
        ));
    }
    Ok(SettlementReceipt {
        receipt_id: response.settlement_receipt_id,
        outcome: expected_outcome,
    })
}

fn exclusive_claim_receipt(
    response: ClaimCommandResponseV1,
) -> Result<super::elitea::runtime::v1::ClaimReceiptV1, ControlSemanticError> {
    match (response.receipt, response.rejection) {
        (Some(_), Some(_)) => Err(ControlSemanticError::InvalidInput(
            "the claim response is ambiguous",
        )),
        (None, Some(rejection)) => Err(runtime_rejection(&rejection)),
        (Some(receipt), None) => Ok(receipt),
        (None, None) => Err(ControlSemanticError::InvalidInput(
            "the claim response is missing its receipt",
        )),
    }
}

fn validate_active_fence(
    fence: &ExecutionFenceV1,
    claim_id: &str,
    lease_expires_at_unix_millis: i64,
    workload_session_id: &str,
    producer_id: &str,
    now_unix_millis: i64,
) -> Result<(), ControlSemanticError> {
    if fence.workload_session_id != workload_session_id
        || fence.producer_id != producer_id
        || fence.claim_attempt == 0
        || fence.claim_attempt > i64::MAX as u64
        || fence.lease_epoch == 0
        || fence.lease_epoch > i64::MAX as u64
        || fence.fence_token.len() != 32
        || fence.fence_token.iter().all(|byte| *byte == 0)
        || !bounded_text(claim_id, MAX_CONTROL_IDENTITY_BYTES)
        || lease_expires_at_unix_millis <= now_unix_millis
    {
        return Err(ControlSemanticError::AuthorizationFailed(
            "the claim fence is malformed or expired",
        ));
    }
    Ok(())
}

fn validate_manifest_binding(
    reference: &ExecutionInputBundleReferenceV1,
    manifest: &ExecutionInputBundleV1,
) -> Result<(), ControlSemanticError> {
    let encoded = manifest.encode_to_vec();
    let expected = require_sha256(reference.digest.as_ref())?;
    let calculated = digest::digest(&digest::SHA256, &encoded);
    if u64::try_from(encoded.len()).ok() != Some(reference.byte_length)
        || calculated.as_ref().ct_eq(expected).unwrap_u8() != 1
    {
        return Err(ControlSemanticError::AuthorizationFailed(
            "the accepted claim input manifest does not match its command",
        ));
    }
    if manifest.input_bundle_id != reference.input_bundle_id
        || manifest.immutable_version != reference.immutable_version
        || !valid_identifier(&manifest.input_bundle_id)
        || !valid_version(&manifest.immutable_version)
        || manifest.entries.len() != 1
    {
        return Err(ControlSemanticError::InvalidInput(
            "the accepted claim input manifest is malformed",
        ));
    }
    Ok(())
}

fn validate_agent_request_entry(
    verified: &VerifiedAgentCommand,
    manifest: &ExecutionInputBundleV1,
) -> Result<ExecutionInputEntryV1, ControlSemanticError> {
    let Some(worker_command_v1::CapabilityCommand::AgentExecution(agent)) =
        verified.command().capability_command.as_ref()
    else {
        return Err(ControlSemanticError::UnsupportedCapability(
            "the worker command capability is not supported",
        ));
    };
    let entry = manifest
        .entries
        .first()
        .ok_or(ControlSemanticError::InvalidInput(
            "the selected agent request is absent or ambiguous",
        ))?;
    if entry.entry_id != agent.request_entry_id
        || !valid_identifier(&entry.entry_id)
        || !valid_version(&entry.immutable_version)
        || entry.semantic_role != AGENT_EXECUTION_REQUEST_ROLE
    {
        return Err(ControlSemanticError::InvalidInput(
            "the selected agent request is malformed",
        ));
    }
    let content = entry
        .content
        .as_ref()
        .ok_or(ControlSemanticError::InvalidInput(
            "the selected agent request is malformed",
        ))?;
    validate_agent_content(entry, content)?;
    Ok(entry.clone())
}

fn validate_agent_content(
    entry: &ExecutionInputEntryV1,
    content: &ScopedContentReferenceV1,
) -> Result<(), ControlSemanticError> {
    if !valid_identifier(&content.content_id)
        || !valid_version(&content.immutable_version)
        || entry.immutable_version != content.immutable_version
        || content.media_type != AGENT_INPUT_MEDIA_TYPE
        || content.byte_length == 0
        || content.byte_length > MAX_AGENT_INPUT_BYTES
        || !valid_identifier(&content.classification)
        || content.required_grant_audience != INPUT_GRANT_AUDIENCE
        || require_sha256(content.digest.as_ref()).is_err()
        || content
            .digest
            .as_ref()
            .is_some_and(|value| value.value.iter().all(|byte| *byte == 0))
    {
        return Err(ControlSemanticError::InvalidInput(
            "the selected agent request is malformed",
        ));
    }
    Ok(())
}

fn identity_from_command(verified: &VerifiedAgentCommand) -> ExecutionIdentityV1 {
    let command = verified.command();
    ExecutionIdentityV1 {
        tenant_id: command.tenant_id.clone(),
        resource_project_id: command.resource_project_id.clone(),
        projection_project_id: command.projection_project_id.clone(),
        command_id: command.command_id.clone(),
        execution_id: command.execution_id.clone(),
        generation: command.generation,
    }
}

fn require_sha256(digest: Option<&DigestV1>) -> Result<&[u8], ControlSemanticError> {
    let value = digest.ok_or(ControlSemanticError::InvalidInput(
        "the immutable content digest is malformed",
    ))?;
    if value.algorithm != DigestAlgorithmV1::Sha256 as i32 || value.value.len() != 32 {
        return Err(ControlSemanticError::InvalidInput(
            "the immutable content digest is malformed",
        ));
    }
    Ok(&value.value)
}

fn desired_state(value: i32) -> Result<DesiredExecutionState, ControlSemanticError> {
    match DesiredExecutionStateV1::try_from(value).ok() {
        Some(DesiredExecutionStateV1::Running) => Ok(DesiredExecutionState::Running),
        Some(DesiredExecutionStateV1::Cancelled) => Ok(DesiredExecutionState::Cancelled),
        Some(DesiredExecutionStateV1::Draining) => Ok(DesiredExecutionState::Draining),
        _ => Err(ControlSemanticError::InvalidInput(
            "the execution desired state is malformed",
        )),
    }
}

fn runtime_rejection(error: &RuntimeErrorV1) -> ControlSemanticError {
    let kind = match RuntimeErrorCodeV1::try_from(error.code).ok() {
        Some(RuntimeErrorCodeV1::UnsupportedCapability) => {
            RuntimeControlRejectionKind::UnsupportedCapability
        }
        Some(RuntimeErrorCodeV1::IncompatibleVersion) => {
            RuntimeControlRejectionKind::IncompatibleVersion
        }
        Some(RuntimeErrorCodeV1::InvalidInput | RuntimeErrorCodeV1::ProtocolViolation) => {
            RuntimeControlRejectionKind::InvalidInput
        }
        Some(RuntimeErrorCodeV1::ResourceExhausted) => {
            RuntimeControlRejectionKind::ResourceExhausted
        }
        Some(
            RuntimeErrorCodeV1::AuthenticationFailed
            | RuntimeErrorCodeV1::AuthorizationFailed
            | RuntimeErrorCodeV1::StaleFence,
        ) => RuntimeControlRejectionKind::AuthorizationFailed,
        Some(RuntimeErrorCodeV1::Cancelled) => RuntimeControlRejectionKind::Cancelled,
        Some(RuntimeErrorCodeV1::DeadlineExceeded) => RuntimeControlRejectionKind::DeadlineExceeded,
        Some(RuntimeErrorCodeV1::DependencyUnavailable | RuntimeErrorCodeV1::Internal) => {
            RuntimeControlRejectionKind::DependencyUnavailable
        }
        Some(RuntimeErrorCodeV1::Unspecified) | None => {
            return ControlSemanticError::InvalidInput(
                "the runtime control response contains an unknown error",
            );
        }
    };
    ControlSemanticError::Rejected(RuntimeControlRejection {
        kind,
        retryable: error.retryable,
    })
}

fn doubled_duration_millis_ceil(duration: Duration) -> Result<i64, ControlSemanticError> {
    let doubled_nanos =
        duration
            .as_nanos()
            .checked_mul(2)
            .ok_or(ControlSemanticError::ResourceExhausted(
                "the lease polling interval exceeds the approved limit",
            ))?;
    let millis = doubled_nanos.div_ceil(1_000_000);
    i64::try_from(millis).map_err(|_| {
        ControlSemanticError::ResourceExhausted(
            "the lease polling interval exceeds the approved limit",
        )
    })
}

fn terminal_outcome(outcome: ExecutionOutcomeV1) -> bool {
    matches!(
        outcome,
        ExecutionOutcomeV1::Succeeded
            | ExecutionOutcomeV1::Failed
            | ExecutionOutcomeV1::Cancelled
            | ExecutionOutcomeV1::OutcomeUnknown
    )
}

fn valid_control_identity(value: &str) -> bool {
    bounded_text(value, MAX_CONTROL_IDENTITY_BYTES)
        && value.is_ascii()
        && !value
            .bytes()
            .any(|byte| matches!(byte, b'\0' | b'\r' | b'\n'))
}

fn bounded_text(value: &str, limit: usize) -> bool {
    !value.is_empty() && value.len() <= limit
}

fn valid_identifier(value: &str) -> bool {
    bounded_text(value, MAX_MANIFEST_TEXT_BYTES)
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'.' | b'_' | b':' | b'-'))
        })
}

fn valid_version(value: &str) -> bool {
    bounded_text(value, MAX_MANIFEST_TEXT_BYTES)
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric()
                || (index > 0 && matches!(byte, b'.' | b'_' | b':' | b'+' | b'@' | b'/' | b'-'))
        })
}

fn hex_lower(value: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(value.len() * 2);
    for byte in value {
        output.push(char::from(HEX[usize::from(byte >> 4)]));
        output.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    output
}

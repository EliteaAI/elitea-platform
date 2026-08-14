//! Shared application/ad-hoc preparation before invocation authorization.
//!
//! This stage consumes a fresh delivery whose encrypted output spool was
//! already proven empty. It then owns the exact order: invocation capacity ->
//! `BeginExecution` -> supervised lease activation -> claim-bound input
//! materialization -> canonical input parsing. It stops before
//! `AuthorizeInvocation`, so a prepared value is still safe to abandon without
//! creating ambiguous ADK side effects.

use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tracing::Instrument as _;

use super::agent_lease::{
    ClaimLeaseActivation, ClaimLeaseError, ClaimLeaseMonitor, ClaimLeaseMonitorConfig,
    SystemUnixMillisClock, UnixMillisClock,
};
use super::invocation_admission::{
    InvocationAdmission, InvocationAdmissionError, InvocationReservation,
};
use super::output_delivery::{EmptyAgentOutput, PreparedAgentOutput};
use crate::agents::{
    AgentExecutionKind, AgentExecutionRequest, AgentInputBinding, parse_agent_execution_input,
};
use crate::protocol::ProtocolError;
use crate::protocol::command::VerifiedAgentCommand;
use crate::protocol::control::{
    AgentControlClient, AgentControlError, AgentExecutionOutputAuthority, BeginAgentExecution,
    InvocationAuthorizationCandidate, InvocationAuthorizationNoAckAuthority,
    InvocationAuthorizationPayload, InvocationAuthorizationTerminalCause,
    InvocationSubmissionPermit, LeaseMonitoredAgentExecution,
};
use crate::protocol::elitea::runtime::v1::{DigestAlgorithmV1, DigestV1};
use crate::transport::redis_commands::RedisCommandDelivery;
use crate::transport::{ControlRpc, InputContentClient, InputContentError, MaterializedInput};

/// Immutable preparation policy.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AgentPreparationConfig {
    lease: ClaimLeaseMonitorConfig,
}

impl AgentPreparationConfig {
    /// Validate the preparation policy before attaching command authority.
    ///
    /// # Errors
    ///
    /// Returns the underlying lease cadence validation failure.
    pub fn new(lease_poll_interval: Duration) -> Result<Self, AgentPreparationError> {
        let lease = ClaimLeaseMonitorConfig::new(lease_poll_interval)?;
        Ok(Self { lease })
    }
}

/// Claim-bound materialization boundary used by production and deterministic
/// coordinator component tests.
#[async_trait]
pub(crate) trait AgentInputMaterializer: Send + Sync {
    async fn materialize(
        &self,
        execution: &LeaseMonitoredAgentExecution,
    ) -> Result<MaterializedInput, InputContentError>;
}

#[async_trait]
impl AgentInputMaterializer for InputContentClient {
    async fn materialize(
        &self,
        execution: &LeaseMonitoredAgentExecution,
    ) -> Result<MaterializedInput, InputContentError> {
        self.fetch_materialized(execution).await
    }
}

/// Stable preparation categories for terminal/no-ACK policy and tracing.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AgentPreparationErrorCode {
    InvalidConfiguration,
    Admission,
    BeginControl,
    Lease,
    Clock,
}

impl AgentPreparationErrorCode {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidConfiguration => "agent_preparation.invalid_configuration",
            Self::Admission => "agent_preparation.admission",
            Self::BeginControl => "agent_preparation.begin_control",
            Self::Lease => "agent_preparation.lease",
            Self::Clock => "agent_preparation.clock",
        }
    }
}

/// Safe, source-preserving preparation failure.
#[derive(Debug)]
pub enum AgentPreparationError {
    InvalidConfiguration(&'static str),
    Admission(InvocationAdmissionError),
    BeginControl(AgentControlError),
    Lease(ClaimLeaseError),
    Clock(&'static str),
}

impl AgentPreparationError {
    #[must_use]
    pub const fn code(&self) -> AgentPreparationErrorCode {
        match self {
            Self::InvalidConfiguration(_) => AgentPreparationErrorCode::InvalidConfiguration,
            Self::Admission(_) => AgentPreparationErrorCode::Admission,
            Self::BeginControl(_) => AgentPreparationErrorCode::BeginControl,
            Self::Lease(_) => AgentPreparationErrorCode::Lease,
            Self::Clock(_) => AgentPreparationErrorCode::Clock,
        }
    }

    #[must_use]
    pub fn retryable(&self) -> bool {
        match self {
            Self::Admission(error) => error.retryable(),
            Self::Lease(error) => error.retryable(),
            Self::BeginControl(error) => error.retryable(),
            Self::InvalidConfiguration(_) | Self::Clock(_) => false,
        }
    }
}

impl fmt::Display for AgentPreparationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidConfiguration(message) | Self::Clock(message) => {
                formatter.write_str(message)
            }
            Self::Admission(error) => {
                write!(formatter, "agent invocation admission failed: {error}")
            }
            Self::BeginControl(error) => write!(formatter, "agent begin control failed: {error}"),
            Self::Lease(error) => write!(formatter, "agent lease activation failed: {error}"),
        }
    }
}

impl std::error::Error for AgentPreparationError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Admission(error) => Some(error),
            Self::BeginControl(error) => Some(error),
            Self::Lease(error) => Some(error),
            Self::InvalidConfiguration(_) | Self::Clock(_) => None,
        }
    }
}

impl From<ClaimLeaseError> for AgentPreparationError {
    fn from(value: ClaimLeaseError) -> Self {
        match value {
            ClaimLeaseError::InvalidConfiguration(message) => Self::InvalidConfiguration(message),
            error => Self::Lease(error),
        }
    }
}

/// Fresh preparation outcomes before authorization or ADK submission.
pub enum AgentPreparationOutcome {
    Prepared(Box<PreparedAgentInvocation>),
    RetryLaterNoAck,
    RecoveryRequiredNoAck,
    PreInvocationTerminal(Box<PreInvocationTerminal>),
}

/// Live typed input plus every authority required by the later authorize-and-run
/// coordinator. No raw fence or delivery content is exposed.
pub struct PreparedAgentInvocation {
    #[allow(dead_code)] // Consumed by the next authorize-and-run slice.
    delivery: RedisCommandDelivery,
    #[allow(dead_code)] // Consumed by the next authorize-and-run slice.
    verified: VerifiedAgentCommand,
    request: AgentExecutionRequest,
    #[allow(dead_code)] // Consumed by the next output-coordination slice.
    output_spool: PreparedAgentOutput,
    #[allow(dead_code)] // Consumed by the next authorize-and-run slice.
    execution: LeaseMonitoredAgentExecution,
    #[allow(dead_code)] // Consumed by the next authorize-and-run slice.
    reservation: InvocationReservation,
    #[allow(dead_code)] // Consumed by the next authorize-and-run slice.
    lease: ClaimLeaseMonitor,
}

impl PreparedAgentInvocation {
    #[must_use]
    pub const fn execution_kind(&self) -> AgentExecutionKind {
        self.request.kind
    }

    #[must_use]
    pub const fn request(&self) -> &AgentExecutionRequest {
        &self.request
    }

    /// Seal every prepared value together before the authorization RPC.
    ///
    /// The request and claim cannot be extracted independently: the control
    /// operation carries this complete payload through to the exact native ADK
    /// submission boundary.
    #[allow(dead_code)] // Called by the next owned invocation coordinator.
    pub(crate) fn into_authorization_candidate(
        self,
    ) -> InvocationAuthorizationCandidate<PreparedAgentAuthorizationPayload> {
        let Self {
            delivery,
            verified,
            request,
            output_spool,
            execution,
            reservation,
            lease,
        } = self;
        execution.bind_invocation(PreparedAgentAuthorizationPayload {
            delivery,
            verified,
            request,
            output_spool,
            reservation,
            lease,
        })
    }

    #[cfg(test)]
    pub(crate) fn into_test_cleanup(self) -> (InvocationReservation, ClaimLeaseMonitor) {
        (self.reservation, self.lease)
    }
}

/// Complete non-cloneable invocation state carried through authorization.
#[allow(dead_code)] // Consumed by the next native ADK invocation slice.
pub(crate) struct PreparedAgentAuthorizationPayload {
    #[allow(dead_code)] // Consumed by the native ADK invocation slice.
    delivery: RedisCommandDelivery,
    #[allow(dead_code)] // Consumed by the native ADK invocation slice.
    verified: VerifiedAgentCommand,
    request: AgentExecutionRequest,
    #[allow(dead_code)] // Consumed by the output coordinator after authorization.
    output_spool: PreparedAgentOutput,
    reservation: InvocationReservation,
    lease: ClaimLeaseMonitor,
}

impl PreparedAgentAuthorizationPayload {
    #[must_use]
    #[allow(dead_code)] // Used by the next native ADK invocation slice.
    pub(crate) const fn execution_kind(&self) -> AgentExecutionKind {
        self.request.kind
    }
}

impl InvocationAuthorizationPayload for PreparedAgentAuthorizationPayload {
    type Authorized = AuthorizedAgentRun;
    type Terminal = AgentFailureTerminal;
    type Unknown = AgentAuthorizationUnknown;

    fn into_authorized(
        self,
        permit: InvocationSubmissionPermit,
        output_authority: AgentExecutionOutputAuthority,
    ) -> Self::Authorized {
        let Self {
            delivery,
            verified,
            request,
            output_spool,
            reservation,
            lease,
        } = self;
        AuthorizedAgentRun {
            delivery,
            verified,
            request,
            output_authority,
            output: output_spool,
            reservation,
            lease,
            permit,
        }
    }

    fn into_authorization_terminal(
        self,
        output_authority: AgentExecutionOutputAuthority,
        cause: InvocationAuthorizationTerminalCause,
    ) -> Self::Terminal {
        let Self {
            delivery,
            verified,
            request: _,
            output_spool,
            reservation,
            lease,
        } = self;
        AgentFailureTerminal {
            delivery,
            verified,
            output_authority,
            output: output_spool,
            reservation,
            lease,
            proposed_failure: cause.runtime_failure_kind(),
        }
    }

    fn into_authorization_unknown(
        self,
        authority: InvocationAuthorizationNoAckAuthority,
        error: AgentControlError,
    ) -> Self::Unknown {
        let Self {
            delivery: _,
            verified: _,
            request,
            output_spool,
            reservation,
            lease,
        } = self;
        AgentAuthorizationUnknown {
            execution_kind: request.kind,
            authority,
            output: output_spool,
            reservation,
            lease,
            error,
        }
    }
}

/// Complete authorized run retained as one submission/output ownership unit.
///
/// No production method exposes its permit, request, output authority, lease,
/// or reservation independently. The native ADK coordinator must consume this
/// value at the actual supervised submission boundary.
#[allow(dead_code)] // Consumed by the next native ADK invocation slice.
pub(crate) struct AuthorizedAgentRun {
    delivery: RedisCommandDelivery,
    verified: VerifiedAgentCommand,
    request: AgentExecutionRequest,
    output_authority: AgentExecutionOutputAuthority,
    output: PreparedAgentOutput,
    reservation: InvocationReservation,
    lease: ClaimLeaseMonitor,
    permit: InvocationSubmissionPermit,
}

#[cfg(test)]
impl AuthorizedAgentRun {
    pub(crate) fn into_test_cleanup(
        self,
    ) -> (
        AgentExecutionRequest,
        InvocationReservation,
        ClaimLeaseMonitor,
    ) {
        (self.request, self.reservation, self.lease)
    }
}

/// Request-free cleanup ownership for an authorization RPC with unknown effect.
///
/// The accepted claim can no longer create output or submission authority. The
/// empty spool lock and capacity reservation remain owned until lease shutdown
/// completes, while Redis remains deliberately unacknowledged for recovery.
#[allow(dead_code)] // Consumed by the next supervised authorization coordinator.
pub(crate) struct AgentAuthorizationUnknown {
    execution_kind: AgentExecutionKind,
    authority: InvocationAuthorizationNoAckAuthority,
    output: PreparedAgentOutput,
    reservation: InvocationReservation,
    lease: ClaimLeaseMonitor,
    error: AgentControlError,
}

impl AgentAuthorizationUnknown {
    #[must_use]
    #[allow(dead_code)] // Used by the next supervised authorization coordinator.
    pub(crate) const fn error(&self) -> &AgentControlError {
        &self.error
    }

    /// Close only local authority after an unknown authorization effect.
    ///
    /// No terminal, settlement, or Redis retirement authority is returned.
    #[allow(dead_code)] // Used by the next supervised authorization coordinator.
    pub(crate) async fn close_no_ack(self) -> AgentAuthorizationUnknownCompletion {
        let Self {
            execution_kind,
            authority,
            output,
            reservation,
            lease,
            error,
        } = self;
        let lease_error = lease.close().await.err();
        drop(output);
        drop(authority);
        drop(reservation);
        AgentAuthorizationUnknownCompletion {
            execution_kind,
            authorization_error: error,
            lease_error,
        }
    }
}

/// Data-free disposition retained after local unknown-effect cleanup.
#[allow(dead_code)] // Returned by the next supervised authorization coordinator.
pub(crate) struct AgentAuthorizationUnknownCompletion {
    execution_kind: AgentExecutionKind,
    authorization_error: AgentControlError,
    lease_error: Option<ClaimLeaseError>,
}

#[allow(dead_code)] // Read by the next supervised authorization coordinator.
impl AgentAuthorizationUnknownCompletion {
    #[must_use]
    pub(crate) const fn execution_kind(&self) -> AgentExecutionKind {
        self.execution_kind
    }

    #[must_use]
    pub(crate) const fn authorization_error(&self) -> &AgentControlError {
        &self.authorization_error
    }

    #[must_use]
    pub(crate) const fn lease_error(&self) -> Option<&ClaimLeaseError> {
        self.lease_error.as_ref()
    }
}

/// Claim authority retained when the immediate lease boundary itself supplies
/// a canonical pre-invocation terminal cause such as durable Stop.
pub struct PreInvocationTerminal {
    #[allow(dead_code)] // Consumed by the next output-coordination slice.
    delivery: RedisCommandDelivery,
    #[allow(dead_code)] // Consumed by the next output-coordination slice.
    verified: VerifiedAgentCommand,
    #[allow(dead_code)] // Consumed by the next output-coordination slice.
    output_authority: AgentExecutionOutputAuthority,
    #[allow(dead_code)] // Consumed by the next output-coordination slice.
    output_spool: PreparedAgentOutput,
    #[allow(dead_code)] // Consumed by the next output-coordination slice.
    reservation: InvocationReservation,
    #[allow(dead_code)] // Consumed by the next output-coordination slice.
    lease: ClaimLeaseMonitor,
    cause: PreInvocationTerminalCause,
}

impl PreInvocationTerminal {
    #[must_use]
    pub const fn cause(&self) -> &PreInvocationTerminalCause {
        &self.cause
    }

    pub(super) fn into_failure_terminal(self) -> AgentFailureTerminal {
        AgentFailureTerminal {
            delivery: self.delivery,
            verified: self.verified,
            output_authority: self.output_authority,
            output: self.output_spool,
            reservation: self.reservation,
            lease: self.lease,
            proposed_failure: self.cause.runtime_failure_kind(),
        }
    }

    #[cfg(test)]
    pub(crate) fn into_test_parts(
        self,
    ) -> (
        RedisCommandDelivery,
        VerifiedAgentCommand,
        AgentExecutionOutputAuthority,
        PreparedAgentOutput,
        InvocationReservation,
        ClaimLeaseMonitor,
        PreInvocationTerminalCause,
    ) {
        (
            self.delivery,
            self.verified,
            self.output_authority,
            self.output_spool,
            self.reservation,
            self.lease,
            self.cause,
        )
    }
}

/// Sealed pre-authorization failure state consumed only by output delivery.
///
/// The type exposes neither request input nor fence material. Keeping delivery,
/// command, output, capacity and lease ownership together prevents a terminal
/// from being published or retired under another admitted invocation.
pub(crate) struct AgentFailureTerminal {
    pub(super) delivery: RedisCommandDelivery,
    pub(super) verified: VerifiedAgentCommand,
    pub(super) output_authority: AgentExecutionOutputAuthority,
    pub(super) output: PreparedAgentOutput,
    pub(super) reservation: InvocationReservation,
    pub(super) lease: ClaimLeaseMonitor,
    pub(super) proposed_failure: crate::protocol::output::RuntimeFailureKind,
}

#[cfg(test)]
impl AgentFailureTerminal {
    pub(crate) fn into_test_cleanup(
        self,
    ) -> (
        AgentExecutionKind,
        crate::protocol::output::RuntimeFailureKind,
        InvocationReservation,
        ClaimLeaseMonitor,
    ) {
        (
            self.verified.kind(),
            self.proposed_failure,
            self.reservation,
            self.lease,
        )
    }
}

/// Canonical terminal cause observed before the durable invocation fence.
#[derive(Debug)]
pub enum PreInvocationTerminalCause {
    Cancelled(ClaimLeaseError),
    InputContent(InputContentError),
    InputProtocol(ProtocolError),
    DeadlineExceeded,
}

impl PreInvocationTerminalCause {
    /// Stable low-cardinality category for logs and metrics.
    #[must_use]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Cancelled(_) => "agent_preparation.cancelled",
            Self::InputContent(error) => error.code(),
            Self::InputProtocol(ProtocolError::InvalidInput(_)) => "agent_input.invalid_input",
            Self::InputProtocol(ProtocolError::ResourceExhausted(_)) => {
                "agent_input.resource_exhausted"
            }
            Self::InputProtocol(ProtocolError::IncompatibleVersion(_)) => {
                "agent_input.incompatible_version"
            }
            Self::InputProtocol(ProtocolError::UnsupportedCapability(_)) => {
                "agent_input.unsupported_capability"
            }
            Self::InputProtocol(ProtocolError::AuthorizationFailed(_)) => {
                "agent_input.authorization_failed"
            }
            Self::DeadlineExceeded => "agent_preparation.deadline_exceeded",
        }
    }

    #[must_use]
    pub const fn runtime_failure_kind(&self) -> crate::protocol::output::RuntimeFailureKind {
        use crate::protocol::output::RuntimeFailureKind;
        match self {
            Self::Cancelled(_) => RuntimeFailureKind::Cancelled,
            Self::DeadlineExceeded => RuntimeFailureKind::DeadlineExceeded,
            Self::InputContent(InputContentError::InvalidInput(_))
            | Self::InputProtocol(ProtocolError::InvalidInput(_)) => {
                RuntimeFailureKind::InvalidInput
            }
            Self::InputContent(InputContentError::ResourceExhausted(_))
            | Self::InputProtocol(ProtocolError::ResourceExhausted(_)) => {
                RuntimeFailureKind::ResourceExhausted
            }
            Self::InputContent(InputContentError::AuthorizationFailed(_))
            | Self::InputProtocol(ProtocolError::AuthorizationFailed(_)) => {
                RuntimeFailureKind::AuthorizationFailed
            }
            Self::InputProtocol(ProtocolError::IncompatibleVersion(_)) => {
                RuntimeFailureKind::IncompatibleVersion
            }
            Self::InputProtocol(ProtocolError::UnsupportedCapability(_)) => {
                RuntimeFailureKind::UnsupportedCapability
            }
            Self::InputContent(
                InputContentError::DependencyUnavailable(_)
                | InputContentError::Transport(_)
                | InputContentError::Timeout(_),
            ) => RuntimeFailureKind::DependencyUnavailable,
            Self::InputContent(InputContentError::InvalidConfiguration(_)) => {
                RuntimeFailureKind::Internal
            }
        }
    }
}

impl fmt::Display for PreInvocationTerminalCause {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cancelled(error) => error.fmt(formatter),
            Self::InputContent(error) => {
                write!(formatter, "agent input materialization failed: {error}")
            }
            Self::InputProtocol(error) => {
                write!(formatter, "agent input validation failed: {error}")
            }
            Self::DeadlineExceeded => {
                formatter.write_str("the agent command deadline was exceeded before invocation")
            }
        }
    }
}

impl std::error::Error for PreInvocationTerminalCause {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Cancelled(error) => Some(error),
            Self::InputContent(error) => Some(error),
            Self::InputProtocol(error) => Some(error),
            Self::DeadlineExceeded => None,
        }
    }
}

/// Prepare one routed fresh agent command through typed input, without crossing
/// the durable invocation fence.
///
/// # Errors
///
/// Returns typed admission/control/lease/input/deadline failures. Any returned
/// error owns no output or Redis retirement authority; the command remains
/// unacknowledged for recovery. Durable cancellation is instead returned as a
/// `PreInvocationTerminal` carrying its exact output authority.
pub async fn prepare_fresh_agent_invocation<R>(
    fresh: EmptyAgentOutput,
    control: Arc<AgentControlClient<R>>,
    admission: &InvocationAdmission,
    input: &InputContentClient,
    config: AgentPreparationConfig,
) -> Result<AgentPreparationOutcome, AgentPreparationError>
where
    R: ControlRpc + 'static,
{
    Box::pin(prepare_fresh_agent_invocation_with(
        fresh,
        control,
        admission,
        input,
        Arc::new(SystemUnixMillisClock),
        config,
    ))
    .await
}

pub(crate) async fn prepare_fresh_agent_invocation_with<R, K, I>(
    fresh: EmptyAgentOutput,
    control: Arc<AgentControlClient<R>>,
    admission: &InvocationAdmission,
    input: &I,
    clock: Arc<K>,
    config: AgentPreparationConfig,
) -> Result<AgentPreparationOutcome, AgentPreparationError>
where
    R: ControlRpc + 'static,
    K: UnixMillisClock,
    I: AgentInputMaterializer,
{
    let kind = fresh.execution_kind();
    let (fresh, output_spool) = fresh.into_parts();
    let (delivery, verified, claim) = fresh.into_parts();
    let command = verified.command();
    let span = tracing::info_span!(
        "agent.prepare",
        execution_kind = ?kind,
        tenant_id = %command.tenant_id,
        resource_project_id = %command.resource_project_id,
        execution_id = %command.execution_id,
        generation = command.generation,
        command_id = %command.command_id,
        stage = tracing::field::Empty,
        outcome = tracing::field::Empty,
        error_code = tracing::field::Empty,
    );
    Box::pin(
        async move {
            let reservation = match admission.reserve().await {
                Ok(reservation) => reservation,
                Err(error) if error.retryable() => {
                    tracing::Span::current().record("outcome", "retry_later_noack");
                    tracing::Span::current().record("error_code", error.code().as_str());
                    return Ok(AgentPreparationOutcome::RetryLaterNoAck);
                }
                Err(error) => return preparation_error(AgentPreparationError::Admission(error)),
            };
            tracing::Span::current().record("stage", "begin_execution");
            let preparing = match control.begin_agent_execution(claim).await {
                Ok(BeginAgentExecution::Preparing(preparing)) => preparing,
                Ok(BeginAgentExecution::AlreadyStarted(_)) => {
                    tracing::Span::current().record("outcome", "recovery_required_noack");
                    return Ok(AgentPreparationOutcome::RecoveryRequiredNoAck);
                }
                Err(error) => return preparation_error(AgentPreparationError::BeginControl(error)),
            };

            let starting = preparing.start_lease_monitor();
            let mut lease = ClaimLeaseMonitor::start(
                Arc::clone(&control),
                starting,
                Arc::clone(&clock),
                config.lease,
            );
            tracing::Span::current().record("stage", "lease_activation");
            let execution = match lease.activate().await {
                ClaimLeaseActivation::Active(execution) => execution,
                ClaimLeaseActivation::Inactive { execution, error }
                    if is_terminal_lease(&error) =>
                {
                    tracing::Span::current().record("outcome", "pre_invocation_terminal");
                    tracing::Span::current().record("error_code", error.code().as_str());
                    return Ok(AgentPreparationOutcome::PreInvocationTerminal(Box::new(
                        PreInvocationTerminal {
                            delivery,
                            verified,
                            output_authority: execution.into_output_authority(),
                            output_spool,
                            reservation,
                            lease,
                            cause: PreInvocationTerminalCause::Cancelled(error),
                        },
                    )));
                }
                ClaimLeaseActivation::Inactive { error, .. }
                | ClaimLeaseActivation::Unavailable(error) => {
                    return preparation_error(AgentPreparationError::Lease(error));
                }
            };
            ActiveAgentPreparation {
                kind,
                delivery,
                verified,
                output_spool,
                execution,
                reservation,
                lease,
            }
            .materialize(input, clock.as_ref())
            .await
        }
        .instrument(span),
    )
    .await
}

struct ActiveAgentPreparation {
    kind: AgentExecutionKind,
    delivery: RedisCommandDelivery,
    verified: VerifiedAgentCommand,
    output_spool: PreparedAgentOutput,
    execution: LeaseMonitoredAgentExecution,
    reservation: InvocationReservation,
    lease: ClaimLeaseMonitor,
}

impl ActiveAgentPreparation {
    async fn materialize<I, K>(
        mut self,
        input: &I,
        clock: &K,
    ) -> Result<AgentPreparationOutcome, AgentPreparationError>
    where
        I: AgentInputMaterializer,
        K: UnixMillisClock,
    {
        match deadline_exceeded(&self.verified, clock) {
            Ok(true) => {
                return self
                    .terminal_after_final_lease(PreInvocationTerminalCause::DeadlineExceeded)
                    .await;
            }
            Ok(false) => {}
            Err(error) => return preparation_error(error),
        }
        tracing::Span::current().record("stage", "input_materialization");
        let materialized = match self
            .lease
            .run_pre_invocation(input.materialize(&self.execution))
            .await
        {
            Ok(Ok(materialized)) => materialized,
            Ok(Err(error)) => {
                return self
                    .terminal_after_final_lease(PreInvocationTerminalCause::InputContent(error))
                    .await;
            }
            Err(error) if is_terminal_lease(&error) => {
                return Ok(self.terminal(PreInvocationTerminalCause::Cancelled(error)));
            }
            Err(error) => return preparation_error(AgentPreparationError::Lease(error)),
        };
        let request = match self.request_from(materialized.as_bytes()) {
            Ok(request) => request,
            Err(error) => {
                return self
                    .terminal_after_final_lease(PreInvocationTerminalCause::InputProtocol(error))
                    .await;
            }
        };
        match self.lease.ensure_running() {
            Ok(()) => {}
            Err(error) if is_terminal_lease(&error) => {
                return Ok(self.terminal(PreInvocationTerminalCause::Cancelled(error)));
            }
            Err(error) => return preparation_error(AgentPreparationError::Lease(error)),
        }
        match deadline_exceeded(&self.verified, clock) {
            Ok(true) => {
                return self
                    .terminal_after_final_lease(PreInvocationTerminalCause::DeadlineExceeded)
                    .await;
            }
            Ok(false) => {}
            Err(error) => return preparation_error(error),
        }
        tracing::Span::current().record("outcome", "prepared");
        Ok(AgentPreparationOutcome::Prepared(Box::new(
            PreparedAgentInvocation {
                delivery: self.delivery,
                verified: self.verified,
                request,
                output_spool: self.output_spool,
                execution: self.execution,
                reservation: self.reservation,
                lease: self.lease,
            },
        )))
    }

    fn request_from(&self, raw: &[u8]) -> Result<AgentExecutionRequest, ProtocolError> {
        let message = parse_agent_execution_input(raw)?;
        let binding = agent_input_binding(&self.execution)?;
        crate::agents::request_from(message, self.kind, binding)
    }

    async fn terminal_after_final_lease(
        self,
        proposed: PreInvocationTerminalCause,
    ) -> Result<AgentPreparationOutcome, AgentPreparationError> {
        let cause = match self.lease.check_now().await {
            Ok(()) => proposed,
            Err(error) if is_terminal_lease(&error) => PreInvocationTerminalCause::Cancelled(error),
            Err(error) => return preparation_error(AgentPreparationError::Lease(error)),
        };
        Ok(self.terminal(cause))
    }

    fn terminal(self, cause: PreInvocationTerminalCause) -> AgentPreparationOutcome {
        pre_invocation_terminal(
            self.delivery,
            self.verified,
            self.output_spool,
            self.execution,
            self.reservation,
            self.lease,
            cause,
        )
    }
}

fn deadline_exceeded<K: UnixMillisClock>(
    verified: &VerifiedAgentCommand,
    clock: &K,
) -> Result<bool, AgentPreparationError> {
    let now = clock.now_unix_millis();
    if now <= 0 {
        return Err(AgentPreparationError::Clock(
            "the wall clock cannot validate the agent command deadline",
        ));
    }
    let deadline = verified.command().deadline_unix_millis;
    Ok(deadline <= now)
}

fn agent_input_binding(
    execution: &LeaseMonitoredAgentExecution,
) -> Result<AgentInputBinding, ProtocolError> {
    let bundle = execution.input_bundle();
    let bundle_reference = execution.input_bundle_ref();
    let request = execution.request_entry();
    let content = request.content.as_ref().ok_or(ProtocolError::InvalidInput(
        "the agent request content binding is missing",
    ))?;
    Ok(AgentInputBinding {
        input_bundle_id: bundle.input_bundle_id.clone(),
        input_bundle_digest: sha256_bytes(bundle_reference.digest.as_ref())?,
        request_entry_id: request.entry_id.clone(),
        request_immutable_version: request.immutable_version.clone(),
        request_content_digest: sha256_bytes(content.digest.as_ref())?,
    })
}

fn sha256_bytes(value: Option<&DigestV1>) -> Result<[u8; 32], ProtocolError> {
    let value = value.ok_or(ProtocolError::InvalidInput(
        "the agent input digest binding is missing",
    ))?;
    if value.algorithm != DigestAlgorithmV1::Sha256 as i32 {
        return Err(ProtocolError::InvalidInput(
            "the agent input digest binding is malformed",
        ));
    }
    value
        .value
        .as_slice()
        .try_into()
        .map_err(|_| ProtocolError::InvalidInput("the agent input digest binding is malformed"))
}

fn is_terminal_lease(error: &ClaimLeaseError) -> bool {
    matches!(error, ClaimLeaseError::Cancelled(_))
}

fn pre_invocation_terminal(
    delivery: RedisCommandDelivery,
    verified: VerifiedAgentCommand,
    output_spool: PreparedAgentOutput,
    execution: LeaseMonitoredAgentExecution,
    reservation: InvocationReservation,
    lease: ClaimLeaseMonitor,
    cause: PreInvocationTerminalCause,
) -> AgentPreparationOutcome {
    tracing::Span::current().record("outcome", "pre_invocation_terminal");
    tracing::Span::current().record("error_code", cause.code());
    AgentPreparationOutcome::PreInvocationTerminal(Box::new(PreInvocationTerminal {
        delivery,
        verified,
        output_authority: execution.into_output_authority(),
        output_spool,
        reservation,
        lease,
        cause,
    }))
}

fn preparation_error<T>(error: AgentPreparationError) -> Result<T, AgentPreparationError> {
    tracing::Span::current().record("outcome", "error_noack");
    tracing::Span::current().record("error_code", error.code().as_str());
    Err(error)
}

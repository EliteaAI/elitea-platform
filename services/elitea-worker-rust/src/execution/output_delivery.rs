//! No-network encrypted output preflight for fresh agent deliveries.
//!
//! The exact execution spool is opened, exclusively locked, decrypted and
//! restored on Tokio's blocking pool before capacity reservation, Begin, input
//! materialization, or invocation authorization can occur. A pending frame is
//! routed to recovery and can never be converted into fresh business input.

use std::fmt;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;

use async_trait::async_trait;
use prost::Message;
use tonic::transport::Channel;

use crate::agents::AgentExecutionKind;
use crate::protocol::ProtocolError;
use crate::protocol::command::VerifiedAgentCommand;
use crate::protocol::control::{
    AcceptedTerminalClaimRecovery, AgentControlClient, AgentControlError,
};
use crate::protocol::elitea::runtime::v1::ExecutionOutputFrameV1;
use crate::protocol::output::{
    AgentTerminalOutput, RuntimeFailureKind, ValidatedAgentOutputFrameKind,
    build_agent_terminal_output_frame, restored_terminal_failure_kind,
};
use crate::spool::{
    EncryptedOutputSpool, ExecutionSpoolBinding, SpoolError, SpoolLimits, SpoolMasterKey,
};
use crate::transport::redis_commands::{
    RedisCommandError, RedisCommandRetirer, RedisRetirementClient,
};
use crate::transport::{
    ControlRpc, DurablyAckedTerminal, OutputGrpcConfig, OutputGrpcError, OutputProtocolError,
    PreparedOutputSpool,
};

use super::agent_delivery::FreshAgentDelivery;
use super::agent_lease::{
    ClaimLeaseError, ClaimLeaseMonitor, ClaimLeaseMonitorConfig, UnixMillisClock,
};
use super::agent_preparation::{AgentFailureTerminal, PreInvocationTerminal};

const MIN_OUTPUT_SESSIONS: usize = 1;
const MAX_OUTPUT_SESSIONS: usize = 8;

type TerminalFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Stable preflight outcome category without exposing durable frame contents.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AgentOutputPreflightKind {
    Empty,
    TerminalRecovery,
    RecoveryRequiredNoAck,
}

/// Reason an accepted delivery cannot proceed as fresh work.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AgentOutputRecoveryRequiredKind {
    PendingProgress,
    ReconciledStaleProgress,
}

/// Fresh delivery plus a locked, validated, empty output spool.
///
/// This is the only type accepted by fresh preparation. It is intentionally
/// non-cloneable and non-debug so the exclusive spool owner cannot be copied.
pub struct EmptyAgentOutput {
    fresh: FreshAgentDelivery,
    output: PreparedAgentOutput,
}

impl EmptyAgentOutput {
    #[must_use]
    pub const fn execution_kind(&self) -> AgentExecutionKind {
        self.fresh.execution_kind()
    }

    pub(crate) fn into_parts(self) -> (FreshAgentDelivery, PreparedAgentOutput) {
        (self.fresh, self.output)
    }
}

/// Exact current-fence terminal output which must be replayed and settled.
pub struct AcceptedTerminalOutputRecovery {
    delivery: crate::transport::redis_commands::RedisCommandDelivery,
    verified: VerifiedAgentCommand,
    claim: AcceptedTerminalClaimRecovery,
    spool: PreparedOutputSpool,
    frame: ExecutionOutputFrameV1,
    reopener: AgentOutputSpoolReopener,
}

impl AcceptedTerminalOutputRecovery {
    #[must_use]
    pub const fn execution_kind(&self) -> AgentExecutionKind {
        self.verified.kind()
    }

    #[must_use]
    pub const fn sequence(&self) -> u64 {
        self.frame.sequence
    }

    #[allow(dead_code)] // Consumed by the next exact output-recovery slice.
    pub(crate) fn into_parts(
        self,
    ) -> (
        crate::transport::redis_commands::RedisCommandDelivery,
        VerifiedAgentCommand,
        AcceptedTerminalClaimRecovery,
        PreparedOutputSpool,
        ExecutionOutputFrameV1,
        AgentOutputSpoolReopener,
    ) {
        (
            self.delivery,
            self.verified,
            self.claim,
            self.spool,
            self.frame,
            self.reopener,
        )
    }
}

/// Non-authoritative summary for a delivery intentionally left in Redis.
pub struct AgentOutputRecoveryRequiredNoAck {
    execution_kind: AgentExecutionKind,
    kind: AgentOutputRecoveryRequiredKind,
    sequence: u64,
}

impl AgentOutputRecoveryRequiredNoAck {
    #[must_use]
    pub const fn execution_kind(&self) -> AgentExecutionKind {
        self.execution_kind
    }

    #[must_use]
    pub const fn kind(&self) -> AgentOutputRecoveryRequiredKind {
        self.kind
    }

    #[must_use]
    pub const fn sequence(&self) -> u64 {
        self.sequence
    }
}

/// Closed result of inspecting the current execution's durable output.
pub enum AgentOutputPreflightOutcome {
    Empty(Box<EmptyAgentOutput>),
    TerminalRecovery(Box<AcceptedTerminalOutputRecovery>),
    RecoveryRequiredNoAck(AgentOutputRecoveryRequiredNoAck),
}

impl AgentOutputPreflightOutcome {
    #[must_use]
    pub const fn kind(&self) -> AgentOutputPreflightKind {
        match self {
            Self::Empty(_) => AgentOutputPreflightKind::Empty,
            Self::TerminalRecovery(_) => AgentOutputPreflightKind::TerminalRecovery,
            Self::RecoveryRequiredNoAck(_) => AgentOutputPreflightKind::RecoveryRequiredNoAck,
        }
    }
}

struct AgentOutputSpoolPolicy {
    root: PathBuf,
    master_key: Arc<SpoolMasterKey>,
    spool_limits: SpoolLimits,
    output_config: OutputGrpcConfig,
}

/// Empty, validated output state plus its inseparable execution-bound reopen
/// capability. Fresh preparation carries this value through authorization so
/// later reconnects never reconstruct path, key, identity, or transport policy
/// from loose caller-selected values.
pub(crate) struct PreparedAgentOutput {
    #[allow(dead_code)] // Consumed by the next fresh-output publication slice.
    prepared: PreparedOutputSpool,
    #[allow(dead_code)] // Consumed by the next fresh-output publication slice.
    factory: AgentOutputSpoolFactory,
}

impl PreparedAgentOutput {
    /// Persist one fresh terminal before any output endpoint is contacted and
    /// seal the exact bytes into the only allowed reconnect capability.
    async fn persist_terminal(
        self,
        frame: &ExecutionOutputFrameV1,
    ) -> Result<(PreparedOutputSpool, AgentOutputSpoolReopener), OutputGrpcError> {
        let Self {
            mut prepared,
            factory,
        } = self;
        let durable = frame.clone();
        let expected = frame.encode_to_vec();
        let prepared = tokio::task::spawn_blocking(move || {
            prepared.persist(durable)?;
            Ok::<_, OutputGrpcError>(prepared)
        })
        .await
        .map_err(|_| {
            OutputGrpcError::Unavailable("the terminal output persistence task did not complete")
        })??;
        Ok((prepared, factory.seal_terminal(expected)))
    }

    #[cfg(test)]
    pub(crate) fn into_test_spool(self) -> PreparedOutputSpool {
        self.prepared
    }
}

/// Unique execution-bound factory. It carries no frame proof until a durable
/// terminal is sealed into an [`AgentOutputSpoolReopener`].
struct AgentOutputSpoolFactory {
    policy: Arc<AgentOutputSpoolPolicy>,
    binding: Arc<crate::spool::ExecutionSpoolIdentity>,
}

impl AgentOutputSpoolFactory {
    async fn reopen(&self) -> Result<PreparedOutputSpool, AgentOutputPreflightError> {
        open_prepared_spool(Arc::clone(&self.policy), Arc::clone(&self.binding)).await
    }

    fn seal_terminal(self, expected_terminal: Vec<u8>) -> AgentOutputSpoolReopener {
        AgentOutputSpoolReopener {
            factory: self,
            expected_terminal,
        }
    }
}

/// Sealed execution-bound spool factory retained across bounded reconnects.
pub(crate) struct AgentOutputSpoolReopener {
    factory: AgentOutputSpoolFactory,
    expected_terminal: Vec<u8>,
}

impl AgentOutputSpoolReopener {
    #[allow(dead_code)] // Used by the next bounded reconnect slice.
    pub(crate) async fn reopen(&self) -> Result<PreparedOutputSpool, AgentOutputPreflightError> {
        let prepared = self.factory.reopen().await?;
        let is_exact_terminal = prepared.pending_frame_count() == 1
            && prepared
                .pending_replay_frame()
                .is_some_and(|frame| frame.encode_to_vec() == self.expected_terminal);
        if !is_exact_terminal {
            return Err(AgentOutputPreflightError::InvalidDurableState(
                "the pending terminal output changed after recovery admission",
            ));
        }
        Ok(prepared)
    }

    /// Atomically replace the exact admitted terminal and advance the sealed
    /// reconnect proof only after the filesystem CAS succeeds.
    #[allow(dead_code)] // Called by the disabled terminal-recovery coordinator.
    async fn replace_expected_terminal(
        &mut self,
        expected: &ExecutionOutputFrameV1,
        replacement: &ExecutionOutputFrameV1,
    ) -> Result<PreparedOutputSpool, AgentOutputPreflightError> {
        if expected.encode_to_vec() != self.expected_terminal {
            return Err(AgentOutputPreflightError::InvalidDurableState(
                "the terminal replacement does not match recovery admission",
            ));
        }
        let mut prepared = self.reopen().await?;
        let expected = expected.clone();
        let replacement = replacement.clone();
        let replacement_bytes = replacement.encode_to_vec();
        let prepared = tokio::task::spawn_blocking(move || {
            prepared.replace_pending_exact(&expected, &replacement)?;
            Ok::<_, OutputGrpcError>(prepared)
        })
        .await
        .map_err(|_| {
            AgentOutputPreflightError::Unavailable(
                "the terminal output replacement task did not complete",
            )
        })?
        .map_err(AgentOutputPreflightError::Output)?;
        self.expected_terminal = replacement_bytes;
        Ok(prepared)
    }
}

/// Bounded fresh-session policy for exact accepted-terminal recovery.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AgentTerminalRecoveryConfig {
    max_output_sessions: usize,
}

impl AgentTerminalRecoveryConfig {
    /// Validate the number of complete output-stream attempts per terminal.
    ///
    /// # Errors
    ///
    /// Rejects zero and values above the deployed v1 ceiling of eight.
    pub fn new(max_output_sessions: usize) -> Result<Self, AgentTerminalRecoveryError> {
        if !(MIN_OUTPUT_SESSIONS..=MAX_OUTPUT_SESSIONS).contains(&max_output_sessions) {
            return Err(AgentTerminalRecoveryError::InvalidConfiguration(
                "the terminal recovery session limit is outside the approved range",
            ));
        }
        Ok(Self {
            max_output_sessions,
        })
    }
}

/// Confirmed outcome of replay, settlement and atomic Redis retirement.
#[derive(Debug)]
pub struct AcceptedTerminalRecoveryCompletion {
    execution_kind: AgentExecutionKind,
    sequence: u64,
    settlement_receipt_id: String,
}

impl AcceptedTerminalRecoveryCompletion {
    #[must_use]
    pub const fn execution_kind(&self) -> AgentExecutionKind {
        self.execution_kind
    }

    #[must_use]
    pub const fn sequence(&self) -> u64 {
        self.sequence
    }

    #[must_use]
    pub fn settlement_receipt_id(&self) -> &str {
        &self.settlement_receipt_id
    }
}

/// Confirmed outcome of a fresh pre-invocation failure terminal.
#[derive(Debug)]
#[allow(dead_code)] // Returned by the capability-gated fresh coordinator.
pub(crate) struct AgentFailureTerminalCompletion {
    execution_kind: AgentExecutionKind,
    sequence: u64,
    failure: RuntimeFailureKind,
    settlement_receipt_id: String,
}

#[allow(dead_code)] // Observed by the next whole-delivery coordinator.
impl AgentFailureTerminalCompletion {
    #[must_use]
    pub(crate) const fn execution_kind(&self) -> AgentExecutionKind {
        self.execution_kind
    }

    #[must_use]
    pub(crate) const fn sequence(&self) -> u64 {
        self.sequence
    }

    #[must_use]
    pub(crate) const fn failure(&self) -> RuntimeFailureKind {
        self.failure
    }

    #[must_use]
    pub(crate) fn settlement_receipt_id(&self) -> &str {
        &self.settlement_receipt_id
    }
}

/// Data-free failure for fresh terminal publication and retirement.
#[derive(Debug)]
#[allow(dead_code)] // Returned by the capability-gated fresh coordinator.
pub(crate) enum AgentFailureTerminalError {
    Lease(ClaimLeaseError),
    Clock(&'static str),
    InvalidDurableState(ProtocolError),
    Preflight(AgentOutputPreflightError),
    Output(OutputGrpcError),
    Settlement(AgentControlError),
    Redis(RedisCommandError),
}

#[allow(dead_code)] // Observed by the next whole-delivery coordinator.
impl AgentFailureTerminalError {
    /// Stable low-cardinality category for logs and metrics.
    #[must_use]
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::Lease(_) => "agent_failure_terminal.lease_lost",
            Self::Clock(_) => "agent_failure_terminal.invalid_clock",
            Self::InvalidDurableState(_) => "agent_failure_terminal.invalid_durable_state",
            Self::Preflight(error) => error.code(),
            Self::Output(error) if reconnectable_output(error) => {
                "agent_failure_terminal.output_unavailable"
            }
            Self::Output(_) => "agent_failure_terminal.output_rejected",
            Self::Settlement(_) => "agent_failure_terminal.settlement_failed",
            Self::Redis(error) => error.code(),
        }
    }

    #[must_use]
    pub(crate) fn retryable(&self) -> bool {
        match self {
            Self::Lease(error) => error.retryable(),
            Self::Preflight(error) => error.retryable(),
            Self::Output(error) => reconnectable_output(error),
            Self::Settlement(error) => error.retryable(),
            Self::Redis(error) => error.retryable(),
            Self::Clock(_) | Self::InvalidDurableState(_) => false,
        }
    }
}

impl fmt::Display for AgentFailureTerminalError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Lease(error) => write!(formatter, "terminal lease validation failed: {error}"),
            Self::Clock(message) => formatter.write_str(message),
            Self::InvalidDurableState(error) => {
                write!(formatter, "the fresh terminal is invalid: {error}")
            }
            Self::Preflight(error) => write!(formatter, "terminal spool recovery failed: {error}"),
            Self::Output(error) => write!(formatter, "terminal output delivery failed: {error}"),
            Self::Settlement(error) => write!(formatter, "terminal settlement failed: {error}"),
            Self::Redis(error) => write!(formatter, "terminal Redis retirement failed: {error}"),
        }
    }
}

impl std::error::Error for AgentFailureTerminalError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Lease(error) => Some(error),
            Self::InvalidDurableState(error) => Some(error),
            Self::Preflight(error) => Some(error),
            Self::Output(error) => Some(error),
            Self::Settlement(error) => Some(error),
            Self::Redis(error) => Some(error),
            Self::Clock(_) => None,
        }
    }
}

/// Data-free failure for the exact terminal recovery lifecycle.
#[derive(Debug)]
pub enum AgentTerminalRecoveryError {
    InvalidConfiguration(&'static str),
    InvalidDurableState(ProtocolError),
    Preflight(AgentOutputPreflightError),
    Output(OutputGrpcError),
    Settlement(AgentControlError),
    Redis(RedisCommandError),
}

impl AgentTerminalRecoveryError {
    /// Stable low-cardinality category for operator logs and metrics.
    #[must_use]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::InvalidConfiguration(_) => "agent_terminal_recovery.invalid_configuration",
            Self::InvalidDurableState(_) => "agent_terminal_recovery.invalid_durable_state",
            Self::Preflight(error) => error.code(),
            Self::Output(error) if reconnectable_output(error) => {
                "agent_terminal_recovery.output_unavailable"
            }
            Self::Output(_) => "agent_terminal_recovery.output_rejected",
            Self::Settlement(_) => "agent_terminal_recovery.settlement_failed",
            Self::Redis(error) => error.code(),
        }
    }

    /// Whether redelivery can make progress without changing immutable input.
    #[must_use]
    pub const fn retryable(&self) -> bool {
        match self {
            Self::Preflight(error) => error.retryable(),
            Self::Output(error) => reconnectable_output(error),
            Self::Settlement(error) => error.retryable(),
            Self::Redis(error) => error.retryable(),
            Self::InvalidConfiguration(_) | Self::InvalidDurableState(_) => false,
        }
    }
}

impl fmt::Display for AgentTerminalRecoveryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidConfiguration(message) => formatter.write_str(message),
            Self::InvalidDurableState(error) => {
                write!(formatter, "the recovered terminal is invalid: {error}")
            }
            Self::Preflight(error) => write!(formatter, "terminal spool recovery failed: {error}"),
            Self::Output(error) => write!(formatter, "terminal output replay failed: {error}"),
            Self::Settlement(error) => write!(formatter, "terminal settlement failed: {error}"),
            Self::Redis(error) => write!(formatter, "terminal Redis retirement failed: {error}"),
        }
    }
}

impl std::error::Error for AgentTerminalRecoveryError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::InvalidDurableState(error) => Some(error),
            Self::Preflight(error) => Some(error),
            Self::Output(error) => Some(error),
            Self::Settlement(error) => Some(error),
            Self::Redis(error) => Some(error),
            Self::InvalidConfiguration(_) => None,
        }
    }
}

/// One fresh output-stream attempt. The private trait keeps transport injection
/// inside this crate while allowing deterministic lifecycle tests.
#[async_trait]
#[allow(dead_code)] // Production composition is intentionally capability-gated.
pub(crate) trait AgentTerminalReplay: Send + Sync {
    /// Replay the sole exact terminal. Every error must leave its durable bytes
    /// intact so a sealed reopener can verify the next attempt.
    async fn replay_terminal(
        &self,
        spool: PreparedOutputSpool,
        verified: &VerifiedAgentCommand,
        expected: &ExecutionOutputFrameV1,
    ) -> Result<DurablyAckedTerminal, OutputGrpcError>;
}

#[async_trait]
impl AgentTerminalReplay for Channel {
    async fn replay_terminal(
        &self,
        spool: PreparedOutputSpool,
        verified: &VerifiedAgentCommand,
        expected: &ExecutionOutputFrameV1,
    ) -> Result<DurablyAckedTerminal, OutputGrpcError> {
        spool
            .replay_terminal(self.clone(), verified, expected)
            .await
    }
}

/// Publish and retire one canonical failure observed before native ADK entry.
///
/// A final supervised lease poll linearizes server Stop and fatal lease loss.
/// Only after that poll does the coordinator sample occurrence time and apply
/// the inclusive command deadline. The terminal is durably persisted before
/// the first output attempt; every reconnect must prove the same exact bytes.
#[allow(dead_code)] // Enabled with the owned fresh-invocation coordinator.
pub(crate) fn publish_pre_invocation_terminal<'a, R, C, T, K>(
    control: Arc<AgentControlClient<R>>,
    retirer: &'a RedisCommandRetirer<C>,
    replay: &'a T,
    terminal: PreInvocationTerminal,
    clock: Arc<K>,
    recovery_config: AgentTerminalRecoveryConfig,
) -> TerminalFuture<'a, Result<AgentFailureTerminalCompletion, AgentFailureTerminalError>>
where
    R: ControlRpc + 'static,
    C: RedisRetirementClient + 'a,
    T: AgentTerminalReplay + 'a,
    K: UnixMillisClock,
{
    publish_agent_failure_terminal(
        control,
        retirer,
        replay,
        terminal.into_failure_terminal(),
        clock,
        recovery_config,
    )
}

/// Publish any sealed failure terminal created before native ADK submission.
///
/// This shared owner accepts no request payload or raw fence. Preparation and
/// authenticated authorization failures therefore follow one final-poll,
/// durable-output and retirement implementation.
#[allow(dead_code)] // Called by the next supervised authorization coordinator.
pub(crate) fn publish_agent_failure_terminal<'a, R, C, T, K>(
    control: Arc<AgentControlClient<R>>,
    retirer: &'a RedisCommandRetirer<C>,
    replay: &'a T,
    terminal: AgentFailureTerminal,
    clock: Arc<K>,
    recovery_config: AgentTerminalRecoveryConfig,
) -> TerminalFuture<'a, Result<AgentFailureTerminalCompletion, AgentFailureTerminalError>>
where
    R: ControlRpc + 'static,
    C: RedisRetirementClient + 'a,
    T: AgentTerminalReplay + 'a,
    K: UnixMillisClock,
{
    Box::pin(async move {
        let AgentFailureTerminal {
            delivery,
            verified,
            output_authority,
            output,
            reservation,
            lease,
            proposed_failure,
        } = terminal;
        let execution_kind = verified.kind();

        let result = async {
            let mut failure = match lease.check_now().await {
                Ok(()) => proposed_failure,
                Err(ClaimLeaseError::Cancelled(_)) => RuntimeFailureKind::Cancelled,
                Err(error) => return Err(AgentFailureTerminalError::Lease(error)),
            };
            let occurred_at_unix_millis = clock.now_unix_millis();
            if occurred_at_unix_millis <= 0 {
                return Err(AgentFailureTerminalError::Clock(
                    "the wall clock cannot publish the agent terminal",
                ));
            }
            if failure != RuntimeFailureKind::Cancelled
                && occurred_at_unix_millis >= verified.command().deadline_unix_millis
            {
                failure = RuntimeFailureKind::DeadlineExceeded;
            }
            let frame = output_authority
                .bind_failure_terminal(&verified, failure, occurred_at_unix_millis)
                .map_err(AgentFailureTerminalError::InvalidDurableState)?;
            let (spool, reopener) = output
                .persist_terminal(&frame)
                .await
                .map_err(AgentFailureTerminalError::Output)?;
            let (acknowledged, frame) = replay_terminal_with_replacement(
                replay,
                &verified,
                frame,
                spool,
                reopener,
                recovery_config.max_output_sessions,
            )
            .await
            .map_err(failure_replay_error)?;
            let failure = restored_terminal_failure_kind(&frame).ok_or(
                AgentFailureTerminalError::InvalidDurableState(ProtocolError::InvalidInput(
                    "the delivered failure terminal is malformed",
                )),
            )?;
            let receipt = control
                .prepare_agent_settlement(acknowledged)
                .await
                .map_err(AgentFailureTerminalError::Settlement)?;
            let settlement_receipt_id = receipt.receipt_id().to_owned();
            retirer
                .retire_agent_command(delivery, &verified, receipt.into())
                .await
                .map_err(AgentFailureTerminalError::Redis)?;
            Ok(AgentFailureTerminalCompletion {
                execution_kind,
                sequence: frame.sequence,
                failure,
                settlement_receipt_id,
            })
        }
        .await;

        if let Err(error) = lease.close().await {
            tracing::warn!(
                error_code = error.code().as_str(),
                "claim lease supervision ended after failure terminal publication"
            );
        }
        drop(reservation);
        result
    })
}

/// Replay and retire one terminal already admitted from an ACCEPTED claim.
///
/// No `BeginExecution`, input, authorization or ADK authority exists on this
/// path. The unique lease actor starts immediately but deliberately does not
/// poll before the exact durable terminal's first output attempt. Only a bound
/// output ACK can mint settlement authority, and only the validated settlement
/// receipt can retire the Redis command.
#[allow(dead_code)] // Enabled only after real TLS output and Redis composition lands.
pub(crate) fn recover_accepted_terminal<'a, R, C, T, K>(
    control: Arc<AgentControlClient<R>>,
    retirer: &'a RedisCommandRetirer<C>,
    replay: &'a T,
    recovery: AcceptedTerminalOutputRecovery,
    clock: Arc<K>,
    lease_config: ClaimLeaseMonitorConfig,
    recovery_config: AgentTerminalRecoveryConfig,
) -> TerminalFuture<'a, Result<AcceptedTerminalRecoveryCompletion, AgentTerminalRecoveryError>>
where
    R: ControlRpc + 'static,
    C: RedisRetirementClient + 'a,
    T: AgentTerminalReplay + 'a,
    K: UnixMillisClock,
{
    Box::pin(async move {
        let (delivery, verified, claim, spool, frame, reopener) = recovery.into_parts();
        let execution_kind = verified.kind();
        let lease =
            ClaimLeaseMonitor::start_recovery(Arc::clone(&control), claim, clock, lease_config);

        let result = async {
            let (acknowledged, frame) = replay_terminal_with_replacement(
                replay,
                &verified,
                frame,
                spool,
                reopener,
                recovery_config.max_output_sessions,
            )
            .await
            .map_err(recovery_replay_error)?;

            let receipt = control
                .prepare_agent_settlement(acknowledged)
                .await
                .map_err(AgentTerminalRecoveryError::Settlement)?;
            let settlement_receipt_id = receipt.receipt_id().to_owned();
            retirer
                .retire_agent_command(delivery, &verified, receipt.into())
                .await
                .map_err(AgentTerminalRecoveryError::Redis)?;
            Ok(AcceptedTerminalRecoveryCompletion {
                execution_kind,
                sequence: frame.sequence,
                settlement_receipt_id,
            })
        }
        .await;

        if let Err(error) = lease.close().await {
            tracing::warn!(
                error_code = error.code().as_str(),
                "claim lease supervision ended after terminal recovery"
            );
        }
        result
    })
}

enum ExactTerminalReplayError {
    InvalidDurableState(ProtocolError),
    Preflight(AgentOutputPreflightError),
    Output(OutputGrpcError),
}

async fn replay_terminal_with_replacement<T: AgentTerminalReplay>(
    replay: &T,
    verified: &VerifiedAgentCommand,
    mut frame: ExecutionOutputFrameV1,
    spool: PreparedOutputSpool,
    mut reopener: AgentOutputSpoolReopener,
    max_output_sessions: usize,
) -> Result<(DurablyAckedTerminal, ExecutionOutputFrameV1), ExactTerminalReplayError> {
    let acknowledged = match replay_exact_terminal(
        replay,
        verified,
        &frame,
        spool,
        &reopener,
        max_output_sessions,
    )
    .await
    {
        Ok(acknowledged) => acknowledged,
        Err(error) => {
            let Some(winner) = output_winner(&error) else {
                return Err(ExactTerminalReplayError::Output(error));
            };
            if restored_terminal_failure_kind(&frame) == Some(winner) {
                return Err(ExactTerminalReplayError::Output(error));
            }
            let fence = frame.fence.as_ref().ok_or({
                ExactTerminalReplayError::Output(OutputGrpcError::Protocol(
                    OutputProtocolError::AuthorizationFailed(
                        "the durable terminal fence is unavailable for replacement",
                    ),
                ))
            })?;
            let replacement = build_agent_terminal_output_frame(
                verified,
                fence,
                AgentTerminalOutput::Failure(winner),
                frame.sequence,
                frame.occurred_at_unix_millis,
                frame.claim_handoff_watermark,
            )
            .map_err(ExactTerminalReplayError::InvalidDurableState)?;
            let replacement_spool = reopener
                .replace_expected_terminal(&frame, &replacement)
                .await
                .map_err(ExactTerminalReplayError::Preflight)?;
            frame = replacement;
            replay_exact_terminal(
                replay,
                verified,
                &frame,
                replacement_spool,
                &reopener,
                max_output_sessions,
            )
            .await
            .map_err(ExactTerminalReplayError::Output)?
        }
    };
    Ok((acknowledged, frame))
}

fn recovery_replay_error(error: ExactTerminalReplayError) -> AgentTerminalRecoveryError {
    match error {
        ExactTerminalReplayError::InvalidDurableState(error) => {
            AgentTerminalRecoveryError::InvalidDurableState(error)
        }
        ExactTerminalReplayError::Preflight(error) => AgentTerminalRecoveryError::Preflight(error),
        ExactTerminalReplayError::Output(error) => AgentTerminalRecoveryError::Output(error),
    }
}

fn failure_replay_error(error: ExactTerminalReplayError) -> AgentFailureTerminalError {
    match error {
        ExactTerminalReplayError::InvalidDurableState(error) => {
            AgentFailureTerminalError::InvalidDurableState(error)
        }
        ExactTerminalReplayError::Preflight(error) => AgentFailureTerminalError::Preflight(error),
        ExactTerminalReplayError::Output(error) => AgentFailureTerminalError::Output(error),
    }
}

#[allow(dead_code)] // Reachable from the gated recovery coordinator above.
async fn replay_exact_terminal<T: AgentTerminalReplay>(
    replay: &T,
    verified: &VerifiedAgentCommand,
    frame: &ExecutionOutputFrameV1,
    first: PreparedOutputSpool,
    reopener: &AgentOutputSpoolReopener,
    max_output_sessions: usize,
) -> Result<DurablyAckedTerminal, OutputGrpcError> {
    let mut first = Some(first);
    for attempt in 0..max_output_sessions {
        let spool = match first.take() {
            Some(spool) => spool,
            None => reopener.reopen().await.map_err(preflight_as_output_error)?,
        };
        match replay.replay_terminal(spool, verified, frame).await {
            Ok(acknowledged) => return Ok(acknowledged),
            Err(error) if attempt + 1 < max_output_sessions && reconnectable_output(&error) => {}
            Err(error) => return Err(error),
        }
    }
    Err(OutputGrpcError::Unavailable(
        "the bounded terminal output replay attempts were exhausted",
    ))
}

#[allow(dead_code)] // Reachable from the gated recovery coordinator above.
const fn output_winner(error: &OutputGrpcError) -> Option<RuntimeFailureKind> {
    match error {
        OutputGrpcError::Protocol(OutputProtocolError::CancellationWon) => {
            Some(RuntimeFailureKind::Cancelled)
        }
        OutputGrpcError::Protocol(OutputProtocolError::DeadlineWon) => {
            Some(RuntimeFailureKind::DeadlineExceeded)
        }
        _ => None,
    }
}

const fn reconnectable_output(error: &OutputGrpcError) -> bool {
    matches!(
        error,
        OutputGrpcError::Unavailable(_)
            | OutputGrpcError::Protocol(OutputProtocolError::DependencyUnavailable)
            | OutputGrpcError::Spool(
                SpoolError::OwnershipUnavailable(_) | SpoolError::Unavailable { .. }
            )
    )
}

#[allow(dead_code)] // Reachable from the gated recovery coordinator above.
fn preflight_as_output_error(error: AgentOutputPreflightError) -> OutputGrpcError {
    match error {
        AgentOutputPreflightError::Output(error) => error,
        AgentOutputPreflightError::InvalidConfiguration(message) => {
            OutputGrpcError::InvalidConfiguration(message)
        }
        AgentOutputPreflightError::InvalidDurableState(message) => {
            OutputGrpcError::Protocol(OutputProtocolError::AuthorizationFailed(message))
        }
        AgentOutputPreflightError::Unavailable(message) => OutputGrpcError::Unavailable(message),
    }
}

/// Shared immutable spool policy for one worker replica.
///
/// The root key is process-owned and shared only for HKDF derivation. Each
/// returned preflight value owns the execution-specific cipher and directory
/// lock; the root key itself is never copied into a command or error.
pub struct AgentOutputPreflight {
    policy: Arc<AgentOutputSpoolPolicy>,
}

impl AgentOutputPreflight {
    #[must_use]
    pub fn new(
        root: PathBuf,
        master_key: SpoolMasterKey,
        spool_limits: SpoolLimits,
        output_config: OutputGrpcConfig,
    ) -> Self {
        Self {
            policy: Arc::new(AgentOutputSpoolPolicy {
                root,
                master_key: Arc::new(master_key),
                spool_limits,
                output_config,
            }),
        }
    }

    /// Inspect one fresh delivery without contacting any runtime endpoint.
    ///
    /// # Errors
    ///
    /// Returns a stable failure for a producer-policy mismatch, unsafe or
    /// corrupt spool, invalid durable frame shape, or blocking-task failure.
    /// No capacity, Begin, input, authorization, or Redis effect occurs.
    pub async fn prepare(
        &self,
        fresh: FreshAgentDelivery,
    ) -> Result<AgentOutputPreflightOutcome, AgentOutputPreflightError> {
        if !fresh.matches_output_transport(
            &self.policy.output_config.workload_session_id,
            &self.policy.output_config.producer_id,
        ) {
            return Err(AgentOutputPreflightError::InvalidConfiguration(
                "the output transport identity does not match the accepted agent claim",
            ));
        }
        let binding = Arc::new(fresh.spool_identity());
        let factory = AgentOutputSpoolFactory {
            policy: Arc::clone(&self.policy),
            binding,
        };
        let mut prepared = factory.reopen().await?;

        let Some(frame) = prepared.pending_replay_frame() else {
            return Ok(AgentOutputPreflightOutcome::Empty(Box::new(
                EmptyAgentOutput {
                    fresh,
                    output: PreparedAgentOutput { prepared, factory },
                },
            )));
        };
        if prepared.pending_frame_count() != 1 || !fresh.matches_output_identity(&frame) {
            return Err(AgentOutputPreflightError::InvalidDurableState(
                "the pending agent output does not match the accepted claim",
            ));
        }
        let kind = fresh.validate_output_frame(&frame).map_err(|_| {
            AgentOutputPreflightError::InvalidDurableState(
                "the pending agent output contract is malformed",
            )
        })?;
        if fresh.matches_output_binding(&frame) {
            return match kind {
                ValidatedAgentOutputFrameKind::Terminal => {
                    let expected_terminal = frame.encode_to_vec();
                    let (delivery, verified, claim) = fresh.into_terminal_recovery_parts();
                    Ok(AgentOutputPreflightOutcome::TerminalRecovery(Box::new(
                        AcceptedTerminalOutputRecovery {
                            delivery,
                            verified,
                            claim,
                            spool: prepared,
                            frame,
                            reopener: factory.seal_terminal(expected_terminal),
                        },
                    )))
                }
                ValidatedAgentOutputFrameKind::Progress => {
                    Ok(AgentOutputPreflightOutcome::RecoveryRequiredNoAck(
                        AgentOutputRecoveryRequiredNoAck {
                            execution_kind: fresh.execution_kind(),
                            kind: AgentOutputRecoveryRequiredKind::PendingProgress,
                            sequence: frame.sequence,
                        },
                    ))
                }
            };
        }
        if kind == ValidatedAgentOutputFrameKind::Progress
            && fresh.claim_handoff_watermark() >= frame.sequence
        {
            let sequence = frame.sequence;
            let reconciled_through = fresh.claim_handoff_watermark();
            tokio::task::spawn_blocking(move || {
                prepared.reconcile_pending_through(reconciled_through)
            })
            .await
            .map_err(|_| {
                AgentOutputPreflightError::Unavailable(
                    "the output spool reconciliation task did not complete",
                )
            })?
            .map_err(AgentOutputPreflightError::Output)?;
            return Ok(AgentOutputPreflightOutcome::RecoveryRequiredNoAck(
                AgentOutputRecoveryRequiredNoAck {
                    execution_kind: fresh.execution_kind(),
                    kind: AgentOutputRecoveryRequiredKind::ReconciledStaleProgress,
                    sequence,
                },
            ));
        }
        Err(AgentOutputPreflightError::InvalidDurableState(
            "the pending agent output does not match the accepted claim",
        ))
    }
}

async fn open_prepared_spool(
    policy: Arc<AgentOutputSpoolPolicy>,
    binding: Arc<crate::spool::ExecutionSpoolIdentity>,
) -> Result<PreparedOutputSpool, AgentOutputPreflightError> {
    tokio::task::spawn_blocking(move || {
        let binding = ExecutionSpoolBinding::new(&binding)?;
        let spool = EncryptedOutputSpool::open(
            &policy.root,
            &policy.master_key,
            &binding,
            policy.spool_limits,
        )?;
        PreparedOutputSpool::prepare(spool, policy.output_config.clone())
    })
    .await
    .map_err(|_| {
        AgentOutputPreflightError::Unavailable("the output spool preflight task did not complete")
    })?
    .map_err(AgentOutputPreflightError::Output)
}

/// Stable, data-free output preflight failures.
#[derive(Debug)]
pub enum AgentOutputPreflightError {
    InvalidConfiguration(&'static str),
    InvalidDurableState(&'static str),
    Output(OutputGrpcError),
    Unavailable(&'static str),
}

impl AgentOutputPreflightError {
    #[must_use]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::InvalidConfiguration(_)
            | Self::Output(OutputGrpcError::InvalidConfiguration(_)) => {
                "agent_output.invalid_configuration"
            }
            Self::InvalidDurableState(_)
            | Self::Output(
                OutputGrpcError::Protocol(_) | OutputGrpcError::Spool(SpoolError::InvalidInput(_)),
            ) => "agent_output.invalid_durable_state",
            Self::Output(OutputGrpcError::Spool(SpoolError::ResourceExhausted(_))) => {
                "agent_output.resource_exhausted"
            }
            Self::Output(OutputGrpcError::Spool(
                SpoolError::OwnershipUnavailable(_) | SpoolError::Unavailable { .. },
            )) => "agent_output.spool_unavailable",
            Self::Output(OutputGrpcError::Unavailable(_)) | Self::Unavailable(_) => {
                "agent_output.unavailable"
            }
        }
    }

    /// Whether retrying later can succeed without changing the command.
    #[must_use]
    pub const fn retryable(&self) -> bool {
        matches!(
            self,
            Self::Output(
                OutputGrpcError::Spool(
                    SpoolError::OwnershipUnavailable(_) | SpoolError::Unavailable { .. },
                ) | OutputGrpcError::Unavailable(_),
            ) | Self::Unavailable(_)
        )
    }
}

impl fmt::Display for AgentOutputPreflightError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidConfiguration(message)
            | Self::InvalidDurableState(message)
            | Self::Unavailable(message) => formatter.write_str(message),
            Self::Output(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for AgentOutputPreflightError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Output(error) => Some(error),
            Self::InvalidConfiguration(_) | Self::InvalidDurableState(_) | Self::Unavailable(_) => {
                None
            }
        }
    }
}

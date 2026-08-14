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
use ring::digest;
use tonic::transport::Channel;

use crate::agents::{AgentExecutionKind, AgentResultArtifact};
use crate::protocol::ProtocolError;
use crate::protocol::command::VerifiedAgentCommand;
use crate::protocol::control::{
    AcceptedTerminalClaimRecovery, AgentControlClient, AgentControlError,
    AgentExecutionOutputCursor, AgentProgressCommit,
};
use crate::protocol::elitea::runtime::v1::{ExecutionOutputFrameV1, NodeEventV1};
use crate::protocol::node_event::encode_current_node_event_json;
use crate::protocol::output::{
    AgentTerminalOutput, RuntimeFailureKind, ValidatedAgentOutputFrameKind,
    build_agent_terminal_output_frame, restored_terminal_failure_kind,
};
use crate::spool::{
    EncryptedOutputSpool, ExecutionSpoolBinding, SpoolError, SpoolLimits, SpoolMasterKey,
};
use crate::transport::output_grpc::{
    FrameBoundProgressRejection, ProgressReplayDecision, ProgressReplaySession,
};
use crate::transport::redis_commands::{
    RedisCommandError, RedisCommandRetirer, RedisRetirementClient,
};
use crate::transport::{
    ControlRpc, DurablyAckedTerminal, OutputGrpcConfig, OutputGrpcError, OutputGrpcSession,
    OutputProtocolError, PreparedOutputSpool,
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

    #[allow(dead_code)] // Consumed by the capability-disabled progress publisher.
    async fn reopen_progress(
        &self,
        expected: &ExecutionOutputFrameV1,
    ) -> Result<ReopenedAgentProgress, AgentOutputPreflightError> {
        let prepared = self.reopen().await?;
        match prepared.pending_frame_count() {
            0 => Ok(ReopenedAgentProgress::Empty(prepared)),
            1 if !expected.terminal && prepared.replays(expected) => {
                Ok(ReopenedAgentProgress::Pending(prepared))
            }
            _ => Err(AgentOutputPreflightError::InvalidDurableState(
                "the pending progress output changed after publication admission",
            )),
        }
    }
}

#[allow(dead_code)] // Consumed by the capability-disabled progress publisher.
enum ReopenedAgentProgress {
    Empty(PreparedOutputSpool),
    Pending(PreparedOutputSpool),
}

/// Bounded complete output-stream attempts for one progress frame.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[allow(dead_code)] // Consumed by the capability-disabled progress publisher.
pub(crate) struct AgentProgressPublisherConfig {
    max_output_sessions: usize,
}

#[allow(dead_code)] // Consumed by the capability-disabled progress publisher.
impl AgentProgressPublisherConfig {
    /// Validate the complete session budget for one exact progress frame.
    ///
    /// # Errors
    ///
    /// Rejects zero and values above the deployed v1 ceiling of eight.
    pub(crate) fn new(max_output_sessions: usize) -> Result<Self, AgentProgressPublishError> {
        if !(MIN_OUTPUT_SESSIONS..=MAX_OUTPUT_SESSIONS).contains(&max_output_sessions) {
            return Err(AgentProgressPublishError::InvalidConfiguration(
                "the progress output session limit is outside the approved range",
            ));
        }
        Ok(Self {
            max_output_sessions,
        })
    }
}

/// Result of publishing one exact progress frame.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[allow(dead_code)] // Consumed by the capability-disabled progress publisher.
pub(crate) enum AgentProgressPublishOutcome {
    Acknowledged { sequence: u64 },
    Rejected { sequence: u64 },
}

/// Stable, data-free progress publication failure.
#[derive(Debug)]
#[allow(dead_code)] // Consumed by the capability-disabled progress publisher.
pub(crate) enum AgentProgressPublishError {
    InvalidConfiguration(&'static str),
    InvalidState(&'static str),
    InvalidFrame(ProtocolError),
    Preflight(AgentOutputPreflightError),
    Output(OutputGrpcError),
}

#[allow(dead_code)] // Consumed by the capability-disabled progress publisher.
impl AgentProgressPublishError {
    #[must_use]
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::InvalidConfiguration(_) => "agent_progress.invalid_configuration",
            Self::InvalidState(_) | Self::InvalidFrame(_) => "agent_progress.invalid_state",
            Self::Preflight(error) => error.code(),
            Self::Output(error) if reconnectable_output(error) => {
                "agent_progress.output_unavailable"
            }
            Self::Output(_) => "agent_progress.output_rejected",
        }
    }

    #[must_use]
    pub(crate) fn retryable(&self) -> bool {
        match self {
            Self::Preflight(error) => error.retryable(),
            Self::Output(error) => reconnectable_output(error),
            Self::InvalidConfiguration(_) | Self::InvalidState(_) | Self::InvalidFrame(_) => false,
        }
    }
}

impl fmt::Display for AgentProgressPublishError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidConfiguration(message) | Self::InvalidState(message) => {
                formatter.write_str(message)
            }
            Self::InvalidFrame(error) => {
                write!(formatter, "the progress frame is invalid: {error}")
            }
            Self::Preflight(error) => write!(formatter, "progress spool recovery failed: {error}"),
            Self::Output(error) => write!(formatter, "progress output delivery failed: {error}"),
        }
    }
}

impl std::error::Error for AgentProgressPublishError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::InvalidFrame(error) => Some(error),
            Self::Preflight(error) => Some(error),
            Self::Output(error) => Some(error),
            Self::InvalidConfiguration(_) | Self::InvalidState(_) => None,
        }
    }
}

/// One live output session used by the bounded progress publisher.
#[async_trait]
#[allow(dead_code)] // Consumed by the capability-disabled progress publisher.
pub(crate) trait AgentProgressSession: Send {
    async fn publish_progress(
        &mut self,
        frame: &ExecutionOutputFrameV1,
    ) -> Result<ProgressReplayDecision, OutputGrpcError>;

    fn take_progress_decision(
        &self,
        frame: &ExecutionOutputFrameV1,
    ) -> Result<Option<ProgressReplayDecision>, OutputGrpcError>;

    async fn close(&mut self) -> Result<(), OutputGrpcError>;
}

#[async_trait]
impl AgentProgressSession for OutputGrpcSession {
    async fn publish_progress(
        &mut self,
        frame: &ExecutionOutputFrameV1,
    ) -> Result<ProgressReplayDecision, OutputGrpcError> {
        match self.send(frame).await {
            Ok(acknowledged) => Ok(ProgressReplayDecision::Acknowledged(acknowledged)),
            Err(error) => match self.take_progress_decision(frame)? {
                Some(decision) => Ok(decision),
                None => Err(error),
            },
        }
    }

    fn take_progress_decision(
        &self,
        frame: &ExecutionOutputFrameV1,
    ) -> Result<Option<ProgressReplayDecision>, OutputGrpcError> {
        OutputGrpcSession::take_progress_decision(self, frame)
    }

    async fn close(&mut self) -> Result<(), OutputGrpcError> {
        OutputGrpcSession::close(self).await
    }
}

/// One owned restored-progress attempt retained across cancelled waits.
#[async_trait]
#[allow(dead_code)] // Consumed by the capability-disabled progress publisher.
pub(crate) trait AgentProgressReplaySession: Send {
    async fn wait(&mut self) -> Result<ProgressReplayDecision, OutputGrpcError>;

    async fn close(&mut self) -> Result<(), OutputGrpcError>;
}

#[async_trait]
impl AgentProgressReplaySession for ProgressReplaySession {
    async fn wait(&mut self) -> Result<ProgressReplayDecision, OutputGrpcError> {
        ProgressReplaySession::wait(self).await
    }

    async fn close(&mut self) -> Result<(), OutputGrpcError> {
        ProgressReplaySession::close(self).await
    }
}

/// Factory for fresh and restored progress sessions.
#[async_trait]
#[allow(dead_code)] // Consumed by the capability-disabled progress publisher.
pub(crate) trait AgentProgressConnector: Send + Sync {
    type Session: AgentProgressSession;
    type Replay: AgentProgressReplaySession;

    async fn connect_progress(
        &self,
        prepared: PreparedOutputSpool,
    ) -> Result<Self::Session, OutputGrpcError>;

    async fn start_progress_replay(
        &self,
        prepared: PreparedOutputSpool,
        expected: &ExecutionOutputFrameV1,
    ) -> Result<Self::Replay, OutputGrpcError>;
}

#[async_trait]
impl AgentProgressConnector for Channel {
    type Session = OutputGrpcSession;
    type Replay = ProgressReplaySession;

    async fn connect_progress(
        &self,
        prepared: PreparedOutputSpool,
    ) -> Result<Self::Session, OutputGrpcError> {
        prepared.connect(self.clone()).await
    }

    async fn start_progress_replay(
        &self,
        prepared: PreparedOutputSpool,
        expected: &ExecutionOutputFrameV1,
    ) -> Result<Self::Replay, OutputGrpcError> {
        prepared.start_progress_replay(self.clone(), expected).await
    }
}

#[allow(dead_code)] // Consumed by the capability-disabled progress publisher.
struct PendingFullMessageArtifact {
    artifact: AgentResultArtifact,
}

#[allow(dead_code)] // Retained for the capability-disabled supervised terminal transition.
struct AckedFullMessageArtifact {
    artifact: AgentResultArtifact,
}

struct PendingAgentProgress {
    frame: ExecutionOutputFrameV1,
    attempts: usize,
    rejection: Option<FrameBoundProgressRejection>,
    full_message: Option<PendingFullMessageArtifact>,
}

#[allow(dead_code)] // Consumed by the capability-disabled progress publisher.
enum LiveAgentProgressSession<S> {
    Ready(S),
    InFlight(S),
}

enum ProgressDrive {
    Continue,
    Complete(AgentProgressPublishOutcome),
}

/// One claim-bound, bounded progress publisher shared by application and ad-hoc.
///
/// The cursor, exact pending frame, live session, encrypted-spool factory and
/// retry budget never separate. A frame is bound and retained synchronously
/// before the first await. Successful streams stay open across events; only an
/// uncertain attempt closes and reopens the exact execution spool.
#[allow(dead_code)] // Consumed by the capability-disabled native lifecycle.
pub(crate) struct FreshAgentProgressPublisher<C: AgentProgressConnector> {
    cursor: AgentExecutionOutputCursor,
    first: Option<PreparedOutputSpool>,
    factory: AgentOutputSpoolFactory,
    connector: C,
    live: Option<LiveAgentProgressSession<C::Session>>,
    replay: Option<C::Replay>,
    replay_result: Option<Result<ProgressReplayDecision, OutputGrpcError>>,
    pending: Option<PendingAgentProgress>,
    acked_full_message: Option<AckedFullMessageArtifact>,
    failed_closed: bool,
    max_output_sessions: usize,
}

#[allow(dead_code)] // Consumed by the capability-disabled native lifecycle.
impl<C: AgentProgressConnector> FreshAgentProgressPublisher<C> {
    pub(crate) fn new(
        cursor: AgentExecutionOutputCursor,
        output: PreparedAgentOutput,
        connector: C,
        config: AgentProgressPublisherConfig,
    ) -> Self {
        let PreparedAgentOutput { prepared, factory } = output;
        Self {
            cursor,
            first: Some(prepared),
            factory,
            connector,
            live: None,
            replay: None,
            replay_result: None,
            pending: None,
            acked_full_message: None,
            failed_closed: false,
            max_output_sessions: config.max_output_sessions,
        }
    }

    /// Bind and durably publish one browser-compatible `NodeEvent`.
    ///
    /// # Errors
    ///
    /// Returns a stable error without replacing or discarding a previously
    /// pending frame. Retryable uncertainty retains its exact canonical bytes
    /// for [`Self::resume_pending`].
    pub(crate) async fn publish(
        &mut self,
        verified: &VerifiedAgentCommand,
        event: NodeEventV1,
        occurred_at_unix_millis: i64,
    ) -> Result<AgentProgressPublishOutcome, AgentProgressPublishError> {
        if self.failed_closed {
            return Err(AgentProgressPublishError::InvalidState(
                "the progress publisher failed closed after a nonretryable outcome",
            ));
        }
        if self.pending.is_some() {
            return Err(AgentProgressPublishError::InvalidState(
                "the progress publisher already owns a pending frame",
            ));
        }
        if event.r#type == "full_message" {
            return Err(AgentProgressPublishError::InvalidState(
                "the full message requires the terminal artifact publication path",
            ));
        }
        self.publish_event(verified, event, occurred_at_unix_millis, None)
            .await
    }

    /// Publish the sole result-bearing `full_message` event.
    ///
    /// The exact canonical browser JSON is hashed before the first await. Only
    /// the bound durable ACK promotes that candidate into terminal-result
    /// authority retained inside this publisher.
    pub(super) async fn publish_full_message(
        &mut self,
        verified: &VerifiedAgentCommand,
        event: NodeEventV1,
        occurred_at_unix_millis: i64,
    ) -> Result<AgentProgressPublishOutcome, AgentProgressPublishError> {
        if self.failed_closed {
            return Err(AgentProgressPublishError::InvalidState(
                "the progress publisher failed closed after a nonretryable outcome",
            ));
        }
        if self.pending.is_some() {
            return Err(AgentProgressPublishError::InvalidState(
                "the progress publisher already owns a pending frame",
            ));
        }
        if self.acked_full_message.is_some() {
            return Err(AgentProgressPublishError::InvalidState(
                "the durably acknowledged full message must remain the last progress event",
            ));
        }
        if event.r#type != "full_message" {
            return Err(AgentProgressPublishError::InvalidState(
                "the terminal artifact path requires a full_message event",
            ));
        }
        let artifact = result_artifact_for_event(verified, &event)
            .map_err(AgentProgressPublishError::InvalidFrame)?;
        self.publish_event(
            verified,
            event,
            occurred_at_unix_millis,
            Some(PendingFullMessageArtifact { artifact }),
        )
        .await
    }

    async fn publish_event(
        &mut self,
        verified: &VerifiedAgentCommand,
        event: NodeEventV1,
        occurred_at_unix_millis: i64,
        full_message: Option<PendingFullMessageArtifact>,
    ) -> Result<AgentProgressPublishOutcome, AgentProgressPublishError> {
        if self.failed_closed {
            return Err(AgentProgressPublishError::InvalidState(
                "the progress publisher failed closed after a nonretryable outcome",
            ));
        }
        if self.pending.is_some() {
            return Err(AgentProgressPublishError::InvalidState(
                "the progress publisher already owns a pending frame",
            ));
        }
        if self.acked_full_message.is_some() {
            return Err(AgentProgressPublishError::InvalidState(
                "the durably acknowledged full message must remain the last progress event",
            ));
        }
        let progress = self
            .cursor
            .bind_progress(verified, event, occurred_at_unix_millis)
            .map_err(AgentProgressPublishError::InvalidFrame)?;
        self.pending = Some(PendingAgentProgress {
            frame: progress.into_frame(),
            attempts: 0,
            rejection: None,
            full_message,
        });
        self.drive_retained_progress().await
    }

    /// Resume only the exact frame retained after retryable uncertainty.
    ///
    /// # Errors
    ///
    /// Returns a stable invalid-state error when no unresolved frame exists.
    pub(crate) async fn resume_pending(
        &mut self,
    ) -> Result<AgentProgressPublishOutcome, AgentProgressPublishError> {
        if self.failed_closed {
            return Err(AgentProgressPublishError::InvalidState(
                "the progress publisher failed closed after a nonretryable outcome",
            ));
        }
        if self.pending.is_none() {
            return Err(AgentProgressPublishError::InvalidState(
                "the progress publisher has no pending frame",
            ));
        }
        self.drive_retained_progress().await
    }

    async fn drive_retained_progress(
        &mut self,
    ) -> Result<AgentProgressPublishOutcome, AgentProgressPublishError> {
        let result = self.deliver_pending().await;
        if result.as_ref().is_err_and(|error| !error.retryable()) {
            self.failed_closed = true;
        }
        result
    }

    async fn deliver_pending(
        &mut self,
    ) -> Result<AgentProgressPublishOutcome, AgentProgressPublishError> {
        loop {
            if let Some(outcome) = self.finish_rejected_progress().await? {
                return Ok(outcome);
            }
            if self.replay.is_some() {
                match self.drive_replay().await? {
                    ProgressDrive::Continue => continue,
                    ProgressDrive::Complete(outcome) => return Ok(outcome),
                }
            }
            if self.live.is_none() {
                self.start_next_session().await?;
                continue;
            }
            if let ProgressDrive::Complete(outcome) = self.drive_live().await? {
                return Ok(outcome);
            }
        }
    }

    async fn finish_rejected_progress(
        &mut self,
    ) -> Result<Option<AgentProgressPublishOutcome>, AgentProgressPublishError> {
        if self
            .pending
            .as_ref()
            .is_none_or(|pending| pending.rejection.is_none())
        {
            return Ok(None);
        }
        self.close_live().await;
        let sequence = self
            .pending
            .as_ref()
            .ok_or(AgentProgressPublishError::InvalidState(
                "the progress publisher lost its rejected frame",
            ))?
            .frame
            .sequence;
        Ok(Some(AgentProgressPublishOutcome::Rejected { sequence }))
    }

    async fn drive_replay(&mut self) -> Result<ProgressDrive, AgentProgressPublishError> {
        if self.replay_result.is_none() {
            let result = self
                .replay
                .as_mut()
                .ok_or(AgentProgressPublishError::InvalidState(
                    "the progress publisher lost its replay session",
                ))?
                .wait()
                .await;
            self.replay_result = Some(result);
            return Ok(ProgressDrive::Continue);
        }

        let close = self
            .replay
            .as_mut()
            .ok_or(AgentProgressPublishError::InvalidState(
                "the progress publisher lost its replay session",
            ))?
            .close()
            .await;
        self.replay = None;
        let result = self
            .replay_result
            .take()
            .ok_or(AgentProgressPublishError::InvalidState(
                "the progress publisher lost its replay result",
            ))?;
        match result {
            Ok(decision) => {
                if close.is_err() {
                    tracing::warn!(
                        "progress replay stream close failed after a bound Main decision"
                    );
                }
                self.commit_progress_decision(decision)
                    .map(ProgressDrive::Complete)
            }
            Err(error) if self.can_retry(&error) => {
                if close.is_err() {
                    tracing::warn!(
                        "progress replay stream close failed after delivery uncertainty"
                    );
                }
                Ok(ProgressDrive::Continue)
            }
            Err(error) => Err(AgentProgressPublishError::Output(error)),
        }
    }

    async fn start_next_session(&mut self) -> Result<(), AgentProgressPublishError> {
        if self
            .pending
            .as_ref()
            .is_some_and(|pending| pending.attempts >= self.max_output_sessions)
        {
            return Err(AgentProgressPublishError::Output(
                OutputGrpcError::Unavailable("the bounded progress output attempts were exhausted"),
            ));
        }
        let expected = &self
            .pending
            .as_ref()
            .ok_or(AgentProgressPublishError::InvalidState(
                "the progress publisher lost its pending frame",
            ))?
            .frame;
        let reopened = match self.first.take() {
            Some(prepared) => ReopenedAgentProgress::Empty(prepared),
            None => self
                .factory
                .reopen_progress(expected)
                .await
                .map_err(AgentProgressPublishError::Preflight)?,
        };
        let pending = self
            .pending
            .as_mut()
            .ok_or(AgentProgressPublishError::InvalidState(
                "the progress publisher lost its pending frame",
            ))?;
        pending.attempts += 1;
        let result = match reopened {
            ReopenedAgentProgress::Empty(prepared) => {
                match self.connector.connect_progress(prepared).await {
                    Ok(session) => {
                        self.live = Some(LiveAgentProgressSession::Ready(session));
                        return Ok(());
                    }
                    Err(error) => error,
                }
            }
            ReopenedAgentProgress::Pending(prepared) => {
                match self
                    .connector
                    .start_progress_replay(prepared, &pending.frame)
                    .await
                {
                    Ok(replay) => {
                        self.replay = Some(replay);
                        return Ok(());
                    }
                    Err(error) => error,
                }
            }
        };
        if self.can_retry(&result) {
            Ok(())
        } else {
            Err(AgentProgressPublishError::Output(result))
        }
    }

    async fn drive_live(&mut self) -> Result<ProgressDrive, AgentProgressPublishError> {
        if matches!(self.live, Some(LiveAgentProgressSession::InFlight(_))) {
            return match self.recover_inflight_decision().await? {
                Some(decision) => self
                    .commit_progress_decision(decision)
                    .map(ProgressDrive::Complete),
                None => Ok(ProgressDrive::Continue),
            };
        }

        let pending = self
            .pending
            .as_mut()
            .ok_or(AgentProgressPublishError::InvalidState(
                "the progress publisher lost its pending frame",
            ))?;
        if pending.attempts == 0 {
            pending.attempts = 1;
        }
        let Some(LiveAgentProgressSession::Ready(session)) = self.live.take() else {
            return Err(AgentProgressPublishError::InvalidState(
                "the progress publisher lost its ready output session",
            ));
        };
        self.live = Some(LiveAgentProgressSession::InFlight(session));
        let decision = match self.live.as_mut() {
            Some(LiveAgentProgressSession::InFlight(session)) => {
                session.publish_progress(&pending.frame).await
            }
            Some(LiveAgentProgressSession::Ready(_)) | None => {
                return Err(AgentProgressPublishError::InvalidState(
                    "the progress publisher lost its in-flight output session",
                ));
            }
        };
        match decision {
            Ok(ProgressReplayDecision::Acknowledged(acknowledged)) => {
                let Some(LiveAgentProgressSession::InFlight(session)) = self.live.take() else {
                    return Err(AgentProgressPublishError::InvalidState(
                        "the progress publisher lost its acknowledged output session",
                    ));
                };
                self.live = Some(LiveAgentProgressSession::Ready(session));
                self.commit_progress_decision(ProgressReplayDecision::Acknowledged(acknowledged))
                    .map(ProgressDrive::Complete)
            }
            Ok(ProgressReplayDecision::Rejected(rejected)) => {
                let outcome =
                    self.commit_progress_decision(ProgressReplayDecision::Rejected(rejected))?;
                self.close_live().await;
                Ok(ProgressDrive::Complete(outcome))
            }
            Err(error) => {
                self.close_live().await;
                if self.can_retry(&error) {
                    Ok(ProgressDrive::Continue)
                } else {
                    Err(AgentProgressPublishError::Output(error))
                }
            }
        }
    }

    fn can_retry(&self, error: &OutputGrpcError) -> bool {
        reconnectable_output(error)
            && self
                .pending
                .as_ref()
                .is_some_and(|pending| pending.attempts < self.max_output_sessions)
    }

    fn commit_progress_decision(
        &mut self,
        decision: ProgressReplayDecision,
    ) -> Result<AgentProgressPublishOutcome, AgentProgressPublishError> {
        let sequence = self
            .pending
            .as_ref()
            .ok_or(AgentProgressPublishError::InvalidState(
                "the progress publisher lost its pending frame",
            ))?
            .frame
            .sequence;
        match decision {
            ProgressReplayDecision::Acknowledged(acknowledged) => {
                match self.cursor.commit_progress_durable(acknowledged) {
                    Ok(AgentProgressCommit::Advanced) => {
                        let pending =
                            self.pending
                                .take()
                                .ok_or(AgentProgressPublishError::InvalidState(
                                    "the progress publisher lost its acknowledged frame",
                                ))?;
                        self.acked_full_message =
                            pending
                                .full_message
                                .map(|pending| AckedFullMessageArtifact {
                                    artifact: pending.artifact,
                                });
                        Ok(AgentProgressPublishOutcome::Acknowledged { sequence })
                    }
                    Ok(AgentProgressCommit::Exhausted(error)) => {
                        self.pending = None;
                        self.failed_closed = true;
                        Err(AgentProgressPublishError::InvalidFrame(error))
                    }
                    Err(error) => Err(AgentProgressPublishError::InvalidFrame(error)),
                }
            }
            ProgressReplayDecision::Rejected(rejected) => {
                let pending =
                    self.pending
                        .as_mut()
                        .ok_or(AgentProgressPublishError::InvalidState(
                            "the progress publisher lost its pending frame",
                        ))?;
                pending.rejection = Some(rejected);
                Ok(AgentProgressPublishOutcome::Rejected { sequence })
            }
        }
    }

    async fn close_live(&mut self) {
        if let Some(session) = self.live.as_mut() {
            let session = match session {
                LiveAgentProgressSession::Ready(session)
                | LiveAgentProgressSession::InFlight(session) => session,
            };
            if session.close().await.is_err() {
                tracing::warn!("progress output session close failed after delivery uncertainty");
            }
        }
        self.live = None;
    }

    async fn recover_inflight_decision(
        &mut self,
    ) -> Result<Option<ProgressReplayDecision>, AgentProgressPublishError> {
        let frame = &self
            .pending
            .as_ref()
            .ok_or(AgentProgressPublishError::InvalidState(
                "the progress publisher lost its in-flight frame",
            ))?
            .frame;
        let Some(LiveAgentProgressSession::InFlight(session)) = self.live.as_mut() else {
            return Err(AgentProgressPublishError::InvalidState(
                "the progress publisher has no in-flight output session",
            ));
        };
        let close = session.close().await;
        let decision = session
            .take_progress_decision(frame)
            .map_err(AgentProgressPublishError::Output)?;
        self.live = None;
        if decision.is_none() && close.is_err() {
            tracing::warn!("progress output session closed without a retained bound decision");
        }
        Ok(decision)
    }

    #[cfg(test)]
    pub(super) fn into_test_acked_full_message(self) -> Option<AgentResultArtifact> {
        self.acked_full_message.map(|proof| proof.artifact)
    }
}

fn result_artifact_for_event(
    verified: &VerifiedAgentCommand,
    event: &NodeEventV1,
) -> Result<AgentResultArtifact, ProtocolError> {
    if event.r#type != "full_message" {
        return Err(ProtocolError::InvalidInput(
            "the result artifact requires a full_message event",
        ));
    }
    let browser_json = encode_current_node_event_json(event)?;
    let value = digest::digest(&digest::SHA256, &browser_json);
    let mut sha256 = [0_u8; 32];
    sha256.copy_from_slice(value.as_ref());
    let byte_length = u64::try_from(browser_json.len()).map_err(|_| {
        ProtocolError::ResourceExhausted("the full message exceeds the artifact length limit")
    })?;
    Ok(AgentResultArtifact {
        artifact_id: format!(
            "node-event:{}:full-message",
            verified.command().execution_id
        ),
        immutable_version: sha256_version(&sha256),
        byte_length,
        digest: sha256,
    })
}

fn sha256_version(digest: &[u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut version = String::with_capacity(7 + 64);
    version.push_str("sha256:");
    for byte in digest {
        version.push(char::from(HEX[usize::from(byte >> 4)]));
        version.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    version
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
    let (terminal, reservation) = terminal.into_failure_terminal();
    Box::pin(async move {
        let result = publish_agent_failure_terminal(
            control,
            retirer,
            replay,
            terminal,
            clock,
            recovery_config,
        )
        .await;
        drop(reservation);
        result
    })
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

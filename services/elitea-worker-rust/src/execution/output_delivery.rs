//! No-network encrypted output preflight for fresh agent deliveries.
//!
//! The exact execution spool is opened, exclusively locked, decrypted and
//! restored on Tokio's blocking pool before capacity reservation, Begin, input
//! materialization, or invocation authorization can occur. A pending frame is
//! routed to recovery and can never be converted into fresh business input.

use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;

use prost::Message;

use crate::agents::AgentExecutionKind;
use crate::protocol::command::VerifiedAgentCommand;
use crate::protocol::control::AcceptedTerminalClaimRecovery;
use crate::protocol::elitea::runtime::v1::ExecutionOutputFrameV1;
use crate::protocol::output::ValidatedAgentOutputFrameKind;
use crate::spool::{
    EncryptedOutputSpool, ExecutionSpoolBinding, SpoolError, SpoolLimits, SpoolMasterKey,
};
use crate::transport::{OutputGrpcConfig, OutputGrpcError, PreparedOutputSpool};

use super::agent_delivery::FreshAgentDelivery;

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
    spool: PreparedOutputSpool,
}

impl EmptyAgentOutput {
    #[must_use]
    pub const fn execution_kind(&self) -> AgentExecutionKind {
        self.fresh.execution_kind()
    }

    pub(crate) fn into_parts(self) -> (FreshAgentDelivery, PreparedOutputSpool) {
        (self.fresh, self.spool)
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

/// Sealed execution-bound spool factory retained across bounded reconnects.
pub(crate) struct AgentOutputSpoolReopener {
    policy: Arc<AgentOutputSpoolPolicy>,
    binding: Arc<crate::spool::ExecutionSpoolIdentity>,
    expected_terminal: Vec<u8>,
}

impl AgentOutputSpoolReopener {
    #[allow(dead_code)] // Used by the next bounded reconnect slice.
    pub(crate) async fn reopen(&self) -> Result<PreparedOutputSpool, AgentOutputPreflightError> {
        let prepared =
            open_prepared_spool(Arc::clone(&self.policy), Arc::clone(&self.binding)).await?;
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
        let mut prepared =
            open_prepared_spool(Arc::clone(&self.policy), Arc::clone(&binding)).await?;

        let Some(frame) = prepared.pending_replay_frame() else {
            return Ok(AgentOutputPreflightOutcome::Empty(Box::new(
                EmptyAgentOutput {
                    fresh,
                    spool: prepared,
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
                            reopener: AgentOutputSpoolReopener {
                                policy: Arc::clone(&self.policy),
                                binding,
                                expected_terminal,
                            },
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

//! No-network encrypted output preflight for fresh agent deliveries.
//!
//! The exact execution spool is opened, exclusively locked, decrypted and
//! restored on Tokio's blocking pool before capacity reservation, Begin, input
//! materialization, or invocation authorization can occur. A pending frame is
//! routed to recovery and can never be converted into fresh business input.

use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;

use crate::agents::AgentExecutionKind;
use crate::protocol::elitea::runtime::v1::{ExecutionOutputEventTypeV1, execution_output_frame_v1};
use crate::spool::{
    EncryptedOutputSpool, ExecutionSpoolBinding, SpoolError, SpoolLimits, SpoolMasterKey,
};
use crate::transport::{OutputGrpcConfig, OutputGrpcError, PreparedOutputSpool};

use super::agent_delivery::FreshAgentDelivery;

/// Stable preflight outcome category without exposing durable frame contents.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AgentOutputPreflightKind {
    Empty,
    Pending,
}

/// Shape of the sole current-profile unacknowledged agent frame.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PendingAgentOutputKind {
    Progress,
    Terminal,
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

/// Pending durable output which must recover before any fresh execution work.
pub struct PendingAgentOutput {
    fresh: FreshAgentDelivery,
    spool: PreparedOutputSpool,
    kind: PendingAgentOutputKind,
    sequence: u64,
}

impl PendingAgentOutput {
    #[must_use]
    pub const fn execution_kind(&self) -> AgentExecutionKind {
        self.fresh.execution_kind()
    }

    #[must_use]
    pub const fn kind(&self) -> PendingAgentOutputKind {
        self.kind
    }

    #[must_use]
    pub const fn sequence(&self) -> u64 {
        self.sequence
    }

    #[allow(dead_code)] // Consumed by the next exact output-recovery slice.
    pub(crate) fn into_parts(self) -> (FreshAgentDelivery, PreparedOutputSpool) {
        (self.fresh, self.spool)
    }
}

/// Closed result of inspecting the current execution's durable output.
pub enum AgentOutputPreflightOutcome {
    Empty(Box<EmptyAgentOutput>),
    Pending(Box<PendingAgentOutput>),
}

impl AgentOutputPreflightOutcome {
    #[must_use]
    pub const fn kind(&self) -> AgentOutputPreflightKind {
        match self {
            Self::Empty(_) => AgentOutputPreflightKind::Empty,
            Self::Pending(_) => AgentOutputPreflightKind::Pending,
        }
    }
}

/// Shared immutable spool policy for one worker replica.
///
/// The root key is process-owned and shared only for HKDF derivation. Each
/// returned preflight value owns the execution-specific cipher and directory
/// lock; the root key itself is never copied into a command or error.
pub struct AgentOutputPreflight {
    root: PathBuf,
    master_key: Arc<SpoolMasterKey>,
    spool_limits: SpoolLimits,
    output_config: OutputGrpcConfig,
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
            root,
            master_key: Arc::new(master_key),
            spool_limits,
            output_config,
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
            &self.output_config.workload_session_id,
            &self.output_config.producer_id,
        ) {
            return Err(AgentOutputPreflightError::InvalidConfiguration(
                "the output transport identity does not match the accepted agent claim",
            ));
        }
        let binding = fresh.spool_identity();
        let root = self.root.clone();
        let master_key = Arc::clone(&self.master_key);
        let limits = self.spool_limits;
        let output_config = self.output_config.clone();
        let prepared = tokio::task::spawn_blocking(move || {
            let binding = ExecutionSpoolBinding::new(&binding)?;
            let spool = EncryptedOutputSpool::open(&root, &master_key, &binding, limits)?;
            PreparedOutputSpool::prepare(spool, output_config)
        })
        .await
        .map_err(|_| {
            AgentOutputPreflightError::Unavailable(
                "the output spool preflight task did not complete",
            )
        })?
        .map_err(AgentOutputPreflightError::Output)?;

        let Some(frame) = prepared.pending_replay_frame() else {
            return Ok(AgentOutputPreflightOutcome::Empty(Box::new(
                EmptyAgentOutput {
                    fresh,
                    spool: prepared,
                },
            )));
        };
        if prepared.pending_frame_count() != 1 || !fresh.matches_output_binding(&frame) {
            return Err(AgentOutputPreflightError::InvalidDurableState(
                "the pending agent output does not match the accepted claim",
            ));
        }
        let kind = pending_kind(&frame)?;
        Ok(AgentOutputPreflightOutcome::Pending(Box::new(
            PendingAgentOutput {
                fresh,
                spool: prepared,
                kind,
                sequence: frame.sequence,
            },
        )))
    }
}

fn pending_kind(
    frame: &crate::protocol::elitea::runtime::v1::ExecutionOutputFrameV1,
) -> Result<PendingAgentOutputKind, AgentOutputPreflightError> {
    match (
        frame.terminal,
        ExecutionOutputEventTypeV1::try_from(frame.event_type).ok(),
        frame.payload.as_ref(),
        frame.settlement_proposal.is_some(),
    ) {
        (
            false,
            Some(ExecutionOutputEventTypeV1::NodeEvent),
            Some(execution_output_frame_v1::Payload::NodeEvent(_)),
            false,
        ) => Ok(PendingAgentOutputKind::Progress),
        (
            true,
            Some(ExecutionOutputEventTypeV1::AgentExecutionResult),
            Some(execution_output_frame_v1::Payload::AgentExecution(_)),
            true,
        )
        | (
            true,
            Some(ExecutionOutputEventTypeV1::RuntimeError),
            Some(execution_output_frame_v1::Payload::RuntimeError(_)),
            true,
        ) => Ok(PendingAgentOutputKind::Terminal),
        _ => Err(AgentOutputPreflightError::InvalidDurableState(
            "the pending agent output shape is not recoverable",
        )),
    }
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

use std::fmt;

use crate::agents::AgentExecutionKind;
use crate::protocol::ProtocolError;
use crate::protocol::command::{
    SignedCommandAuthenticator, VerifiedAgentCommand, parse_and_verify_agent_command,
};
use crate::protocol::control::{
    AcceptedAgentClaim, AgentClaimDecision, AgentControlClient, AgentControlError,
    AgentOutputRecovery, AgentOutputRecoveryKind, RecoveredSettlement, TerminalRedeliveryKind,
};
use crate::protocol::elitea::runtime::v1::ExecutionOutcomeV1;
use crate::spool::ExecutionSpoolIdentity;
use crate::transport::ControlRpc;
use crate::transport::redis_commands::{
    RedisCommandDelivery, RedisCommandError, RedisCommandRetirer, RedisRetirementClient,
};

/// Stable failure categories for the shared application/ad-hoc delivery route.
#[derive(Debug)]
pub enum AgentDeliveryError {
    Protocol(ProtocolError),
    Control(AgentControlError),
    Retirement(RedisCommandError),
}

impl fmt::Display for AgentDeliveryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Protocol(error) => error.fmt(formatter),
            Self::Control(error) => error.fmt(formatter),
            Self::Retirement(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for AgentDeliveryError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Protocol(error) => Some(error),
            Self::Control(error) => Some(error),
            Self::Retirement(error) => Some(error),
        }
    }
}

impl From<ProtocolError> for AgentDeliveryError {
    fn from(value: ProtocolError) -> Self {
        Self::Protocol(value)
    }
}

impl From<AgentControlError> for AgentDeliveryError {
    fn from(value: AgentControlError) -> Self {
        Self::Control(value)
    }
}

impl From<RedisCommandError> for AgentDeliveryError {
    fn from(value: RedisCommandError) -> Self {
        Self::Retirement(value)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AgentDeliveryRouteKind {
    Fresh,
    OutputRecovery,
    RetryLaterNoAck,
    Completed,
}

/// An exact verified delivery and accepted claim retained for the future
/// `BeginExecution` stage.
///
/// Its fields remain private so later execution stages cannot bypass the
/// shared router or manufacture fresh business-input authority.
pub struct FreshAgentDelivery {
    delivery: RedisCommandDelivery,
    verified: VerifiedAgentCommand,
    claim_handoff_watermark: u64,
    claim: AcceptedAgentClaim,
}

impl FreshAgentDelivery {
    #[must_use]
    pub const fn execution_kind(&self) -> AgentExecutionKind {
        self.verified.kind()
    }

    #[must_use]
    pub const fn claim_handoff_watermark(&self) -> u64 {
        self.claim_handoff_watermark
    }

    pub(crate) fn into_parts(
        self,
    ) -> (
        RedisCommandDelivery,
        VerifiedAgentCommand,
        AcceptedAgentClaim,
    ) {
        (self.delivery, self.verified, self.claim)
    }

    #[must_use]
    pub(crate) fn spool_identity(&self) -> ExecutionSpoolIdentity {
        let command = self.verified.command();
        ExecutionSpoolIdentity {
            tenant_id: command.tenant_id.clone(),
            resource_project_id: command.resource_project_id.clone(),
            projection_project_id: command.projection_project_id.clone(),
            command_id: command.command_id.clone(),
            execution_id: command.execution_id.clone(),
            generation: command.generation,
            producer_id: self.claim.producer_id().to_owned(),
        }
    }

    #[must_use]
    pub(crate) fn matches_output_transport(
        &self,
        workload_session_id: &str,
        producer_id: &str,
    ) -> bool {
        self.claim
            .matches_output_transport(workload_session_id, producer_id)
    }

    #[must_use]
    pub(crate) fn matches_output_binding(
        &self,
        frame: &crate::protocol::elitea::runtime::v1::ExecutionOutputFrameV1,
    ) -> bool {
        self.claim.matches_output_binding(
            frame.identity.as_ref(),
            frame.fence.as_ref(),
            frame.claim_handoff_watermark,
        )
    }
}

#[cfg(test)]
pub(crate) fn test_fresh_agent_delivery(
    delivery: RedisCommandDelivery,
    verified: VerifiedAgentCommand,
    claim: AcceptedAgentClaim,
) -> FreshAgentDelivery {
    FreshAgentDelivery {
        delivery,
        claim_handoff_watermark: claim.claim_handoff_watermark(),
        verified,
        claim,
    }
}

/// An input-free redelivery which may only inspect and recover durable output.
pub struct OutputRecoveryAgentDelivery {
    _delivery: RedisCommandDelivery,
    verified: VerifiedAgentCommand,
    recovery: AgentOutputRecovery,
}

impl OutputRecoveryAgentDelivery {
    #[must_use]
    pub const fn execution_kind(&self) -> AgentExecutionKind {
        self.verified.kind()
    }

    #[must_use]
    pub const fn recovery_kind(&self) -> AgentOutputRecoveryKind {
        self.recovery.kind()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AgentDeliveryCompletionKind {
    TerminalRedelivery(TerminalRedeliveryKind),
    RecoveredTerminalSettlement,
    RecoveredSettlement,
}

/// Non-authoritative summary emitted only after atomic Redis retirement.
#[derive(Debug, Eq, PartialEq)]
pub struct AgentDeliveryCompletion {
    kind: AgentDeliveryCompletionKind,
    settlement_receipt_id: Option<String>,
    settlement_outcome: Option<ExecutionOutcomeV1>,
}

impl AgentDeliveryCompletion {
    #[must_use]
    pub const fn kind(&self) -> AgentDeliveryCompletionKind {
        self.kind
    }

    #[must_use]
    pub fn settlement_receipt_id(&self) -> Option<&str> {
        self.settlement_receipt_id.as_deref()
    }

    #[must_use]
    pub const fn settlement_outcome(&self) -> Option<ExecutionOutcomeV1> {
        self.settlement_outcome
    }
}

/// Closed result of routing all ten authenticated agent claim dispositions.
pub enum AgentDeliveryRoute {
    Fresh(Box<FreshAgentDelivery>),
    OutputRecovery(Box<OutputRecoveryAgentDelivery>),
    RetryLaterNoAck,
    Completed(AgentDeliveryCompletion),
}

impl AgentDeliveryRoute {
    #[must_use]
    pub const fn kind(&self) -> AgentDeliveryRouteKind {
        match self {
            Self::Fresh(_) => AgentDeliveryRouteKind::Fresh,
            Self::OutputRecovery(_) => AgentDeliveryRouteKind::OutputRecovery,
            Self::RetryLaterNoAck => AgentDeliveryRouteKind::RetryLaterNoAck,
            Self::Completed(_) => AgentDeliveryRouteKind::Completed,
        }
    }
}

/// Shared application/ad-hoc pre-execution lifecycle owner.
///
/// This is not whole-delivery or invocation admission. It intentionally stops
/// before capacity reservation, input materialization, output-spool recovery,
/// `BeginExecution`, and ADK invocation. It does fully own terminal redelivery
/// ordering: Claim -> optional `PrepareSettlement` -> atomic Redis retirement.
/// No terminal route can return success before retirement.
pub struct AgentDeliveryRouter<R, C> {
    control: AgentControlClient<R>,
    retirer: RedisCommandRetirer<C>,
}

impl<R, C> AgentDeliveryRouter<R, C> {
    #[must_use]
    pub const fn new(control: AgentControlClient<R>, retirer: RedisCommandRetirer<C>) -> Self {
        Self { control, retirer }
    }
}

impl<R, C> AgentDeliveryRouter<R, C>
where
    R: ControlRpc,
    C: RedisRetirementClient,
{
    /// Verify, claim, and route one agent delivery without conflating fresh
    /// execution authority with recovery or terminal retirement authority.
    ///
    /// # Errors
    ///
    /// Returns a typed protocol, control, or retirement failure. A failure or
    /// no-ACK route never calls a generic Redis ACK/delete operation.
    pub async fn route(
        &self,
        delivery: RedisCommandDelivery,
        authenticator: &dyn SignedCommandAuthenticator,
        now_unix_millis: i64,
    ) -> Result<AgentDeliveryRoute, AgentDeliveryError> {
        let verified =
            parse_and_verify_agent_command(delivery.signed_envelope(), Some(authenticator))?;
        let decision = self
            .control
            .claim_agent_delivery(&verified, now_unix_millis)
            .await?;
        match decision {
            AgentClaimDecision::Accepted(claim) => {
                Ok(AgentDeliveryRoute::Fresh(Box::new(FreshAgentDelivery {
                    delivery,
                    verified,
                    claim_handoff_watermark: claim.claim_handoff_watermark(),
                    claim: *claim,
                })))
            }
            AgentClaimDecision::ActiveLeaseNoAck(recovery)
            | AgentClaimDecision::RecoverRunningNoAck(recovery)
            | AgentClaimDecision::RecoverAmbiguousInvocationNoAck(recovery) => Ok(
                AgentDeliveryRoute::OutputRecovery(Box::new(OutputRecoveryAgentDelivery {
                    _delivery: delivery,
                    verified,
                    recovery,
                })),
            ),
            AgentClaimDecision::RetryLaterNoAck(_) => Ok(AgentDeliveryRoute::RetryLaterNoAck),
            AgentClaimDecision::SettledAck(authority)
            | AgentClaimDecision::ObsoleteAck(authority)
            | AgentClaimDecision::RetiredAck(authority) => {
                let kind = authority.kind();
                self.retirer
                    .retire_agent_command(delivery, &verified, authority.into())
                    .await?;
                Ok(AgentDeliveryRoute::Completed(AgentDeliveryCompletion {
                    kind: AgentDeliveryCompletionKind::TerminalRedelivery(kind),
                    settlement_receipt_id: None,
                    settlement_outcome: None,
                }))
            }
            AgentClaimDecision::RecoverTerminalAck(recovery) => {
                let receipt = self
                    .control
                    .prepare_recovered_agent_settlement(recovery)
                    .await?;
                let completion = settlement_completion(
                    AgentDeliveryCompletionKind::RecoveredTerminalSettlement,
                    &receipt,
                );
                self.retirer
                    .retire_agent_command(delivery, &verified, receipt.into())
                    .await?;
                Ok(AgentDeliveryRoute::Completed(completion))
            }
            AgentClaimDecision::RecoverSettlement(receipt) => {
                let completion = recovered_settlement_completion(&receipt);
                self.retirer
                    .retire_agent_command(delivery, &verified, receipt.into())
                    .await?;
                Ok(AgentDeliveryRoute::Completed(completion))
            }
        }
    }
}

fn settlement_completion(
    kind: AgentDeliveryCompletionKind,
    receipt: &crate::protocol::control::SettlementReceipt,
) -> AgentDeliveryCompletion {
    AgentDeliveryCompletion {
        kind,
        settlement_receipt_id: Some(receipt.receipt_id().to_owned()),
        settlement_outcome: Some(receipt.outcome()),
    }
}

fn recovered_settlement_completion(receipt: &RecoveredSettlement) -> AgentDeliveryCompletion {
    AgentDeliveryCompletion {
        kind: AgentDeliveryCompletionKind::RecoveredSettlement,
        settlement_receipt_id: Some(receipt.receipt_id().to_owned()),
        settlement_outcome: Some(receipt.outcome()),
    }
}

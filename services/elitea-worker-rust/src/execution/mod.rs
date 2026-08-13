//! Shared durable execution coordination.

pub mod agent_delivery;
pub mod agent_lease;
pub mod agent_preparation;
pub mod invocation_admission;

#[cfg(test)]
mod agent_lease_tests;
#[cfg(test)]
mod agent_preparation_tests;
#[cfg(test)]
mod invocation_admission_tests;

pub use agent_delivery::{
    AgentDeliveryCompletion, AgentDeliveryCompletionKind, AgentDeliveryError, AgentDeliveryRoute,
    AgentDeliveryRouteKind, AgentDeliveryRouter, FreshAgentDelivery, OutputRecoveryAgentDelivery,
};
pub use agent_lease::{
    ClaimLeaseActivation, ClaimLeaseError, ClaimLeaseErrorCode, ClaimLeaseMonitor,
    ClaimLeaseMonitorConfig, SystemUnixMillisClock, UnixMillisClock,
};
pub use agent_preparation::{
    AgentPreparationConfig, AgentPreparationError, AgentPreparationErrorCode,
    AgentPreparationOutcome, PreInvocationTerminalCause, PreparedAgentInvocation,
    prepare_fresh_agent_invocation,
};
pub use invocation_admission::{
    InvocationAdmission, InvocationAdmissionConfig, InvocationAdmissionError,
    InvocationAdmissionErrorCode, InvocationReservation,
};

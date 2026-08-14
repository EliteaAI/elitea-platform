//! Language-neutral agent execution contracts.

pub mod graph;
pub mod protocol;
pub mod request;
pub mod result;
pub(crate) mod runtime;

#[cfg(test)]
mod runtime_tests;

pub use crate::protocol::ProtocolError as AgentProtocolError;
pub use protocol::{AGENT_INPUT_SCHEMA_REVISION, parse_agent_execution_input, request_from};
pub use request::{
    AgentExecutionKind, AgentExecutionPayload, AgentExecutionRequest, AgentInputBinding,
    NextInputSuggestionPolicy, UserInput,
};
pub use result::{
    AGENT_RESULT_CLASSIFICATION, AGENT_RESULT_MEDIA_TYPE, AgentResultArtifact, AgentTerminalState,
    BoundAgentExecutionResult, bind_result_artifact,
};

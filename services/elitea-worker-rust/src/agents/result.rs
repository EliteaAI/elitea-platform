use super::request::AgentExecutionRequest;
use crate::protocol::{
    ProtocolError as AgentProtocolError,
    elitea::runtime::v1::{
        AgentExecutionArtifactReferenceV1, AgentExecutionResultV1, AgentExecutionTerminalStateV1,
        DigestAlgorithmV1, DigestV1,
    },
};

pub const AGENT_RESULT_MEDIA_TYPE: &str = "application/vnd.elitea.agent-execution-result.v1+json";
pub const AGENT_RESULT_CLASSIFICATION: &str = "tenant-confidential";

/// Terminal states currently accepted end to end by Main.
///
/// `PARKED_CHILDREN` is deliberately absent until the declared proto state is
/// accepted by Main and proven by durable parent/child component tests.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AgentTerminalState {
    Completed,
    PausedHitl,
    PausedMcpAuth,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentResultArtifact {
    pub artifact_id: String,
    pub immutable_version: String,
    pub byte_length: u64,
    pub digest: [u8; 32],
}

/// Bind one admitted terminal outcome to an immutable artifact reference.
///
/// # Errors
///
/// Returns [`AgentProtocolError::InvalidInput`] when the artifact identity,
/// version, or length is empty.
pub fn bind_result_artifact(
    request: &AgentExecutionRequest,
    terminal_state: AgentTerminalState,
    artifact: AgentResultArtifact,
) -> Result<AgentExecutionResultV1, AgentProtocolError> {
    if artifact.artifact_id.is_empty()
        || artifact.immutable_version.is_empty()
        || artifact.byte_length == 0
    {
        return Err(AgentProtocolError::InvalidInput(
            "the agent result artifact binding is malformed",
        ));
    }
    let binding = &request.binding;
    Ok(AgentExecutionResultV1 {
        input_bundle_id: binding.input_bundle_id.clone(),
        input_bundle_digest: Some(digest(binding.input_bundle_digest)),
        request_entry_id: binding.request_entry_id.clone(),
        request_immutable_version: binding.request_immutable_version.clone(),
        request_content_digest: Some(digest(binding.request_content_digest)),
        terminal_state: match terminal_state {
            AgentTerminalState::Completed => AgentExecutionTerminalStateV1::Completed.into(),
            AgentTerminalState::PausedHitl => AgentExecutionTerminalStateV1::PausedHitl.into(),
            AgentTerminalState::PausedMcpAuth => {
                AgentExecutionTerminalStateV1::PausedMcpAuth.into()
            }
        },
        result_artifact: Some(AgentExecutionArtifactReferenceV1 {
            artifact_id: artifact.artifact_id,
            immutable_version: artifact.immutable_version,
            media_type: AGENT_RESULT_MEDIA_TYPE.to_owned(),
            byte_length: artifact.byte_length,
            digest: Some(digest(artifact.digest)),
            classification: AGENT_RESULT_CLASSIFICATION.to_owned(),
        }),
    })
}

fn digest(value: [u8; 32]) -> DigestV1 {
    DigestV1 {
        algorithm: DigestAlgorithmV1::Sha256.into(),
        value: value.into(),
    }
}

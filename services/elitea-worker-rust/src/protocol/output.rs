use prost::Message;
use ring::digest;

use super::command::VerifiedAgentCommand;
use super::node_event::encode_current_node_event_json;
use super::{
    ProtocolError,
    elitea::runtime::v1::{
        DigestAlgorithmV1, DigestV1, ExecutionFenceV1, ExecutionIdentityV1,
        ExecutionOutputEventTypeV1, ExecutionOutputFrameV1, NodeEventV1, execution_output_frame_v1,
    },
};

pub const OUTPUT_SCHEMA_REVISION: &str = "elitea.runtime.execution-output.v1";
pub const MAX_OUTPUT_FRAME_BYTES: usize = 64 * 1024;

const MAX_SAFE_STRING_BYTES: usize = 256;

/// Bind one validated current `NodeEvent` to the exact claimed agent stream.
///
/// The control service issues `fence` after claim; it is deliberately supplied
/// separately from the Redis signed command. The returned frame has no
/// settlement proposal and is never terminal.
///
/// # Errors
///
/// Returns a bounded [`ProtocolError`] for an invalid fence, sequence,
/// occurrence time, `NodeEvent`, or complete output-frame size.
pub fn build_node_event_output_frame(
    verified: &VerifiedAgentCommand,
    fence: &ExecutionFenceV1,
    event: NodeEventV1,
    sequence: u64,
    occurred_at_unix_millis: i64,
    claim_handoff_watermark: u64,
) -> Result<ExecutionOutputFrameV1, ProtocolError> {
    if sequence == 0 || occurred_at_unix_millis <= 0 || claim_handoff_watermark >= sequence {
        return Err(ProtocolError::InvalidInput(
            "the progress output identity is malformed",
        ));
    }
    validate_fence(fence)?;
    encode_current_node_event_json(&event)?;

    let payload = event.encode_to_vec();
    let payload_digest = digest::digest(&digest::SHA256, &payload);
    let command = verified.command();
    let frame = ExecutionOutputFrameV1 {
        output_schema_revision: OUTPUT_SCHEMA_REVISION.to_owned(),
        stream_id: format!("{}:{}", command.execution_id, command.generation),
        identity: Some(ExecutionIdentityV1 {
            tenant_id: command.tenant_id.clone(),
            resource_project_id: command.resource_project_id.clone(),
            projection_project_id: command.projection_project_id.clone(),
            command_id: command.command_id.clone(),
            execution_id: command.execution_id.clone(),
            generation: command.generation,
        }),
        fence: Some(fence.clone()),
        logical_output_id: format!("node-event:{}:{sequence}", command.execution_id),
        event_id: format!("{}:{sequence}", command.command_id),
        sequence,
        claim_handoff_watermark,
        event_type: ExecutionOutputEventTypeV1::NodeEvent as i32,
        occurred_at_unix_millis,
        payload_digest: Some(DigestV1 {
            algorithm: DigestAlgorithmV1::Sha256 as i32,
            value: payload_digest.as_ref().to_vec(),
        }),
        terminal: false,
        settlement_proposal: None,
        payload: Some(execution_output_frame_v1::Payload::NodeEvent(event)),
    };
    if frame.encoded_len() > MAX_OUTPUT_FRAME_BYTES {
        return Err(ProtocolError::ResourceExhausted(
            "the progress event exceeds the approved output limit",
        ));
    }
    Ok(frame)
}

fn validate_fence(fence: &ExecutionFenceV1) -> Result<(), ProtocolError> {
    if fence.workload_session_id.is_empty()
        || fence.producer_id.is_empty()
        || fence.claim_attempt == 0
        || fence.lease_epoch == 0
        || fence.fence_token.len() != 32
        || fence.fence_token.iter().all(|byte| *byte == 0)
    {
        return Err(ProtocolError::InvalidInput(
            "the worker command fence is malformed",
        ));
    }
    if fence.workload_session_id.len() > MAX_SAFE_STRING_BYTES
        || fence.producer_id.len() > MAX_SAFE_STRING_BYTES
    {
        return Err(ProtocolError::ResourceExhausted(
            "the worker command fence exceeds the string limit",
        ));
    }
    Ok(())
}

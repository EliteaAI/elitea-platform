//! Exact direct-tool HITL decision binding over durable ADK session events.
//!
//! Main already consumes one browser decision set atomically from the paused
//! response and materializes it into the claimed continuation input. This
//! module performs the worker-side half of that boundary: it admits the
//! bounded current decision shape and proves that it names the latest
//! unresolved [`ToolConfirmationRequest`](adk_rust::ToolConfirmationRequest)
//! persisted by ADK's [`SessionService`](adk_rust::session::SessionService).
//!
//! It deliberately does not execute the resolved tool. ADK-Rust 2.0.0's direct
//! `LlmAgent` confirmation event does not preserve a restart-safe suspended
//! execution frame, and effectful tools additionally need an owned durable
//! effect receipt. Until those boundaries are present, resolution is useful
//! evidence but not execution authority.

#![allow(dead_code)] // Resume execution remains capability-gated.

use std::fmt;

use adk_rust::{Event, ToolConfirmationDecision, tool_call_fingerprint};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::digest;
use serde::Deserialize;
use serde_json::Value;

use super::request::AgentExecutionPayload;

const MAX_IDENTITY_BYTES: usize = 512;
const MAX_COMMENT_BYTES: usize = 2_000;
const MAX_CALL_VALUE_BYTES: usize = 40 * 1_024;
const MAX_JSON_DEPTH: usize = 64;
const HITL_DIGEST_DOMAIN: &[u8] = b"elitea.sensitive-tool-interrupt.v1\0";

/// Stable direct-HITL admission and resolution failures.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DirectHitlErrorCode {
    InvalidInput,
    UnsupportedCapability,
    StaleDecision,
    CorruptSession,
    ResourceExhausted,
}

impl DirectHitlErrorCode {
    #[must_use]
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidInput => "direct_hitl.invalid_input",
            Self::UnsupportedCapability => "direct_hitl.unsupported_capability",
            Self::StaleDecision => "direct_hitl.stale_decision",
            Self::CorruptSession => "direct_hitl.corrupt_session",
            Self::ResourceExhausted => "direct_hitl.resource_exhausted",
        }
    }
}

/// Data-free direct-HITL error.
pub(crate) struct DirectHitlError {
    code: DirectHitlErrorCode,
}

impl DirectHitlError {
    const fn new(code: DirectHitlErrorCode) -> Self {
        Self { code }
    }

    #[must_use]
    pub(crate) const fn code(&self) -> DirectHitlErrorCode {
        self.code
    }
}

impl fmt::Debug for DirectHitlError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DirectHitlError")
            .field("code", &self.code)
            .finish_non_exhaustive()
    }
}

impl fmt::Display for DirectHitlError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("the direct sensitive-tool decision could not be resolved")
    }
}

impl std::error::Error for DirectHitlError {}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum DirectHitlAction {
    Approve,
    Reject,
    BlockWithComment,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawDirectHitlDecision {
    interrupt_id: String,
    #[serde(default)]
    tool_call_id: String,
    action: DirectHitlAction,
    #[serde(default)]
    value: String,
}

/// One decision admitted from Main's already-authorized continuation input.
///
/// This value is intentionally non-`Clone` and non-`Debug`: the optional
/// denial comment is user content and should not become diagnostic payload.
pub(crate) struct DirectHitlDecision {
    interrupt_id: String,
    tool_call_id: Option<String>,
    action: DirectHitlAction,
    comment: Option<String>,
}

impl DirectHitlDecision {
    /// Admit the current direct-sensitive-tool continuation shape.
    pub(crate) fn from_payload(payload: &AgentExecutionPayload) -> Result<Self, DirectHitlError> {
        if !payload.should_continue
            || !payload.hitl_resume
            || payload.auto_approve_sensitive_actions
            || payload.hitl_decisions.len() != 1
        {
            return Err(DirectHitlError::new(
                DirectHitlErrorCode::UnsupportedCapability,
            ));
        }
        let raw = serde_json::from_value::<RawDirectHitlDecision>(
            payload
                .hitl_decisions
                .first()
                .cloned()
                .ok_or_else(|| DirectHitlError::new(DirectHitlErrorCode::InvalidInput))?,
        )
        .map_err(|_| DirectHitlError::new(DirectHitlErrorCode::InvalidInput))?;
        if !valid_identity(&raw.interrupt_id)
            || (!raw.tool_call_id.is_empty() && !valid_identity(&raw.tool_call_id))
        {
            return Err(DirectHitlError::new(DirectHitlErrorCode::InvalidInput));
        }
        let expected_action = match raw.action {
            DirectHitlAction::Approve => "approve",
            DirectHitlAction::Reject => "reject",
            DirectHitlAction::BlockWithComment => "block_with_comment",
        };
        if payload.hitl_action.as_deref() != Some(expected_action)
            || payload.hitl_value.as_deref() != Some(raw.value.as_str())
        {
            return Err(DirectHitlError::new(DirectHitlErrorCode::InvalidInput));
        }
        let comment = if matches!(raw.action, DirectHitlAction::BlockWithComment) {
            if raw.value.is_empty() || raw.value.len() > MAX_COMMENT_BYTES {
                return Err(DirectHitlError::new(DirectHitlErrorCode::InvalidInput));
            }
            Some(raw.value)
        } else {
            if !raw.value.is_empty() {
                return Err(DirectHitlError::new(DirectHitlErrorCode::InvalidInput));
            }
            None
        };
        Ok(Self {
            interrupt_id: raw.interrupt_id,
            tool_call_id: (!raw.tool_call_id.is_empty()).then_some(raw.tool_call_id),
            action: raw.action,
            comment,
        })
    }

    /// Resolve this decision against the latest persisted ADK confirmation.
    pub(crate) fn resolve(
        self,
        session: &dyn adk_rust::session::Session,
    ) -> Result<ResolvedDirectHitlDecision, DirectHitlError> {
        let events = session.events().all();
        let confirmation_index = events
            .iter()
            .rposition(|event| event.actions.tool_confirmation.is_some())
            .ok_or_else(|| DirectHitlError::new(DirectHitlErrorCode::StaleDecision))?;
        if events
            .iter()
            .skip(confirmation_index + 1)
            .any(semantic_event)
        {
            return Err(DirectHitlError::new(DirectHitlErrorCode::StaleDecision));
        }
        let confirmation_event = &events[confirmation_index];
        let request = confirmation_event
            .actions
            .tool_confirmation
            .as_ref()
            .ok_or_else(|| DirectHitlError::new(DirectHitlErrorCode::CorruptSession))?;
        let call_id = request
            .function_call_id
            .as_deref()
            .filter(|value| valid_identity(value))
            .ok_or_else(|| DirectHitlError::new(DirectHitlErrorCode::CorruptSession))?;
        if !valid_identity(&request.tool_name)
            || encoded_value_len(&request.args)? > MAX_CALL_VALUE_BYTES
        {
            return Err(DirectHitlError::new(DirectHitlErrorCode::CorruptSession));
        }
        if self
            .tool_call_id
            .as_deref()
            .is_some_and(|submitted| submitted != call_id)
        {
            return Err(DirectHitlError::new(DirectHitlErrorCode::StaleDecision));
        }
        let (interrupt_id, call_digest) = sensitive_call_identity(
            &confirmation_event.invocation_id,
            call_id,
            &request.tool_name,
            &request.args,
        )?;
        if self.interrupt_id != interrupt_id {
            return Err(DirectHitlError::new(DirectHitlErrorCode::StaleDecision));
        }
        let matching_calls = events[..confirmation_index]
            .iter()
            .filter(|event| event.invocation_id == confirmation_event.invocation_id)
            .flat_map(Event::tool_calls)
            .filter(|call| {
                call.call_id == Some(call_id)
                    && call.name == request.tool_name
                    && call.args == &request.args
            })
            .count();
        if matching_calls != 1 {
            return Err(DirectHitlError::new(DirectHitlErrorCode::CorruptSession));
        }
        let decision = match self.action {
            DirectHitlAction::Approve => ToolConfirmationDecision::Approve,
            DirectHitlAction::Reject | DirectHitlAction::BlockWithComment => {
                ToolConfirmationDecision::Deny
            }
        };
        Ok(ResolvedDirectHitlDecision {
            interrupt_id,
            call_digest,
            call_id: call_id.to_owned(),
            tool_name: request.tool_name.clone(),
            arguments: request.args.clone(),
            fingerprint: tool_call_fingerprint(&request.tool_name, &request.args),
            decision,
            denial_comment: self.comment,
        })
    }
}

/// Exact, session-proven call plus its one browser decision.
///
/// This value does not grant execution and deliberately implements neither
/// `Clone` nor `Debug` because arguments and the readable ADK fingerprint can
/// contain credentials.
pub(crate) struct ResolvedDirectHitlDecision {
    interrupt_id: String,
    call_digest: String,
    call_id: String,
    tool_name: String,
    arguments: Value,
    fingerprint: String,
    decision: ToolConfirmationDecision,
    denial_comment: Option<String>,
}

impl ResolvedDirectHitlDecision {
    #[cfg(test)]
    pub(crate) fn interrupt_id(&self) -> &str {
        &self.interrupt_id
    }

    #[cfg(test)]
    pub(crate) fn call_digest(&self) -> &str {
        &self.call_digest
    }

    #[cfg(test)]
    pub(crate) fn call_id(&self) -> &str {
        &self.call_id
    }

    #[cfg(test)]
    pub(crate) fn tool_name(&self) -> &str {
        &self.tool_name
    }

    #[cfg(test)]
    pub(crate) const fn arguments(&self) -> &Value {
        &self.arguments
    }

    #[cfg(test)]
    pub(crate) fn fingerprint(&self) -> &str {
        &self.fingerprint
    }

    #[cfg(test)]
    pub(crate) const fn decision(&self) -> ToolConfirmationDecision {
        self.decision
    }

    #[cfg(test)]
    pub(crate) fn denial_comment(&self) -> Option<&str> {
        self.denial_comment.as_deref()
    }
}

pub(super) fn sensitive_call_identity(
    invocation_id: &str,
    call_id: &str,
    tool_name: &str,
    arguments: &Value,
) -> Result<(String, String), DirectHitlError> {
    if !valid_identity(invocation_id)
        || !valid_identity(call_id)
        || !valid_identity(tool_name)
        || encoded_value_len(arguments)? > MAX_CALL_VALUE_BYTES
    {
        return Err(DirectHitlError::new(DirectHitlErrorCode::CorruptSession));
    }
    let canonical = serde_json::to_vec(&canonical_value(arguments, 0)?)
        .map_err(|_| DirectHitlError::new(DirectHitlErrorCode::CorruptSession))?;
    let mut context = digest::Context::new(&digest::SHA256);
    context.update(HITL_DIGEST_DOMAIN);
    for field in [
        invocation_id.as_bytes(),
        call_id.as_bytes(),
        tool_name.as_bytes(),
    ] {
        context.update(&(field.len() as u64).to_be_bytes());
        context.update(field);
    }
    context.update(&(canonical.len() as u64).to_be_bytes());
    context.update(&canonical);
    let digest = context.finish();
    Ok((
        format!("hitl_e1:{}", URL_SAFE_NO_PAD.encode(digest.as_ref())),
        format!("sha256:{}", hex(digest.as_ref())),
    ))
}

fn semantic_event(event: &Event) -> bool {
    event.llm_response.content.is_some()
        || event.actions.tool_confirmation.is_some()
        || event.actions.tool_confirmation_decision.is_some()
        || !event.actions.state_delta.is_empty()
        || !event.actions.artifact_delta.is_empty()
        || event.actions.transfer_to_agent.is_some()
        || event.actions.escalate
}

fn encoded_value_len(value: &Value) -> Result<usize, DirectHitlError> {
    serde_json::to_vec(value)
        .map(|encoded| encoded.len())
        .map_err(|_| DirectHitlError::new(DirectHitlErrorCode::CorruptSession))
}

fn canonical_value(value: &Value, depth: usize) -> Result<Value, DirectHitlError> {
    if depth > MAX_JSON_DEPTH {
        return Err(DirectHitlError::new(DirectHitlErrorCode::ResourceExhausted));
    }
    match value {
        Value::Array(values) => values
            .iter()
            .map(|value| canonical_value(value, depth + 1))
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            let mut object = serde_json::Map::with_capacity(values.len());
            for key in keys {
                let item = values
                    .get(key)
                    .ok_or_else(|| DirectHitlError::new(DirectHitlErrorCode::CorruptSession))?;
                object.insert(key.clone(), canonical_value(item, depth + 1)?);
            }
            Ok(Value::Object(object))
        }
        value => Ok(value.clone()),
    }
}

fn valid_identity(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_IDENTITY_BYTES && !value.chars().any(char::is_control)
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(char::from(DIGITS[usize::from(byte >> 4)]));
        output.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    output
}

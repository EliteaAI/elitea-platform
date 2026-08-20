//! Exact pipeline-HITL decision binding over durable ADK session and graph state.

#![allow(dead_code)] // Production pipeline assembly remains capability-gated.

use std::fmt;

use adk_rust::graph::interrupt::INTERRUPT_METADATA_KEY;
use adk_rust::graph::{Checkpointer, State};
use adk_rust::session::Session;
use serde::Deserialize;
use serde_json::{Value, json};

use super::hitl::HITL_RESUME_STATE_KEY;
use crate::agents::events::pipeline_hitl_event_binding;
use crate::agents::request::AgentExecutionPayload;

const MAX_COMMENT_BYTES: usize = 8 * 1024;
const MAX_EDIT_BYTES: usize = 64 * 1024;
const MAX_IDENTITY_BYTES: usize = 512;

#[derive(Clone, Copy, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
enum PipelineHitlAction {
    Approve,
    Reject,
    Edit,
    BlockWithComment,
}

impl PipelineHitlAction {
    const fn wire_name(self) -> &'static str {
        match self {
            Self::Approve => "approve",
            Self::Reject => "reject",
            Self::Edit => "edit",
            Self::BlockWithComment => "block_with_comment",
        }
    }

    const fn graph_action(self) -> &'static str {
        match self {
            Self::Approve => "approve",
            Self::Reject | Self::BlockWithComment => "reject",
            Self::Edit => "edit",
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawPipelineHitlDecision {
    interrupt_id: String,
    #[serde(default)]
    tool_call_id: String,
    action: PipelineHitlAction,
    #[serde(default)]
    value: String,
}

/// One Main-authorized browser decision before it is joined to durable state.
///
/// It is intentionally non-cloneable and non-debug because an edit or block
/// comment is user content.
pub(crate) struct PipelineHitlDecision {
    interrupt_id: String,
    action: PipelineHitlAction,
    value: String,
}

impl PipelineHitlDecision {
    /// Admit the current single pipeline-HITL continuation envelope.
    pub(crate) fn from_payload(
        payload: &AgentExecutionPayload,
    ) -> Result<Self, PipelineResumeError> {
        if !payload.should_continue
            || !payload.hitl_resume
            || payload.auto_approve_sensitive_actions
            || payload.hitl_decisions.len() != 1
            || payload.checkpoint_id.is_some()
        {
            return Err(PipelineResumeError::new(
                PipelineResumeErrorCode::UnsupportedCapability,
            ));
        }
        let raw = serde_json::from_value::<RawPipelineHitlDecision>(
            payload
                .hitl_decisions
                .first()
                .cloned()
                .ok_or_else(PipelineResumeError::invalid)?,
        )
        .map_err(|_| PipelineResumeError::invalid())?;
        if !valid_identity(&raw.interrupt_id) || !raw.tool_call_id.is_empty() {
            return Err(PipelineResumeError::invalid());
        }
        if payload.hitl_action.as_deref() != Some(raw.action.wire_name())
            || payload.hitl_value.as_deref() != Some(raw.value.as_str())
        {
            return Err(PipelineResumeError::invalid());
        }
        match raw.action {
            PipelineHitlAction::Approve | PipelineHitlAction::Reject if !raw.value.is_empty() => {
                return Err(PipelineResumeError::invalid());
            }
            PipelineHitlAction::Edit
                if raw.value.is_empty()
                    || raw.value.len() > MAX_EDIT_BYTES
                    || raw.value.contains('\0') =>
            {
                return Err(PipelineResumeError::invalid());
            }
            PipelineHitlAction::BlockWithComment
                if raw.value.is_empty()
                    || raw.value.len() > MAX_COMMENT_BYTES
                    || raw.value.contains('\0') =>
            {
                return Err(PipelineResumeError::invalid());
            }
            _ => {}
        }
        Ok(Self {
            interrupt_id: raw.interrupt_id,
            action: raw.action,
            value: raw.value,
        })
    }

    /// Resolve this decision against the latest persisted pause and checkpoint.
    pub(crate) async fn resolve(
        self,
        session: &dyn Session,
        checkpointer: &dyn Checkpointer,
        root_agent_name: &str,
        thread_id: &str,
    ) -> Result<PipelineResume, PipelineResumeError> {
        let events = session.events().all();
        let interrupt_index = events
            .iter()
            .rposition(|event| event.provider_metadata.contains_key(INTERRUPT_METADATA_KEY))
            .ok_or_else(PipelineResumeError::stale)?;
        if interrupt_index + 1 != events.len() {
            return Err(PipelineResumeError::stale());
        }
        let binding =
            pipeline_hitl_event_binding(&events[interrupt_index], root_agent_name, thread_id)
                .map_err(|_| PipelineResumeError::corrupt())?;
        if binding.interrupt_id() != self.interrupt_id
            || !binding.allows(self.action.graph_action())
        {
            return Err(PipelineResumeError::stale());
        }
        let checkpoint = checkpointer
            .load(thread_id)
            .await
            .map_err(|_| PipelineResumeError::dependency())?
            .ok_or_else(PipelineResumeError::stale)?;
        if checkpoint.thread_id != thread_id
            || checkpoint.checkpoint_id != binding.checkpoint_id()
            || checkpoint.pending_nodes.as_slice() != [binding.node_name()]
            || checkpoint
                .state
                .get(HITL_RESUME_STATE_KEY)
                .is_some_and(|value| value != &json!({}))
        {
            return Err(PipelineResumeError::stale());
        }
        let value = if self.action == PipelineHitlAction::Edit {
            Value::String(self.value)
        } else {
            Value::String(String::new())
        };
        Ok(PipelineResume {
            state: [(
                HITL_RESUME_STATE_KEY.to_owned(),
                json!({
                    binding.node_name(): {
                        "definition_digest": binding.definition_digest(),
                        "action": self.action.graph_action(),
                        "value": value,
                    }
                }),
            )]
            .into_iter()
            .collect(),
        })
    }
}

/// One checkpoint-proven resume state consumed by a fresh graph agent.
pub(crate) struct PipelineResume {
    state: State,
}

impl PipelineResume {
    pub(super) fn into_state(self) -> State {
        self.state
    }
}

fn valid_identity(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_IDENTITY_BYTES && !value.chars().any(char::is_control)
}

/// Stable pipeline-HITL restart failure.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PipelineResumeErrorCode {
    InvalidInput,
    UnsupportedCapability,
    StaleDecision,
    CorruptSession,
    DependencyUnavailable,
}

impl PipelineResumeErrorCode {
    #[must_use]
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidInput => "pipeline_hitl.invalid_input",
            Self::UnsupportedCapability => "pipeline_hitl.unsupported_capability",
            Self::StaleDecision => "pipeline_hitl.stale_decision",
            Self::CorruptSession => "pipeline_hitl.corrupt_session",
            Self::DependencyUnavailable => "pipeline_hitl.dependency_unavailable",
        }
    }
}

/// Data-free public error; the source event and decision are never formatted.
pub(crate) struct PipelineResumeError {
    code: PipelineResumeErrorCode,
}

impl PipelineResumeError {
    const fn new(code: PipelineResumeErrorCode) -> Self {
        Self { code }
    }

    const fn invalid() -> Self {
        Self::new(PipelineResumeErrorCode::InvalidInput)
    }

    const fn stale() -> Self {
        Self::new(PipelineResumeErrorCode::StaleDecision)
    }

    const fn corrupt() -> Self {
        Self::new(PipelineResumeErrorCode::CorruptSession)
    }

    const fn dependency() -> Self {
        Self::new(PipelineResumeErrorCode::DependencyUnavailable)
    }

    #[must_use]
    pub(crate) const fn code(&self) -> PipelineResumeErrorCode {
        self.code
    }
}

impl fmt::Debug for PipelineResumeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PipelineResumeError")
            .field("code", &self.code)
            .finish_non_exhaustive()
    }
}

impl fmt::Display for PipelineResumeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("the pipeline HITL decision could not be resolved")
    }
}

impl std::error::Error for PipelineResumeError {}

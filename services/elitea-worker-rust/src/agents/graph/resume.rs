//! Exact pipeline-HITL decision binding over durable ADK session and graph state.

#![allow(dead_code)] // Production pipeline assembly remains capability-gated.

use std::fmt;

use adk_rust::graph::interrupt::INTERRUPT_METADATA_KEY;
use adk_rust::graph::{Checkpointer, State};
use adk_rust::session::Session;
use serde::Deserialize;
use serde_json::{Value, json};

use super::direct_tool::DIRECT_TOOL_RESUME_STATE_KEY;
use super::hitl::HITL_RESUME_STATE_KEY;
use super::printer::{
    PRINTER_OUTPUT_STATE_KEY, PRINTER_PAUSE_SCHEMA, PrinterPauseCatalog, PrinterPauseMetadata,
};
use crate::agents::events::{
    pipeline_hitl_event_binding, pipeline_printer_event_binding, pipeline_tool_event_binding,
};
use crate::agents::request::AgentExecutionPayload;

const MAX_COMMENT_BYTES: usize = 8 * 1024;
const MAX_EDIT_BYTES: usize = 64 * 1024;
const MAX_IDENTITY_BYTES: usize = 512;

/// Current SDK-compatible continuation of a static Printer checkpoint.
///
/// This is not a HITL decision: any ordinary non-empty user text resumes the
/// exact latest Printer checkpoint, and the text is appended to graph messages
/// before the compiler-owned reset node executes.
pub(crate) struct PrinterContinuation;

pub(crate) struct PrinterResumeContext<'a> {
    session: &'a dyn Session,
    checkpointer: &'a dyn Checkpointer,
    root_agent_name: &'a str,
    thread_id: &'a str,
    catalog: &'a PrinterPauseCatalog,
}

impl<'a> PrinterResumeContext<'a> {
    pub(crate) const fn new(
        session: &'a dyn Session,
        checkpointer: &'a dyn Checkpointer,
        root_agent_name: &'a str,
        thread_id: &'a str,
        catalog: &'a PrinterPauseCatalog,
    ) -> Self {
        Self {
            session,
            checkpointer,
            root_agent_name,
            thread_id,
            catalog,
        }
    }
}

impl PrinterContinuation {
    pub(crate) fn from_payload(
        payload: &AgentExecutionPayload,
    ) -> Result<Self, PipelineResumeError> {
        if !payload.should_continue
            || payload.hitl_resume
            || payload.hitl_action.is_some()
            || payload.hitl_value.is_some()
            || !payload.hitl_decisions.is_empty()
            || payload.checkpoint_id.is_some()
            || payload.auto_approve_sensitive_actions
        {
            return Err(PipelineResumeError::new(
                PipelineResumeErrorCode::UnsupportedCapability,
            ));
        }
        Ok(Self)
    }

    pub(crate) async fn resolve(
        self,
        context: PrinterResumeContext<'_>,
        user_input: &str,
    ) -> Result<PipelineResume, PipelineResumeError> {
        if user_input.is_empty() || user_input.contains('\0') {
            return Err(PipelineResumeError::invalid());
        }
        let events = context.session.events().all();
        let interrupt_index = events
            .iter()
            .rposition(|event| event.provider_metadata.contains_key(INTERRUPT_METADATA_KEY))
            .ok_or_else(PipelineResumeError::stale)?;
        if interrupt_index + 1 != events.len() {
            return Err(PipelineResumeError::stale());
        }
        let binding = pipeline_printer_event_binding(
            &events[interrupt_index],
            context.root_agent_name,
            context.thread_id,
        )
        .map_err(|_| PipelineResumeError::corrupt())?;
        let metadata = PrinterPauseMetadata {
            schema: PRINTER_PAUSE_SCHEMA.to_owned(),
            node_name: binding.node_name().to_owned(),
            reset_node_name: binding.reset_node_name().to_owned(),
            definition_digest: binding.definition_digest().to_owned(),
            node_digest: binding.node_digest().to_owned(),
        };
        if !context.catalog.contains_exact(&metadata) {
            return Err(PipelineResumeError::stale());
        }
        let checkpoint = context
            .checkpointer
            .load(context.thread_id)
            .await
            .map_err(|_| PipelineResumeError::dependency())?
            .ok_or_else(PipelineResumeError::stale)?;
        if checkpoint.thread_id != context.thread_id
            || checkpoint.checkpoint_id != binding.checkpoint_id()
            || checkpoint.pending_nodes.as_slice() != [binding.reset_node_name()]
            || checkpoint
                .state
                .get(PRINTER_OUTPUT_STATE_KEY)
                .and_then(Value::as_str)
                != Some(binding.output())
        {
            return Err(PipelineResumeError::stale());
        }
        Ok(PipelineResume {
            state: [
                ("input".to_owned(), Value::String(user_input.to_owned())),
                (
                    "messages".to_owned(),
                    json!([{"role": "user", "content": user_input}]),
                ),
            ]
            .into_iter()
            .collect(),
        })
    }
}

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

/// Either configured graph HITL or one direct Toolkit-node confirmation.
pub(crate) enum PipelineContinuationDecision {
    Node(PipelineHitlDecision),
    Tool(PipelineToolDecision),
}

impl PipelineContinuationDecision {
    pub(crate) fn from_payload(
        payload: &AgentExecutionPayload,
    ) -> Result<Self, PipelineResumeError> {
        let raw = payload
            .hitl_decisions
            .first()
            .and_then(Value::as_object)
            .and_then(|decision| decision.get("tool_call_id"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        if raw.is_empty() {
            PipelineHitlDecision::from_payload(payload).map(Self::Node)
        } else {
            PipelineToolDecision::from_payload(payload).map(Self::Tool)
        }
    }

    pub(crate) async fn resolve(
        self,
        session: &dyn Session,
        checkpointer: &dyn Checkpointer,
        root_agent_name: &str,
        thread_id: &str,
    ) -> Result<PipelineResume, PipelineResumeError> {
        match self {
            Self::Node(decision) => {
                decision
                    .resolve(session, checkpointer, root_agent_name, thread_id)
                    .await
            }
            Self::Tool(decision) => {
                decision
                    .resolve(session, checkpointer, root_agent_name, thread_id)
                    .await
            }
        }
    }
}

/// One exact browser decision for a checkpointed Toolkit-node call.
pub(crate) struct PipelineToolDecision {
    interrupt_id: String,
    tool_call_id: String,
    action: PipelineHitlAction,
    value: String,
}

impl PipelineToolDecision {
    fn from_payload(payload: &AgentExecutionPayload) -> Result<Self, PipelineResumeError> {
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
        if !valid_identity(&raw.interrupt_id) || !valid_identity(&raw.tool_call_id) {
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
            PipelineHitlAction::BlockWithComment
                if raw.value.is_empty()
                    || raw.value.len() > MAX_COMMENT_BYTES
                    || raw.value.contains('\0') =>
            {
                return Err(PipelineResumeError::invalid());
            }
            PipelineHitlAction::Edit => return Err(PipelineResumeError::invalid()),
            _ => {}
        }
        Ok(Self {
            interrupt_id: raw.interrupt_id,
            tool_call_id: raw.tool_call_id,
            action: raw.action,
            value: raw.value,
        })
    }

    async fn resolve(
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
            pipeline_tool_event_binding(&events[interrupt_index], root_agent_name, thread_id)
                .map_err(|_| PipelineResumeError::corrupt())?;
        if binding.interrupt_id() != self.interrupt_id
            || binding.tool_call_id() != self.tool_call_id
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
            || checkpoint.pending_nodes.as_slice() != [binding.pending_node_name()]
            || checkpoint
                .state
                .get(DIRECT_TOOL_RESUME_STATE_KEY)
                .is_some_and(|value| value != &json!({}))
        {
            return Err(PipelineResumeError::stale());
        }
        validate_nested_checkpoints(
            checkpointer,
            binding.nested_checkpoints(),
            binding.node_name(),
            DIRECT_TOOL_RESUME_STATE_KEY,
        )
        .await?;
        Ok(PipelineResume {
            state: [(
                DIRECT_TOOL_RESUME_STATE_KEY.to_owned(),
                json!({
                    binding.node_name(): {
                        "definition_digest": binding.definition_digest(),
                        "tool_call_id": binding.tool_call_id(),
                        "argument_digest": binding.argument_digest(),
                        "action": self.action.wire_name(),
                        "value": self.value,
                    }
                }),
            )]
            .into_iter()
            .collect(),
        })
    }
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
            || checkpoint.pending_nodes.as_slice() != [binding.pending_node_name()]
            || checkpoint
                .state
                .get(HITL_RESUME_STATE_KEY)
                .is_some_and(|value| value != &json!({}))
        {
            return Err(PipelineResumeError::stale());
        }
        validate_nested_checkpoints(
            checkpointer,
            binding.nested_checkpoints(),
            binding.node_name(),
            HITL_RESUME_STATE_KEY,
        )
        .await?;
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

async fn validate_nested_checkpoints(
    checkpointer: &dyn Checkpointer,
    nested: &[crate::agents::events::NestedPipelineCheckpoint],
    leaf_pending_node: &str,
    resume_state_key: &str,
) -> Result<(), PipelineResumeError> {
    for (index, nested_checkpoint) in nested.iter().enumerate() {
        let pending_node = nested
            .get(index + 1)
            .map_or(leaf_pending_node, |checkpoint| checkpoint.node_name());
        let checkpoint = checkpointer
            .load(nested_checkpoint.thread_id())
            .await
            .map_err(|_| PipelineResumeError::dependency())?
            .ok_or_else(PipelineResumeError::stale)?;
        if checkpoint.thread_id != nested_checkpoint.thread_id()
            || checkpoint.checkpoint_id != nested_checkpoint.checkpoint_id()
            || checkpoint.pending_nodes.as_slice() != [pending_node]
            || checkpoint
                .state
                .get(resume_state_key)
                .is_some_and(|value| value != &json!({}))
        {
            return Err(PipelineResumeError::stale());
        }
    }
    Ok(())
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

//! Closed ADK-Rust 2.0.0 to current `NodeEventV1` projection.
//!
//! The first compatibility profile deliberately handles only ordinary
//! root-agent text turns. Tool execution, transfers, citations, HITL, MCP
//! authorization, pipeline custom events and multi-agent branches remain
//! closed until their typed Elitea identities are available. Production cannot
//! construct this projector yet; the authorized lifecycle will open that seam
//! only after progress output is durably backpressured.

#![allow(dead_code)] // Production construction waits for authorized progress delivery.

use std::fmt;

use adk_rust::{Event, FinishReason, Part};
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{Value, json};

use crate::protocol::ProtocolError;
use crate::protocol::elitea::runtime::v1::NodeEventV1;
use crate::protocol::node_event::{
    MAX_CURRENT_NODE_EVENT_JSON_BYTES, encode_current_node_event_json,
};

const MAX_PROJECTED_EVENTS_PER_ADK_EVENT: usize = 4;
const MAX_ADK_EVENT_ID_BYTES: usize = 512;
const MAX_ADK_PARTS_PER_EVENT: usize = 256;
const MAX_CONTEXT_TEXT_BYTES: usize = 2_048;
const MAX_COMPLETED_CONTENT_BYTES: usize = 60 * 1_024;

/// Stable, low-cardinality event projection failures.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AgentEventProjectionErrorCode {
    InvalidState,
    UnsupportedCapability,
    ProviderFailure,
    ResourceExhausted,
    InvalidOutput,
}

impl AgentEventProjectionErrorCode {
    #[must_use]
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidState => "agent_event.invalid_state",
            Self::UnsupportedCapability => "agent_event.unsupported_capability",
            Self::ProviderFailure => "agent_event.provider_failure",
            Self::ResourceExhausted => "agent_event.resource_exhausted",
            Self::InvalidOutput => "agent_event.invalid_output",
        }
    }
}

/// Data-free projector error.
///
/// Provider messages, model metadata, prompts, tool arguments and event
/// payloads are never included in `Display`, `Debug`, or `Error::source`.
pub(crate) struct AgentEventProjectionError {
    code: AgentEventProjectionErrorCode,
    protocol: Option<ProtocolError>,
}

impl AgentEventProjectionError {
    const fn invalid_state() -> Self {
        Self {
            code: AgentEventProjectionErrorCode::InvalidState,
            protocol: None,
        }
    }

    const fn unsupported() -> Self {
        Self {
            code: AgentEventProjectionErrorCode::UnsupportedCapability,
            protocol: None,
        }
    }

    const fn provider_failure() -> Self {
        Self {
            code: AgentEventProjectionErrorCode::ProviderFailure,
            protocol: None,
        }
    }

    fn output(error: ProtocolError) -> Self {
        let code = if matches!(error, ProtocolError::ResourceExhausted(_)) {
            AgentEventProjectionErrorCode::ResourceExhausted
        } else {
            AgentEventProjectionErrorCode::InvalidOutput
        };
        Self {
            code,
            protocol: Some(error),
        }
    }

    #[must_use]
    pub(crate) const fn code(&self) -> AgentEventProjectionErrorCode {
        self.code
    }
}

impl fmt::Debug for AgentEventProjectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AgentEventProjectionError")
            .field("code", &self.code)
            .finish_non_exhaustive()
    }
}

impl fmt::Display for AgentEventProjectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self.code {
            AgentEventProjectionErrorCode::InvalidState => {
                "the agent event projector is not in the required lifecycle state"
            }
            AgentEventProjectionErrorCode::UnsupportedCapability => {
                "the ADK event is not supported by the current agent compatibility profile"
            }
            AgentEventProjectionErrorCode::ProviderFailure => {
                "the model provider reported an agent event failure"
            }
            AgentEventProjectionErrorCode::ResourceExhausted => {
                "the projected agent event exceeds its approved output limit"
            }
            AgentEventProjectionErrorCode::InvalidOutput => {
                "the projected agent event is malformed"
            }
        })
    }
}

impl std::error::Error for AgentEventProjectionError {}

/// Fixed-capacity projection result.
///
/// A caller sends and durably acknowledges every event in order before polling
/// the ADK stream again. Keeping the batch inline avoids a heap-backed event
/// queue per active invocation.
pub(crate) struct ProjectedAgentEventBatch {
    events: [Option<NodeEventV1>; MAX_PROJECTED_EVENTS_PER_ADK_EVENT],
    len: usize,
}

impl ProjectedAgentEventBatch {
    fn new() -> Self {
        Self {
            events: std::array::from_fn(|_| None),
            len: 0,
        }
    }

    fn push(&mut self, event: NodeEventV1) -> Result<(), AgentEventProjectionError> {
        let slot = self
            .events
            .get_mut(self.len)
            .ok_or_else(AgentEventProjectionError::invalid_state)?;
        *slot = Some(event);
        self.len += 1;
        Ok(())
    }

    #[must_use]
    pub(crate) const fn len(&self) -> usize {
        self.len
    }

    #[must_use]
    pub(crate) const fn is_empty(&self) -> bool {
        self.len == 0
    }
}

impl IntoIterator for ProjectedAgentEventBatch {
    type Item = NodeEventV1;
    type IntoIter = std::iter::Flatten<std::array::IntoIter<Option<NodeEventV1>, 4>>;

    fn into_iter(self) -> Self::IntoIter {
        self.events.into_iter().flatten()
    }
}

/// Sanitized browser-facing identity and presentation snapshot.
///
/// All fields are private. The future authorized assembler must remove skill
/// instruction bodies, credentials and private application settings before it
/// can construct this value.
pub(crate) struct AgentEventProjectionContext {
    stream_id: String,
    message_id: String,
    execution_generation: String,
    sio_event: String,
    thread_id: String,
    project_id: Value,
    chat_project_id: Value,
    root_agent_name: String,
    model_name: String,
    application_details: Value,
    should_continue: bool,
    hitl_resume: bool,
    parallel_reconcile: bool,
    invoked_skills: Vec<Value>,
    applied_skills: Vec<Value>,
}

/// Validated ordinary-turn values derived from the authenticated command and
/// admitted input before provider execution begins.
pub(crate) struct OrdinaryProjectionInput {
    pub(crate) stream_id: String,
    pub(crate) message_id: String,
    pub(crate) execution_generation: String,
    pub(crate) sio_event: String,
    pub(crate) thread_id: String,
    pub(crate) project_id: Value,
    pub(crate) chat_project_id: Value,
    pub(crate) root_agent_name: String,
    pub(crate) model_name: String,
    pub(crate) application_details: Value,
}

impl AgentEventProjectionContext {
    pub(crate) fn ordinary(
        input: OrdinaryProjectionInput,
    ) -> Result<Self, AgentEventProjectionError> {
        let context = Self {
            stream_id: input.stream_id,
            message_id: input.message_id,
            execution_generation: input.execution_generation,
            sio_event: input.sio_event,
            thread_id: input.thread_id,
            project_id: input.project_id,
            chat_project_id: input.chat_project_id,
            root_agent_name: input.root_agent_name,
            model_name: input.model_name,
            application_details: input.application_details,
            should_continue: false,
            hitl_resume: false,
            parallel_reconcile: false,
            invoked_skills: Vec::new(),
            applied_skills: Vec::new(),
        };
        validate_context(&context)?;
        Ok(context)
    }
}

#[cfg(test)]
impl AgentEventProjectionContext {
    pub(crate) fn fixture(application_details: Value) -> Self {
        Self {
            stream_id: "conversation-1".to_owned(),
            message_id: "message-1".to_owned(),
            execution_generation: "generation-1".to_owned(),
            sio_event: "chat_predict".to_owned(),
            thread_id: "thread-1".to_owned(),
            project_id: json!(7),
            chat_project_id: json!(7),
            root_agent_name: "root-agent".to_owned(),
            model_name: "model-1".to_owned(),
            application_details,
            should_continue: false,
            hitl_resume: false,
            parallel_reconcile: false,
            invoked_skills: Vec::new(),
            applied_skills: Vec::new(),
        }
    }
}

struct ActiveModelTurn {
    event_id: String,
    timestamp_start: String,
    content: String,
    thinking: String,
}

struct CompletedModelTurn;

/// Sanitized completion selected by the application/ad-hoc assembler.
///
/// ADK stream EOS and a model final-response event are not sufficient to pick
/// the application result: stored pipelines can declare a different terminal
/// output key. Production construction stays closed until that result adapter
/// is implemented.
pub(crate) struct CompletedAgentBrowserOutput {
    content: String,
    thread_id: String,
    execution_finished: bool,
    context_info: Value,
}

impl CompletedAgentBrowserOutput {
    pub(crate) fn ordinary(
        content: String,
        thread_id: String,
    ) -> Result<Self, AgentEventProjectionError> {
        validate_public_text(&thread_id)?;
        if content.len() > MAX_COMPLETED_CONTENT_BYTES {
            return Err(AgentEventProjectionError::output(
                ProtocolError::ResourceExhausted(
                    "the completed agent content exceeds its approved limit",
                ),
            ));
        }
        if content.is_empty() || content.contains('\0') {
            return Err(AgentEventProjectionError::output(
                ProtocolError::InvalidInput("the completed agent content is malformed"),
            ));
        }
        Ok(Self {
            content,
            thread_id,
            execution_finished: true,
            context_info: Value::Null,
        })
    }
}

#[cfg(test)]
impl CompletedAgentBrowserOutput {
    pub(crate) fn fixture(content: &str) -> Self {
        Self {
            content: content.to_owned(),
            thread_id: "thread-1".to_owned(),
            execution_finished: true,
            context_info: Value::Null,
        }
    }
}

struct OrdinaryModelEvent {
    content: String,
    thinking: String,
    closes_turn: bool,
    timestamp: String,
}

enum ProjectionState {
    Created,
    Started,
    Active(ActiveModelTurn),
    Complete(CompletedModelTurn),
    Finished,
}

/// Stateful ordinary-text compatibility projector.
pub(crate) struct AgentEventProjector {
    context: AgentEventProjectionContext,
    state: ProjectionState,
    invocation_id: Option<String>,
}

impl AgentEventProjector {
    pub(crate) fn new(
        context: AgentEventProjectionContext,
    ) -> Result<Self, AgentEventProjectionError> {
        validate_context(&context)?;
        Ok(Self {
            context,
            state: ProjectionState::Created,
            invocation_id: None,
        })
    }

    /// Emit the current `agent_start` event before the ADK stream is started.
    /// The lifecycle must durably acknowledge this batch before calling
    /// `NativeAgentInvocation::start`.
    pub(crate) fn start(
        &mut self,
        occurred_at: DateTime<Utc>,
    ) -> Result<ProjectedAgentEventBatch, AgentEventProjectionError> {
        if !matches!(self.state, ProjectionState::Created) {
            return Err(AgentEventProjectionError::invalid_state());
        }
        let event = self.event(
            "agent_start",
            &Value::Null,
            None,
            &json!({"invoked_skills": self.context.invoked_skills}),
            occurred_at,
        )?;
        self.state = ProjectionState::Started;
        let mut batch = ProjectedAgentEventBatch::new();
        batch.push(event)?;
        Ok(batch)
    }

    /// Project one ordinary root-agent ADK event.
    ///
    /// The returned batch contains at most four inline events. The caller must
    /// persist/send/ACK them in iteration order before polling ADK again.
    pub(crate) fn project(
        &mut self,
        event: &Event,
    ) -> Result<ProjectedAgentEventBatch, AgentEventProjectionError> {
        validate_adk_event(event, &self.context.root_agent_name)?;
        validate_event_id(&event.id)?;
        validate_invocation_id(&event.invocation_id)?;
        if self
            .invocation_id
            .as_deref()
            .is_some_and(|expected| expected != event.invocation_id)
        {
            return Err(AgentEventProjectionError::invalid_state());
        }
        let Some(model_event) = ordinary_model_event(event)? else {
            self.bind_invocation_id(event);
            return Ok(ProjectedAgentEventBatch::new());
        };
        let batch = self.project_model_event(event, model_event)?;
        self.bind_invocation_id(event);
        Ok(batch)
    }

    fn project_model_event(
        &mut self,
        event: &Event,
        model_event: OrdinaryModelEvent,
    ) -> Result<ProjectedAgentEventBatch, AgentEventProjectionError> {
        let timestamp = model_event.timestamp;
        let starts_turn = matches!(
            self.state,
            ProjectionState::Started | ProjectionState::Complete(_)
        );
        let (event_id, timestamp_start, previous_content, previous_thinking) = match &self.state {
            ProjectionState::Started | ProjectionState::Complete(_) => {
                (event.id.as_str(), timestamp.as_str(), "", "")
            }
            ProjectionState::Active(turn) => {
                if turn.event_id != event.id {
                    return Err(AgentEventProjectionError::unsupported());
                }
                (
                    turn.event_id.as_str(),
                    turn.timestamp_start.as_str(),
                    turn.content.as_str(),
                    turn.thinking.as_str(),
                )
            }
            ProjectionState::Created | ProjectionState::Finished => {
                return Err(AgentEventProjectionError::invalid_state());
            }
        };
        let (next_content, content_delta) =
            merge_stream_value(previous_content, model_event.content)?;
        let (next_thinking, thinking_delta) =
            merge_stream_value(previous_thinking, model_event.thinking)?;
        let next_timestamp_start = timestamp_start.to_owned();

        let mut batch = ProjectedAgentEventBatch::new();
        if starts_turn {
            batch.push(self.model_start_event(event, &timestamp)?)?;
        }

        if !content_delta.is_empty() || !thinking_delta.is_empty() {
            let content = if content_delta.is_empty() {
                Value::Null
            } else {
                Value::String(content_delta)
            };
            batch.push(self.event(
                "agent_llm_chunk",
                &content,
                (!thinking_delta.is_empty()).then_some(thinking_delta),
                &json!({"tool_run_id": event.id}),
                event.timestamp,
            )?)?;
        }

        if model_event.closes_turn {
            let step = json!({
                "tool_run_id": event_id,
                "type": "ChatGeneration",
                "text": next_content,
                "thinking": next_thinking,
                "timestamp_start": next_timestamp_start,
                "timestamp_finish": timestamp,
                "message": {"response_metadata": {
                    "model_name": self.context.model_name,
                    "tool_name": Value::Null,
                    "metadata": {},
                }},
            });
            batch.push(self.event(
                "agent_llm_end",
                &Value::Null,
                None,
                &json!({"tool_run_id": event.id, "thinking_steps": [step.clone()]}),
                event.timestamp,
            )?)?;
            batch.push(self.event(
                "partial_message",
                &Value::Null,
                None,
                &json!({
                    "project_id": self.context.project_id,
                    "chat_project_id": self.context.chat_project_id,
                    "thread_id": self.context.thread_id,
                    "thinking_steps": [step],
                    "tool_calls": {},
                    "additional_response_meta": {},
                    "invoked_skills": self.context.applied_skills,
                }),
                event.timestamp,
            )?)?;
            self.state = ProjectionState::Complete(CompletedModelTurn);
        } else {
            self.state = ProjectionState::Active(ActiveModelTurn {
                event_id: event.id.clone(),
                timestamp_start: next_timestamp_start,
                content: next_content,
                thinking: next_thinking,
            });
        }
        Ok(batch)
    }

    fn model_start_event(
        &self,
        event: &Event,
        timestamp: &str,
    ) -> Result<NodeEventV1, AgentEventProjectionError> {
        self.event(
            "agent_llm_start",
            &Value::Null,
            None,
            &json!({
                "tool_name": "Thinking step",
                "tool_run_id": event.id,
                "metadata": {"ls_model_name": self.context.model_name},
                "timestamp_start": timestamp,
                "model_name": self.context.model_name,
            }),
            event.timestamp,
        )
    }

    /// Emit the selected completed result only after ADK reaches EOS.
    pub(crate) fn finish_after_eos(
        &mut self,
        completion: CompletedAgentBrowserOutput,
        occurred_at: DateTime<Utc>,
    ) -> Result<ProjectedAgentEventBatch, AgentEventProjectionError> {
        if !matches!(self.state, ProjectionState::Complete(_)) {
            return Err(AgentEventProjectionError::invalid_state());
        }
        validate_public_text(&completion.thread_id)?;
        let mut batch = ProjectedAgentEventBatch::new();
        let response = Value::String(completion.content);
        if completion.execution_finished {
            batch.push(self.event(
                "pipeline_finish",
                &response,
                None,
                &json!({
                    "finish_reason": "finished",
                    "next_step": "END",
                    "thread_id": completion.thread_id,
                }),
                occurred_at,
            )?)?;
        }
        batch.push(self.event(
            "agent_response",
            &response,
            None,
            &json!({"finish_reason": "stop", "thread_id": completion.thread_id}),
            occurred_at,
        )?)?;
        batch.push(self.event(
            "full_message",
            &response,
            None,
            &json!({
                "project_id": self.context.project_id,
                "chat_project_id": self.context.chat_project_id,
                "application_details": self.context.application_details,
                "thread_id": completion.thread_id,
                "llm_start_timestamp": Value::Null,
                "additional_response_meta": {},
                "files_modified": [],
                "image_thumbnails": {},
                "index_statuses": {},
                "chat_history_tokens_input": 0,
                "llm_response_tokens_output": 0,
                "should_continue": self.context.should_continue,
                "hitl_resume": self.context.hitl_resume,
                "parallel_reconcile": self.context.parallel_reconcile,
                "context_info": completion.context_info,
                "invoked_skills": self.context.applied_skills,
            }),
            occurred_at,
        )?)?;
        self.state = ProjectionState::Finished;
        Ok(batch)
    }

    fn bind_invocation_id(&mut self, event: &Event) {
        if self.invocation_id.is_none() {
            self.invocation_id = Some(event.invocation_id.clone());
        }
    }

    fn event(
        &self,
        event_type: &str,
        content: &Value,
        thinking: Option<String>,
        response_metadata: &Value,
        occurred_at: DateTime<Utc>,
    ) -> Result<NodeEventV1, AgentEventProjectionError> {
        let event = NodeEventV1 {
            r#type: event_type.to_owned(),
            stream_id: Some(self.context.stream_id.clone()),
            message_id: Some(self.context.message_id.clone()),
            question_id: None,
            content: serde_json::to_vec(content).map_err(|_| {
                AgentEventProjectionError::output(ProtocolError::InvalidInput(
                    "the projected agent event content is malformed",
                ))
            })?,
            thinking,
            response_metadata: serde_json::to_vec(response_metadata).map_err(|_| {
                AgentEventProjectionError::output(ProtocolError::InvalidInput(
                    "the projected agent event metadata is malformed",
                ))
            })?,
            references: b"[]".to_vec(),
            sio_event: Some(self.context.sio_event.clone()),
            created_at: Some(occurred_at.to_rfc3339_opts(SecondsFormat::AutoSi, false)),
            parent_message_id: None,
            agent_name: None,
            execution_generation: Some(self.context.execution_generation.clone()),
        };
        encode_current_node_event_json(&event).map_err(AgentEventProjectionError::output)?;
        Ok(event)
    }
}

fn validate_context(
    context: &AgentEventProjectionContext,
) -> Result<(), AgentEventProjectionError> {
    let required = [
        context.stream_id.as_str(),
        context.message_id.as_str(),
        context.execution_generation.as_str(),
        context.sio_event.as_str(),
        context.thread_id.as_str(),
        context.root_agent_name.as_str(),
        context.model_name.as_str(),
    ];
    if required.iter().any(|value| {
        value.is_empty()
            || value.len() > MAX_CONTEXT_TEXT_BYTES
            || value
                .bytes()
                .any(|byte| matches!(byte, b'\0' | b'\r' | b'\n'))
    }) {
        return Err(AgentEventProjectionError::invalid_state());
    }
    Ok(())
}

fn validate_public_text(value: &str) -> Result<(), AgentEventProjectionError> {
    if value.is_empty()
        || value.len() > MAX_CONTEXT_TEXT_BYTES
        || value
            .bytes()
            .any(|byte| matches!(byte, b'\0' | b'\r' | b'\n'))
    {
        return Err(AgentEventProjectionError::invalid_state());
    }
    Ok(())
}

fn validate_adk_event(
    event: &Event,
    root_agent_name: &str,
) -> Result<(), AgentEventProjectionError> {
    if event.author != root_agent_name
        || !event.branch.is_empty()
        || event.llm_response.interrupted
        || event.llm_response.error_code.is_some()
        || event.llm_response.error_message.is_some()
        || event.llm_response.citation_metadata.is_some()
        || !event.long_running_tool_ids.is_empty()
        || event.tool_progress_stream().is_some()
        || event.actions.transfer_to_agent.is_some()
        || event.actions.escalate
        || event.actions.tool_confirmation.is_some()
        || event.actions.tool_confirmation_decision.is_some()
        || event.actions.compaction.is_some()
        || event.actions.route.is_some()
        || !event.actions.artifact_delta.is_empty()
    {
        if event.llm_response.error_code.is_some() || event.llm_response.error_message.is_some() {
            return Err(AgentEventProjectionError::provider_failure());
        }
        return Err(AgentEventProjectionError::unsupported());
    }
    if event.content().is_some()
        && (!event.actions.state_delta.is_empty() || event.actions.skip_summarization)
    {
        return Err(AgentEventProjectionError::unsupported());
    }
    Ok(())
}

fn ordinary_model_event(
    event: &Event,
) -> Result<Option<OrdinaryModelEvent>, AgentEventProjectionError> {
    let Some(content) = event.content() else {
        let closes_turn =
            event.llm_response.turn_complete || event.llm_response.finish_reason.is_some();
        if !closes_turn {
            return Ok(None);
        }
        if !event.actions.state_delta.is_empty() || event.actions.skip_summarization {
            return Err(AgentEventProjectionError::unsupported());
        }
        validate_finish_reason(event)?;
        return Ok(Some(OrdinaryModelEvent {
            content: String::new(),
            thinking: String::new(),
            closes_turn: true,
            timestamp: event
                .timestamp
                .to_rfc3339_opts(SecondsFormat::AutoSi, false),
        }));
    };
    if content.role != "model" && content.role != "assistant" {
        return Err(AgentEventProjectionError::unsupported());
    }
    if content.parts.len() > MAX_ADK_PARTS_PER_EVENT {
        return Err(AgentEventProjectionError {
            code: AgentEventProjectionErrorCode::ResourceExhausted,
            protocol: None,
        });
    }
    let (content, thinking) = ordinary_text_parts(content.parts.as_slice())?;
    let closes_turn = event.llm_response.turn_complete || !event.llm_response.partial;
    if closes_turn {
        validate_finish_reason(event)?;
    }
    Ok(Some(OrdinaryModelEvent {
        content,
        thinking,
        closes_turn,
        timestamp: event
            .timestamp
            .to_rfc3339_opts(SecondsFormat::AutoSi, false),
    }))
}

fn validate_finish_reason(event: &Event) -> Result<(), AgentEventProjectionError> {
    if matches!(
        event.llm_response.finish_reason,
        None | Some(FinishReason::Stop)
    ) {
        Ok(())
    } else {
        Err(AgentEventProjectionError::unsupported())
    }
}

fn ordinary_text_parts(parts: &[Part]) -> Result<(String, String), AgentEventProjectionError> {
    let mut content = String::new();
    let mut thinking = String::new();
    for part in parts {
        match part {
            Part::Text { text } => extend_bounded(&mut content, text)?,
            Part::Thinking {
                thinking: value, ..
            } => extend_bounded(&mut thinking, value)?,
            Part::InlineData { .. }
            | Part::FileData { .. }
            | Part::FunctionCall { .. }
            | Part::FunctionResponse { .. }
            | Part::ServerToolCall { .. }
            | Part::ServerToolResponse { .. }
            | Part::EmbeddedResource { .. } => {
                return Err(AgentEventProjectionError::unsupported());
            }
        }
    }
    Ok((content, thinking))
}

fn validate_event_id(value: &str) -> Result<(), AgentEventProjectionError> {
    if value.is_empty()
        || value.len() > MAX_ADK_EVENT_ID_BYTES
        || value
            .bytes()
            .any(|byte| matches!(byte, b'\0' | b'\r' | b'\n'))
    {
        return Err(AgentEventProjectionError::invalid_state());
    }
    Ok(())
}

fn validate_invocation_id(value: &str) -> Result<(), AgentEventProjectionError> {
    validate_event_id(value)
}

fn merge_stream_value(
    previous: &str,
    current: String,
) -> Result<(String, String), AgentEventProjectionError> {
    if previous.is_empty() {
        if current.len() > MAX_CURRENT_NODE_EVENT_JSON_BYTES {
            return Err(AgentEventProjectionError {
                code: AgentEventProjectionErrorCode::ResourceExhausted,
                protocol: None,
            });
        }
        let delta = current.clone();
        Ok((current, delta))
    } else if let Some(delta) = current.strip_prefix(previous) {
        let delta = delta.to_owned();
        Ok((current, delta))
    } else {
        let mut accumulated = previous.to_owned();
        extend_bounded(&mut accumulated, &current)?;
        Ok((accumulated, current))
    }
}

fn extend_bounded(target: &mut String, value: &str) -> Result<(), AgentEventProjectionError> {
    if target.len().saturating_add(value.len()) > MAX_CURRENT_NODE_EVENT_JSON_BYTES {
        return Err(AgentEventProjectionError {
            code: AgentEventProjectionErrorCode::ResourceExhausted,
            protocol: None,
        });
    }
    target.push_str(value);
    Ok(())
}

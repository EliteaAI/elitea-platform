//! Strict stored-pipeline `llm` node contract and state projection.
//!
//! The Python node combines prompt mapping, an agentic tool loop, provider
//! compatibility repairs and graph-state projection in one object. Rust keeps
//! the same business boundary but gives the actual model/tool execution to a
//! native ADK `LlmAgent`. This module remains authority-free: the complete YAML,
//! selected toolkit aliases and structured result schema are admitted before a
//! PAT, model or toolkit client can exist.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use adk_rust::futures::StreamExt as _;
use adk_rust::graph::{GraphError, Node, NodeContext, NodeOutput, State};
use adk_rust::{Agent, Content, InvocationContext, Part};
use async_trait::async_trait;
use ring::digest;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use thiserror::Error;
use tracing::Instrument as _;

use super::yaml::{valid_graph_id, valid_output_key};

const MAX_NODE_YAML_BYTES: usize = 64 * 1024;
const MAX_MAPPING_ENTRIES: usize = 16;
const MAX_NODE_VARIABLES: usize = 64;
const MAX_TOOLKITS: usize = 64;
const MAX_TOOLS_PER_TOOLKIT: usize = 256;
const MAX_MAPPING_TEXT_BYTES: usize = 64 * 1024;
const MAX_TOOL_TIMEOUT_SECONDS: u64 = 900;
const DEFAULT_TOOL_TIMEOUT_SECONDS: u64 = 900;
const CONFIG_DIGEST_DOMAIN: &[u8] = b"elitea.graph.llm.config.v1\0";
const MAX_RENDERED_INPUT_BYTES: usize = 64 * 1024;
static LLM_INVOCATION_SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawLlmNodeDefinition {
    id: String,
    #[serde(rename = "type")]
    node_type: String,
    #[serde(default)]
    input_mapping: BTreeMap<String, RawInputMapping>,
    #[serde(default)]
    input: Vec<String>,
    #[serde(default)]
    output: Vec<String>,
    #[serde(default)]
    tool_names: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    structured_output: bool,
    #[serde(default = "default_tool_timeout")]
    tool_execution_timeout: u64,
    #[serde(default)]
    transition: Option<String>,
}

const fn default_tool_timeout() -> u64 {
    DEFAULT_TOOL_TIMEOUT_SECONDS
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawInputMapping {
    #[serde(rename = "type")]
    kind: String,
    value: Value,
}

/// One UI input-mapping expression evaluated against the current graph state.
#[derive(Clone)]
pub(super) enum LlmInputMapping {
    Fixed(Value),
    Variable(String),
    Template(String),
}

/// Exact toolkit alias and concrete tool names selected on one LLM node.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct LlmToolkitSelection {
    alias: String,
    tools: Vec<String>,
}

impl LlmToolkitSelection {
    pub(crate) fn alias(&self) -> &str {
        &self.alias
    }

    pub(crate) fn tools(&self) -> &[String] {
        &self.tools
    }
}

/// Authority-free definition of one native ADK `LlmAgent` graph node.
#[derive(Clone)]
pub(crate) struct LlmNodeDefinition {
    id: String,
    input_mapping: BTreeMap<String, LlmInputMapping>,
    input: Vec<String>,
    output: Vec<String>,
    tool_selections: Vec<LlmToolkitSelection>,
    structured_output: bool,
    tool_execution_timeout: u64,
    transition: Option<String>,
}

impl LlmNodeDefinition {
    pub(super) fn from_yaml(yaml: &str) -> Result<Self, LlmConfigurationError> {
        if yaml.is_empty() || yaml.len() > MAX_NODE_YAML_BYTES {
            return Err(LlmConfigurationError::ResourceExhausted);
        }
        let raw = serde_yaml_ng::from_str::<RawLlmNodeDefinition>(yaml)
            .map_err(|source| LlmConfigurationError::MalformedYaml { source })?;
        Self::from_raw(raw)
    }

    fn from_raw(mut raw: RawLlmNodeDefinition) -> Result<Self, LlmConfigurationError> {
        if raw.node_type != "llm" {
            return Err(LlmConfigurationError::Invalid("the node type must be llm"));
        }
        if !valid_graph_id(&raw.id) {
            return Err(LlmConfigurationError::Invalid(
                "the LLM node ID is malformed",
            ));
        }
        if raw.input_mapping.len() > MAX_MAPPING_ENTRIES
            || raw.input.len() > MAX_NODE_VARIABLES
            || raw.output.len() > MAX_NODE_VARIABLES
            || raw.tool_names.len() > MAX_TOOLKITS
        {
            return Err(LlmConfigurationError::ResourceExhausted);
        }
        if raw.input.is_empty() {
            raw.input.push("messages".to_owned());
        }
        for key in raw.input.iter().chain(&raw.output) {
            if !valid_output_key(key) {
                return Err(LlmConfigurationError::Invalid(
                    "an LLM node state variable is malformed",
                ));
            }
        }
        validate_unique(&raw.input)?;
        validate_unique(&raw.output)?;
        if raw
            .output
            .iter()
            .filter(|key| key.as_str() != "messages")
            .count()
            > if raw.structured_output {
                MAX_NODE_VARIABLES
            } else {
                1
            }
        {
            return Err(LlmConfigurationError::Invalid(
                "a non-structured LLM node may write only one data output",
            ));
        }
        if raw.structured_output && raw.output.iter().all(|key| key == "messages") {
            return Err(LlmConfigurationError::Invalid(
                "a structured LLM node must declare a data output",
            ));
        }
        if raw.tool_execution_timeout == 0 || raw.tool_execution_timeout > MAX_TOOL_TIMEOUT_SECONDS
        {
            return Err(LlmConfigurationError::Invalid(
                "the LLM tool timeout is outside its approved range",
            ));
        }
        if raw
            .transition
            .as_deref()
            .is_some_and(|target| target != "END" && !valid_graph_id(target))
        {
            return Err(LlmConfigurationError::Invalid(
                "the LLM node transition is malformed",
            ));
        }

        let input_mapping = validate_input_mapping(raw.input_mapping)?;
        let tool_selections = validate_tool_selections(raw.tool_names)?;
        Ok(Self {
            id: raw.id,
            input_mapping,
            input: raw.input,
            output: raw.output,
            tool_selections,
            structured_output: raw.structured_output,
            tool_execution_timeout: raw.tool_execution_timeout,
            transition: raw.transition,
        })
    }

    pub(crate) fn id(&self) -> &str {
        &self.id
    }

    pub(super) fn input_keys(&self) -> &[String] {
        &self.input
    }

    pub(super) fn output_keys(&self) -> &[String] {
        &self.output
    }

    pub(super) fn transition(&self) -> Option<&str> {
        self.transition.as_deref()
    }

    pub(super) fn input_mapping(&self) -> &BTreeMap<String, LlmInputMapping> {
        &self.input_mapping
    }

    pub(crate) fn tool_selections(&self) -> &[LlmToolkitSelection] {
        &self.tool_selections
    }

    pub(super) const fn structured_output(&self) -> bool {
        self.structured_output
    }

    pub(crate) const fn tool_execution_timeout(&self) -> u64 {
        self.tool_execution_timeout
    }

    /// Build the exact JSON Schema ADK validates before graph-state projection.
    pub(crate) fn output_schema(
        &self,
        state_types: &BTreeMap<String, String>,
    ) -> Result<Option<Value>, LlmConfigurationError> {
        if !self.structured_output {
            return Ok(None);
        }
        let mut properties = Map::new();
        let mut required = Vec::new();
        for key in self.output.iter().filter(|key| key.as_str() != "messages") {
            let kind = state_types.get(key).ok_or(LlmConfigurationError::Invalid(
                "an LLM output is not declared in pipeline state",
            ))?;
            properties.insert(key.clone(), state_type_schema(kind)?);
            required.push(Value::String(key.clone()));
        }
        Ok(Some(json!({
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": false
        })))
    }

    /// Project the final ADK response into the Python-compatible graph shape.
    ///
    /// Messages are always retained. Structured JSON fields are matched to
    /// their declared state keys; a non-structured response is copied to the
    /// first non-message output, matching the active SDK behavior.
    pub(super) fn project_response(
        &self,
        text: &str,
        state_types: &BTreeMap<String, String>,
    ) -> Result<BTreeMap<String, Value>, LlmExecutionError> {
        if text.len() > MAX_NODE_YAML_BYTES {
            return Err(LlmExecutionError::ResourceExhausted);
        }
        let mut updates = BTreeMap::new();
        updates.insert(
            "messages".to_owned(),
            json!([{"role": "assistant", "content": text}]),
        );
        let outputs = self.output.iter().filter(|key| key.as_str() != "messages");
        if self.structured_output {
            let object = serde_json::from_str::<Value>(text)
                .ok()
                .and_then(|value| value.as_object().cloned())
                .ok_or(LlmExecutionError::InvalidStructuredOutput)?;
            let expected = self
                .output
                .iter()
                .filter(|key| key.as_str() != "messages")
                .collect::<BTreeSet<_>>();
            if object.len() != expected.len() || object.keys().any(|key| !expected.contains(key)) {
                return Err(LlmExecutionError::InvalidStructuredOutput);
            }
            for key in outputs {
                let value = object
                    .get(key)
                    .cloned()
                    .ok_or(LlmExecutionError::InvalidStructuredOutput)?;
                let kind = state_types
                    .get(key)
                    .ok_or(LlmExecutionError::InvalidStructuredOutput)?;
                if !state_value_matches(kind, &value) {
                    return Err(LlmExecutionError::InvalidStructuredOutput);
                }
                updates.insert(key.clone(), value);
            }
        } else if let Some(key) = outputs.into_iter().next() {
            updates.insert(key.clone(), Value::String(text.to_owned()));
        }
        Ok(updates)
    }

    fn map_execution_input(&self, state: &State) -> Result<LlmExecutionInput, LlmExecutionError> {
        let mut mapped = BTreeMap::new();
        for (key, mapping) in &self.input_mapping {
            let value = match mapping {
                LlmInputMapping::Fixed(value) => value.clone(),
                LlmInputMapping::Variable(source) => state
                    .get(source)
                    .cloned()
                    .unwrap_or(Value::String(String::new())),
                LlmInputMapping::Template(template) => {
                    Value::String(render_fstring(template, state)?)
                }
            };
            mapped.insert(key.as_str(), value);
        }

        if let Some(messages) = mapped.get("messages") {
            let mut contents = parse_messages(messages)?;
            let task = contents
                .pop()
                .filter(|content| content.role == "user")
                .ok_or(LlmExecutionError::InvalidInputMapping)?;
            return Ok(LlmExecutionInput {
                system: String::new(),
                task,
                history: contents,
            });
        }

        let system = mapped
            .get("system")
            .map(value_as_bounded_text)
            .transpose()?
            .unwrap_or_default();
        let task_text = mapped
            .get("task")
            .map(value_as_bounded_text)
            .transpose()?
            .unwrap_or_default();
        let history = mapped
            .get("chat_history")
            .map(parse_messages)
            .transpose()?
            .unwrap_or_default();
        if task_text.is_empty() && history.last().is_none_or(|content| content.role != "tool") {
            return Err(LlmExecutionError::InvalidInputMapping);
        }
        Ok(LlmExecutionInput {
            system,
            task: Content::new("user").with_text(task_text),
            history,
        })
    }

    pub(super) fn config_digest(&self) -> [u8; 32] {
        let mut context = digest::Context::new(&digest::SHA256);
        context.update(CONFIG_DIGEST_DOMAIN);
        digest_field(&mut context, self.id.as_bytes());
        for (key, mapping) in &self.input_mapping {
            digest_field(&mut context, key.as_bytes());
            match mapping {
                LlmInputMapping::Fixed(value) => {
                    digest_field(&mut context, b"fixed");
                    digest_field(&mut context, &serde_json::to_vec(value).unwrap_or_default());
                }
                LlmInputMapping::Variable(value) => {
                    digest_field(&mut context, b"variable");
                    digest_field(&mut context, value.as_bytes());
                }
                LlmInputMapping::Template(value) => {
                    digest_field(&mut context, b"fstring");
                    digest_field(&mut context, value.as_bytes());
                }
            }
        }
        for key in &self.input {
            digest_field(&mut context, key.as_bytes());
        }
        for key in &self.output {
            digest_field(&mut context, key.as_bytes());
        }
        for selection in &self.tool_selections {
            digest_field(&mut context, selection.alias.as_bytes());
            for tool in &selection.tools {
                digest_field(&mut context, tool.as_bytes());
            }
        }
        digest_field(&mut context, &[u8::from(self.structured_output)]);
        digest_field(&mut context, &self.tool_execution_timeout.to_be_bytes());
        digest_field(
            &mut context,
            self.transition.as_deref().unwrap_or_default().as_bytes(),
        );
        copy_digest(context.finish().as_ref())
    }
}

/// Prompt material passed to an invocation-owned ADK `LlmAgent`.
pub(crate) struct LlmExecutionInput {
    system: String,
    task: Content,
    history: Vec<Content>,
}

impl LlmExecutionInput {
    pub(crate) fn system(&self) -> &str {
        &self.system
    }
}

/// Invocation-owned factory that binds a fresh model and exact node toolsets.
pub(crate) trait PipelineLlmAgentFactory: Send + Sync {
    fn build(
        &self,
        definition: &LlmNodeDefinition,
        input: &LlmExecutionInput,
        output_schema: Option<Value>,
    ) -> Result<Arc<dyn Agent>, LlmExecutionError>;
}

/// Native ADK agent node with Elitea YAML input/output projection.
pub(super) struct LlmNode {
    definition: LlmNodeDefinition,
    state_types: BTreeMap<String, String>,
    factory: Arc<dyn PipelineLlmAgentFactory>,
}

impl LlmNode {
    pub(super) fn new(
        definition: LlmNodeDefinition,
        state_types: BTreeMap<String, String>,
        factory: Arc<dyn PipelineLlmAgentFactory>,
    ) -> Self {
        Self {
            definition,
            state_types,
            factory,
        }
    }
}

#[async_trait]
impl Node for LlmNode {
    fn name(&self) -> &str {
        self.definition.id()
    }

    async fn execute(&self, context: &NodeContext) -> Result<NodeOutput, GraphError> {
        let selected_toolkit_count = self.definition.tool_selections().len();
        let selected_tool_count = self
            .definition
            .tool_selections()
            .iter()
            .map(|selection| selection.tools().len())
            .sum::<usize>();
        let span = tracing::info_span!(
            "agent.pipeline.llm_node",
            node_id = self.name(),
            selected_toolkit_count,
            selected_tool_count,
            structured_output = self.definition.structured_output(),
            stage = tracing::field::Empty,
            outcome = tracing::field::Empty,
            error_code = tracing::field::Empty,
        );
        let result = async {
            tracing::Span::current().record("stage", "input_mapping");
            let input = self
                .definition
                .map_execution_input(&context.state)
                .map_err(|_| node_failure(self.name()))?;
            tracing::Span::current().record("stage", "agent_binding");
            let agent = self
                .factory
                .build(
                    &self.definition,
                    &input,
                    self.definition
                        .output_schema(&self.state_types)
                        .map_err(|_| node_failure(self.name()))?,
                )
                .map_err(|_| node_failure(self.name()))?;
            let invocation = Arc::new(PipelineLlmInvocationContext::new(
                &context.config.thread_id,
                input,
                agent.clone(),
                context.config.parent_context.clone(),
            ));
            tracing::Span::current().record("stage", "model_tool_loop");
            let stream = agent
                .run(invocation)
                .await
                .map_err(|_| node_failure(self.name()))?;
            tokio::pin!(stream);
            let mut events = Vec::new();
            while let Some(event) = stream.next().await {
                events.push(event.map_err(|_| node_failure(self.name()))?);
            }
            tracing::Span::current().record("stage", "state_projection");
            let text = last_model_text(&events).ok_or_else(|| node_failure(self.name()))?;
            let updates = self
                .definition
                .project_response(&text, &self.state_types)
                .map_err(|_| node_failure(self.name()))?;
            let mut output = NodeOutput::new();
            for (key, value) in updates {
                output = output.with_update(&key, value);
            }
            Ok(output)
        }
        .instrument(span.clone())
        .await;
        if result.is_ok() {
            span.record("outcome", "completed");
        } else {
            span.record("outcome", "failed");
            span.record("error_code", "pipeline.llm_node.failed");
        }
        result
    }
}

fn node_failure(node: &str) -> GraphError {
    GraphError::NodeExecutionFailed {
        node: node.to_owned(),
        message: "the pipeline LLM node failed".to_owned(),
    }
}

fn last_model_text(events: &[adk_rust::Event]) -> Option<String> {
    events.iter().rev().find_map(|event| {
        let content = event.content()?;
        let text = content
            .parts
            .iter()
            .filter_map(Part::text)
            .collect::<Vec<_>>()
            .join("");
        (!text.is_empty()).then_some(text)
    })
}

fn render_fstring(template: &str, state: &State) -> Result<String, LlmExecutionError> {
    let mut rendered = String::with_capacity(template.len());
    let mut cursor = 0;
    while let Some(relative_open) = template[cursor..].find('{') {
        let open = cursor + relative_open;
        rendered.push_str(&template[cursor..open]);
        let Some(relative_end) = template[open + 1..].find('}') else {
            rendered.push_str(&template[open..]);
            cursor = template.len();
            break;
        };
        let end = open + 1 + relative_end;
        let key = &template[open + 1..end];
        if valid_output_key(key)
            && key
                .bytes()
                .all(|byte| byte == b'_' || byte.is_ascii_alphanumeric())
        {
            if let Some(value) = state.get(key) {
                let value = normalize_mapping_value(value)?;
                rendered.push_str(&value);
            } else {
                rendered.push_str(&template[open..=end]);
            }
            cursor = end + 1;
        } else {
            rendered.push('{');
            cursor = open + 1;
        }
        if rendered.len() > MAX_RENDERED_INPUT_BYTES {
            return Err(LlmExecutionError::ResourceExhausted);
        }
    }
    if cursor < template.len() {
        rendered.push_str(&template[cursor..]);
    }
    if rendered.len() > MAX_RENDERED_INPUT_BYTES {
        return Err(LlmExecutionError::ResourceExhausted);
    }
    Ok(rendered)
}

fn normalize_mapping_value(value: &Value) -> Result<String, LlmExecutionError> {
    match value {
        Value::String(value) => Ok(value.clone()),
        value => serde_json::to_string(value).map_err(|_| LlmExecutionError::InvalidInputMapping),
    }
}

fn value_as_bounded_text(value: &Value) -> Result<String, LlmExecutionError> {
    let text = normalize_mapping_value(value)?;
    if text.len() > MAX_RENDERED_INPUT_BYTES || text.contains('\0') {
        return Err(LlmExecutionError::ResourceExhausted);
    }
    Ok(text)
}

fn parse_messages(value: &Value) -> Result<Vec<Content>, LlmExecutionError> {
    let values = value
        .as_array()
        .ok_or(LlmExecutionError::InvalidInputMapping)?;
    if values.len() > MAX_NODE_VARIABLES * 16 {
        return Err(LlmExecutionError::ResourceExhausted);
    }
    values
        .iter()
        .map(|message| {
            let object = message
                .as_object()
                .ok_or(LlmExecutionError::InvalidInputMapping)?;
            let role = object
                .get("role")
                .and_then(Value::as_str)
                .filter(|role| matches!(*role, "user" | "assistant" | "model" | "tool"))
                .ok_or(LlmExecutionError::InvalidInputMapping)?;
            let role = if role == "assistant" { "model" } else { role };
            parse_message_content(role, object.get("content"))
        })
        .collect()
}

fn parse_message_content(role: &str, value: Option<&Value>) -> Result<Content, LlmExecutionError> {
    let value = value.ok_or(LlmExecutionError::InvalidInputMapping)?;
    if value.is_string() {
        let text = value_as_bounded_text(value)?;
        if text.is_empty() {
            return Err(LlmExecutionError::InvalidInputMapping);
        }
        return Ok(Content::new(role).with_text(text));
    }
    let blocks = value
        .as_array()
        .filter(|blocks| blocks.len() <= MAX_NODE_VARIABLES * 4)
        .ok_or(LlmExecutionError::InvalidInputMapping)?;
    let mut content = Content::new(role);
    let mut total_bytes = 0_usize;
    for block in blocks {
        let text = match block {
            Value::String(_) => value_as_bounded_text(block)?,
            Value::Object(block) => {
                let block_type = block.get("type").and_then(Value::as_str).unwrap_or("text");
                if !matches!(block_type, "text" | "input_text" | "output_text") {
                    // Images and tool-call/result blocks need their exact ADK
                    // part authority; serializing them as prompt text would be
                    // a lossy and potentially privileged conversion.
                    return Err(LlmExecutionError::InvalidInputMapping);
                }
                block
                    .get("text")
                    .map(value_as_bounded_text)
                    .transpose()?
                    .ok_or(LlmExecutionError::InvalidInputMapping)?
            }
            _ => return Err(LlmExecutionError::InvalidInputMapping),
        };
        if text.is_empty() {
            continue;
        }
        total_bytes = total_bytes
            .checked_add(text.len())
            .ok_or(LlmExecutionError::ResourceExhausted)?;
        if total_bytes > MAX_RENDERED_INPUT_BYTES {
            return Err(LlmExecutionError::ResourceExhausted);
        }
        content = content.with_text(text);
    }
    if content.parts.is_empty() {
        return Err(LlmExecutionError::InvalidInputMapping);
    }
    Ok(content)
}

struct PipelineLlmInvocationContext {
    invocation_id: String,
    user_content: Content,
    agent: Arc<dyn Agent>,
    session: PipelineLlmSession,
    run_config: adk_rust::RunConfig,
    parent: Option<Arc<dyn InvocationContext>>,
    ended: AtomicBool,
    user_id: String,
    app_name: String,
    branch: String,
}

impl PipelineLlmInvocationContext {
    fn new(
        session_id: &str,
        input: LlmExecutionInput,
        agent: Arc<dyn Agent>,
        parent: Option<Arc<dyn InvocationContext>>,
    ) -> Self {
        let (user_id, app_name, branch, run_config) = parent.as_ref().map_or_else(
            || {
                (
                    "graph_user".to_owned(),
                    "graph_app".to_owned(),
                    "main".to_owned(),
                    adk_rust::RunConfig::default(),
                )
            },
            |parent| {
                (
                    parent.user_id().to_owned(),
                    parent.app_name().to_owned(),
                    if parent.branch().is_empty() {
                        agent.name().to_owned()
                    } else {
                        format!("{}.{}", parent.branch(), agent.name())
                    },
                    parent.run_config().clone(),
                )
            },
        );
        Self {
            invocation_id: format!(
                "{session_id}:{}:{}",
                agent.name(),
                LLM_INVOCATION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ),
            user_content: input.task,
            agent,
            session: PipelineLlmSession::new(session_id, &app_name, &user_id, input.history),
            run_config,
            parent,
            ended: AtomicBool::new(false),
            user_id,
            app_name,
            branch,
        }
    }
}

impl adk_rust::ReadonlyContext for PipelineLlmInvocationContext {
    fn invocation_id(&self) -> &str {
        &self.invocation_id
    }
    fn agent_name(&self) -> &str {
        self.agent.name()
    }
    fn user_id(&self) -> &str {
        &self.user_id
    }
    fn app_name(&self) -> &str {
        &self.app_name
    }
    fn session_id(&self) -> &str {
        &self.session.id
    }
    fn branch(&self) -> &str {
        &self.branch
    }
    fn user_content(&self) -> &Content {
        &self.user_content
    }
}

#[async_trait]
impl adk_rust::CallbackContext for PipelineLlmInvocationContext {
    fn artifacts(&self) -> Option<Arc<dyn adk_rust::Artifacts>> {
        self.parent.as_ref().and_then(|parent| parent.artifacts())
    }

    fn shared_state(&self) -> Option<Arc<adk_rust::SharedState>> {
        self.parent
            .as_ref()
            .and_then(|parent| parent.shared_state())
    }
}

#[async_trait]
impl InvocationContext for PipelineLlmInvocationContext {
    fn agent(&self) -> Arc<dyn Agent> {
        self.agent.clone()
    }
    fn memory(&self) -> Option<Arc<dyn adk_rust::Memory>> {
        self.parent.as_ref().and_then(|parent| parent.memory())
    }
    fn session(&self) -> &dyn adk_rust::Session {
        &self.session
    }
    fn run_config(&self) -> &adk_rust::RunConfig {
        &self.run_config
    }
    fn end_invocation(&self) {
        self.ended.store(true, Ordering::Release);
        if let Some(parent) = &self.parent {
            parent.end_invocation();
        }
    }
    fn ended(&self) -> bool {
        self.ended.load(Ordering::Acquire)
            || self.parent.as_ref().is_some_and(|parent| parent.ended())
    }
    fn is_cancelled(&self) -> bool {
        self.parent
            .as_ref()
            .is_some_and(|parent| parent.is_cancelled())
    }
    fn user_scopes(&self) -> Vec<String> {
        self.parent
            .as_ref()
            .map(|parent| parent.user_scopes())
            .unwrap_or_default()
    }
    fn request_metadata(&self) -> std::collections::HashMap<String, Value> {
        self.parent
            .as_ref()
            .map(|parent| parent.request_metadata())
            .unwrap_or_default()
    }
    async fn get_secret(&self, name: &str) -> adk_rust::Result<Option<String>> {
        match &self.parent {
            Some(parent) => parent.get_secret(name).await,
            None => Ok(None),
        }
    }
    async fn get_secret_for(
        &self,
        request: &adk_rust::SecretRequest,
    ) -> adk_rust::Result<Option<String>> {
        match &self.parent {
            Some(parent) => parent.get_secret_for(request).await,
            None => Ok(None),
        }
    }
}

struct PipelineLlmSession {
    id: String,
    app_name: String,
    user_id: String,
    state: PipelineLlmSessionState,
    history: std::sync::RwLock<Vec<Content>>,
}

impl PipelineLlmSession {
    fn new(id: &str, app_name: &str, user_id: &str, history: Vec<Content>) -> Self {
        Self {
            id: id.to_owned(),
            app_name: app_name.to_owned(),
            user_id: user_id.to_owned(),
            state: PipelineLlmSessionState::default(),
            history: std::sync::RwLock::new(history),
        }
    }
}

impl adk_rust::Session for PipelineLlmSession {
    fn id(&self) -> &str {
        &self.id
    }
    fn app_name(&self) -> &str {
        &self.app_name
    }
    fn user_id(&self) -> &str {
        &self.user_id
    }
    fn state(&self) -> &dyn adk_rust::State {
        &self.state
    }
    fn conversation_history(&self) -> Vec<Content> {
        self.history
            .read()
            .map_or_else(|_| Vec::new(), |history| history.clone())
    }
    fn append_to_history(&self, content: Content) {
        if let Ok(mut history) = self.history.write() {
            history.push(content);
        }
    }
}

#[derive(Default)]
struct PipelineLlmSessionState {
    values: std::sync::RwLock<std::collections::HashMap<String, Value>>,
}

impl adk_rust::State for PipelineLlmSessionState {
    fn get(&self, key: &str) -> Option<Value> {
        self.values.read().ok()?.get(key).cloned()
    }
    fn set(&mut self, key: String, value: Value) {
        if adk_rust::validate_state_key(&key).is_ok()
            && let Ok(mut values) = self.values.write()
        {
            values.insert(key, value);
        }
    }
    fn all(&self) -> std::collections::HashMap<String, Value> {
        self.values.read().map_or_else(
            |_| std::collections::HashMap::new(),
            |values| values.clone(),
        )
    }
}

fn validate_input_mapping(
    raw: BTreeMap<String, RawInputMapping>,
) -> Result<BTreeMap<String, LlmInputMapping>, LlmConfigurationError> {
    if raw.is_empty() {
        return Ok(BTreeMap::from([(
            "messages".to_owned(),
            LlmInputMapping::Variable("messages".to_owned()),
        )]));
    }
    let mut mapping = BTreeMap::new();
    for (key, value) in raw {
        if !matches!(
            key.as_str(),
            "system" | "task" | "chat_history" | "messages"
        ) {
            return Err(LlmConfigurationError::Unsupported(
                "the LLM input mapping contains an unsupported field",
            ));
        }
        let admitted = match value.kind.as_str() {
            "fixed" => {
                ensure_bounded_mapping_value(&value.value)?;
                LlmInputMapping::Fixed(value.value)
            }
            "variable" => {
                let key = bounded_mapping_text(&value.value)?;
                if !valid_output_key(key) {
                    return Err(LlmConfigurationError::Invalid(
                        "an LLM variable mapping is malformed",
                    ));
                }
                LlmInputMapping::Variable(key.to_owned())
            }
            "fstring" => {
                let template = bounded_mapping_text(&value.value)?;
                LlmInputMapping::Template(template.to_owned())
            }
            _ => {
                return Err(LlmConfigurationError::Unsupported(
                    "the LLM input mapping type is not supported",
                ));
            }
        };
        mapping.insert(key, admitted);
    }
    Ok(mapping)
}

fn validate_tool_selections(
    raw: BTreeMap<String, Vec<String>>,
) -> Result<Vec<LlmToolkitSelection>, LlmConfigurationError> {
    let mut selections = Vec::with_capacity(raw.len());
    let mut global_names = BTreeSet::new();
    for (alias, tools) in raw {
        if !valid_output_key(&alias) || tools.len() > MAX_TOOLS_PER_TOOLKIT {
            return Err(LlmConfigurationError::ResourceExhausted);
        }
        // The UI can retain a toolkit key after its final tool is deselected.
        // It grants no capability and must not cause credential redemption or
        // MCP discovery merely because the empty key survived in YAML.
        if tools.is_empty() {
            continue;
        }
        let mut local_names = BTreeSet::new();
        for tool in &tools {
            if !valid_output_key(tool)
                || !local_names.insert(tool.as_str())
                || !global_names.insert(tool.clone())
            {
                return Err(LlmConfigurationError::Invalid(
                    "LLM tool names must be valid and unique across selected toolkits",
                ));
            }
        }
        selections.push(LlmToolkitSelection { alias, tools });
    }
    Ok(selections)
}

fn validate_unique(values: &[String]) -> Result<(), LlmConfigurationError> {
    let mut seen = BTreeSet::new();
    if values.iter().any(|value| !seen.insert(value.as_str())) {
        return Err(LlmConfigurationError::Invalid(
            "LLM node variables must be unique within each field",
        ));
    }
    Ok(())
}

fn bounded_mapping_text(value: &Value) -> Result<&str, LlmConfigurationError> {
    value
        .as_str()
        .filter(|value| value.len() <= MAX_MAPPING_TEXT_BYTES && !value.contains('\0'))
        .ok_or(LlmConfigurationError::Invalid(
            "an LLM input mapping value is malformed",
        ))
}

fn ensure_bounded_mapping_value(value: &Value) -> Result<(), LlmConfigurationError> {
    let encoded = serde_json::to_vec(value).map_err(|_| {
        LlmConfigurationError::Invalid("an LLM fixed input mapping value is malformed")
    })?;
    if encoded.len() > MAX_MAPPING_TEXT_BYTES {
        return Err(LlmConfigurationError::ResourceExhausted);
    }
    Ok(())
}

fn state_type_schema(kind: &str) -> Result<Value, LlmConfigurationError> {
    let schema = match kind {
        "str" => json!({"type": "string"}),
        "int" => json!({"type": "integer"}),
        "float" => json!({"type": "number"}),
        "bool" => json!({"type": "boolean"}),
        "list" => json!({"type": "array"}),
        "dict" => json!({"type": "object"}),
        _ => {
            return Err(LlmConfigurationError::Unsupported(
                "an LLM output uses an unsupported state type",
            ));
        }
    };
    Ok(schema)
}

fn state_value_matches(kind: &str, value: &Value) -> bool {
    match kind {
        "str" => value.is_string(),
        "int" => value.as_i64().is_some() || value.as_u64().is_some(),
        "float" => value.as_f64().is_some_and(f64::is_finite),
        "bool" => value.is_boolean(),
        "list" => value.is_array(),
        "dict" => value.is_object(),
        _ => false,
    }
}

fn digest_field(context: &mut digest::Context, value: &[u8]) {
    context.update(&(value.len() as u64).to_be_bytes());
    context.update(value);
}

fn copy_digest(value: &[u8]) -> [u8; 32] {
    let mut digest = [0_u8; 32];
    digest.copy_from_slice(value);
    digest
}

#[derive(Debug, Error)]
pub(crate) enum LlmConfigurationError {
    #[error("the LLM node YAML is malformed")]
    MalformedYaml {
        #[source]
        source: serde_yaml_ng::Error,
    },
    #[error("{0}")]
    Invalid(&'static str),
    #[error("{0}")]
    Unsupported(&'static str),
    #[error("the LLM node exceeds its resource bound")]
    ResourceExhausted,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub(crate) enum LlmExecutionError {
    #[error("the LLM input mapping is invalid")]
    InvalidInputMapping,
    #[error("the LLM structured output is invalid")]
    InvalidStructuredOutput,
    #[error("the LLM output exceeds its resource bound")]
    ResourceExhausted,
    #[error("the LLM runtime is unavailable")]
    Unavailable,
}

//! Native direct Toolkit pipeline node.
//!
//! The stored YAML selects one concrete action from one frozen toolkit alias.
//! Assembly resolves that pair after claim-authorized materialization; the graph
//! node then maps state into JSON arguments and invokes the native ADK [`Tool`]
//! exactly once. It never creates a second agent/model turn.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};

use adk_rust::graph::{GraphError, Node, NodeContext, NodeOutput, State};
use adk_rust::tool::SimpleToolContext;
use adk_rust::{
    CallbackContext, Content, EventActions, InvocationContext, MemoryEntry, ReadonlyContext,
    SecretRequest, Tool, ToolContext,
};
use async_trait::async_trait;
use ring::digest;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use thiserror::Error;
use tracing::Instrument as _;

use super::yaml::{valid_graph_id, valid_output_key};

const MAX_NODE_YAML_BYTES: usize = 64 * 1024;
const MAX_MAPPING_ENTRIES: usize = 256;
const MAX_NODE_VARIABLES: usize = 64;
const MAX_TOOL_IDENTITY_BYTES: usize = 1_024;
const MAX_MAPPING_VALUE_BYTES: usize = 64 * 1024;
const MAX_RESULT_BYTES: usize = 512 * 1024;
const CONFIG_DIGEST_DOMAIN: &[u8] = b"elitea.graph.direct_tool.config.v1\0";

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawDirectToolNodeDefinition {
    id: String,
    #[serde(rename = "type")]
    node_type: String,
    toolkit_name: String,
    tool: String,
    #[serde(default)]
    input_mapping: BTreeMap<String, RawInputMapping>,
    #[serde(default)]
    input: Vec<String>,
    #[serde(default)]
    output: Vec<String>,
    #[serde(default)]
    structured_output: bool,
    #[serde(default)]
    transition: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawInputMapping {
    #[serde(rename = "type")]
    kind: String,
    value: Value,
}

/// One direct-tool argument mapping evaluated against checkpointed state.
#[derive(Clone)]
pub(super) enum DirectToolInputMapping {
    Fixed(Value),
    Variable(String),
    Template(String),
}

/// Exact configured-tool identity selected by one Toolkit node.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct DirectToolSelection {
    alias: String,
    tool: String,
}

impl DirectToolSelection {
    pub(crate) fn alias(&self) -> &str {
        &self.alias
    }

    pub(crate) fn tool(&self) -> &str {
        &self.tool
    }
}

/// Strict, authority-free Toolkit node definition.
#[derive(Clone)]
pub(crate) struct DirectToolNodeDefinition {
    id: String,
    selection: DirectToolSelection,
    input_mapping: BTreeMap<String, DirectToolInputMapping>,
    input: Vec<String>,
    output: Vec<String>,
    structured_output: bool,
    transition: Option<String>,
}

impl DirectToolNodeDefinition {
    pub(super) fn from_yaml(yaml: &str) -> Result<Self, DirectToolConfigurationError> {
        if yaml.is_empty() || yaml.len() > MAX_NODE_YAML_BYTES {
            return Err(DirectToolConfigurationError::ResourceExhausted);
        }
        let raw = serde_yaml_ng::from_str::<RawDirectToolNodeDefinition>(yaml)
            .map_err(|source| DirectToolConfigurationError::MalformedYaml { source })?;
        Self::from_raw(raw)
    }

    fn from_raw(
        mut raw: RawDirectToolNodeDefinition,
    ) -> Result<Self, DirectToolConfigurationError> {
        if raw.node_type != "toolkit" {
            return Err(DirectToolConfigurationError::Invalid(
                "the node type must be toolkit",
            ));
        }
        if !valid_graph_id(&raw.id) {
            return Err(DirectToolConfigurationError::Invalid(
                "the Toolkit node ID is malformed",
            ));
        }
        if !valid_tool_identity(&raw.toolkit_name) || !valid_tool_identity(&raw.tool) {
            return Err(DirectToolConfigurationError::Invalid(
                "the Toolkit node tool identity is malformed",
            ));
        }
        if raw.input_mapping.len() > MAX_MAPPING_ENTRIES
            || raw.input.len() > MAX_NODE_VARIABLES
            || raw.output.len() > MAX_NODE_VARIABLES
        {
            return Err(DirectToolConfigurationError::ResourceExhausted);
        }
        if raw.input.is_empty() {
            raw.input.push("messages".to_owned());
        }
        for key in raw.input.iter().chain(&raw.output) {
            if !valid_output_key(key) {
                return Err(DirectToolConfigurationError::Invalid(
                    "a Toolkit node state variable is malformed",
                ));
            }
        }
        validate_unique(&raw.input)?;
        validate_unique(&raw.output)?;
        if raw.structured_output && raw.output.iter().all(|key| key == "messages") {
            return Err(DirectToolConfigurationError::Invalid(
                "structured Toolkit output requires a data state variable",
            ));
        }
        if raw
            .transition
            .as_deref()
            .is_some_and(|target| target != "END" && !valid_graph_id(target))
        {
            return Err(DirectToolConfigurationError::Invalid(
                "the Toolkit node transition is malformed",
            ));
        }
        let input_mapping = validate_input_mapping(raw.input_mapping)?;
        Ok(Self {
            id: raw.id,
            selection: DirectToolSelection {
                alias: raw.toolkit_name,
                tool: raw.tool,
            },
            input_mapping,
            input: raw.input,
            output: raw.output,
            structured_output: raw.structured_output,
            transition: raw.transition,
        })
    }

    pub(crate) fn id(&self) -> &str {
        &self.id
    }

    pub(crate) const fn selection(&self) -> &DirectToolSelection {
        &self.selection
    }

    pub(super) fn input_keys(&self) -> &[String] {
        &self.input
    }

    pub(super) fn output_keys(&self) -> &[String] {
        &self.output
    }

    pub(super) fn input_mapping(&self) -> &BTreeMap<String, DirectToolInputMapping> {
        &self.input_mapping
    }

    pub(super) const fn structured_output(&self) -> bool {
        self.structured_output
    }

    pub(super) fn transition(&self) -> Option<&str> {
        self.transition.as_deref()
    }

    pub(super) fn config_digest(&self) -> [u8; 32] {
        let mut context = digest::Context::new(&digest::SHA256);
        context.update(CONFIG_DIGEST_DOMAIN);
        digest_field(&mut context, self.id.as_bytes());
        digest_field(&mut context, self.selection.alias.as_bytes());
        digest_field(&mut context, self.selection.tool.as_bytes());
        for (key, mapping) in &self.input_mapping {
            digest_field(&mut context, key.as_bytes());
            match mapping {
                DirectToolInputMapping::Fixed(value) => {
                    digest_field(&mut context, b"fixed");
                    digest_field(&mut context, &serde_json::to_vec(value).unwrap_or_default());
                }
                DirectToolInputMapping::Variable(value) => {
                    digest_field(&mut context, b"variable");
                    digest_field(&mut context, value.as_bytes());
                }
                DirectToolInputMapping::Template(value) => {
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
        digest_field(&mut context, &[u8::from(self.structured_output)]);
        digest_field(
            &mut context,
            self.transition.as_deref().unwrap_or_default().as_bytes(),
        );
        copy_digest(context.finish().as_ref())
    }

    fn map_arguments(&self, state: &State) -> Result<Value, DirectToolExecutionError> {
        let mut arguments = Map::new();
        for (key, mapping) in &self.input_mapping {
            let value = match mapping {
                DirectToolInputMapping::Fixed(value) => value.clone(),
                DirectToolInputMapping::Variable(source) => state
                    .get(source)
                    .cloned()
                    .unwrap_or(Value::String(String::new())),
                DirectToolInputMapping::Template(template) => {
                    Value::String(render_fstring(template, state)?)
                }
            };
            arguments.insert(key.clone(), value);
        }
        ensure_bounded_value(&Value::Object(arguments.clone()))?;
        Ok(Value::Object(arguments))
    }

    fn project_result(
        &self,
        result: Value,
        state_types: &BTreeMap<String, String>,
    ) -> Result<BTreeMap<String, Value>, DirectToolExecutionError> {
        ensure_bounded_value(&result)?;
        let mut updates = BTreeMap::new();
        if self.output.is_empty() {
            updates.insert("messages".to_owned(), assistant_message(&result)?);
            return Ok(updates);
        }

        if self.structured_output {
            let object = result
                .as_object()
                .ok_or(DirectToolExecutionError::InvalidResult)?;
            for key in self.output.iter().filter(|key| key.as_str() != "messages") {
                let value = object
                    .get(key)
                    .cloned()
                    .ok_or(DirectToolExecutionError::InvalidResult)?;
                ensure_state_type(key, &value, state_types)?;
                updates.insert(key.clone(), value);
            }
            if self.output.iter().any(|key| key == "messages") {
                updates.insert("messages".to_owned(), projected_messages(&result)?);
            }
        } else if self.output.iter().any(|key| key == "messages") {
            updates.insert("messages".to_owned(), projected_messages(&result)?);
            for key in self.output.iter().filter(|key| key.as_str() != "messages") {
                let value = result
                    .as_object()
                    .and_then(|object| object.get(key))
                    .cloned()
                    .unwrap_or_else(|| result.clone());
                ensure_state_type(key, &value, state_types)?;
                updates.insert(key.clone(), value);
            }
        } else if let Some(key) = self.output.first() {
            ensure_state_type(key, &result, state_types)?;
            updates.insert(key.clone(), result);
        }
        ensure_bounded_value(&serde_json::to_value(&updates).unwrap_or(Value::Null))?;
        Ok(updates)
    }
}

/// Invocation-owned lookup of an already materialized concrete tool.
pub(crate) trait PipelineDirectToolResolver: Send + Sync {
    fn resolve(
        &self,
        selection: &DirectToolSelection,
    ) -> Result<Arc<dyn Tool>, DirectToolExecutionError>;
}

/// Native graph node that invokes one exact ADK tool.
pub(super) struct DirectToolNode {
    definition: DirectToolNodeDefinition,
    state_types: BTreeMap<String, String>,
    resolver: Arc<dyn PipelineDirectToolResolver>,
}

impl DirectToolNode {
    pub(super) fn new(
        definition: DirectToolNodeDefinition,
        state_types: BTreeMap<String, String>,
        resolver: Arc<dyn PipelineDirectToolResolver>,
    ) -> Self {
        Self {
            definition,
            state_types,
            resolver,
        }
    }
}

#[async_trait]
impl Node for DirectToolNode {
    fn name(&self) -> &str {
        self.definition.id()
    }

    async fn execute(&self, context: &NodeContext) -> Result<NodeOutput, GraphError> {
        let span = tracing::info_span!(
            "agent.pipeline.toolkit_node",
            node_id = self.name(),
            toolkit_name = self.definition.selection().alias(),
            tool_name = self.definition.selection().tool(),
            structured_output = self.definition.structured_output(),
            stage = tracing::field::Empty,
            outcome = tracing::field::Empty,
            error_code = tracing::field::Empty,
        );
        let result = async {
            tracing::Span::current().record("stage", "input_mapping");
            let arguments = self
                .definition
                .map_arguments(&context.state)
                .map_err(|_| node_failure(self.name()))?;
            tracing::Span::current().record("stage", "tool_binding");
            let tool = self
                .resolver
                .resolve(self.definition.selection())
                .map_err(|_| node_failure(self.name()))?;
            if !tool.is_read_only() {
                return Err(node_failure(self.name()));
            }
            let tool_context = pipeline_tool_context(context, self.name(), tool.name());
            let granted_scopes = tool_context.user_scopes();
            if tool
                .required_scopes()
                .iter()
                .any(|required| !granted_scopes.iter().any(|granted| granted == required))
            {
                return Err(node_failure(self.name()));
            }
            tracing::Span::current().record("stage", "tool_execution");
            let result = tool
                .execute(tool_context, arguments)
                .await
                .map_err(|_| node_failure(self.name()))?;
            tracing::Span::current().record("stage", "state_projection");
            let updates = self
                .definition
                .project_result(result, &self.state_types)
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
            span.record("error_code", "pipeline.toolkit_node.failed");
        }
        result
    }
}

fn pipeline_tool_context(
    context: &NodeContext,
    node_name: &str,
    tool_name: &str,
) -> Arc<dyn ToolContext> {
    // The graph step is checkpointed by ADK. Including it makes this identity
    // stable across resume while keeping two visits to a looped node distinct.
    let call_id = format!("pipeline:{node_name}:{}", context.step);
    match context.config.parent_context.clone() {
        Some(parent) => Arc::new(PipelineToolContext::new(parent, call_id, tool_name)),
        None => Arc::new(
            SimpleToolContext::new(node_name)
                .with_function_call_id(call_id)
                .with_session_id(&context.config.thread_id),
        ),
    }
}

struct PipelineToolContext {
    parent: Arc<dyn InvocationContext>,
    function_call_id: String,
    tool_name: String,
    actions: Mutex<EventActions>,
}

impl PipelineToolContext {
    fn new(parent: Arc<dyn InvocationContext>, function_call_id: String, tool_name: &str) -> Self {
        Self {
            parent,
            function_call_id,
            tool_name: tool_name.to_owned(),
            actions: Mutex::new(EventActions::default()),
        }
    }

    async fn request_secret(
        &self,
        name: &str,
        purpose: Option<&str>,
    ) -> adk_rust::Result<Option<String>> {
        let mut request = SecretRequest::new(name)
            .with_identity(
                self.parent.app_name(),
                self.parent.user_id(),
                self.parent.session_id(),
            )
            .with_invocation_id(self.parent.invocation_id())
            .with_tool_name(&self.tool_name);
        if let Some(purpose) = purpose {
            request = request.with_purpose(purpose);
        }
        self.parent.get_secret_for(&request).await
    }
}

impl ReadonlyContext for PipelineToolContext {
    fn invocation_id(&self) -> &str {
        self.parent.invocation_id()
    }

    fn agent_name(&self) -> &str {
        self.parent.agent_name()
    }

    fn user_id(&self) -> &str {
        self.parent.user_id()
    }

    fn app_name(&self) -> &str {
        self.parent.app_name()
    }

    fn session_id(&self) -> &str {
        self.parent.session_id()
    }

    fn branch(&self) -> &str {
        self.parent.branch()
    }

    fn user_content(&self) -> &Content {
        self.parent.user_content()
    }
}

#[async_trait]
impl CallbackContext for PipelineToolContext {
    fn artifacts(&self) -> Option<Arc<dyn adk_rust::Artifacts>> {
        self.parent.artifacts()
    }

    fn shared_state(&self) -> Option<Arc<adk_rust::SharedState>> {
        self.parent.shared_state()
    }
}

#[async_trait]
impl ToolContext for PipelineToolContext {
    fn function_call_id(&self) -> &str {
        &self.function_call_id
    }

    fn actions(&self) -> EventActions {
        self.actions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    fn set_actions(&self, actions: EventActions) {
        *self
            .actions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = actions;
    }

    async fn search_memory(&self, query: &str) -> adk_rust::Result<Vec<MemoryEntry>> {
        match self.parent.memory() {
            Some(memory) => memory.search(query).await,
            None => Ok(Vec::new()),
        }
    }

    fn user_scopes(&self) -> Vec<String> {
        self.parent.user_scopes()
    }

    async fn get_secret(&self, name: &str) -> adk_rust::Result<Option<String>> {
        self.request_secret(name, None).await
    }

    async fn get_secret_for_purpose(
        &self,
        name: &str,
        purpose: &str,
    ) -> adk_rust::Result<Option<String>> {
        self.request_secret(name, Some(purpose)).await
    }
}

fn validate_input_mapping(
    raw: BTreeMap<String, RawInputMapping>,
) -> Result<BTreeMap<String, DirectToolInputMapping>, DirectToolConfigurationError> {
    if raw.is_empty() {
        return Ok(BTreeMap::from([(
            "messages".to_owned(),
            DirectToolInputMapping::Variable("messages".to_owned()),
        )]));
    }
    let mut mapping = BTreeMap::new();
    for (key, value) in raw {
        if !valid_tool_identity(&key) {
            return Err(DirectToolConfigurationError::Invalid(
                "a Toolkit argument name is malformed",
            ));
        }
        let admitted = match value.kind.as_str() {
            "fixed" => {
                ensure_bounded_mapping_value(&value.value)?;
                DirectToolInputMapping::Fixed(value.value)
            }
            "variable" => {
                let key = bounded_mapping_text(&value.value)?;
                if !valid_output_key(key) {
                    return Err(DirectToolConfigurationError::Invalid(
                        "a Toolkit variable mapping is malformed",
                    ));
                }
                DirectToolInputMapping::Variable(key.to_owned())
            }
            "fstring" => {
                DirectToolInputMapping::Template(bounded_mapping_text(&value.value)?.to_owned())
            }
            _ => {
                return Err(DirectToolConfigurationError::Unsupported(
                    "the Toolkit input mapping type is not supported",
                ));
            }
        };
        mapping.insert(key, admitted);
    }
    Ok(mapping)
}

fn validate_unique(values: &[String]) -> Result<(), DirectToolConfigurationError> {
    let mut seen = BTreeSet::new();
    if values.iter().any(|value| !seen.insert(value.as_str())) {
        return Err(DirectToolConfigurationError::Invalid(
            "Toolkit node variables must be unique within each field",
        ));
    }
    Ok(())
}

fn valid_tool_identity(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_TOOL_IDENTITY_BYTES
        && !value.bytes().any(|byte| matches!(byte, 0 | b'\r' | b'\n'))
}

fn bounded_mapping_text(value: &Value) -> Result<&str, DirectToolConfigurationError> {
    value
        .as_str()
        .filter(|value| value.len() <= MAX_MAPPING_VALUE_BYTES && !value.contains('\0'))
        .ok_or(DirectToolConfigurationError::Invalid(
            "a Toolkit input mapping value is malformed",
        ))
}

fn ensure_bounded_mapping_value(value: &Value) -> Result<(), DirectToolConfigurationError> {
    let encoded = serde_json::to_vec(value).map_err(|_| {
        DirectToolConfigurationError::Invalid("a Toolkit fixed input mapping value is malformed")
    })?;
    if encoded.len() > MAX_MAPPING_VALUE_BYTES {
        return Err(DirectToolConfigurationError::ResourceExhausted);
    }
    Ok(())
}

fn render_fstring(template: &str, state: &State) -> Result<String, DirectToolExecutionError> {
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
                let value = match value {
                    Value::String(value) => value.clone(),
                    value => serde_json::to_string(value)
                        .map_err(|_| DirectToolExecutionError::InvalidArguments)?,
                };
                rendered.push_str(&value);
            } else {
                rendered.push_str(&template[open..=end]);
            }
            cursor = end + 1;
        } else {
            rendered.push('{');
            cursor = open + 1;
        }
        if rendered.len() > MAX_MAPPING_VALUE_BYTES {
            return Err(DirectToolExecutionError::ResourceExhausted);
        }
    }
    if cursor < template.len() {
        rendered.push_str(&template[cursor..]);
    }
    if rendered.len() > MAX_MAPPING_VALUE_BYTES {
        return Err(DirectToolExecutionError::ResourceExhausted);
    }
    Ok(rendered)
}

fn projected_messages(result: &Value) -> Result<Value, DirectToolExecutionError> {
    if let Some(messages) = result.as_object().and_then(|object| object.get("messages")) {
        if !messages.is_array() {
            return Err(DirectToolExecutionError::InvalidResult);
        }
        ensure_bounded_value(messages)?;
        return Ok(messages.clone());
    }
    assistant_message(result)
}

fn assistant_message(result: &Value) -> Result<Value, DirectToolExecutionError> {
    let content = match result {
        Value::String(value) => value.clone(),
        value => {
            serde_json::to_string(value).map_err(|_| DirectToolExecutionError::InvalidResult)?
        }
    };
    if content.len() > MAX_RESULT_BYTES {
        return Err(DirectToolExecutionError::ResourceExhausted);
    }
    Ok(json!([{"role": "assistant", "content": content}]))
}

fn ensure_state_type(
    key: &str,
    value: &Value,
    state_types: &BTreeMap<String, String>,
) -> Result<(), DirectToolExecutionError> {
    let valid = match state_types
        .get(key)
        .map(String::as_str)
        .or_else(|| builtin_state_type(key))
    {
        Some("str") => value.is_string(),
        Some("int") => value.as_i64().is_some() || value.as_u64().is_some(),
        Some("float") => value.as_f64().is_some(),
        Some("bool") => value.is_boolean(),
        Some("list") => value.is_array(),
        Some("dict") => value.is_object(),
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(DirectToolExecutionError::InvalidResult)
    }
}

fn builtin_state_type(key: &str) -> Option<&'static str> {
    match key {
        "input" | "output" | "result" | "router_output" | "elitea_response" | "printer_output"
        | "session_id" => Some("str"),
        "messages" | "hitl_decisions" => Some("list"),
        "context_info" | "parallel_tasks" => Some("dict"),
        _ => None,
    }
}

fn ensure_bounded_value(value: &Value) -> Result<(), DirectToolExecutionError> {
    let encoded = serde_json::to_vec(value).map_err(|_| DirectToolExecutionError::InvalidResult)?;
    if encoded.len() > MAX_RESULT_BYTES {
        return Err(DirectToolExecutionError::ResourceExhausted);
    }
    Ok(())
}

fn node_failure(node: &str) -> GraphError {
    GraphError::NodeExecutionFailed {
        node: node.to_owned(),
        message: "the pipeline Toolkit node failed".to_owned(),
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
pub(crate) enum DirectToolConfigurationError {
    #[error("the Toolkit node YAML is malformed")]
    MalformedYaml {
        #[source]
        source: serde_yaml_ng::Error,
    },
    #[error("{0}")]
    Invalid(&'static str),
    #[error("{0}")]
    Unsupported(&'static str),
    #[error("the Toolkit node exceeds its resource bound")]
    ResourceExhausted,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub(crate) enum DirectToolExecutionError {
    #[error("the Toolkit node arguments are invalid")]
    InvalidArguments,
    #[error("the Toolkit node result is invalid")]
    InvalidResult,
    #[error("the Toolkit node exceeds its resource bound")]
    ResourceExhausted,
    #[error("the Toolkit node runtime is unavailable")]
    Unavailable,
}

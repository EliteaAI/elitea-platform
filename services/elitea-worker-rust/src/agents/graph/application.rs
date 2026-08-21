//! Direct saved-application execution for the active pipeline `agent` node.
//!
//! The stored node selects one exact frozen Application participant. Assembly
//! resolves that participant through the claim-bound platform boundary and
//! exposes its native ADK [`Tool`] here. The node maps one self-contained task,
//! invokes the child once and projects its final response without adding a
//! parent model turn or recreating a nested `LangGraph` wrapper.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use adk_rust::Tool;
use adk_rust::graph::{GraphError, Node, NodeContext, NodeOutput, State};
use async_trait::async_trait;
use ring::digest;
use serde::Deserialize;
use serde_json::{Value, json};
use thiserror::Error;
use tracing::Instrument as _;

use super::direct_tool::{ensure_state_type, pipeline_tool_context};
use super::llm::render_fstring;
use super::yaml::{valid_graph_id, valid_output_key};

const MAX_NODE_YAML_BYTES: usize = 64 * 1024;
const MAX_MAPPING_VALUE_BYTES: usize = 240 * 1024;
const MAX_NODE_VARIABLES: usize = 64;
const MAX_APPLICATION_ALIAS_BYTES: usize = 1_024;
const MAX_RESULT_BYTES: usize = 512 * 1024;
const CONFIG_DIGEST_DOMAIN: &[u8] = b"elitea.graph.application.config.v1\0";

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawApplicationNodeDefinition {
    id: String,
    #[serde(rename = "type")]
    node_type: String,
    tool: String,
    input_mapping: BTreeMap<String, RawInputMapping>,
    #[serde(default)]
    input: Vec<String>,
    #[serde(default)]
    output: Vec<String>,
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

#[derive(Clone)]
enum ApplicationInputMapping {
    Fixed(String),
    Variable(String),
    Template(String),
}

/// Exact frozen Application participant selected by one graph node.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PipelineApplicationSelection {
    alias: String,
}

impl PipelineApplicationSelection {
    pub(crate) fn alias(&self) -> &str {
        &self.alias
    }
}

/// Strict authority-free definition of one active Agent node.
#[derive(Clone)]
pub(crate) struct ApplicationNodeDefinition {
    id: String,
    selection: PipelineApplicationSelection,
    task: ApplicationInputMapping,
    input: Vec<String>,
    output: Vec<String>,
    transition: Option<String>,
}

impl ApplicationNodeDefinition {
    pub(super) fn from_yaml(yaml: &str) -> Result<Self, ApplicationConfigurationError> {
        if yaml.is_empty() || yaml.len() > MAX_NODE_YAML_BYTES {
            return Err(ApplicationConfigurationError::ResourceExhausted);
        }
        let raw = serde_yaml_ng::from_str::<RawApplicationNodeDefinition>(yaml)
            .map_err(|source| ApplicationConfigurationError::MalformedYaml { source })?;
        Self::from_raw(raw)
    }

    fn from_raw(
        mut raw: RawApplicationNodeDefinition,
    ) -> Result<Self, ApplicationConfigurationError> {
        if raw.node_type != "agent" {
            return Err(ApplicationConfigurationError::Invalid(
                "the node type must be agent",
            ));
        }
        if !valid_graph_id(&raw.id) {
            return Err(ApplicationConfigurationError::Invalid(
                "the Agent node ID is malformed",
            ));
        }
        if !valid_application_alias(&raw.tool) {
            return Err(ApplicationConfigurationError::Invalid(
                "the Agent participant identity is malformed",
            ));
        }
        if raw.input.len() > MAX_NODE_VARIABLES || raw.output.len() > MAX_NODE_VARIABLES {
            return Err(ApplicationConfigurationError::ResourceExhausted);
        }
        if raw.input.is_empty() {
            raw.input.push("messages".to_owned());
        }
        validate_state_keys(&raw.input)?;
        validate_state_keys(&raw.output)?;
        if raw
            .transition
            .as_deref()
            .is_some_and(|target| target != "END" && !valid_graph_id(target))
        {
            return Err(ApplicationConfigurationError::Invalid(
                "the Agent node transition is malformed",
            ));
        }
        if raw.input_mapping.len() != 1 || !raw.input_mapping.contains_key("task") {
            return Err(ApplicationConfigurationError::Invalid(
                "the Agent node requires exactly one task input mapping",
            ));
        }
        let task_mapping =
            raw.input_mapping
                .remove("task")
                .ok_or(ApplicationConfigurationError::Invalid(
                    "the Agent task mapping is missing",
                ))?;
        let task = parse_task_mapping(&task_mapping)?;
        Ok(Self {
            id: raw.id,
            selection: PipelineApplicationSelection { alias: raw.tool },
            task,
            input: raw.input,
            output: raw.output,
            transition: raw.transition,
        })
    }

    pub(crate) fn id(&self) -> &str {
        &self.id
    }

    pub(crate) const fn selection(&self) -> &PipelineApplicationSelection {
        &self.selection
    }

    pub(super) fn input_keys(&self) -> &[String] {
        &self.input
    }

    pub(super) fn output_keys(&self) -> &[String] {
        &self.output
    }

    pub(super) fn mapped_variable(&self) -> Option<&str> {
        match &self.task {
            ApplicationInputMapping::Variable(key) => Some(key),
            ApplicationInputMapping::Fixed(_) | ApplicationInputMapping::Template(_) => None,
        }
    }

    pub(super) fn transition(&self) -> Option<&str> {
        self.transition.as_deref()
    }

    pub(super) fn config_digest(&self) -> [u8; 32] {
        let mut context = digest::Context::new(&digest::SHA256);
        context.update(CONFIG_DIGEST_DOMAIN);
        digest_field(&mut context, self.id.as_bytes());
        digest_field(&mut context, self.selection.alias.as_bytes());
        match &self.task {
            ApplicationInputMapping::Fixed(value) => {
                digest_field(&mut context, b"fixed");
                digest_field(&mut context, value.as_bytes());
            }
            ApplicationInputMapping::Variable(value) => {
                digest_field(&mut context, b"variable");
                digest_field(&mut context, value.as_bytes());
            }
            ApplicationInputMapping::Template(value) => {
                digest_field(&mut context, b"fstring");
                digest_field(&mut context, value.as_bytes());
            }
        }
        for key in &self.input {
            digest_field(&mut context, key.as_bytes());
        }
        for key in &self.output {
            digest_field(&mut context, key.as_bytes());
        }
        digest_field(
            &mut context,
            self.transition.as_deref().unwrap_or_default().as_bytes(),
        );
        copy_digest(context.finish().as_ref())
    }

    fn map_task(&self, state: &State) -> Result<String, ApplicationExecutionError> {
        let task = match &self.task {
            ApplicationInputMapping::Fixed(value) => value.clone(),
            ApplicationInputMapping::Variable(key) => state
                .get(key)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            ApplicationInputMapping::Template(value) => {
                render_fstring(value, state).map_err(|_| ApplicationExecutionError::InvalidTask)?
            }
        };
        if task.is_empty() || task.len() > MAX_MAPPING_VALUE_BYTES || task.contains('\0') {
            return Err(ApplicationExecutionError::InvalidTask);
        }
        Ok(task)
    }

    fn project_response(
        &self,
        response: &str,
        state_types: &BTreeMap<String, String>,
    ) -> Result<BTreeMap<String, Value>, ApplicationExecutionError> {
        if response.len() > MAX_RESULT_BYTES || response.contains('\0') {
            return Err(ApplicationExecutionError::InvalidResult);
        }
        let mut updates = BTreeMap::from([(
            "messages".to_owned(),
            json!([{"role": "assistant", "content": response}]),
        )]);
        for key in self.output.iter().filter(|key| key.as_str() != "messages") {
            let value = Value::String(response.to_owned());
            ensure_state_type(key, &value, state_types)
                .map_err(|_| ApplicationExecutionError::InvalidResult)?;
            updates.insert(key.clone(), value);
        }
        let encoded =
            serde_json::to_vec(&updates).map_err(|_| ApplicationExecutionError::InvalidResult)?;
        if encoded.len() > MAX_RESULT_BYTES {
            return Err(ApplicationExecutionError::InvalidResult);
        }
        Ok(updates)
    }
}

/// Invocation-owned lookup of an already resolved saved Application tool.
pub(crate) trait PipelineApplicationResolver: Send + Sync {
    fn resolve(
        &self,
        selection: &PipelineApplicationSelection,
    ) -> Result<Arc<dyn Tool>, ApplicationExecutionError>;
}

pub(super) struct ApplicationNode {
    definition: ApplicationNodeDefinition,
    state_types: BTreeMap<String, String>,
    resolver: Arc<dyn PipelineApplicationResolver>,
}

impl ApplicationNode {
    pub(super) fn new(
        definition: ApplicationNodeDefinition,
        state_types: BTreeMap<String, String>,
        resolver: Arc<dyn PipelineApplicationResolver>,
    ) -> Self {
        Self {
            definition,
            state_types,
            resolver,
        }
    }
}

#[async_trait]
impl Node for ApplicationNode {
    fn name(&self) -> &str {
        self.definition.id()
    }

    async fn execute(&self, context: &NodeContext) -> Result<NodeOutput, GraphError> {
        let span = tracing::info_span!(
            "agent.pipeline.application_node",
            node_id = self.name(),
            application_alias = self.definition.selection.alias(),
            output_count = self.definition.output.len(),
            stage = tracing::field::Empty,
            outcome = tracing::field::Empty,
            error_code = tracing::field::Empty,
        );
        let result = async {
            tracing::Span::current().record("stage", "input_mapping");
            let task = self
                .definition
                .map_task(&context.state)
                .map_err(|_| node_failure(self.name()))?;
            tracing::Span::current().record("stage", "application_binding");
            let tool = self
                .resolver
                .resolve(self.definition.selection())
                .map_err(|_| node_failure(self.name()))?;
            let tool_context = pipeline_tool_context(context, self.name(), tool.name());
            tracing::Span::current().record("stage", "child_execution");
            let result = tool
                .execute(tool_context, json!({"task": task}))
                .await
                .map_err(|_| node_failure(self.name()))?;
            let response = result
                .as_object()
                .filter(|object| object.len() == 1)
                .and_then(|object| object.get("response"))
                .and_then(Value::as_str)
                .ok_or_else(|| node_failure(self.name()))?;
            tracing::Span::current().record("stage", "state_projection");
            let updates = self
                .definition
                .project_response(response, &self.state_types)
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
            span.record("error_code", "pipeline.application_node.failed");
        }
        result
    }
}

fn parse_task_mapping(
    raw: &RawInputMapping,
) -> Result<ApplicationInputMapping, ApplicationConfigurationError> {
    match raw.kind.as_str() {
        "fixed" => bounded_mapping_text(&raw.value)
            .map(str::to_owned)
            .map(ApplicationInputMapping::Fixed),
        "variable" => {
            let key = bounded_mapping_text(&raw.value)?;
            if !valid_output_key(key) {
                return Err(ApplicationConfigurationError::Invalid(
                    "the Agent task variable is malformed",
                ));
            }
            Ok(ApplicationInputMapping::Variable(key.to_owned()))
        }
        "fstring" => bounded_mapping_text(&raw.value)
            .map(str::to_owned)
            .map(ApplicationInputMapping::Template),
        _ => Err(ApplicationConfigurationError::Unsupported(
            "the Agent input mapping type is not supported",
        )),
    }
}

fn bounded_mapping_text(value: &Value) -> Result<&str, ApplicationConfigurationError> {
    value
        .as_str()
        .filter(|value| value.len() <= MAX_MAPPING_VALUE_BYTES && !value.contains('\0'))
        .ok_or(ApplicationConfigurationError::Invalid(
            "the Agent task mapping is malformed",
        ))
}

fn validate_state_keys(keys: &[String]) -> Result<(), ApplicationConfigurationError> {
    let mut seen = BTreeSet::new();
    if keys
        .iter()
        .any(|key| !valid_output_key(key) || !seen.insert(key.as_str()))
    {
        return Err(ApplicationConfigurationError::Invalid(
            "Agent node variables must be valid and unique",
        ));
    }
    Ok(())
}

fn valid_application_alias(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_APPLICATION_ALIAS_BYTES
        && !value.bytes().any(|byte| matches!(byte, 0 | b'\r' | b'\n'))
}

fn node_failure(node: &str) -> GraphError {
    GraphError::NodeExecutionFailed {
        node: node.to_owned(),
        message: "the pipeline Agent node failed".to_owned(),
    }
}

fn digest_field(context: &mut digest::Context, value: &[u8]) {
    context.update(&(value.len() as u64).to_be_bytes());
    context.update(value);
}

fn copy_digest(value: &[u8]) -> [u8; 32] {
    let mut output = [0_u8; 32];
    output.copy_from_slice(value);
    output
}

#[derive(Debug, Error)]
pub(crate) enum ApplicationConfigurationError {
    #[error("the Agent node YAML is malformed")]
    MalformedYaml {
        #[source]
        source: serde_yaml_ng::Error,
    },
    #[error("{0}")]
    Invalid(&'static str),
    #[error("{0}")]
    Unsupported(&'static str),
    #[error("the Agent node exceeds its resource bound")]
    ResourceExhausted,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub(crate) enum ApplicationExecutionError {
    #[error("the Agent task is invalid")]
    InvalidTask,
    #[error("the Agent result is invalid")]
    InvalidResult,
    #[error("the selected Agent is unavailable")]
    Unavailable,
}

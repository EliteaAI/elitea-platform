//! Bounded stored-pipeline document admission and ADK graph compilation.
//!
//! Node families are admitted only after their bounded business contract is
//! implemented. Unsupported Python branches still fail before graph or
//! credential construction.

#![allow(dead_code)] // Production pipeline assembly remains capability-gated.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::sync::Arc;

use adk_rust::graph::{
    Channel, Checkpointer, END, GraphAgent, GraphError, Reducer, START, State, StateSchema,
};
use adk_rust::{Event, InvocationContext, Part};
use ring::digest;
use serde::Deserialize;
use serde::de::{Deserializer, SeqAccess, Visitor};
use serde_json::json;
use thiserror::Error;

use super::hitl::{HITL_RESUME_STATE_KEY, HitlNode, HitlNodeDefinition};
use super::llm::{LlmNode, LlmNodeDefinition, LlmToolkitSelection, PipelineLlmAgentFactory};
use super::resume::PipelineResume;
use super::state_modifier::{StateModifierNode, StateModifierNodeDefinition};
use super::yaml::{valid_graph_id, valid_output_key};
use super::{pipeline_completed_event, pipeline_result_event};

const MAX_PIPELINE_YAML_BYTES: usize = 512 * 1024;
const MAX_PIPELINE_NODES: usize = 128;
const MAX_PIPELINE_STATE_KEYS: usize = 256;
const MAX_STATIC_INTERRUPTS: usize = 128;
const PIPELINE_RECURSION_LIMIT: usize = 100;
const MAX_PIPELINE_RESULT_BYTES: usize = 512 * 1024;
const PIPELINE_DIGEST_DOMAIN: &[u8] = b"elitea.graph.pipeline.config.v1\0";

type ValidatedState = (
    BTreeMap<String, String>,
    BTreeMap<String, serde_json::Value>,
    Vec<String>,
);

const RUNTIME_STRING_CHANNELS: &[&str] = &[
    "input",
    "output",
    "result",
    "router_output",
    "elitea_response",
    "printer_output",
    "session_id",
];

const INTERNAL_RESULT_KEYS: &[&str] = &[
    "messages",
    "output",
    "input",
    "chat_history",
    "thread_id",
    "execution_finished",
    "context_info",
    "state_types",
    "hitl_decisions",
    "hitl_interrupt",
    "parallel_tasks",
    "parallel_parked",
    "parallel_dispatch",
    "dispatch_epoch",
    "elitea_response",
    "printer_output",
    "router_output",
    "_pipeline_blocked",
    "session_id",
    HITL_RESUME_STATE_KEY,
];

#[derive(Clone, Deserialize)]
#[serde(untagged)]
enum RawStateType {
    Name(String),
    Descriptor(RawStateTypeDescriptor),
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawStateTypeDescriptor {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    value: Option<serde_json::Value>,
}

impl RawStateType {
    fn name(&self) -> &str {
        match self {
            Self::Name(name) => name,
            Self::Descriptor(descriptor) => &descriptor.kind,
        }
    }

    fn configured_value(&self) -> Option<&serde_json::Value> {
        match self {
            Self::Name(_) => None,
            Self::Descriptor(descriptor) => descriptor.value.as_ref(),
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawPipelineDefinition {
    #[serde(default)]
    state: serde_yaml_ng::Mapping,
    entry_point: String,
    #[serde(deserialize_with = "deserialize_nodes")]
    nodes: Vec<serde_yaml_ng::Value>,
    #[serde(default, deserialize_with = "deserialize_static_interrupts")]
    interrupt_before: Vec<String>,
    #[serde(default, deserialize_with = "deserialize_static_interrupts")]
    interrupt_after: Vec<String>,
}

fn deserialize_nodes<'de, D>(deserializer: D) -> Result<Vec<serde_yaml_ng::Value>, D::Error>
where
    D: Deserializer<'de>,
{
    struct NodesVisitor;

    impl<'de> Visitor<'de> for NodesVisitor {
        type Value = Vec<serde_yaml_ng::Value>;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("between 1 and 128 pipeline node mappings")
        }

        fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
        where
            A: SeqAccess<'de>,
        {
            let mut nodes = Vec::new();
            while let Some(node) = sequence.next_element()? {
                if nodes.len() == MAX_PIPELINE_NODES {
                    return Err(serde::de::Error::custom(
                        "the pipeline node count exceeds its resource bound",
                    ));
                }
                nodes.push(node);
            }
            Ok(nodes)
        }
    }

    deserializer.deserialize_seq(NodesVisitor)
}

fn deserialize_static_interrupts<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: Deserializer<'de>,
{
    struct InterruptsVisitor;

    impl<'de> Visitor<'de> for InterruptsVisitor {
        type Value = Vec<String>;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("at most 128 pipeline node identifiers")
        }

        fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
        where
            A: SeqAccess<'de>,
        {
            let mut nodes = Vec::new();
            while let Some(node) = sequence.next_element()? {
                if nodes.len() == MAX_STATIC_INTERRUPTS {
                    return Err(serde::de::Error::custom(
                        "the static interrupt count exceeds its resource bound",
                    ));
                }
                nodes.push(node);
            }
            Ok(nodes)
        }
    }

    deserializer.deserialize_seq(InterruptsVisitor)
}

/// Validated initial stored-pipeline document.
///
/// The definition contains no execution authority and can be retained across
/// claim attempts. Its digest is safe to bind into session/checkpoint lineage.
#[derive(Clone)]
pub(crate) struct PipelineDefinition {
    entry_point: String,
    state: BTreeMap<String, String>,
    state_defaults: BTreeMap<String, serde_json::Value>,
    state_declaration_order: Vec<String>,
    nodes: Vec<PipelineNodeDefinition>,
    definition_digest: [u8; 32],
}

#[derive(Clone)]
enum PipelineNodeDefinition {
    Hitl(HitlNodeDefinition),
    Llm(LlmNodeDefinition),
    StateModifier(StateModifierNodeDefinition),
}

impl PipelineNodeDefinition {
    fn id(&self) -> &str {
        match self {
            Self::Hitl(node) => node.id(),
            Self::Llm(node) => node.id(),
            Self::StateModifier(node) => node.id(),
        }
    }

    fn input_keys(&self) -> &[String] {
        match self {
            Self::Hitl(node) => node.input_keys(),
            Self::Llm(node) => node.input_keys(),
            Self::StateModifier(node) => node.input_keys(),
        }
    }

    fn output_keys(&self) -> &[String] {
        match self {
            Self::Hitl(_) => &[],
            Self::Llm(node) => node.output_keys(),
            Self::StateModifier(node) => node.output_keys(),
        }
    }

    fn cleaned_keys(&self) -> &[String] {
        match self {
            Self::Hitl(_) | Self::Llm(_) => &[],
            Self::StateModifier(node) => node.variables_to_clean(),
        }
    }

    fn edit_state_key(&self) -> Option<&str> {
        match self {
            Self::Hitl(node) => node.edit_state_key(),
            Self::Llm(_) | Self::StateModifier(_) => None,
        }
    }

    fn route_targets(&self) -> Vec<&str> {
        match self {
            Self::Hitl(node) => node.route_targets().collect(),
            Self::Llm(node) => node.transition().into_iter().collect(),
            Self::StateModifier(node) => node.transition().into_iter().collect(),
        }
    }

    fn config_digest(&self) -> [u8; 32] {
        match self {
            Self::Hitl(node) => node.config_digest(),
            Self::Llm(node) => node.config_digest(),
            Self::StateModifier(node) => node.config_digest(),
        }
    }
}

impl PipelineDefinition {
    /// Parse and validate a complete frozen pipeline YAML document.
    pub(crate) fn from_yaml(yaml: &str) -> Result<Self, PipelineConfigurationError> {
        if yaml.is_empty() || yaml.len() > MAX_PIPELINE_YAML_BYTES {
            return Err(PipelineConfigurationError::ResourceExhausted);
        }
        let raw = serde_yaml_ng::from_str::<RawPipelineDefinition>(yaml)
            .map_err(|source| PipelineConfigurationError::MalformedYaml { source })?;
        Self::from_raw(raw)
    }

    fn from_raw(raw: RawPipelineDefinition) -> Result<Self, PipelineConfigurationError> {
        if raw.nodes.is_empty() || raw.nodes.len() > MAX_PIPELINE_NODES {
            return Err(PipelineConfigurationError::Invalid(
                "the pipeline must contain between 1 and 128 nodes",
            ));
        }
        if !valid_graph_id(&raw.entry_point) {
            return Err(PipelineConfigurationError::Invalid(
                "the pipeline entry point is malformed",
            ));
        }
        let (state, state_defaults, state_declaration_order) = validate_state(raw.state)?;
        if !raw.interrupt_before.is_empty() || !raw.interrupt_after.is_empty() {
            return Err(PipelineConfigurationError::Unsupported(
                "static pipeline interrupts are not enabled in this compiler slice",
            ));
        }

        let (nodes, node_ids) = parse_pipeline_nodes(raw.nodes, &state)?;
        if !node_ids.contains(&raw.entry_point) {
            return Err(PipelineConfigurationError::Invalid(
                "the pipeline entry point does not name a node",
            ));
        }
        for node in &nodes {
            for target in node.route_targets() {
                if target != "END" && !node_ids.contains(target) {
                    return Err(PipelineConfigurationError::Invalid(
                        "a pipeline route target does not name a node",
                    ));
                }
            }
        }
        let definition_digest = definition_digest(
            &raw.entry_point,
            &state,
            &state_defaults,
            &state_declaration_order,
            &nodes,
        );
        Ok(Self {
            entry_point: raw.entry_point,
            state,
            state_defaults,
            state_declaration_order,
            nodes,
            definition_digest,
        })
    }

    #[must_use]
    pub(crate) fn entry_point(&self) -> &str {
        &self.entry_point
    }

    #[must_use]
    pub(crate) fn node_count(&self) -> usize {
        self.nodes.len()
    }

    #[must_use]
    pub(crate) const fn definition_digest(&self) -> [u8; 32] {
        self.definition_digest
    }

    /// Exact node-scoped toolkit selections, retained without credentials.
    pub(crate) fn llm_tool_selections(&self) -> impl Iterator<Item = &LlmToolkitSelection> {
        self.nodes.iter().flat_map(|node| match node {
            PipelineNodeDefinition::Llm(node) => node.tool_selections(),
            PipelineNodeDefinition::Hitl(_) | PipelineNodeDefinition::StateModifier(_) => &[],
        })
    }

    #[must_use]
    pub(crate) fn has_llm_nodes(&self) -> bool {
        self.nodes
            .iter()
            .any(|node| matches!(node, PipelineNodeDefinition::Llm(_)))
    }

    pub(crate) fn llm_toolkit_aliases(&self) -> BTreeSet<String> {
        self.llm_tool_selections()
            .map(|selection| selection.alias().to_owned())
            .collect()
    }

    /// Compile this immutable definition into one invocation-owned graph agent.
    pub(crate) fn compile(
        &self,
        agent_name: &str,
        checkpointer: Arc<dyn Checkpointer>,
        resume: Option<PipelineResume>,
    ) -> Result<GraphAgent, PipelineConfigurationError> {
        self.compile_with_llm_runtime(agent_name, checkpointer, resume, None)
    }

    /// Compile with the invocation-owned model/tool factory required by LLM
    /// nodes. Pure/control graphs keep using [`Self::compile`].
    pub(crate) fn compile_with_llm_runtime(
        &self,
        agent_name: &str,
        checkpointer: Arc<dyn Checkpointer>,
        resume: Option<PipelineResume>,
        llm_factory: Option<&Arc<dyn PipelineLlmAgentFactory>>,
    ) -> Result<GraphAgent, PipelineConfigurationError> {
        if !valid_graph_id(agent_name) {
            return Err(PipelineConfigurationError::Invalid(
                "the pipeline agent name is malformed",
            ));
        }
        let mut channels = BTreeSet::from([
            "input".to_owned(),
            "messages".to_owned(),
            "output".to_owned(),
            "result".to_owned(),
            "router_output".to_owned(),
            "elitea_response".to_owned(),
            "printer_output".to_owned(),
            "state_types".to_owned(),
            "context_info".to_owned(),
            "hitl_decisions".to_owned(),
            "hitl_interrupt".to_owned(),
            "parallel_tasks".to_owned(),
            "_pipeline_blocked".to_owned(),
            "session_id".to_owned(),
            HITL_RESUME_STATE_KEY.to_owned(),
        ]);
        channels.extend(self.state.keys().cloned());
        for node in &self.nodes {
            channels.extend(node.input_keys().iter().cloned());
            channels.extend(node.output_keys().iter().cloned());
            channels.extend(node.cleaned_keys().iter().cloned());
            if let Some(key) = node.edit_state_key() {
                channels.insert(key.to_owned());
            }
        }
        let state_schema = self.state_schema(channels);
        let result_policy = self.result_policy();
        let mut builder = GraphAgent::builder(agent_name)
            .description("Elitea stored pipeline")
            .state_schema(state_schema)
            .edge(START, &self.entry_point)
            .checkpointer_arc(checkpointer)
            .recursion_limit(PIPELINE_RECURSION_LIMIT)
            .max_concurrency(1)
            .output_mapper(move |state| {
                vec![pipeline_completion_event_from_state(state, &result_policy)]
            });
        for node in &self.nodes {
            builder = match node {
                PipelineNodeDefinition::Hitl(node) => builder.node(HitlNode::new(node.clone())),
                PipelineNodeDefinition::Llm(node) => {
                    let Some(factory) = llm_factory.cloned() else {
                        return Err(PipelineConfigurationError::Unsupported(
                            "the pipeline LLM runtime is not bound to this compiler",
                        ));
                    };
                    let transition = node.transition().map(ToOwned::to_owned);
                    let node_id = node.id().to_owned();
                    let mut next =
                        builder.node(LlmNode::new(node.clone(), self.state.clone(), factory));
                    if let Some(transition) = transition {
                        let target = if transition == "END" {
                            END
                        } else {
                            transition.as_str()
                        };
                        next = next.edge(&node_id, target);
                    }
                    next
                }
                PipelineNodeDefinition::StateModifier(node) => {
                    let transition = node.transition().map(ToOwned::to_owned);
                    let node_id = node.id().to_owned();
                    let mut next = builder.node(StateModifierNode::new(node.clone()));
                    if let Some(transition) = transition {
                        let target = if transition == "END" {
                            END
                        } else {
                            transition.as_str()
                        };
                        next = next.edge(&node_id, target);
                    }
                    next
                }
            };
        }
        if let Some(resume) = resume {
            let resume_state = resume.into_state();
            builder = builder
                .input_mapper(move |context| invocation_state(context, None, Some(&resume_state)));
        } else {
            let defaults = self.state_defaults.clone();
            builder = builder
                .input_mapper(move |context| invocation_state(context, Some(&defaults), None));
        }
        builder.build().map_err(PipelineConfigurationError::Graph)
    }

    /// Build the native ADK state schema for runtime-owned and user channels.
    fn state_schema(&self, channels: BTreeSet<String>) -> StateSchema {
        let mut schema = StateSchema::new();
        for channel in channels {
            let default = if channel == "state_types" {
                self.state_types_default()
            } else {
                self.state_defaults
                    .get(&channel)
                    .cloned()
                    .unwrap_or_else(|| runtime_channel_default(&channel))
            };
            schema.channels.insert(
                channel.clone(),
                Channel::new(&channel).with_default(default),
            );
        }
        schema
            .channels
            .insert("messages".to_owned(), Channel::list("messages"));
        schema.channels.insert(
            "hitl_decisions".to_owned(),
            Channel::new("hitl_decisions")
                .with_default(json!([]))
                .with_reducer(Reducer::Custom(Arc::new(append_or_clear_list))),
        );
        schema.channels.insert(
            "parallel_tasks".to_owned(),
            Channel::new("parallel_tasks")
                .with_default(json!({}))
                .with_reducer(Reducer::Custom(Arc::new(merge_or_clear_object))),
        );
        schema
    }

    fn state_types_default(&self) -> serde_json::Value {
        let mut types = serde_json::Map::new();
        for key in &self.state_declaration_order {
            if key == "input" {
                continue;
            }
            if let Some(kind) = self.state.get(key) {
                types.insert(key.clone(), json!(kind));
            }
        }
        types.insert("state_types".to_owned(), json!("dict"));
        serde_json::Value::Object(types)
    }

    /// Collect result candidates separately from graph control flow.
    ///
    /// `END` is only the ADK graph sink. The candidate belongs to the
    /// value-producing node whose explicit route targets that sink.
    fn result_policy(&self) -> PipelineResultPolicy {
        let mut keys = Vec::new();
        for node in &self.nodes {
            let (transition, output_keys) = match node {
                PipelineNodeDefinition::Llm(node) => (node.transition(), node.output_keys()),
                PipelineNodeDefinition::StateModifier(node) => {
                    (node.transition(), node.output_keys())
                }
                PipelineNodeDefinition::Hitl(_) => continue,
            };
            if transition != Some("END") {
                continue;
            }
            if let Some(key) = output_keys.iter().find(|key| key.as_str() != "messages")
                && !internal_result_key(key)
                && !keys.contains(key)
            {
                keys.push(key.clone());
            }
        }
        let fallback_keys = self
            .state_declaration_order
            .iter()
            .filter(|key| !internal_result_key(key))
            .cloned()
            .collect();
        PipelineResultPolicy {
            terminal_data_keys: keys,
            fallback_data_keys: fallback_keys,
        }
    }
}

pub(super) struct PipelineResultPolicy {
    pub(super) terminal_data_keys: Vec<String>,
    pub(super) fallback_data_keys: Vec<String>,
}

fn pipeline_completion_event_from_state(state: &State, policy: &PipelineResultPolicy) -> Event {
    if let Some(content) = select_pipeline_result(state, policy) {
        return pipeline_result_event(&content);
    }
    pipeline_completed_event()
}

pub(super) fn select_pipeline_result(
    state: &State,
    policy: &PipelineResultPolicy,
) -> Option<String> {
    select_last_state_value(state, &policy.terminal_data_keys)
        .or_else(|| select_last_assistant_message(state.get("messages")))
        .or_else(|| select_last_state_value(state, &policy.fallback_data_keys))
        .filter(|content| content.len() <= MAX_PIPELINE_RESULT_BYTES)
}

fn select_last_state_value(state: &State, keys: &[String]) -> Option<String> {
    keys.iter()
        .rev()
        .filter_map(|key| state.get(key))
        .filter_map(normalize_pipeline_value)
        .find(|content| !content.trim().is_empty())
}

fn select_last_assistant_message(messages: Option<&serde_json::Value>) -> Option<String> {
    messages?
        .as_array()?
        .iter()
        .rev()
        .filter(|message| {
            matches!(
                message.get("role").and_then(serde_json::Value::as_str),
                Some("assistant" | "ai")
            )
        })
        .filter_map(|message| message.get("content"))
        .filter_map(normalize_pipeline_value)
        .find(|content| !content.trim().is_empty())
}

fn normalize_pipeline_value(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Null => None,
        serde_json::Value::String(value) => Some(value.clone()),
        serde_json::Value::Array(blocks) => {
            let mut output = String::new();
            for block in blocks {
                match block {
                    serde_json::Value::String(text) => output.push_str(text),
                    serde_json::Value::Object(object)
                        if object.get("type").is_none()
                            || object.get("type").and_then(serde_json::Value::as_str)
                                == Some("text") =>
                    {
                        if let Some(text) = object.get("text").and_then(serde_json::Value::as_str) {
                            output.push_str(text);
                        }
                    }
                    _ => {}
                }
            }
            Some(output)
        }
        value => serde_json::to_string(value).ok(),
    }
}

pub(super) fn append_or_clear_list(
    current: serde_json::Value,
    update: serde_json::Value,
) -> serde_json::Value {
    if update.is_null() {
        return json!([]);
    }
    let mut values = match current {
        serde_json::Value::Array(values) => values,
        _ => Vec::new(),
    };
    if let serde_json::Value::Array(update) = update {
        values.extend(update);
    }
    serde_json::Value::Array(values)
}

pub(super) fn merge_or_clear_object(
    current: serde_json::Value,
    update: serde_json::Value,
) -> serde_json::Value {
    if update.is_null() {
        return json!({});
    }
    let mut values = match current {
        serde_json::Value::Object(values) => values,
        _ => serde_json::Map::new(),
    };
    if let serde_json::Value::Object(update) = update {
        values.extend(update);
    }
    serde_json::Value::Object(values)
}

fn runtime_channel_default(channel: &str) -> serde_json::Value {
    match channel {
        "messages" | "hitl_decisions" => json!([]),
        "parallel_tasks" | "state_types" | HITL_RESUME_STATE_KEY => json!({}),
        "context_info" | "hitl_interrupt" | "_pipeline_blocked" => serde_json::Value::Null,
        channel if RUNTIME_STRING_CHANNELS.contains(&channel) => json!(""),
        _ => serde_json::Value::Null,
    }
}

fn internal_result_key(key: &str) -> bool {
    INTERNAL_RESULT_KEYS.contains(&key)
}

fn invocation_state(
    context: &dyn InvocationContext,
    defaults: Option<&BTreeMap<String, serde_json::Value>>,
    resume: Option<&State>,
) -> State {
    let mut state: State = defaults
        .map(|defaults| defaults.clone().into_iter().collect())
        .unwrap_or_default();
    if resume.is_none() {
        let text = context
            .user_content()
            .parts
            .iter()
            .filter_map(|part| match part {
                Part::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n");
        if !text.is_empty() {
            state.insert("input".to_owned(), json!(text));
            state.insert(
                "messages".to_owned(),
                json!([{"role": "user", "content": text}]),
            );
        }
    }
    state.insert("session_id".to_owned(), json!(context.session_id()));
    if let Some(resume) = resume {
        state.extend(resume.clone());
    }
    state
}

fn parse_pipeline_nodes(
    raw_nodes: Vec<serde_yaml_ng::Value>,
    state: &BTreeMap<String, String>,
) -> Result<(Vec<PipelineNodeDefinition>, BTreeSet<String>), PipelineConfigurationError> {
    let mut nodes = Vec::with_capacity(raw_nodes.len());
    let mut node_ids = BTreeSet::new();
    for raw_node in raw_nodes {
        let node = parse_pipeline_node(&raw_node)?;
        if !node_ids.insert(node.id().to_owned()) {
            return Err(PipelineConfigurationError::Invalid(
                "pipeline node identifiers must be unique",
            ));
        }
        validate_node_state(&node, state)?;
        nodes.push(node);
    }
    Ok((nodes, node_ids))
}

fn parse_pipeline_node(
    raw_node: &serde_yaml_ng::Value,
) -> Result<PipelineNodeDefinition, PipelineConfigurationError> {
    let node_type = yaml_string_field(raw_node, "type")?;
    let encoded = serde_yaml_ng::to_string(raw_node)
        .map_err(|source| PipelineConfigurationError::MalformedYaml { source })?;
    match node_type {
        "hitl" => HitlNodeDefinition::from_yaml(&encoded)
            .map(PipelineNodeDefinition::Hitl)
            .map_err(|_| PipelineConfigurationError::Invalid("a HITL node is invalid")),
        "llm" => LlmNodeDefinition::from_yaml(&encoded)
            .map(PipelineNodeDefinition::Llm)
            .map_err(|_| PipelineConfigurationError::Invalid("an LLM node is invalid")),
        "state_modifier" => StateModifierNodeDefinition::from_yaml(&encoded)
            .map(PipelineNodeDefinition::StateModifier)
            .map_err(|_| PipelineConfigurationError::Invalid("a state modifier node is invalid")),
        _ => Err(PipelineConfigurationError::Unsupported(
            "the pipeline contains a node type that is not enabled",
        )),
    }
}

fn validate_node_state(
    node: &PipelineNodeDefinition,
    state: &BTreeMap<String, String>,
) -> Result<(), PipelineConfigurationError> {
    for key in node.input_keys() {
        if !builtin_state_key(key) && !state.contains_key(key) {
            return Err(PipelineConfigurationError::Invalid(
                "a node input key is not declared in pipeline state",
            ));
        }
    }
    for key in node.output_keys().iter().chain(node.cleaned_keys()) {
        if !builtin_state_key(key) && !state.contains_key(key) {
            return Err(PipelineConfigurationError::Invalid(
                "a node output or clean key is not declared in pipeline state",
            ));
        }
    }
    if let PipelineNodeDefinition::Llm(node) = node {
        node.output_schema(state).map_err(|_| {
            PipelineConfigurationError::Invalid("an LLM node output schema is invalid")
        })?;
        for mapping in node.input_mapping().values() {
            if let super::llm::LlmInputMapping::Variable(key) = mapping
                && !builtin_state_key(key)
                && !state.contains_key(key)
            {
                return Err(PipelineConfigurationError::Invalid(
                    "an LLM input mapping variable is not declared in pipeline state",
                ));
            }
        }
    }
    if node
        .edit_state_key()
        .is_some_and(|key| !state.contains_key(key))
    {
        return Err(PipelineConfigurationError::Invalid(
            "the HITL edit key is not declared in pipeline state",
        ));
    }
    Ok(())
}

fn validate_state(
    raw: serde_yaml_ng::Mapping,
) -> Result<ValidatedState, PipelineConfigurationError> {
    if raw.len() > MAX_PIPELINE_STATE_KEYS {
        return Err(PipelineConfigurationError::ResourceExhausted);
    }
    let mut state = BTreeMap::new();
    let mut defaults = BTreeMap::new();
    let mut declaration_order = Vec::with_capacity(raw.len());
    for (raw_key, raw_kind) in raw {
        let Some(key) = raw_key.as_str().map(ToOwned::to_owned) else {
            return Err(PipelineConfigurationError::Invalid(
                "a pipeline state key must be a string",
            ));
        };
        let kind = serde_yaml_ng::from_value::<RawStateType>(raw_kind).map_err(|_| {
            PipelineConfigurationError::Invalid("a pipeline state type is malformed")
        })?;
        if !valid_output_key(&key) || reserved_user_state_key(&key) {
            return Err(PipelineConfigurationError::Invalid(
                "a pipeline state key is malformed or reserved",
            ));
        }
        let normalized = match kind.name() {
            "str" | "string" => "str",
            "int" | "number" => "int",
            "float" => "float",
            "bool" => "bool",
            "list" => "list",
            "dict" => "dict",
            _ => {
                return Err(PipelineConfigurationError::Unsupported(
                    "the pipeline declares an unsupported state type",
                ));
            }
        };
        if (key == "input" && normalized != "str") || (key == "messages" && normalized != "list") {
            return Err(PipelineConfigurationError::Invalid(
                "a built-in pipeline state key has the wrong type",
            ));
        }
        let value = kind
            .configured_value()
            .cloned()
            .unwrap_or_else(|| default_state_value(normalized));
        if !state_value_matches(normalized, &value) {
            return Err(PipelineConfigurationError::Invalid(
                "a pipeline state default has the wrong type",
            ));
        }
        defaults.insert(key.clone(), value);
        declaration_order.push(key.clone());
        state.insert(key, normalized.to_owned());
    }
    Ok((state, defaults, declaration_order))
}

fn default_state_value(kind: &str) -> serde_json::Value {
    match kind {
        "str" => json!(""),
        "int" => json!(0),
        "float" => json!(0.0),
        "bool" => json!(false),
        "list" => json!([]),
        "dict" => json!({}),
        _ => serde_json::Value::Null,
    }
}

fn state_value_matches(kind: &str, value: &serde_json::Value) -> bool {
    match kind {
        "str" => value.is_string(),
        "int" => value.as_i64().is_some() || value.as_u64().is_some(),
        "float" => value.as_f64().is_some(),
        "bool" => value.is_boolean(),
        "list" => value.is_array(),
        "dict" => value.is_object(),
        _ => false,
    }
}

fn builtin_state_key(key: &str) -> bool {
    matches!(
        key,
        "input"
            | "messages"
            | "output"
            | "result"
            | "router_output"
            | "elitea_response"
            | "printer_output"
            | "state_types"
            | "context_info"
            | "hitl_decisions"
            | "hitl_interrupt"
            | "parallel_tasks"
            | "_pipeline_blocked"
            | "session_id"
    )
}

fn reserved_user_state_key(key: &str) -> bool {
    key == HITL_RESUME_STATE_KEY
        || matches!(
            key,
            "output"
                | "result"
                | "router_output"
                | "elitea_response"
                | "printer_output"
                | "state_types"
                | "context_info"
                | "hitl_decisions"
                | "hitl_interrupt"
                | "parallel_tasks"
                | "_pipeline_blocked"
                | "session_id"
                | "thread_id"
                | "execution_finished"
                | "chat_history"
        )
}

fn yaml_string_field<'a>(
    value: &'a serde_yaml_ng::Value,
    field: &str,
) -> Result<&'a str, PipelineConfigurationError> {
    value
        .as_mapping()
        .and_then(|mapping| mapping.get(serde_yaml_ng::Value::String(field.to_owned())))
        .and_then(serde_yaml_ng::Value::as_str)
        .ok_or(PipelineConfigurationError::Invalid(
            "a pipeline node is missing a string type",
        ))
}

fn definition_digest(
    entry_point: &str,
    state: &BTreeMap<String, String>,
    state_defaults: &BTreeMap<String, serde_json::Value>,
    state_declaration_order: &[String],
    nodes: &[PipelineNodeDefinition],
) -> [u8; 32] {
    let mut context = digest::Context::new(&digest::SHA256);
    context.update(PIPELINE_DIGEST_DOMAIN);
    digest_field(&mut context, entry_point.as_bytes());
    for (key, kind) in state {
        digest_field(&mut context, key.as_bytes());
        digest_field(&mut context, kind.as_bytes());
        if let Some(value) = state_defaults.get(key) {
            let encoded = serde_json::to_vec(value).unwrap_or_default();
            digest_field(&mut context, &encoded);
        }
    }
    for key in state_declaration_order {
        digest_field(&mut context, key.as_bytes());
    }
    for node in nodes {
        digest_field(&mut context, node.id().as_bytes());
        let kind = match node {
            PipelineNodeDefinition::Hitl(_) => b"hitl".as_slice(),
            PipelineNodeDefinition::Llm(_) => b"llm".as_slice(),
            PipelineNodeDefinition::StateModifier(_) => b"state_modifier".as_slice(),
        };
        digest_field(&mut context, kind);
        digest_field(&mut context, &node.config_digest());
    }
    let digest = context.finish();
    let mut output = [0_u8; 32];
    output.copy_from_slice(digest.as_ref());
    output
}

fn digest_field(context: &mut digest::Context, value: &[u8]) {
    context.update(&(value.len() as u64).to_be_bytes());
    context.update(value);
}

/// Stable, data-free stored-pipeline admission failure.
#[derive(Debug, Error)]
pub(crate) enum PipelineConfigurationError {
    #[error("the stored pipeline exceeds its resource bound")]
    ResourceExhausted,
    #[error("the stored pipeline YAML is malformed")]
    MalformedYaml {
        #[source]
        source: serde_yaml_ng::Error,
    },
    #[error("the stored pipeline is invalid: {0}")]
    Invalid(&'static str),
    #[error("the stored pipeline requests an unavailable capability: {0}")]
    Unsupported(&'static str),
    #[error("the stored pipeline graph could not be compiled")]
    Graph(#[source] GraphError),
}

impl PipelineConfigurationError {
    #[must_use]
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::ResourceExhausted => "graph.pipeline.configuration_resource_exhausted",
            Self::MalformedYaml { .. } => "graph.pipeline.malformed_yaml",
            Self::Invalid(_) => "graph.pipeline.invalid_configuration",
            Self::Unsupported(_) => "graph.pipeline.unsupported_capability",
            Self::Graph(_) => "graph.pipeline.compile_failed",
        }
    }
}

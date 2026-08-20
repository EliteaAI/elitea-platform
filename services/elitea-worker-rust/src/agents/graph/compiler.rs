//! Bounded stored-pipeline document admission and ADK graph compilation.
//!
//! This first compiler slice deliberately admits only the already implemented
//! dynamic `hitl` node. Other Python node families fail before graph or
//! credential construction; they are added here only after their own bounded
//! business contract exists.

#![allow(dead_code)] // Production pipeline assembly remains capability-gated.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::sync::Arc;

use adk_rust::graph::{Checkpointer, GraphAgent, GraphError, START, State};
use adk_rust::{InvocationContext, Part};
use ring::digest;
use serde::Deserialize;
use serde::de::{Deserializer, SeqAccess, Visitor};
use serde_json::json;
use thiserror::Error;

use super::hitl::{HITL_RESUME_STATE_KEY, HitlNode, HitlNodeDefinition};
use super::resume::PipelineResume;
use super::yaml::{valid_graph_id, valid_output_key};

const MAX_PIPELINE_YAML_BYTES: usize = 512 * 1024;
const MAX_PIPELINE_NODES: usize = 128;
const MAX_PIPELINE_STATE_KEYS: usize = 256;
const MAX_STATIC_INTERRUPTS: usize = 128;
const PIPELINE_RECURSION_LIMIT: usize = 100;
const PIPELINE_DIGEST_DOMAIN: &[u8] = b"elitea.graph.pipeline.config.v1\0";

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
}

impl RawStateType {
    fn name(&self) -> &str {
        match self {
            Self::Name(name) => name,
            Self::Descriptor(descriptor) => &descriptor.kind,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawPipelineDefinition {
    #[serde(default)]
    state: BTreeMap<String, RawStateType>,
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
    nodes: Vec<HitlNodeDefinition>,
    definition_digest: [u8; 32],
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
        let state = validate_state(raw.state)?;
        if !raw.interrupt_before.is_empty() || !raw.interrupt_after.is_empty() {
            return Err(PipelineConfigurationError::Unsupported(
                "static pipeline interrupts are not enabled in this compiler slice",
            ));
        }

        let mut nodes = Vec::with_capacity(raw.nodes.len());
        let mut node_ids = BTreeSet::new();
        for raw_node in raw.nodes {
            let node_type = yaml_string_field(&raw_node, "type")?;
            if node_type != "hitl" {
                return Err(PipelineConfigurationError::Unsupported(
                    "the pipeline contains a node type that is not enabled",
                ));
            }
            let encoded = serde_yaml_ng::to_string(&raw_node)
                .map_err(|source| PipelineConfigurationError::MalformedYaml { source })?;
            let node = HitlNodeDefinition::from_yaml(&encoded)
                .map_err(|_| PipelineConfigurationError::Invalid("a HITL node is invalid"))?;
            if !node_ids.insert(node.id().to_owned()) {
                return Err(PipelineConfigurationError::Invalid(
                    "pipeline node identifiers must be unique",
                ));
            }
            for key in node.input_keys() {
                if !builtin_state_key(key) && !state.contains_key(key) {
                    return Err(PipelineConfigurationError::Invalid(
                        "a HITL input key is not declared in pipeline state",
                    ));
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
            nodes.push(node);
        }
        if !node_ids.contains(&raw.entry_point) {
            return Err(PipelineConfigurationError::Invalid(
                "the pipeline entry point does not name a node",
            ));
        }
        for node in &nodes {
            for target in node.route_targets() {
                if target != "END" && !node_ids.contains(target) {
                    return Err(PipelineConfigurationError::Invalid(
                        "a HITL route target does not name a node",
                    ));
                }
            }
        }
        let definition_digest = definition_digest(&raw.entry_point, &state, &nodes);
        Ok(Self {
            entry_point: raw.entry_point,
            state,
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

    /// Compile this immutable definition into one invocation-owned graph agent.
    pub(crate) fn compile(
        &self,
        agent_name: &str,
        checkpointer: Arc<dyn Checkpointer>,
        resume: Option<PipelineResume>,
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
            "session_id".to_owned(),
            HITL_RESUME_STATE_KEY.to_owned(),
        ]);
        channels.extend(self.state.keys().cloned());
        for node in &self.nodes {
            channels.extend(node.input_keys().iter().cloned());
            if let Some(key) = node.edit_state_key() {
                channels.insert(key.to_owned());
            }
        }
        let channel_refs = channels.iter().map(String::as_str).collect::<Vec<_>>();
        let mut builder = GraphAgent::builder(agent_name)
            .description("Elitea stored pipeline")
            .channels(&channel_refs)
            .edge(START, &self.entry_point)
            .checkpointer_arc(checkpointer)
            .recursion_limit(PIPELINE_RECURSION_LIMIT)
            .max_concurrency(1);
        for node in &self.nodes {
            builder = builder.node(HitlNode::new(node.clone()));
        }
        if let Some(resume) = resume {
            let resume_state = resume.into_state();
            builder =
                builder.input_mapper(move |context| invocation_state(context, Some(&resume_state)));
        }
        builder.build().map_err(PipelineConfigurationError::Graph)
    }
}

fn invocation_state(context: &dyn InvocationContext, resume: Option<&State>) -> State {
    let mut state = State::new();
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
    state.insert("session_id".to_owned(), json!(context.session_id()));
    if let Some(resume) = resume {
        state.extend(resume.clone());
    }
    state
}

fn validate_state(
    raw: BTreeMap<String, RawStateType>,
) -> Result<BTreeMap<String, String>, PipelineConfigurationError> {
    if raw.len() > MAX_PIPELINE_STATE_KEYS {
        return Err(PipelineConfigurationError::ResourceExhausted);
    }
    let mut state = BTreeMap::new();
    for (key, kind) in raw {
        if !valid_output_key(&key) || key == HITL_RESUME_STATE_KEY || builtin_state_key(&key) {
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
        state.insert(key, normalized.to_owned());
    }
    Ok(state)
}

fn builtin_state_key(key: &str) -> bool {
    matches!(
        key,
        "input" | "messages" | "output" | "result" | "session_id"
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
    nodes: &[HitlNodeDefinition],
) -> [u8; 32] {
    let mut context = digest::Context::new(&digest::SHA256);
    context.update(PIPELINE_DIGEST_DOMAIN);
    digest_field(&mut context, entry_point.as_bytes());
    for (key, kind) in state {
        digest_field(&mut context, key.as_bytes());
        digest_field(&mut context, kind.as_bytes());
    }
    for node in nodes {
        digest_field(&mut context, node.id().as_bytes());
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

//! Claim-bound nested Elitea applications exposed through ADK `AgentTool`.
//!
//! Main admits exact application/version identities. During the one authorized
//! assembly phase this module resolves each identity once, revalidates the
//! bounded nesting graph, compiles a fresh direct `LlmAgent`, and presents it to
//! the parent model as a source-compatible `task` tool. Stored pipelines remain
//! owned by the graph compiler and fail closed here.

#![allow(dead_code)] // Production registration remains capability-gated.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use adk_rust::agent::LlmAgentBuilder;
use adk_rust::tool::{AgentTool, AgentToolConfig, BasicToolset};
use adk_rust::{
    AdkError, Agent, ErrorCategory, ErrorComponent, EventStream, GenerateContentConfig,
    InvocationContext, Tool, ToolContext, Toolset,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use tracing::Instrument as _;

use super::assembly::{OrdinaryModelProvider, OrdinaryNoToolProfile, ReasoningEffort};
use super::runtime::{NativeAgentAssemblyError, NativeAgentAssemblyErrorCode};
use super::session::BoundOrdinaryAgentModel;
use crate::protocol::control::ClaimBoundRuntimeContextAuthority;
use crate::toolkits::{
    AdmittedToolSnapshot, FrozenToolKind, FrozenToolSnapshot, FrozenToolSnapshotErrorCode,
    McpConnector, McpMaterializationErrorCode, ToolAdmissionPolicy,
    ToolsetMaterializationErrorCode, materialize_configured_toolsets, materialize_mcp_toolsets,
};
use crate::transport::model_facade::{
    ModelAdapterKind, ModelFacade, ModelFacadeError, ModelInvocation, ModelReasoningEffort,
};
use crate::transport::platform_client::PlatformClient;
use crate::transport::runtime_context::ClaimScopedEliteaContext;

const MAX_APPLICATION_HOPS: usize = 25;
const MAX_AGENT_TIERS: usize = 3;
const MAX_APPLICATION_TASK_BYTES: usize = 240 * 1_024;
const MAX_AGENT_DESCRIPTION_BYTES: usize = 4 * 1_024;
const MAX_DESCRIPTION_CAPABILITIES: usize = 16;

type ApplicationIdentity = (u64, u64);
type ApplicationFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Arc<dyn Agent>, NativeAgentAssemblyError>> + Send + 'a>>;

pub(crate) struct ApplicationToolDependencies {
    pub(crate) model_facade: Arc<ModelFacade>,
    pub(crate) policy: Arc<ToolAdmissionPolicy>,
    pub(crate) mcp_connector: Arc<dyn McpConnector>,
}

/// Build the one nested-application toolset for the root direct agent.
pub(crate) async fn materialize_application_toolset(
    snapshot: &AdmittedToolSnapshot<'_>,
    platform: &PlatformClient,
    runtime_context: &ClaimBoundRuntimeContextAuthority,
    elitea_context: Arc<ClaimScopedEliteaContext>,
    fallback_profile: &OrdinaryNoToolProfile,
    dependencies: ApplicationToolDependencies,
) -> Result<Option<Arc<dyn Toolset>>, NativeAgentAssemblyError> {
    let references = application_references(snapshot)?;
    if references.is_empty() {
        return Ok(None);
    }
    let mut state = ApplicationAssemblyState {
        platform,
        runtime_context,
        model_facade: dependencies.model_facade,
        elitea_context,
        fallback_profile,
        policy: dependencies.policy,
        mcp_connector: dependencies.mcp_connector,
        agents: HashMap::new(),
        resolving: HashSet::new(),
        hops: 0,
    };
    let mut tools: Vec<Arc<dyn Tool>> = Vec::with_capacity(references.len());
    for reference in references {
        let identity = reference.identity;
        let agent = state.build(reference.clone(), 2).await?;
        tools.push(Arc::new(ApplicationAgentTool::new(agent, identity)));
    }
    Ok(Some(Arc::new(BasicToolset::new(
        "elitea_nested_applications",
        tools,
    ))))
}

struct ApplicationAssemblyState<'a> {
    platform: &'a PlatformClient,
    runtime_context: &'a ClaimBoundRuntimeContextAuthority,
    model_facade: Arc<ModelFacade>,
    elitea_context: Arc<ClaimScopedEliteaContext>,
    fallback_profile: &'a OrdinaryNoToolProfile,
    policy: Arc<ToolAdmissionPolicy>,
    mcp_connector: Arc<dyn McpConnector>,
    agents: HashMap<ApplicationIdentity, Arc<dyn Agent>>,
    resolving: HashSet<ApplicationIdentity>,
    hops: usize,
}

impl ApplicationAssemblyState<'_> {
    fn build(&mut self, reference: ApplicationReference, tier: usize) -> ApplicationFuture<'_> {
        Box::pin(async move {
            let identity = reference.identity;
            let span = tracing::info_span!(
                "agent.nested_application.assemble",
                application_id = identity.0,
                version_id = identity.1,
                tier,
                cache_hit = tracing::field::Empty,
                stage = tracing::field::Empty,
                outcome = tracing::field::Empty,
                error_code = tracing::field::Empty,
            );
            let result = async {
                self.hops = self.hops.saturating_add(1);
                if self.hops > MAX_APPLICATION_HOPS || tier > MAX_AGENT_TIERS {
                    return Err(resource_exhausted());
                }
                if reference.agent_type != "agent" {
                    return Err(unsupported_capability());
                }
                if reference.project_id.is_some_and(|project_id| {
                    project_id != self.elitea_context.resource_project_id()
                }) {
                    return Err(invalid_configuration());
                }
                if let Some(agent) = self.agents.get(&identity) {
                    tracing::Span::current().record("cache_hit", true);
                    return Ok(agent.clone());
                }
                tracing::Span::current().record("cache_hit", false);
                if !self.resolving.insert(identity) {
                    return Err(invalid_configuration());
                }
                tracing::Span::current().record("stage", "resolve_version");
                let result = self.build_uncached(reference, tier).await;
                self.resolving.remove(&identity);
                if let Ok(agent) = &result {
                    self.agents.insert(identity, agent.clone());
                }
                result
            }
            .instrument(span.clone())
            .await;
            match &result {
                Ok(_) => {
                    span.record("outcome", "assembled");
                }
                Err(error) => {
                    span.record("outcome", "failed");
                    span.record("error_code", error.code().as_str());
                }
            }
            result
        })
    }

    async fn build_uncached(
        &mut self,
        reference: ApplicationReference,
        tier: usize,
    ) -> Result<Arc<dyn Agent>, NativeAgentAssemblyError> {
        let loaded = self
            .platform
            .resolve_application_version(
                self.runtime_context,
                reference.identity.0,
                reference.identity.1,
            )
            .await
            .map_err(NativeAgentAssemblyError::from)?;
        let version = loaded.into_version_details();
        let profile = OrdinaryNoToolProfile::from_nested_version(&version, self.fallback_profile)?;
        let frozen = FrozenToolSnapshot::from_version_details(&version)
            .map_err(snapshot_error)?
            .apply_policy(self.policy.as_ref());
        let capabilities = configured_capabilities(&frozen);
        let mut toolsets =
            materialize_configured_toolsets(&frozen, &self.policy).map_err(toolset_error)?;
        let mut mcp_toolsets =
            materialize_mcp_toolsets(&frozen, self.mcp_connector.as_ref(), &self.policy)
                .await
                .map_err(mcp_toolset_error)?;
        toolsets.append(&mut mcp_toolsets);
        let nested_references = application_references(&frozen)?;
        if !nested_references.is_empty() {
            let mut nested_tools: Vec<Arc<dyn Tool>> = Vec::with_capacity(nested_references.len());
            for nested in nested_references {
                let identity = nested.identity;
                let agent = self.build(nested, tier + 1).await?;
                nested_tools.push(Arc::new(ApplicationAgentTool::new(agent, identity)));
            }
            toolsets.push(Arc::new(BasicToolset::new(
                format!(
                    "elitea_nested_{}_{}",
                    reference.identity.0, reference.identity.1
                ),
                nested_tools,
            )));
        }
        let description = application_description(&reference, &capabilities);
        Ok(Arc::new(LazyNestedAgent {
            name: application_tool_name(reference.identity),
            description,
            profile,
            toolsets,
            model_facade: self.model_facade.clone(),
            elitea_context: self.elitea_context.clone(),
            sub_agents: Vec::new(),
        }))
    }
}

#[derive(Clone)]
struct ApplicationReference {
    identity: ApplicationIdentity,
    name: String,
    description: Option<String>,
    agent_type: String,
    project_id: Option<u64>,
}

fn application_references(
    snapshot: &AdmittedToolSnapshot<'_>,
) -> Result<Vec<ApplicationReference>, NativeAgentAssemblyError> {
    let mut seen = HashSet::new();
    let mut references = Vec::new();
    for reference in snapshot
        .iter()
        .filter(|reference| reference.kind() == FrozenToolKind::Application)
    {
        let identity = reference
            .application_identity()
            .ok_or_else(invalid_configuration)?;
        if seen.insert(identity) {
            references.push(ApplicationReference {
                identity,
                name: reference.toolkit_name().to_owned(),
                description: reference.application_description().map(str::to_owned),
                agent_type: reference
                    .application_agent_type()
                    .ok_or_else(invalid_configuration)?
                    .to_owned(),
                project_id: reference.application_project_id(),
            });
        }
    }
    Ok(references)
}

fn configured_capabilities(snapshot: &AdmittedToolSnapshot<'_>) -> Vec<String> {
    let mut seen = HashSet::new();
    snapshot
        .iter()
        .filter(|reference| reference.kind() != FrozenToolKind::Application)
        .filter_map(|reference| {
            let label = reference.toolkit_name();
            if seen.len() >= MAX_DESCRIPTION_CAPABILITIES || !seen.insert(label.to_owned()) {
                None
            } else {
                Some(label.to_owned())
            }
        })
        .collect()
}

fn application_tool_name(identity: ApplicationIdentity) -> String {
    format!("elitea_agent_{}_v_{}", identity.0, identity.1)
}

fn application_description(reference: &ApplicationReference, capabilities: &[String]) -> String {
    let mut description = format!(
        "Delegate a self-contained task to the saved Elitea agent '{}'. Use this tool when that agent's purpose and configured capabilities match the work; include all context needed in task.",
        reference.name
    );
    if let Some(base) = reference
        .description
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        push_bounded(&mut description, " Purpose: ", base);
    }
    if !capabilities.is_empty() {
        push_bounded(
            &mut description,
            " Configured capabilities: ",
            &capabilities.join(", "),
        );
    }
    push_bounded(
        &mut description,
        " ",
        "The child runs its own frozen instructions, model ownership, and toolsets and returns its final response.",
    );
    description
}

fn push_bounded(target: &mut String, separator: &str, value: &str) {
    let available = MAX_AGENT_DESCRIPTION_BYTES.saturating_sub(target.len());
    if available <= separator.len() {
        return;
    }
    target.push_str(separator);
    let remaining = MAX_AGENT_DESCRIPTION_BYTES.saturating_sub(target.len());
    if value.len() <= remaining {
        target.push_str(value);
        return;
    }
    let boundary = value
        .char_indices()
        .map(|(index, _)| index)
        .take_while(|index| *index <= remaining)
        .last()
        .unwrap_or(0);
    target.push_str(&value[..boundary]);
}

struct LazyNestedAgent {
    name: String,
    description: String,
    profile: OrdinaryNoToolProfile,
    toolsets: Vec<Arc<dyn Toolset>>,
    model_facade: Arc<ModelFacade>,
    elitea_context: Arc<ClaimScopedEliteaContext>,
    sub_agents: Vec<Arc<dyn Agent>>,
}

#[async_trait]
impl Agent for LazyNestedAgent {
    fn name(&self) -> &str {
        &self.name
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn sub_agents(&self) -> &[Arc<dyn Agent>] {
        &self.sub_agents
    }

    async fn run(&self, ctx: Arc<dyn InvocationContext>) -> adk_rust::Result<EventStream> {
        let invocation = ModelInvocation {
            model_name: self.profile.model_name().to_owned(),
            system_instruction: self.profile.instructions().to_owned(),
            max_tokens: self.profile.max_tokens(),
            reasoning_effort: self.profile.reasoning_effort().map(model_reasoning_effort),
            temperature: self.profile.temperature(),
            max_model_turns: self.profile.step_limit(),
        };
        let adapter = match self.profile.model_provider() {
            OrdinaryModelProvider::OpenAiChat => ModelAdapterKind::OpenAiCompatible,
            OrdinaryModelProvider::NativeAnthropic => ModelAdapterKind::Anthropic,
        };
        let model = self
            .model_facade
            .bind(
                adapter,
                self.elitea_context.as_ref(),
                self.profile.model_project_id(),
                invocation,
            )
            .map_err(model_error)?;
        let mut builder = LlmAgentBuilder::new(self.name.clone())
            .description(self.description.clone())
            .model(model.adk_model())
            .generate_content_config(GenerateContentConfig {
                temperature: self.profile.temperature(),
                max_output_tokens: i32::try_from(self.profile.max_tokens()).ok(),
                ..GenerateContentConfig::default()
            })
            .max_iterations(self.profile.step_limit())
            .disallow_transfer_to_parent(true)
            .disallow_transfer_to_peers(true);
        for toolset in &self.toolsets {
            builder = builder.toolset(toolset.clone());
        }
        let agent = builder.build().map_err(|_| agent_configuration_error())?;
        agent.run(ctx).await
    }
}

struct ApplicationAgentTool {
    inner: AgentTool,
    identity: ApplicationIdentity,
}

impl ApplicationAgentTool {
    fn new(agent: Arc<dyn Agent>, identity: ApplicationIdentity) -> Self {
        Self {
            inner: AgentTool::with_config(
                agent,
                AgentToolConfig {
                    skip_summarization: false,
                    forward_artifacts: false,
                    timeout: None,
                    input_schema: None,
                    output_schema: Some(json!({
                        "type": "object",
                        "properties": {"response": {"type": "string"}},
                        "required": ["response"],
                        "additionalProperties": false
                    })),
                },
            ),
            identity,
        }
    }
}

#[async_trait]
impl Tool for ApplicationAgentTool {
    fn name(&self) -> &str {
        self.inner.name()
    }

    fn description(&self) -> &str {
        self.inner.description()
    }

    fn parameters_schema(&self) -> Option<Value> {
        Some(json!({
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": MAX_APPLICATION_TASK_BYTES,
                    "description": "Required self-contained task for this saved agent. Include all context the child needs; maximum 240 KiB UTF-8."
                }
            },
            "required": ["task"],
            "additionalProperties": false
        }))
    }

    fn response_schema(&self) -> Option<Value> {
        self.inner.response_schema()
    }

    async fn execute(
        &self,
        ctx: Arc<dyn ToolContext>,
        arguments: Value,
    ) -> adk_rust::Result<Value> {
        let span = tracing::info_span!(
            "agent.nested_application.invoke",
            application_id = self.identity.0,
            version_id = self.identity.1,
            invocation_id = %ctx.invocation_id(),
            function_call_id = %ctx.function_call_id(),
            outcome = tracing::field::Empty,
            error_code = tracing::field::Empty,
        );
        let result = async {
            let object = arguments.as_object().ok_or_else(tool_input_error)?;
            if object.len() != 1 || !object.contains_key("task") {
                return Err(tool_input_error());
            }
            let task = object
                .get("task")
                .and_then(Value::as_str)
                .filter(|value| {
                    !value.is_empty()
                        && value.len() <= MAX_APPLICATION_TASK_BYTES
                        && !value.contains('\0')
                })
                .ok_or_else(tool_input_error)?;
            self.inner.execute(ctx, json!({"request": task})).await
        }
        .instrument(span.clone())
        .await;
        match &result {
            Ok(_) => {
                span.record("outcome", "succeeded");
            }
            Err(error) => {
                span.record("outcome", "failed");
                span.record("error_code", error.code);
            }
        }
        result
    }
}

const fn model_reasoning_effort(effort: ReasoningEffort) -> ModelReasoningEffort {
    match effort {
        ReasoningEffort::Low => ModelReasoningEffort::Low,
        ReasoningEffort::Medium => ModelReasoningEffort::Medium,
        ReasoningEffort::High => ModelReasoningEffort::High,
        ReasoningEffort::None => ModelReasoningEffort::None,
    }
}

fn model_error(error: ModelFacadeError) -> AdkError {
    let category = match error {
        ModelFacadeError::InvalidConfiguration | ModelFacadeError::InvalidInvocation => {
            ErrorCategory::InvalidInput
        }
        ModelFacadeError::ResourceExhausted => ErrorCategory::InvalidInput,
        ModelFacadeError::DependencyUnavailable => ErrorCategory::Unavailable,
    };
    AdkError::new(
        ErrorComponent::Model,
        category,
        "elitea_nested_agent.model_unavailable",
        "the nested agent model could not be bound",
    )
}

fn agent_configuration_error() -> AdkError {
    AdkError::new(
        ErrorComponent::Agent,
        ErrorCategory::InvalidInput,
        "elitea_nested_agent.invalid_configuration",
        "the nested agent configuration is invalid",
    )
}

fn tool_input_error() -> AdkError {
    AdkError::new(
        ErrorComponent::Tool,
        ErrorCategory::InvalidInput,
        "elitea_nested_agent.invalid_task",
        "the nested agent task is invalid",
    )
}

fn snapshot_error(error: crate::toolkits::FrozenToolSnapshotError) -> NativeAgentAssemblyError {
    let code = match error.code() {
        FrozenToolSnapshotErrorCode::InvalidInput => NativeAgentAssemblyErrorCode::InvalidInput,
        FrozenToolSnapshotErrorCode::ResourceExhausted => {
            NativeAgentAssemblyErrorCode::ResourceExhausted
        }
    };
    NativeAgentAssemblyError::new(code, "the nested application tool snapshot is malformed")
}

fn toolset_error(error: crate::toolkits::ToolsetMaterializationError) -> NativeAgentAssemblyError {
    let code = match error.code() {
        ToolsetMaterializationErrorCode::InvalidConfiguration => {
            NativeAgentAssemblyErrorCode::InvalidConfiguration
        }
        ToolsetMaterializationErrorCode::UnsupportedToolkit => {
            NativeAgentAssemblyErrorCode::UnsupportedCapability
        }
        ToolsetMaterializationErrorCode::ResourceExhausted => {
            NativeAgentAssemblyErrorCode::ResourceExhausted
        }
    };
    NativeAgentAssemblyError::new(code, "the nested application toolsets are unavailable")
}

fn mcp_toolset_error(error: crate::toolkits::McpMaterializationError) -> NativeAgentAssemblyError {
    let code = match error.code() {
        McpMaterializationErrorCode::InvalidConfiguration => {
            NativeAgentAssemblyErrorCode::InvalidConfiguration
        }
        McpMaterializationErrorCode::UnsupportedAuthority => {
            NativeAgentAssemblyErrorCode::UnsupportedCapability
        }
        McpMaterializationErrorCode::ResourceExhausted => {
            NativeAgentAssemblyErrorCode::ResourceExhausted
        }
        McpMaterializationErrorCode::DependencyUnavailable => {
            NativeAgentAssemblyErrorCode::DependencyUnavailable
        }
    };
    NativeAgentAssemblyError::new(code, "the nested application MCP toolsets are unavailable")
}

fn invalid_configuration() -> NativeAgentAssemblyError {
    NativeAgentAssemblyError::new(
        NativeAgentAssemblyErrorCode::InvalidConfiguration,
        "the nested application graph is invalid",
    )
}

fn unsupported_capability() -> NativeAgentAssemblyError {
    NativeAgentAssemblyError::new(
        NativeAgentAssemblyErrorCode::UnsupportedCapability,
        "the nested application kind is not yet available",
    )
}

fn resource_exhausted() -> NativeAgentAssemblyError {
    NativeAgentAssemblyError::new(
        NativeAgentAssemblyErrorCode::ResourceExhausted,
        "the nested application graph exceeds its approved limit",
    )
}

//! Authorized stored-pipeline admission before any provider or tool authority.
//!
//! Pipeline HITL is a YAML graph node and never uses the direct sensitive-tool
//! confirmation path. This module binds the frozen application shell to the
//! graph compiler and one claim-fenced session/checkpoint boundary. The family
//! remains capability-disabled until lifecycle routing enables this assembler.

#![allow(dead_code)] // Capability routing remains intentionally disabled.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use std::time::Duration;

use adk_rust::agent::LlmAgentBuilder;
use adk_rust::tool::SimpleToolContext;
use adk_rust::{Agent, GenerateContentConfig, ReadonlyContext, Tool, Toolset};
use async_trait::async_trait;
use sqlx::PgPool;
use tracing::Instrument as _;

use super::application_tools::{ApplicationToolDependencies, materialize_application_tools};
use super::assembly::{OrdinaryModelProvider, OrdinaryNoToolProfile, ReasoningEffort};
use super::graph::compiler::PipelineNodeRuntimes;
use super::graph::compiler::{PipelineConfigurationError, PipelineDefinition};
use super::graph::{
    ApplicationExecutionError, DirectToolExecutionError, DirectToolNodeKind, DirectToolSelection,
    LlmExecutionError, LlmExecutionInput, LlmNodeDefinition, PipelineApplicationResolver,
    PipelineApplicationSelection, PipelineDirectToolResolver, PipelineLlmAgentFactory,
    ResolvedDirectTool,
};
use super::request::AgentExecutionRequest;
use super::runtime::{
    AssembledNativeAgentInvocation, AuthorizedNativeAssembly, NativeAgentAssembler,
    NativeAgentAssemblyError, NativeAgentAssemblyErrorCode,
};
use super::session::{
    BoundOrdinaryAgentModel, NativePipelineStateBackend, PipelineAgentCompletion,
    assemble_pipeline_native,
};
use crate::protocol::control::ClaimBoundRuntimeContextAuthority;
use crate::state::{CheckpointLimits, SessionLimits};
use crate::toolkits::{
    AdkHttpMcpConnector, AdmittedToolSnapshot, FrozenToolKind, FrozenToolSnapshot, McpConnector,
    SensitiveToolPolicy, ToolAdmissionDecision, ToolAdmissionPolicy,
    materialize_configured_toolsets, materialize_mcp_toolsets,
};
use crate::transport::model_facade::{
    ModelAdapterKind, ModelFacade, ModelInvocation, ModelReasoningEffort,
};
use crate::transport::platform_client::PlatformClient;
use crate::transport::runtime_context::ClaimScopedEliteaContext;

const PIPELINE_TOOL_ENUMERATION_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_PIPELINE_MATERIALIZED_TOOLS: usize = 1_024;

/// Frozen, fully admitted application pipeline definition.
pub(crate) struct PipelineExecutionProfile {
    shell: OrdinaryNoToolProfile,
    definition: PipelineDefinition,
    sensitive_direct_tools: BTreeMap<(String, String), SensitiveToolPolicy>,
}

impl PipelineExecutionProfile {
    /// Admit a saved pipeline without constructing a model, tool or credential.
    pub(crate) fn validate(
        request: &AgentExecutionRequest,
        resume: bool,
    ) -> Result<Self, NativeAgentAssemblyError> {
        let shell = OrdinaryNoToolProfile::validate_pipeline_shell(request, resume)?;
        let definition = PipelineDefinition::from_yaml(shell.instructions())
            .map_err(|error| pipeline_configuration_error(&error))?;
        Ok(Self {
            shell,
            definition,
            sensitive_direct_tools: BTreeMap::new(),
        })
    }

    #[must_use]
    pub(crate) const fn shell(&self) -> &OrdinaryNoToolProfile {
        &self.shell
    }

    #[must_use]
    pub(crate) const fn definition(&self) -> &PipelineDefinition {
        &self.definition
    }

    #[must_use]
    pub(crate) fn into_definition(self) -> PipelineDefinition {
        self.definition
    }

    /// Bind node selections to the exact frozen toolkit aliases before any
    /// credential or client is constructed.
    pub(crate) fn validate_tool_snapshot(
        &mut self,
        snapshot: &FrozenToolSnapshot<'_>,
        policy: &ToolAdmissionPolicy,
    ) -> Result<(), NativeAgentAssemblyError> {
        self.sensitive_direct_tools.clear();
        for selection in self.definition.llm_tool_selections() {
            let mut matches = snapshot
                .iter()
                .filter(|reference| reference.toolkit_name() == selection.alias());
            let Some(reference) = matches.next() else {
                return Err(invalid_pipeline_tool_scope());
            };
            if matches.next().is_some() || reference.kind() == FrozenToolKind::Application {
                return Err(invalid_pipeline_tool_scope());
            }
            if policy.toolkit_decision(reference.tool_type()) != ToolAdmissionDecision::Allowed {
                return Err(unsupported_pipeline_tool_scope());
            }
            for tool_name in selection.tools() {
                if policy.tool_decision(reference.tool_type(), tool_name)
                    != ToolAdmissionDecision::Allowed
                    || policy
                        .sensitive_tool(reference.tool_type(), reference.toolkit_name(), tool_name)
                        .is_some()
                {
                    // The exact graph tool-confirmation bridge is a later
                    // slice. Never downgrade a selected sensitive/blocked tool
                    // to an ordinary call meanwhile.
                    return Err(unsupported_pipeline_tool_scope());
                }
                let configured = reference
                    .settings()
                    .and_then(|settings| settings.get("selected_tools"))
                    .and_then(serde_json::Value::as_array);
                if configured.is_some_and(|configured| {
                    !configured.is_empty()
                        && !configured
                            .iter()
                            .any(|name| name.as_str() == Some(tool_name))
                }) {
                    return Err(invalid_pipeline_tool_scope());
                }
            }
        }
        for selection in self.definition.direct_tool_selections() {
            let mut matches = snapshot
                .iter()
                .filter(|reference| reference.toolkit_name() == selection.alias());
            let Some(reference) = matches.next() else {
                return Err(invalid_pipeline_tool_scope());
            };
            let expected_kind = match selection.kind() {
                DirectToolNodeKind::Toolkit => FrozenToolKind::Configured,
                DirectToolNodeKind::Mcp => FrozenToolKind::Mcp,
            };
            if matches.next().is_some() || reference.kind() != expected_kind {
                return Err(invalid_pipeline_tool_scope());
            }
            if policy.toolkit_decision(reference.tool_type()) != ToolAdmissionDecision::Allowed {
                return Err(unsupported_pipeline_tool_scope());
            }
            if policy.tool_decision(reference.tool_type(), selection.tool())
                != ToolAdmissionDecision::Allowed
            {
                return Err(unsupported_pipeline_tool_scope());
            }
            if let Some(sensitive) = policy.sensitive_tool(
                reference.tool_type(),
                reference.toolkit_name(),
                selection.tool(),
            ) {
                self.sensitive_direct_tools.insert(
                    (selection.alias().to_owned(), selection.tool().to_owned()),
                    sensitive,
                );
            }
            let configured = reference
                .settings()
                .and_then(|settings| settings.get("selected_tools"))
                .and_then(serde_json::Value::as_array);
            if configured.is_some_and(|configured| {
                !configured.is_empty()
                    && !configured
                        .iter()
                        .any(|name| name.as_str() == Some(selection.tool()))
            }) {
                return Err(invalid_pipeline_tool_scope());
            }
        }
        let mut application_identities = BTreeMap::new();
        for selection in self.definition.application_selections() {
            let identity = validate_application_selection(selection, snapshot, policy)?;
            if application_identities
                .insert(identity, selection.alias())
                .is_some_and(|alias| alias != selection.alias())
            {
                return Err(invalid_pipeline_tool_scope());
            }
        }
        Ok(())
    }

    fn sensitive_direct_tool(
        &self,
        selection: &DirectToolSelection,
    ) -> Option<SensitiveToolPolicy> {
        self.sensitive_direct_tools
            .get(&(selection.alias().to_owned(), selection.tool().to_owned()))
            .cloned()
    }
}

/// Authorized assembler for stored pipelines backed by ADK `GraphAgent`.
pub(crate) struct PipelineNativeAgentAssembler {
    state: NativePipelineStateBackend,
    tool_policy: Arc<ToolAdmissionPolicy>,
    platform: Option<Arc<PlatformClient>>,
    model_facade: Option<Arc<ModelFacade>>,
    mcp_connector: Arc<dyn McpConnector>,
}

impl PipelineNativeAgentAssembler {
    /// Use the shared `agentstate` database for both ADK sessions and graph
    /// checkpoints, with separate claim-fenced tables and one immutable lease.
    #[must_use]
    pub(crate) fn postgres(
        pool: PgPool,
        session_limits: SessionLimits,
        checkpoint_limits: CheckpointLimits,
        tool_policy: Arc<ToolAdmissionPolicy>,
        platform: Arc<PlatformClient>,
        model_facade: Arc<ModelFacade>,
    ) -> Self {
        Self {
            state: NativePipelineStateBackend::postgres(pool, session_limits, checkpoint_limits),
            tool_policy,
            platform: Some(platform),
            model_facade: Some(model_facade),
            mcp_connector: Arc::new(AdkHttpMcpConnector::new()),
        }
    }

    #[cfg(test)]
    #[must_use]
    pub(crate) fn with_state(
        sessions: Arc<dyn adk_rust::session::SessionService>,
        checkpointer: Arc<dyn adk_rust::graph::Checkpointer>,
    ) -> Self {
        let tool_policy = Arc::new(
            ToolAdmissionPolicy::new(&[], &std::collections::BTreeMap::new())
                .expect("empty tool policy"),
        );
        Self {
            state: NativePipelineStateBackend::injected(sessions, checkpointer),
            tool_policy,
            platform: None,
            model_facade: None,
            mcp_connector: Arc::new(AdkHttpMcpConnector::new()),
        }
    }

    #[cfg(test)]
    #[must_use]
    pub(crate) fn with_mcp_connector(mut self, connector: Arc<dyn McpConnector>) -> Self {
        self.mcp_connector = connector;
        self
    }

    async fn bind_node_runtimes(
        &self,
        profile: &PipelineExecutionProfile,
        toolsets: AdmittedToolSnapshot<'_>,
        runtime_context: &ClaimBoundRuntimeContextAuthority,
    ) -> Result<PipelineNodeRuntimes, NativeAgentAssemblyError> {
        let has_llm_nodes = profile.definition().has_llm_nodes();
        let has_direct_tool_nodes = profile.definition().has_direct_tool_nodes();
        let has_application_nodes = profile.definition().has_application_nodes();
        if !has_llm_nodes && !has_direct_tool_nodes && !has_application_nodes {
            return Ok(PipelineNodeRuntimes::default());
        }
        let (context, model_facade) = if has_llm_nodes || has_application_nodes {
            let platform = self
                .platform
                .as_ref()
                .ok_or_else(unsupported_pipeline_runtime)?;
            let model_facade = self
                .model_facade
                .clone()
                .ok_or_else(unsupported_pipeline_runtime)?;
            tracing::Span::current().record("stage", "runtime_context");
            let context = platform
                .redeem_elitea_context(runtime_context)
                .await
                .map_err(NativeAgentAssemblyError::from)?;
            (Some(Arc::new(context)), Some(model_facade))
        } else {
            (None, None)
        };
        tracing::Span::current().record("stage", "toolsets");
        let aliases = profile.definition().runtime_toolkit_aliases();
        let selected_snapshot = toolsets.retain_toolkit_names(&aliases);
        let mut materialized =
            materialize_configured_toolsets(&selected_snapshot, &self.tool_policy)
                .map_err(|_| unsupported_pipeline_runtime())?;
        let mut mcp = materialize_mcp_toolsets(
            &selected_snapshot,
            self.mcp_connector.as_ref(),
            &self.tool_policy,
        )
        .await
        .map_err(|_| unsupported_pipeline_runtime())?;
        materialized.append(&mut mcp);
        let toolsets = toolsets_by_alias(materialized)?;
        let direct_tool_resolver = build_direct_tool_resolver(profile, &toolsets).await?;
        let application_resolver = self
            .build_application_resolver(
                profile,
                &selected_snapshot,
                runtime_context,
                context.clone(),
                model_facade.clone(),
            )
            .await?;
        let llm_factory = context.zip(model_facade).map(|(context, model_facade)| {
            Arc::new(NativePipelineLlmAgentFactory {
                profile: profile.shell().clone(),
                context,
                model_facade,
                toolsets,
            }) as Arc<dyn PipelineLlmAgentFactory>
        });
        Ok(PipelineNodeRuntimes::new(
            llm_factory,
            direct_tool_resolver,
            application_resolver,
        ))
    }

    async fn build_application_resolver(
        &self,
        profile: &PipelineExecutionProfile,
        snapshot: &AdmittedToolSnapshot<'_>,
        runtime_context: &ClaimBoundRuntimeContextAuthority,
        context: Option<Arc<ClaimScopedEliteaContext>>,
        model_facade: Option<Arc<ModelFacade>>,
    ) -> Result<Option<Arc<dyn PipelineApplicationResolver>>, NativeAgentAssemblyError> {
        if !profile.definition().has_application_nodes() {
            return Ok(None);
        }
        let platform = self
            .platform
            .as_ref()
            .ok_or_else(unsupported_pipeline_runtime)?;
        let tools = materialize_application_tools(
            snapshot,
            platform,
            runtime_context,
            context.ok_or_else(unsupported_pipeline_runtime)?,
            profile.shell(),
            ApplicationToolDependencies {
                model_facade: model_facade.ok_or_else(unsupported_pipeline_runtime)?,
                policy: Arc::clone(&self.tool_policy),
                mcp_connector: Arc::clone(&self.mcp_connector),
            },
        )
        .await?;
        let expected = profile
            .definition()
            .application_selections()
            .map(PipelineApplicationSelection::alias)
            .collect::<BTreeSet<_>>();
        let actual = tools
            .iter()
            .map(|entry| entry.alias.as_str())
            .collect::<BTreeSet<_>>();
        if actual != expected {
            return Err(invalid_pipeline_tool_scope());
        }
        build_application_resolver(tools).map(Some)
    }
}

#[async_trait]
impl NativeAgentAssembler for PipelineNativeAgentAssembler {
    type Completion = PipelineAgentCompletion;

    async fn assemble(
        &self,
        assembly: AuthorizedNativeAssembly<'_>,
    ) -> Result<AssembledNativeAgentInvocation<Self::Completion>, NativeAgentAssemblyError> {
        let span = tracing::info_span!(
            "agent.pipeline.assemble",
            execution_kind = ?assembly.request().kind,
            stage = tracing::field::Empty,
            session_backend = "postgres_graph",
            outcome = tracing::field::Empty,
            error_code = tracing::field::Empty,
        );
        let result = async {
            tracing::Span::current().record("stage", "admission");
            let admitted = assembly.admit_pipeline_with_policy(self.tool_policy.as_ref())?;
            let (profile, plan, toolsets, start, runtime_context, session, lease) =
                admitted.into_parts();
            let node_runtimes = self
                .bind_node_runtimes(&profile, toolsets, &runtime_context)
                .await?;
            tracing::Span::current().record("stage", "state");
            assemble_pipeline_native(
                plan,
                profile.into_definition(),
                start,
                session,
                lease,
                &self.state,
                node_runtimes,
            )
            .await
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
    }
}

struct NativePipelineLlmAgentFactory {
    profile: OrdinaryNoToolProfile,
    context: Arc<ClaimScopedEliteaContext>,
    model_facade: Arc<ModelFacade>,
    toolsets: std::collections::BTreeMap<String, Arc<dyn Toolset>>,
}

struct NativePipelineDirectToolResolver {
    tools: BTreeMap<(String, String), ResolvedDirectTool>,
}

struct NativePipelineApplicationResolver {
    tools: BTreeMap<String, Arc<dyn Tool>>,
}

impl PipelineApplicationResolver for NativePipelineApplicationResolver {
    fn resolve(
        &self,
        selection: &PipelineApplicationSelection,
    ) -> Result<Arc<dyn Tool>, ApplicationExecutionError> {
        self.tools
            .get(selection.alias())
            .cloned()
            .ok_or(ApplicationExecutionError::Unavailable)
    }
}

impl PipelineDirectToolResolver for NativePipelineDirectToolResolver {
    fn resolve(
        &self,
        selection: &DirectToolSelection,
    ) -> Result<ResolvedDirectTool, DirectToolExecutionError> {
        self.tools
            .get(&(selection.alias().to_owned(), selection.tool().to_owned()))
            .cloned()
            .ok_or(DirectToolExecutionError::Unavailable)
    }
}

impl PipelineLlmAgentFactory for NativePipelineLlmAgentFactory {
    fn build(
        &self,
        definition: &LlmNodeDefinition,
        input: &LlmExecutionInput,
        output_schema: Option<serde_json::Value>,
    ) -> Result<Arc<dyn Agent>, LlmExecutionError> {
        let system_instruction = if input.system().trim().is_empty() {
            "You are an AI assistant executing one bounded Elitea pipeline node.".to_owned()
        } else {
            input.system().to_owned()
        };
        let invocation = ModelInvocation {
            model_name: self.profile.model_name().to_owned(),
            system_instruction,
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
                self.context.as_ref(),
                self.profile.model_project_id(),
                invocation,
            )
            .map_err(|_| LlmExecutionError::Unavailable)?;
        let mut builder = LlmAgentBuilder::new(definition.id())
            .description("Elitea stored-pipeline LLM node")
            .model(model.adk_model())
            .generate_content_config(GenerateContentConfig {
                temperature: self.profile.temperature(),
                max_output_tokens: i32::try_from(self.profile.max_tokens()).ok(),
                ..GenerateContentConfig::default()
            })
            .max_iterations(self.profile.step_limit())
            .tool_timeout(Duration::from_secs(definition.tool_execution_timeout()))
            .disallow_transfer_to_parent(true)
            .disallow_transfer_to_peers(true);
        if let Some(schema) = output_schema {
            builder = builder.output_schema(schema).output_max_retries(2);
        }
        for selection in definition.tool_selections() {
            if selection.tools().is_empty() {
                continue;
            }
            let inner = self
                .toolsets
                .get(selection.alias())
                .cloned()
                .ok_or(LlmExecutionError::Unavailable)?;
            builder = builder.toolset(Arc::new(StrictNodeToolset::new(
                selection.alias(),
                inner,
                selection.tools(),
            )));
        }
        builder
            .build()
            .map(|agent| Arc::new(agent) as Arc<dyn Agent>)
            .map_err(|_| LlmExecutionError::Unavailable)
    }
}

pub(super) struct StrictNodeToolset {
    name: String,
    inner: Arc<dyn Toolset>,
    selected: Vec<String>,
}

impl StrictNodeToolset {
    pub(super) fn new(alias: &str, inner: Arc<dyn Toolset>, selected: &[String]) -> Self {
        Self {
            name: format!("pipeline_{alias}"),
            inner,
            selected: selected.to_vec(),
        }
    }
}

#[async_trait]
impl Toolset for StrictNodeToolset {
    fn name(&self) -> &str {
        &self.name
    }

    async fn tools(
        &self,
        context: Arc<dyn ReadonlyContext>,
    ) -> adk_rust::Result<Vec<Arc<dyn Tool>>> {
        let available = self.inner.tools(context).await?;
        let mut by_name = std::collections::BTreeMap::new();
        for tool in available {
            if by_name.insert(tool.name().to_owned(), tool).is_some() {
                return Err(adk_rust::AdkError::config(
                    "a pipeline toolkit exposes duplicate tool names",
                ));
            }
        }
        self.selected
            .iter()
            .map(|name| {
                by_name.get(name).cloned().ok_or_else(|| {
                    adk_rust::AdkError::config("a pipeline LLM node selected an unavailable tool")
                })
            })
            .collect()
    }
}

fn toolsets_by_alias(
    toolsets: Vec<Arc<dyn Toolset>>,
) -> Result<std::collections::BTreeMap<String, Arc<dyn Toolset>>, NativeAgentAssemblyError> {
    let mut by_alias = std::collections::BTreeMap::new();
    for toolset in toolsets {
        if by_alias
            .insert(toolset.name().to_owned(), toolset)
            .is_some()
        {
            return Err(invalid_pipeline_tool_scope());
        }
    }
    Ok(by_alias)
}

async fn build_direct_tool_resolver(
    profile: &PipelineExecutionProfile,
    toolsets: &BTreeMap<String, Arc<dyn Toolset>>,
) -> Result<Option<Arc<dyn PipelineDirectToolResolver>>, NativeAgentAssemblyError> {
    let selections = profile
        .definition()
        .direct_tool_selections()
        .collect::<Vec<_>>();
    if selections.is_empty() {
        return Ok(None);
    }
    let aliases = selections
        .iter()
        .map(|selection| selection.alias())
        .collect::<BTreeSet<_>>();
    let context: Arc<dyn ReadonlyContext> =
        Arc::new(SimpleToolContext::new("pipeline_toolkit_catalog"));
    let mut tools = BTreeMap::new();
    for alias in aliases {
        let toolset = toolsets
            .get(alias)
            .ok_or_else(invalid_pipeline_tool_scope)?;
        let available = tokio::time::timeout(
            PIPELINE_TOOL_ENUMERATION_TIMEOUT,
            toolset.tools(Arc::clone(&context)),
        )
        .await
        .map_err(|_| unsupported_pipeline_runtime())?
        .map_err(|_| unsupported_pipeline_runtime())?;
        if available.len() > MAX_PIPELINE_MATERIALIZED_TOOLS {
            return Err(invalid_pipeline_tool_scope());
        }
        let mut by_name = BTreeMap::new();
        for tool in available {
            if by_name.insert(tool.name().to_owned(), tool).is_some() {
                return Err(invalid_pipeline_tool_scope());
            }
        }
        for selection in selections
            .iter()
            .filter(|selection| selection.alias() == alias)
        {
            let tool = by_name
                .get(selection.tool())
                .cloned()
                .ok_or_else(invalid_pipeline_tool_scope)?;
            if !tool.is_read_only() {
                // Direct effects need graph-native durable confirmation and an
                // effect receipt/reconciliation owner before activation.
                return Err(unsupported_pipeline_tool_scope());
            }
            tools.insert(
                (selection.alias().to_owned(), selection.tool().to_owned()),
                ResolvedDirectTool::new(tool, profile.sensitive_direct_tool(selection)),
            );
        }
    }
    Ok(Some(Arc::new(NativePipelineDirectToolResolver { tools })))
}

fn build_application_resolver(
    materialized: Vec<super::application_tools::MaterializedApplicationTool>,
) -> Result<Arc<dyn PipelineApplicationResolver>, NativeAgentAssemblyError> {
    let mut tools = BTreeMap::new();
    for entry in materialized {
        if tools.insert(entry.alias, entry.tool).is_some() {
            return Err(invalid_pipeline_tool_scope());
        }
    }
    Ok(Arc::new(NativePipelineApplicationResolver { tools }))
}

fn validate_application_selection(
    selection: &PipelineApplicationSelection,
    snapshot: &FrozenToolSnapshot<'_>,
    policy: &ToolAdmissionPolicy,
) -> Result<(u64, u64), NativeAgentAssemblyError> {
    let mut matches = snapshot
        .iter()
        .filter(|reference| reference.toolkit_name() == selection.alias());
    let Some(reference) = matches.next() else {
        return Err(invalid_pipeline_tool_scope());
    };
    if matches.next().is_some()
        || reference.kind() != FrozenToolKind::Application
        || !matches!(
            reference.application_agent_type(),
            Some("agent" | "pipeline")
        )
    {
        return Err(invalid_pipeline_tool_scope());
    }
    if policy.toolkit_decision(reference.tool_type()) != ToolAdmissionDecision::Allowed {
        return Err(unsupported_pipeline_tool_scope());
    }
    reference
        .application_identity()
        .ok_or_else(invalid_pipeline_tool_scope)
}

const fn model_reasoning_effort(effort: ReasoningEffort) -> ModelReasoningEffort {
    match effort {
        ReasoningEffort::Low => ModelReasoningEffort::Low,
        ReasoningEffort::Medium => ModelReasoningEffort::Medium,
        ReasoningEffort::High => ModelReasoningEffort::High,
        ReasoningEffort::None => ModelReasoningEffort::None,
    }
}

fn pipeline_configuration_error(error: &PipelineConfigurationError) -> NativeAgentAssemblyError {
    let code = match error.code() {
        "graph.pipeline.configuration_resource_exhausted" => {
            NativeAgentAssemblyErrorCode::ResourceExhausted
        }
        "graph.pipeline.unsupported_capability" => {
            NativeAgentAssemblyErrorCode::UnsupportedCapability
        }
        "graph.pipeline.malformed_yaml" | "graph.pipeline.invalid_configuration" => {
            NativeAgentAssemblyErrorCode::InvalidInput
        }
        _ => NativeAgentAssemblyErrorCode::InvalidConfiguration,
    };
    NativeAgentAssemblyError::new(code, "the stored pipeline definition could not be admitted")
}

const fn invalid_pipeline_tool_scope() -> NativeAgentAssemblyError {
    NativeAgentAssemblyError::new(
        NativeAgentAssemblyErrorCode::InvalidInput,
        "a pipeline LLM node references a tool outside its frozen scope",
    )
}

const fn unsupported_pipeline_tool_scope() -> NativeAgentAssemblyError {
    NativeAgentAssemblyError::new(
        NativeAgentAssemblyErrorCode::UnsupportedCapability,
        "a pipeline LLM node selected a tool whose graph authorization is not enabled",
    )
}

const fn unsupported_pipeline_runtime() -> NativeAgentAssemblyError {
    NativeAgentAssemblyError::new(
        NativeAgentAssemblyErrorCode::UnsupportedCapability,
        "the native pipeline LLM runtime is not available",
    )
}

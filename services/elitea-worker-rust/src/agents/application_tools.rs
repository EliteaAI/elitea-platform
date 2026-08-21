//! Claim-bound nested Elitea applications exposed through ADK `AgentTool`.
//!
//! Main admits exact application/version identities. During the one authorized
//! assembly phase this module resolves each identity once, revalidates the
//! bounded nesting graph, compiles a fresh direct `LlmAgent`, and presents it to
//! the parent model as a source-compatible `task` tool. Stored pipelines remain
//! owned by the graph compiler and fail closed here.

#![allow(dead_code)] // Production registration remains capability-gated.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use adk_rust::agent::LlmAgentBuilder;
use adk_rust::futures::StreamExt as _;
use adk_rust::tool::BasicToolset;
use adk_rust::{
    AdkError, Agent, Artifacts, CallbackContext, Content, ErrorCategory, ErrorComponent, Event,
    EventStream, GenerateContentConfig, InvocationContext, Memory, ReadonlyContext, RunConfig,
    SecretRequest, Session, State, StreamingMode, Tool, ToolConcurrencyConfig, ToolContext,
    ToolExecutionStrategy, Toolset,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use tokio::sync::{Mutex, mpsc};
use tracing::Instrument as _;

use super::assembly::{OrdinaryModelProvider, OrdinaryNoToolProfile, ReasoningEffort};
use super::events::{
    ApplicationToolPresentationCatalog, DESCENDANT_CONTAINER_INVOCATION_KEY,
    DESCENDANT_PARENT_CALL_KEY,
};
use super::runtime::{NativeAgentAssemblyError, NativeAgentAssemblyErrorCode};
use super::sensitive_tools::{SensitiveToolCatalog, sensitive_tools_for_kind};
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
const APPLICATION_EVENT_CHANNEL_CAPACITY: usize = 64;
const MAX_PARALLEL_APPLICATION_CALLS: usize = 8;
const ADK_LLM_REQUEST_METADATA_KEY: &str = "gcp.vertex.agent.llm_request";
const ADK_LLM_RESPONSE_METADATA_KEY: &str = "gcp.vertex.agent.llm_response";

type ApplicationIdentity = (u64, u64);
type ApplicationFuture<'a> = Pin<
    Box<dyn Future<Output = Result<Arc<BuiltApplication>, NativeAgentAssemblyError>> + Send + 'a>,
>;

type ApplicationEventSender = mpsc::Sender<ApplicationEventSignal>;

enum ApplicationEventSignal {
    Event {
        container_invocation_id: String,
        parent_call_id: String,
        event: Box<Event>,
    },
    Fatal(ApplicationEventFailure),
}

#[derive(Clone, Copy)]
enum ApplicationEventFailure {
    NestedInterrupt,
    ChildExecution,
}

pub(crate) struct ApplicationEventReceiver {
    inner: Mutex<Option<mpsc::Receiver<ApplicationEventSignal>>>,
}

pub(crate) struct ApplicationToolDependencies {
    pub(crate) model_facade: Arc<ModelFacade>,
    pub(crate) policy: Arc<ToolAdmissionPolicy>,
    pub(crate) mcp_connector: Arc<dyn McpConnector>,
    event_sender: Option<ApplicationEventSender>,
}

impl ApplicationToolDependencies {
    #[must_use]
    pub(crate) fn new(
        model_facade: Arc<ModelFacade>,
        policy: Arc<ToolAdmissionPolicy>,
        mcp_connector: Arc<dyn McpConnector>,
    ) -> Self {
        Self {
            model_facade,
            policy,
            mcp_connector,
            event_sender: None,
        }
    }
}

/// One exact frozen Application alias bound to its invocation-owned ADK tool.
pub(crate) struct MaterializedApplicationTool {
    pub(crate) alias: String,
    pub(crate) agent_type: String,
    model_name: String,
    child_tools: ApplicationToolPresentationCatalog,
    sensitive_tools: SensitiveToolCatalog,
    pub(crate) tool: Arc<dyn Tool>,
}

struct BuiltApplication {
    agent: Arc<dyn Agent>,
    model_name: String,
    child_tools: ApplicationToolPresentationCatalog,
    sensitive_tools: SensitiveToolCatalog,
}

/// One root toolset plus its frozen browser-presentation join.
pub(crate) struct MaterializedApplicationToolset {
    pub(crate) toolset: Arc<dyn Toolset>,
    pub(crate) presentations: ApplicationToolPresentationCatalog,
    pub(crate) events: ApplicationEventReceiver,
}

/// Build the one nested-application toolset for the root direct agent.
pub(crate) async fn materialize_application_toolset(
    snapshot: &AdmittedToolSnapshot<'_>,
    platform: &PlatformClient,
    runtime_context: &ClaimBoundRuntimeContextAuthority,
    elitea_context: Arc<ClaimScopedEliteaContext>,
    fallback_profile: &OrdinaryNoToolProfile,
    mut dependencies: ApplicationToolDependencies,
) -> Result<Option<MaterializedApplicationToolset>, NativeAgentAssemblyError> {
    let (event_sender, event_receiver) = mpsc::channel(APPLICATION_EVENT_CHANNEL_CAPACITY);
    dependencies.event_sender = Some(event_sender);
    let materialized = materialize_application_tools(
        snapshot,
        platform,
        runtime_context,
        elitea_context,
        fallback_profile,
        dependencies,
        None,
    )
    .await?;
    if materialized.is_empty() {
        return Ok(None);
    }
    let mut presentations = ApplicationToolPresentationCatalog::default();
    for entry in &materialized {
        presentations
            .insert_runtime(
                entry.tool.name().to_owned(),
                entry.alias.clone(),
                entry.agent_type.clone(),
                entry.model_name.clone(),
                entry.child_tools.clone(),
                entry.sensitive_tools.clone(),
            )
            .map_err(|_| invalid_configuration())?;
    }
    Ok(Some(MaterializedApplicationToolset {
        toolset: Arc::new(BasicToolset::new(
            "elitea_nested_applications",
            materialized.into_iter().map(|entry| entry.tool).collect(),
        )),
        presentations,
        events: ApplicationEventReceiver {
            inner: Mutex::new(Some(event_receiver)),
        },
    }))
}

/// Resolve exact frozen saved applications without changing their graph alias.
pub(crate) async fn materialize_application_tools(
    snapshot: &AdmittedToolSnapshot<'_>,
    platform: &PlatformClient,
    runtime_context: &ClaimBoundRuntimeContextAuthority,
    elitea_context: Arc<ClaimScopedEliteaContext>,
    fallback_profile: &OrdinaryNoToolProfile,
    dependencies: ApplicationToolDependencies,
    selected_aliases: Option<&BTreeSet<String>>,
) -> Result<Vec<MaterializedApplicationTool>, NativeAgentAssemblyError> {
    let references = application_references(snapshot, selected_aliases)?;
    if references.is_empty() {
        return Ok(Vec::new());
    }
    let mut state = ApplicationAssemblyState {
        platform,
        runtime_context,
        model_facade: dependencies.model_facade,
        elitea_context,
        fallback_profile,
        policy: dependencies.policy,
        mcp_connector: dependencies.mcp_connector,
        applications: HashMap::new(),
        resolving: HashSet::new(),
        hops: 0,
        event_sender: dependencies.event_sender,
    };
    let mut tools = Vec::with_capacity(references.len());
    for reference in references {
        let identity = reference.identity;
        let alias = reference.name.clone();
        let agent_type = reference.agent_type.clone();
        let application = state.build(reference.clone(), 2).await?;
        tools.push(MaterializedApplicationTool {
            alias,
            agent_type,
            model_name: application.model_name.clone(),
            child_tools: application.child_tools.clone(),
            sensitive_tools: application.sensitive_tools.clone(),
            tool: Arc::new(ApplicationAgentTool::new(
                application,
                identity,
                state.event_sender.clone(),
            )),
        });
    }
    Ok(tools)
}

struct ApplicationAssemblyState<'a> {
    platform: &'a PlatformClient,
    runtime_context: &'a ClaimBoundRuntimeContextAuthority,
    model_facade: Arc<ModelFacade>,
    elitea_context: Arc<ClaimScopedEliteaContext>,
    fallback_profile: &'a OrdinaryNoToolProfile,
    policy: Arc<ToolAdmissionPolicy>,
    mcp_connector: Arc<dyn McpConnector>,
    applications: HashMap<ApplicationIdentity, Arc<BuiltApplication>>,
    resolving: HashSet<ApplicationIdentity>,
    hops: usize,
    event_sender: Option<ApplicationEventSender>,
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
                if let Some(application) = self.applications.get(&identity) {
                    tracing::Span::current().record("cache_hit", true);
                    return Ok(application.clone());
                }
                tracing::Span::current().record("cache_hit", false);
                if !self.resolving.insert(identity) {
                    return Err(invalid_configuration());
                }
                tracing::Span::current().record("stage", "resolve_version");
                let result = self.build_uncached(reference, tier).await;
                self.resolving.remove(&identity);
                if let Ok(application) = &result {
                    self.applications.insert(identity, application.clone());
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
    ) -> Result<Arc<BuiltApplication>, NativeAgentAssemblyError> {
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
        let (mut toolsets, sensitive_tools) =
            self.materialize_non_application_toolsets(&frozen).await?;
        let nested_references = application_references(&frozen, None)?;
        let parallel_applications = !nested_references.is_empty()
            && frozen
                .iter()
                .all(|reference| reference.kind() == FrozenToolKind::Application)
            && sensitive_tools.is_empty();
        let mut child_tools = ApplicationToolPresentationCatalog::default();
        if !nested_references.is_empty() {
            let mut nested_tools: Vec<Arc<dyn Tool>> = Vec::with_capacity(nested_references.len());
            for nested in nested_references {
                let identity = nested.identity;
                let alias = nested.name.clone();
                let agent_type = nested.agent_type.clone();
                let application = self.build(nested, tier + 1).await?;
                let tool = Arc::new(ApplicationAgentTool::new(
                    application.clone(),
                    identity,
                    self.event_sender.clone(),
                ));
                child_tools
                    .insert_runtime(
                        tool.name().to_owned(),
                        alias,
                        agent_type,
                        application.model_name.clone(),
                        application.child_tools.clone(),
                        application.sensitive_tools.clone(),
                    )
                    .map_err(|_| invalid_configuration())?;
                nested_tools.push(tool);
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
        let model_name = profile.model_name().to_owned();
        let sensitive_tool_names = sensitive_tools
            .tool_names()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        let agent: Arc<dyn Agent> = Arc::new(LazyNestedAgent {
            name: application_tool_name(reference.identity),
            description,
            profile,
            toolsets,
            model_facade: self.model_facade.clone(),
            elitea_context: self.elitea_context.clone(),
            sub_agents: Vec::new(),
            sensitive_tool_names,
            parallel_applications,
        });
        Ok(Arc::new(BuiltApplication {
            agent,
            model_name,
            child_tools,
            sensitive_tools,
        }))
    }

    async fn materialize_non_application_toolsets(
        &self,
        frozen: &AdmittedToolSnapshot<'_>,
    ) -> Result<(Vec<Arc<dyn Toolset>>, SensitiveToolCatalog), NativeAgentAssemblyError> {
        let mut toolsets =
            materialize_configured_toolsets(frozen, &self.policy).map_err(toolset_error)?;
        let mut sensitive_tools = sensitive_tools_for_kind(
            frozen,
            FrozenToolKind::Configured,
            &toolsets,
            self.policy.as_ref(),
        )
        .await?;
        let mut mcp_toolsets =
            materialize_mcp_toolsets(frozen, self.mcp_connector.as_ref(), &self.policy)
                .await
                .map_err(mcp_toolset_error)?;
        sensitive_tools.merge(
            sensitive_tools_for_kind(
                frozen,
                FrozenToolKind::Mcp,
                &mcp_toolsets,
                self.policy.as_ref(),
            )
            .await?,
        )?;
        toolsets.append(&mut mcp_toolsets);
        Ok((toolsets, sensitive_tools))
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
    selected_aliases: Option<&BTreeSet<String>>,
) -> Result<Vec<ApplicationReference>, NativeAgentAssemblyError> {
    let mut seen = HashSet::new();
    let mut references = Vec::new();
    for reference in snapshot
        .iter()
        .filter(|reference| reference.kind() == FrozenToolKind::Application)
        .filter(|reference| {
            selected_aliases.is_none_or(|aliases| aliases.contains(reference.toolkit_name()))
        })
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
    sensitive_tool_names: Vec<String>,
    parallel_applications: bool,
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
        for tool_name in &self.sensitive_tool_names {
            builder = builder.require_tool_confirmation(tool_name);
        }
        if self.parallel_applications {
            builder = builder.tool_execution_strategy(ToolExecutionStrategy::Parallel);
        }
        let agent = builder.build().map_err(|_| agent_configuration_error())?;
        agent.run(ctx).await
    }
}

struct ApplicationAgentTool {
    application: Arc<BuiltApplication>,
    identity: ApplicationIdentity,
    event_sender: Option<ApplicationEventSender>,
}

impl ApplicationAgentTool {
    fn new(
        application: Arc<BuiltApplication>,
        identity: ApplicationIdentity,
        event_sender: Option<ApplicationEventSender>,
    ) -> Self {
        Self {
            application,
            identity,
            event_sender,
        }
    }
}

#[async_trait]
impl Tool for ApplicationAgentTool {
    fn name(&self) -> &str {
        self.application.agent.name()
    }

    fn description(&self) -> &str {
        self.application.agent.description()
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
        Some(json!({
            "type": "object",
            "properties": {"response": {"type": "string"}},
            "required": ["response"],
            "additionalProperties": false
        }))
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
            let content = Content::new("user").with_text(task);
            let child_context = Arc::new(ApplicationToolInvocationContext::new(
                ctx.clone(),
                self.application.agent.clone(),
                content,
            ));
            let mut stream = self.application.agent.run(child_context).await?;
            let mut final_response = None;
            let mut last_text = None;
            while let Some(result) = stream.next().await {
                let event = match result {
                    Ok(event) => event,
                    Err(error) => {
                        self.send_fatal(ApplicationEventFailure::ChildExecution)
                            .await?;
                        return Err(error);
                    }
                };
                if event.llm_response.interrupted || event.actions.tool_confirmation.is_some() {
                    self.send_fatal(ApplicationEventFailure::NestedInterrupt)
                        .await?;
                    return Err(nested_interrupt_error());
                }
                if let Some(text) = event_text(&event) {
                    last_text = Some(text.clone());
                    if event.is_final_response() {
                        final_response = Some(text);
                    }
                }
                self.send_event(ctx.as_ref(), event).await?;
            }
            Ok(json!({
                "response": final_response
                    .or(last_text)
                    .unwrap_or_else(|| "No response from agent".to_owned())
            }))
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

impl ApplicationAgentTool {
    async fn send_event(&self, ctx: &dyn ToolContext, event: Event) -> adk_rust::Result<()> {
        let Some(sender) = &self.event_sender else {
            return Ok(());
        };
        let mut event = event;
        event.llm_request = None;
        event.provider_metadata.remove(ADK_LLM_REQUEST_METADATA_KEY);
        event
            .provider_metadata
            .remove(ADK_LLM_RESPONSE_METADATA_KEY);
        sender
            .send(ApplicationEventSignal::Event {
                container_invocation_id: ctx.invocation_id().to_owned(),
                parent_call_id: ctx.function_call_id().to_owned(),
                event: Box::new(event),
            })
            .await
            .map_err(|_| application_event_channel_error())
    }

    async fn send_fatal(&self, failure: ApplicationEventFailure) -> adk_rust::Result<()> {
        let Some(sender) = &self.event_sender else {
            return Ok(());
        };
        sender
            .send(ApplicationEventSignal::Fatal(failure))
            .await
            .map_err(|_| application_event_channel_error())
    }
}

fn event_text(event: &Event) -> Option<String> {
    let content = event.content()?;
    let mut text = String::new();
    for part in &content.parts {
        if let adk_rust::Part::Text { text: value } = part {
            text.push_str(value);
        }
    }
    (!text.is_empty()).then_some(text)
}

pub(crate) struct ApplicationEventStreamingAgent {
    inner: Arc<dyn Agent>,
    events: ApplicationEventReceiver,
}

impl ApplicationEventStreamingAgent {
    #[must_use]
    pub(crate) fn new(inner: Arc<dyn Agent>, events: ApplicationEventReceiver) -> Self {
        Self { inner, events }
    }
}

#[async_trait]
impl Agent for ApplicationEventStreamingAgent {
    fn name(&self) -> &str {
        self.inner.name()
    }

    fn description(&self) -> &str {
        self.inner.description()
    }

    fn sub_agents(&self) -> &[Arc<dyn Agent>] {
        self.inner.sub_agents()
    }

    async fn run(&self, ctx: Arc<dyn InvocationContext>) -> adk_rust::Result<EventStream> {
        let mut child_events = self
            .events
            .inner
            .lock()
            .await
            .take()
            .ok_or_else(application_event_channel_error)?;
        let mut root_events = self.inner.run(ctx).await?;
        let stream = async_stream::stream! {
            loop {
                tokio::select! {
                    biased;
                    signal = child_events.recv() => {
                        if let Some(signal) = signal {
                            match application_signal_event(signal) {
                                Ok(event) => yield Ok(event),
                                Err(error) => {
                                    yield Err(error);
                                    return;
                                }
                            }
                        }
                    }
                    event = root_events.next() => {
                        if let Some(event) = event {
                            while let Ok(signal) = child_events.try_recv() {
                                match application_signal_event(signal) {
                                    Ok(event) => yield Ok(event),
                                    Err(error) => {
                                        yield Err(error);
                                        return;
                                    }
                                }
                            }
                            yield event;
                        } else {
                            while let Ok(signal) = child_events.try_recv() {
                                match application_signal_event(signal) {
                                    Ok(event) => yield Ok(event),
                                    Err(error) => {
                                        yield Err(error);
                                        return;
                                    }
                                }
                            }
                            return;
                        }
                    }
                }
            }
        };
        Ok(Box::pin(stream))
    }
}

fn application_signal_event(signal: ApplicationEventSignal) -> adk_rust::Result<Event> {
    match signal {
        ApplicationEventSignal::Event {
            container_invocation_id,
            parent_call_id,
            event,
        } => {
            let mut event = *event;
            if event
                .provider_metadata
                .contains_key(DESCENDANT_CONTAINER_INVOCATION_KEY)
                || event
                    .provider_metadata
                    .contains_key(DESCENDANT_PARENT_CALL_KEY)
            {
                return Err(application_event_channel_error());
            }
            event.provider_metadata.insert(
                DESCENDANT_CONTAINER_INVOCATION_KEY.to_owned(),
                container_invocation_id,
            );
            event
                .provider_metadata
                .insert(DESCENDANT_PARENT_CALL_KEY.to_owned(), parent_call_id);
            Ok(event)
        }
        ApplicationEventSignal::Fatal(ApplicationEventFailure::NestedInterrupt) => {
            Err(nested_interrupt_error())
        }
        ApplicationEventSignal::Fatal(ApplicationEventFailure::ChildExecution) => {
            Err(child_execution_error())
        }
    }
}

struct ApplicationToolInvocationContext {
    parent_ctx: Arc<dyn ToolContext>,
    agent: Arc<dyn Agent>,
    user_content: Content,
    invocation_id: String,
    ended: AtomicBool,
    session: ApplicationToolSession,
}

impl ApplicationToolInvocationContext {
    fn new(parent_ctx: Arc<dyn ToolContext>, agent: Arc<dyn Agent>, user_content: Content) -> Self {
        static NEXT_INVOCATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let ordinal = NEXT_INVOCATION.fetch_add(1, Ordering::Relaxed);
        let invocation_id = format!("elitea-child-{ordinal}");
        Self {
            session: ApplicationToolSession::new(
                invocation_id.clone(),
                parent_ctx.app_name().to_owned(),
                parent_ctx.user_id().to_owned(),
            ),
            parent_ctx,
            agent,
            user_content,
            invocation_id,
            ended: AtomicBool::new(false),
        }
    }
}

#[async_trait]
impl ReadonlyContext for ApplicationToolInvocationContext {
    fn invocation_id(&self) -> &str {
        &self.invocation_id
    }

    fn agent_name(&self) -> &str {
        self.agent.name()
    }

    fn user_id(&self) -> &str {
        self.parent_ctx.user_id()
    }

    fn app_name(&self) -> &str {
        self.parent_ctx.app_name()
    }

    fn session_id(&self) -> &str {
        self.session.id()
    }

    fn branch(&self) -> &'static str {
        ""
    }

    fn user_content(&self) -> &Content {
        &self.user_content
    }
}

#[async_trait]
impl CallbackContext for ApplicationToolInvocationContext {
    fn artifacts(&self) -> Option<Arc<dyn Artifacts>> {
        None
    }

    fn shared_state(&self) -> Option<Arc<adk_rust::SharedState>> {
        self.parent_ctx.shared_state()
    }
}

#[async_trait]
impl InvocationContext for ApplicationToolInvocationContext {
    fn agent(&self) -> Arc<dyn Agent> {
        self.agent.clone()
    }

    fn memory(&self) -> Option<Arc<dyn Memory>> {
        None
    }

    fn session(&self) -> &dyn Session {
        &self.session
    }

    fn run_config(&self) -> &RunConfig {
        static CONFIG: std::sync::OnceLock<RunConfig> = std::sync::OnceLock::new();
        CONFIG.get_or_init(|| {
            RunConfig::builder()
                .streaming_mode(StreamingMode::None)
                .tool_concurrency(ToolConcurrencyConfig {
                    max_concurrency: Some(MAX_PARALLEL_APPLICATION_CALLS),
                    ..ToolConcurrencyConfig::default()
                })
                .build()
        })
    }

    fn end_invocation(&self) {
        self.ended.store(true, Ordering::SeqCst);
    }

    fn ended(&self) -> bool {
        self.ended.load(Ordering::SeqCst)
    }

    fn user_scopes(&self) -> Vec<String> {
        self.parent_ctx.user_scopes()
    }

    async fn get_secret(&self, name: &str) -> adk_rust::Result<Option<String>> {
        self.parent_ctx.get_secret(name).await
    }

    async fn get_secret_for(&self, request: &SecretRequest) -> adk_rust::Result<Option<String>> {
        match request.purpose.as_deref() {
            Some(purpose) => {
                self.parent_ctx
                    .get_secret_for_purpose(&request.name, purpose)
                    .await
            }
            None => self.parent_ctx.get_secret(&request.name).await,
        }
    }
}

struct ApplicationToolSession {
    id: String,
    app_name: String,
    user_id: String,
    state: std::sync::RwLock<HashMap<String, Value>>,
}

impl ApplicationToolSession {
    fn new(id: String, app_name: String, user_id: String) -> Self {
        Self {
            id,
            app_name,
            user_id,
            state: std::sync::RwLock::new(HashMap::new()),
        }
    }
}

impl Session for ApplicationToolSession {
    fn id(&self) -> &str {
        &self.id
    }

    fn app_name(&self) -> &str {
        &self.app_name
    }

    fn user_id(&self) -> &str {
        &self.user_id
    }

    fn state(&self) -> &dyn State {
        self
    }

    fn conversation_history(&self) -> Vec<Content> {
        Vec::new()
    }
}

impl State for ApplicationToolSession {
    fn get(&self, key: &str) -> Option<Value> {
        self.state.read().ok()?.get(key).cloned()
    }

    fn set(&mut self, key: String, value: Value) {
        if adk_rust::validate_state_key(&key).is_err() {
            return;
        }
        if let Ok(mut state) = self.state.write() {
            state.insert(key, value);
        }
    }

    fn all(&self) -> HashMap<String, Value> {
        self.state
            .read()
            .map(|state| state.clone())
            .unwrap_or_default()
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

fn application_event_channel_error() -> AdkError {
    AdkError::new(
        ErrorComponent::Agent,
        ErrorCategory::Internal,
        "elitea_nested_agent.event_channel_unavailable",
        "the nested agent event channel is unavailable",
    )
}

fn nested_interrupt_error() -> AdkError {
    AdkError::new(
        ErrorComponent::Agent,
        ErrorCategory::Unsupported,
        "elitea_nested_agent.interrupt_not_durable",
        "the nested agent interrupt requires a durable child session",
    )
}

fn child_execution_error() -> AdkError {
    AdkError::new(
        ErrorComponent::Agent,
        ErrorCategory::Unavailable,
        "elitea_nested_agent.execution_failed",
        "the nested agent execution failed",
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

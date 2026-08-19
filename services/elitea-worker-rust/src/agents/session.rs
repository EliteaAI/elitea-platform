//! Invocation-local ADK-Rust session and Runner assembly.
//!
//! The ordinary profile treats Main's frozen input as the complete turn
//! snapshot. It therefore creates one in-memory session and one exclusive
//! Runner per authorized invocation. Stable, pseudonymous ADK identities keep
//! tenant and principal references out of provider/session diagnostics while
//! preserving the current thread boundary. The exact frozen text history is
//! seeded without persistent checkpoints; rich history and durable continuation
//! remain closed until their Elitea-owned contracts are proven.

#![allow(dead_code)] // Production capability registration remains disabled.

use std::collections::HashMap;
use std::sync::Arc;

use adk_rust::agent::LlmAgentBuilder;
use adk_rust::session::{
    AppendEventRequest, CreateRequest, InMemorySessionService, SessionService,
};
use adk_rust::{Content, Event, GenerateContentConfig, Llm, SessionId, Toolset, UserId};
use async_trait::async_trait;
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::digest;
use serde_json::{Map, Value};

use super::assembly::OrdinaryNoToolProfile;
use super::context_management::ContextManagementPlan;
use super::events::{
    AgentEventProjectionContext, AgentEventProjectionError, AgentEventProjectionErrorCode,
    AgentEventProjector, CompletedAgentBrowserOutput, OrdinaryProjectionInput,
};
use super::request::{AgentExecutionRequest, UserInput};
use super::runtime::{
    AssembledNativeAgentInvocation, NativeAgentAssemblyError, NativeAgentAssemblyErrorCode,
    NativeAgentCompletionSelector, NativeAgentInvocation,
};
use super::sensitive_tools::SensitiveToolCatalog;
use crate::protocol::command::VerifiedAgentCommand;
use crate::protocol::elitea::runtime::v1::{AgentExecutionCommandV1, worker_command_v1};

const APP_NAME: &str = "elitea-agent-v1";
const ROOT_AGENT_NAME: &str = "elitea-agent";
const USER_ID_DOMAIN: &[u8] = b"elitea.adk.user.v1\0";
const SESSION_ID_DOMAIN: &[u8] = b"elitea.adk.session.v1\0";
const MAX_PUBLIC_APPLICATION_DETAILS_BYTES: usize = 32 * 1_024;

/// Non-authority command fields needed by local ADK and browser projection.
///
/// This value is created only from the already authenticated command and has
/// no claim, fence, PAT, output, settlement, or Redis capability. Fields stay
/// private so assembly cannot accidentally substitute request-carried routing
/// values for command-authenticated identity.
pub(crate) struct AuthorizedNativeCommandBinding {
    tenant_id: String,
    principal_ref: String,
    resource_project_id: String,
    projection_project_id: String,
    generation: u64,
    client_stream_id: String,
    client_message_id: String,
    sio_event: String,
}

impl AuthorizedNativeCommandBinding {
    pub(crate) fn from_verified(
        verified: &VerifiedAgentCommand,
    ) -> Result<Self, NativeAgentAssemblyError> {
        let command = verified.command();
        let Some(worker_command_v1::CapabilityCommand::AgentExecution(agent)) =
            command.capability_command.as_ref()
        else {
            return Err(invalid_input());
        };
        if command.generation == 0 {
            return Err(invalid_input());
        }
        Ok(Self::new(command, agent))
    }

    fn new(
        command: &crate::protocol::elitea::runtime::v1::WorkerCommandV1,
        agent: &AgentExecutionCommandV1,
    ) -> Self {
        Self {
            tenant_id: command.tenant_id.clone(),
            principal_ref: command.principal_ref.clone(),
            resource_project_id: command.resource_project_id.clone(),
            projection_project_id: command.projection_project_id.clone(),
            generation: command.generation,
            client_stream_id: agent.client_stream_id.clone(),
            client_message_id: agent.client_message_id.clone(),
            sio_event: agent.sio_event.clone(),
        }
    }

    #[cfg(test)]
    pub(super) fn fixture() -> Self {
        Self {
            tenant_id: "tenant-1".to_owned(),
            principal_ref: "user:42".to_owned(),
            resource_project_id: "17".to_owned(),
            projection_project_id: "9".to_owned(),
            generation: 3,
            client_stream_id: "conversation-1".to_owned(),
            client_message_id: "message-1".to_owned(),
            sio_event: "chat_predict".to_owned(),
        }
    }
}

/// Fully validated local plan built before the execution PAT is redeemed.
pub(crate) struct OrdinaryNativeAgentPlan {
    user_id: UserId,
    session_id: SessionId,
    user_content: Content,
    generation_config: GenerateContentConfig,
    max_iterations: u32,
    projection: AgentEventProjectionContext,
    thread_id: String,
    chat_history: Vec<Content>,
    context_management: ContextManagementPlan,
}

impl OrdinaryNativeAgentPlan {
    pub(crate) fn from_authorized(
        request: &AgentExecutionRequest,
        profile: &OrdinaryNoToolProfile,
        binding: &AuthorizedNativeCommandBinding,
    ) -> Result<Self, NativeAgentAssemblyError> {
        let user_text = match &request.payload.user_input {
            UserInput::Text(text) => text.clone(),
            UserInput::ContentBlocks(_) => return Err(invalid_input()),
        };
        let thread_id = request
            .payload
            .thread_id
            .as_ref()
            .ok_or_else(invalid_input)?
            .clone();
        let user_id = UserId::new(stable_identity(
            USER_ID_DOMAIN,
            &[&binding.tenant_id, &binding.principal_ref],
        ))
        .map_err(|_| invalid_configuration())?;
        let session_id = SessionId::new(stable_identity(
            SESSION_ID_DOMAIN,
            &[
                &binding.tenant_id,
                &binding.resource_project_id,
                &binding.projection_project_id,
                &thread_id,
            ],
        ))
        .map_err(|_| invalid_configuration())?;
        let application_details = public_application_details(&request.payload.application)?;
        let execution_generation = request
            .payload
            .execution_generation
            .clone()
            .unwrap_or_else(|| binding.generation.to_string());
        let projection = AgentEventProjectionContext::ordinary(OrdinaryProjectionInput {
            stream_id: binding.client_stream_id.clone(),
            message_id: binding.client_message_id.clone(),
            execution_generation,
            sio_event: binding.sio_event.clone(),
            thread_id: thread_id.clone(),
            project_id: current_numeric_identity(&binding.resource_project_id),
            chat_project_id: current_numeric_identity(&binding.projection_project_id),
            root_agent_name: ROOT_AGENT_NAME.to_owned(),
            model_name: profile.model_name().to_owned(),
            application_details,
        })
        .map_err(projection_configuration)?;
        Ok(Self {
            user_id,
            session_id,
            user_content: Content::new("user").with_text(user_text),
            generation_config: GenerateContentConfig {
                temperature: profile.temperature(),
                max_output_tokens: i32::try_from(profile.max_tokens()).ok(),
                ..GenerateContentConfig::default()
            },
            max_iterations: profile.step_limit(),
            projection,
            thread_id,
            chat_history: profile.chat_history().to_vec(),
            context_management: profile.context_management(),
        })
    }

    #[cfg(test)]
    pub(super) fn session_id(&self) -> &str {
        self.session_id.as_ref()
    }
}

/// One bound provider invocation that remains paired with its completion.
///
/// Implementations may return a cloned ADK model handle only while the owner
/// itself remains the completion selector stored beside the exclusive Runner.
/// This avoids loose model/result values at the authorized composition layer.
pub(crate) trait BoundOrdinaryAgentModel: Send + 'static {
    fn adk_model(&self) -> Arc<dyn Llm>;

    fn take_completed_text(self) -> Result<String, NativeAgentAssemblyError>;
}

/// Consuming ordinary completion selector retained beside the Runner.
pub(crate) struct OrdinaryAgentCompletion<M> {
    model: M,
    thread_id: String,
}

#[async_trait]
impl<M> NativeAgentCompletionSelector for OrdinaryAgentCompletion<M>
where
    M: BoundOrdinaryAgentModel,
{
    async fn select(self) -> Result<CompletedAgentBrowserOutput, NativeAgentAssemblyError> {
        let content = self.model.take_completed_text()?;
        CompletedAgentBrowserOutput::ordinary(content, self.thread_id)
            .map_err(|error| completed_output_error(&error))
    }
}

/// Build one fresh ADK session, direct `LlmAgent`, and exclusive Runner.
pub(crate) async fn assemble_ordinary_native<M>(
    model: M,
    plan: OrdinaryNativeAgentPlan,
    toolsets: Vec<Arc<dyn Toolset>>,
    sensitive_tools: SensitiveToolCatalog,
) -> Result<AssembledNativeAgentInvocation<OrdinaryAgentCompletion<M>>, NativeAgentAssemblyError>
where
    M: BoundOrdinaryAgentModel,
{
    let OrdinaryNativeAgentPlan {
        user_id,
        session_id,
        user_content,
        generation_config,
        max_iterations,
        projection,
        thread_id,
        chat_history,
        context_management,
    } = plan;
    context_management.prepare_runner_composition();
    let adk_model = model.adk_model();
    let mut builder = LlmAgentBuilder::new(ROOT_AGENT_NAME)
        .model(adk_model)
        .generate_content_config(generation_config)
        .max_iterations(max_iterations)
        .disallow_transfer_to_parent(true)
        .disallow_transfer_to_peers(true);
    for toolset in toolsets {
        builder = builder.toolset(toolset);
    }
    for tool_name in sensitive_tools.tool_names() {
        builder = builder.require_tool_confirmation(tool_name);
    }
    let agent = builder.build().map_err(|_| invalid_configuration())?;
    let sessions: Arc<dyn SessionService> = Arc::new(InMemorySessionService::new());
    let session = sessions
        .create(CreateRequest {
            app_name: APP_NAME.to_owned(),
            user_id: user_id.to_string(),
            session_id: Some(session_id.to_string()),
            state: HashMap::new(),
        })
        .await
        .map_err(|_| dependency_unavailable())?;
    let identity = session
        .try_identity()
        .map_err(|_| invalid_configuration())?;
    for content in chat_history {
        let mut event = Event::new("frozen-current-history");
        event.author = if content.role == "user" {
            "user".to_owned()
        } else {
            ROOT_AGENT_NAME.to_owned()
        };
        event.llm_response.content = Some(content);
        sessions
            .append_event_for_identity(AppendEventRequest {
                identity: identity.clone(),
                event,
            })
            .await
            .map_err(|_| dependency_unavailable())?;
    }
    let runner = adk_rust::runner::Runner::builder()
        .app_name(APP_NAME)
        .agent(Arc::new(agent))
        .session_service(sessions)
        .build()
        .map_err(|_| invalid_configuration())?;
    let projector = AgentEventProjector::with_sensitive_tools(projection, sensitive_tools)
        .map_err(projection_configuration)?;
    Ok(AssembledNativeAgentInvocation::new(
        NativeAgentInvocation::new(runner, user_id, session_id, user_content),
        projector,
        OrdinaryAgentCompletion { model, thread_id },
    ))
}

fn stable_identity(domain: &[u8], fields: &[&str]) -> String {
    let mut context = digest::Context::new(&digest::SHA256);
    context.update(domain);
    for field in fields {
        context.update(&(field.len() as u64).to_be_bytes());
        context.update(field.as_bytes());
    }
    format!("e1:{}", URL_SAFE_NO_PAD.encode(context.finish().as_ref()))
}

fn current_numeric_identity(value: &str) -> Value {
    value
        .parse::<u64>()
        .ok()
        .filter(|value| *value > 0)
        .map_or_else(|| Value::String(value.to_owned()), Value::from)
}

fn public_application_details(
    application: &Map<String, Value>,
) -> Result<Value, NativeAgentAssemblyError> {
    let mut application = application.clone();
    if let Some(Value::Object(version)) = application.get_mut("version_details")
        && let Some(Value::Array(skills)) = version.get_mut("skills")
    {
        for skill in skills {
            if let Value::Object(skill) = skill {
                skill.remove("instructions");
            }
        }
    }
    let application = Value::Object(application);
    let length = serde_json::to_vec(&application)
        .map_err(|_| invalid_input())?
        .len();
    if length > MAX_PUBLIC_APPLICATION_DETAILS_BYTES {
        return Err(resource_exhausted());
    }
    Ok(application)
}

fn projection_configuration(_: AgentEventProjectionError) -> NativeAgentAssemblyError {
    invalid_input()
}

fn completed_output_error(error: &AgentEventProjectionError) -> NativeAgentAssemblyError {
    if error.code() == AgentEventProjectionErrorCode::ResourceExhausted {
        resource_exhausted()
    } else {
        invalid_result()
    }
}

fn invalid_configuration() -> NativeAgentAssemblyError {
    NativeAgentAssemblyError::new(
        NativeAgentAssemblyErrorCode::InvalidConfiguration,
        "the invocation-local native agent session could not be configured",
    )
}

fn invalid_input() -> NativeAgentAssemblyError {
    NativeAgentAssemblyError::new(
        NativeAgentAssemblyErrorCode::InvalidInput,
        "the invocation-local native agent input is malformed",
    )
}

fn invalid_result() -> NativeAgentAssemblyError {
    NativeAgentAssemblyError::new(
        NativeAgentAssemblyErrorCode::InvalidResult,
        "the invocation-local native agent result is malformed",
    )
}

fn resource_exhausted() -> NativeAgentAssemblyError {
    NativeAgentAssemblyError::new(
        NativeAgentAssemblyErrorCode::ResourceExhausted,
        "the invocation-local native agent state exceeds its approved limit",
    )
}

fn dependency_unavailable() -> NativeAgentAssemblyError {
    NativeAgentAssemblyError::new(
        NativeAgentAssemblyErrorCode::DependencyUnavailable,
        "the invocation-local native agent session is unavailable",
    )
}

//! Invocation-local ADK-Rust session and Runner assembly.
//!
//! The ordinary profile treats Main's frozen input as the complete turn
//! snapshot. It creates one claim-bound session service and one exclusive
//! Runner per authorized invocation. The capability-disabled default remains
//! invocation-local; production composition can inject the fenced `PostgreSQL`
//! service without changing the Runner or agent shape. Stable, pseudonymous
//! ADK identities keep tenant and principal references out of provider/session
//! diagnostics while preserving the current thread boundary.

#![allow(dead_code)] // Production capability registration remains disabled.

use std::collections::HashMap;
use std::sync::Arc;

use adk_rust::agent::LlmAgentBuilder;
use adk_rust::session::{
    AppendEventRequest, CreateRequest, GetRequest, InMemorySessionService, SessionService,
};
use adk_rust::{
    AdkIdentity, Content, Event, GenerateContentConfig, Llm, SessionId, Toolset, UserId,
};
use async_trait::async_trait;
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::digest;
use serde_json::{Map, Value};
use sqlx::PgPool;

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
use crate::protocol::control::ClaimBoundSessionAuthority;
use crate::protocol::elitea::runtime::v1::{AgentExecutionCommandV1, worker_command_v1};
use crate::state::{
    PostgresSessionError, PostgresSessionService, SessionLimits, SessionWriterAuthority,
    StateWriterLease,
};

const APP_NAME: &str = "elitea-agent-v1";
const ROOT_AGENT_NAME: &str = "elitea-agent";
const USER_ID_DOMAIN: &[u8] = b"elitea.adk.user.v1\0";
const SESSION_ID_DOMAIN: &[u8] = b"elitea.adk.session.v1\0";
const MAX_PUBLIC_APPLICATION_DETAILS_BYTES: usize = 32 * 1_024;
const APPLICATION_CAPABILITY_ID: &str = "agent.execute.application.v1";
const ADHOC_CAPABILITY_ID: &str = "agent.execute.adhoc.v1";
const FROZEN_HISTORY_EVENT_DOMAIN: &[u8] = b"elitea.adk.frozen-history-event.v1\0";

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
    execution_id: String,
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
            execution_id: command.execution_id.clone(),
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
            execution_id: "execution/one".to_owned(),
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
    capability_id: &'static str,
    definition_digest: [u8; 32],
    tenant_id: String,
    resource_project_id: String,
    projection_project_id: String,
    execution_id: String,
    generation: u64,
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
        let capability_id = match request.kind {
            super::request::AgentExecutionKind::Application => APPLICATION_CAPABILITY_ID,
            super::request::AgentExecutionKind::Adhoc => ADHOC_CAPABILITY_ID,
        };
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
            capability_id,
            definition_digest: request.binding.request_content_digest,
            tenant_id: binding.tenant_id.clone(),
            resource_project_id: binding.resource_project_id.clone(),
            projection_project_id: binding.projection_project_id.clone(),
            execution_id: binding.execution_id.clone(),
            generation: binding.generation,
        })
    }

    #[cfg(test)]
    pub(super) fn session_id(&self) -> &str {
        self.session_id.as_ref()
    }

    #[cfg(test)]
    pub(super) fn user_id(&self) -> &str {
        self.user_id.as_ref()
    }
}

/// Runtime-selected ADK session persistence behind the common Runner entrypoint.
///
/// The `PostgreSQL` variant is constructible only inside the worker crate and
/// still requires the one-use claim-bound session grant at invocation time.
/// Selecting a backend never grants output, settlement, or tool authority.
pub(crate) enum NativeSessionBackend {
    InvocationLocal,
    Postgres { pool: PgPool, limits: SessionLimits },
}

impl NativeSessionBackend {
    #[must_use]
    pub(crate) const fn invocation_local() -> Self {
        Self::InvocationLocal
    }

    #[must_use]
    pub(crate) const fn postgres(pool: PgPool, limits: SessionLimits) -> Self {
        Self::Postgres { pool, limits }
    }

    #[must_use]
    pub(crate) const fn name(&self) -> &'static str {
        match self {
            Self::InvocationLocal => "invocation_local",
            Self::Postgres { .. } => "postgres",
        }
    }

    pub(crate) async fn open(
        &self,
        authority: ClaimBoundSessionAuthority,
        state_writer_lease: Arc<dyn StateWriterLease>,
        plan: &OrdinaryNativeAgentPlan,
    ) -> Result<Arc<dyn SessionService>, NativeAgentAssemblyError> {
        let claim = authority.into_writer_binding();
        if claim.tenant_id != plan.tenant_id
            || claim.resource_project_id != plan.resource_project_id
            || claim.projection_project_id != plan.projection_project_id
            || claim.execution_id != plan.execution_id
            || claim.generation != plan.generation
        {
            return Err(authorization_failed());
        }
        match self {
            Self::InvocationLocal => {
                drop(claim);
                Ok(Arc::new(InMemorySessionService::new()))
            }
            Self::Postgres { pool, limits } => {
                let resource_project_id = claim
                    .resource_project_id
                    .parse::<i32>()
                    .ok()
                    .filter(|value| *value > 0)
                    .ok_or_else(invalid_configuration)?;
                let projection_project_id = claim
                    .projection_project_id
                    .parse::<i32>()
                    .ok()
                    .filter(|value| *value > 0)
                    .ok_or_else(invalid_configuration)?;
                let fence_token: [u8; 32] = claim
                    .fence_token
                    .as_slice()
                    .try_into()
                    .map_err(|_| invalid_configuration())?;
                let writer = SessionWriterAuthority::new(
                    claim.tenant_id,
                    resource_project_id,
                    projection_project_id,
                    plan.capability_id,
                    plan.definition_digest,
                    plan.thread_id.clone(),
                    APP_NAME.to_owned(),
                    plan.user_id.to_string(),
                    plan.session_id.to_string(),
                    claim.execution_id,
                    claim.generation,
                    claim.claim_id,
                    claim.claim_attempt,
                    claim.lease_epoch,
                    claim.claim_started_at_unix_micros,
                    claim.workload_session_id,
                    claim.producer_id,
                    fence_token,
                )
                .map_err(|error| session_activation_error(&error))?;
                let service = PostgresSessionService::activate(
                    pool.clone(),
                    writer,
                    *limits,
                    state_writer_lease,
                )
                .await
                .map_err(|error| session_activation_error(&error))?;
                Ok(Arc::new(service))
            }
        }
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
    let sessions: Arc<dyn SessionService> = Arc::new(InMemorySessionService::new());
    assemble_ordinary_native_with_sessions(model, plan, toolsets, sensitive_tools, sessions).await
}

/// Build a direct `LlmAgent` and exclusive Runner over an injected session service.
///
/// Both direct and future graph agents use this same ADK session boundary; the
/// graph checkpointer remains an additional graph-only dependency rather than
/// a replacement for `SessionService`.
pub(crate) async fn assemble_ordinary_native_with_sessions<M>(
    model: M,
    plan: OrdinaryNativeAgentPlan,
    toolsets: Vec<Arc<dyn Toolset>>,
    sensitive_tools: SensitiveToolCatalog,
    sessions: Arc<dyn SessionService>,
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
        capability_id: _,
        definition_digest,
        tenant_id: _,
        resource_project_id: _,
        projection_project_id: _,
        execution_id: _,
        generation: _,
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
    let (session, created) =
        restore_or_create_session(sessions.as_ref(), &user_id, &session_id).await?;
    let identity = session
        .try_identity()
        .map_err(|_| invalid_configuration())?;
    if created {
        seed_frozen_history(
            sessions.as_ref(),
            &identity,
            chat_history,
            definition_digest,
        )
        .await?;
    }
    tracing::Span::current().record(
        "session_bootstrap",
        if created { "seeded" } else { "restored" },
    );
    tracing::debug!(
        session_bootstrap = if created { "seeded" } else { "restored" },
        "prepared the ADK session for the native agent runner"
    );
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

async fn restore_or_create_session(
    sessions: &dyn SessionService,
    user_id: &UserId,
    session_id: &SessionId,
) -> Result<(Box<dyn adk_rust::session::Session>, bool), NativeAgentAssemblyError> {
    let user_id = user_id.to_string();
    let session_id = session_id.to_string();
    match sessions
        .get(GetRequest {
            app_name: APP_NAME.to_owned(),
            user_id: user_id.clone(),
            session_id: session_id.clone(),
            num_recent_events: None,
            after: None,
        })
        .await
    {
        Ok(session) => Ok((session, false)),
        Err(error) if error.code == "session.not_found" => sessions
            .create(CreateRequest {
                app_name: APP_NAME.to_owned(),
                user_id,
                session_id: Some(session_id),
                state: HashMap::new(),
            })
            .await
            .map(|session| (session, true))
            .map_err(|_| dependency_unavailable()),
        Err(_) => Err(dependency_unavailable()),
    }
}

async fn seed_frozen_history(
    sessions: &dyn SessionService,
    identity: &AdkIdentity,
    chat_history: Vec<Content>,
    definition_digest: [u8; 32],
) -> Result<(), NativeAgentAssemblyError> {
    for (ordinal, content) in chat_history.into_iter().enumerate() {
        let ordinal = u64::try_from(ordinal).map_err(|_| resource_exhausted())?;
        let mut event = Event::with_id(
            frozen_history_event_id(definition_digest, ordinal),
            "frozen-current-history",
        );
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
    Ok(())
}

fn frozen_history_event_id(definition_digest: [u8; 32], ordinal: u64) -> String {
    let mut context = digest::Context::new(&digest::SHA256);
    context.update(FROZEN_HISTORY_EVENT_DOMAIN);
    context.update(&definition_digest);
    context.update(&ordinal.to_be_bytes());
    format!("fh-{}", URL_SAFE_NO_PAD.encode(context.finish().as_ref()))
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

fn authorization_failed() -> NativeAgentAssemblyError {
    NativeAgentAssemblyError::new(
        NativeAgentAssemblyErrorCode::AuthorizationFailed,
        "the claim-bound native agent session does not match its command",
    )
}

fn dependency_unavailable() -> NativeAgentAssemblyError {
    NativeAgentAssemblyError::new(
        NativeAgentAssemblyErrorCode::DependencyUnavailable,
        "the invocation-local native agent session is unavailable",
    )
}

fn session_activation_error(error: &PostgresSessionError) -> NativeAgentAssemblyError {
    let code = match error {
        PostgresSessionError::InvalidConfiguration => {
            NativeAgentAssemblyErrorCode::InvalidConfiguration
        }
        PostgresSessionError::InvalidScope | PostgresSessionError::WriterNotCurrent => {
            NativeAgentAssemblyErrorCode::AuthorizationFailed
        }
        PostgresSessionError::ResourceExhausted => NativeAgentAssemblyErrorCode::ResourceExhausted,
        PostgresSessionError::CorruptStoredState | PostgresSessionError::EventConflict => {
            NativeAgentAssemblyErrorCode::InvalidResult
        }
        PostgresSessionError::StorageUnavailable { .. }
        | PostgresSessionError::StorageFailure { .. } => {
            NativeAgentAssemblyErrorCode::DependencyUnavailable
        }
    };
    NativeAgentAssemblyError::new(code, "the claim-bound native agent session is unavailable")
}

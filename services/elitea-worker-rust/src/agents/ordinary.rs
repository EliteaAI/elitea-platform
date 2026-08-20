//! Authorized ordinary application/ad-hoc ADK assembly.
//!
//! This boundary joins the already validated request, one-use runtime-context
//! redemption, the existing Main OpenAI-compatible endpoint and one fresh ADK
//! session. Application and ad-hoc differ only in their admitted frozen input;
//! claim, lease, output, settlement and Redis ownership stay in the shared
//! execution lifecycle.

#![allow(dead_code)] // Capability registration remains intentionally disabled.

use std::sync::Arc;

use async_trait::async_trait;
use tracing::Instrument as _;

use super::application_tools::{ApplicationToolDependencies, materialize_application_toolset};
use super::assembly::{OrdinaryModelProvider, ReasoningEffort};
use super::runtime::{
    AdmittedNativeStart, AssembledNativeAgentInvocation, AuthorizedNativeAssembly,
    NativeAgentAssembler, NativeAgentAssemblyError, NativeAgentAssemblyErrorCode,
    RedeemedOrdinaryNativeAssembly,
};
use super::sensitive_tools::{SensitiveToolCatalog, sensitive_tools_for_kind};
use super::session::{
    NativeSessionBackend, OrdinaryAgentCompletion, assemble_ordinary_native_with_sessions,
    assemble_read_only_direct_hitl_resume_with_sessions,
};
use crate::state::SessionLimits;
use crate::toolkits::{
    AdkHttpMcpConnector, AdmittedToolSnapshot, FrozenToolKind, McpConnector,
    McpMaterializationError, McpMaterializationErrorCode, ToolAdmissionPolicy,
    ToolsetMaterializationError, ToolsetMaterializationErrorCode, materialize_configured_toolsets,
    materialize_mcp_toolsets,
};
use crate::transport::model_facade::{
    BoundModelFacade, ModelAdapterKind, ModelFacade, ModelFacadeError, ModelInvocation,
    ModelReasoningEffort,
};
use crate::transport::platform_client::PlatformClient;
use sqlx::PgPool;

/// Shared ordinary application/ad-hoc assembler used after `AUTHORIZED_NOW`.
///
/// Both clients own reusable shared HTTP/2 channels whose total concurrency is
/// bounded by invocation admission. Invocation credentials, provider state,
/// session state and completion capture remain one-use values.
pub(crate) struct OrdinaryNativeAgentAssembler {
    platform: Arc<PlatformClient>,
    model_facade: Arc<ModelFacade>,
    tool_policy: Arc<ToolAdmissionPolicy>,
    mcp_connector: Arc<dyn McpConnector>,
    sessions: NativeSessionBackend,
}

impl OrdinaryNativeAgentAssembler {
    #[must_use]
    pub(crate) fn new(
        platform: Arc<PlatformClient>,
        model_facade: Arc<ModelFacade>,
        tool_policy: Arc<ToolAdmissionPolicy>,
    ) -> Self {
        Self {
            platform,
            model_facade,
            tool_policy,
            mcp_connector: Arc::new(AdkHttpMcpConnector::new()),
            sessions: NativeSessionBackend::invocation_local(),
        }
    }

    /// Select claim-fenced `PostgreSQL` session persistence for the common Runner.
    ///
    /// Production construction remains closed until worker bootstrap supplies
    /// the authorized `agentstate` pool and the capability is registered.
    #[must_use]
    pub(crate) fn with_postgres_sessions(mut self, pool: PgPool, limits: SessionLimits) -> Self {
        self.sessions = NativeSessionBackend::postgres(pool, limits);
        self
    }

    #[cfg(test)]
    #[must_use]
    pub(crate) fn with_sessions(
        mut self,
        sessions: Arc<dyn adk_rust::session::SessionService>,
    ) -> Self {
        self.sessions = NativeSessionBackend::injected(sessions);
        self
    }

    #[cfg(test)]
    #[must_use]
    pub(crate) fn with_mcp_connector(mut self, connector: Arc<dyn McpConnector>) -> Self {
        self.mcp_connector = connector;
        self
    }

    async fn assemble_redeemed(
        &self,
        redeemed: RedeemedOrdinaryNativeAssembly<'_>,
    ) -> Result<
        AssembledNativeAgentInvocation<OrdinaryAgentCompletion<BoundModelFacade>>,
        NativeAgentAssemblyError,
    > {
        let (
            profile,
            plan,
            tool_snapshot,
            start,
            context,
            runtime_context,
            session_authority,
            state_writer_lease,
        ) = redeemed.into_parts();
        let tool_reference_count = tool_snapshot.iter().count();
        let nested_application_count = tool_snapshot
            .iter()
            .filter(|reference| reference.kind() == FrozenToolKind::Application)
            .count();
        tracing::Span::current().record("tool_reference_count", tool_reference_count);
        tracing::Span::current().record("nested_application_count", nested_application_count);
        let context = Arc::new(context);
        tracing::Span::current().record("stage", "toolsets");
        let (mut toolsets, sensitive_tools) = materialize_direct_toolsets(
            &tool_snapshot,
            self.mcp_connector.as_ref(),
            &self.tool_policy,
        )
        .await?;
        if let Some(application_toolset) = materialize_application_toolset(
            &tool_snapshot,
            self.platform.as_ref(),
            &runtime_context,
            context.clone(),
            &profile,
            ApplicationToolDependencies {
                model_facade: self.model_facade.clone(),
                policy: self.tool_policy.clone(),
                mcp_connector: self.mcp_connector.clone(),
            },
        )
        .await?
        {
            toolsets.push(application_toolset);
        }
        tracing::Span::current().record("materialized_toolset_count", toolsets.len());
        let model = self.bind_model(&profile, context.as_ref())?;
        tracing::Span::current().record("stage", "runner");
        let sessions = self
            .sessions
            .open(session_authority, state_writer_lease, &plan)
            .await?;
        match start {
            AdmittedNativeStart::Fresh => {
                assemble_ordinary_native_with_sessions(
                    model,
                    plan,
                    toolsets,
                    sensitive_tools,
                    sessions,
                )
                .await
            }
            AdmittedNativeStart::DirectHitl(decision) => {
                assemble_read_only_direct_hitl_resume_with_sessions(
                    model,
                    plan,
                    toolsets,
                    sensitive_tools,
                    decision,
                    sessions,
                )
                .await
            }
        }
    }

    fn bind_model(
        &self,
        profile: &super::assembly::OrdinaryNoToolProfile,
        context: &crate::transport::runtime_context::ClaimScopedEliteaContext,
    ) -> Result<BoundModelFacade, NativeAgentAssemblyError> {
        let invocation = ModelInvocation {
            model_name: profile.model_name().to_owned(),
            system_instruction: profile.instructions().to_owned(),
            max_tokens: profile.max_tokens(),
            reasoning_effort: profile.reasoning_effort().map(model_reasoning_effort),
            temperature: profile.temperature(),
            max_model_turns: profile.step_limit(),
        };
        let (adapter, adapter_name) = match profile.model_provider() {
            OrdinaryModelProvider::OpenAiChat => {
                (ModelAdapterKind::OpenAiCompatible, "openai_compatible")
            }
            OrdinaryModelProvider::NativeAnthropic => (ModelAdapterKind::Anthropic, "anthropic"),
        };
        tracing::Span::current().record("model_adapter", adapter_name);
        tracing::Span::current().record("model_project_id", profile.model_project_id());
        tracing::Span::current().record("stage", "model_binding");
        self.model_facade
            .bind(adapter, context, profile.model_project_id(), invocation)
            .map_err(model_binding_error)
    }
}

#[async_trait]
impl NativeAgentAssembler for OrdinaryNativeAgentAssembler {
    type Completion = OrdinaryAgentCompletion<BoundModelFacade>;

    async fn assemble(
        &self,
        assembly: AuthorizedNativeAssembly<'_>,
    ) -> Result<AssembledNativeAgentInvocation<Self::Completion>, NativeAgentAssemblyError> {
        let span = assembly_span(&assembly, self.sessions.name());
        let result = async {
            // Admission also constructs the command-bound projection/session
            // plan, so deterministic local failures happen before PAT issuance.
            tracing::Span::current().record("stage", "admission");
            let admitted = assembly.admit_llm_agent(self.tool_policy.as_ref())?;
            if admitted.is_resume() && !self.sessions.supports_resume() {
                return Err(unsupported_session_resume());
            }
            tracing::Span::current().record("stage", "runtime_context");
            let redeemed = admitted
                .redeem_runtime_context(self.platform.as_ref())
                .await
                .map_err(NativeAgentAssemblyError::from)?;
            self.assemble_redeemed(redeemed).await
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

fn unsupported_session_resume() -> NativeAgentAssemblyError {
    NativeAgentAssemblyError::new(
        NativeAgentAssemblyErrorCode::UnsupportedCapability,
        "direct sensitive-tool continuation requires durable session persistence",
    )
}

fn assembly_span(assembly: &AuthorizedNativeAssembly<'_>, session_backend: &str) -> tracing::Span {
    tracing::info_span!(
        "agent.assemble",
        execution_kind = ?assembly.request().kind,
        stage = tracing::field::Empty,
        model_adapter = tracing::field::Empty,
        model_project_id = tracing::field::Empty,
        tool_reference_count = tracing::field::Empty,
        nested_application_count = tracing::field::Empty,
        materialized_toolset_count = tracing::field::Empty,
        session_backend,
        session_bootstrap = tracing::field::Empty,
        outcome = tracing::field::Empty,
        error_code = tracing::field::Empty,
    )
}

async fn materialize_direct_toolsets(
    snapshot: &AdmittedToolSnapshot<'_>,
    connector: &dyn McpConnector,
    policy: &Arc<ToolAdmissionPolicy>,
) -> Result<(Vec<Arc<dyn adk_rust::Toolset>>, SensitiveToolCatalog), NativeAgentAssemblyError> {
    let mut toolsets =
        materialize_configured_toolsets(snapshot, policy).map_err(tool_materialization_error)?;
    let mut sensitive = sensitive_tools_for_kind(
        snapshot,
        FrozenToolKind::Configured,
        &toolsets,
        policy.as_ref(),
    )
    .await?;
    let mut mcp_toolsets = materialize_mcp_toolsets(snapshot, connector, policy)
        .await
        .map_err(mcp_materialization_error)?;
    sensitive.merge(
        sensitive_tools_for_kind(
            snapshot,
            FrozenToolKind::Mcp,
            &mcp_toolsets,
            policy.as_ref(),
        )
        .await?,
    )?;
    toolsets.append(&mut mcp_toolsets);
    Ok((toolsets, sensitive))
}

const fn model_reasoning_effort(effort: ReasoningEffort) -> ModelReasoningEffort {
    match effort {
        ReasoningEffort::Low => ModelReasoningEffort::Low,
        ReasoningEffort::Medium => ModelReasoningEffort::Medium,
        ReasoningEffort::High => ModelReasoningEffort::High,
        ReasoningEffort::None => ModelReasoningEffort::None,
    }
}

fn model_binding_error(error: ModelFacadeError) -> NativeAgentAssemblyError {
    let code = match error {
        ModelFacadeError::InvalidConfiguration => {
            NativeAgentAssemblyErrorCode::InvalidConfiguration
        }
        ModelFacadeError::InvalidInvocation => NativeAgentAssemblyErrorCode::InvalidInput,
        ModelFacadeError::ResourceExhausted => NativeAgentAssemblyErrorCode::ResourceExhausted,
        ModelFacadeError::DependencyUnavailable => {
            NativeAgentAssemblyErrorCode::DependencyUnavailable
        }
    };
    NativeAgentAssemblyError::new(code, "the ordinary native model could not be bound")
}

fn tool_materialization_error(error: ToolsetMaterializationError) -> NativeAgentAssemblyError {
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
    NativeAgentAssemblyError::new(code, "the native agent toolsets could not be materialized")
}

fn mcp_materialization_error(error: McpMaterializationError) -> NativeAgentAssemblyError {
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
    NativeAgentAssemblyError::new(code, "the native MCP toolsets could not be materialized")
}

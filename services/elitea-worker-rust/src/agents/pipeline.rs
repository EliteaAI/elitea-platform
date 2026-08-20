//! Authorized stored-pipeline admission before any provider or tool authority.
//!
//! Pipeline HITL is a YAML graph node and never uses the direct sensitive-tool
//! confirmation path. This module binds the frozen application shell to the
//! graph compiler and one claim-fenced session/checkpoint boundary. The family
//! remains capability-disabled until lifecycle routing enables this assembler.

#![allow(dead_code)] // Capability routing remains intentionally disabled.

#[cfg(test)]
use std::sync::Arc;

use async_trait::async_trait;
use sqlx::PgPool;
use tracing::Instrument as _;

use super::assembly::OrdinaryNoToolProfile;
use super::graph::compiler::{PipelineConfigurationError, PipelineDefinition};
use super::request::AgentExecutionRequest;
use super::runtime::{
    AssembledNativeAgentInvocation, AuthorizedNativeAssembly, NativeAgentAssembler,
    NativeAgentAssemblyError, NativeAgentAssemblyErrorCode,
};
use super::session::{
    NativePipelineStateBackend, PipelineAgentCompletion, assemble_pipeline_native,
};
use crate::state::{CheckpointLimits, SessionLimits};

/// Frozen, fully admitted application pipeline definition.
pub(crate) struct PipelineExecutionProfile {
    shell: OrdinaryNoToolProfile,
    definition: PipelineDefinition,
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
        Ok(Self { shell, definition })
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
}

/// Authorized assembler for stored pipelines backed by ADK `GraphAgent`.
pub(crate) struct PipelineNativeAgentAssembler {
    state: NativePipelineStateBackend,
}

impl PipelineNativeAgentAssembler {
    /// Use the shared `agentstate` database for both ADK sessions and graph
    /// checkpoints, with separate claim-fenced tables and one immutable lease.
    #[must_use]
    pub(crate) const fn postgres(
        pool: PgPool,
        session_limits: SessionLimits,
        checkpoint_limits: CheckpointLimits,
    ) -> Self {
        Self {
            state: NativePipelineStateBackend::postgres(pool, session_limits, checkpoint_limits),
        }
    }

    #[cfg(test)]
    #[must_use]
    pub(crate) fn with_state(
        sessions: Arc<dyn adk_rust::session::SessionService>,
        checkpointer: Arc<dyn adk_rust::graph::Checkpointer>,
    ) -> Self {
        Self {
            state: NativePipelineStateBackend::injected(sessions, checkpointer),
        }
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
            let admitted = assembly.admit_pipeline()?;
            let (profile, plan, start, runtime_context, session, lease) = admitted.into_parts();
            // The HITL-only graph needs neither a model nor an Elitea PAT. Keep
            // the one-use runtime-context authority sealed and drop it without
            // redemption; value-producing node slices will redeem explicitly.
            drop(runtime_context);
            tracing::Span::current().record("stage", "state");
            assemble_pipeline_native(
                plan,
                profile.into_definition(),
                start,
                session,
                lease,
                &self.state,
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

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

use super::assembly::ReasoningEffort;
use super::runtime::{
    AssembledNativeAgentInvocation, AuthorizedNativeAssembly, NativeAgentAssembler,
    NativeAgentAssemblyError, NativeAgentAssemblyErrorCode,
};
use super::session::{OrdinaryAgentCompletion, assemble_ordinary_native};
use crate::transport::model_gateway::{
    BoundModelGateway, ModelGatewayClient, ModelGatewayError, ModelGatewayInvocation,
    ModelReasoningEffort,
};
use crate::transport::runtime_context::RuntimeContextClient;

/// Shared ordinary application/ad-hoc assembler used after `AUTHORIZED_NOW`.
///
/// Both clients own reusable shared HTTP/2 channels whose total concurrency is
/// bounded by invocation admission. Invocation credentials, provider state,
/// session state and completion capture remain one-use values.
pub(crate) struct OrdinaryNativeAgentAssembler {
    runtime_context: Arc<RuntimeContextClient>,
    model_gateway: Arc<ModelGatewayClient>,
}

impl OrdinaryNativeAgentAssembler {
    #[must_use]
    pub(crate) const fn new(
        runtime_context: Arc<RuntimeContextClient>,
        model_gateway: Arc<ModelGatewayClient>,
    ) -> Self {
        Self {
            runtime_context,
            model_gateway,
        }
    }
}

#[async_trait]
impl NativeAgentAssembler for OrdinaryNativeAgentAssembler {
    type Completion = OrdinaryAgentCompletion<BoundModelGateway>;

    async fn assemble(
        &self,
        assembly: AuthorizedNativeAssembly<'_>,
    ) -> Result<AssembledNativeAgentInvocation<Self::Completion>, NativeAgentAssemblyError> {
        // Admission also constructs the command-bound projection/session plan,
        // so every deterministic local failure happens before PAT issuance.
        let admitted = assembly.admit_ordinary_no_tool()?;
        let redeemed = admitted
            .redeem_runtime_context(self.runtime_context.as_ref())
            .await
            .map_err(NativeAgentAssemblyError::from)?;
        let (profile, plan, context) = redeemed.into_parts();
        let invocation = ModelGatewayInvocation {
            model_name: profile.model_name().to_owned(),
            system_instruction: profile.instructions().to_owned(),
            max_tokens: profile.max_tokens(),
            reasoning_effort: profile.reasoning_effort().map(model_reasoning_effort),
            temperature: profile.temperature(),
        };
        let model = self
            .model_gateway
            .bind_ordinary(context, invocation)
            .map_err(model_binding_error)?;
        assemble_ordinary_native(model, plan).await
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

fn model_binding_error(error: ModelGatewayError) -> NativeAgentAssemblyError {
    let code = match error {
        ModelGatewayError::InvalidConfiguration => {
            NativeAgentAssemblyErrorCode::InvalidConfiguration
        }
        ModelGatewayError::InvalidInvocation => NativeAgentAssemblyErrorCode::InvalidInput,
        ModelGatewayError::ResourceExhausted => NativeAgentAssemblyErrorCode::ResourceExhausted,
        ModelGatewayError::DependencyUnavailable => {
            NativeAgentAssemblyErrorCode::DependencyUnavailable
        }
    };
    NativeAgentAssemblyError::new(code, "the ordinary native model could not be bound")
}

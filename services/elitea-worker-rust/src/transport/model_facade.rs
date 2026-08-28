//! Claim-scoped model facade over the Elitea gateway transport.
//!
//! The facade owns provider selection and returns one provider-neutral ADK
//! model/completion pair. The lower `model_gateway` module remains the bounded
//! Elitea `/llm/v1` transport plus its OpenAI-compatible adapter; native
//! Anthropic is a separate adapter over the same transport. Native `OpenAI` can
//! therefore be added without pretending it is the OpenAI-compatible dialect.

#![allow(dead_code)] // Production capability assembly remains gated.

use std::sync::Arc;

use tonic::transport::{Certificate, Identity};

use super::anthropic_gateway::BoundAnthropicGateway;
use super::model_gateway::{BoundModelGateway, ModelGatewayClient};
use super::runtime_context::ClaimScopedEliteaContext;
use crate::agents::runtime::NativeAgentAssemblyError;
use crate::agents::session::{BoundOrdinaryAgentModel, DurableModelCompletion};

pub(crate) use super::model_gateway::{
    ModelGatewayConfig as ModelFacadeConfig, ModelGatewayError as ModelFacadeError,
    ModelGatewayInvocation as ModelInvocation, ModelReasoningEffort,
};

/// Explicit provider dialect selected from the frozen model configuration.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ModelAdapterKind {
    OpenAiCompatible,
    Anthropic,
}

/// Shared, reusable facade whose bound invocation values remain one-use.
pub(crate) struct ModelFacade {
    gateway: ModelGatewayClient,
}

impl ModelFacade {
    /// Build the shared origin-bound Elitea model transport.
    pub(crate) async fn connect(
        config: ModelFacadeConfig,
        private_ca: Certificate,
        client_identity: Identity,
    ) -> Result<Self, ModelFacadeError> {
        ModelGatewayClient::connect(config, private_ca, client_identity)
            .await
            .map(Self::from_gateway)
    }

    /// Wrap the already constructed Elitea gateway transport.
    pub(crate) const fn from_gateway(gateway: ModelGatewayClient) -> Self {
        Self { gateway }
    }

    /// Consume the claim credential into the selected native ADK adapter.
    pub(crate) fn bind(
        &self,
        adapter: ModelAdapterKind,
        context: &ClaimScopedEliteaContext,
        model_project_id: u32,
        invocation: ModelInvocation,
    ) -> Result<BoundModelFacade, ModelFacadeError> {
        match adapter {
            ModelAdapterKind::OpenAiCompatible => self
                .gateway
                .bind_ordinary(context, model_project_id, invocation)
                .map(BoundModelFacade::OpenAiCompatible),
            ModelAdapterKind::Anthropic => self
                .gateway
                .bind_anthropic_ordinary(context, model_project_id, invocation)
                .map(BoundModelFacade::Anthropic),
        }
    }
}

/// Provider-neutral bound ADK model and exact final-completion owner.
pub(crate) enum BoundModelFacade {
    OpenAiCompatible(BoundModelGateway),
    Anthropic(BoundAnthropicGateway),
}

impl BoundOrdinaryAgentModel for BoundModelFacade {
    fn adk_model(&self) -> Arc<dyn adk_rust::Llm> {
        match self {
            Self::OpenAiCompatible(model) => model.adk_model(),
            Self::Anthropic(model) => model.adk_model(),
        }
    }

    fn take_completed_text(self) -> Result<String, NativeAgentAssemblyError> {
        match self {
            Self::OpenAiCompatible(model) => model.take_completed_text(),
            Self::Anthropic(model) => model.take_completed_text(),
        }
    }

    fn durable_completion(&self) -> Option<Arc<dyn DurableModelCompletion>> {
        match self {
            Self::OpenAiCompatible(model) => model.durable_completion(),
            Self::Anthropic(model) => model.durable_completion(),
        }
    }
}

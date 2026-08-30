//! Invocation-scoped facade for Elitea platform data-plane capabilities.
//!
//! Models are deliberately outside this facade. The first platform operation
//! resolves an exact nested application/version through the live execution
//! claim; future artifact read/write grants belong here as additional typed
//! capabilities rather than being hidden inside toolkits or model clients.

#![allow(dead_code)] // Production composition remains capability-gated.

use std::sync::Arc;

use crate::protocol::control::ClaimBoundRuntimeContextAuthority;

use super::runtime_context::{
    ClaimScopedEliteaContext, RuntimeApplicationVersion, RuntimeContextClient, RuntimeContextError,
};

/// Shared platform transport facade. Invocation authority is always supplied
/// separately and remains non-cloneable.
pub(crate) struct PlatformClient {
    runtime_context: Arc<RuntimeContextClient>,
}

impl PlatformClient {
    #[must_use]
    pub(crate) const fn new(runtime_context: Arc<RuntimeContextClient>) -> Self {
        Self { runtime_context }
    }

    /// Redeem the accepted execution actor for model/provider calls.
    pub(crate) async fn redeem_elitea_context(
        &self,
        authority: &ClaimBoundRuntimeContextAuthority,
    ) -> Result<ClaimScopedEliteaContext, RuntimeContextError> {
        self.runtime_context.redeem(authority).await
    }

    /// Resolve one exact child application/version using the live claim.
    ///
    /// Main must return a frozen, claim-materialized definition. Until that
    /// private route is implemented, nested applications remain an explicit
    /// activation gap rather than falling back to mutable public reads.
    pub(crate) async fn resolve_application_version(
        &self,
        authority: &ClaimBoundRuntimeContextAuthority,
        application_id: u64,
        version_id: u64,
    ) -> Result<RuntimeApplicationVersion, RuntimeContextError> {
        self.runtime_context
            .load_application_version(authority, application_id, version_id)
            .await
    }
}

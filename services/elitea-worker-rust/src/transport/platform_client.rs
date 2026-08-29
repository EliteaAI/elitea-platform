//! Invocation-scoped facade for Elitea platform data-plane capabilities.
//!
//! Models are deliberately outside this facade. The first platform operation
//! resolves an exact nested application/version through the live execution
//! claim; future artifact read/write grants belong here as additional typed
//! capabilities rather than being hidden inside toolkits or model clients.

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
    /// Main serves the frozen, claim-materialized definition on the private
    /// mTLS content route (`PostApplicationVersion`,
    /// `internal/infra/storage/content_server.go`), and this is the only way
    /// the runtime reads a nested application: there is deliberately no
    /// fallback to a mutable public read, so a child either resolves under the
    /// live claim or the turn fails with a stated reason. A claim that was
    /// accepted for a version main no longer has comes back as a TERMINAL
    /// `RuntimeContextError::NotFound`, not a retryable dependency failure.
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

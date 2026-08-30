//! Invocation-scoped facade for Elitea platform data-plane capabilities.
//!
//! Models are deliberately outside this facade. The first platform operation
//! resolves an exact nested application/version through the live execution
//! claim; future artifact read/write grants belong here as additional typed
//! capabilities rather than being hidden inside toolkits or model clients.

use std::sync::Arc;

use crate::protocol::control::ClaimBoundRuntimeContextAuthority;

use super::runtime_context::{
    ClaimScopedEliteaContext, RuntimeApplicationVersion, RuntimeAttachmentObject,
    RuntimeContextClient, RuntimeContextError,
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

    /// Read one of this turn's attached documents using the live claim.
    ///
    /// Main serves it from the same private mTLS content route family and
    /// authorizes on the claim's own project AND conversation
    /// (`PostAttachmentObject`), so this facade passes the reference through
    /// unchanged and adds no scope of its own — there is nothing here that
    /// could widen what the claim already permits.
    ///
    /// Unlike `resolve_application_version`, a failure of this call is NOT a
    /// failure of the turn. Its caller (`agents::attachments`) treats every
    /// error as "unreadable", announces the file by name and continues, which
    /// is pylon's own rule for a file the platform cannot read
    /// (`rpc/chat_all.py:384-386`).
    pub(crate) async fn read_attachment_object(
        &self,
        authority: &ClaimBoundRuntimeContextAuthority,
        bucket: &str,
        name: &str,
    ) -> Result<RuntimeAttachmentObject, RuntimeContextError> {
        self.runtime_context
            .load_attachment_object(authority, bucket, name)
            .await
    }
}

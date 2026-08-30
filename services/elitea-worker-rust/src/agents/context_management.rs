//! Explicit ownership seam for conversation context management.
//!
//! The current SDK can inject summarization and tool-output editing from
//! `context_settings`. ADK-Rust 2.0.0 already supplies post-invocation event
//! compaction, intra-invocation compaction and an LLM event summarizer. Those
//! primitives are intentionally not enabled yet: Elitea still has to freeze
//! the settings contract in Main and persist compaction events through the
//! existing `PostgreSQL` checkpointer lineage. This type keeps that future
//! composition out of model adapters and prevents a second transcript store.

#![allow(dead_code)] // Non-disabled plans remain an activation gap.

use serde_json::{Map, Value};

use super::runtime::{NativeAgentAssemblyError, NativeAgentAssemblyErrorCode};

/// Context behavior admitted before claim-scoped credentials are redeemed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ContextManagementPlan {
    /// No compaction or context editing is requested for this invocation.
    Disabled,
}

impl ContextManagementPlan {
    /// Interpret the current SDK's master switch without enabling a partial
    /// implementation. Any active request remains fail-closed until the
    /// checkpoint, resume and browser-analytics contracts are composed.
    pub(crate) fn admit_current(
        settings: &Map<String, Value>,
        conversation_id: Option<&str>,
    ) -> Result<Self, NativeAgentAssemblyError> {
        if settings.is_empty() || conversation_id.is_none() {
            return Ok(Self::Disabled);
        }
        match settings.get("enabled") {
            Some(Value::Bool(false)) => Ok(Self::Disabled),
            Some(Value::Bool(true)) | None => Err(unsupported()),
            Some(_) => Err(invalid_input()),
        }
    }

    /// Preserve an explicit Runner-assembly hook even while only the disabled
    /// state is admitted. Future ADK compaction configuration is applied here,
    /// after admission and before the exclusive Runner is built.
    pub(crate) const fn prepare_runner_composition(self) {
        match self {
            Self::Disabled => {}
        }
    }
}

const fn unsupported() -> NativeAgentAssemblyError {
    NativeAgentAssemblyError::new(
        NativeAgentAssemblyErrorCode::UnsupportedCapability,
        "native agent context management is not enabled",
    )
}

const fn invalid_input() -> NativeAgentAssemblyError {
    NativeAgentAssemblyError::new(
        NativeAgentAssemblyErrorCode::InvalidInput,
        "native agent context settings are malformed",
    )
}

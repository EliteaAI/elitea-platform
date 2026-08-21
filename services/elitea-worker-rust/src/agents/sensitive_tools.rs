//! Immutable runtime-policy projection into ADK's native tool confirmation.
//!
//! Main/runtime administration owns the toolkit-keyed policy dictionaries.
//! This module joins one immutable policy generation to the already
//! materialized toolsets, producing only the concrete ADK names that require
//! confirmation. Tool groups such as `read` and `write` are never authority.

#![allow(dead_code)] // Production activation waits for the durable resume ledger.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use adk_rust::tool::SimpleToolContext;
use adk_rust::{ReadonlyContext, Toolset};

use super::runtime::{NativeAgentAssemblyError, NativeAgentAssemblyErrorCode};
use crate::toolkits::{
    AdmittedToolSnapshot, FrozenToolKind, SensitiveToolPolicy, ToolAdmissionPolicy,
};

const TOOL_ENUMERATION_TIMEOUT: Duration = Duration::from_secs(1);
const MAX_CONFIRMED_TOOLS: usize = 1_024;

/// Sensitive concrete tools attached to one direct `LlmAgent` invocation.
///
/// Keys are the exact model-visible ADK function names. Values contain only
/// bounded public policy presentation; raw call arguments and interrupt
/// authority do not exist until the model emits a call.
#[derive(Clone, Default)]
pub(crate) struct SensitiveToolCatalog {
    entries: BTreeMap<Box<str>, SensitiveToolEntry>,
}

#[derive(Clone)]
struct SensitiveToolEntry {
    policy: SensitiveToolPolicy,
    read_only: bool,
}

impl SensitiveToolCatalog {
    #[must_use]
    pub(crate) fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub(crate) fn tool_names(&self) -> impl Iterator<Item = &str> {
        self.entries.keys().map(AsRef::as_ref)
    }

    #[must_use]
    pub(crate) fn policy_for(&self, tool_name: &str) -> Option<&SensitiveToolPolicy> {
        self.entries.get(tool_name).map(|entry| &entry.policy)
    }

    /// Return whether one exact sensitive tool was admitted as read-only.
    ///
    /// This is execution metadata, not authorization. It only permits the
    /// capability-disabled direct-HITL replay seam to exclude effects while
    /// the durable effect owner is still absent.
    #[must_use]
    pub(crate) fn is_read_only(&self, tool_name: &str) -> Option<bool> {
        self.entries.get(tool_name).map(|entry| entry.read_only)
    }

    pub(crate) fn merge(&mut self, other: Self) -> Result<(), NativeAgentAssemblyError> {
        if self
            .entries
            .len()
            .checked_add(other.entries.len())
            .is_none_or(|count| count > MAX_CONFIRMED_TOOLS)
        {
            return Err(resource_exhausted());
        }
        for (name, policy) in other.entries {
            if self.entries.insert(name, policy).is_some() {
                return Err(invalid_configuration());
            }
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn fixture(
        tool_name: &str,
        policy: SensitiveToolPolicy,
        read_only: bool,
    ) -> Result<Self, NativeAgentAssemblyError> {
        if tool_name.is_empty() || tool_name.len() > 512 || tool_name.chars().any(char::is_control)
        {
            return Err(invalid_configuration());
        }
        Ok(Self {
            entries: BTreeMap::from([(tool_name.into(), SensitiveToolEntry { policy, read_only })]),
        })
    }
}

/// Enumerate static, already-materialized toolsets and bind runtime sensitivity.
///
/// The configured and MCP materializers both return one bounded `BasicToolset`
/// per admitted frozen reference in source order. This helper verifies that
/// invariant instead of guessing an identity from a model-visible name.
pub(crate) async fn sensitive_tools_for_kind(
    snapshot: &AdmittedToolSnapshot<'_>,
    kind: FrozenToolKind,
    toolsets: &[Arc<dyn Toolset>],
    policy: &ToolAdmissionPolicy,
) -> Result<SensitiveToolCatalog, NativeAgentAssemblyError> {
    let references = snapshot
        .iter()
        .filter(|reference| reference.kind() == kind)
        .collect::<Vec<_>>();
    if references.len() != toolsets.len() {
        return Err(invalid_configuration());
    }
    let context: Arc<dyn ReadonlyContext> =
        Arc::new(SimpleToolContext::new("elitea_sensitive_policy"));
    let mut catalog = SensitiveToolCatalog::default();
    for (reference, toolset) in references.into_iter().zip(toolsets) {
        let tools = tokio::time::timeout(
            TOOL_ENUMERATION_TIMEOUT,
            toolset.tools(Arc::clone(&context)),
        )
        .await
        .map_err(|_| dependency_unavailable())?
        .map_err(|_| dependency_unavailable())?;
        if tools.len() > MAX_CONFIRMED_TOOLS {
            return Err(resource_exhausted());
        }
        for tool in tools {
            let Some(sensitive) =
                policy.sensitive_tool(reference.tool_type(), reference.toolkit_name(), tool.name())
            else {
                continue;
            };
            if catalog
                .entries
                .insert(
                    tool.name().into(),
                    SensitiveToolEntry {
                        policy: sensitive,
                        read_only: tool.is_read_only(),
                    },
                )
                .is_some()
            {
                return Err(invalid_configuration());
            }
        }
    }
    Ok(catalog)
}

const fn invalid_configuration() -> NativeAgentAssemblyError {
    NativeAgentAssemblyError::new(
        NativeAgentAssemblyErrorCode::InvalidConfiguration,
        "the sensitive-tool runtime policy does not match the materialized toolsets",
    )
}

const fn resource_exhausted() -> NativeAgentAssemblyError {
    NativeAgentAssemblyError::new(
        NativeAgentAssemblyErrorCode::ResourceExhausted,
        "the sensitive-tool runtime policy exceeds its approved limit",
    )
}

const fn dependency_unavailable() -> NativeAgentAssemblyError {
    NativeAgentAssemblyError::new(
        NativeAgentAssemblyErrorCode::DependencyUnavailable,
        "the sensitive-tool catalog could not be enumerated",
    )
}

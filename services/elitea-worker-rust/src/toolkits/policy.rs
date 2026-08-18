use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt;

const MAX_POLICY_IDENTIFIERS: usize = 16_384;
const MAX_POLICY_IDENTIFIER_BYTES: usize = 1_024;

/// Stable result of evaluating one toolkit or concrete tool.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ToolAdmissionDecision {
    Allowed,
    BlockedToolkit,
    BlockedTool,
}

/// Stable, data-free configuration failure for one policy generation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ToolAdmissionPolicyErrorCode {
    ResourceExhausted,
}

/// An over-limit immutable toolkit policy.
pub(crate) struct ToolAdmissionPolicyError {
    code: ToolAdmissionPolicyErrorCode,
}

impl ToolAdmissionPolicyError {
    #[must_use]
    pub(crate) const fn code(&self) -> ToolAdmissionPolicyErrorCode {
        self.code
    }
}

impl fmt::Debug for ToolAdmissionPolicyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ToolAdmissionPolicyError")
            .field("code", &self.code)
            .finish_non_exhaustive()
    }
}

impl fmt::Display for ToolAdmissionPolicyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("the toolkit admission policy exceeds its approved limit")
    }
}

impl std::error::Error for ToolAdmissionPolicyError {}

/// One immutable generation of platform toolkit restrictions.
///
/// The outer worker runtime may replace an `Arc<ToolAdmissionPolicy>` when its
/// trusted deployment configuration changes. An in-flight invocation retains
/// the exact generation it admitted, avoiding mutable process-global policy.
pub(crate) struct ToolAdmissionPolicy {
    blocked_toolkits: HashSet<Box<str>>,
    blocked_tools: HashMap<Box<str>, HashSet<Box<str>>>,
}

impl ToolAdmissionPolicy {
    /// Normalize one trusted deployment configuration.
    ///
    /// Separator-only entries are ignored to match the current SDK. Duplicate
    /// canonical entries collapse without changing membership semantics.
    pub(crate) fn new(
        blocked_toolkits: &[String],
        blocked_tools: &BTreeMap<String, Vec<String>>,
    ) -> Result<Self, ToolAdmissionPolicyError> {
        if blocked_tools
            .values()
            .try_fold(
                blocked_toolkits.len() + blocked_tools.len(),
                |total, tools| total.checked_add(tools.len()),
            )
            .is_none_or(|total| total > MAX_POLICY_IDENTIFIERS)
        {
            return Err(resource_exhausted());
        }

        let mut normalized_toolkits = HashSet::with_capacity(blocked_toolkits.len());
        for toolkit in blocked_toolkits {
            if let Some(key) = canonical_key(toolkit)? {
                normalized_toolkits.insert(key);
            }
        }

        let mut normalized_tools = HashMap::with_capacity(blocked_tools.len());
        for (toolkit, tools) in blocked_tools {
            let Some(toolkit_key) = canonical_toolkit_policy_key(toolkit)? else {
                continue;
            };
            let entry = normalized_tools
                .entry(toolkit_key)
                .or_insert_with(HashSet::new);
            for tool in tools {
                if let Some(tool_key) = canonical_key(tool)? {
                    entry.insert(tool_key);
                }
            }
        }
        Ok(Self {
            blocked_toolkits: normalized_toolkits,
            blocked_tools: normalized_tools,
        })
    }

    #[must_use]
    pub(crate) fn toolkit_decision(&self, toolkit_type: &str) -> ToolAdmissionDecision {
        if canonical_runtime_key(toolkit_type)
            .is_some_and(|key| self.blocked_toolkits.contains(key.as_str()))
        {
            ToolAdmissionDecision::BlockedToolkit
        } else {
            ToolAdmissionDecision::Allowed
        }
    }

    #[must_use]
    pub(crate) fn tool_decision(
        &self,
        toolkit_type: &str,
        tool_name: &str,
    ) -> ToolAdmissionDecision {
        if self.toolkit_decision(toolkit_type) == ToolAdmissionDecision::BlockedToolkit {
            return ToolAdmissionDecision::BlockedToolkit;
        }
        let Some(toolkit_key) = canonical_runtime_key(toolkit_type) else {
            return ToolAdmissionDecision::Allowed;
        };
        let Some(blocked) = self.blocked_tools.get(toolkit_key.as_str()) else {
            return ToolAdmissionDecision::Allowed;
        };
        if any_alias_matches(tool_name, blocked) {
            ToolAdmissionDecision::BlockedTool
        } else {
            ToolAdmissionDecision::Allowed
        }
    }
}

fn canonical_key(value: &str) -> Result<Option<Box<str>>, ToolAdmissionPolicyError> {
    if value.len() > MAX_POLICY_IDENTIFIER_BYTES {
        return Err(resource_exhausted());
    }
    Ok(canonical_runtime_key(value).map(String::into_boxed_str))
}

fn canonical_toolkit_policy_key(value: &str) -> Result<Option<Box<str>>, ToolAdmissionPolicyError> {
    if value.len() > MAX_POLICY_IDENTIFIER_BYTES {
        return Err(resource_exhausted());
    }
    if value.trim() == "*" {
        return Ok(Some(Box::from("*")));
    }
    Ok(canonical_runtime_key(value).map(String::into_boxed_str))
}

fn canonical_runtime_key(value: &str) -> Option<String> {
    let key = value
        .trim()
        .chars()
        .flat_map(char::to_lowercase)
        .filter(char::is_ascii_alphanumeric)
        .collect::<String>();
    (!key.is_empty()).then_some(key)
}

fn any_alias_matches(tool_name: &str, blocked: &HashSet<Box<str>>) -> bool {
    let mut current = tool_name.trim().to_lowercase();
    while !current.is_empty() {
        if canonical_runtime_key(&current).is_some_and(|key| blocked.contains(key.as_str())) {
            return true;
        }
        let mut reduced = current.as_str();
        if let Some((_, suffix)) = reduced.split_once("___") {
            reduced = suffix.trim();
        }
        if let Some((_, suffix)) = reduced.split_once(':') {
            reduced = suffix.trim();
        }
        if reduced.is_empty() || reduced == current {
            break;
        }
        current = reduced.to_owned();
    }
    false
}

const fn resource_exhausted() -> ToolAdmissionPolicyError {
    ToolAdmissionPolicyError {
        code: ToolAdmissionPolicyErrorCode::ResourceExhausted,
    }
}

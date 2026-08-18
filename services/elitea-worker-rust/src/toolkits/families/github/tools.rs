use std::fmt;
use std::sync::Arc;

use adk_rust::tool::BasicToolset;
use adk_rust::{AdkError, ErrorCategory, ErrorComponent, Tool, ToolContext};
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::toolkits::invocation::{MaterializedToolsetError, admit_materialized_toolset};
use crate::toolkits::policy::ToolAdmissionPolicy;

use super::client::{GitHubApi, GitHubClient, GitHubClientError};
use super::config::{GitHubToolkitConfig, GitHubToolkitConfigError};

const GET_ME: &str = "get_me";
const LIST_BRANCHES: &str = "list_branches_in_repo";
const MAX_DESCRIPTION_BYTES: usize = 1_000;

/// Safe failure returned while constructing the first GitHub tool subset.
pub(crate) struct GitHubToolsetError {
    code: GitHubToolsetErrorCode,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum GitHubToolsetErrorCode {
    InvalidConfiguration,
    UnsupportedSelection,
    Client,
    InvalidDefinition,
}

impl GitHubToolsetError {
    #[must_use]
    pub(crate) const fn code(&self) -> GitHubToolsetErrorCode {
        self.code
    }
}

impl fmt::Debug for GitHubToolsetError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("GitHubToolsetError")
            .field("code", &self.code)
            .finish_non_exhaustive()
    }
}

impl fmt::Display for GitHubToolsetError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self.code {
            GitHubToolsetErrorCode::InvalidConfiguration => {
                "the GitHub toolkit configuration is invalid"
            }
            GitHubToolsetErrorCode::UnsupportedSelection => {
                "the selected GitHub tool profile is not supported"
            }
            GitHubToolsetErrorCode::Client => "the GitHub toolkit client could not be created",
            GitHubToolsetErrorCode::InvalidDefinition => {
                "the GitHub ADK tool definition is invalid"
            }
        })
    }
}

impl std::error::Error for GitHubToolsetError {}

impl From<GitHubToolkitConfigError> for GitHubToolsetError {
    fn from(_: GitHubToolkitConfigError) -> Self {
        Self {
            code: GitHubToolsetErrorCode::InvalidConfiguration,
        }
    }
}

impl From<GitHubClientError> for GitHubToolsetError {
    fn from(_: GitHubClientError) -> Self {
        Self {
            code: GitHubToolsetErrorCode::Client,
        }
    }
}

impl From<MaterializedToolsetError> for GitHubToolsetError {
    fn from(_: MaterializedToolsetError) -> Self {
        Self {
            code: GitHubToolsetErrorCode::InvalidDefinition,
        }
    }
}

/// Build the capability-disabled first GitHub read-only profile.
///
/// Empty selection still means all 44 current SDK tools, so it is rejected
/// until the full family is ported. An explicitly selected `get_me` and/or
/// `list_branches_in_repo` can use this path. The production capability remains
/// disabled until sensitive effects, all read operations, GitHub App
/// installation auth and cross-process TLS integration are complete.
pub(crate) fn build_github_read_only_toolset(
    toolkit_name: &str,
    config: GitHubToolkitConfig,
    policy: &Arc<ToolAdmissionPolicy>,
) -> Result<BasicToolset, GitHubToolsetError> {
    validate_selection(config.selected_tools())?;
    let selected = config
        .selected_tools()
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let repository = config.repository().to_owned();
    let client: Arc<dyn GitHubApi> = Arc::new(GitHubClient::new(config)?);
    build_with_api(toolkit_name, &repository, &selected, policy, &client)
}

fn validate_selection(selected: &[Box<str>]) -> Result<(), GitHubToolsetError> {
    if selected.is_empty()
        || selected
            .iter()
            .any(|name| !matches!(name.as_ref(), GET_ME | LIST_BRANCHES))
    {
        return Err(GitHubToolsetError {
            code: GitHubToolsetErrorCode::UnsupportedSelection,
        });
    }
    Ok(())
}

fn build_with_api(
    toolkit_name: &str,
    repository: &str,
    selected: &[String],
    policy: &Arc<ToolAdmissionPolicy>,
    client: &Arc<dyn GitHubApi>,
) -> Result<BasicToolset, GitHubToolsetError> {
    let mut tools: Vec<Arc<dyn Tool>> = Vec::with_capacity(selected.len());
    for name in selected {
        let kind = match name.as_str() {
            GET_ME => GitHubReadToolKind::GetMe,
            LIST_BRANCHES => GitHubReadToolKind::ListBranches,
            _ => {
                return Err(GitHubToolsetError {
                    code: GitHubToolsetErrorCode::UnsupportedSelection,
                });
            }
        };
        tools.push(Arc::new(GitHubReadTool::new(
            kind,
            toolkit_name,
            repository,
            Arc::clone(client),
        )));
    }
    admit_materialized_toolset(toolkit_name, "github", policy, tools).map_err(Into::into)
}

#[derive(Clone, Copy)]
enum GitHubReadToolKind {
    GetMe,
    ListBranches,
}

struct GitHubReadTool {
    kind: GitHubReadToolKind,
    client: Arc<dyn GitHubApi>,
    description: Box<str>,
}

impl GitHubReadTool {
    fn new(
        kind: GitHubReadToolKind,
        toolkit_name: &str,
        repository: &str,
        client: Arc<dyn GitHubApi>,
    ) -> Self {
        let action = match kind {
            GitHubReadToolKind::GetMe => {
                "Get details of the authenticated GitHub user and account context."
            }
            GitHubReadToolKind::ListBranches => {
                "List up to 100 branches in the configured GitHub repository."
            }
        };
        let description = bounded_description(&format!(
            "Toolkit: {toolkit_name}\nRepository: {repository}\n{action}"
        ));
        Self {
            kind,
            client,
            description,
        }
    }
}

#[async_trait]
impl Tool for GitHubReadTool {
    fn name(&self) -> &str {
        match self.kind {
            GitHubReadToolKind::GetMe => GET_ME,
            GitHubReadToolKind::ListBranches => LIST_BRANCHES,
        }
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn is_read_only(&self) -> bool {
        true
    }

    fn is_concurrency_safe(&self) -> bool {
        true
    }

    fn parameters_schema(&self) -> Option<Value> {
        Some(match self.kind {
            GitHubReadToolKind::GetMe => json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            GitHubReadToolKind::ListBranches => json!({
                "type": "object",
                "properties": {
                    "max_count": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 100,
                        "default": 100,
                        "description": "Maximum number of branches to return."
                    }
                },
                "additionalProperties": false
            }),
        })
    }

    async fn execute(
        &self,
        _context: Arc<dyn ToolContext>,
        arguments: Value,
    ) -> adk_rust::Result<Value> {
        let arguments = arguments.as_object().ok_or_else(invalid_arguments)?;
        match self.kind {
            GitHubReadToolKind::GetMe => {
                if !arguments.is_empty() {
                    return Err(invalid_arguments());
                }
                self.client
                    .get_authenticated_user()
                    .await
                    .map_err(GitHubClientError::into_adk)
            }
            GitHubReadToolKind::ListBranches => {
                if arguments.keys().any(|key| key != "max_count") {
                    return Err(invalid_arguments());
                }
                let max_count = match arguments.get("max_count") {
                    None => 100,
                    Some(value) => value
                        .as_u64()
                        .and_then(|value| usize::try_from(value).ok())
                        .filter(|value| (1..=100).contains(value))
                        .ok_or_else(invalid_arguments)?,
                };
                self.client
                    .list_branches(max_count)
                    .await
                    .map_err(GitHubClientError::into_adk)
            }
        }
    }
}

fn bounded_description(value: &str) -> Box<str> {
    if value.len() <= MAX_DESCRIPTION_BYTES {
        return value.to_owned().into_boxed_str();
    }
    let mut end = MAX_DESCRIPTION_BYTES;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_owned().into_boxed_str()
}

fn invalid_arguments() -> AdkError {
    AdkError::new(
        ErrorComponent::Tool,
        ErrorCategory::InvalidInput,
        "github.arguments.invalid",
        "the GitHub tool arguments are invalid",
    )
}

#[cfg(test)]
pub(in crate::toolkits) fn test_build_with_api(
    toolkit_name: &str,
    repository: &str,
    selected: &[String],
    policy: &Arc<ToolAdmissionPolicy>,
    client: &Arc<dyn GitHubApi>,
) -> Result<BasicToolset, GitHubToolsetError> {
    build_with_api(toolkit_name, repository, selected, policy, client)
}

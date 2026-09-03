//! Sanitized delegated-authorization control signal shared by tool families.
//!
//! The current SDK names the browser contract `mcp_auth`, but the same
//! `McpAuthorizationRequired` signal is raised by ordinary configured toolkits
//! such as delegated `SharePoint`. Keeping this type outside the MCP transport
//! prevents direct graph nodes from depending on how the guarded tool was
//! materialized. Concrete toolkit families remain responsible for resolving
//! claim-fetched tokens into their own clients during the continuation rebuild.

use std::collections::BTreeMap;

use adk_rust::{AdkError, ErrorCategory, ErrorComponent, ErrorDetails};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::tool_binding::ToolBindingPlan;

const MAX_AUTH_CHALLENGE_BYTES: usize = 16 * 1_024;
const MAX_TOOLKIT_IDENTITY_BYTES: usize = 1_024;

/// Stable private ADK error code used to carry the current `mcp_auth` control
/// signal through policy wrappers without exposing a provider error body.
pub(crate) const DELEGATED_AUTHORIZATION_ERROR_CODE: &str = "mcp.authorization_required";
pub(crate) const DELEGATED_AUTHORIZATION_METADATA_KEY: &str = "elitea.delegated-authorization.v1";

/// Model-callable tools that are placeholders for one delegated authorization
/// boundary. The catalog is built together with the invocation's toolsets and
/// never contains tokens, tool arguments or provider response bodies.
#[derive(Clone, Default)]
pub(crate) struct DelegatedAuthorizationCatalog {
    scoped_requirements: BTreeMap<DelegatedToolIdentity, DelegatedAuthorizationRequirement>,
    provider_requirements: BTreeMap<String, DelegatedAuthorizationRequirement>,
}

#[derive(Clone, Eq, Ord, PartialEq, PartialOrd)]
struct DelegatedToolIdentity {
    toolkit_name: String,
    tool_name: String,
}

impl DelegatedAuthorizationCatalog {
    pub(crate) fn insert(
        &mut self,
        tool_name: &str,
        requirement: DelegatedAuthorizationRequirement,
    ) -> Result<(), ()> {
        if !valid_identity(tool_name) {
            return Err(());
        }
        let identity = DelegatedToolIdentity {
            toolkit_name: requirement.toolkit_name().to_owned(),
            tool_name: tool_name.to_owned(),
        };
        match self.scoped_requirements.get(&identity) {
            Some(existing) if existing == &requirement => Ok(()),
            Some(_) => Err(()),
            None => {
                self.scoped_requirements.insert(identity, requirement);
                self.rebuild_unqualified_provider_requirements();
                Ok(())
            }
        }
    }

    pub(crate) fn requirement_for(
        &self,
        tool_name: &str,
    ) -> Option<&DelegatedAuthorizationRequirement> {
        self.provider_requirements.get(tool_name)
    }

    pub(crate) fn requirement_for_scoped(
        &self,
        toolkit_name: &str,
        tool_name: &str,
    ) -> Option<&DelegatedAuthorizationRequirement> {
        self.scoped_requirements.get(&DelegatedToolIdentity {
            toolkit_name: toolkit_name.to_owned(),
            tool_name: tool_name.to_owned(),
        })
    }

    pub(crate) fn tool_names(&self) -> impl Iterator<Item = &str> {
        self.provider_requirements.keys().map(String::as_str)
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.scoped_requirements.is_empty()
    }

    pub(crate) fn merge(&mut self, other: Self) -> Result<(), ()> {
        for (identity, requirement) in other.scoped_requirements {
            match self.scoped_requirements.get(&identity) {
                Some(existing) if existing == &requirement => {}
                Some(_) => return Err(()),
                None => {
                    self.scoped_requirements.insert(identity, requirement);
                }
            }
        }
        self.rebuild_unqualified_provider_requirements();
        Ok(())
    }

    pub(crate) fn bind_provider_names(mut self, binding: &ToolBindingPlan) -> Result<Self, ()> {
        let mut provider_requirements = BTreeMap::new();
        for (identity, requirement) in &self.scoped_requirements {
            let provider_name = binding
                .provider_name(&identity.toolkit_name, &identity.tool_name)
                .ok_or(())?;
            if provider_requirements
                .insert(provider_name.to_owned(), requirement.clone())
                .is_some()
            {
                return Err(());
            }
        }
        self.provider_requirements = provider_requirements;
        Ok(self)
    }

    fn rebuild_unqualified_provider_requirements(&mut self) {
        let mut counts = BTreeMap::<&str, usize>::new();
        for identity in self.scoped_requirements.keys() {
            *counts.entry(identity.tool_name.as_str()).or_default() += 1;
        }
        self.provider_requirements = self
            .scoped_requirements
            .iter()
            .filter(|(identity, _)| counts.get(identity.tool_name.as_str()) == Some(&1))
            .map(|(identity, requirement)| (identity.tool_name.clone(), requirement.clone()))
            .collect();
    }
}

/// Sanitized OAuth requirement retained long enough to create a native graph
/// interrupt. It contains no token, client secret, tool arguments or response
/// body and deliberately has no `Debug` implementation.
#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct DelegatedAuthorizationRequirement {
    toolkit_name: String,
    toolkit_type: String,
    server_url: String,
    resource_metadata_url: Option<String>,
    www_authenticate: Option<String>,
}

impl DelegatedAuthorizationRequirement {
    pub(crate) fn new(
        toolkit_name: String,
        toolkit_type: String,
        server_url: String,
        resource_metadata_url: Option<String>,
        www_authenticate: Option<String>,
    ) -> Option<Self> {
        let requirement = Self {
            toolkit_name,
            toolkit_type,
            server_url,
            resource_metadata_url,
            www_authenticate,
        };
        valid_requirement(&requirement).then_some(requirement)
    }

    pub(crate) fn toolkit_name(&self) -> &str {
        &self.toolkit_name
    }

    pub(crate) fn toolkit_type(&self) -> &str {
        &self.toolkit_type
    }

    pub(crate) fn server_url(&self) -> &str {
        &self.server_url
    }

    pub(crate) fn resource_metadata_url(&self) -> Option<&str> {
        self.resource_metadata_url.as_deref()
    }

    pub(crate) fn www_authenticate(&self) -> Option<&str> {
        self.www_authenticate.as_deref()
    }

    pub(crate) fn user_message(&self) -> String {
        let family = if self.toolkit_type == "mcp" {
            "MCP toolkit"
        } else {
            "toolkit"
        };
        format!(
            "Authorization is required to use the {} {family}. Choose Authorize to sign in, or Skip to stop this pipeline safely.",
            self.toolkit_name
        )
    }
}

/// SDK-compatible structured result used to close the original model tool
/// call when the user declines delegated authorization.
pub(crate) fn delegated_authorization_declined_result(
    requirement: &DelegatedAuthorizationRequirement,
    tool_name: &str,
) -> Value {
    json!({
        "type": "mcp_auth_decision",
        "status": "declined",
        "server_url": requirement.server_url(),
        "tool_name": tool_name,
        "toolkit_type": requirement.toolkit_type(),
        "message": format!(
            "Authorization for the {} toolkit was declined; the requested tool was not executed.",
            requirement.toolkit_name()
        ),
        "next_step": "Do not retry this toolkit unless the user explicitly asks to authorize it.",
        "auth_context": {
            "resource_metadata_url": requirement.resource_metadata_url(),
            "www_authenticate": requirement.www_authenticate(),
            "resource_metadata": Value::Null,
        },
        "denial_reason": "user_declined",
    })
}

pub(crate) fn delegated_authorization_requirement(
    error: &AdkError,
) -> Option<DelegatedAuthorizationRequirement> {
    if error.code != DELEGATED_AUTHORIZATION_ERROR_CODE {
        return None;
    }
    error
        .details
        .metadata
        .get(DELEGATED_AUTHORIZATION_METADATA_KEY)
        .cloned()
        .and_then(|value| serde_json::from_value(value).ok())
        .filter(valid_requirement)
}

pub(crate) fn encode_delegated_authorization_requirement(
    requirement: &DelegatedAuthorizationRequirement,
) -> Option<String> {
    serde_json::to_string(requirement).ok()
}

pub(crate) fn decode_delegated_authorization_requirement(
    value: &str,
) -> Option<DelegatedAuthorizationRequirement> {
    serde_json::from_str(value).ok().filter(valid_requirement)
}

pub(super) fn preserve_delegated_authorization_error(error: &AdkError) -> Option<AdkError> {
    let requirement = delegated_authorization_requirement(error)?;
    if error.component != ErrorComponent::Auth
        || error.category != ErrorCategory::Unauthorized
        || error.details.metadata.len() != 1
    {
        return None;
    }
    Some(delegated_authorization_error(&requirement))
}

pub(crate) fn delegated_authorization_error(
    requirement: &DelegatedAuthorizationRequirement,
) -> AdkError {
    let metadata = serde_json::to_value(requirement).unwrap_or(serde_json::Value::Null);
    let mut details = ErrorDetails::default();
    details
        .metadata
        .insert(DELEGATED_AUTHORIZATION_METADATA_KEY.to_owned(), metadata);
    AdkError::unauthorized(
        ErrorComponent::Auth,
        DELEGATED_AUTHORIZATION_ERROR_CODE,
        "the toolkit operation requires delegated authorization",
    )
    .with_details(details)
}

fn valid_requirement(requirement: &DelegatedAuthorizationRequirement) -> bool {
    if !valid_identity(requirement.toolkit_name())
        || !valid_identity(requirement.toolkit_type())
        || valid_https_url(requirement.server_url()).is_none()
        || requirement.www_authenticate().is_some_and(|challenge| {
            challenge.is_empty()
                || challenge.len() > MAX_AUTH_CHALLENGE_BYTES
                || challenge.chars().any(char::is_control)
        })
    {
        return false;
    }
    requirement
        .resource_metadata_url()
        .is_none_or(|url| valid_https_url(url).is_some())
}

fn valid_identity(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_TOOLKIT_IDENTITY_BYTES
        && !value.chars().any(char::is_control)
}

fn valid_https_url(value: &str) -> Option<reqwest::Url> {
    let parsed = reqwest::Url::parse(value).ok()?;
    (parsed.scheme() == "https"
        && parsed.host_str().is_some()
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.fragment().is_none())
    .then_some(parsed)
}

#[cfg(test)]
pub(crate) fn delegated_authorization_error_fixture(toolkit_type: &str) -> AdkError {
    let (server_url, resource_metadata_url) = if toolkit_type == "sharepoint" {
        (
            "https://tenant.sharepoint.example.invalid/sites/support",
            "https://login.microsoftonline.example.invalid/tenant/v2.0/.well-known/openid-configuration",
        )
    } else {
        (
            "https://mcp.example.invalid/v1/mcp",
            "https://mcp.example.invalid/.well-known/oauth-protected-resource",
        )
    };
    delegated_authorization_error(
        &DelegatedAuthorizationRequirement::new(
            "Customer Support".to_owned(),
            toolkit_type.to_owned(),
            server_url.to_owned(),
            Some(resource_metadata_url.to_owned()),
            Some(format!(
                "Bearer resource_metadata=\"{resource_metadata_url}\""
            )),
        )
        .expect("authorization fixture"),
    )
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::sync::Arc;

    use adk_rust::tool::{BasicToolset, FunctionTool};
    use adk_rust::{Tool, Toolset};
    use serde_json::json;

    use super::{DelegatedAuthorizationCatalog, DelegatedAuthorizationRequirement};
    use crate::toolkits::bind_toolsets;

    #[tokio::test]
    async fn provider_aliases_retain_exact_delegated_authorization_identity() {
        let mut catalog = DelegatedAuthorizationCatalog::default();
        let mut toolsets = Vec::new();
        for (toolkit_name, endpoint) in [
            (
                "release intelligence",
                "https://release.example.invalid/mcp",
            ),
            ("audit intelligence", "https://audit.example.invalid/mcp"),
        ] {
            let requirement = DelegatedAuthorizationRequirement::new(
                toolkit_name.to_owned(),
                "mcp".to_owned(),
                endpoint.to_owned(),
                None,
                None,
            )
            .expect("delegated authorization fixture");
            catalog
                .insert("lookup", requirement)
                .expect("scoped authorization requirement");
            let tool: Arc<dyn Tool> = Arc::new(FunctionTool::new(
                "lookup",
                "Read one exact source",
                |_context, _arguments| async { Ok(json!({})) },
            ));
            toolsets
                .push(Arc::new(BasicToolset::new(toolkit_name, vec![tool])) as Arc<dyn Toolset>);
        }
        let binding = bind_toolsets(toolsets, &BTreeSet::new(), "authorization_alias_test")
            .await
            .expect("provider binding");
        let catalog = catalog
            .bind_provider_names(&binding)
            .expect("bound authorization catalog");
        assert_eq!(
            catalog
                .requirement_for("release_intelligence__lookup")
                .map(DelegatedAuthorizationRequirement::toolkit_name),
            Some("release intelligence")
        );
        assert_eq!(
            catalog
                .requirement_for("audit_intelligence__lookup")
                .map(DelegatedAuthorizationRequirement::toolkit_name),
            Some("audit intelligence")
        );
        assert!(catalog.requirement_for("lookup").is_none());
    }
}
